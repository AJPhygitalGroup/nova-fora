"""Defect endpoints (V2.2) — list / detail / create / patch / photos.

Mounts at `/defects`. The legacy `routes/defects_v2.py` and the V1
`routes/defects.py` are consolidated here in the V2.2 migration.

POST /defects creates a Defect row directly. The wizard typically passes
`source='inspection'` + `inspection_id` for DVIC walkarounds; off-inspection
sources (driver_report, shop_finding, etc.) leave `inspection_id` NULL.

PATCH /defects/{id} mutates `notes` + `details` only — (part, position,
defect_type) is immutable post-create. Workflow status is in a separate
(future) `defect_status` table per V2.2 §4.3.

Photo endpoints (POST/GET/DELETE under /defects/{id}/photos) preserve the
flow inherited from V1: presigned PUT to MinIO via /uploads/presigned,
then commit metadata via this route.
"""
import json
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlmodel import func, select

from app.auth.dependencies import (
    get_current_user,
    get_current_user_from_query_token,
)
from app.db import get_session
from app.models.base import utc_now
from app.models.defect import Defect, DefectSource
from app.models.defect_catalog import (
    DefectApplicability,
    DefectRule,
    VehicleClass,
)
from app.models.inspection import Inspection
from app.models.organization import Organization
from app.models.photo import Photo
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.schemas.defect import (
    DefectV2Create,
    DefectV2ListResponse,
    DefectV2Response,
    DefectV2Update,
)
from app.schemas.photo import (
    PhotoCommitRequest,
    PhotoListResponse,
    PhotoResponse,
)
from app.services.defect_validation import (
    DefectValidationError,
    validate_defect_write,
)
from app.services.pubsub import (
    publish_defect_created,
    subscribe_defect_created,
)
from app.storage.s3 import delete_object, generate_download_url

router = APIRouter(prefix="/defects", tags=["defects"])


# ─────────────────────────────────────────────────────
# ID parsing helpers
# ─────────────────────────────────────────────────────
def _parse_defect_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("FD-"):
        s = s[3:]
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid defect id: {raw!r}. Use int or 'FD-XXX'.",
        ) from None


def _parse_inspection_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("INS-"):
        s = s[4:]
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid inspection id: {raw!r}. Use int or 'INS-XXXXX'.",
        ) from None


# ─────────────────────────────────────────────────────
# Classification + group derivation
# ─────────────────────────────────────────────────────
async def _derive_class_and_group(
    session: AsyncSession, defect: Defect, vehicle_class: VehicleClass
) -> tuple[str | None, str | None]:
    """JOIN against rule × applicability to pull severity + routing."""
    row = (
        await session.execute(
            select(DefectRule.group, DefectApplicability.classification)
            .join(DefectApplicability, DefectApplicability.rule_id == DefectRule.id)
            .where(DefectRule.part == defect.part)
            .where(DefectRule.defect_type == defect.defect_type)
            .where(DefectApplicability.vehicle_class == vehicle_class.value)
        )
    ).first()
    if row is None:
        return None, None
    group, classification = row
    return (
        classification.value if hasattr(classification, "value") else classification,
        group.value if hasattr(group, "value") else group,
    )


async def _build_response(
    session: AsyncSession,
    defect: Defect,
    vehicle: Vehicle,
    org: Organization | None,
    reporter: User | None,
) -> DefectV2Response:
    classification, group = await _derive_class_and_group(
        session, defect, vehicle.vehicle_class
    )
    inspection_id_str = (
        f"INS-{defect.inspection_id:05d}"
        if defect.inspection_id is not None
        else None
    )
    return DefectV2Response.from_defect(
        defect,
        vehicle=vehicle,
        inspection_id_str=inspection_id_str,
        reporter=reporter,
        org=org,
        classification=classification,
        group=group,
    )


# ─────────────────────────────────────────────────────
# POST /defects
# ─────────────────────────────────────────────────────
@router.post(
    "",
    response_model=DefectV2Response,
    status_code=status.HTTP_201_CREATED,
    summary="Create one defect (vehicle-scoped, inspection optional)",
)
async def create_defect(
    body: DefectV2Create,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectV2Response:
    from app.routes.vehicles import _parse_vehicle_id

    vid = _parse_vehicle_id(body.vehicle_id)
    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == vid))
    ).scalar_one_or_none()
    if vehicle is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"vehicle {body.vehicle_id!r} not found",
        )

    # Tenant scoping: dsp_owner can only file defects on their own fleet.
    if (
        current.role == UserRole.DSP_OWNER
        and vehicle.dsp_id != current.organization_id
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "vehicle is not in your fleet"
        )

    # Resolve inspection_id, if provided
    inspection_pk: int | None = None
    if body.inspection_id is not None:
        inspection_pk = _parse_inspection_id(body.inspection_id)
        ins = (
            await session.execute(
                select(Inspection).where(Inspection.id == inspection_pk)
            )
        ).scalar_one_or_none()
        if ins is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                f"inspection {body.inspection_id!r} not found",
            )
        if ins.vehicle_id != vid:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "inspection.vehicle_id does not match the supplied vehicle_id",
            )

    # V2.2 catalog validation (returns matched rule + applicability)
    try:
        await validate_defect_write(
            session,
            part=body.part,
            position=body.position,
            defect_type=body.defect_type,
            details=body.details or {},
            source=body.source,
            inspection_id=inspection_pk,
            vehicle_class=vehicle.vehicle_class,
        )
    except DefectValidationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    defect = Defect(
        vehicle_id=vid,
        inspection_id=inspection_pk,
        source=body.source,
        part=body.part,
        position=body.position,
        defect_type=body.defect_type,
        details=body.details or {},
        notes=body.notes,
        reported_by_id=current.id,
        reported_at=body.reported_at or utc_now(),
    )
    session.add(defect)

    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        # The unique index includes details->>'wheel_position' so dual-rear
        # axles (inner/outer) don't collide. For everything else the conflict
        # space is (vehicle, inspection, part, position, defect_type).
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "this defect already exists for this vehicle, inspection, "
            "part and position — pick a different position or wheel side.",
        ) from e
    await session.refresh(defect)

    org = (
        await session.execute(
            select(Organization).where(Organization.id == vehicle.dsp_id)
        )
    ).scalar_one_or_none()
    response = await _build_response(session, defect, vehicle, org, current)

    # Best-effort SSE fan-out — failures don't block the commit.
    await publish_defect_created({
        "dsp_id": vehicle.dsp_id,
        "defect": response.model_dump(mode="json"),
    })

    return response


# ─────────────────────────────────────────────────────
# GET /defects
# ─────────────────────────────────────────────────────
@router.get("", response_model=DefectV2ListResponse)
async def list_defects(
    vehicle_id: str | None = Query(default=None, description="Int or 'VAN-XXXX'"),
    dsp_id: int | None = Query(default=None),
    inspection_id: str | None = Query(default=None, description="Int or 'INS-XXXXX'"),
    source: DefectSource | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectV2ListResponse:
    from app.routes.vehicles import _parse_vehicle_id

    Reporter = aliased(User)
    base = (
        select(Defect, Vehicle, Organization, Reporter)
        .join(Vehicle, Defect.vehicle_id == Vehicle.id)
        .join(Organization, Vehicle.dsp_id == Organization.id)
        .outerjoin(Reporter, Defect.reported_by_id == Reporter.id)
    )
    count_q = (
        select(func.count())
        .select_from(Defect)
        .join(Vehicle, Defect.vehicle_id == Vehicle.id)
    )

    # Tenant scoping
    if current.role == UserRole.DSP_OWNER:
        base = base.where(Vehicle.dsp_id == current.organization_id)
        count_q = count_q.where(Vehicle.dsp_id == current.organization_id)
    elif dsp_id is not None:
        base = base.where(Vehicle.dsp_id == dsp_id)
        count_q = count_q.where(Vehicle.dsp_id == dsp_id)

    if vehicle_id:
        vid = _parse_vehicle_id(vehicle_id)
        base = base.where(Defect.vehicle_id == vid)
        count_q = count_q.where(Defect.vehicle_id == vid)
    if inspection_id:
        iid = _parse_inspection_id(inspection_id)
        base = base.where(Defect.inspection_id == iid)
        count_q = count_q.where(Defect.inspection_id == iid)
    if source is not None:
        base = base.where(Defect.source == source.value)
        count_q = count_q.where(Defect.source == source.value)
    if date_from is not None:
        dt_from = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        base = base.where(Defect.reported_at >= dt_from)
        count_q = count_q.where(Defect.reported_at >= dt_from)
    if date_to is not None:
        dt_to = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        base = base.where(Defect.reported_at <= dt_to)
        count_q = count_q.where(Defect.reported_at <= dt_to)

    base = (
        base.order_by(Defect.reported_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )

    total = (await session.execute(count_q)).scalar_one()
    rows = (await session.execute(base)).all()

    items = []
    for d, v, o, r in rows:
        items.append(await _build_response(session, d, v, o, r))
    return DefectV2ListResponse(
        items=items, total=total, page=page, per_page=per_page
    )


@router.get(
    "/events",
    summary="SSE stream of newly-created defects",
    response_class=StreamingResponse,
)
async def stream_defect_events(
    current: User = Depends(get_current_user_from_query_token),
):
    """Server-Sent Events stream of `defect.created` events.

    Auth: pass JWT as `?token=...` (browser EventSource cannot set headers).
    Heartbeat every 15s so reverse proxies don't kill the connection.
    """
    async def event_generator():
        yield ": connected\n\n"
        async for envelope in subscribe_defect_created():
            if envelope.get("_heartbeat"):
                yield ": heartbeat\n\n"
                continue
            if (
                current.role == UserRole.DSP_OWNER
                and envelope.get("dsp_id") != current.organization_id
            ):
                continue
            defect = envelope.get("defect") or {}
            yield f"data: {json.dumps(defect, default=str)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{defect_id}", response_model=DefectV2Response)
async def get_defect(
    defect_id: str = Path(..., description="FD-XXX or int"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectV2Response:
    did = _parse_defect_id(defect_id)
    row = (
        await session.execute(
            select(Defect, Vehicle, Organization, User)
            .join(Vehicle, Defect.vehicle_id == Vehicle.id)
            .join(Organization, Vehicle.dsp_id == Organization.id)
            .outerjoin(User, Defect.reported_by_id == User.id)
            .where(Defect.id == did)
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "defect not found")
    defect, vehicle, org, reporter = row
    if (
        current.role == UserRole.DSP_OWNER
        and vehicle.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your defect")
    return await _build_response(session, defect, vehicle, org, reporter)


@router.patch("/{defect_id}", response_model=DefectV2Response)
async def update_defect(
    body: DefectV2Update,
    defect_id: str = Path(..., description="FD-XXX or int"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectV2Response:
    """Patch the mutable fields: `notes`, `details`. Anything else is
    immutable post-create."""
    did = _parse_defect_id(defect_id)
    defect = (
        await session.execute(select(Defect).where(Defect.id == did))
    ).scalar_one_or_none()
    if defect is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "defect not found")

    vehicle = (
        await session.execute(
            select(Vehicle).where(Vehicle.id == defect.vehicle_id)
        )
    ).scalar_one_or_none()
    if vehicle is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "dangling vehicle"
        )
    if (
        current.role == UserRole.DSP_OWNER
        and vehicle.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your defect")

    if body.details is not None:
        try:
            await validate_defect_write(
                session,
                part=defect.part,
                position=defect.position,
                defect_type=defect.defect_type,
                details=body.details,
                source=defect.source,
                inspection_id=defect.inspection_id,
                vehicle_class=vehicle.vehicle_class,
            )
        except DefectValidationError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
        defect.details = body.details

    if body.notes is not None:
        defect.notes = body.notes

    defect.updated_at = utc_now()
    session.add(defect)
    await session.commit()
    await session.refresh(defect)

    org = (
        await session.execute(
            select(Organization).where(Organization.id == vehicle.dsp_id)
        )
    ).scalar_one_or_none()
    reporter = (
        await session.execute(
            select(User).where(User.id == defect.reported_by_id)
        )
    ).scalar_one_or_none()
    return await _build_response(session, defect, vehicle, org, reporter)


@router.delete(
    "/{defect_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a defect (used by the wizard photo-gate rollback)",
)
async def delete_defect(
    defect_id: str = Path(..., description="FD-XXX or int"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    did = _parse_defect_id(defect_id)
    defect = (
        await session.execute(select(Defect).where(Defect.id == did))
    ).scalar_one_or_none()
    if defect is None:
        return None  # idempotent

    vehicle = (
        await session.execute(
            select(Vehicle).where(Vehicle.id == defect.vehicle_id)
        )
    ).scalar_one_or_none()
    if (
        vehicle is not None
        and current.role == UserRole.DSP_OWNER
        and vehicle.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your defect")

    # Cascade attached photos (delete bucket objects + DB rows)
    photo_rows = (
        await session.execute(select(Photo).where(Photo.defect_id == defect.id))
    ).scalars().all()
    for p in photo_rows:
        if not p.is_deleted:
            delete_object(p.storage_key)
        await session.delete(p)

    await session.delete(defect)
    await session.commit()
    return None


# ─────────────────────────────────────────────────────
# Photos attached to defects
# ─────────────────────────────────────────────────────
async def _load_defect_for_current(
    defect_id: str, current: User, session: AsyncSession
) -> tuple[Defect, Vehicle]:
    did = _parse_defect_id(defect_id)
    defect = (
        await session.execute(select(Defect).where(Defect.id == did))
    ).scalar_one_or_none()
    if defect is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "defect not found")
    vehicle = (
        await session.execute(
            select(Vehicle).where(Vehicle.id == defect.vehicle_id)
        )
    ).scalar_one_or_none()
    if vehicle is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "dangling vehicle")
    if (
        current.role == UserRole.DSP_OWNER
        and vehicle.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your defect")
    return defect, vehicle


def _photo_to_response(p: Photo, uploader_name: str | None = None) -> PhotoResponse:
    return PhotoResponse(
        id=p.id_str,
        category=p.category,
        url=generate_download_url(p.storage_key),
        content_type=p.content_type,
        size_bytes=p.size_bytes,
        width=p.width,
        height=p.height,
        uploaded_by=uploader_name,
        uploaded_at=p.uploaded_at,
        defect_id=f"FD-{p.defect_id:03d}" if p.defect_id else None,
        inspection_id=f"INS-{p.inspection_id:05d}" if p.inspection_id else None,
        work_order_id=f"WO-{p.work_order_id:05d}" if p.work_order_id else None,
    )


@router.post(
    "/{defect_id}/photos",
    response_model=PhotoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Commit a photo after uploading to MinIO via /uploads/presigned",
)
async def add_defect_photo(
    body: PhotoCommitRequest,
    defect_id: str,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PhotoResponse:
    defect, _vehicle = await _load_defect_for_current(defect_id, current, session)

    expected_prefix = f"photos/defects/{defect.id}/"
    if not body.storage_key.startswith(expected_prefix):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"storage_key must start with {expected_prefix!r}",
        )

    photo = Photo(
        defect_id=defect.id,
        category=body.category,
        storage_key=body.storage_key,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
        width=body.width,
        height=body.height,
        uploaded_by_id=current.id,
    )
    session.add(photo)
    defect.updated_at = utc_now()
    session.add(defect)
    await session.commit()
    await session.refresh(photo)
    return _photo_to_response(photo, uploader_name=current.full_name)


@router.get(
    "/{defect_id}/photos",
    response_model=PhotoListResponse,
    summary="List all photos attached to a defect (with presigned GET URLs)",
)
async def list_defect_photos(
    defect_id: str,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PhotoListResponse:
    defect, _vehicle = await _load_defect_for_current(defect_id, current, session)
    stmt = (
        select(Photo, User.full_name)
        .outerjoin(User, Photo.uploaded_by_id == User.id)
        .where(Photo.defect_id == defect.id)
        .where(Photo.is_deleted == False)  # noqa: E712
        .order_by(Photo.uploaded_at.desc())
    )
    rows = (await session.execute(stmt)).all()
    items = [_photo_to_response(p, uploader_name=name) for (p, name) in rows]
    return PhotoListResponse(items=items, total=len(items))


@router.delete(
    "/{defect_id}/photos/{photo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a photo (preserves audit)",
)
async def delete_defect_photo(
    defect_id: str,
    photo_id: str,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    defect, _vehicle = await _load_defect_for_current(defect_id, current, session)

    raw = photo_id.strip().upper()
    if raw.startswith("PH-"):
        raw = raw[3:]
    try:
        pid = int(raw)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid photo id") from None

    photo = (
        await session.execute(
            select(Photo)
            .where(Photo.id == pid)
            .where(Photo.defect_id == defect.id)
        )
    ).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "photo not found")

    if photo.is_deleted:
        return None

    photo.is_deleted = True
    photo.updated_at = utc_now()
    session.add(photo)
    delete_object(photo.storage_key)
    await session.commit()
    return None
