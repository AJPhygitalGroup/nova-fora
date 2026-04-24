"""Inspection endpoints — list / detail / create (one-shot submit)."""
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import func, select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.base import utc_now
from app.models.inspection import (
    DefectSeverity,
    Inspection,
    InspectionResult,
    InspectionStatus,
    ReportedDefect,
)
from app.models.organization import Organization
from app.models.photo import Photo, PhotoCategory
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.schemas.inspection import (
    DefectCreate,
    DefectResponse,
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
from app.storage.s3 import delete_object, generate_download_url
from app.routes.vehicles import _parse_vehicle_id  # reuse the VAN-XXXX parser

router = APIRouter(prefix="/inspections", tags=["inspections"])


# Severity rank used to compute an inspection's result from its defects
_SEVERITY_RANK = {
    DefectSeverity.LOW: 1,
    DefectSeverity.MEDIUM: 2,
    DefectSeverity.HIGH: 3,
    DefectSeverity.CRITICAL: 4,
}


def _compute_result(defects: list) -> InspectionResult:
    """Derive inspection result from its defects.

    No defects → PASSED.
    ≥ CRITICAL or ≥ 3 HIGH → FLAGGED.
    Otherwise → CONDITIONAL.
    """
    if not defects:
        return InspectionResult.PASSED
    max_sev = max(_SEVERITY_RANK[d.severity] for d in defects)
    critical_count = sum(1 for d in defects if d.severity == DefectSeverity.CRITICAL)
    high_count = sum(1 for d in defects if d.severity == DefectSeverity.HIGH)
    if critical_count >= 1 or high_count >= 3:
        return InspectionResult.FLAGGED
    if max_sev >= _SEVERITY_RANK[DefectSeverity.HIGH]:
        return InspectionResult.FLAGGED
    return InspectionResult.CONDITIONAL


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
    if insp.inspector_id:
        inspector = (
            await session.execute(
                select(User).where(User.id == insp.inspector_id)
            )
        ).scalar_one_or_none()

    defect_rows = (
        await session.execute(
            select(ReportedDefect).where(ReportedDefect.inspection_id == insp.id)
        )
    ).scalars().all()

    defect_items = [
        DefectResponse.from_defect(d, insp.id_str) for d in defect_rows
    ]

    return InspectionResponse(
        id=insp.id_str,
        vehicle_id=vehicle.id_str if vehicle else "",
        fleet_id=vehicle.fleet_id if vehicle else "",
        dsp_id=org.id_str if org else "",
        dsp=org.name if org else "",
        inspector=inspector.full_name if inspector else None,
        inspector_id=str(inspector.id) if inspector else None,
        status=insp.status,
        result=insp.result,
        odometer_miles=insp.odometer_miles,
        odometer_source=insp.odometer_source,
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
    date_from: date | None = Query(default=None, description="ISO date (inclusive)"),
    date_to: date | None = Query(default=None, description="ISO date (inclusive)"),
    result: InspectionResult | None = Query(default=None),
    status_: InspectionStatus | None = Query(
        default=InspectionStatus.SUBMITTED,
        alias="status",
        description="Default 'submitted' hides in-progress DRAFTs from review views. "
                    "Pass 'draft' to see a tech's in-progress inspections, or 'all' "
                    "(literal string) to include both.",
    ),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InspectionListResponse:
    stmt = select(Inspection)
    count_stmt = select(func.count()).select_from(Inspection)

    # Status filter (default: SUBMITTED only, hiding active drafts)
    if status_ is not None:
        stmt = stmt.where(Inspection.status == status_.value)
        count_stmt = count_stmt.where(Inspection.status == status_.value)

    # Role scoping
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

    # Batch fetch of join data (avoid N+1)
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

    # Count defects per inspection in one GROUP BY
    defect_count_rows = (
        await session.execute(
            select(ReportedDefect.inspection_id, func.count().label("n"))
            .where(ReportedDefect.inspection_id.in_(insp_ids))
            .group_by(ReportedDefect.inspection_id)
        )
    ).all()
    defect_count_by_insp = {r[0]: r[1] for r in defect_count_rows}

    items = []
    for i in inspections:
        v = veh_by_id.get(i.vehicle_id)
        o = org_by_id.get(i.dsp_id)
        ins = user_by_id.get(i.inspector_id) if i.inspector_id else None
        items.append(
            InspectionListItem(
                id=i.id_str,
                vehicle_id=v.id_str if v else "",
                fleet_id=v.fleet_id if v else "",
                dsp_id=o.id_str if o else "",
                dsp=o.name if o else "",
                inspector=ins.full_name if ins else None,
                status=i.status,
                result=i.result,
                odometer_miles=i.odometer_miles,
                submitted_at=i.submitted_at,
                created_at=i.created_at,
                defect_count=defect_count_by_insp.get(i.id, 0),
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

    # Who actually performs inspections, by role:
    #   - technician (mechanic/driver doing DVIC or post-repair QC)  ← primary actor
    #   - vendor_admin (supervising technicians)
    #   - dsp_owner (rare, only on their own org)
    #   - site_admin (anything, for test/override)
    # DSP owners primarily *review* inspections — they can still create for
    # their own vehicles but not for other DSPs.
    if current.role == UserRole.DSP_OWNER:
        if vehicle.dsp_id != current.organization_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "vehicle belongs to another DSP"
            )
    # All other authenticated roles (technician, vendor_admin, site_admin) allowed
    # for any DSP's vehicles. In real ops the vendor-DSP contract bounds who
    # services whom; we enforce that post-Jun 15.

    # Dual mode:
    # - Empty defects[] → DRAFT (tech is about to fill it incrementally with
    #   inline photos per defect via /inspections/{id}/defects).
    # - Non-empty defects[] → SUBMITTED atomically (bulk import, seed, etc.)
    now = utc_now()
    is_draft = not body.defects and body.result_override is None

    if is_draft:
        insp = Inspection(
            vehicle_id=vehicle.id,
            dsp_id=vehicle.dsp_id,
            inspector_id=current.id,
            status=InspectionStatus.DRAFT,
            result=InspectionResult.PASSED,  # placeholder, re-computed on submit
            odometer_miles=body.odometer_miles,
            odometer_source=body.odometer_source,
            notes=body.notes,
            incomplete_reason=body.incomplete_reason,
            started_at=now,
            submitted_at=None,  # not yet
        )
        session.add(insp)
        await session.commit()
        await session.refresh(insp)
        return await _build_inspection_response(session, insp)

    # SUBMITTED mode (atomic)
    computed = body.result_override or _compute_result(body.defects)
    if body.incomplete_reason:
        computed = InspectionResult.INCOMPLETE

    insp = Inspection(
        vehicle_id=vehicle.id,
        dsp_id=vehicle.dsp_id,
        inspector_id=current.id,
        status=InspectionStatus.SUBMITTED,
        result=computed,
        odometer_miles=body.odometer_miles,
        odometer_source=body.odometer_source,
        notes=body.notes,
        incomplete_reason=body.incomplete_reason,
        started_at=now,
        submitted_at=now,
    )
    session.add(insp)
    await session.flush()

    for d in body.defects:
        rd = ReportedDefect(
            inspection_id=insp.id,
            section=d.section,
            part=d.part,
            description=d.description,
            category=d.category,
            severity=d.severity,
        )
        session.add(rd)

    # Update vehicle's last-known mileage if new inspection reports higher value
    if body.odometer_miles is not None and body.odometer_miles > vehicle.mileage:
        vehicle.mileage = body.odometer_miles
        vehicle.updated_at = now
        session.add(vehicle)

    await session.commit()
    await session.refresh(insp)
    return await _build_inspection_response(session, insp)


# ─────────────────────────────────────────────────────
# Draft lifecycle — add/remove defects incrementally, then submit
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
    # Scope: inspector (creator) + dsp_owner of same DSP + site_admin.
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
    "/{inspection_id}/defects",
    response_model=DefectResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a defect to a DRAFT inspection (returns defect id for photo attach)",
)
async def add_defect_to_draft(
    body: DefectCreate,
    inspection_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectResponse:
    insp = await _load_draft_for_current(inspection_id, current, session)

    defect = ReportedDefect(
        inspection_id=insp.id,
        section=body.section,
        part=body.part,
        description=body.description,
        category=body.category,
        severity=body.severity,
    )
    session.add(defect)
    insp.updated_at = utc_now()
    session.add(insp)
    await session.commit()
    await session.refresh(defect)
    return DefectResponse.from_defect(defect, insp.id_str)


@router.delete(
    "/{inspection_id}/defects/{defect_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a defect from a DRAFT inspection",
)
async def remove_defect_from_draft(
    inspection_id: str = Path(...),
    defect_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    insp = await _load_draft_for_current(inspection_id, current, session)

    # Parse defect id
    raw = defect_id.strip().upper()
    if raw.startswith("FD-"):
        raw = raw[3:]
    try:
        did = int(raw)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid defect id") from None

    defect = (
        await session.execute(
            select(ReportedDefect)
            .where(ReportedDefect.id == did)
            .where(ReportedDefect.inspection_id == insp.id)
        )
    ).scalar_one_or_none()
    if defect is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "defect not found on this inspection")

    # Also delete attached photos (cascade via app logic — bucket objects too)
    photo_rows = (
        await session.execute(select(Photo).where(Photo.defect_id == defect.id))
    ).scalars().all()
    for p in photo_rows:
        if not p.is_deleted:
            delete_object(p.storage_key)
        await session.delete(p)

    await session.delete(defect)
    insp.updated_at = utc_now()
    session.add(insp)
    await session.commit()
    return None


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

    # Apply any late edits from the submit body
    if body.odometer_miles is not None:
        insp.odometer_miles = body.odometer_miles
    if body.odometer_source is not None:
        insp.odometer_source = body.odometer_source
    if body.notes is not None:
        insp.notes = body.notes
    if body.incomplete_reason is not None:
        insp.incomplete_reason = body.incomplete_reason

    # Re-compute result from current defects
    defects = (
        await session.execute(
            select(ReportedDefect).where(ReportedDefect.inspection_id == insp.id)
        )
    ).scalars().all()
    computed = body.result_override or _compute_result(defects)
    if insp.incomplete_reason:
        computed = InspectionResult.INCOMPLETE

    insp.result = computed
    insp.status = InspectionStatus.SUBMITTED
    now = utc_now()
    insp.submitted_at = now
    insp.updated_at = now
    session.add(insp)

    # Bump vehicle mileage if higher
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
    summary="Commit a photo attached to the inspection itself (odometer, overview, etc.)",
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

    # Photos can be added to DRAFT AND SUBMITTED inspections (e.g. vendor
    # uploads QC after-repair photos against a submitted inspection).
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
    summary="List photos directly attached to the inspection (odometer, overview)",
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
