"""Defect endpoints — v2 against the standalone `defects` table.

Mounted under `/defects/v2/*` to coexist with the legacy `/defects/*`
endpoints (which still read `reported_defects` for the live frontend). Once
the frontend cuts over and `python -m app.cli backfill-defects` has run in
prod, a follow-up PR collapses `/defects/v2` → `/defects` and deletes the
legacy code.

See the Notion 'Defect Data Schema' spec for the full contract.
"""
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlmodel import func, select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.base import utc_now
from app.models.defect import Defect, DefectSource
from app.models.inspection import Inspection
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.schemas.defect import (
    DefectV2Create,
    DefectV2ListResponse,
    DefectV2Response,
    DefectV2Update,
)
from app.services.defect_validation import (
    DefectValidationError,
    validate_defect_write,
)

router = APIRouter(prefix="/defects/v2", tags=["defects-v2"])


# ─────────────────────────────────────────────────────
# ID parsing helpers
# ─────────────────────────────────────────────────────
def _parse_defect_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("DEF-"):
        s = s[4:]
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid defect id: {raw!r}. Use int or 'DEF-XXXXXX'.",
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
# Endpoints
# ─────────────────────────────────────────────────────
@router.post(
    "",
    response_model=DefectV2Response,
    status_code=status.HTTP_201_CREATED,
    summary="Create one defect (vehicle-scoped, inspection optional)",
)
async def create_defect_v2(
    body: DefectV2Create,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectV2Response:
    # Local import to mirror the existing inter-route helper pattern.
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
    # vendor / technician / site_admin may file on any vehicle (vendors and
    # mechanics commonly raise defects on customer fleets they're servicing).
    if (
        current.role == UserRole.DSP_OWNER
        and vehicle.dsp_id != current.organization_id
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "vehicle is not in your fleet"
        )

    # Resolve inspection_id, if provided, and check it actually belongs to
    # the same vehicle (a defect on inspection X must also be on X.vehicle_id).
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

    # Spec validation (position, allow-list, details schema, source ↔ inspection)
    try:
        await validate_defect_write(
            session,
            part=body.part,
            position=body.position,
            defect_type=body.defect_type,
            details=body.details or {},
            source=body.source,
            inspection_id=inspection_pk,
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
        # Most likely cause: the unique index — exact dup of a defect already
        # filed for this (vehicle, inspection, part, position, defect_type).
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "defect already exists for this "
            "(vehicle, inspection, part, position, defect_type) tuple",
        ) from e
    await session.refresh(defect)

    org = (
        await session.execute(
            select(Organization).where(Organization.id == vehicle.dsp_id)
        )
    ).scalar_one_or_none()
    return DefectV2Response.from_defect(
        defect,
        vehicle=vehicle,
        inspection_id_str=(
            f"INS-{inspection_pk:05d}" if inspection_pk is not None else None
        ),
        reporter=current,
        org=org,
    )


@router.get("", response_model=DefectV2ListResponse)
async def list_defects_v2(
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

    # Filters
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
    items = [
        DefectV2Response.from_defect(
            d,
            vehicle=v,
            inspection_id_str=(
                f"INS-{d.inspection_id:05d}" if d.inspection_id is not None else None
            ),
            reporter=r,
            org=o,
        )
        for (d, v, o, r) in rows
    ]
    return DefectV2ListResponse(
        items=items, total=total, page=page, per_page=per_page
    )


@router.get("/{defect_id}", response_model=DefectV2Response)
async def get_defect_v2(
    defect_id: str = Path(..., description="DEF-XXXXXX or int"),
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
    return DefectV2Response.from_defect(
        defect,
        vehicle=vehicle,
        inspection_id_str=(
            f"INS-{defect.inspection_id:05d}"
            if defect.inspection_id is not None
            else None
        ),
        reporter=reporter,
        org=org,
    )


@router.patch("/{defect_id}", response_model=DefectV2Response)
async def update_defect_v2(
    body: DefectV2Update,
    defect_id: str = Path(..., description="DEF-XXXXXX or int"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectV2Response:
    """Patch the mutable fields on a defect: `notes`, `details`.

    `(part, position, defect_type)` is immutable post-create — fix
    misclassifications by deleting and re-creating. Workflow status is NOT
    here; that's a separate `defect_status` table (future).
    """
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

    # If details are being updated, re-validate against the current schema.
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
    return DefectV2Response.from_defect(
        defect,
        vehicle=vehicle,
        inspection_id_str=(
            f"INS-{defect.inspection_id:05d}"
            if defect.inspection_id is not None
            else None
        ),
        reporter=reporter,
        org=org,
    )
