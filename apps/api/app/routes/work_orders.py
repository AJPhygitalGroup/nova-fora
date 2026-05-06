"""Work Order endpoints — create / list / detail / status / assign / items / photos.

State machine:
  pending → acknowledged → scheduled → in_progress → completed
            ↘ declined
            ↘ canceled (DSP, before in_progress)

Allowed transitions are declared in app/schemas/work_order.py
(WORK_ORDER_TRANSITIONS).

Role-based authorization summary:
  - DSP_OWNER     : create, view (own DSP), cancel (pending/ack), edit notes
  - VENDOR_ADMIN  : view (own vendor), accept/decline, schedule,
                    in_progress/completed, assign tech, quote
  - TECHNICIAN    : view assigned, in_progress/completed (only if assigned)
  - SITE_ADMIN    : everything
"""
from datetime import date, datetime, time, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlmodel import func, select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.defect_labels import PART_LABELS, POSITION_LABELS, TYPE_LABELS
from app.models.base import utc_now
from app.models.defect import Defect
from app.models.defect_catalog import (
    DefectApplicability,
    DefectPart,
    DefectPosition,
    DefectRule,
    DefectType,
)
from app.models.organization import OrgType, Organization
from app.models.photo import Photo
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.models.work_order import (
    WorkOrder,
    WorkOrderFlag,
    WorkOrderItem,
    WorkOrderStatus,
)
from app.schemas.photo import (
    PhotoCommitRequest,
    PhotoListResponse,
    PhotoResponse,
)
from app.schemas.work_order import (
    WORK_ORDER_TRANSITIONS,
    WorkOrderAssign,
    WorkOrderCreate,
    WorkOrderItemAdd,
    WorkOrderItemCreate,
    WorkOrderItemResponse,
    WorkOrderListItem,
    WorkOrderListResponse,
    WorkOrderQuoteUpdate,
    WorkOrderResponse,
    WorkOrderStatusUpdate,
)
from app.storage.s3 import delete_object, generate_download_url

router = APIRouter(prefix="/work-orders", tags=["work-orders"])


# ─────────────────────────────────────────────────────
# Parsers
# ─────────────────────────────────────────────────────
def _parse_wo_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("WO-"):
        s = s[3:]
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid work-order id: {raw!r}. Use int or 'WO-XXXXX'.",
        ) from None


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


def _parse_org_id(raw: str, *, kind: str) -> int:
    """Parse 'V-001' / 'DSP-4201' / 'NF-006' / int → row id."""
    s = raw.strip().upper()
    for prefix in ("V-", "DSP-", "NF-"):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid {kind} id: {raw!r}",
        ) from None


def _parse_user_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("USR-") or s.startswith("U-"):
        s = s.split("-", 1)[1]
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid user id: {raw!r}",
        ) from None


# ─────────────────────────────────────────────────────
# RBAC helpers
# ─────────────────────────────────────────────────────
def _wo_visible(wo: WorkOrder, user: User) -> bool:
    """Can the current user *see* this WO?"""
    if user.role == UserRole.SITE_ADMIN:
        return True
    if user.role == UserRole.DSP_OWNER:
        return wo.dsp_id == user.organization_id
    if user.role == UserRole.VENDOR_ADMIN:
        return wo.vendor_id == user.organization_id
    if user.role == UserRole.TECHNICIAN:
        # Vendor's techs see all of their org's WOs (read-only mostly)
        return wo.vendor_id == user.organization_id
    return False


def _scope_query_for_user(query, user: User):
    """Add the role-scoped WHERE clauses to a query selecting WorkOrder."""
    if user.role == UserRole.SITE_ADMIN:
        return query
    if user.role == UserRole.DSP_OWNER:
        return query.where(WorkOrder.dsp_id == user.organization_id)
    if user.role in (UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN):
        return query.where(WorkOrder.vendor_id == user.organization_id)
    # Unknown role — no access
    return query.where(WorkOrder.id == -1)


def _require_dsp_or_admin(user: User) -> None:
    if user.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "only dsp_owner or site_admin can create work orders",
        )


def _require_vendor_or_admin(user: User) -> None:
    if user.role not in (UserRole.VENDOR_ADMIN, UserRole.SITE_ADMIN):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "vendor action requires vendor_admin or site_admin role",
        )


def _can_transition(
    user: User,
    wo: WorkOrder,
    target: WorkOrderStatus,
) -> tuple[bool, str | None]:
    """Returns (allowed, reason_if_blocked).

    Encodes per-role transition rules layered on top of the generic
    state-machine in WORK_ORDER_TRANSITIONS.
    """
    if user.role == UserRole.SITE_ADMIN:
        return True, None

    # DSP can only cancel (pending/acknowledged/scheduled → canceled)
    if user.role == UserRole.DSP_OWNER:
        if target == WorkOrderStatus.CANCELED and wo.dsp_id == user.organization_id:
            return True, None
        return False, "DSP can only cancel work orders"

    # VENDOR_ADMIN — vendor-side transitions on own org's WOs
    if user.role == UserRole.VENDOR_ADMIN:
        if wo.vendor_id != user.organization_id:
            return False, "not your work order"
        # vendor cannot cancel (DSP-only); everything else allowed if SM allows
        if target == WorkOrderStatus.CANCELED:
            return False, "vendor cannot cancel — only the DSP can"
        return True, None

    # TECHNICIAN — only progress + complete on assigned WOs
    if user.role == UserRole.TECHNICIAN:
        if wo.vendor_id != user.organization_id:
            return False, "not your work order"
        if wo.assigned_technician_id != user.id:
            return False, "not assigned to you"
        if target in {WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED}:
            return True, None
        return False, "techs can only mark WOs in_progress or completed"

    return False, "role not permitted"


# ─────────────────────────────────────────────────────
# Hydration / response building
# ─────────────────────────────────────────────────────
async def _load_org(session: AsyncSession, org_id: int) -> Organization:
    org = (
        await session.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "organization not found")
    return org


async def _load_user_full_name(session: AsyncSession, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    return u.full_name if u else None


async def _build_item_response(
    session: AsyncSession, item: WorkOrderItem
) -> WorkOrderItemResponse:
    """Hydrate a WO item with denormalized V2.2 Defect display fields."""
    defect = (
        await session.execute(
            select(Defect).where(Defect.id == item.defect_id)
        )
    ).scalar_one_or_none()

    out = WorkOrderItemResponse(
        id=item.id_str,
        defect_id=defect.id_str if defect else f"FD-{item.defect_id:03d}",
        repair_notes=item.repair_notes,
        line_parts_cost=item.line_parts_cost,
        line_labor_cost=item.line_labor_cost,
        created_at=item.created_at,
    )
    if defect is None:
        return out

    # Resolve labels from the static dictionaries
    try:
        part_enum = DefectPart(defect.part)
        part_lbl = PART_LABELS.get(part_enum, {})
    except ValueError:
        part_lbl = {}
    try:
        type_enum = DefectType(defect.defect_type)
        type_lbl = TYPE_LABELS.get(type_enum, {})
    except ValueError:
        type_lbl = {}
    pos_lbl = {}
    if defect.position:
        try:
            pos_enum = DefectPosition(defect.position)
            pos_lbl = POSITION_LABELS.get(pos_enum, {})
        except ValueError:
            pass

    # Pull classification + group from defect_applicability via JOIN with rule.
    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == defect.vehicle_id))
    ).scalar_one_or_none()
    classification, group = None, None
    if vehicle is not None:
        cg_row = (
            await session.execute(
                select(DefectRule.group, DefectApplicability.classification)
                .join(DefectApplicability, DefectApplicability.rule_id == DefectRule.id)
                .where(DefectRule.part == defect.part)
                .where(DefectRule.defect_type == defect.defect_type)
                .where(DefectApplicability.vehicle_class == vehicle.vehicle_class.value)
            )
        ).first()
        if cg_row is not None:
            g, c = cg_row
            group = g.value if hasattr(g, "value") else g
            classification = c.value if hasattr(c, "value") else c

    out.defect_part = defect.part
    out.defect_part_label = part_lbl.get("label")
    out.defect_part_icon = part_lbl.get("icon")
    out.defect_position = defect.position
    out.defect_position_label = pos_lbl.get("label")
    out.defect_type = defect.defect_type
    out.defect_type_label = type_lbl.get("label")
    out.defect_type_icon = type_lbl.get("icon")
    out.defect_details = defect.details if defect.details else None
    out.defect_classification = classification
    out.defect_group = group
    return out


async def _build_wo_response(
    session: AsyncSession, wo: WorkOrder
) -> WorkOrderResponse:
    """Full detail with items inline."""
    dsp = await _load_org(session, wo.dsp_id)
    vendor = await _load_org(session, wo.vendor_id)
    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == wo.vehicle_id))
    ).scalar_one_or_none()
    created_by_name = await _load_user_full_name(session, wo.created_by_id)
    tech_name = await _load_user_full_name(session, wo.assigned_technician_id)

    items_rows = (
        await session.execute(
            select(WorkOrderItem)
            .where(WorkOrderItem.work_order_id == wo.id)
            .order_by(WorkOrderItem.id)
        )
    ).scalars().all()
    items = [await _build_item_response(session, it) for it in items_rows]

    return WorkOrderResponse(
        id=wo.id_str,
        dsp_id=dsp.id_str,
        dsp=dsp.name,
        vendor_id=vendor.id_str,
        vendor=vendor.name,
        vehicle_id=vehicle.id_str if vehicle else "",
        fleet_id=vehicle.fleet_id if vehicle else None,
        plate=vehicle.plate if vehicle else None,
        year=vehicle.year if vehicle else None,
        make=vehicle.make if vehicle else None,
        model=vehicle.model if vehicle else None,
        vin=vehicle.vin if vehicle else None,
        last_mileage=vehicle.mileage if vehicle else None,
        created_by=created_by_name,
        created_by_id=f"USR-{wo.created_by_id:04d}",
        assigned_technician=tech_name,
        assigned_technician_id=(
            f"USR-{wo.assigned_technician_id:04d}"
            if wo.assigned_technician_id
            else None
        ),
        status=wo.status,
        flags=wo.flags or [],
        scheduled_at=wo.scheduled_at,
        started_at=wo.started_at,
        completed_at=wo.completed_at,
        ro_number=wo.ro_number,
        fmc=wo.fmc,
        parts_cost=wo.parts_cost,
        labor_cost=wo.labor_cost,
        total_cost=wo.total_cost,
        notes=wo.notes,
        decline_reason=wo.decline_reason,
        cancel_reason=wo.cancel_reason,
        photo_count=wo.photo_count,
        item_count=wo.item_count,
        items=items,
        created_at=wo.created_at,
        updated_at=wo.updated_at,
    )


def _build_summary(items: list[WorkOrderItemResponse]) -> str | None:
    """One-line summary for list view: first item's part + type + count."""
    if not items:
        return None
    top = items[0]
    label = top.defect_part_label or top.defect_part or "Defect"
    if top.defect_type_label:
        label = f"{label} — {top.defect_type_label}"
    if len(items) > 1:
        label = f"{label} (+{len(items) - 1} more)"
    return label


# ─────────────────────────────────────────────────────
# Defect bundle resolution + validation (used at create + add-items)
# ─────────────────────────────────────────────────────
async def _resolve_defect_bundle(
    session: AsyncSession,
    items: list[WorkOrderItemCreate],
    *,
    expected_dsp_id: int | None,
    expected_vehicle_id: int | None,
    excluding_wo_id: int | None = None,
) -> tuple[list[Defect], int, int]:
    """Loads defects referenced in items, validates:
      - all exist
      - all belong to same vehicle
      - all belong to same dsp
      - none already attached to another WO.

    V2.2: defects carry vehicle_id directly; dsp_id is derived via Vehicle JOIN.

    Returns (defects_in_input_order, vehicle_id, dsp_id).
    """
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "must have at least one item")

    defect_ids = [_parse_defect_id(it.defect_id) for it in items]

    rows = (
        await session.execute(
            select(Defect, Vehicle)
            .join(Vehicle, Defect.vehicle_id == Vehicle.id)
            .where(Defect.id.in_(defect_ids))
        )
    ).all()
    by_id: dict[int, tuple[Defect, Vehicle]] = {
        d.id: (d, v) for d, v in rows
    }

    missing = [did for did in defect_ids if did not in by_id]
    if missing:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"defects not found: {missing}",
        )

    # Same vehicle & DSP
    vehicle_ids = {v.id for _, v in by_id.values()}
    dsp_ids = {v.dsp_id for _, v in by_id.values()}
    if len(vehicle_ids) > 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "all defects must belong to the same vehicle",
        )
    if len(dsp_ids) > 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "all defects must belong to the same DSP",
        )

    vehicle_id = next(iter(vehicle_ids))
    dsp_id = next(iter(dsp_ids))

    if expected_vehicle_id is not None and vehicle_id != expected_vehicle_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"defect vehicle ({vehicle_id}) doesn't match WO vehicle ({expected_vehicle_id})",
        )
    if expected_dsp_id is not None and dsp_id != expected_dsp_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"defect dsp ({dsp_id}) doesn't match WO dsp ({expected_dsp_id})",
        )

    # Already-bundled check
    bundled_q = (
        select(WorkOrderItem.defect_id, WorkOrderItem.work_order_id)
        .where(WorkOrderItem.defect_id.in_(defect_ids))
    )
    if excluding_wo_id is not None:
        bundled_q = bundled_q.where(WorkOrderItem.work_order_id != excluding_wo_id)
    bundled = (await session.execute(bundled_q)).all()
    if bundled:
        msg = ", ".join(
            f"FD-{did:03d}→WO-{woid:05d}" for did, woid in bundled
        )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"defects already on a work order: {msg}",
        )

    return [by_id[did][0] for did in defect_ids], vehicle_id, dsp_id


# ─────────────────────────────────────────────────────
# POST /work-orders  (create)
# ─────────────────────────────────────────────────────
@router.post(
    "",
    response_model=WorkOrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Work Order from one or more defects",
)
async def create_work_order(
    body: WorkOrderCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    _require_dsp_or_admin(current)

    vendor_row_id = _parse_org_id(body.vendor_id, kind="vendor")
    vendor = await _load_org(session, vendor_row_id)
    if vendor.org_type != OrgType.VENDOR:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "vendor_id must reference a vendor org"
        )

    # DSP must be the user's own org (unless site_admin)
    if current.role == UserRole.DSP_OWNER:
        target_dsp_id = current.organization_id
    else:
        # site_admin: derive DSP from defects (validated below)
        target_dsp_id = None

    defects, vehicle_id, dsp_id = await _resolve_defect_bundle(
        session, body.items,
        expected_dsp_id=target_dsp_id,
        expected_vehicle_id=None,
    )

    now = utc_now()
    wo = WorkOrder(
        dsp_id=dsp_id,
        vendor_id=vendor_row_id,
        vehicle_id=vehicle_id,
        created_by_id=current.id,
        assigned_technician_id=None,
        status=WorkOrderStatus.PENDING,
        flags=[f.value for f in body.flags],
        scheduled_at=body.scheduled_at,
        notes=body.notes,
        fmc=body.fmc,
        ro_number=body.ro_number,
        item_count=len(defects),
        created_at=now,
        updated_at=now,
    )
    session.add(wo)
    await session.flush()  # need wo.id for items

    # Create items. V2.2: workflow status lives in a separate (future)
    # `defect_status` table; we don't mutate the Defect row here.
    for it_in, defect in zip(body.items, defects, strict=True):
        item = WorkOrderItem(
            work_order_id=wo.id,
            defect_id=defect.id,
            repair_notes=it_in.repair_notes,
            line_parts_cost=it_in.line_parts_cost,
            line_labor_cost=it_in.line_labor_cost,
            created_at=now,
        )
        session.add(item)
        defect.updated_at = now
        session.add(defect)

    await session.commit()
    await session.refresh(wo)
    return await _build_wo_response(session, wo)


# ─────────────────────────────────────────────────────
# GET /work-orders  (list)
# ─────────────────────────────────────────────────────
@router.get("", response_model=WorkOrderListResponse)
async def list_work_orders(
    dsp_id: str | None = Query(default=None),
    vendor_id: str | None = Query(default=None),
    status_: WorkOrderStatus | None = Query(default=None, alias="status"),
    vehicle_id: str | None = Query(default=None),
    technician_id: str | None = Query(default=None),
    rush_only: bool = Query(default=False),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderListResponse:
    DspOrg = aliased(Organization)
    VendorOrg = aliased(Organization)
    CreatedBy = aliased(User)
    Tech = aliased(User)

    base_query = (
        select(WorkOrder, Vehicle, DspOrg, VendorOrg, CreatedBy, Tech)
        .join(Vehicle, WorkOrder.vehicle_id == Vehicle.id)
        .join(DspOrg, WorkOrder.dsp_id == DspOrg.id)
        .join(VendorOrg, WorkOrder.vendor_id == VendorOrg.id)
        .outerjoin(CreatedBy, WorkOrder.created_by_id == CreatedBy.id)
        .outerjoin(Tech, WorkOrder.assigned_technician_id == Tech.id)
    )
    count_query = select(func.count()).select_from(WorkOrder)

    # Role scoping
    base_query = _scope_query_for_user(base_query, current)
    count_query = _scope_query_for_user(count_query, current)

    if dsp_id is not None:
        did = _parse_org_id(dsp_id, kind="dsp")
        base_query = base_query.where(WorkOrder.dsp_id == did)
        count_query = count_query.where(WorkOrder.dsp_id == did)
    if vendor_id is not None:
        vid_org = _parse_org_id(vendor_id, kind="vendor")
        base_query = base_query.where(WorkOrder.vendor_id == vid_org)
        count_query = count_query.where(WorkOrder.vendor_id == vid_org)
    if status_ is not None:
        base_query = base_query.where(WorkOrder.status == status_.value)
        count_query = count_query.where(WorkOrder.status == status_.value)
    if vehicle_id is not None:
        from app.routes.vehicles import _parse_vehicle_id
        veh_id = _parse_vehicle_id(vehicle_id)
        base_query = base_query.where(WorkOrder.vehicle_id == veh_id)
        count_query = count_query.where(WorkOrder.vehicle_id == veh_id)
    if technician_id is not None:
        tid = _parse_user_id(technician_id)
        base_query = base_query.where(WorkOrder.assigned_technician_id == tid)
        count_query = count_query.where(WorkOrder.assigned_technician_id == tid)
    if rush_only:
        base_query = base_query.where(WorkOrder.flags.contains([WorkOrderFlag.RUSH_ORDER.value]))
        count_query = count_query.where(WorkOrder.flags.contains([WorkOrderFlag.RUSH_ORDER.value]))
    if date_from is not None:
        dt_from = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        base_query = base_query.where(WorkOrder.created_at >= dt_from)
        count_query = count_query.where(WorkOrder.created_at >= dt_from)
    if date_to is not None:
        dt_to = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        base_query = base_query.where(WorkOrder.created_at <= dt_to)
        count_query = count_query.where(WorkOrder.created_at <= dt_to)

    base_query = (
        base_query.order_by(WorkOrder.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )

    total = (await session.execute(count_query)).scalar_one()
    rows = (await session.execute(base_query)).all()

    items_out: list[WorkOrderListItem] = []
    for wo, vehicle, dsp, vendor, created_by_u, tech_u in rows:
        # Build a compact item summary by loading items for these WOs.
        # Cheap to fetch per-WO since per_page is capped at 200.
        item_rows = (
            await session.execute(
                select(WorkOrderItem)
                .where(WorkOrderItem.work_order_id == wo.id)
                .order_by(WorkOrderItem.id)
            )
        ).scalars().all()
        item_responses = [await _build_item_response(session, it) for it in item_rows]

        items_out.append(
            WorkOrderListItem(
                id=wo.id_str,
                dsp_id=dsp.id_str,
                dsp=dsp.name,
                vendor_id=vendor.id_str,
                vendor=vendor.name,
                vehicle_id=vehicle.id_str,
                fleet_id=vehicle.fleet_id,
                plate=vehicle.plate,
                status=wo.status,
                flags=wo.flags or [],
                item_count=wo.item_count,
                photo_count=wo.photo_count,
                scheduled_at=wo.scheduled_at,
                completed_at=wo.completed_at,
                total_cost=wo.total_cost,
                ro_number=wo.ro_number,
                assigned_technician=tech_u.full_name if tech_u else None,
                created_by=created_by_u.full_name if created_by_u else None,
                created_at=wo.created_at,
                summary=_build_summary(item_responses),
            )
        )

    return WorkOrderListResponse(
        items=items_out, total=total, page=page, per_page=per_page
    )


# ─────────────────────────────────────────────────────
# GET /work-orders/{id}  (detail)
# ─────────────────────────────────────────────────────
async def _load_wo_or_404(
    session: AsyncSession, wo_id_str: str
) -> WorkOrder:
    wid = _parse_wo_id(wo_id_str)
    wo = (
        await session.execute(select(WorkOrder).where(WorkOrder.id == wid))
    ).scalar_one_or_none()
    if wo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "work order not found")
    return wo


async def _load_wo_for_user(
    session: AsyncSession, wo_id_str: str, current: User
) -> WorkOrder:
    wo = await _load_wo_or_404(session, wo_id_str)
    if not _wo_visible(wo, current):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your work order")
    return wo


@router.get("/{wo_id}", response_model=WorkOrderResponse)
async def get_work_order(
    wo_id: str = Path(..., description="WO-XXXXX or int"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    wo = await _load_wo_for_user(session, wo_id, current)
    return await _build_wo_response(session, wo)


# ─────────────────────────────────────────────────────
# PATCH /work-orders/{id}/status
# ─────────────────────────────────────────────────────
@router.patch("/{wo_id}/status", response_model=WorkOrderResponse)
async def update_status(
    body: WorkOrderStatusUpdate,
    wo_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    wo = await _load_wo_for_user(session, wo_id, current)

    # Same-status no-op: allow appending notes without an actual transition.
    # Useful for the FE's "add note" affordance which round-trips the status.
    if body.status == wo.status:
        if not body.notes_append:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "no transition and no notes_append — nothing to do",
            )
        now = utc_now()
        prefix = "" if not wo.notes else "\n\n"
        wo.notes = (wo.notes or "") + (
            f"{prefix}[{now.isoformat()}] {current.full_name}: {body.notes_append}"
        )
        wo.updated_at = now
        session.add(wo)
        await session.commit()
        await session.refresh(wo)
        return await _build_wo_response(session, wo)

    # State-machine check
    allowed = WORK_ORDER_TRANSITIONS.get(wo.status, set())
    if body.status not in allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"cannot transition from {wo.status.value} to {body.status.value}",
        )

    # Role check
    can, reason = _can_transition(current, wo, body.status)
    if not can:
        raise HTTPException(status.HTTP_403_FORBIDDEN, reason or "not allowed")

    # Side effects per target
    now = utc_now()
    if body.status == WorkOrderStatus.SCHEDULED:
        if body.scheduled_at is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "scheduled_at required when transitioning to scheduled",
            )
        wo.scheduled_at = body.scheduled_at
    elif body.status == WorkOrderStatus.IN_PROGRESS:
        wo.started_at = now
    elif body.status == WorkOrderStatus.COMPLETED:
        wo.completed_at = now
        # V2.2: workflow status lives in a future `defect_status` table — no
        # row mutation here.
    elif body.status == WorkOrderStatus.DECLINED:
        if not body.decline_reason:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "decline_reason required"
            )
        wo.decline_reason = body.decline_reason
        # Free up the bundled defects by deleting the WorkOrderItem rows (so
        # UNIQUE(defect_id) doesn't block re-bundling). The WO row stays for
        # audit. V2.2: no defect.status mutation — that lives in defect_status.
        items = (
            await session.execute(
                select(WorkOrderItem).where(WorkOrderItem.work_order_id == wo.id)
            )
        ).scalars().all()
        for it in items:
            await session.delete(it)
        wo.item_count = 0
    elif body.status == WorkOrderStatus.CANCELED:
        if not body.cancel_reason:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "cancel_reason required"
            )
        wo.cancel_reason = body.cancel_reason
        items = (
            await session.execute(
                select(WorkOrderItem).where(WorkOrderItem.work_order_id == wo.id)
            )
        ).scalars().all()
        for it in items:
            await session.delete(it)
        wo.item_count = 0

    if body.notes_append:
        suffix = (
            f"\n\n[{now.isoformat()}] {current.full_name}: {body.notes_append}"
            if wo.notes
            else f"[{now.isoformat()}] {current.full_name}: {body.notes_append}"
        )
        wo.notes = (wo.notes or "") + suffix

    wo.status = body.status
    wo.updated_at = now
    session.add(wo)

    await session.commit()
    await session.refresh(wo)
    return await _build_wo_response(session, wo)


# ─────────────────────────────────────────────────────
# PATCH /work-orders/{id}/assign
# ─────────────────────────────────────────────────────
@router.patch("/{wo_id}/assign", response_model=WorkOrderResponse)
async def assign_technician(
    body: WorkOrderAssign,
    wo_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    wo = await _load_wo_for_user(session, wo_id, current)
    _require_vendor_or_admin(current)
    if (
        current.role == UserRole.VENDOR_ADMIN
        and wo.vendor_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your work order")

    now = utc_now()
    if body.technician_id is None:
        wo.assigned_technician_id = None
    else:
        tid = _parse_user_id(body.technician_id)
        tech = (
            await session.execute(select(User).where(User.id == tid))
        ).scalar_one_or_none()
        if tech is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "technician not found")
        if tech.role != UserRole.TECHNICIAN:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"user {tech.full_name} is not a technician",
            )
        if tech.organization_id != wo.vendor_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "technician must belong to the WO's vendor org",
            )
        wo.assigned_technician_id = tid

    if body.notes_append:
        prefix = "" if not wo.notes else "\n\n"
        wo.notes = (wo.notes or "") + (
            f"{prefix}[{now.isoformat()}] {current.full_name}: {body.notes_append}"
        )

    wo.updated_at = now
    session.add(wo)
    await session.commit()
    await session.refresh(wo)
    return await _build_wo_response(session, wo)


# ─────────────────────────────────────────────────────
# PATCH /work-orders/{id}/quote
# ─────────────────────────────────────────────────────
@router.patch("/{wo_id}/quote", response_model=WorkOrderResponse)
async def update_quote(
    body: WorkOrderQuoteUpdate,
    wo_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    wo = await _load_wo_for_user(session, wo_id, current)
    _require_vendor_or_admin(current)
    if (
        current.role == UserRole.VENDOR_ADMIN
        and wo.vendor_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your work order")

    if body.parts_cost is not None:
        wo.parts_cost = body.parts_cost
    if body.labor_cost is not None:
        wo.labor_cost = body.labor_cost
    if body.ro_number is not None:
        wo.ro_number = body.ro_number

    wo.updated_at = utc_now()
    session.add(wo)
    await session.commit()
    await session.refresh(wo)
    return await _build_wo_response(session, wo)


# ─────────────────────────────────────────────────────
# Items: add / remove
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/items",
    response_model=WorkOrderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_items(
    body: WorkOrderItemAdd,
    wo_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    wo = await _load_wo_for_user(session, wo_id, current)
    _require_dsp_or_admin(current)
    if (
        current.role == UserRole.DSP_OWNER
        and wo.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your work order")
    if wo.status not in {WorkOrderStatus.PENDING, WorkOrderStatus.ACKNOWLEDGED}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"cannot add items to WO in status '{wo.status.value}'",
        )

    defects, _vid, _did = await _resolve_defect_bundle(
        session, body.items,
        expected_dsp_id=wo.dsp_id,
        expected_vehicle_id=wo.vehicle_id,
        excluding_wo_id=wo.id,
    )

    now = utc_now()
    for it_in, defect in zip(body.items, defects, strict=True):
        item = WorkOrderItem(
            work_order_id=wo.id,
            defect_id=defect.id,
            repair_notes=it_in.repair_notes,
            line_parts_cost=it_in.line_parts_cost,
            line_labor_cost=it_in.line_labor_cost,
            created_at=now,
        )
        session.add(item)
        # V2.2: workflow status lives in defect_status (future); no defect mutation.
        defect.updated_at = now
        session.add(defect)

    wo.item_count = wo.item_count + len(defects)
    wo.updated_at = now
    session.add(wo)
    await session.commit()
    await session.refresh(wo)
    return await _build_wo_response(session, wo)


@router.delete(
    "/{wo_id}/items/{item_id}",
    response_model=WorkOrderResponse,
    summary="Remove an item from a WO (un-bundles the defect, reverts to acknowledged)",
)
async def remove_item(
    wo_id: str = Path(...),
    item_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    wo = await _load_wo_for_user(session, wo_id, current)
    _require_dsp_or_admin(current)
    if (
        current.role == UserRole.DSP_OWNER
        and wo.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your work order")
    if wo.status not in {WorkOrderStatus.PENDING, WorkOrderStatus.ACKNOWLEDGED}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"cannot remove items from WO in status '{wo.status.value}'",
        )

    raw = item_id.strip().upper()
    if raw.startswith("WOI-"):
        raw = raw[4:]
    try:
        iid = int(raw)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"invalid item id: {item_id!r}"
        ) from None

    item = (
        await session.execute(
            select(WorkOrderItem)
            .where(WorkOrderItem.id == iid)
            .where(WorkOrderItem.work_order_id == wo.id)
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found on this WO")

    if wo.item_count <= 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "cannot remove the last item — cancel the WO instead",
        )

    # V2.2: defect workflow status lives in future defect_status — no
    # mutation here. Just unlink by deleting the item row.
    now = utc_now()
    await session.delete(item)
    wo.item_count = max(0, wo.item_count - 1)
    wo.updated_at = now
    session.add(wo)
    await session.commit()
    await session.refresh(wo)
    return await _build_wo_response(session, wo)


# ─────────────────────────────────────────────────────
# Photos (same pattern as defects/inspections)
# ─────────────────────────────────────────────────────
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
    "/{wo_id}/photos",
    response_model=PhotoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Commit a WO photo (after upload to MinIO via /uploads/presigned)",
)
async def add_wo_photo(
    body: PhotoCommitRequest,
    wo_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PhotoResponse:
    wo = await _load_wo_for_user(session, wo_id, current)

    expected_prefix = f"photos/work_orders/{wo.id}/"
    if not body.storage_key.startswith(expected_prefix):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"storage_key must start with {expected_prefix!r}",
        )

    photo = Photo(
        work_order_id=wo.id,
        category=body.category,
        storage_key=body.storage_key,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
        width=body.width,
        height=body.height,
        uploaded_by_id=current.id,
    )
    session.add(photo)
    wo.photo_count = (wo.photo_count or 0) + 1
    wo.updated_at = utc_now()
    session.add(wo)
    await session.commit()
    await session.refresh(photo)
    return _photo_to_response(photo, uploader_name=current.full_name)


@router.get(
    "/{wo_id}/photos",
    response_model=PhotoListResponse,
    summary="List all photos attached to a WO (with presigned GET URLs)",
)
async def list_wo_photos(
    wo_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PhotoListResponse:
    wo = await _load_wo_for_user(session, wo_id, current)
    stmt = (
        select(Photo, User.full_name)
        .outerjoin(User, Photo.uploaded_by_id == User.id)
        .where(Photo.work_order_id == wo.id)
        .where(Photo.is_deleted == False)  # noqa: E712
        .order_by(Photo.uploaded_at.desc())
    )
    rows = (await session.execute(stmt)).all()
    items = [_photo_to_response(p, uploader_name=name) for (p, name) in rows]
    return PhotoListResponse(items=items, total=len(items))


@router.delete(
    "/{wo_id}/photos/{photo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a WO photo",
)
async def delete_wo_photo(
    wo_id: str = Path(...),
    photo_id: str = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    wo = await _load_wo_for_user(session, wo_id, current)

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
            .where(Photo.work_order_id == wo.id)
        )
    ).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "photo not found")
    if photo.is_deleted:
        return None

    photo.is_deleted = True
    photo.updated_at = utc_now()
    session.add(photo)
    wo.photo_count = max(0, (wo.photo_count or 0) - 1)
    wo.updated_at = utc_now()
    session.add(wo)
    delete_object(photo.storage_key)
    await session.commit()
    return None
