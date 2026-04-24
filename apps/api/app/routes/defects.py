"""Defect endpoints — flat view across inspections.

The Defects.jsx component on the frontend shows all defects a DSP cares
about, flattened. This endpoint serves that view efficiently via JOINs
rather than N+1 per-inspection lookups.

PATCH /defects/{id} updates the workflow status (ack, dismiss, etc.).
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
    DefectSeverity,
    DefectStatus,
    Inspection,
    ReportedDefect,
)
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.schemas.inspection import (
    DefectListResponse,
    DefectResponse,
    DefectStatusUpdate,
)

router = APIRouter(prefix="/defects", tags=["defects"])


@router.get("", response_model=DefectListResponse)
async def list_defects(
    dsp_id: int | None = Query(default=None),
    status_: DefectStatus | None = Query(default=None, alias="status"),
    severity: DefectSeverity | None = Query(default=None),
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
    if severity is not None:
        base_query = base_query.where(ReportedDefect.severity == severity.value)
        count_query = count_query.where(ReportedDefect.severity == severity.value)

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
