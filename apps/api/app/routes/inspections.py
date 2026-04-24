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
    ReportedDefect,
)
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.schemas.inspection import (
    DefectResponse,
    InspectionCreate,
    InspectionListItem,
    InspectionListResponse,
    InspectionResponse,
)
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
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InspectionListResponse:
    stmt = select(Inspection)
    count_stmt = select(func.count()).select_from(Inspection)

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

    # Scoping: DSP owners can only inspect their own; site_admin can inspect any
    if current.role == UserRole.DSP_OWNER:
        if vehicle.dsp_id != current.organization_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "vehicle belongs to another DSP"
            )
    elif current.role not in (UserRole.SITE_ADMIN,):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "only dsp_owner or site_admin can create inspections"
        )

    # Compute result from defects (unless explicit override)
    computed = body.result_override or _compute_result(body.defects)
    if body.incomplete_reason:
        computed = InspectionResult.INCOMPLETE

    now = utc_now()
    insp = Inspection(
        vehicle_id=vehicle.id,
        dsp_id=vehicle.dsp_id,
        inspector_id=current.id,
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

    # Insert defects
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
