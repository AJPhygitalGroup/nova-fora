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

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, func, or_, text
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
    DvicSchedule,
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


# ═════════════════════════════════════════════════════
# QC DVIC Schedules — vendor admin schedules an inspection at a DSP,
# DSP customer home shows readiness banner 12hrs before the appointment.
# Replaces the day-flag-only chip flow above. Old endpoints are kept
# around in iter-1 for backward compat with any cached frontend bundle;
# they'll be deleted once the new UI is live everywhere.
# ═════════════════════════════════════════════════════

class DvicScheduleCreateBody(BaseModel):
    dsp_id: int
    scheduled_at: datetime
    notes: str | None = None


class DvicScheduleRow(BaseModel):
    id: int
    id_str: str
    vendor_workshop_id: int
    dsp_id: int
    dsp_name: str | None = None
    scheduled_at: datetime
    notes: str | None = None
    cancelled_at: datetime | None = None
    cancellation_reason: str | None = None
    created_by_id: int
    created_at: datetime


class NextQcDvicRow(BaseModel):
    """DSP-side response — the nearest upcoming inspection that's within
    the readiness-banner window, or null if nothing scheduled soon.
    `hours_until` is computed server-side so the frontend doesn't have
    to do tz math (it just shows the banner whenever this is non-null).
    """
    id: int
    scheduled_at: datetime
    hours_until: float
    vendor_workshop_id: int
    vendor_workshop_name: str | None = None
    notes: str | None = None
    # 2026-06-06 — DSP confirmation. When dsp_confirmed_at is null the
    # banner reads "Action required"; once set, the banner flips to
    # "Confirmed" with the key location chip.
    dsp_confirmed_at: datetime | None = None
    key_location: str | None = None
    dsp_notes: str | None = None


# Banner readiness window. Vendor schedule + DSP banner agree on this
# constant — any inspection scheduled within the next 12 hours shows up
# as "ready your van" on the DSP home.
QC_DVIC_BANNER_WINDOW_HOURS = 12


def _dvic_row(s: "DvicSchedule", dsp_name: str | None) -> DvicScheduleRow:
    return DvicScheduleRow(
        id=s.id,
        id_str=s.id_str,
        vendor_workshop_id=s.vendor_workshop_id,
        dsp_id=s.dsp_id,
        dsp_name=dsp_name,
        scheduled_at=s.scheduled_at,
        notes=s.notes,
        cancelled_at=s.cancelled_at,
        cancellation_reason=s.cancellation_reason,
        created_by_id=s.created_by_id,
        created_at=s.created_at,
    )


@router.get(
    "/vendor-home/{vendor_workshop_id}/dvic-schedules",
    response_model=list[DvicScheduleRow],
    summary="List upcoming QC DVICs the vendor has scheduled (active, sorted by date)",
)
async def list_dvic_schedules(
    vendor_workshop_id: int = Path(..., ge=1),
    include_past: bool = Query(default=False, description="Include past appointments"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[DvicScheduleRow]:
    if current.role != UserRole.SITE_ADMIN:
        allowed = await _vendor_workshop_ids_for(session, current)
        if vendor_workshop_id not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "workshop not under your vendor")

    now = datetime.now(timezone.utc)
    stmt = (
        select(DvicSchedule, Organization)
        .join(Organization, Organization.id == DvicSchedule.dsp_id)
        .where(DvicSchedule.vendor_workshop_id == vendor_workshop_id)
        .where(DvicSchedule.cancelled_at.is_(None))
        .order_by(DvicSchedule.scheduled_at.asc())
    )
    if not include_past:
        stmt = stmt.where(DvicSchedule.scheduled_at >= now)
    rows = (await session.execute(stmt)).all()
    return [_dvic_row(s, o.name) for s, o in rows]


@router.post(
    "/vendor-home/{vendor_workshop_id}/dvic-schedules",
    response_model=DvicScheduleRow,
    status_code=status.HTTP_201_CREATED,
    summary="Schedule a new QC DVIC for a DSP the workshop services",
)
async def create_dvic_schedule(
    body: DvicScheduleCreateBody,
    vendor_workshop_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DvicScheduleRow:
    if current.role != UserRole.SITE_ADMIN:
        allowed = await _vendor_workshop_ids_for(session, current)
        if vendor_workshop_id not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "workshop not under your vendor")

    # Workshop must service this DSP (same guardrail the legacy chip flow
    # uses — prevents random vendor↔DSP pairings via API).
    served = await _dsp_ids_for_workshop(session, vendor_workshop_id)
    if body.dsp_id not in served:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "this workshop has no work orders with that DSP; can't schedule an inspection",
        )

    # Refuse scheduling in the past (a 5-min buffer for clock drift).
    now = datetime.now(timezone.utc)
    if body.scheduled_at < now - timedelta(minutes=5):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "scheduled_at must be in the future",
        )

    s = DvicSchedule(
        vendor_workshop_id=vendor_workshop_id,
        dsp_id=body.dsp_id,
        scheduled_at=body.scheduled_at,
        notes=body.notes,
        created_by_id=current.id,
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)

    org = (
        await session.execute(select(Organization).where(Organization.id == s.dsp_id))
    ).scalar_one_or_none()
    return _dvic_row(s, org.name if org else None)


class CancelDvicBody(BaseModel):
    reason: str | None = None


@router.post(
    "/vendor-home/{vendor_workshop_id}/dvic-schedules/{schedule_id}/cancel",
    response_model=DvicScheduleRow,
    summary="Cancel a scheduled QC DVIC (soft — row stays for audit)",
)
async def cancel_dvic_schedule(
    body: CancelDvicBody,
    vendor_workshop_id: int = Path(..., ge=1),
    schedule_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DvicScheduleRow:
    if current.role != UserRole.SITE_ADMIN:
        allowed = await _vendor_workshop_ids_for(session, current)
        if vendor_workshop_id not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "workshop not under your vendor")

    s = (
        await session.execute(
            select(DvicSchedule)
            .where(DvicSchedule.id == schedule_id)
            .where(DvicSchedule.vendor_workshop_id == vendor_workshop_id)
        )
    ).scalar_one_or_none()
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "schedule not found")
    if s.cancelled_at is not None:
        # Idempotent — re-cancel returns the existing row.
        org = (
            await session.execute(select(Organization).where(Organization.id == s.dsp_id))
        ).scalar_one_or_none()
        return _dvic_row(s, org.name if org else None)

    s.cancelled_at = datetime.now(timezone.utc)
    s.cancelled_by_id = current.id
    s.cancellation_reason = body.reason
    session.add(s)
    await session.commit()
    await session.refresh(s)

    org = (
        await session.execute(select(Organization).where(Organization.id == s.dsp_id))
    ).scalar_one_or_none()
    return _dvic_row(s, org.name if org else None)


@router.get(
    "/dsp/{dsp_id}/next-qc-dvic",
    response_model=NextQcDvicRow | None,
    summary="DSP home banner trigger — nearest upcoming QC DVIC within 12 hours",
)
async def dsp_next_qc_dvic(
    dsp_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NextQcDvicRow | None:
    """Returns null when nothing's scheduled within the banner window.
    The DSP frontend shows the readiness banner ONLY when this is
    non-null — no more manual show/hide toggle. Polled by the home page
    on mount + every 5 min so the banner appears in the background as
    the window opens.
    """
    if current.role != UserRole.SITE_ADMIN:
        if current.organization_id != dsp_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not your DSP")

    now = datetime.now(timezone.utc)
    window_end = now + timedelta(hours=QC_DVIC_BANNER_WINDOW_HOURS)

    # Lookup needs the workshop name for the banner subtitle ("Dulles
    # Midas will inspect tonight"). Joining keeps it one round-trip.
    from app.models.work_orders import VendorWorkshop  # local: import-cycle guard
    row = (
        await session.execute(
            select(DvicSchedule, VendorWorkshop)
            .join(VendorWorkshop, VendorWorkshop.id == DvicSchedule.vendor_workshop_id)
            .where(DvicSchedule.dsp_id == dsp_id)
            .where(DvicSchedule.cancelled_at.is_(None))
            .where(DvicSchedule.scheduled_at > now)
            .where(DvicSchedule.scheduled_at <= window_end)
            .order_by(DvicSchedule.scheduled_at.asc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    s, ws = row
    delta = s.scheduled_at - now
    hours_until = delta.total_seconds() / 3600.0
    return NextQcDvicRow(
        id=s.id,
        scheduled_at=s.scheduled_at,
        hours_until=round(hours_until, 2),
        vendor_workshop_id=s.vendor_workshop_id,
        vendor_workshop_name=ws.name if ws else None,
        notes=s.notes,
        dsp_confirmed_at=s.dsp_confirmed_at,
        key_location=s.key_location,
        dsp_notes=s.dsp_notes,
    )


class ConfirmQcDvicBody(BaseModel):
    """DSP-side readiness confirmation payload."""

    key_location: str = Field(..., min_length=1, max_length=500)
    dsp_notes: str | None = Field(default=None, max_length=1000)

    model_config = ConfigDict(extra="forbid")


@router.post(
    "/dvic-schedules/{schedule_id}/confirm",
    response_model=NextQcDvicRow,
    summary="DSP confirms readiness for an upcoming QC DVIC + key drop info",
    responses={
        403: {"description": "Caller is not the DSP owner of this schedule."},
        404: {"description": "Schedule not found."},
        409: {"description": "Schedule already cancelled."},
    },
)
async def confirm_qc_dvic(
    body: ConfirmQcDvicBody,
    schedule_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NextQcDvicRow:
    """DSP customer confirms the inspection is good to go + tells the
    vendor inspector where to find the keys. Mirrors the WO pickup
    confirmation shape (key_location + free-text notes). Idempotent —
    re-confirming overwrites the prior key_location / notes."""
    from app.models.work_orders import VendorWorkshop  # import-cycle guard
    row = (
        await session.execute(
            select(DvicSchedule).where(DvicSchedule.id == schedule_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "schedule not found")
    if row.cancelled_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "schedule already cancelled")
    # Auth: only the DSP owner of this row's DSP (or site_admin) can confirm.
    if current.role != UserRole.SITE_ADMIN:
        if current.organization_id != row.dsp_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not your DSP")

    row.dsp_confirmed_at = datetime.now(timezone.utc)
    row.dsp_confirmed_by_id = current.id
    row.key_location = body.key_location.strip()
    if body.dsp_notes is not None:
        row.dsp_notes = body.dsp_notes.strip() or None
    session.add(row)
    await session.commit()
    await session.refresh(row)

    # Compute hours_until for the response (caller probably refetches
    # /next-qc-dvic anyway but this saves a round-trip).
    now = datetime.now(timezone.utc)
    delta = row.scheduled_at - now
    hours_until = max(0.0, delta.total_seconds() / 3600.0)
    ws = (
        await session.execute(
            select(VendorWorkshop).where(VendorWorkshop.id == row.vendor_workshop_id)
        )
    ).scalar_one_or_none()
    return NextQcDvicRow(
        id=row.id,
        scheduled_at=row.scheduled_at,
        hours_until=round(hours_until, 2),
        vendor_workshop_id=row.vendor_workshop_id,
        vendor_workshop_name=ws.name if ws else None,
        notes=row.notes,
        dsp_confirmed_at=row.dsp_confirmed_at,
        key_location=row.key_location,
        dsp_notes=row.dsp_notes,
    )


# ═════════════════════════════════════════════════════
# Chart data — Vendor Home Phase-1b (mockup p.2 charts)
# ═════════════════════════════════════════════════════
#
# 1. Daily Approved vs Repaired — 7-day bar chart.
# 2. Open Defects breakdown — donut grouped by `defects.source`.
#
# Both endpoints scope to the workshop's served DSPs (same set the
# Vendor Home tiles use) with an optional dsp_id filter.

class DailyDefectsPoint(BaseModel):
    date: str               # ISO "YYYY-MM-DD"
    approved: int
    repaired: int


def _daily_window(days: int, tz_offset_minutes: int) -> tuple[date, datetime, str]:
    """Translate (days, JS-style tz offset) into (today_local, start_utc,
    sql_local_date_fragment).

    JS's `new Date().getTimezoneOffset()` returns minutes WEST of UTC: EDT
    returns 240 (UTC-4), CEST returns -120 (UTC+2). We invert that to a
    Python timezone so 'today_local' reflects what the inspector sees on
    their wall clock, not whatever UTC is at the moment they hit /home.

    The SQL fragment shifts the stored UTC `created_at` / `completed_at`
    column by the same offset before extracting date(), so the GROUP BY
    buckets match. Embedding the int directly is safe because FastAPI
    bounds tz_offset_minutes via Query(ge=-720, le=720).
    """
    user_tz = timezone(timedelta(minutes=-tz_offset_minutes))
    today_local = datetime.now(user_tz).date()
    start_local = datetime.combine(
        today_local - timedelta(days=days - 1),
        datetime.min.time(),
        tzinfo=user_tz,
    )
    start_utc = start_local.astimezone(timezone.utc)
    # Postgres can't parametrize an INTERVAL literal directly; use the
    # validated int. Negative offsets are fine (CEST → +120 seconds shift).
    shift_seconds = -tz_offset_minutes * 60
    return today_local, start_utc, shift_seconds


@router.get(
    "/vendor-home/{vendor_workshop_id}/daily-defects",
    response_model=list[DailyDefectsPoint],
    summary="N-day bar-chart series: approved vs repaired defects",
)
async def daily_defects(
    vendor_workshop_id: int = Path(..., ge=1),
    days: int = Query(default=7, ge=1, le=90),
    dsp_id: int | None = Query(default=None),
    tz_offset_minutes: int = Query(
        default=0, ge=-720, le=720,
        description="JS-style getTimezoneOffset() in minutes. EDT=240, EST=300.",
    ),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[DailyDefectsPoint]:
    """Approved = `defect_reviews` rows of decision='approved' per day.
    Repaired = `work_orders` of status='completed' per day (proxy for
    "defects closed" — iter-2 will switch to DR.status='resolved' once
    that signal stabilises).

    Bucketed by USER-LOCAL date — see _daily_window().
    """
    if current.role != UserRole.SITE_ADMIN:
        allowed = await _vendor_workshop_ids_for(session, current)
        if vendor_workshop_id not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "workshop not under your vendor")

    scoped = await _dsp_ids_for_workshop(session, vendor_workshop_id)
    if dsp_id is not None:
        scoped = [dsp_id] if dsp_id in scoped else []

    today_local, start_utc, shift_secs = _daily_window(days, tz_offset_minutes)

    if not scoped:
        # Return empty buckets so the chart renders flat zeros
        # instead of an empty axis.
        return [
            DailyDefectsPoint(date=(today_local - timedelta(days=days - 1 - i)).isoformat(), approved=0, repaired=0)
            for i in range(days)
        ]

    dr_local_date_expr = func.date(
        DefectReview.created_at + text(f"interval '{shift_secs} seconds'")
    )

    # Approved per day (defect_reviews JOIN defects JOIN vehicles for tenancy)
    approved_rows = (
        await session.execute(
            select(dr_local_date_expr.label("d"), func.count(DefectReview.id))
            .join(Defect, Defect.id == DefectReview.defect_id)
            .join(Vehicle, Vehicle.id == Defect.vehicle_id)
            .where(Vehicle.dsp_id.in_(scoped))
            .where(DefectReview.created_at >= start_utc)
            .where(DefectReview.decision == "approved")
            .group_by(dr_local_date_expr)
        )
    ).all()
    approved_map = {str(d): n for d, n in approved_rows}

    wo_local_date_expr = func.date(
        WorkOrder.completed_at + text(f"interval '{shift_secs} seconds'")
    )

    # Repaired per day (WOs completed in the workshop, scoped to served DSPs)
    repaired_rows = (
        await session.execute(
            select(wo_local_date_expr.label("d"), func.count(WorkOrder.id))
            .where(WorkOrder.vendor_workshop_id == vendor_workshop_id)
            .where(WorkOrder.dsp_id.in_(scoped))
            .where(WorkOrder.status == WorkOrderStatus.COMPLETED.value)
            .where(WorkOrder.completed_at >= start_utc)
            .group_by(wo_local_date_expr)
        )
    ).all()
    repaired_map = {str(d): n for d, n in repaired_rows}

    out: list[DailyDefectsPoint] = []
    for i in range(days):
        d = today_local - timedelta(days=days - 1 - i)
        key = d.isoformat()
        out.append(DailyDefectsPoint(
            date=key,
            approved=int(approved_map.get(key, 0)),
            repaired=int(repaired_map.get(key, 0)),
        ))
    return out


class OpenDefectsSlice(BaseModel):
    label: str
    key: str
    count: int


@router.get(
    "/vendor-home/{vendor_workshop_id}/open-defects-breakdown",
    response_model=list[OpenDefectsSlice],
    summary="Donut slices: open defects grouped by source",
)
async def open_defects_breakdown(
    vendor_workshop_id: int = Path(..., ge=1),
    dsp_id: int | None = Query(default=None),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[OpenDefectsSlice]:
    """Open = defects whose latest DefectResolution is NOT terminal
    (resolved / deferred / declined), OR has no DR at all. Grouped by
    `defects.source` with friendly labels.

    Mockup labels (VSA / RSI / Other) come from Amazon's scorecard
    taxonomy; we don't have that mapping yet, so iter-1 surfaces
    Inspection / Customer request / Shop finding / Other (the actual
    DefectSource values).
    """
    if current.role != UserRole.SITE_ADMIN:
        allowed = await _vendor_workshop_ids_for(session, current)
        if vendor_workshop_id not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "workshop not under your vendor")

    scoped = await _dsp_ids_for_workshop(session, vendor_workshop_id)
    if dsp_id is not None:
        scoped = [dsp_id] if dsp_id in scoped else []
    if not scoped:
        return []

    # Open defects in the scope. We use the same "no terminal DR" rule
    # as wo-summary. Cheap aggregation: count per source.
    from app.models.work_orders import DefectResolution, DefectResolutionStatus

    terminal = (
        DefectResolutionStatus.RESOLVED.value,
        DefectResolutionStatus.DEFERRED.value,
        DefectResolutionStatus.DECLINED.value,
    )
    # Subquery: defect ids that DO have a terminal DR — used to exclude.
    closed_ids_sub = (
        select(DefectResolution.defect_id)
        .where(DefectResolution.status.in_(terminal))
    ).subquery()

    rows = (
        await session.execute(
            select(
                Defect.source,
                func.count(Defect.id),
            )
            .join(Vehicle, Vehicle.id == Defect.vehicle_id)
            .where(Vehicle.dsp_id.in_(scoped))
            .where(~Defect.id.in_(select(closed_ids_sub.c.defect_id)))
            .group_by(Defect.source)
        )
    ).all()

    label_map = {
        "inspection": "Inspection",
        "maintenance_request": "Customer request",
        "driver_report": "Driver report",
        "customer_report": "Customer report",
        "shop_finding": "Shop finding",
        "other": "Other",
    }
    # `source` comes back as the DefectSource enum (column is mapped
    # to it). Stringify via .value so we get 'inspection' not
    # 'DefectSource.INSPECTION'. Defensive str() fallback for any
    # already-string rows.
    def _key(s):
        return s.value if hasattr(s, "value") else str(s)
    return [
        OpenDefectsSlice(
            key=_key(source),
            label=label_map.get(_key(source), _key(source).replace("_", " ").title()),
            count=int(n),
        )
        for source, n in rows
        if n > 0
    ]


# ═════════════════════════════════════════════════════
# DSP Home charts — RealDVIC dashboard wiring
# ═════════════════════════════════════════════════════
#
# Same shape as the vendor-home endpoints but scoped to a single DSP
# (the customer's own org). Tenancy: dsp_* users only on their own
# org; site_admin can hit any.

@router.get(
    "/dsp/{dsp_id}/daily-defects",
    response_model=list[DailyDefectsPoint],
    summary="N-day bar series for DSP Home — approved vs repaired",
)
async def dsp_daily_defects(
    dsp_id: int = Path(..., ge=1),
    days: int = Query(default=7, ge=1, le=90),
    tz_offset_minutes: int = Query(
        default=0, ge=-720, le=720,
        description="JS-style getTimezoneOffset() in minutes. EDT=240, EST=300.",
    ),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[DailyDefectsPoint]:
    """Mirrors the vendor-home version but restricted to a single DSP.
    Approved = DefectReview rows of decision='approved' on vehicles
    owned by this DSP. Repaired = WOs of status='completed' assigned
    to this DSP.

    Bucketed by USER-LOCAL date (derived from tz_offset_minutes the
    client passes in). Previously bucketed by UTC date, which made the
    rightmost bar fall a day behind for EDT/EST/PST users any time the
    page was loaded after their local midnight UTC equivalent
    (Michael's bug report 2026-05-26).
    """
    if current.role != UserRole.SITE_ADMIN:
        if current.organization_id != dsp_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not your DSP")

    today_local, start_utc, shift_secs = _daily_window(days, tz_offset_minutes)
    # Postgres-side date(ts + interval 'N seconds') puts every row into
    # the inspector's local day. Same expression on both queries so the
    # GROUP BY buckets line up with the output keys we build below.
    local_date_expr = func.date(
        DefectReview.created_at + text(f"interval '{shift_secs} seconds'")
    )

    approved_rows = (
        await session.execute(
            select(local_date_expr.label("d"), func.count(DefectReview.id))
            .join(Defect, Defect.id == DefectReview.defect_id)
            .join(Vehicle, Vehicle.id == Defect.vehicle_id)
            .where(Vehicle.dsp_id == dsp_id)
            .where(DefectReview.created_at >= start_utc)
            .where(DefectReview.decision == "approved")
            .group_by(local_date_expr)
        )
    ).all()
    approved_map = {str(d): n for d, n in approved_rows}

    wo_local_date_expr = func.date(
        WorkOrder.completed_at + text(f"interval '{shift_secs} seconds'")
    )
    repaired_rows = (
        await session.execute(
            select(wo_local_date_expr.label("d"), func.count(WorkOrder.id))
            .where(WorkOrder.dsp_id == dsp_id)
            .where(WorkOrder.status == WorkOrderStatus.COMPLETED.value)
            .where(WorkOrder.completed_at >= start_utc)
            .group_by(wo_local_date_expr)
        )
    ).all()
    repaired_map = {str(d): n for d, n in repaired_rows}

    out: list[DailyDefectsPoint] = []
    for i in range(days):
        d = today_local - timedelta(days=days - 1 - i)
        key = d.isoformat()
        out.append(DailyDefectsPoint(
            date=key,
            approved=int(approved_map.get(key, 0)),
            repaired=int(repaired_map.get(key, 0)),
        ))
    return out


@router.get(
    "/dsp/{dsp_id}/open-defects-breakdown",
    response_model=list[OpenDefectsSlice],
    summary="Donut slices for DSP Home — open defects by source",
)
async def dsp_open_defects_breakdown(
    dsp_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[OpenDefectsSlice]:
    """DSP customer Home donut — categorizes open defects as VSA vs Other.

    VSA (Vehicle Safety Audit) = defects from the daily DVIC inspection
    flow (source='inspection'). Everything else (driver_report,
    customer_report, shop_finding, maintenance_request, other) collapses
    into "Other".

    RSI (Roadside Inspection) is intentionally NOT split out for iter-1
    — there aren't enough RSI defects yet to make a meaningful slice
    (Michael's note 2026-05-26). When that data accumulates, v2.1 will
    promote it to its own bucket and add an admin UI to let customers
    tune which defect types fall under VSA.
    """
    if current.role != UserRole.SITE_ADMIN:
        if current.organization_id != dsp_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not your DSP")

    from app.models.work_orders import DefectResolution, DefectResolutionStatus

    terminal = (
        DefectResolutionStatus.RESOLVED.value,
        DefectResolutionStatus.DEFERRED.value,
        DefectResolutionStatus.DECLINED.value,
    )
    closed_ids_sub = (
        select(DefectResolution.defect_id)
        .where(DefectResolution.status.in_(terminal))
    ).subquery()

    rows = (
        await session.execute(
            select(
                Defect.source,
                func.count(Defect.id),
            )
            .join(Vehicle, Vehicle.id == Defect.vehicle_id)
            .where(Vehicle.dsp_id == dsp_id)
            .where(~Defect.id.in_(select(closed_ids_sub.c.defect_id)))
            .group_by(Defect.source)
        )
    ).all()

    def _key(s):
        return s.value if hasattr(s, "value") else str(s)

    # Collapse per-source counts into the two customer-facing buckets.
    vsa_count = 0
    other_count = 0
    for source, n in rows:
        if _key(source) == "inspection":
            vsa_count += int(n)
        else:
            other_count += int(n)

    out: list[OpenDefectsSlice] = []
    if vsa_count > 0:
        out.append(OpenDefectsSlice(key="vsa", label="VSA", count=vsa_count))
    if other_count > 0:
        out.append(OpenDefectsSlice(key="other", label="Other", count=other_count))
    return out


# ═════════════════════════════════════════════════════
# Inspector Performance — list view (admin + DSP-owner)
# ═════════════════════════════════════════════════════
class InspectorPerfRow(BaseModel):
    inspector_id: int
    inspector_name: str
    inspector_email: str | None = None
    organization_id: int | None = None
    organization_name: str | None = None
    total_reported: int = 0
    illegitimate_count: int = 0
    illegitimate_pct: float | None = None
    window_days: int


@router.get(
    "/inspector-performance",
    response_model=list[InspectorPerfRow],
    summary="List inspectors with their illegitimate-defect KPI",
)
async def inspector_performance(
    days: int = Query(default=30, ge=1, le=365),
    dsp_id: int | None = Query(default=None),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[InspectorPerfRow]:
    """Rolls up the per-inspector KPI for the dashboard. Tenancy:
      - site_admin: all inspectors (optionally filtered by dsp_id)
      - dsp_*: only their own org's inspectors
      - vendor-side: hidden (returns empty list — not a vendor concern)
    """
    from sqlalchemy import distinct
    from app.models.user import User as UserModel
    from app.models.work_orders import DefectReview as DefectReviewModel

    # Scope: which users count as inspectors? Anyone who has reported
    # at least one defect in the window. Filter by org for DSP roles.
    base_user_q = select(UserModel).where(UserModel.is_active.is_(True)) \
        if hasattr(UserModel, "is_active") else select(UserModel)

    if current.role == UserRole.SITE_ADMIN:
        if dsp_id is not None:
            base_user_q = base_user_q.where(UserModel.organization_id == dsp_id)
    elif current.role.value.startswith("dsp_"):
        base_user_q = base_user_q.where(UserModel.organization_id == current.organization_id)
    else:
        return []

    candidate_users = (await session.execute(base_user_q)).scalars().all()

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[InspectorPerfRow] = []
    for u in candidate_users:
        total = (
            await session.execute(
                select(func.count(Defect.id))
                .where(Defect.reported_by_id == u.id)
                .where(Defect.reported_at >= cutoff)
            )
        ).scalar() or 0
        if total == 0:
            continue  # not an inspector in this window
        illegit = (
            await session.execute(
                select(func.count(distinct(DefectReviewModel.defect_id)))
                .join(Defect, Defect.id == DefectReviewModel.defect_id)
                .where(Defect.reported_by_id == u.id)
                .where(Defect.reported_at >= cutoff)
                .where(DefectReviewModel.decision == "rejected")
                .where(DefectReviewModel.reject_reason_code == "illegitimate_defect")
            )
        ).scalar() or 0
        org = (
            await session.execute(
                select(Organization).where(Organization.id == u.organization_id)
            )
        ).scalar_one_or_none()
        pct = round((illegit / total) * 100, 1) if total > 0 else None
        out.append(InspectorPerfRow(
            inspector_id=u.id,
            inspector_name=u.full_name,
            inspector_email=u.email,
            organization_id=u.organization_id,
            organization_name=org.name if org else None,
            total_reported=int(total),
            illegitimate_count=int(illegit),
            illegitimate_pct=pct,
            window_days=days,
        ))
    # Worst performers first so site_admin sees red flags at the top.
    out.sort(key=lambda r: ((r.illegitimate_pct or 0), -r.total_reported), reverse=True)
    return out
