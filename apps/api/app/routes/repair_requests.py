"""Repair Request endpoints — V2.0.

RRs are mostly created by the bundler service (synchronous on defect
approval). These endpoints surface them to the UI and offer two
operator-side actions:

  - POST /{id}/route   — force-route now, bypassing the bundling window.
                          Useful when an operator wants to push an RR out
                          of the holding period or when the cron driver
                          isn't running locally.
  - POST /{id}/cancel  — DSP cancels an RR that hasn't yet been routed.
                          If the RR has a WO already, cancel that WO too
                          (cascade-cancel).

Authorization:
  - site_admin: full visibility + mutation
  - dsp_owner: list/get/cancel/route their own DSP's RRs only
  - vendor_admin / technician: list/get RRs routed to their workshops
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.i18n_errors import E, tr_error
from app.i18n_helpers import get_request_language
from app.models.user import User, UserRole
from app.models.work_orders import (
    RepairRequest,
    RepairRequestDefect,
    RepairRequestStatus,
    VendorWorkshop,
    WoActivityLogEntityType,
    WorkOrder,
    WorkOrderStatus,
)
from app.services.wo_activity_log import log_status_change
from app.services.wo_router import route_repair_request

router = APIRouter(prefix="/repair-requests", tags=["repair-requests"])


# ─────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────
RR_STATUS = Literal["open", "accepted", "cancelled", "fulfilled", "stale"]
WO_STATUS = Literal[
    "pending_acceptance", "accepted", "in_progress",
    "completed", "cancelled", "declined",
]


class RepairRequestResponse(BaseModel):
    id: str
    vehicle_id: int
    dsp_id: int
    repair_type: str
    status: RR_STATUS
    is_rush: bool
    sla_due_at: datetime | None = None
    parent_repair_request_id: int | None = None
    defect_ids: list[int]
    work_order_ids: list[int]
    created_at: datetime
    updated_at: datetime
    created_by_id: int | None = None

    @classmethod
    def from_rows(
        cls,
        rr: RepairRequest,
        defect_ids: list[int],
        wo_ids: list[int],
    ) -> "RepairRequestResponse":
        return cls(
            id=rr.id_str,
            vehicle_id=rr.vehicle_id,
            dsp_id=rr.dsp_id,
            repair_type=(
                rr.repair_type.value
                if hasattr(rr.repair_type, "value")
                else str(rr.repair_type)
            ),
            status=(rr.status.value if hasattr(rr.status, "value") else str(rr.status)),
            is_rush=rr.is_rush,
            sla_due_at=rr.sla_due_at,
            parent_repair_request_id=rr.parent_repair_request_id,
            defect_ids=defect_ids,
            work_order_ids=wo_ids,
            created_at=rr.created_at,
            updated_at=rr.updated_at,
            created_by_id=rr.created_by_id,
        )


class RepairRequestListResponse(BaseModel):
    items: list[RepairRequestResponse]
    total: int


class CancelRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    model_config = ConfigDict(extra="forbid")


# ─────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────
def _parse_rr_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("RR-"):
        s = s[3:]
    try:
        return int(s)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid repair_request id: {raw!r}. Use int or 'RR-XXXXX'.",
        ) from e


async def _load_rr_or_404(session: AsyncSession, rr_id: int, lang: str) -> RepairRequest:
    rr = (
        await session.execute(select(RepairRequest).where(RepairRequest.id == rr_id))
    ).scalar_one_or_none()
    if rr is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.DEFECT_NOT_FOUND, lang)
        )
    return rr


async def _list_defect_ids(session: AsyncSession, rr_id: int) -> list[int]:
    return list(
        (
            await session.execute(
                select(RepairRequestDefect.defect_id).where(
                    RepairRequestDefect.repair_request_id == rr_id
                )
            )
        )
        .scalars()
        .all()
    )


async def _list_wo_ids(session: AsyncSession, rr_id: int) -> list[int]:
    return list(
        (
            await session.execute(
                select(WorkOrder.id).where(WorkOrder.repair_request_id == rr_id)
            )
        )
        .scalars()
        .all()
    )


async def _vendor_workshop_ids_for_user(session: AsyncSession, user: User) -> list[int]:
    """Return the workshop ids whose organization_id == user.organization_id."""
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


async def _can_view_rr(
    session: AsyncSession, rr: RepairRequest, user: User
) -> bool:
    if user.role == UserRole.SITE_ADMIN:
        return True
    if user.role == UserRole.DSP_OWNER:
        return rr.dsp_id == user.organization_id
    if user.role in (UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN):
        # Vendor/tech sees RRs that touch their workshops
        workshop_ids = await _vendor_workshop_ids_for_user(session, user)
        if not workshop_ids:
            return False
        count = (
            await session.execute(
                select(WorkOrder.id)
                .where(WorkOrder.repair_request_id == rr.id)
                .where(WorkOrder.vendor_workshop_id.in_(workshop_ids))
                .limit(1)
            )
        ).first()
        return count is not None
    return False


# ─────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────
@router.get(
    "",
    response_model=RepairRequestListResponse,
    summary="List repair requests (scoped to caller's role)",
)
async def list_repair_requests(
    request: Request,
    status_filter: RR_STATUS | None = Query(default=None, alias="status"),
    dsp_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RepairRequestListResponse:
    _ = get_request_language(request)
    stmt = select(RepairRequest)

    if current.role == UserRole.DSP_OWNER:
        stmt = stmt.where(RepairRequest.dsp_id == current.organization_id)
    elif current.role in (UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN):
        workshop_ids = await _vendor_workshop_ids_for_user(session, current)
        if not workshop_ids:
            return RepairRequestListResponse(items=[], total=0)
        # RRs that have at least one WO at one of our workshops
        rr_ids_subq = (
            select(WorkOrder.repair_request_id)
            .where(WorkOrder.vendor_workshop_id.in_(workshop_ids))
            .distinct()
        )
        stmt = stmt.where(RepairRequest.id.in_(rr_ids_subq))
    elif current.role == UserRole.SITE_ADMIN and dsp_id is not None:
        stmt = stmt.where(RepairRequest.dsp_id == dsp_id)

    if status_filter is not None:
        stmt = stmt.where(RepairRequest.status == status_filter)

    stmt = stmt.order_by(RepairRequest.created_at.desc()).limit(limit)
    rows = list((await session.execute(stmt)).scalars().all())

    items: list[RepairRequestResponse] = []
    for rr in rows:
        defect_ids = await _list_defect_ids(session, rr.id)
        wo_ids = await _list_wo_ids(session, rr.id)
        items.append(RepairRequestResponse.from_rows(rr, defect_ids, wo_ids))

    return RepairRequestListResponse(items=items, total=len(items))


@router.get(
    "/{rr_id}",
    response_model=RepairRequestResponse,
    summary="Get a repair request by id (accepts 'RR-NNNNN' or int)",
)
async def get_repair_request(
    request: Request,
    rr_id: str = Path(..., examples=["RR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RepairRequestResponse:
    lang = get_request_language(request)
    rr = await _load_rr_or_404(session, _parse_rr_id(rr_id), lang)
    if not await _can_view_rr(session, rr, current):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_DSP, lang)
        )
    defect_ids = await _list_defect_ids(session, rr.id)
    wo_ids = await _list_wo_ids(session, rr.id)
    return RepairRequestResponse.from_rows(rr, defect_ids, wo_ids)


@router.post(
    "/{rr_id}/route",
    response_model=RepairRequestResponse,
    summary="Force-route an open RR now (bypasses bundling window)",
)
async def force_route_rr(
    request: Request,
    rr_id: str = Path(..., examples=["RR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RepairRequestResponse:
    lang = get_request_language(request)
    rr = await _load_rr_or_404(session, _parse_rr_id(rr_id), lang)

    # site_admin, or DSP owner of the RR's DSP
    is_authorized = (
        current.role == UserRole.SITE_ADMIN
        or (
            current.role == UserRole.DSP_OWNER
            and rr.dsp_id == current.organization_id
        )
    )
    if not is_authorized:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_DSP, lang)
        )

    if rr.status != RepairRequestStatus.OPEN:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"repair_request is {rr.status.value if hasattr(rr.status, 'value') else rr.status}; only OPEN can be routed",
        )

    wo = await route_repair_request(
        session, repair_request_id=rr.id, actor_id=current.id
    )
    await session.commit()
    if wo is None:
        # Stays open, but we logged a no_eligible_vendor event
        await session.refresh(rr)
    else:
        await session.refresh(rr)

    defect_ids = await _list_defect_ids(session, rr.id)
    wo_ids = await _list_wo_ids(session, rr.id)
    return RepairRequestResponse.from_rows(rr, defect_ids, wo_ids)


@router.post(
    "/{rr_id}/cancel",
    response_model=RepairRequestResponse,
    summary="Cancel a repair request (cascades to any pending WOs)",
)
async def cancel_rr(
    body: CancelRequest,
    request: Request,
    rr_id: str = Path(..., examples=["RR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RepairRequestResponse:
    lang = get_request_language(request)
    rr = await _load_rr_or_404(session, _parse_rr_id(rr_id), lang)

    is_authorized = (
        current.role == UserRole.SITE_ADMIN
        or (
            current.role == UserRole.DSP_OWNER
            and rr.dsp_id == current.organization_id
        )
    )
    if not is_authorized:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_DSP, lang)
        )

    if rr.status in (RepairRequestStatus.CANCELLED, RepairRequestStatus.FULFILLED):
        # Idempotent: already terminal
        defect_ids = await _list_defect_ids(session, rr.id)
        wo_ids = await _list_wo_ids(session, rr.id)
        return RepairRequestResponse.from_rows(rr, defect_ids, wo_ids)

    prev = rr.status.value if hasattr(rr.status, "value") else str(rr.status)
    rr.status = RepairRequestStatus.CANCELLED
    session.add(rr)
    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
        entity_id=rr.id,
        from_status=prev,
        to_status=RepairRequestStatus.CANCELLED.value,
        actor_id=current.id,
    )

    # Cascade-cancel any non-terminal WOs under this RR
    wos = list(
        (
            await session.execute(
                select(WorkOrder).where(WorkOrder.repair_request_id == rr.id)
            )
        )
        .scalars()
        .all()
    )
    for wo in wos:
        if wo.status in (
            WorkOrderStatus.COMPLETED,
            WorkOrderStatus.CANCELLED,
            WorkOrderStatus.DECLINED,
        ):
            continue
        prev_wo = wo.status.value if hasattr(wo.status, "value") else str(wo.status)
        wo.status = WorkOrderStatus.CANCELLED
        wo.cancelled_reason = body.reason
        from app.models.base import utc_now
        wo.cancelled_at = utc_now()
        session.add(wo)
        await log_status_change(
            session,
            entity_type=WoActivityLogEntityType.WORK_ORDER,
            entity_id=wo.id,
            from_status=prev_wo,
            to_status=WorkOrderStatus.CANCELLED.value,
            actor_id=current.id,
        )

    await session.commit()
    await session.refresh(rr)

    defect_ids = await _list_defect_ids(session, rr.id)
    wo_ids = await _list_wo_ids(session, rr.id)
    return RepairRequestResponse.from_rows(rr, defect_ids, wo_ids)
