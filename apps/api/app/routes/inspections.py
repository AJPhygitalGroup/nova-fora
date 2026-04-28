"""Inspection endpoints — list / detail / create (one-shot submit)."""
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import func, select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.base import utc_now
from app.models.defect_catalog import DefectPart, DefectPosition, DefectType
from app.models.inspection import (
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
from app.services.defect_catalog import (
    CatalogValidationError,
    validate_v2_defect,
)
from app.storage.s3 import delete_object, generate_download_url
from app.routes.vehicles import _parse_vehicle_id  # reuse the VAN-XXXX parser


# ─────────────────────────────────────────────────────
# v2 defect helpers — used by both atomic POST /inspections and
# incremental POST /inspections/{id}/defects.
# ─────────────────────────────────────────────────────
async def _create_defect_row(
    session: AsyncSession,
    inspection_id: int,
    body: DefectCreate,
    inspector_id: int,
) -> ReportedDefect:
    """Creates a ReportedDefect row from either v2 catalog data or legacy
    free-text fields. Validates v2 inputs against the catalog before insert.

    Raises CatalogValidationError on v2 validation failures (caller maps to 400).
    """
    now = utc_now()
    if body.is_v2():
        # Parse enums (Pydantic gave us strings since the schema accepts str)
        try:
            part_enum = DefectPart(body.part_v2)
            type_enum = DefectType(body.defect_type_v2)
        except ValueError as e:
            raise CatalogValidationError(str(e)) from e
        pos_enum: DefectPosition | None = None
        if body.position:
            try:
                pos_enum = DefectPosition(body.position)
            except ValueError as e:
                raise CatalogValidationError(f"unknown position: {body.position}") from e

        await validate_v2_defect(
            session, part_enum, pos_enum, type_enum, body.details
        )

        rd = ReportedDefect(
            inspection_id=inspection_id,
            # Legacy mirror columns (kept populated for backward compat lists)
            section=_section_from_part(part_enum),
            part=part_enum.value,
            description=(
                body.notes
                or _human_summary(part_enum, pos_enum, type_enum, body.details)
            ),
            category=None,
            # v2 columns (canonical)
            part_enum=part_enum.value,
            position=pos_enum.value if pos_enum else None,
            defect_type_enum=type_enum.value,
            details=body.details or {},
            notes=body.notes,
            reported_by_id=inspector_id,
            reported_at=now,
        )
        return rd

    # ── Legacy path ──
    if not (body.part and body.description):
        raise CatalogValidationError(
            "must provide either v2 fields (part_v2 + defect_type_v2) or "
            "legacy fields (section + part + description)"
        )
    return ReportedDefect(
        inspection_id=inspection_id,
        section=body.section or "Other",
        part=body.part,
        description=body.description,
        category=body.category,
        # No v2 fields populated → row is legacy
        reported_by_id=inspector_id,
        reported_at=now,
    )


# Map a part to a generic "section" label for the legacy column. Best-effort
# only — the v2 catalog is the source of truth, this is just for backward-
# compat list views that still read 'section'.
_SECTION_BY_PART_PREFIX: dict[str, str] = {
    "tire": "7. Tires", "rim": "7. Tires", "wheel_nut": "7. Tires", "mounting_equipment": "7. Tires",
    "headlight": "1. Front Side", "windshield": "1. Front Side", "wiper_blade": "1. Front Side",
    "tail_light": "4. Rear", "rear_camera": "4. Rear", "rear_cargo_door": "4. Rear",
    "side_mirror": "2. Driver Side", "side_panel": "2. Driver Side",
    "seatbelt": "5. In-Cab", "driver_seat": "5. In-Cab", "steering_wheel": "5. In-Cab",
    "service_brake": "6. Brakes", "parking_brake": "6. Brakes",
    "license_plate": "11. Other", "inspection_sticker": "11. Other", "registration_sticker": "11. Other",
}


def _section_from_part(part: DefectPart) -> str:
    return _SECTION_BY_PART_PREFIX.get(part.value, "11. Other")


def _human_summary(
    part: DefectPart,
    position: DefectPosition | None,
    defect_type: DefectType,
    details: dict,
) -> str:
    """Generate a 1-line human description for legacy `description` column."""
    pos_str = f" {position.value.replace('_', ' ')}" if position else ""
    base = f"{part.value.replace('_', ' ')}{pos_str} — {defect_type.value.replace('_', ' ')}"
    if "tread_depth_32nds" in details:
        base += f" ({details['tread_depth_32nds']}/32)"
    if details.get("in_drivers_line_of_sight"):
        base += " (in driver's line of sight)"
    if "lamp_type" in details:
        lamps = ", ".join(details["lamp_type"])
        base += f" — {lamps}"
    return base.strip()

router = APIRouter(prefix="/inspections", tags=["inspections"])


def _compute_result(defects: list) -> InspectionResult:
    """Derive inspection result from its defects.

    No defects → PASSED.
    Any defects → FLAGGED.

    The previous severity-based 3-state ladder (PASSED / FLAGGED / CONDITIONAL)
    was simplified to binary after severity was removed from the model.
    INCOMPLETE remains a separate state set explicitly when the inspector
    bails before finishing (incomplete_reason populated).
    """
    if not defects:
        return InspectionResult.PASSED
    return InspectionResult.FLAGGED


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
    """Full detail with defects + joined vehicle/org/inspector + vendor org."""
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

    # Vendor orgs (each inspector belongs to one org — could be vendor or DSP)
    vendor_org_ids = {u.organization_id for u in inspector_rows if u.organization_id}
    vendor_orgs_rows = []
    if vendor_org_ids:
        vendor_orgs_rows = (
            await session.execute(select(Organization).where(Organization.id.in_(vendor_org_ids)))
        ).scalars().all()
    vendor_org_by_id = {o.id: o for o in vendor_orgs_rows}

    # Count defects per inspection grouped by status in a single query.
    # Buckets: pending / approved (ack + forwarded) / rejected (dismissed).
    defect_breakdown_rows = (
        await session.execute(
            select(
                ReportedDefect.inspection_id,
                ReportedDefect.status,
                func.count().label("n"),
            )
            .where(ReportedDefect.inspection_id.in_(insp_ids))
            .group_by(ReportedDefect.inspection_id, ReportedDefect.status)
        )
    ).all()
    APPROVED_STATUSES = {
        "acknowledged",
        "sent_to_vendor",
        "scheduled",
        "converted_to_wo",
    }
    defect_breakdown: dict[int, dict[str, int]] = {}
    for insp_id, status_str, n in defect_breakdown_rows:
        bucket = defect_breakdown.setdefault(
            insp_id, {"pending": 0, "approved": 0, "rejected": 0}
        )
        if status_str == "pending":
            bucket["pending"] += n
        elif status_str == "dismissed":
            bucket["rejected"] += n
        elif status_str in APPROVED_STATUSES:
            bucket["approved"] += n
    # Total per inspection
    defect_count_by_insp = {
        k: sum(v.values()) for k, v in defect_breakdown.items()
    }

    items = []
    for i in inspections:
        v = veh_by_id.get(i.vehicle_id)
        o = org_by_id.get(i.dsp_id)
        ins = user_by_id.get(i.inspector_id) if i.inspector_id else None
        vendor_org = vendor_org_by_id.get(ins.organization_id) if ins else None
        breakdown = defect_breakdown.get(
            i.id, {"pending": 0, "approved": 0, "rejected": 0}
        )
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
                defect_count=defect_count_by_insp.get(i.id, 0),
                defect_count_pending=breakdown["pending"],
                defect_count_approved=breakdown["approved"],
                defect_count_rejected=breakdown["rejected"],
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

    # Tri mode:
    # - Empty defects[] AND no result_override AND no incomplete_reason → DRAFT
    #   (tech is about to fill it incrementally with inline photos via the wizard).
    # - incomplete_reason set (vehicle won't start / not at lot / no keys) →
    #   SUBMITTED atomically with result=INCOMPLETE (skip-with-reason flow).
    # - Non-empty defects[] OR result_override → SUBMITTED atomically (seed,
    #   bulk import, atomic API consumers).
    now = utc_now()
    is_draft = (
        not body.defects
        and body.result_override is None
        and not body.incomplete_reason
    )

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
        keys_received=body.keys_received,
        notes=body.notes,
        incomplete_reason=body.incomplete_reason,
        started_at=now,
        submitted_at=now,
    )
    session.add(insp)
    await session.flush()

    # Defects: each goes through v2 validation if v2 fields are provided.
    for d in body.defects:
        try:
            rd = await _create_defect_row(session, insp.id, d, current.id)
        except CatalogValidationError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
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

    try:
        defect = await _create_defect_row(session, insp.id, body, current.id)
    except CatalogValidationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
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
