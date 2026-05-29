"""Vehicle endpoints — CRUD scoped by user role.

Scoping rules (MVP):
  - site_admin                  : sees/edits everything
  - dsp_owner                   : sees/edits only their own org's vehicles
  - vendor_admin / technician   : sees vehicles of ALL DSPs (read-only for MVP;
                                   later we lock to DSPs they have a contract with)

POST/PATCH/DELETE: only dsp_owner (for their org) and site_admin.
"""
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlmodel import func, or_, select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.base import utc_now
from app.models.defect import Defect, DefectSource
from app.models.inspection import Inspection
from app.models.organization import OrgType, Organization
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.models.vehicle_note import VehicleNote
from app.models.work_orders import (
    DefectResolution,
    DefectResolutionStatus,
    WorkOrder,
    WorkOrderRo,
    WorkOrderStatus,
)
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

    # Per-vehicle inspection rollup for the QC DVIC heatmap. Two batch
    # queries scoped to just this page's vehicle ids — these feed
    # `last_inspected` (drives the "Inspected today/week" filter) and
    # `defect_count` (drives the heatmap colour: Clean / 1-2 / 3+).
    # Before this the schema fields existed but from_vehicle never set
    # them, so the heatmap saw every van as never-inspected / 0 defects
    # and the "Inspected today" filter showed nothing (2026-05-29 bug:
    # vendor QC DVIC tab empty despite techs having inspected).
    vehicle_ids = [v.id for v in vehicles]
    last_inspected_by_vehicle: dict[int, datetime] = {}
    last_inspection_id_by_vehicle: dict[int, int] = {}
    defect_count_by_vehicle: dict[int, int] = {}
    last_ins_count_by_vehicle: dict[int, int] = {}
    if vehicle_ids:
        # Latest SUBMITTED inspection per vehicle (draft inspections don't
        # count — they're not real QC DVIC results yet). DISTINCT ON keeps
        # the most-recent row per vehicle so we get both its timestamp AND
        # its id (the id lets the heatmap open the real inspection report).
        insp_rows = (
            await session.execute(
                select(
                    Inspection.vehicle_id,
                    Inspection.id,
                    Inspection.submitted_at,
                )
                .where(Inspection.vehicle_id.in_(vehicle_ids))
                .where(Inspection.submitted_at.is_not(None))
                .order_by(
                    Inspection.vehicle_id,
                    Inspection.submitted_at.desc(),
                )
                .distinct(Inspection.vehicle_id)
            )
        ).all()
        last_inspected_by_vehicle = {vid: ts for vid, _iid, ts in insp_rows}
        last_inspection_id_by_vehicle = {vid: iid for vid, iid, _ts in insp_rows}

        # Open-defect count per vehicle — exclude defects whose
        # DefectResolution is terminal (resolved / deferred / declined),
        # same definition the DSP open-defects donut uses. This is what
        # colours the heatmap cell.
        terminal = (
            DefectResolutionStatus.RESOLVED.value,
            DefectResolutionStatus.DEFERRED.value,
            DefectResolutionStatus.DECLINED.value,
        )
        closed_sub = (
            select(DefectResolution.defect_id)
            .where(DefectResolution.status.in_(terminal))
        ).subquery()

        # Vendor-scope filter: a vendor should only count defects whose
        # DefectGroup maps to a repair_type their workshop services. Keeps
        # the heatmap badge consistent with the inspection-report filter
        # in routes/inspections.py — otherwise the badge says "4 defects"
        # but the report opens with 2 visible.
        from app.services.permissions import vendor_allowed_repair_types
        allowed_rts = await vendor_allowed_repair_types(session, current)

        if allowed_rts is None:
            # Non-vendor (DSP / site_admin): cheap SQL count, no JOIN.
            defect_rows = (
                await session.execute(
                    select(Defect.vehicle_id, func.count(Defect.id))
                    .where(Defect.vehicle_id.in_(vehicle_ids))
                    .where(~Defect.id.in_(select(closed_sub.c.defect_id)))
                    .group_by(Defect.vehicle_id)
                )
            ).all()
            defect_count_by_vehicle = {vid: int(n) for vid, n in defect_rows}
        else:
            # Vendor: invert _GROUP_TO_REPAIR_TYPE to get the DefectGroup
            # values whose repair_type is in the vendor's catalogue, then
            # JOIN catalog + applicability to filter.
            from app.services.wo_bundler import _GROUP_TO_REPAIR_TYPE
            from app.models.defect_catalog import DefectRule, DefectApplicability

            allowed_groups = {
                group for group, rt in _GROUP_TO_REPAIR_TYPE.items()
                if (rt.value if hasattr(rt, "value") else str(rt)) in allowed_rts
            }
            if allowed_groups:
                # COUNT(DISTINCT id) because DefectApplicability fans out
                # (one rule applies to multiple vehicle_classes).
                defect_rows = (
                    await session.execute(
                        select(Defect.vehicle_id, func.count(func.distinct(Defect.id)))
                        .join(Vehicle, Vehicle.id == Defect.vehicle_id)
                        .join(DefectRule, and_(
                            DefectRule.part == Defect.part,
                            DefectRule.defect_type == Defect.defect_type,
                        ))
                        .join(DefectApplicability, and_(
                            DefectApplicability.rule_id == DefectRule.id,
                            DefectApplicability.vehicle_class == Vehicle.vehicle_class,
                        ))
                        .where(Defect.vehicle_id.in_(vehicle_ids))
                        .where(~Defect.id.in_(select(closed_sub.c.defect_id)))
                        .where(DefectRule.group.in_(allowed_groups))
                        .group_by(Defect.vehicle_id)
                    )
                ).all()
                defect_count_by_vehicle = {vid: int(n) for vid, n in defect_rows}
            # else: vendor org has no workshop services configured → all
            #       counts stay at 0, consistent with "vendor sees nothing".

        # ─── Last-inspection-scoped defect count ─────────────────
        # Same filter as defect_count but constrained to defects belonging
        # to the vehicle's LATEST submitted inspection. This is what the QC
        # DVIC heatmap badge shows so the tile number matches the number of
        # defects rendered when the inspection report opens (otherwise the
        # badge counts off-inspection / ad-hoc defects the report doesn't
        # show — exactly the user-reported mismatch).
        if last_inspection_id_by_vehicle:
            ins_ids = list(last_inspection_id_by_vehicle.values())
            if allowed_rts is None:
                rows = (
                    await session.execute(
                        select(Defect.inspection_id, func.count(Defect.id))
                        .where(Defect.inspection_id.in_(ins_ids))
                        .where(~Defect.id.in_(select(closed_sub.c.defect_id)))
                        .group_by(Defect.inspection_id)
                    )
                ).all()
                count_by_ins = {iid: int(n) for iid, n in rows}
            elif allowed_groups:
                rows = (
                    await session.execute(
                        select(Defect.inspection_id, func.count(func.distinct(Defect.id)))
                        .join(Vehicle, Vehicle.id == Defect.vehicle_id)
                        .join(DefectRule, and_(
                            DefectRule.part == Defect.part,
                            DefectRule.defect_type == Defect.defect_type,
                        ))
                        .join(DefectApplicability, and_(
                            DefectApplicability.rule_id == DefectRule.id,
                            DefectApplicability.vehicle_class == Vehicle.vehicle_class,
                        ))
                        .where(Defect.inspection_id.in_(ins_ids))
                        .where(~Defect.id.in_(select(closed_sub.c.defect_id)))
                        .where(DefectRule.group.in_(allowed_groups))
                        .group_by(Defect.inspection_id)
                    )
                ).all()
                count_by_ins = {iid: int(n) for iid, n in rows}
            else:
                count_by_ins = {}
            for vid, iid in last_inspection_id_by_vehicle.items():
                last_ins_count_by_vehicle[vid] = count_by_ins.get(iid, 0)

    items = []
    for v in vehicles:
        resp = VehicleResponse.from_vehicle(v, org_by_id[v.dsp_id])
        ts = last_inspected_by_vehicle.get(v.id)
        resp.last_inspected = ts.isoformat() if ts else None
        iid = last_inspection_id_by_vehicle.get(v.id)
        resp.last_inspection_id = f"INS-{iid:05d}" if iid is not None else None
        resp.defect_count = defect_count_by_vehicle.get(v.id, 0)
        resp.last_inspection_defect_count = last_ins_count_by_vehicle.get(v.id, 0)
        items.append(resp)
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


# ═════════════════════════════════════════════════════
# Vehicle-scoped Service Writer notes (iter-1)
# ═════════════════════════════════════════════════════
#
# Persistent SW notes that survive across WOs. Surface in the van
# detail "SERVICE WRITER NOTES" panel. Example: "DSP usually drops
# keys at side door — Bay 4 lockbox 7741". The SW writes once, sees
# it on every future visit.
#
# Authorization: any user who can read the vehicle can read the
# notes; SW / vendor_admin / tech / site_admin can post. DSP-side
# users can post too (they sometimes leave guidance for the vendor).

_NOTE_POST_ROLES = (
    UserRole.SITE_ADMIN,
    UserRole.SERVICE_WRITER,
    UserRole.VENDOR_ADMIN,
    UserRole.TECHNICIAN,
    UserRole.DSP_OWNER,
    UserRole.DSP_MANAGER,
)


class VehicleNoteResponse(BaseModel):
    id: int
    vehicle_id: int
    body: str
    author_id: int | None = None
    author_name: str | None = None
    created_at: datetime


class VehicleNoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(..., min_length=1, max_length=2000)


def _ensure_vehicle_visible(vehicle: Vehicle, user: User) -> None:
    if user.role == UserRole.DSP_OWNER and vehicle.dsp_id != user.organization_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your vehicle")


@router.get(
    "/{vehicle_id}/notes",
    response_model=list[VehicleNoteResponse],
    summary="List persistent SW notes on a vehicle (newest first)",
)
async def list_vehicle_notes(
    vehicle_id: str = Path(..., description="Integer or VAN-XXXX"),
    limit: int = Query(default=50, ge=1, le=200),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[VehicleNoteResponse]:
    vid = _parse_vehicle_id(vehicle_id)
    veh = (await session.execute(select(Vehicle).where(Vehicle.id == vid))).scalar_one_or_none()
    if veh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    _ensure_vehicle_visible(veh, current)

    # JOIN to users so the UI can show the author's name without a
    # second round trip. LEFT join because legacy / system entries
    # may have author_id = NULL.
    rows = (
        await session.execute(
            select(VehicleNote, User)
            .outerjoin(User, User.id == VehicleNote.author_id)
            .where(VehicleNote.vehicle_id == vid)
            .order_by(VehicleNote.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        VehicleNoteResponse(
            id=n.id,
            vehicle_id=n.vehicle_id,
            body=n.body,
            author_id=n.author_id,
            author_name=u.full_name if u else None,
            created_at=n.created_at,
        )
        for n, u in rows
    ]


@router.delete(
    "/{vehicle_id}/notes/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a vehicle note (own author or site_admin only)",
)
async def delete_vehicle_note(
    vehicle_id: str = Path(...),
    note_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Jorge note #1: SW can delete their own notes. Site admin can
    delete anyone's. Everyone else (including the DSP if the note was
    DSP-authored — they delete their own) follows the same own-author
    rule. Author NULL (legacy / system) = only site_admin deletes.
    """
    vid = _parse_vehicle_id(vehicle_id)
    note = (
        await session.execute(
            select(VehicleNote)
            .where(VehicleNote.id == note_id)
            .where(VehicleNote.vehicle_id == vid)
        )
    ).scalar_one_or_none()
    if note is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "note not found")
    is_owner = note.author_id is not None and note.author_id == current.id
    if not is_owner and current.role != UserRole.SITE_ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "you can only delete your own notes (site_admin can delete any)",
        )
    await session.delete(note)
    await session.commit()
    return None


@router.post(
    "/{vehicle_id}/notes",
    response_model=VehicleNoteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Append a persistent SW note to a vehicle",
)
async def add_vehicle_note(
    body: VehicleNoteCreate,
    vehicle_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VehicleNoteResponse:
    if current.role not in _NOTE_POST_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "role cannot post vehicle notes")

    vid = _parse_vehicle_id(vehicle_id)
    veh = (await session.execute(select(Vehicle).where(Vehicle.id == vid))).scalar_one_or_none()
    if veh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    _ensure_vehicle_visible(veh, current)

    note = VehicleNote(
        vehicle_id=vid,
        body=body.body.strip(),
        author_id=current.id,
    )
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return VehicleNoteResponse(
        id=note.id,
        vehicle_id=note.vehicle_id,
        body=note.body,
        author_id=note.author_id,
        author_name=current.full_name,
        created_at=note.created_at,
    )


# ═════════════════════════════════════════════════════
# GET /vehicles/{id}/wo-summary — Van detail aggregate
# ═════════════════════════════════════════════════════
#
# Single fetch the new VanDetailView frontend uses. Pulls vehicle
# basics + KPI counts + active ROs (with nested defects) + service
# history + defect timeline. Replaces 4-5 separate calls the page
# would otherwise need.

class WoSummaryDefect(BaseModel):
    """Compact defect row for the van detail's defect timeline."""
    id: int
    id_str: str
    part: str | None = None
    type: str | None = None
    position: str | None = None
    source: str | None = None
    severity: str | None = None
    reported_at: datetime
    notes: str | None = None
    # Cost state — drives the SW Set-Cost panel + DSP approval modal.
    # billing_type is derived from defect_group (AMR for AMR/Netradyne,
    # CMR for everything else). estimated_cost + fmc_capped_at are set
    # by the SW; cost_decision is set by the DSP (or auto-approved).
    billing_type: str | None = None
    cost_decision: str | None = None
    estimated_cost: Decimal | None = None
    fmc_capped_at: Decimal | None = None
    review_decision: str | None = None   # latest defect_review.decision
    resolution_status: str | None = None  # any DR linked to this defect
    photo_count: int = 0


class WoSummaryRo(BaseModel):
    """One RO with its attached defects + state. Drives ACTIVE WORK / SERVICE HISTORY."""
    work_order_id: int
    work_order_id_str: str
    # The repair_request the WO is attached to. The SW UI uses this to
    # fire defer-defect / add-defect (both are scoped to the RR, not the WO).
    repair_request_id: int | None = None
    vendor_workshop_id: int | None = None
    vendor_workshop_org_id: int | None = None
    ro_number: str | None = None
    workshop_name: str | None = None
    repair_type: str | None = None
    wo_status: str
    is_primary: bool
    assigned_technician_name: str | None = None
    estimated_total: Decimal | None = None
    scheduled_start_at: datetime | None = None
    parts_ordered_at: datetime | None = None
    parts_received_at: datetime | None = None
    submitted_to_fmc_at: datetime | None = None
    fmc_approved_at: datetime | None = None
    pickup_type: str | None = None
    pickup_location: str | None = None
    key_location: str | None = None
    defects: list[WoSummaryDefect] = Field(default_factory=list)


class WoSummaryKpis(BaseModel):
    total_ros: int = 0
    active_ros: int = 0
    completed_ros: int = 0
    open_defects: int = 0
    active_estimate: Decimal | None = None
    last_service_at: datetime | None = None


class WoSummaryResponse(BaseModel):
    vehicle_id: int
    vehicle_id_str: str
    fleet_id: str
    plate: str
    year: int
    make: str
    model: str
    vin: str
    vehicle_class: str
    ownership: str
    fmc: str | None = None
    mileage: int | None = None
    dsp_id: int
    dsp_name: str | None = None
    kpis: WoSummaryKpis
    active_work: list[WoSummaryRo] = Field(default_factory=list)
    service_history: list[WoSummaryRo] = Field(default_factory=list)
    defect_timeline: list[WoSummaryDefect] = Field(default_factory=list)


_ACTIVE_WO_STATUSES = (
    WorkOrderStatus.PENDING_ACCEPTANCE.value,
    WorkOrderStatus.ACCEPTED.value,
    WorkOrderStatus.IN_PROGRESS.value,
)


async def _build_defect_row(
    session: AsyncSession,
    defect: Defect,
) -> WoSummaryDefect:
    """Resolve display fields + latest review + photo count for a defect.

    The Defect row carries `part` / `defect_type` / `position` directly
    as VARCHAR enum values (not FKs to a label table) — `defect_labels.py`
    has the human-readable translation if we ever want pretty strings,
    but for the timeline the enum value is fine.
    """
    from app.models.photo import Photo
    from app.models.work_orders import DefectReview

    review = (
        await session.execute(
            select(DefectReview)
            .where(DefectReview.defect_id == defect.id)
            .order_by(DefectReview.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    dr = (
        await session.execute(
            select(DefectResolution)
            .where(DefectResolution.defect_id == defect.id)
            .order_by(DefectResolution.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    photo_count = (
        await session.execute(
            select(func.count(Photo.id)).where(Photo.defect_id == defect.id)
        )
    ).scalar() or 0

    # Derive billing_type (AMR/CMR) via the same helper the cost endpoint
    # uses — keeps a single rule for who pays. Falls back to None if the
    # vehicle was deleted (shouldn't happen but defensive).
    billing_type_value: str | None = None
    try:
        from app.services.wo_defect_costs import derive_billing_type
        from app.services.wo_defect_reviews import _resolve_defect_group
        veh = (await session.execute(select(Vehicle).where(Vehicle.id == defect.vehicle_id))).scalar_one_or_none()
        if veh is not None:
            group = await _resolve_defect_group(session, defect, veh.vehicle_class)
            billing_type_value = derive_billing_type(group)
    except Exception:  # noqa: BLE001
        billing_type_value = None

    return WoSummaryDefect(
        id=defect.id,
        id_str=f"FD-{defect.id:03d}",
        part=defect.part,
        type=defect.defect_type,
        position=defect.position,
        source=(defect.source.value if hasattr(defect.source, "value") else str(defect.source)) if defect.source else None,
        severity=getattr(defect, "severity", None),
        reported_at=defect.reported_at,
        notes=getattr(defect, "notes", None),
        billing_type=billing_type_value,
        cost_decision=defect.cost_decision,
        estimated_cost=defect.estimated_cost,
        fmc_capped_at=defect.fmc_capped_at,
        review_decision=(review.decision.value if review and hasattr(review.decision, "value") else (review.decision if review else None)),
        resolution_status=(dr.status.value if dr and hasattr(dr.status, "value") else (dr.status if dr else None)),
        photo_count=int(photo_count),
    )


@router.get(
    "/{vehicle_id}/wo-summary",
    response_model=WoSummaryResponse,
    summary="Aggregated van detail — vehicle + ROs + defects timeline",
)
async def vehicle_wo_summary(
    vehicle_id: str = Path(..., description="Integer or VAN-XXXX"),
    history_limit: int = Query(default=10, ge=1, le=100),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WoSummaryResponse:
    from app.models.work_orders import VendorWorkshop

    vid = _parse_vehicle_id(vehicle_id)
    veh = (await session.execute(select(Vehicle).where(Vehicle.id == vid))).scalar_one_or_none()
    if veh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    _ensure_vehicle_visible(veh, current)

    dsp_org = (
        await session.execute(select(Organization).where(Organization.id == veh.dsp_id))
    ).scalar_one_or_none()

    # All WOs for this vehicle, newest first.
    wos = list(
        (
            await session.execute(
                select(WorkOrder)
                .where(WorkOrder.vehicle_id == vid)
                .order_by(WorkOrder.created_at.desc())
            )
        ).scalars().all()
    )

    # KPIs: counts derived from the WOs we just pulled.
    total_ros = len(wos)
    active_ros = sum(1 for w in wos if w.status in _ACTIVE_WO_STATUSES)
    completed_ros = sum(1 for w in wos if w.status == WorkOrderStatus.COMPLETED.value)

    # Bundle each WO with its primary RO + display fields.
    workshop_cache: dict[int, tuple[str, int | None]] = {}
    tech_cache: dict[int, str] = {}

    async def _resolve_ws(ws_id: int) -> str | None:
        if ws_id in workshop_cache:
            return workshop_cache[ws_id][0]
        w = (await session.execute(select(VendorWorkshop).where(VendorWorkshop.id == ws_id))).scalar_one_or_none()
        if w is None:
            return None
        workshop_cache[ws_id] = (w.name, w.organization_id)
        return w.name

    def _resolve_ws_org(ws_id: int) -> int | None:
        return workshop_cache.get(ws_id, (None, None))[1]

    async def _resolve_tech(tech_id: int | None) -> str | None:
        if tech_id is None:
            return None
        if tech_id in tech_cache:
            return tech_cache[tech_id]
        t = (await session.execute(select(User).where(User.id == tech_id))).scalar_one_or_none()
        if t is None:
            return None
        tech_cache[tech_id] = t.full_name
        return t.full_name

    async def _build_ro(wo: WorkOrder) -> WoSummaryRo:
        ro = (
            await session.execute(
                select(WorkOrderRo)
                .where(WorkOrderRo.work_order_id == wo.id)
                .where(WorkOrderRo.is_primary.is_(True))
                .limit(1)
            )
        ).scalar_one_or_none()

        # Defects linked to this WO via WO → RR → repair_request_defects → defect.
        from app.models.work_orders import RepairRequestDefect
        defect_rows = list(
            (
                await session.execute(
                    select(Defect)
                    .join(RepairRequestDefect, RepairRequestDefect.defect_id == Defect.id)
                    .where(RepairRequestDefect.repair_request_id == wo.repair_request_id)
                    .order_by(Defect.reported_at.asc())
                )
            ).scalars().all()
        )
        defect_summaries = [await _build_defect_row(session, d) for d in defect_rows]
        est = sum((d.estimated_cost or Decimal(0)) for d in defect_rows) or None
        workshop_name = await _resolve_ws(wo.vendor_workshop_id)
        return WoSummaryRo(
            work_order_id=wo.id,
            work_order_id_str=wo.id_str,
            repair_request_id=wo.repair_request_id,
            vendor_workshop_id=wo.vendor_workshop_id,
            vendor_workshop_org_id=_resolve_ws_org(wo.vendor_workshop_id),
            ro_number=ro.ro_number if ro else None,
            workshop_name=workshop_name,
            repair_type=None,  # we'd need RR for this; defer to client-side derivation
            wo_status=wo.status.value if hasattr(wo.status, "value") else str(wo.status),
            is_primary=bool(ro and ro.is_primary),
            assigned_technician_name=await _resolve_tech(wo.assigned_technician_id),
            estimated_total=est,
            scheduled_start_at=ro.scheduled_start_at if ro else None,
            parts_ordered_at=ro.parts_ordered_at if ro else None,
            parts_received_at=ro.parts_received_at if ro else None,
            submitted_to_fmc_at=ro.submitted_to_fmc_at if ro else None,
            fmc_approved_at=ro.fmc_approved_at if ro else None,
            pickup_type=ro.pickup_type if ro else None,
            pickup_location=ro.pickup_location if ro else None,
            key_location=ro.key_location if ro else None,
            defects=defect_summaries,
        )

    active_work_rows: list[WoSummaryRo] = []
    service_history_rows: list[WoSummaryRo] = []
    for wo in wos:
        ro_row = await _build_ro(wo)
        if wo.status in _ACTIVE_WO_STATUSES:
            active_work_rows.append(ro_row)
        else:
            service_history_rows.append(ro_row)
    service_history_rows = service_history_rows[:history_limit]

    # Active estimate = sum of estimated_cost on defects belonging to
    # active WOs (defect cost-decision still pending counts in too).
    active_estimate_total: Decimal | None = None
    for row in active_work_rows:
        if row.estimated_total is not None:
            active_estimate_total = (active_estimate_total or Decimal(0)) + row.estimated_total

    # Open defects across the vehicle (any defect whose latest DR is not
    # DONE / DEFERRED / DECLINED, OR has no DR at all). Cheap because we
    # already pulled all defect ids via active_work + service_history.
    open_defect_count = 0
    all_defect_ids: set[int] = set()
    for row in active_work_rows + service_history_rows:
        for d in row.defects:
            all_defect_ids.add(d.id)
    if all_defect_ids:
        # Inspect DR per defect — small list, do it client-style.
        for did in all_defect_ids:
            latest_dr = (
                await session.execute(
                    select(DefectResolution)
                    .where(DefectResolution.defect_id == did)
                    .order_by(DefectResolution.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            terminal = (
                DefectResolutionStatus.RESOLVED.value,
                DefectResolutionStatus.DEFERRED.value,
                DefectResolutionStatus.DECLINED.value,
            )
            if latest_dr is None or (
                (latest_dr.status.value if hasattr(latest_dr.status, "value") else str(latest_dr.status))
                not in terminal
            ):
                open_defect_count += 1

    # Last service at = most recent WO completed_at across the vehicle.
    last_service_at = None
    for w in wos:
        if w.status == WorkOrderStatus.COMPLETED.value and w.completed_at:
            if last_service_at is None or w.completed_at > last_service_at:
                last_service_at = w.completed_at

    # Defect timeline — all defects ever recorded for this vehicle (the
    # Defect table is vehicle-scoped already), newest first.
    timeline_defects = list(
        (
            await session.execute(
                select(Defect)
                .where(Defect.vehicle_id == vid)
                .order_by(Defect.reported_at.desc())
                .limit(50)
            )
        ).scalars().all()
    )
    timeline = [await _build_defect_row(session, d) for d in timeline_defects]

    return WoSummaryResponse(
        vehicle_id=veh.id,
        vehicle_id_str=veh.id_str,
        fleet_id=veh.fleet_id,
        plate=veh.plate,
        year=veh.year,
        make=veh.make,
        model=veh.model,
        vin=veh.vin,
        vehicle_class=(veh.vehicle_class.value if hasattr(veh.vehicle_class, "value") else str(veh.vehicle_class)),
        ownership=(veh.ownership.value if hasattr(veh.ownership, "value") else str(veh.ownership)),
        fmc=veh.fmc,
        mileage=veh.mileage,
        dsp_id=veh.dsp_id,
        dsp_name=dsp_org.name if dsp_org else None,
        kpis=WoSummaryKpis(
            total_ros=total_ros,
            active_ros=active_ros,
            completed_ros=completed_ros,
            open_defects=open_defect_count,
            active_estimate=active_estimate_total,
            last_service_at=last_service_at,
        ),
        active_work=active_work_rows,
        service_history=service_history_rows,
        defect_timeline=timeline,
    )
