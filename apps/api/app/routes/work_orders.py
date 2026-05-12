"""Work Order endpoints — V2.0 (replaces the V1 stub).

State machine on POST /{id}/{action}:
  pending_acceptance → accepted     (POST /accept)
  pending_acceptance → declined     (POST /decline)
  accepted          → in_progress   (POST /start)
  in_progress       → completed     (POST /complete)
  <any pre-terminal>→ cancelled     (POST /cancel)

The two DB triggers from PR 1 enforce:
  - assert_defect_repair_links_on_complete  — complete blocked if any
    defect_repair line item lacks a link.
  - assert_external_mode_ro_present         — accept blocked if external-
    mode workshop has no RO# attached.

Line item, RO, and note sub-resources live as POST/PATCH/DELETE under
the WO root (/{wo_id}/line-items/*, /{wo_id}/ros/*, /{wo_id}/notes/*).

Authorization:
  - site_admin       : full visibility + every transition
  - dsp_owner        : list/get own DSP, cancel
  - vendor_admin     : list/get WOs at their workshops, all vendor-side
                       transitions (accept/decline/start/complete) + line
                       items + ROs + notes
  - technician       : list/get assigned WOs, start/complete + notes
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.i18n_errors import E, tr_error
from app.i18n_helpers import get_request_language
from app.models.base import utc_now
from app.models.user import User, UserRole
from app.models.work_orders import (
    DefectResolution,
    LineItemBillingType,
    LineItemCategory,
    LineItemStatus,
    NoteAuthorRole,
    StatusTrackingMode,
    VendorWorkshop,
    WoActivityLogEntityType,
    WorkOrder,
    WorkOrderLineItem,
    WorkOrderNote,
    WorkOrderRo,
    WorkOrderStatus,
)
from app.services.wo_activity_log import log_event, log_status_change
from app.services.wo_defect_resolutions import sync_all_drs_for_wo
from app.services.wo_line_items import (
    add_mid_repair_line_item,
    defer_line_item_with_followup_rr,
    generate_line_items_on_accept,
)
from app.services.wo_router import route_repair_request

router = APIRouter(prefix="/work-orders", tags=["work-orders"])


# ─────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────
WO_STATUS = Literal[
    "pending_acceptance", "accepted", "in_progress",
    "completed", "cancelled", "declined",
]
LI_STATUS = Literal[
    "pending_scope_approval", "pending_cost_approval", "pending",
    "pending_variance_reapproval", "done", "deferred", "declined",
]
DR_STATUS = Literal["pending", "in_progress", "resolved", "deferred", "declined"]


class WorkOrderResponse(BaseModel):
    id: str
    repair_request_id: int
    vehicle_id: int
    vendor_workshop_id: int
    dsp_id: int
    status: WO_STATUS
    status_tracking_mode: str
    assigned_technician_id: int | None = None
    is_stale: bool
    is_rush: bool
    last_mileage: int | None = None
    cancelled_reason: str | None = None
    declined_reason: str | None = None
    decline_reason_code: str | None = None
    created_at: datetime
    updated_at: datetime
    accepted_at: datetime | None = None
    in_progress_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    declined_at: datetime | None = None
    marked_stale_at: datetime | None = None
    created_by_id: int | None = None

    @classmethod
    def from_model(cls, wo: WorkOrder) -> "WorkOrderResponse":
        return cls(
            id=wo.id_str,
            repair_request_id=wo.repair_request_id,
            vehicle_id=wo.vehicle_id,
            vendor_workshop_id=wo.vendor_workshop_id,
            dsp_id=wo.dsp_id,
            status=wo.status.value if hasattr(wo.status, "value") else wo.status,
            status_tracking_mode=(
                wo.status_tracking_mode.value
                if hasattr(wo.status_tracking_mode, "value")
                else wo.status_tracking_mode
            ),
            assigned_technician_id=wo.assigned_technician_id,
            is_stale=wo.is_stale,
            is_rush=wo.is_rush,
            last_mileage=wo.last_mileage,
            cancelled_reason=wo.cancelled_reason,
            declined_reason=wo.declined_reason,
            decline_reason_code=wo.decline_reason_code,
            created_at=wo.created_at,
            updated_at=wo.updated_at,
            accepted_at=wo.accepted_at,
            in_progress_at=wo.in_progress_at,
            completed_at=wo.completed_at,
            cancelled_at=wo.cancelled_at,
            declined_at=wo.declined_at,
            marked_stale_at=wo.marked_stale_at,
            created_by_id=wo.created_by_id,
        )


class WorkOrderListResponse(BaseModel):
    items: list[WorkOrderResponse]
    total: int


class LineItemResponse(BaseModel):
    id: int
    work_order_id: int
    ro_id: int | None = None
    description: str
    estimated_price: Decimal | None = None
    final_price: Decimal | None = None
    category: str
    billing_type: str
    status: LI_STATUS
    status_reason: str | None = None
    decline_reason_code: str | None = None
    customer_requested: bool
    cost_approved_at: datetime | None = None
    customer_reapproved_at: datetime | None = None
    external_source: str | None = None
    external_id: str | None = None
    created_at: datetime
    updated_at: datetime
    created_by_id: int | None = None

    @classmethod
    def from_model(cls, li: WorkOrderLineItem) -> "LineItemResponse":
        return cls(
            id=li.id,
            work_order_id=li.work_order_id,
            ro_id=li.ro_id,
            description=li.description,
            estimated_price=li.estimated_price,
            final_price=li.final_price,
            category=li.category.value if hasattr(li.category, "value") else li.category,
            billing_type=li.billing_type.value if hasattr(li.billing_type, "value") else li.billing_type,
            status=li.status.value if hasattr(li.status, "value") else li.status,
            status_reason=li.status_reason,
            decline_reason_code=li.decline_reason_code,
            customer_requested=li.customer_requested,
            cost_approved_at=li.cost_approved_at,
            customer_reapproved_at=li.customer_reapproved_at,
            external_source=li.external_source,
            external_id=li.external_id,
            created_at=li.created_at,
            updated_at=li.updated_at,
            created_by_id=li.created_by_id,
        )


class DefectResolutionResp(BaseModel):
    id: int
    work_order_id: int
    defect_id: int
    status: DR_STATUS
    notes: str | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, dr: DefectResolution) -> "DefectResolutionResp":
        return cls(
            id=dr.id,
            work_order_id=dr.work_order_id,
            defect_id=dr.defect_id,
            status=dr.status.value if hasattr(dr.status, "value") else dr.status,
            notes=dr.notes,
            resolved_at=dr.resolved_at,
            created_at=dr.created_at,
            updated_at=dr.updated_at,
        )


class WorkOrderRoResp(BaseModel):
    id: int
    work_order_id: int
    ro_number: str
    is_primary: bool
    modification_reason: str | None = None
    added_at: datetime
    added_by_id: int | None = None

    @classmethod
    def from_model(cls, ro: WorkOrderRo) -> "WorkOrderRoResp":
        return cls(
            id=ro.id,
            work_order_id=ro.work_order_id,
            ro_number=ro.ro_number,
            is_primary=ro.is_primary,
            modification_reason=ro.modification_reason,
            added_at=ro.added_at,
            added_by_id=ro.added_by_id,
        )


class NoteResp(BaseModel):
    id: int
    work_order_id: int
    author_id: int | None = None
    author_role: str
    body: str
    created_at: datetime

    @classmethod
    def from_model(cls, n: WorkOrderNote) -> "NoteResp":
        return cls(
            id=n.id,
            work_order_id=n.work_order_id,
            author_id=n.author_id,
            author_role=n.author_role.value if hasattr(n.author_role, "value") else n.author_role,
            body=n.body,
            created_at=n.created_at,
        )


class WorkOrderDetailResponse(WorkOrderResponse):
    line_items: list[LineItemResponse] = Field(default_factory=list)
    defect_resolutions: list[DefectResolutionResp] = Field(default_factory=list)
    ros: list[WorkOrderRoResp] = Field(default_factory=list)
    notes: list[NoteResp] = Field(default_factory=list)


# Action bodies
class DeclineBody(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    decline_reason_code: str = Field(..., max_length=40)
    reroute: bool = Field(
        default=True,
        description="If True (default), attempt to route the RR to the next eligible vendor.",
    )
    model_config = ConfigDict(extra="forbid")


class CancelBody(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    model_config = ConfigDict(extra="forbid")


class CompleteBody(BaseModel):
    last_mileage: int | None = Field(default=None, ge=0)
    model_config = ConfigDict(extra="forbid")


class AssignTechBody(BaseModel):
    technician_id: int | None = Field(
        default=None,
        description="Set to None to clear assignment.",
    )
    model_config = ConfigDict(extra="forbid")


# Sub-resource bodies
class LineItemCreateBody(BaseModel):
    description: str = Field(..., min_length=1)
    category: LineItemCategory
    billing_type: LineItemBillingType = LineItemBillingType.CMR
    estimated_price: Decimal | None = Field(default=None, ge=0)
    customer_requested: bool = False
    model_config = ConfigDict(use_enum_values=True, extra="forbid")


class LineItemPatchBody(BaseModel):
    description: str | None = Field(default=None, min_length=1)
    estimated_price: Decimal | None = Field(default=None, ge=0)
    final_price: Decimal | None = Field(default=None, ge=0)
    ro_id: int | None = None
    status: LI_STATUS | None = None
    status_reason: str | None = None
    decline_reason_code: str | None = Field(default=None, max_length=40)
    model_config = ConfigDict(extra="forbid")


class LineItemDeferBody(BaseModel):
    reason_code: str = Field(default="parts_unavailable", max_length=40)
    status_reason: str | None = Field(default=None, max_length=500)
    model_config = ConfigDict(extra="forbid")


class RoCreateBody(BaseModel):
    ro_number: str = Field(..., min_length=1, max_length=60)
    is_primary: bool = False
    modification_reason: str | None = None
    model_config = ConfigDict(extra="forbid")


class RoPatchBody(BaseModel):
    is_primary: bool | None = None
    modification_reason: str | None = None
    model_config = ConfigDict(extra="forbid")


class NoteBody(BaseModel):
    body: str = Field(..., min_length=1)
    author_role: NoteAuthorRole = NoteAuthorRole.ADMIN
    model_config = ConfigDict(use_enum_values=True, extra="forbid")


# ─────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────
def _parse_wo_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("WO-"):
        s = s[3:]
    try:
        return int(s)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid work_order id: {raw!r}. Use int or 'WO-XXXXX'.",
        ) from e


async def _load_wo_or_404(
    session: AsyncSession, wo_id: int, lang: str
) -> WorkOrder:
    wo = (
        await session.execute(select(WorkOrder).where(WorkOrder.id == wo_id))
    ).scalar_one_or_none()
    if wo is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.WORK_ORDER_NOT_FOUND, lang)
        )
    return wo


async def _vendor_workshop_ids_for_user(session: AsyncSession, user: User) -> list[int]:
    if user.role not in (UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN):
        return []
    if user.organization_id is None:
        return []
    return list(
        (
            await session.execute(
                select(VendorWorkshop.id).where(
                    VendorWorkshop.organization_id == user.organization_id
                )
            )
        )
        .scalars()
        .all()
    )


async def _can_view_wo(session: AsyncSession, wo: WorkOrder, user: User) -> bool:
    if user.role == UserRole.SITE_ADMIN:
        return True
    if user.role == UserRole.DSP_OWNER:
        return wo.dsp_id == user.organization_id
    if user.role == UserRole.VENDOR_ADMIN:
        workshop_ids = await _vendor_workshop_ids_for_user(session, user)
        return wo.vendor_workshop_id in workshop_ids
    if user.role == UserRole.TECHNICIAN:
        workshop_ids = await _vendor_workshop_ids_for_user(session, user)
        return (
            wo.vendor_workshop_id in workshop_ids
            or wo.assigned_technician_id == user.id
        )
    return False


def _vendor_side_role(role: UserRole) -> bool:
    return role in (UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN)


def _tech_or_vendor_role(role: UserRole) -> bool:
    return role in (UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN)


async def _ensure_can_act(
    session: AsyncSession,
    *,
    wo: WorkOrder,
    user: User,
    allowed_roles: tuple[UserRole, ...],
    lang: str,
) -> None:
    if user.role not in allowed_roles:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            tr_error(E.REQUIRES_ROLE, lang, roles=[r.value for r in allowed_roles]),
        )
    if user.role == UserRole.SITE_ADMIN:
        return
    if user.role == UserRole.DSP_OWNER:
        if wo.dsp_id != user.organization_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_WORK_ORDER, lang)
            )
        return
    if user.role in (UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN):
        workshop_ids = await _vendor_workshop_ids_for_user(session, user)
        is_their_workshop = wo.vendor_workshop_id in workshop_ids
        is_their_assignment = (
            user.role == UserRole.TECHNICIAN
            and wo.assigned_technician_id == user.id
        )
        if not (is_their_workshop or is_their_assignment):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_WORK_ORDER, lang)
            )


# ─────────────────────────────────────────────────────
# List / detail
# ─────────────────────────────────────────────────────
@router.get(
    "",
    response_model=WorkOrderListResponse,
    summary="List work orders (scoped to caller's role)",
)
async def list_work_orders(
    request: Request,
    status_filter: WO_STATUS | None = Query(default=None, alias="status"),
    dsp_id: int | None = Query(default=None),
    vendor_workshop_id: int | None = Query(default=None),
    assigned_to_me: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderListResponse:
    _ = get_request_language(request)
    stmt = select(WorkOrder)

    if current.role == UserRole.DSP_OWNER:
        stmt = stmt.where(WorkOrder.dsp_id == current.organization_id)
    elif current.role == UserRole.VENDOR_ADMIN:
        workshop_ids = await _vendor_workshop_ids_for_user(session, current)
        if not workshop_ids:
            return WorkOrderListResponse(items=[], total=0)
        stmt = stmt.where(WorkOrder.vendor_workshop_id.in_(workshop_ids))
    elif current.role == UserRole.TECHNICIAN:
        workshop_ids = await _vendor_workshop_ids_for_user(session, current)
        condition = WorkOrder.assigned_technician_id == current.id
        if workshop_ids:
            condition = condition | WorkOrder.vendor_workshop_id.in_(workshop_ids)
        stmt = stmt.where(condition)
    else:
        # site_admin — optional filters
        if dsp_id is not None:
            stmt = stmt.where(WorkOrder.dsp_id == dsp_id)
        if vendor_workshop_id is not None:
            stmt = stmt.where(WorkOrder.vendor_workshop_id == vendor_workshop_id)

    if assigned_to_me:
        stmt = stmt.where(WorkOrder.assigned_technician_id == current.id)
    if status_filter is not None:
        stmt = stmt.where(WorkOrder.status == status_filter)

    stmt = stmt.order_by(WorkOrder.created_at.desc()).limit(limit)
    rows = list((await session.execute(stmt)).scalars().all())
    items = [WorkOrderResponse.from_model(w) for w in rows]
    return WorkOrderListResponse(items=items, total=len(items))


@router.get(
    "/{wo_id}",
    response_model=WorkOrderDetailResponse,
    summary="Get a work order with line items / DRs / ROs / notes",
)
async def get_work_order(
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderDetailResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    if not await _can_view_wo(session, wo, current):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_WORK_ORDER, lang)
        )

    line_items = list(
        (
            await session.execute(
                select(WorkOrderLineItem)
                .where(WorkOrderLineItem.work_order_id == wo.id)
                .order_by(WorkOrderLineItem.id)
            )
        )
        .scalars()
        .all()
    )
    drs = list(
        (
            await session.execute(
                select(DefectResolution)
                .where(DefectResolution.work_order_id == wo.id)
                .order_by(DefectResolution.id)
            )
        )
        .scalars()
        .all()
    )
    ros = list(
        (
            await session.execute(
                select(WorkOrderRo)
                .where(WorkOrderRo.work_order_id == wo.id)
                .order_by(WorkOrderRo.added_at.desc())
            )
        )
        .scalars()
        .all()
    )
    notes = list(
        (
            await session.execute(
                select(WorkOrderNote)
                .where(WorkOrderNote.work_order_id == wo.id)
                .order_by(WorkOrderNote.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    base = WorkOrderResponse.from_model(wo)
    return WorkOrderDetailResponse(
        **base.model_dump(),
        line_items=[LineItemResponse.from_model(li) for li in line_items],
        defect_resolutions=[DefectResolutionResp.from_model(dr) for dr in drs],
        ros=[WorkOrderRoResp.from_model(r) for r in ros],
        notes=[NoteResp.from_model(n) for n in notes],
    )


# ─────────────────────────────────────────────────────
# Lifecycle transitions
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/accept",
    response_model=WorkOrderResponse,
    summary="Vendor accepts a pending WO. Generates line items + DRs.",
)
async def accept_wo(
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    if wo.status != WorkOrderStatus.PENDING_ACCEPTANCE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO is {wo.status.value if hasattr(wo.status, 'value') else wo.status}; only pending_acceptance can be accepted",
        )

    prev = wo.status.value if hasattr(wo.status, "value") else str(wo.status)
    wo.status = WorkOrderStatus.ACCEPTED
    wo.accepted_at = utc_now()
    session.add(wo)
    # Flush so the trigger sees the new status; on external-mode workshops
    # without an RO this raises.
    try:
        await session.flush()
    except Exception as e:
        # asyncpg wraps trigger errors; surface a clean 409
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot accept: external-mode workshop requires at least one RO# attached first.",
        ) from e

    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=prev,
        to_status=WorkOrderStatus.ACCEPTED.value,
        actor_id=current.id,
    )
    await generate_line_items_on_accept(
        session, work_order_id=wo.id, actor_id=current.id
    )
    await session.commit()
    await session.refresh(wo)
    return WorkOrderResponse.from_model(wo)


@router.post(
    "/{wo_id}/decline",
    response_model=WorkOrderResponse,
    summary="Vendor declines a pending WO. Optionally re-routes to next vendor.",
)
async def decline_wo(
    body: DeclineBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    if wo.status != WorkOrderStatus.PENDING_ACCEPTANCE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO is {wo.status.value if hasattr(wo.status, 'value') else wo.status}; only pending_acceptance can be declined",
        )

    prev = wo.status.value if hasattr(wo.status, "value") else str(wo.status)
    declining_workshop_id = wo.vendor_workshop_id
    wo.status = WorkOrderStatus.DECLINED
    wo.declined_at = utc_now()
    wo.declined_reason = body.reason
    wo.decline_reason_code = body.decline_reason_code
    session.add(wo)

    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=prev,
        to_status=WorkOrderStatus.DECLINED.value,
        actor_id=current.id,
    )
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="declined",
        actor_id=current.id,
        details={"reason": body.reason, "reason_code": body.decline_reason_code},
    )

    # Try re-routing under the same RR if asked
    if body.reroute:
        await route_repair_request(
            session,
            repair_request_id=wo.repair_request_id,
            actor_id=current.id,
            exclude_workshop_ids=[declining_workshop_id],
        )

    await session.commit()
    await session.refresh(wo)
    return WorkOrderResponse.from_model(wo)


@router.post(
    "/{wo_id}/start",
    response_model=WorkOrderResponse,
    summary="Tech / vendor starts the work (in_progress)",
)
async def start_wo(
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN),
        lang=lang,
    )
    if wo.status != WorkOrderStatus.ACCEPTED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO is {wo.status.value if hasattr(wo.status, 'value') else wo.status}; only accepted can transition to in_progress",
        )

    prev = wo.status.value if hasattr(wo.status, "value") else str(wo.status)
    wo.status = WorkOrderStatus.IN_PROGRESS
    wo.in_progress_at = utc_now()
    session.add(wo)
    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=prev,
        to_status=WorkOrderStatus.IN_PROGRESS.value,
        actor_id=current.id,
    )
    await session.commit()
    await session.refresh(wo)
    return WorkOrderResponse.from_model(wo)


@router.post(
    "/{wo_id}/complete",
    response_model=WorkOrderResponse,
    summary="Mark WO as completed. Trigger blocks if defect_repair lacks links.",
)
async def complete_wo(
    body: CompleteBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN),
        lang=lang,
    )
    if wo.status != WorkOrderStatus.IN_PROGRESS:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO is {wo.status.value if hasattr(wo.status, 'value') else wo.status}; only in_progress can complete",
        )

    prev = wo.status.value if hasattr(wo.status, "value") else str(wo.status)

    # Auto-finalize any line items still in non-terminal states before
    # flipping the WO to completed. Bug discovered during E2E test:
    # without this step, line_items stayed in `pending` and the DR sync
    # left every DR at `pending` too — so a completed WO would show
    # "unresolved" defects.
    #
    # Rule: if the tech says the WO is done, every line item is `done`
    # *unless* it was explicitly deferred or declined earlier. We only
    # touch non-terminal items; explicit deferrals/declines stick.
    pending_lis = list(
        (
            await session.execute(
                select(WorkOrderLineItem).where(
                    WorkOrderLineItem.work_order_id == wo.id
                )
            )
        )
        .scalars()
        .all()
    )
    finalized_count = 0
    for li in pending_lis:
        li_status = li.status.value if hasattr(li.status, "value") else str(li.status)
        if li_status in (
            LineItemStatus.PENDING.value,
            LineItemStatus.PENDING_SCOPE_APPROVAL.value,
            LineItemStatus.PENDING_COST_APPROVAL.value,
            LineItemStatus.PENDING_VARIANCE_REAPPROVAL.value,
        ):
            li.status = LineItemStatus.DONE
            session.add(li)
            finalized_count += 1
            await log_status_change(
                session,
                entity_type=WoActivityLogEntityType.LINE_ITEM,
                entity_id=li.id,
                from_status=li_status,
                to_status=LineItemStatus.DONE.value,
                actor_id=current.id,
            )
    if finalized_count:
        await session.flush()

    wo.status = WorkOrderStatus.COMPLETED
    wo.completed_at = utc_now()
    if body.last_mileage is not None:
        wo.last_mileage = body.last_mileage
    session.add(wo)
    try:
        await session.flush()
    except Exception as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot complete: defect_repair line item(s) lack a defect link. "
            "Ensure every defect_repair item is tied to a defect resolution.",
        ) from e

    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=prev,
        to_status=WorkOrderStatus.COMPLETED.value,
        actor_id=current.id,
    )
    # Sync DR statuses now that line items are terminal
    await sync_all_drs_for_wo(session, work_order_id=wo.id, actor_id=current.id)
    await session.commit()
    await session.refresh(wo)
    return WorkOrderResponse.from_model(wo)


@router.post(
    "/{wo_id}/cancel",
    response_model=WorkOrderResponse,
    summary="Cancel a non-terminal WO (DSP, vendor, or admin)",
)
async def cancel_wo(
    body: CancelBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.DSP_OWNER, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    if wo.status in (
        WorkOrderStatus.COMPLETED,
        WorkOrderStatus.CANCELLED,
        WorkOrderStatus.DECLINED,
    ):
        return WorkOrderResponse.from_model(wo)

    prev = wo.status.value if hasattr(wo.status, "value") else str(wo.status)
    wo.status = WorkOrderStatus.CANCELLED
    wo.cancelled_at = utc_now()
    wo.cancelled_reason = body.reason
    session.add(wo)
    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=prev,
        to_status=WorkOrderStatus.CANCELLED.value,
        actor_id=current.id,
    )
    await session.commit()
    await session.refresh(wo)
    return WorkOrderResponse.from_model(wo)


@router.post(
    "/{wo_id}/assign-technician",
    response_model=WorkOrderResponse,
    summary="Assign / clear the WO's technician (vendor side)",
)
async def assign_technician(
    body: AssignTechBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    wo.assigned_technician_id = body.technician_id
    session.add(wo)
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="technician_assigned",
        actor_id=current.id,
        details={"technician_id": body.technician_id},
    )
    await session.commit()
    await session.refresh(wo)
    return WorkOrderResponse.from_model(wo)


# ─────────────────────────────────────────────────────
# Line items
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/line-items",
    response_model=LineItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a mid-repair line item (customer_request / vendor_addition / etc.)",
)
async def add_line_item(
    body: LineItemCreateBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LineItemResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    category = (
        LineItemCategory(body.category)
        if isinstance(body.category, str)
        else body.category
    )
    billing = (
        LineItemBillingType(body.billing_type)
        if isinstance(body.billing_type, str)
        else body.billing_type
    )
    li = await add_mid_repair_line_item(
        session,
        work_order_id=wo.id,
        description=body.description,
        category=category,
        billing_type=billing,
        estimated_price=body.estimated_price,
        customer_requested=body.customer_requested,
        actor_id=current.id,
    )
    await session.commit()
    await session.refresh(li)
    return LineItemResponse.from_model(li)


@router.patch(
    "/{wo_id}/line-items/{li_id}",
    response_model=LineItemResponse,
    summary="Patch a line item (price, status, notes, etc.)",
)
async def patch_line_item(
    body: LineItemPatchBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    li_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LineItemResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN),
        lang=lang,
    )
    li = (
        await session.execute(
            select(WorkOrderLineItem)
            .where(WorkOrderLineItem.id == li_id)
            .where(WorkOrderLineItem.work_order_id == wo.id)
        )
    ).scalar_one_or_none()
    if li is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "line item not found on this WO"
        )

    prev_status = li.status.value if hasattr(li.status, "value") else str(li.status)

    if body.description is not None:
        li.description = body.description
    if body.estimated_price is not None:
        li.estimated_price = body.estimated_price
    if body.final_price is not None:
        li.final_price = body.final_price
    if body.ro_id is not None:
        li.ro_id = body.ro_id
    if body.status is not None:
        li.status = LineItemStatus(body.status)
    if body.status_reason is not None:
        li.status_reason = body.status_reason
    if body.decline_reason_code is not None:
        li.decline_reason_code = body.decline_reason_code

    session.add(li)

    if body.status is not None and body.status != prev_status:
        await log_status_change(
            session,
            entity_type=WoActivityLogEntityType.LINE_ITEM,
            entity_id=li.id,
            from_status=prev_status,
            to_status=body.status,
            actor_id=current.id,
        )

    await session.commit()
    await session.refresh(li)
    return LineItemResponse.from_model(li)


@router.post(
    "/{wo_id}/line-items/{li_id}/defer",
    response_model=LineItemResponse,
    summary="Defer a line item (parts unavailable, etc.). Spawns a follow-up RR.",
)
async def defer_line_item(
    body: LineItemDeferBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    li_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LineItemResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN),
        lang=lang,
    )
    li = (
        await session.execute(
            select(WorkOrderLineItem)
            .where(WorkOrderLineItem.id == li_id)
            .where(WorkOrderLineItem.work_order_id == wo.id)
        )
    ).scalar_one_or_none()
    if li is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "line item not found on this WO"
        )
    await defer_line_item_with_followup_rr(
        session,
        line_item_id=li.id,
        reason_code=body.reason_code,
        status_reason=body.status_reason,
        actor_id=current.id,
    )
    await session.commit()
    await session.refresh(li)
    return LineItemResponse.from_model(li)


# ─────────────────────────────────────────────────────
# ROs
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/ros",
    response_model=WorkOrderRoResp,
    status_code=status.HTTP_201_CREATED,
    summary="Attach an RO# to the WO (vendor side)",
)
async def add_ro(
    body: RoCreateBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderRoResp:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )

    # If is_primary=True, demote any existing primary first.
    if body.is_primary:
        existing_primary = (
            await session.execute(
                select(WorkOrderRo)
                .where(WorkOrderRo.work_order_id == wo.id)
                .where(WorkOrderRo.is_primary.is_(True))
            )
        ).scalar_one_or_none()
        if existing_primary is not None:
            existing_primary.is_primary = False
            session.add(existing_primary)

    ro = WorkOrderRo(
        work_order_id=wo.id,
        ro_number=body.ro_number,
        is_primary=body.is_primary,
        modification_reason=body.modification_reason,
        added_by_id=current.id,
    )
    session.add(ro)
    await session.flush()
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.RO,
        entity_id=ro.id,
        action="ro_added",
        actor_id=current.id,
        details={
            "ro_number": body.ro_number,
            "is_primary": body.is_primary,
            "work_order_id": wo.id,
        },
    )
    await session.commit()
    await session.refresh(ro)
    return WorkOrderRoResp.from_model(ro)


@router.patch(
    "/{wo_id}/ros/{ro_id}",
    response_model=WorkOrderRoResp,
    summary="Patch an RO (toggle primary / set modification_reason)",
)
async def patch_ro(
    body: RoPatchBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    ro_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderRoResp:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    ro = (
        await session.execute(
            select(WorkOrderRo)
            .where(WorkOrderRo.id == ro_id)
            .where(WorkOrderRo.work_order_id == wo.id)
        )
    ).scalar_one_or_none()
    if ro is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "RO not found on this WO")

    if body.is_primary is True and not ro.is_primary:
        existing_primary = (
            await session.execute(
                select(WorkOrderRo)
                .where(WorkOrderRo.work_order_id == wo.id)
                .where(WorkOrderRo.is_primary.is_(True))
            )
        ).scalar_one_or_none()
        if existing_primary is not None:
            existing_primary.is_primary = False
            session.add(existing_primary)
        ro.is_primary = True
    elif body.is_primary is False:
        ro.is_primary = False
    if body.modification_reason is not None:
        ro.modification_reason = body.modification_reason
    session.add(ro)
    await session.commit()
    await session.refresh(ro)
    return WorkOrderRoResp.from_model(ro)


# ─────────────────────────────────────────────────────
# Notes
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/notes",
    response_model=NoteResp,
    status_code=status.HTTP_201_CREATED,
    summary="Append a note to the WO thread",
)
async def add_note(
    body: NoteBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteResp:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    if not await _can_view_wo(session, wo, current):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_WORK_ORDER, lang)
        )
    role = (
        NoteAuthorRole(body.author_role)
        if isinstance(body.author_role, str)
        else body.author_role
    )
    note = WorkOrderNote(
        work_order_id=wo.id,
        author_id=current.id,
        author_role=role,
        body=body.body,
    )
    session.add(note)
    await session.flush()
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.NOTE,
        entity_id=note.id,
        action="note_added",
        actor_id=current.id,
        details={"work_order_id": wo.id, "author_role": role.value},
    )
    await session.commit()
    await session.refresh(note)
    return NoteResp.from_model(note)
