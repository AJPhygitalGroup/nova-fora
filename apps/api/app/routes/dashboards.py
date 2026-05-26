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

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.defect import Defect, DefectSource
from app.models.inspection import Inspection
from app.models.organization import Organization, OrgType
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.models.work_orders import (
    DefectReview,
    DvicNightlyConfirmation,
    RepairRequest,
    RepairRequestDefect,
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


# ═════════════════════════════════════════════════════
# Vendor Home dashboard — landing page for vendor roles
# ═════════════════════════════════════════════════════
#
# Distinct from the SW Work-Orders view counters above. This is the
# vendor's first screen when they log in — answers "what should I
# care about right now across all my DSPs?"
#
# Scope: a single vendor_workshop. Counts span every DSP the workshop
# services (not just one). A `dsp_id` filter on the endpoint lets the
# SW narrow the view to one customer at a time — matches Jorge's note
# on page 2 of the mockup ("can we add a Filter that enables Service
# Writers to select specific DSPs, so that the Service Writer sees the
# exact figures that the customer is also seeing?").
#
# Tile contract (matches mockup page 2 — 5 KPI tiles):
#   • ad_hoc_defects_24h    — defects with source='dsp_request' OR
#                               'shop_finding' AND reported_at >= now-24h
#   • rush_orders           — WOs with is_rush=true, non-terminal
#   • vans_inspected_today  — distinct vehicles with an inspection today
#   • vans_total            — distinct vehicles across served DSPs
#   • new_defects_today     — defects.reported_at >= today
#   • defects_pending_fmc   — DSP-side approvals waiting on FMC
#                              (defect.estimated_cost set + cost_decision NULL,
#                              billing_type='amr', meaning Amazon FMC)
#   • defects_pending_fmc_total — denominator the mockup shows ("0 of 51")
#   • scheduled_repairs_count   — WOs with ro.scheduled_start_at set
#                              in the next 48 hours
#   • defects_repaired_week — DefectResolutions transitioned to RESOLVED
#                              in the current week
#   • defects_repaired_pct_change — % vs previous week (sign-aware)
#   • pending_feedback      — completed defects where customer hasn't
#                              reviewed yet within the 7-day window
class VendorHomeCounters(BaseModel):
    ad_hoc_defects_24h: int = 0
    rush_orders: int = 0
    vans_inspected_today: int = 0
    vans_total: int = 0
    new_defects_today: int = 0
    defects_pending_fmc: int = 0
    defects_pending_fmc_total: int = 0
    scheduled_repairs_count: int = 0
    defects_repaired_week: int = 0
    defects_repaired_pct_change: int = 0
    pending_feedback: int = 0


async def _dsp_ids_for_workshop(session: AsyncSession, workshop_id: int) -> list[int]:
    """All DSP org ids that this workshop has ever served (via WOs)."""
    rows = (
        await session.execute(
            select(WorkOrder.dsp_id)
            .where(WorkOrder.vendor_workshop_id == workshop_id)
            .distinct()
        )
    ).scalars().all()
    return list(rows)


@router.get(
    "/vendor-home/{vendor_workshop_id}/counters",
    response_model=VendorHomeCounters,
    summary="Vendor Home dashboard tiles (workshop-scoped, optionally per-DSP)",
)
async def vendor_home_counters(
    vendor_workshop_id: int = Path(..., ge=1),
    dsp_id: int | None = Query(default=None, description="Optional filter to one DSP"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VendorHomeCounters:
    """Read-only — packs the Vendor Home page tiles in one fetch.

    Tenancy: vendor_admin / service_writer / technician must own the
    workshop; site_admin can hit any. dsp_id filter narrows the counts
    to a single customer (matches what the DSP sees in their view).
    """
    if current.role != UserRole.SITE_ADMIN:
        allowed = await _vendor_workshop_ids_for(session, current)
        if vendor_workshop_id not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "workshop not under your vendor"
            )

    counters = VendorHomeCounters()
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    h24_ago = now - timedelta(hours=24)
    week_start = today_start - timedelta(days=today_start.weekday())  # Monday
    prev_week_start = week_start - timedelta(days=7)
    horizon_48h = now + timedelta(hours=48)

    # Universe of DSP ids the workshop services. If dsp_id filter is set,
    # narrow to that one (validating it's in the served set).
    served_dsp_ids = await _dsp_ids_for_workshop(session, vendor_workshop_id)
    if dsp_id is not None:
        if dsp_id not in served_dsp_ids:
            # Out-of-scope DSP — return zeros silently rather than 403; the
            # SW may have just deselected a DSP they previously served.
            return counters
        scoped_dsp_ids: list[int] = [dsp_id]
    else:
        scoped_dsp_ids = served_dsp_ids

    if not scoped_dsp_ids:
        return counters  # workshop has no served DSPs yet → empty

    # Vehicle universe for these DSPs (used by vans_inspected + total).
    vehicle_rows = (
        await session.execute(
            select(Vehicle.id).where(Vehicle.dsp_id.in_(scoped_dsp_ids))
            .where(Vehicle.is_active.is_(True))
        )
    ).scalars().all()
    vehicle_ids = list(vehicle_rows)
    counters.vans_total = len(vehicle_ids)

    if vehicle_ids:
        # ── vans_inspected_today ─────────────────────────
        inspected_today = (
            await session.execute(
                select(func.count(func.distinct(Inspection.vehicle_id)))
                .where(Inspection.vehicle_id.in_(vehicle_ids))
                .where(Inspection.created_at >= today_start)
            )
        ).scalar() or 0
        counters.vans_inspected_today = int(inspected_today)

        # ── new_defects_today (across all sources) ──────
        new_today = (
            await session.execute(
                select(func.count(Defect.id))
                .where(Defect.vehicle_id.in_(vehicle_ids))
                .where(Defect.reported_at >= today_start)
            )
        ).scalar() or 0
        counters.new_defects_today = int(new_today)

        # ── ad_hoc_defects_24h (only non-inspection sources) ─
        adhoc = (
            await session.execute(
                select(func.count(Defect.id))
                .where(Defect.vehicle_id.in_(vehicle_ids))
                .where(Defect.reported_at >= h24_ago)
                .where(Defect.source.in_([
                    DefectSource.MAINTENANCE_REQUEST.value,
                    DefectSource.DRIVER_REPORT.value,
                    DefectSource.CUSTOMER_REPORT.value,
                    DefectSource.SHOP_FINDING.value,
                    DefectSource.OTHER.value,
                ]))
            )
        ).scalar() or 0
        counters.ad_hoc_defects_24h = int(adhoc)

    # ── rush_orders (WOs at this workshop, non-terminal, is_rush) ─
    rush_q = (
        select(func.count(WorkOrder.id))
        .where(WorkOrder.vendor_workshop_id == vendor_workshop_id)
        .where(WorkOrder.is_rush.is_(True))
        .where(WorkOrder.dsp_id.in_(scoped_dsp_ids))
        .where(WorkOrder.status.in_([
            WorkOrderStatus.PENDING_ACCEPTANCE.value,
            WorkOrderStatus.ACCEPTED.value,
            WorkOrderStatus.IN_PROGRESS.value,
        ]))
    )
    counters.rush_orders = int((await session.execute(rush_q)).scalar() or 0)

    # ── defects_pending_fmc — proxy: WOs at this workshop where the
    # primary RO has submitted_to_fmc_at IS NOT NULL AND fmc_approved_at
    # IS NULL. Total = all WOs in pending+accepted (the universe that COULD
    # be pending FMC) so the SW sees "0 of 51".
    pending_fmc = (
        await session.execute(
            select(func.count(func.distinct(WorkOrder.id)))
            .join(WorkOrderRo, WorkOrderRo.work_order_id == WorkOrder.id)
            .where(WorkOrder.vendor_workshop_id == vendor_workshop_id)
            .where(WorkOrder.dsp_id.in_(scoped_dsp_ids))
            .where(WorkOrderRo.is_primary.is_(True))
            .where(WorkOrderRo.submitted_to_fmc_at.is_not(None))
            .where(WorkOrderRo.fmc_approved_at.is_(None))
        )
    ).scalar() or 0
    counters.defects_pending_fmc = int(pending_fmc)
    pending_fmc_total = (
        await session.execute(
            select(func.count(WorkOrder.id))
            .where(WorkOrder.vendor_workshop_id == vendor_workshop_id)
            .where(WorkOrder.dsp_id.in_(scoped_dsp_ids))
            .where(WorkOrder.status.in_([
                WorkOrderStatus.PENDING_ACCEPTANCE.value,
                WorkOrderStatus.ACCEPTED.value,
                WorkOrderStatus.IN_PROGRESS.value,
            ]))
        )
    ).scalar() or 0
    counters.defects_pending_fmc_total = int(pending_fmc_total)

    # ── scheduled_repairs_count ─────────────────────────
    scheduled = (
        await session.execute(
            select(func.count(func.distinct(WorkOrder.id)))
            .join(WorkOrderRo, WorkOrderRo.work_order_id == WorkOrder.id)
            .where(WorkOrder.vendor_workshop_id == vendor_workshop_id)
            .where(WorkOrder.dsp_id.in_(scoped_dsp_ids))
            .where(WorkOrderRo.is_primary.is_(True))
            .where(WorkOrderRo.scheduled_start_at.is_not(None))
            .where(WorkOrderRo.scheduled_start_at <= horizon_48h)
            .where(WorkOrderRo.scheduled_start_at >= now)
            .where(WorkOrder.status.in_([
                WorkOrderStatus.ACCEPTED.value,
                WorkOrderStatus.IN_PROGRESS.value,
            ]))
        )
    ).scalar() or 0
    counters.scheduled_repairs_count = int(scheduled)

    # ── defects_repaired_week + pct change vs prev week ─
    # Use WO.completed_at as proxy for "defect repaired" (each completed
    # WO closes its bundle of defects). Counts WOs, not defects, for
    # iter-1 simplicity.
    this_week = (
        await session.execute(
            select(func.count(WorkOrder.id))
            .where(WorkOrder.vendor_workshop_id == vendor_workshop_id)
            .where(WorkOrder.dsp_id.in_(scoped_dsp_ids))
            .where(WorkOrder.status == WorkOrderStatus.COMPLETED.value)
            .where(WorkOrder.completed_at >= week_start)
        )
    ).scalar() or 0
    prev_week = (
        await session.execute(
            select(func.count(WorkOrder.id))
            .where(WorkOrder.vendor_workshop_id == vendor_workshop_id)
            .where(WorkOrder.dsp_id.in_(scoped_dsp_ids))
            .where(WorkOrder.status == WorkOrderStatus.COMPLETED.value)
            .where(WorkOrder.completed_at >= prev_week_start)
            .where(WorkOrder.completed_at < week_start)
        )
    ).scalar() or 0
    counters.defects_repaired_week = int(this_week)
    if prev_week > 0:
        counters.defects_repaired_pct_change = int(
            round((this_week - prev_week) / prev_week * 100)
        )
    elif this_week > 0:
        counters.defects_repaired_pct_change = 100  # came from zero
    else:
        counters.defects_repaired_pct_change = 0

    # ── pending_feedback ────────────────────────────────
    # Completed WOs in the last 7 days where DSP hasn't reviewed yet.
    # Iter-1 proxy: count completed WOs without a DefectReview decision
    # on any of their defects.  TODO iter-2: dedicated review-feedback
    # column once we ship the customer survey post-completion.
    seven_days_ago = now - timedelta(days=7)
    pending_fb = (
        await session.execute(
            select(func.count(func.distinct(WorkOrder.id)))
            .where(WorkOrder.vendor_workshop_id == vendor_workshop_id)
            .where(WorkOrder.dsp_id.in_(scoped_dsp_ids))
            .where(WorkOrder.status == WorkOrderStatus.COMPLETED.value)
            .where(WorkOrder.completed_at >= seven_days_ago)
        )
    ).scalar() or 0
    counters.pending_feedback = int(pending_fb)

    return counters


# ─────────────────────────────────────────────────────
# Ad-hoc defects modal — list view
# ─────────────────────────────────────────────────────
class AdHocDefectRow(BaseModel):
    id: int
    id_str: str
    part: str | None = None
    defect_type: str | None = None
    position: str | None = None
    source: str
    reported_at: datetime
    dsp_id: int | None = None
    dsp_name: str | None = None


@router.get(
    "/vendor-home/{vendor_workshop_id}/ad-hoc-defects",
    response_model=list[AdHocDefectRow],
    summary="Ad-hoc defects (DSP-reported or shop-found) in the trailing window",
)
async def ad_hoc_defects(
    vendor_workshop_id: int = Path(..., ge=1),
    hours: int = Query(default=24, ge=1, le=168),
    dsp_id: int | None = Query(default=None),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AdHocDefectRow]:
    if current.role != UserRole.SITE_ADMIN:
        allowed = await _vendor_workshop_ids_for(session, current)
        if vendor_workshop_id not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "workshop not under your vendor"
            )

    served = await _dsp_ids_for_workshop(session, vendor_workshop_id)
    if dsp_id is not None:
        if dsp_id not in served:
            return []
        scoped = [dsp_id]
    else:
        scoped = served
    if not scoped:
        return []

    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Pull defects + their vehicle's DSP. Inner join so we drop any
    # orphan defects.
    rows = (
        await session.execute(
            select(Defect, Vehicle, Organization)
            .join(Vehicle, Vehicle.id == Defect.vehicle_id)
            .outerjoin(Organization, Organization.id == Vehicle.dsp_id)
            .where(Vehicle.dsp_id.in_(scoped))
            .where(Defect.reported_at >= since)
            .where(Defect.source.in_([
                DefectSource.DSP_REQUEST.value,
                DefectSource.SHOP_FINDING.value,
            ]))
            .order_by(Defect.reported_at.desc())
            .limit(100)
        )
    ).all()
    out: list[AdHocDefectRow] = []
    for d, veh, org in rows:
        out.append(AdHocDefectRow(
            id=d.id,
            id_str=f"FD-{d.id:03d}",
            part=d.part,
            defect_type=d.defect_type,
            position=d.position,
            source=d.source.value if hasattr(d.source, "value") else str(d.source),
            reported_at=d.reported_at,
            dsp_id=veh.dsp_id,
            dsp_name=org.name if org else None,
        ))
    return out


# ═════════════════════════════════════════════════════
# Upcoming DVIC — vendor confirms each DSP for tonight (mockup p.2)
# ═════════════════════════════════════════════════════
#
# One chip per DSP the workshop services. Today-scoped: each call
# returns the served DSPs + whether the workshop has confirmed
# that DSP's tonight inspection yet.
#
# Confirmation lives in `dvic_nightly_confirmations` keyed on
# (vendor_workshop_id, dsp_id, confirmation_date). Posting twice
# for the same triple is idempotent (the UNIQUE constraint kicks
# in; the POST handler returns the existing row).

class UpcomingDvicRow(BaseModel):
    dsp_id: int
    dsp_name: str | None = None
    confirmed: bool
    confirmed_at: datetime | None = None
    confirmation_date: str   # ISO date (YYYY-MM-DD)


@router.get(
    "/vendor-home/{vendor_workshop_id}/upcoming-dvic",
    response_model=list[UpcomingDvicRow],
    summary="Tonight's per-DSP confirmation state for the Upcoming DVIC chips",
)
async def upcoming_dvic(
    vendor_workshop_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[UpcomingDvicRow]:
    """Returns one row per DSP the workshop has WOs with (the
    "served set"), each tagged confirmed/unconfirmed for today.
    """
    if current.role != UserRole.SITE_ADMIN:
        allowed = await _vendor_workshop_ids_for(session, current)
        if vendor_workshop_id not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "workshop not under your vendor"
            )
    today = datetime.now(timezone.utc).date()

    served_ids = await _dsp_ids_for_workshop(session, vendor_workshop_id)
    if not served_ids:
        return []

    # Fetch the orgs + their existing confirmations for today in two queries.
    orgs = (
        await session.execute(
            select(Organization).where(Organization.id.in_(served_ids))
        )
    ).scalars().all()
    confirmations = (
        await session.execute(
            select(DvicNightlyConfirmation)
            .where(DvicNightlyConfirmation.vendor_workshop_id == vendor_workshop_id)
            .where(DvicNightlyConfirmation.confirmation_date == today)
        )
    ).scalars().all()
    by_dsp = {c.dsp_id: c for c in confirmations}

    rows: list[UpcomingDvicRow] = []
    for o in sorted(orgs, key=lambda x: x.name or ''):
        c = by_dsp.get(o.id)
        rows.append(UpcomingDvicRow(
            dsp_id=o.id,
            dsp_name=o.name,
            confirmed=c is not None,
            confirmed_at=c.confirmed_at if c else None,
            confirmation_date=today.isoformat(),
        ))
    return rows


@router.post(
    "/vendor-home/{vendor_workshop_id}/upcoming-dvic/{dsp_id}/confirm",
    response_model=UpcomingDvicRow,
    status_code=status.HTTP_201_CREATED,
    summary="Confirm a DSP is ready for tonight's inspection",
)
async def confirm_upcoming_dvic(
    vendor_workshop_id: int = Path(..., ge=1),
    dsp_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UpcomingDvicRow:
    """Idempotent: re-confirming returns the existing row without
    creating a duplicate. The UI flips the chip to green immediately
    after a successful POST.
    """
    if current.role != UserRole.SITE_ADMIN:
        allowed = await _vendor_workshop_ids_for(session, current)
        if vendor_workshop_id not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "workshop not under your vendor"
            )

    # Workshop must actually service this DSP (don't allow random pairings).
    served_ids = await _dsp_ids_for_workshop(session, vendor_workshop_id)
    if dsp_id not in served_ids:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "this workshop has no work orders with that DSP",
        )

    today = datetime.now(timezone.utc).date()
    row = (
        await session.execute(
            select(DvicNightlyConfirmation)
            .where(DvicNightlyConfirmation.vendor_workshop_id == vendor_workshop_id)
            .where(DvicNightlyConfirmation.dsp_id == dsp_id)
            .where(DvicNightlyConfirmation.confirmation_date == today)
            .limit(1)
        )
    ).scalar_one_or_none()

    if row is None:
        row = DvicNightlyConfirmation(
            vendor_workshop_id=vendor_workshop_id,
            dsp_id=dsp_id,
            confirmation_date=today,
            confirmed_by_id=current.id,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)

    org = (
        await session.execute(select(Organization).where(Organization.id == dsp_id))
    ).scalar_one_or_none()
    return UpcomingDvicRow(
        dsp_id=dsp_id,
        dsp_name=org.name if org else None,
        confirmed=True,
        confirmed_at=row.confirmed_at,
        confirmation_date=today.isoformat(),
    )
