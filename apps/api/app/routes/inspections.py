"""Inspection endpoints — list / detail / create / submit (V2.2).

Defects are first-class (V2.2) — they're created via POST /defects with
`source='inspection'` + `inspection_id`. The /inspections endpoints no longer
embed defect-create payloads. The wizard flow:

  1. POST /inspections                  → DRAFT
  2. POST /defects (per defect)         → with inspection_id + source='inspection'
  3. POST /inspections/{id}/submit      → SUBMITTED + result computed
"""
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import func, select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.base import utc_now
from app.models.defect import Defect
from app.models.inspection import (
    Inspection,
    InspectionResult,
    InspectionStatus,
)
from app.models.organization import Organization
from app.models.photo import Photo, PhotoCategory
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.routes.vehicles import _parse_vehicle_id
from app.schemas.defect import DefectV2Response
from app.schemas.inspection import (
    InspectionCreate,
    InspectionListItem,
    InspectionListResponse,
    InspectionResponse,
    InspectionSubmit,
)
from app.schemas.photo import (
    PhotoCommitRequest,
    PhotoListResponse,
    PhotoResponse,
)
from app.storage.s3 import generate_download_url

router = APIRouter(prefix="/inspections", tags=["inspections"])


# ─────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────
def _compute_result(defect_count: int) -> InspectionResult:
    """Binary result: any defects → FLAGGED, else PASSED."""
    return InspectionResult.FLAGGED if defect_count > 0 else InspectionResult.PASSED


def _parse_inspection_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("INS-"):
        s = s[4:]
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid inspection id: {raw!r}. Use integer or 'INS-XXXXX'.",
        ) from None


async def _build_inspection_response(
    session: AsyncSession, insp: Inspection
) -> InspectionResponse:
    """Full detail with defects + joined vehicle/org/inspector."""
    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == insp.vehicle_id))
    ).scalar_one_or_none()
    org = (
        await session.execute(
            select(Organization).where(Organization.id == insp.dsp_id)
        )
    ).scalar_one_or_none()

    inspector = None
    vendor_org = None
    if insp.inspector_id:
        inspector = (
            await session.execute(
                select(User).where(User.id == insp.inspector_id)
            )
        ).scalar_one_or_none()
        if inspector:
            vendor_org = (
                await session.execute(
                    select(Organization).where(Organization.id == inspector.organization_id)
                )
            ).scalar_one_or_none()

    # Load child defects + their reporter for response
    defect_rows = (
        await session.execute(
            select(Defect, User)
            .outerjoin(User, Defect.reported_by_id == User.id)
            .where(Defect.inspection_id == insp.id)
            .order_by(Defect.reported_at.asc())
        )
    ).all()

    # Build defect responses with classification + group derived per-row
    from app.routes.defects import _build_response as _defect_response
    defect_items: list[DefectV2Response] = []
    for d, reporter in defect_rows:
        if vehicle is not None:
            defect_items.append(
                await _defect_response(session, d, vehicle, org, reporter)
            )

    return InspectionResponse(
        id=insp.id_str,
        vehicle_id=vehicle.id_str if vehicle else "",
        fleet_id=vehicle.fleet_id if vehicle else "",
        vehicle_class=(
            vehicle.vehicle_class.value
            if vehicle and hasattr(vehicle.vehicle_class, "value")
            else (str(vehicle.vehicle_class) if vehicle else "")
        ),
        dsp_id=org.id_str if org else "",
        dsp=org.name if org else "",
        inspector=inspector.full_name if inspector else None,
        inspector_id=str(inspector.id) if inspector else None,
        vendor=vendor_org.name if vendor_org else None,
        vendor_id=vendor_org.id_str if vendor_org else None,
        status=insp.status,
        result=insp.result,
        odometer_miles=insp.odometer_miles,
        odometer_source=insp.odometer_source,
        keys_received=insp.keys_received,
        notes=insp.notes,
        incomplete_reason=insp.incomplete_reason,
        started_at=insp.started_at,
        submitted_at=insp.submitted_at,
        created_at=insp.created_at,
        defects=defect_items,
    )


# ─────────────────────────────────────────────────────
# GET /inspections
# ─────────────────────────────────────────────────────
@router.get("", response_model=InspectionListResponse)
async def list_inspections(
    dsp_id: int | None = Query(default=None),
    vehicle_id: str | None = Query(default=None, description="Int or VAN-XXXX"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    result: InspectionResult | None = Query(default=None),
    status_: InspectionStatus | None = Query(
        default=InspectionStatus.SUBMITTED,
        alias="status",
    ),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InspectionListResponse:
    stmt = select(Inspection)
    count_stmt = select(func.count()).select_from(Inspection)

    if status_ is not None:
        stmt = stmt.where(Inspection.status == status_.value)
        count_stmt = count_stmt.where(Inspection.status == status_.value)

    if current.role == UserRole.DSP_OWNER:
        stmt = stmt.where(Inspection.dsp_id == current.organization_id)
        count_stmt = count_stmt.where(Inspection.dsp_id == current.organization_id)
    elif dsp_id is not None:
        stmt = stmt.where(Inspection.dsp_id == dsp_id)
        count_stmt = count_stmt.where(Inspection.dsp_id == dsp_id)

    if vehicle_id is not None:
        vid = _parse_vehicle_id(vehicle_id)
        stmt = stmt.where(Inspection.vehicle_id == vid)
        count_stmt = count_stmt.where(Inspection.vehicle_id == vid)

    if result is not None:
        stmt = stmt.where(Inspection.result == result.value)
        count_stmt = count_stmt.where(Inspection.result == result.value)

    if date_from is not None:
        dt_from = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        stmt = stmt.where(Inspection.submitted_at >= dt_from)
        count_stmt = count_stmt.where(Inspection.submitted_at >= dt_from)
    if date_to is not None:
        dt_to = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        stmt = stmt.where(Inspection.submitted_at <= dt_to)
        count_stmt = count_stmt.where(Inspection.submitted_at <= dt_to)

    stmt = (
        stmt.order_by(Inspection.submitted_at.desc().nulls_last())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )

    total = (await session.execute(count_stmt)).scalar_one()
    inspections = (await session.execute(stmt)).scalars().all()

    if not inspections:
        return InspectionListResponse(items=[], total=total, page=page, per_page=per_page)

    # Batch joins to avoid N+1
    vehicle_ids = {i.vehicle_id for i in inspections}
    dsp_ids = {i.dsp_id for i in inspections}
    inspector_ids = {i.inspector_id for i in inspections if i.inspector_id}
    insp_ids = [i.id for i in inspections]

    vehicles_rows = (
        await session.execute(select(Vehicle).where(Vehicle.id.in_(vehicle_ids)))
    ).scalars().all()
    veh_by_id = {v.id: v for v in vehicles_rows}

    orgs_rows = (
        await session.execute(select(Organization).where(Organization.id.in_(dsp_ids)))
    ).scalars().all()
    org_by_id = {o.id: o for o in orgs_rows}

    inspector_rows = []
    if inspector_ids:
        inspector_rows = (
            await session.execute(select(User).where(User.id.in_(inspector_ids)))
        ).scalars().all()
    user_by_id = {u.id: u for u in inspector_rows}

    vendor_org_ids = {u.organization_id for u in inspector_rows if u.organization_id}
    vendor_orgs_rows = []
    if vendor_org_ids:
        vendor_orgs_rows = (
            await session.execute(select(Organization).where(Organization.id.in_(vendor_org_ids)))
        ).scalars().all()
    vendor_org_by_id = {o.id: o for o in vendor_orgs_rows}

    # Defect counts per inspection (single grouped query)
    counts = (
        await session.execute(
            select(Defect.inspection_id, func.count().label("n"))
            .where(Defect.inspection_id.in_(insp_ids))
            .group_by(Defect.inspection_id)
        )
    ).all()
    count_by_insp = {iid: n for iid, n in counts}

    items = []
    for i in inspections:
        v = veh_by_id.get(i.vehicle_id)
        o = org_by_id.get(i.dsp_id)
        ins = user_by_id.get(i.inspector_id) if i.inspector_id else None
        vendor_org = vendor_org_by_id.get(ins.organization_id) if ins else None
        items.append(
            InspectionListItem(
                id=i.id_str,
                vehicle_id=v.id_str if v else "",
                fleet_id=v.fleet_id if v else "",
                dsp_id=o.id_str if o else "",
                dsp=o.name if o else "",
                inspector=ins.full_name if ins else None,
                vendor=vendor_org.name if vendor_org else None,
                vendor_id=vendor_org.id_str if vendor_org else None,
                status=i.status,
                result=i.result,
                odometer_miles=i.odometer_miles,
                keys_received=i.keys_received,
                incomplete_reason=i.incomplete_reason,
                submitted_at=i.submitted_at,
                created_at=i.created_at,
                defect_count=count_by_insp.get(i.id, 0),
            )
        )

    return InspectionListResponse(items=items, total=total, page=page, per_page=per_page)


# ─────────────────────────────────────────────────────
# GET /inspections/{id}
# ─────────────────────────────────────────────────────
@router.get("/{inspection_id}", response_model=InspectionResponse)
async def get_inspection(
    inspection_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InspectionResponse:
    iid = _parse_inspection_id(inspection_id)
    insp = (
        await session.execute(select(Inspection).where(Inspection.id == iid))
    ).scalar_one_or_none()
    if insp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "inspection not found")

    if (
        current.role == UserRole.DSP_OWNER
        and insp.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your inspection")

    return await _build_inspection_response(session, insp)


# ─────────────────────────────────────────────────────
# POST /inspections
# ─────────────────────────────────────────────────────
@router.post(
    "", response_model=InspectionResponse, status_code=status.HTTP_201_CREATED
)
async def create_inspection(
    body: InspectionCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InspectionResponse:
    vid = _parse_vehicle_id(body.vehicle_id)
    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == vid))
    ).scalar_one_or_none()
    if vehicle is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")

    if current.role == UserRole.DSP_OWNER:
        if vehicle.dsp_id != current.organization_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "vehicle belongs to another DSP"
            )

    now = utc_now()
    is_draft = body.result_override is None and not body.incomplete_reason

    if is_draft:
        insp = Inspection(
            vehicle_id=vehicle.id,
            dsp_id=vehicle.dsp_id,
            inspector_id=current.id,
            status=InspectionStatus.DRAFT,
            result=InspectionResult.PASSED,  # placeholder, re-computed on submit
            odometer_miles=body.odometer_miles,
            odometer_source=body.odometer_source,
            keys_received=body.keys_received,
            notes=body.notes,
            incomplete_reason=body.incomplete_reason,
            started_at=now,
            submitted_at=None,
        )
    else:
        # Atomic SUBMITTED — used by incomplete-reason fast-path (no defects).
        # Defects-attached atomic submit is no longer supported in V2.2; the
        # wizard always goes DRAFT → defects → submit.
        result = body.result_override or InspectionResult.PASSED
        if body.incomplete_reason:
            result = InspectionResult.INCOMPLETE
        insp = Inspection(
            vehicle_id=vehicle.id,
            dsp_id=vehicle.dsp_id,
            inspector_id=current.id,
            status=InspectionStatus.SUBMITTED,
            result=result,
            odometer_miles=body.odometer_miles,
            odometer_source=body.odometer_source,
            keys_received=body.keys_received,
            notes=body.notes,
            incomplete_reason=body.incomplete_reason,
            started_at=now,
            submitted_at=now,
        )
    session.add(insp)
    await session.flush()

    if body.odometer_miles is not None and body.odometer_miles > vehicle.mileage:
        vehicle.mileage = body.odometer_miles
        vehicle.updated_at = now
        session.add(vehicle)

    await session.commit()
    await session.refresh(insp)
    return await _build_inspection_response(session, insp)


# ─────────────────────────────────────────────────────
# POST /inspections/{id}/submit  — finalize a DRAFT
# ─────────────────────────────────────────────────────
async def _load_draft_for_current(
    inspection_id: str, current: User, session: AsyncSession
) -> Inspection:
    iid = _parse_inspection_id(inspection_id)
    insp = (
        await session.execute(select(Inspection).where(Inspection.id == iid))
    ).scalar_one_or_none()
    if insp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "inspection not found")
    if insp.status != InspectionStatus.DRAFT:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"inspection is {insp.status.value}; only DRAFT can be edited",
        )
    if current.role == UserRole.DSP_OWNER and insp.dsp_id != current.organization_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your DSP")
    if (
        insp.inspector_id is not None
        and insp.inspector_id != current.id
        and current.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN)
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "only the inspector or org admin can edit this draft",
        )
    return insp


@router.post(
    "/{inspection_id}/submit",
    response_model=InspectionResponse,
    summary="Finalize a DRAFT inspection (computes result, sets submitted_at)",
)
async def submit_inspection(
    body: InspectionSubmit,
    inspection_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InspectionResponse:
    insp = await _load_draft_for_current(inspection_id, current, session)

    if body.odometer_miles is not None:
        insp.odometer_miles = body.odometer_miles
    if body.odometer_source is not None:
        insp.odometer_source = body.odometer_source
    if body.notes is not None:
        insp.notes = body.notes
    if body.incomplete_reason is not None:
        insp.incomplete_reason = body.incomplete_reason

    # Result: count attached defects, derive PASSED/FLAGGED.
    defect_count = (
        await session.execute(
            select(func.count())
            .select_from(Defect)
            .where(Defect.inspection_id == insp.id)
        )
    ).scalar_one()
    computed = body.result_override or _compute_result(defect_count)
    if insp.incomplete_reason:
        computed = InspectionResult.INCOMPLETE

    insp.result = computed
    insp.status = InspectionStatus.SUBMITTED
    now = utc_now()
    insp.submitted_at = now
    insp.updated_at = now
    session.add(insp)

    if insp.odometer_miles is not None:
        vehicle = (
            await session.execute(select(Vehicle).where(Vehicle.id == insp.vehicle_id))
        ).scalar_one_or_none()
        if vehicle and insp.odometer_miles > vehicle.mileage:
            vehicle.mileage = insp.odometer_miles
            vehicle.updated_at = now
            session.add(vehicle)

    await session.commit()
    await session.refresh(insp)
    return await _build_inspection_response(session, insp)


# ─────────────────────────────────────────────────────
# Photos directly on the inspection (odometer, overview)
# ─────────────────────────────────────────────────────
@router.post(
    "/{inspection_id}/photos",
    response_model=PhotoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Commit a photo attached to the inspection (odometer, overview)",
)
async def add_inspection_photo(
    body: PhotoCommitRequest,
    inspection_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PhotoResponse:
    iid = _parse_inspection_id(inspection_id)
    insp = (
        await session.execute(select(Inspection).where(Inspection.id == iid))
    ).scalar_one_or_none()
    if insp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "inspection not found")

    if current.role == UserRole.DSP_OWNER and insp.dsp_id != current.organization_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your DSP")

    expected_prefix = f"photos/inspections/{insp.id}/"
    if not body.storage_key.startswith(expected_prefix):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"storage_key must start with {expected_prefix!r}",
        )

    photo = Photo(
        inspection_id=insp.id,
        category=body.category,
        storage_key=body.storage_key,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
        width=body.width,
        height=body.height,
        uploaded_by_id=current.id,
    )
    session.add(photo)
    insp.updated_at = utc_now()
    session.add(insp)
    await session.commit()
    await session.refresh(photo)

    return PhotoResponse(
        id=photo.id_str,
        category=photo.category,
        url=generate_download_url(photo.storage_key),
        content_type=photo.content_type,
        size_bytes=photo.size_bytes,
        width=photo.width,
        height=photo.height,
        uploaded_by=current.full_name,
        uploaded_at=photo.uploaded_at,
        inspection_id=insp.id_str,
    )


@router.get(
    "/{inspection_id}/photos",
    response_model=PhotoListResponse,
    summary="List photos directly attached to the inspection",
)
async def list_inspection_photos(
    inspection_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PhotoListResponse:
    iid = _parse_inspection_id(inspection_id)
    insp = (
        await session.execute(select(Inspection).where(Inspection.id == iid))
    ).scalar_one_or_none()
    if insp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "inspection not found")
    if current.role == UserRole.DSP_OWNER and insp.dsp_id != current.organization_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your DSP")

    stmt = (
        select(Photo, User.full_name)
        .outerjoin(User, Photo.uploaded_by_id == User.id)
        .where(Photo.inspection_id == insp.id)
        .where(Photo.is_deleted == False)  # noqa: E712
        .order_by(Photo.uploaded_at.asc())
    )
    rows = (await session.execute(stmt)).all()
    items = []
    for photo, name in rows:
        items.append(
            PhotoResponse(
                id=photo.id_str,
                category=photo.category,
                url=generate_download_url(photo.storage_key),
                content_type=photo.content_type,
                size_bytes=photo.size_bytes,
                width=photo.width,
                height=photo.height,
                uploaded_by=name,
                uploaded_at=photo.uploaded_at,
                inspection_id=insp.id_str,
            )
        )
    return PhotoListResponse(items=items, total=len(items))
