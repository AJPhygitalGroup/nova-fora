"""Defect endpoints — flat view across inspections (LEGACY).

The Defects.jsx component on the frontend shows all defects a DSP cares
about, flattened. This endpoint serves that view efficiently via JOINs
rather than N+1 per-inspection lookups.

PATCH /defects/{id} updates the workflow status (ack, dismiss, etc.).

────────────────────────────────────────────────────────────────────────────
TODO(post-migration): This whole module reads/writes the legacy
`reported_defects` table. The new standalone `defects` table (see
app/models/defect.py + app/routes/defects_v2.py) is the canonical home for
defect data going forward.

In particular, `PATCH /defects/{id}` (workflow status) needs to be
re-pointed once the future `defect_status` table lands — per the Notion
'Defect Data Schema' spec §2 'Excluded fields and why', workflow state
does NOT live on the defect row. When that lands:

  1. New endpoint writes to defect_status with a defect_id FK pointing
     at the v2 `defects` table (not reported_defects).
  2. This legacy PATCH stays only as long as the frontend's Defects.jsx
     still reads /defects (legacy). Once the frontend cuts over to
     /defects/v2 + the new workflow table, delete this whole module.
  3. Move /defects/v2/* up to /defects/* (route rename) at the same time.

See also: `python -m app.cli backfill-defects` for the data migration
from reported_defects → defects.
────────────────────────────────────────────────────────────────────────────
"""
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import func, select

from sqlalchemy.orm import aliased

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.base import utc_now
from app.models.inspection import (
    DefectStatus,
    Inspection,
    ReportedDefect,
)
from app.models.organization import Organization
from app.models.photo import Photo, PhotoCategory
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.schemas.inspection import (
    DefectListResponse,
    DefectResponse,
    DefectStatusUpdate,
)
from app.schemas.photo import (
    PhotoCommitRequest,
    PhotoListResponse,
    PhotoResponse,
)
from app.storage.s3 import delete_object, generate_download_url

router = APIRouter(prefix="/defects", tags=["defects"])


@router.get("", response_model=DefectListResponse)
async def list_defects(
    dsp_id: int | None = Query(default=None),
    status_: DefectStatus | None = Query(default=None, alias="status"),
    vehicle_id: str | None = Query(default=None, description="Int or VAN-XXXX"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectListResponse:
    # JOIN: defects → inspections → vehicles → organizations, + LEFT JOIN inspector
    InspectorUser = aliased(User)
    base_query = (
        select(ReportedDefect, Inspection, Vehicle, Organization, InspectorUser)
        .join(Inspection, ReportedDefect.inspection_id == Inspection.id)
        .join(Vehicle, Inspection.vehicle_id == Vehicle.id)
        .join(Organization, Inspection.dsp_id == Organization.id)
        .outerjoin(InspectorUser, Inspection.inspector_id == InspectorUser.id)
    )
    count_query = (
        select(func.count())
        .select_from(ReportedDefect)
        .join(Inspection, ReportedDefect.inspection_id == Inspection.id)
    )

    # Role scoping
    if current.role == UserRole.DSP_OWNER:
        base_query = base_query.where(Inspection.dsp_id == current.organization_id)
        count_query = count_query.where(Inspection.dsp_id == current.organization_id)
    elif dsp_id is not None:
        base_query = base_query.where(Inspection.dsp_id == dsp_id)
        count_query = count_query.where(Inspection.dsp_id == dsp_id)

    if status_ is not None:
        base_query = base_query.where(ReportedDefect.status == status_.value)
        count_query = count_query.where(ReportedDefect.status == status_.value)
    if vehicle_id is not None:
        from app.routes.vehicles import _parse_vehicle_id
        vid = _parse_vehicle_id(vehicle_id)
        base_query = base_query.where(Inspection.vehicle_id == vid)
        count_query = count_query.where(Inspection.vehicle_id == vid)

    if date_from is not None:
        dt_from = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        base_query = base_query.where(Inspection.submitted_at >= dt_from)
        count_query = count_query.where(Inspection.submitted_at >= dt_from)
    if date_to is not None:
        dt_to = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        base_query = base_query.where(Inspection.submitted_at <= dt_to)
        count_query = count_query.where(Inspection.submitted_at <= dt_to)

    base_query = (
        base_query.order_by(ReportedDefect.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )

    total = (await session.execute(count_query)).scalar_one()
    rows = (await session.execute(base_query)).all()

    items = []
    for defect, inspection, vehicle, org, inspector in rows:
        item = DefectResponse.from_defect(defect, inspection.id_str)
        item.van = vehicle.id_str
        item.fleet_id = vehicle.fleet_id
        item.plate = vehicle.plate
        item.dsp = org.name
        item.dsp_id = org.id_str
        item.reported_by = inspector.full_name if inspector else None
        item.inspection_submitted_at = inspection.submitted_at
        items.append(item)

    return DefectListResponse(items=items, total=total, page=page, per_page=per_page)


# TODO(defect-workflow-migration): repoint this to the future `defect_status`
# table (FK at the v2 `defects` table, not reported_defects). Per the Notion
# 'Defect Data Schema' spec §2, workflow state does NOT live on the defect
# row — this endpoint is legacy until the new workflow spec ships.
@router.patch("/{defect_id}", response_model=DefectResponse)
async def update_defect_status(
    body: DefectStatusUpdate,
    defect_id: str = Path(..., description="Int or FD-XXX"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectResponse:
    # Parse id
    raw = defect_id.strip().upper()
    if raw.startswith("FD-"):
        raw = raw[3:]
    try:
        did = int(raw)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid defect id: {defect_id!r}. Use int or 'FD-XXX'.",
        ) from None

    defect = (
        await session.execute(select(ReportedDefect).where(ReportedDefect.id == did))
    ).scalar_one_or_none()
    if defect is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "defect not found")

    # Load parent inspection for scoping check
    insp = (
        await session.execute(
            select(Inspection).where(Inspection.id == defect.inspection_id)
        )
    ).scalar_one_or_none()
    if insp is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "dangling inspection")

    if (
        current.role == UserRole.DSP_OWNER
        and insp.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your defect")
    if current.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "only dsp_owner or site_admin can update defect status"
        )

    defect.status = body.status
    defect.updated_at = utc_now()
    session.add(defect)
    await session.commit()
    await session.refresh(defect)

    return DefectResponse.from_defect(defect, insp.id_str)


# ─────────────────────────────────────────────────────
# Photos attached to defects
# ─────────────────────────────────────────────────────
def _parse_defect_id_path(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("FD-"):
        s = s[3:]
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid defect id: {raw!r}",
        ) from None


async def _load_defect_for_current(
    defect_id: str, current: User, session: AsyncSession
) -> tuple[ReportedDefect, Inspection]:
    did = _parse_defect_id_path(defect_id)
    defect = (
        await session.execute(select(ReportedDefect).where(ReportedDefect.id == did))
    ).scalar_one_or_none()
    if defect is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "defect not found")
    insp = (
        await session.execute(
            select(Inspection).where(Inspection.id == defect.inspection_id)
        )
    ).scalar_one_or_none()
    if insp is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "dangling inspection")
    if (
        current.role == UserRole.DSP_OWNER
        and insp.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your defect")
    return defect, insp


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
    summary="Commit a photo after uploading its bytes to the presigned URL",
)
async def add_defect_photo(
    body: PhotoCommitRequest,
    defect_id: str,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PhotoResponse:
    defect, _insp = await _load_defect_for_current(defect_id, current, session)

    # Sanity check: storage_key must start with the expected defect prefix
    # (matches the key minted by /uploads/presigned). Cheap validation that
    # the client isn't attaching some other upload's key.
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

    # Bump the denormalized counter (keeps list queries fast)
    defect.photo_count = (defect.photo_count or 0) + 1
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
    defect, _insp = await _load_defect_for_current(defect_id, current, session)
    stmt = (
        select(Photo, User.full_name)
        .outerjoin(User, Photo.uploaded_by_id == User.id)
        .where(Photo.defect_id == defect.id)
        .where(Photo.is_deleted == False)  # noqa: E712
        # Odometer first (never true for defects, but keeps order stable),
        # then by upload time desc.
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
    defect, _insp = await _load_defect_for_current(defect_id, current, session)

    # Parse photo_id (PH-XXXX or int)
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
        return  # idempotent

    photo.is_deleted = True
    photo.updated_at = utc_now()
    session.add(photo)

    defect.photo_count = max(0, (defect.photo_count or 0) - 1)
    defect.updated_at = utc_now()
    session.add(defect)

    # Also remove from bucket — saves storage + protects PII.
    # Runs synchronously; for heavy fleets, move to Arq job in Semana 7.
    delete_object(photo.storage_key)

    await session.commit()
    return None
