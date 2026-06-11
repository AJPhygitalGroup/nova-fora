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
from app.models.defect import Defect, DefectSource
from app.models.user import User, UserRole
from app.models.work_orders import (
    DefectResolution,
    DefectResolutionStatus,
    RepairRequest,
    RepairRequestDefect,
    RepairRequestStatus,
    RepairType,
    VendorWorkshop,
    WoActivityLogEntityType,
    WorkOrder,
    WorkOrderStatus,
)
from app.services.defect_validation import (
    DefectValidationError,
    validate_defect_write,
)
from app.services.pubsub import publish_defect_created
from app.services.wo_activity_log import log_event, log_status_change
from app.services.wo_router import route_repair_request
from app.services.permissions import is_dsp_role, is_vendor_role
from app.services.tenant_scope import resolve_dsp_scope

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
    """Return the workshop ids whose organization_id == user.organization_id.

    Covers ALL vendor roles (admin / service_writer / technician /
    vendor_viewer). The previous admin+technician-only gate let
    service_writer / vendor_viewer fall through the list-scoping chain
    into an unfiltered read (2026-06-08 review P0 #1)."""
    if not is_vendor_role(user.role):
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
    if is_dsp_role(user.role):
        # All DSP roles (owner / manager / inspector / viewer) see their
        # own org's repair requests.
        return rr.dsp_id == user.organization_id
    if is_vendor_role(user.role):
        # Any vendor role sees RRs that touch their workshops.
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

    # Centralized tenant scoping (2026-06-08 review P0 #1). The old chain
    # named only DSP_OWNER / VENDOR_ADMIN / TECHNICIAN; every other role
    # (dsp_manager, dsp_inspector, dsp_viewer, service_writer,
    # vendor_viewer) fell through with NO where-clause → an unfiltered
    # all-tenant read. Vendors stay workshop-scoped so they never see a
    # sibling vendor's RR at a shared DSP.
    scope = await resolve_dsp_scope(session, current, dsp_id)
    if is_dsp_role(current.role):
        stmt = stmt.where(RepairRequest.dsp_id.in_(list(scope.allowed_dsp_ids)))
    elif is_vendor_role(current.role):
        workshop_ids = scope.vendor_workshop_ids
        if not workshop_ids:
            return RepairRequestListResponse(items=[], total=0)
        # RRs that have at least one WO at one of our workshops
        rr_ids_subq = (
            select(WorkOrder.repair_request_id)
            .where(WorkOrder.vendor_workshop_id.in_(workshop_ids))
            .distinct()
        )
        stmt = stmt.where(RepairRequest.id.in_(rr_ids_subq))
    elif current.role == UserRole.SITE_ADMIN:
        if dsp_id is not None:
            stmt = stmt.where(RepairRequest.dsp_id == dsp_id)
    else:
        # Unknown / unhandled role — deny.
        return RepairRequestListResponse(items=[], total=0)

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


# ═════════════════════════════════════════════════════
# WO V2 iter-1 — mid-find (spec §7.C)
# ═════════════════════════════════════════════════════

# Roles that can surface a mid-visit defect: SW (recording on behalf of
# the tech), tech (direct from the bay), vendor admin, plus site_admin.
# Customer-side roles can't add a defect mid-visit — they don't physically
# see the vehicle.
_MID_FIND_ROLES = (
    UserRole.SERVICE_WRITER,
    UserRole.VENDOR_ADMIN,
    UserRole.TECHNICIAN,
    UserRole.SITE_ADMIN,
)


class MidFindCreateRequest(BaseModel):
    """Body for POST /repair-requests/{id}/add-defect.

    Mirrors DefectV2Create with three server-side constraints applied
    automatically:
      - source is forced to 'shop_finding'
      - inspection_id is forced to NULL
      - vehicle_id is read from the RR (UI sends nothing)
    Only (part, defect_type, position, details, notes) are the inspector's
    inputs.
    """

    model_config = ConfigDict(extra="forbid")

    part: str = Field(..., max_length=40, description="DefectPart enum value, e.g. 'headlight'")
    defect_type: str = Field(..., max_length=40, description="DefectType enum value, e.g. 'not_working'")
    position: str | None = Field(default=None, max_length=30)
    details: dict = Field(default_factory=dict)
    notes: str | None = Field(default=None, max_length=2000)


class MidFindCreateResponse(BaseModel):
    """Response — minimal acknowledgement so the SW UI can append to the
    running defect list and the customer side can pulse the "needs scope
    approval" chip. Frontend fetches the full defect via GET /defects/{id}.
    """

    defect_id: int
    repair_request_id: str
    active_wo_id: int | None = Field(
        default=None,
        description="The currently-active WO on this RR (if any). Helpful for "
                    "UI badges like 'Found during RO-12345'.",
    )
    reported_by_role: str = Field(
        ..., description="Role of the actor (UI uses this to label MID-FIND badges).",
    )


@router.post(
    "/{rr_id}/add-defect",
    response_model=MidFindCreateResponse,
    summary="SW / Tech: log a defect discovered mid-visit (spec §7.C)",
)
async def add_mid_find_defect(
    payload: MidFindCreateRequest,
    request: Request,
    rr_id: str = Path(..., description="RR-XXXXX or bare int"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MidFindCreateResponse:
    """Insert a defects row with source='shop_finding', link to the RR
    via repair_request_defects, log mid_finding_added. The customer then
    sees the defect with a MID-FIND badge on their scope-approval queue.

    Constraints enforced:
      - RR must be active (status in 'open', 'accepted').
      - Caller must be a vendor-side role with visibility on the RR
        (mirrors _can_view_rr's vendor branch).
      - The defect's (vehicle, part, defect_type, position) cannot
        duplicate an existing defects row — the functional unique
        index on the defects table raises IntegrityError → 409.
    """
    from sqlalchemy.exc import IntegrityError  # local import (only used here)

    lang = get_request_language(request)

    if current.role not in _MID_FIND_ROLES:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"role {current.role.value} cannot record mid-visit findings",
        )

    rrid = _parse_rr_id(rr_id)
    rr = await _load_rr_or_404(session, rrid, lang)

    if rr.status not in (RepairRequestStatus.OPEN, RepairRequestStatus.ACCEPTED):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"repair request status is {rr.status.value}; mid-find requires open or accepted",
        )

    if not await _can_view_rr(session, rr, current):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this repair request")

    # validate_defect_write needs the vehicle_class for V2.2 applicability
    # lookups; pull it now (the RR carries vehicle_id but not class).
    from app.models.vehicle import Vehicle as _Vehicle
    vehicle = (
        await session.execute(select(_Vehicle).where(_Vehicle.id == rr.vehicle_id))
    ).scalar_one_or_none()
    if vehicle is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"vehicle {rr.vehicle_id} not found for this RR",
        )

    try:
        await validate_defect_write(
            session,
            part=payload.part,
            defect_type=payload.defect_type,
            position=payload.position,
            details=payload.details,
            source=DefectSource.SHOP_FINDING,
            inspection_id=None,
            vehicle_class=vehicle.vehicle_class,
        )
    except DefectValidationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    new_defect = Defect(
        vehicle_id=rr.vehicle_id,
        inspection_id=None,
        source=DefectSource.SHOP_FINDING,
        part=payload.part,
        defect_type=payload.defect_type,
        position=payload.position,
        details=payload.details,
        notes=payload.notes,
        reported_by_id=current.id,
    )
    session.add(new_defect)
    try:
        await session.flush()
    except IntegrityError as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "an identical defect already exists on this vehicle",
        ) from e

    session.add(
        RepairRequestDefect(
            repair_request_id=rrid,
            defect_id=new_defect.id,
        )
    )

    active_wo_id: int | None = (
        await session.execute(
            select(WorkOrder.id)
            .where(WorkOrder.repair_request_id == rrid)
            .where(
                WorkOrder.status.in_(
                    [
                        WorkOrderStatus.PENDING_ACCEPTANCE,
                        WorkOrderStatus.ACCEPTED,
                        WorkOrderStatus.IN_PROGRESS,
                    ]
                )
            )
            .order_by(WorkOrder.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    await log_event(
        session,
        entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
        entity_id=rrid,
        action="mid_finding_added",
        actor_id=current.id,
        details={
            "defect_id": new_defect.id,
            "active_wo_id": active_wo_id,
            "reported_by_role": current.role.value,
            "part": payload.part,
            "defect_type": payload.defect_type,
            "position": payload.position,
        },
    )

    await session.commit()
    await session.refresh(new_defect)

    try:
        await publish_defect_created({
            "event": "defect_created",
            "defect_id": new_defect.id,
            "vehicle_id": rr.vehicle_id,
            "dsp_id": rr.dsp_id,
            "source": DefectSource.SHOP_FINDING.value,
            "mid_find": True,
            "repair_request_id": rrid,
        })
    except Exception:  # noqa: BLE001
        pass

    return MidFindCreateResponse(
        defect_id=new_defect.id,
        repair_request_id=rr.id_str,
        active_wo_id=active_wo_id,
        reported_by_role=current.role.value,
    )


# ═════════════════════════════════════════════════════
# WO V2 iter-1 — Defer-with-clone (spec §7.H)
# ═════════════════════════════════════════════════════
#
# When SW realises a defect can't be completed on the current visit
# (parts pending, vendor mismatch, fmc declined, etc.) the defect spawns
# a follow-up RR linked to the original via parent_repair_request_id.
# Spec §7.H semantics:
#   1. Source DefectResolution.status → DEFERRED (per WO that has it).
#   2. New RR created, parent_repair_request_id = source RR.
#   3. SAME defect linked to new RR via RepairRequestDefect.
#         (Defect is SHARED, not moved — the defect row itself doesn't
#          carry an RR pointer.)
#   4. Router picks vendor for new RR → spawns new WO automatically.
#   5. wo_activity_log:defect_moved on the SOURCE RR.
#
# Different from `defer_line_item` (which exists for the line-item flow
# we keep dormant in iter-1). This one is defect-level.


class DeferDefectBody(BaseModel):
    """Body for POST /repair-requests/{rr_id}/defer-defect."""

    model_config = ConfigDict(extra="forbid")

    defect_id: int = Field(..., description="ID of the defect to spin off into a follow-up RR.")
    reason: str = Field(
        ..., min_length=1, max_length=500,
        description="Free-text reason. Becomes the DR.notes + the activity-log details payload.",
    )
    repair_type: str | None = Field(
        default=None,
        description="Override the source RR's repair_type for the new RR (e.g., spec'd "
                    "as 'mechanical' originally but the follow-up is body work). Defaults "
                    "to source RR's repair_type.",
    )
    target_workshop_id: int | None = Field(
        default=None,
        description="Force-route the follow-up to this workshop (DSP override on the "
                    "router's auto-pick). The workshop must handle the new RR's repair_type.",
    )
    exclude_workshop_ids: list[int] = Field(
        default_factory=list,
        description="Workshops to skip when auto-picking the follow-up vendor. Useful when "
                    "the source vendor is the one that can't do the work.",
    )


class DeferDefectResponse(BaseModel):
    source_repair_request_id: str
    new_repair_request_id: str
    new_work_order_id: str | None = Field(
        default=None,
        description="None when routing found no eligible vendor — the new RR exists in 'open' "
                    "status, awaiting an operator to add a vendor or re-route manually.",
    )
    defect_id: int
    deferred_defect_resolution_ids: list[int] = Field(
        ..., description="DefectResolution rows on source-RR child WOs that were flipped to DEFERRED.",
    )


@router.post(
    "/{rr_id}/defer-defect",
    response_model=DeferDefectResponse,
    summary="SW / Tech: defer a defect to a follow-up RR (spec §7.H)",
)
async def defer_defect_to_followup(
    payload: DeferDefectBody,
    request: Request,
    rr_id: str = Path(..., description="Source RR (RR-XXXXX or bare int)"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DeferDefectResponse:
    """Spawn a follow-up RR for a defect that can't be completed on the
    current visit. Source-side DefectResolutions for the defect flip to
    DEFERRED; the same defect is re-linked to the new RR (shared, not
    moved); router picks a vendor for the follow-up.

    Auth: vendor-side roles only (DSP cannot defer — that's a "we can't
    do this today" call that lives with the SW / tech).
    """
    from app.services.wo_rr_status import refresh_rr_status  # local import
    from app.services.wo_router import route_repair_request  # already imported above

    lang = get_request_language(request)

    if current.role not in _MID_FIND_ROLES:  # same vendor-side set as mid-find
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"role {current.role.value} cannot defer a defect",
        )

    src_rrid = _parse_rr_id(rr_id)
    src_rr = await _load_rr_or_404(session, src_rrid, lang)

    if src_rr.status not in (RepairRequestStatus.OPEN, RepairRequestStatus.ACCEPTED):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"source RR status is {src_rr.status.value}; defer requires open or accepted",
        )
    if not await _can_view_rr(session, src_rr, current):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this repair request")

    # Defect must actually be linked to this RR.
    link_exists = (
        await session.execute(
            select(RepairRequestDefect)
            .where(RepairRequestDefect.repair_request_id == src_rrid)
            .where(RepairRequestDefect.defect_id == payload.defect_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if link_exists is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"defect {payload.defect_id} is not on repair request {src_rr.id_str}",
        )

    # Determine the new RR's repair_type. Validate enum on override.
    if payload.repair_type is not None:
        try:
            new_type = RepairType(payload.repair_type)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"unknown repair_type {payload.repair_type!r}",
            ) from None
    else:
        new_type = src_rr.repair_type

    # Step 1 — flip source-side DefectResolutions for this defect.
    src_wo_ids = await _list_wo_ids(session, src_rrid)
    deferred_dr_ids: list[int] = []
    if src_wo_ids:
        src_drs = list(
            (
                await session.execute(
                    select(DefectResolution)
                    .where(DefectResolution.work_order_id.in_(src_wo_ids))
                    .where(DefectResolution.defect_id == payload.defect_id)
                )
            ).scalars()
        )
        for dr in src_drs:
            if dr.status == DefectResolutionStatus.RESOLVED:
                # Already done on this visit — skip (don't flip to deferred,
                # would be a data lie). Most paths won't hit this since SW
                # only defers from in-progress visits.
                continue
            dr.status = DefectResolutionStatus.DEFERRED
            # Append-not-overwrite: preserve existing notes.
            dr.notes = (
                f"{dr.notes}\n[deferred] {payload.reason}"
                if dr.notes else f"[deferred] {payload.reason}"
            )
            session.add(dr)
            deferred_dr_ids.append(dr.id)

    # Step 2 — create the new RR with parent pointer.
    new_rr = RepairRequest(
        vehicle_id=src_rr.vehicle_id,
        dsp_id=src_rr.dsp_id,
        repair_type=new_type,
        status=RepairRequestStatus.OPEN,
        is_rush=src_rr.is_rush,  # carry the rush flag forward
        parent_repair_request_id=src_rrid,
        created_by_id=current.id,
    )
    session.add(new_rr)
    await session.flush()  # populate new_rr.id

    # Step 3 — link the SAME defect to the new RR. Composite PK so it's
    # either inserted or 409 (which would be a logic bug — we just made
    # the RR).
    session.add(
        RepairRequestDefect(
            repair_request_id=new_rr.id,
            defect_id=payload.defect_id,
        )
    )
    await session.flush()

    # Step 4 — route the new RR (creates its WO).
    new_wo = await route_repair_request(
        session,
        repair_request_id=new_rr.id,
        actor_id=current.id,
        exclude_workshop_ids=payload.exclude_workshop_ids or None,
        target_workshop_id=payload.target_workshop_id,
    )
    # new_wo can be None (no eligible vendor) — the router already emitted
    # `no_eligible_vendor`. We still return success; operator handles it.

    # Step 5 — defect_moved on the SOURCE RR for audit lineage.
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
        entity_id=src_rrid,
        action="defect_moved",
        actor_id=current.id,
        details={
            "defect_id": payload.defect_id,
            "source_rr_id": src_rrid,
            "destination_rr_id": new_rr.id,
            "destination_wo_id": new_wo.id if new_wo else None,
            "reason": payload.reason,
            "repair_type": new_type.value,
            "deferred_defect_resolution_ids": deferred_dr_ids,
            "by_role": current.role.value,
        },
    )

    # Step 6 — RR status refresh on the source (deferred DRs don't change
    # WO status, so the source rollup typically stays at 'accepted').
    await refresh_rr_status(
        session, repair_request_id=src_rrid, actor_id=current.id
    )

    await session.commit()
    await session.refresh(new_rr)

    return DeferDefectResponse(
        source_repair_request_id=src_rr.id_str,
        new_repair_request_id=new_rr.id_str,
        new_work_order_id=(
            f"WO-{new_wo.id:05d}" if new_wo and new_wo.id is not None else None
        ),
        defect_id=payload.defect_id,
        deferred_defect_resolution_ids=deferred_dr_ids,
    )
