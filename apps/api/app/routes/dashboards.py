"""Dashboard counter endpoints — aggregate tiles for the SW + DSP homes.

Spec mapping (post-John-meeting):

  - SW (Service Writer) view header chips: pending / pending_parts /
    pending_fmc / ready_to_schedule / in_progress / declined / completed /
    cancelled.  These are NOT the raw wo.status enum — several are
    *derived* states (parts-flow, FMC-flow, ready-to-schedule gating)
    computed from work_order_ros.* sync columns. Centralising the derivation
    here means the frontend just renders the response.

  - DSP (Customer) view header tiles: vans_in_service / approve_cost /
    approve_defects / confirm_pickup / in_progress.  Each is a count over
    a different table — bundling them in a single endpoint lets the
    dashboard render in one fetch instead of four.

The endpoints are read-only and tenancy-scoped at the route layer (a DSP
caller may only see their own DSP's tiles; a vendor caller may only see
their own workshops' chips).

Why a separate router (not bolted into work_orders.py): keeps the WO
file from sprawling further and groups the read-only "give me numbers"
endpoints together so future tile additions land in one obvious place.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.defect import Defect
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.models.work_orders import (
    DefectReview,
    VendorWorkshop,
    WorkOrder,
    WorkOrderRo,
    WorkOrderStatus,
)

router = APIRouter(prefix="/dashboards", tags=["dashboards"])


# ═════════════════════════════════════════════════════
# Helpers — tenancy resolution
# ═════════════════════════════════════════════════════
async def _vendor_workshop_ids_for(
    session: AsyncSession, user: User
) -> list[int]:
    """All workshop ids attached to the user's vendor organization."""
    if user.organization_id is None:
        return []
    rows = (
        await session.execute(
            select(VendorWorkshop.id).where(
                VendorWorkshop.organization_id == user.organization_id
            )
        )
    ).scalars().all()
    return list(rows)


# ═════════════════════════════════════════════════════
# Service Writer dashboard counters
# ═════════════════════════════════════════════════════
class SwCounters(BaseModel):
    """Eight chips at the top of the SW dashboard.

    All counts are mutually exclusive at the row level — a WO is in
    exactly one bucket. The derived buckets (pending_parts, pending_fmc,
    ready_to_schedule) live inside `accepted` and split based on
    `work_order_ros.*` sync columns of the WO's primary RO.

    The ordering of the if/elif chain in the SQL CASE matters: a WO that
    has both parts_ordered_at IS NOT NULL and submitted_to_fmc_at IS NOT
    NULL is classified as 'pending_fmc' (the latest stage wins).
    """

    pending: int = Field(0, description="wo.status='pending_acceptance'")
    pending_parts: int = Field(
        0,
        description="accepted AND ro.parts_ordered_at IS NOT NULL AND "
                    "ro.parts_received_at IS NULL AND nothing later",
    )
    pending_fmc: int = Field(
        0,
        description="accepted AND ro.submitted_to_fmc_at IS NOT NULL AND "
                    "ro.fmc_approved_at IS NULL",
    )
    ready_to_schedule: int = Field(
        0,
        description="accepted AND past all gates AND ro.scheduled_start_at IS NULL "
                    "AND ro.pickup_type IS NULL",
    )
    awaiting_customer: int = Field(
        0,
        description="accepted AND ro.pickup_type IS NOT NULL AND "
                    "ro.scheduled_start_at IS NULL — SW asked DSP to drop off, "
                    "DSP hasn't responded yet (renders as the AWAITING CUSTOMER badge).",
    )
    in_progress: int = Field(0, description="wo.status='in_progress'")
    declined: int = Field(0, description="wo.status='declined'")
    completed: int = Field(0, description="wo.status='completed'")
    cancelled: int = Field(0, description="wo.status='cancelled'")


def _classify_accepted(ro: WorkOrderRo | None) -> str:
    """Return the SW chip bucket for a WO whose status='accepted'.

    Lives next to SwCounters so the rule is one place. Mirrors the SQL
    derivation but for a single row (used when we fetch full WO+RO rows
    in another endpoint that wants to label them).
    """
    if ro is None:
        return "ready_to_schedule"
    if ro.pickup_type is not None and ro.scheduled_start_at is None:  # type: ignore[attr-defined]
        return "awaiting_customer"
    if ro.submitted_to_fmc_at is not None and ro.fmc_approved_at is None:
        return "pending_fmc"
    if ro.parts_ordered_at is not None and ro.parts_received_at is None:
        return "pending_parts"
    return "ready_to_schedule"


@router.get(
    "/sw/{vendor_workshop_id}/counters",
    response_model=SwCounters,
    summary="Service Writer dashboard chips (status + derived buckets)",
)
async def sw_counters(
    vendor_workshop_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SwCounters:
    """Read-only — derives the 8 SW chips with a single grouped query.

    Tenancy: vendor_admin / service_writer / technician must own the
    workshop; site_admin can hit any.
    """
    # Authorise: workshop must belong to the caller's vendor org.
    if current.role != UserRole.SITE_ADMIN:
        allowed = await _vendor_workshop_ids_for(session, current)
        if vendor_workshop_id not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "workshop not under your vendor"
            )

    # Pull the WO + its primary RO (LEFT join so WOs without an RO row yet
    # still get counted in the right bucket). A single roundtrip is cheap
    # vs. 8 separate COUNT() queries.
    stmt = (
        select(WorkOrder, WorkOrderRo)
        .outerjoin(
            WorkOrderRo,
            and_(
                WorkOrderRo.work_order_id == WorkOrder.id,
                WorkOrderRo.is_primary.is_(True),
            ),
        )
        .where(WorkOrder.vendor_workshop_id == vendor_workshop_id)
    )

    counters = SwCounters()
    for wo, ro in (await session.execute(stmt)).all():
        s = wo.status.value if hasattr(wo.status, "value") else str(wo.status)
        if s == "pending_acceptance":
            counters.pending += 1
        elif s == "in_progress":
            counters.in_progress += 1
        elif s == "declined":
            counters.declined += 1
        elif s == "completed":
            counters.completed += 1
        elif s == "cancelled":
            counters.cancelled += 1
        elif s == "accepted":
            bucket = _classify_accepted(ro)
            if bucket == "awaiting_customer":
                counters.awaiting_customer += 1
            elif bucket == "pending_fmc":
                counters.pending_fmc += 1
            elif bucket == "pending_parts":
                counters.pending_parts += 1
            else:
                counters.ready_to_schedule += 1
        # else: future statuses fall through silently

    return counters


# ═════════════════════════════════════════════════════
# DSP (Customer) dashboard counters
# ═════════════════════════════════════════════════════
class DspCounters(BaseModel):
    """Five tiles at the top of the DSP Customer dashboard.

    All scoped to a single DSP org. Approve-cost + approve-defects are
    counts of pending DSP decisions — they drive the red badges that
    tell the owner "you have N things waiting on you".
    """

    vans_in_service: int = Field(
        0,
        description="Distinct vehicles with at least one open WO (pending_acceptance / "
                    "accepted / in_progress).",
    )
    approve_cost: int = Field(
        0,
        description="Defects whose SW set estimated_cost and customer hasn't decided yet "
                    "(estimated_cost IS NOT NULL AND cost_decision IS NULL).",
    )
    approve_defects: int = Field(
        0,
        description="Defects awaiting customer scope review (no DefectReview row yet).",
    )
    confirm_pickup: int = Field(
        0,
        description="WOs where SW sent a pickup request and DSP hasn't confirmed yet "
                    "(ro.pickup_type IS NOT NULL AND ro.scheduled_start_at IS NULL).",
    )
    in_progress: int = Field(0, description="wo.status='in_progress'")


@router.get(
    "/dsp/{dsp_id}/counters",
    response_model=DspCounters,
    summary="DSP Customer dashboard tiles (one fetch, five counts)",
)
async def dsp_counters(
    dsp_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DspCounters:
    """Read-only — packs the 5 customer tiles in one round trip.

    Tenancy: dsp_owner / dsp_manager / dsp_inspector / dsp_viewer must
    belong to the DSP; site_admin can hit any.
    """
    if current.role != UserRole.SITE_ADMIN:
        if current.organization_id != dsp_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "not your DSP"
            )

    counters = DspCounters()

    # ── vans_in_service ─────────────────────────────────────
    # Distinct vehicle_id from WOs that are still in flight for this DSP.
    open_statuses = [
        WorkOrderStatus.PENDING_ACCEPTANCE.value,
        WorkOrderStatus.ACCEPTED.value,
        WorkOrderStatus.IN_PROGRESS.value,
    ]
    vans_q = (
        select(func.count(func.distinct(WorkOrder.vehicle_id)))
        .where(WorkOrder.dsp_id == dsp_id)
        .where(WorkOrder.status.in_(open_statuses))
    )
    counters.vans_in_service = (
        (await session.execute(vans_q)).scalar() or 0
    )

    # ── in_progress ─────────────────────────────────────────
    ip_q = (
        select(func.count(WorkOrder.id))
        .where(WorkOrder.dsp_id == dsp_id)
        .where(WorkOrder.status == WorkOrderStatus.IN_PROGRESS.value)
    )
    counters.in_progress = (await session.execute(ip_q)).scalar() or 0

    # ── confirm_pickup ──────────────────────────────────────
    # COUNT(DISTINCT wo) where SW already sent the pickup request and the
    # DSP hasn't responded. Vehicle-scoped duplication isn't an issue
    # because we count work_orders, not ros — the frontend collapses sibling
    # WOs at render time when it groups by van.
    pickup_q = (
        select(func.count(func.distinct(WorkOrder.id)))
        .join(WorkOrderRo, WorkOrderRo.work_order_id == WorkOrder.id)
        .where(WorkOrder.dsp_id == dsp_id)
        .where(WorkOrder.status == WorkOrderStatus.ACCEPTED.value)
        .where(WorkOrderRo.is_primary.is_(True))
        .where(WorkOrderRo.pickup_type.is_not(None))
        .where(WorkOrderRo.scheduled_start_at.is_(None))
    )
    counters.confirm_pickup = (await session.execute(pickup_q)).scalar() or 0

    # ── approve_cost ────────────────────────────────────────
    # Defects with estimated_cost set but cost_decision still NULL,
    # scoped to vehicles owned by this DSP.
    cost_q = (
        select(func.count(Defect.id))
        .join(Vehicle, Vehicle.id == Defect.vehicle_id)
        .where(Vehicle.dsp_id == dsp_id)
        .where(Defect.estimated_cost.is_not(None))
        .where(Defect.cost_decision.is_(None))
    )
    counters.approve_cost = (await session.execute(cost_q)).scalar() or 0

    # ── approve_defects ─────────────────────────────────────
    # Defects with no review row yet (mirrors the review_queue logic).
    review_q = (
        select(func.count(Defect.id))
        .join(Vehicle, Vehicle.id == Defect.vehicle_id)
        .outerjoin(DefectReview, DefectReview.defect_id == Defect.id)
        .where(Vehicle.dsp_id == dsp_id)
        .where(DefectReview.id.is_(None))
    )
    counters.approve_defects = (await session.execute(review_q)).scalar() or 0

    return counters
