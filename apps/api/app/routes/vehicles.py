"""Vehicle endpoints — CRUD scoped by user role.

Scoping rules (MVP):
  - site_admin                  : sees/edits everything
  - dsp_owner                   : sees/edits only their own org's vehicles
  - vendor_admin / technician   : sees vehicles of ALL DSPs (read-only for MVP;
                                   later we lock to DSPs they have a contract with)

POST/PATCH/DELETE: only dsp_owner (for their org) and site_admin.
"""
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlmodel import func, or_, select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.base import utc_now
from app.models.organization import OrgType, Organization
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.schemas.vehicle import (
    BulkUpsertRequest,
    BulkUpsertResponse,
    BulkUpsertResult,
    VehicleCreate,
    VehicleListResponse,
    VehicleResponse,
    VehicleUpdate,
)

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


# ─────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────
async def _get_org(session: AsyncSession, org_id: int) -> Organization:
    org = (
        await session.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "organization not found")
    return org


def _parse_vehicle_id(raw: str) -> int:
    """Accept either an integer ('42') or VAN-XXXX format ('VAN-0042')."""
    s = raw.strip().upper()
    if s.startswith("VAN-"):
        s = s[4:]
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid vehicle id: {raw!r}. Use integer or 'VAN-XXXX'.",
        ) from None


def _can_manage_org(user: User, dsp_id: int) -> bool:
    """True if user can create/modify vehicles of the given DSP."""
    if user.role == UserRole.SITE_ADMIN:
        return True
    if user.role == UserRole.DSP_OWNER and user.organization_id == dsp_id:
        return True
    return False


# ─────────────────────────────────────────────────────
# GET /vehicles
# ─────────────────────────────────────────────────────
@router.get("", response_model=VehicleListResponse)
async def list_vehicles(
    dsp_id: int | None = Query(default=None, description="Filter by DSP int id"),
    search: str | None = Query(default=None, description="Matches fleet_id / vin / plate"),
    grounded: bool | None = Query(default=None),
    is_active: bool = Query(default=True),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VehicleListResponse:
    # Role-based scoping
    stmt = select(Vehicle)
    count_stmt = select(func.count()).select_from(Vehicle)

    if current.role == UserRole.DSP_OWNER:
        # DSP owners only see their own org's vehicles (override any dsp_id param).
        stmt = stmt.where(Vehicle.dsp_id == current.organization_id)
        count_stmt = count_stmt.where(Vehicle.dsp_id == current.organization_id)
    elif dsp_id is not None:
        stmt = stmt.where(Vehicle.dsp_id == dsp_id)
        count_stmt = count_stmt.where(Vehicle.dsp_id == dsp_id)

    # Filters
    if is_active is not None:
        stmt = stmt.where(Vehicle.is_active == is_active)
        count_stmt = count_stmt.where(Vehicle.is_active == is_active)
    if grounded is not None:
        stmt = stmt.where(Vehicle.grounded == grounded)
        count_stmt = count_stmt.where(Vehicle.grounded == grounded)
    if search:
        like = f"%{search.strip()}%"
        pred = or_(
            Vehicle.fleet_id.ilike(like),
            Vehicle.vin.ilike(like),
            Vehicle.plate.ilike(like),
        )
        stmt = stmt.where(pred)
        count_stmt = count_stmt.where(pred)

    # Order: fleet_id asc (typical display). Could be customizable later.
    stmt = stmt.order_by(Vehicle.fleet_id).offset((page - 1) * per_page).limit(per_page)

    total = (await session.execute(count_stmt)).scalar_one()
    vehicles = (await session.execute(stmt)).scalars().all()

    if not vehicles:
        return VehicleListResponse(items=[], total=total, page=page, per_page=per_page)

    # Fetch all orgs in one shot — avoid N+1
    dsp_ids = {v.dsp_id for v in vehicles}
    orgs_rows = (
        await session.execute(select(Organization).where(Organization.id.in_(dsp_ids)))
    ).scalars().all()
    org_by_id = {o.id: o for o in orgs_rows}

    items = [VehicleResponse.from_vehicle(v, org_by_id[v.dsp_id]) for v in vehicles]
    return VehicleListResponse(items=items, total=total, page=page, per_page=per_page)


# ─────────────────────────────────────────────────────
# GET /vehicles/{id}
# ─────────────────────────────────────────────────────
@router.get("/{vehicle_id}", response_model=VehicleResponse)
async def get_vehicle(
    vehicle_id: str = Path(..., description="Integer id or VAN-XXXX format"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VehicleResponse:
    vid = _parse_vehicle_id(vehicle_id)
    v = (
        await session.execute(select(Vehicle).where(Vehicle.id == vid))
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")

    # DSP owners can only read their own
    if current.role == UserRole.DSP_OWNER and v.dsp_id != current.organization_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your vehicle")

    org = await _get_org(session, v.dsp_id)
    return VehicleResponse.from_vehicle(v, org)


# ─────────────────────────────────────────────────────
# POST /vehicles
# ─────────────────────────────────────────────────────
@router.post("", response_model=VehicleResponse, status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    body: VehicleCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VehicleResponse:
    # Resolve dsp_id
    if body.dsp_id is None:
        if current.role != UserRole.DSP_OWNER:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "dsp_id is required for non-DSP-owner callers",
            )
        dsp_id = current.organization_id
    else:
        dsp_id = body.dsp_id

    if not _can_manage_org(current, dsp_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot create vehicles for that DSP")

    org = await _get_org(session, dsp_id)
    if org.org_type != OrgType.DSP:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"organization {org.name!r} is not a DSP (is {org.org_type.value})",
        )

    vehicle = Vehicle(
        dsp_id=dsp_id,
        fleet_id=body.fleet_id,
        vin=body.vin.upper(),
        plate=body.plate,
        year=body.year,
        make=body.make,
        model=body.model,
        mileage=body.mileage,
        vehicle_class=body.vehicle_class,
        ownership=body.ownership,
        fmc=body.fmc,
    )
    session.add(vehicle)
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        # VIN unique violation
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "a vehicle with this VIN already exists",
        ) from e
    await session.refresh(vehicle)
    return VehicleResponse.from_vehicle(vehicle, org)


# ─────────────────────────────────────────────────────
# PATCH /vehicles/{id}
# ─────────────────────────────────────────────────────
@router.patch("/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle(
    body: VehicleUpdate,
    vehicle_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VehicleResponse:
    vid = _parse_vehicle_id(vehicle_id)
    v = (await session.execute(select(Vehicle).where(Vehicle.id == vid))).scalar_one_or_none()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    if not _can_manage_org(current, v.dsp_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot modify vehicles of that DSP")

    # Track grounded transition (timestamp + reason)
    updates = body.model_dump(exclude_unset=True)
    if "grounded" in updates:
        new_grounded = updates["grounded"]
        if new_grounded and not v.grounded:
            v.grounded_at = utc_now()
        elif not new_grounded and v.grounded:
            v.grounded_at = None
            if "grounded_reason" not in updates:
                updates["grounded_reason"] = None

    for field, value in updates.items():
        setattr(v, field, value)
    v.updated_at = utc_now()
    session.add(v)
    await session.commit()
    await session.refresh(v)

    org = await _get_org(session, v.dsp_id)
    return VehicleResponse.from_vehicle(v, org)


# ─────────────────────────────────────────────────────
# POST /vehicles/bulk-upsert — Amazon Logistics Fleet Data sync
# ─────────────────────────────────────────────────────
@router.post(
    "/bulk-upsert",
    response_model=BulkUpsertResponse,
    summary="Sync a parsed Amazon Logistics Fleet Data spreadsheet",
)
async def bulk_upsert_vehicles(
    body: BulkUpsertRequest,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BulkUpsertResponse:
    """Upsert a batch of vehicle rows by VIN (the only globally unique key).

    The frontend handles XLSX parsing + Amazon column mapping. This endpoint
    receives an array of rows already mapped to NF fields. Each row is
    upserted independently so a failure on one VIN doesn't abort the batch.

    deactivate_missing=True will soft-delete (is_active=False) any vehicle in
    the resolved DSP whose VIN is NOT in the uploaded set. Off by default —
    the frontend should require explicit confirmation before sending it true.
    """
    # Resolve dsp_id (same logic as POST /vehicles)
    if body.dsp_id is None:
        if current.role != UserRole.DSP_OWNER:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "dsp_id is required for non-DSP-owner callers",
            )
        dsp_id = current.organization_id
    else:
        dsp_id = body.dsp_id

    if not _can_manage_org(current, dsp_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "cannot bulk-upsert vehicles for that DSP",
        )

    org = await _get_org(session, dsp_id)
    if org.org_type != OrgType.DSP:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"organization {org.name!r} is not a DSP (is {org.org_type.value})",
        )

    # Pre-load existing vehicles for this DSP, keyed by VIN, to decide
    # create-vs-update without N+1 queries.
    existing = (
        await session.execute(select(Vehicle).where(Vehicle.dsp_id == dsp_id))
    ).scalars().all()
    by_vin: dict[str, Vehicle] = {v.vin: v for v in existing}
    incoming_vins: set[str] = set()

    results: list[BulkUpsertResult] = []
    summary = {
        "created": 0, "updated": 0, "skipped": 0,
        "deactivated": 0, "error": 0,
    }

    for row in body.rows:
        vin_upper = row.vin.upper()
        incoming_vins.add(vin_upper)

        # VIN collisions across DSPs — let the IntegrityError speak. Inside
        # this DSP we already have it indexed.
        v = by_vin.get(vin_upper)
        try:
            if v is None:
                v = Vehicle(
                    dsp_id=dsp_id,
                    fleet_id=row.fleet_id,
                    vin=vin_upper,
                    plate=row.plate,
                    year=row.year,
                    make=row.make,
                    model=row.model,
                    mileage=row.mileage,
                    vehicle_class=row.vehicle_class,
                    ownership=row.ownership,
                    fmc=row.fmc,
                )
                session.add(v)
                await session.flush()
                results.append(BulkUpsertResult(
                    fleet_id=row.fleet_id, vin=vin_upper,
                    action="created", vehicle_id=v.id_str,
                ))
                summary["created"] += 1
            else:
                # Track whether anything actually changed; if not, count as skipped.
                changed = False
                for field, value in (
                    ("fleet_id", row.fleet_id),
                    ("plate", row.plate),
                    ("year", row.year),
                    ("make", row.make),
                    ("model", row.model),
                    ("mileage", row.mileage),
                    ("vehicle_class", row.vehicle_class),
                    ("ownership", row.ownership),
                    ("fmc", row.fmc),
                ):
                    if getattr(v, field) != value:
                        setattr(v, field, value)
                        changed = True
                # Reactivate previously-deactivated rows so re-uploading
                # restores them
                if not v.is_active:
                    v.is_active = True
                    changed = True
                if changed:
                    v.updated_at = utc_now()
                    session.add(v)
                    results.append(BulkUpsertResult(
                        fleet_id=row.fleet_id, vin=vin_upper,
                        action="updated", vehicle_id=v.id_str,
                    ))
                    summary["updated"] += 1
                else:
                    results.append(BulkUpsertResult(
                        fleet_id=row.fleet_id, vin=vin_upper,
                        action="skipped", vehicle_id=v.id_str,
                    ))
                    summary["skipped"] += 1
        except IntegrityError as e:
            await session.rollback()
            results.append(BulkUpsertResult(
                fleet_id=row.fleet_id, vin=vin_upper,
                action="error", error=f"integrity error: {e.orig}",
            ))
            summary["error"] += 1
            # IntegrityError aborts the surrounding transaction; we have to
            # restart cleanly. Reload existing so subsequent rows behave.
            existing = (
                await session.execute(
                    select(Vehicle).where(Vehicle.dsp_id == dsp_id)
                )
            ).scalars().all()
            by_vin = {v.vin: v for v in existing}

    # Deactivation pass — only if explicitly requested AND we have a clean session
    if body.deactivate_missing:
        for v in list(by_vin.values()):
            if v.vin in incoming_vins or not v.is_active:
                continue
            v.is_active = False
            v.updated_at = utc_now()
            session.add(v)
            results.append(BulkUpsertResult(
                fleet_id=v.fleet_id, vin=v.vin,
                action="deactivated", vehicle_id=v.id_str,
            ))
            summary["deactivated"] += 1

    await session.commit()
    return BulkUpsertResponse(results=results, summary=summary)
