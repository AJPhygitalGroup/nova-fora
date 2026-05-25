"""Defect cost-approval service — WO V2 iteration-1 substitute for the
deferred line-item cost flow.

Per spec §7.A, in iter-1 cost approval lives on the `defects` row:
the Service Writer sets `defects.estimated_cost` (plus, for AMR, the
`fmc_capped_at` cap if Amazon FMC pays less than the vendor estimate),
and the customer must approve when the threshold is exceeded OR when
there's an AMR shortfall. Below threshold and not capped → auto-approve.

Two entry points:

  - `set_defect_cost(...)` — SW writes the estimate. Returns a result
    object carrying `auto_approved: bool` so the caller can render the
    correct toast ("Cost approved automatically" vs "Awaiting customer").

  - `customer_cost_decision(...)` — DSP user clicks Approve $X or
    Decline. Writes `defects.cost_decision` + corresponding
    `defect_reviews` audit row + activity-log entry.

Authorization is enforced at the route layer; this service trusts its
inputs.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.base import utc_now
from app.models.defect import Defect
from app.models.vehicle import Vehicle
from app.models.work_orders import (
    DefectReview,
    DefectReviewDecision,
    DefectReviewDecisionMethod,
    DspSetting,
    WoActivityLogEntityType,
)
from app.services.wo_activity_log import log_event
from app.services.wo_defect_reviews import _resolve_defect_group  # internal reuse

# Defect-group → billing-type mapping (spec §7.A "Billing-type derivation"
# table). Anything not listed defaults to CMR (DSP-paid) — that's the
# safer-for-DSP behaviour if the group is novel or misconfigured.
_AMR_GROUPS = frozenset({"AMR", "Netradyne"})


def derive_billing_type(group: str | None) -> Literal["amr", "cmr"]:
    """Map a defect's group to its billing type.

    AMR = Amazon FMC pays the vendor (capped). CMR = DSP pays.
    """
    if group is None:
        return "cmr"
    return "amr" if group in _AMR_GROUPS else "cmr"


@dataclass(frozen=True)
class CostSetResult:
    """Outcome of `set_defect_cost`."""

    defect: Defect
    billing_type: Literal["amr", "cmr"]
    auto_approved: bool
    auto_approve_reason: str | None  # 'below_cmr_threshold' | 'no_amr_shortfall' | None


async def _load_dsp_setting(session: AsyncSession, dsp_id: int) -> DspSetting | None:
    return (
        await session.execute(select(DspSetting).where(DspSetting.dsp_id == dsp_id))
    ).scalar_one_or_none()


async def set_defect_cost(
    session: AsyncSession,
    *,
    defect_id: int,
    estimated_cost: Decimal,
    fmc_capped_at: Decimal | None,
    actor_id: int,
) -> CostSetResult:
    """SW workflow: record the vendor estimate (+ optional FMC cap), then
    decide whether the cost passes the customer's auto-approve thresholds.

    Auto-approve conditions (spec §7.A):
      - CMR + estimated_cost <= cmr_auto_approve_threshold (DSP setting)
      - AMR + (fmc_capped_at IS NULL OR fmc_capped_at >= estimated_cost)
        (i.e. Amazon's cap covers the estimate — no shortfall)

    Returns CostSetResult with the post-write Defect (with cost columns
    populated) and whether the auto-approval fired. Caller commits.
    """
    defect = (
        await session.execute(select(Defect).where(Defect.id == defect_id))
    ).scalar_one_or_none()
    if defect is None:
        raise ValueError(f"defect id={defect_id} not found")

    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == defect.vehicle_id))
    ).scalar_one_or_none()
    if vehicle is None:
        raise ValueError(f"defect id={defect_id} has dangling vehicle_id={defect.vehicle_id}")

    # Derive billing type from the defect's group.
    group = await _resolve_defect_group(session, defect, vehicle.vehicle_class)
    billing_type = derive_billing_type(group)

    # Stamp the cost columns regardless of auto-approval outcome.
    now = utc_now()
    defect.estimated_cost = estimated_cost
    defect.cost_set_at = now
    defect.cost_set_by = actor_id
    defect.fmc_capped_at = fmc_capped_at
    # Reset any prior decision — re-quoting wipes the slate so the customer
    # sees the fresh number, not a stale approve.
    defect.cost_decision = None
    defect.cost_decided_at = None
    defect.cost_decided_by = None
    session.add(defect)

    # Decide whether to auto-approve.
    auto_approved = False
    auto_reason: str | None = None
    if billing_type == "cmr":
        dsp_setting = await _load_dsp_setting(session, vehicle.dsp_id)
        threshold = dsp_setting.cmr_auto_approve_threshold if dsp_setting else None
        if threshold is not None and estimated_cost <= threshold:
            auto_approved = True
            auto_reason = "below_cmr_threshold"
    else:  # amr
        # AMR auto-approves when there's no shortfall: either no cap was
        # recorded (Amazon covers everything) or the cap is >= the estimate.
        if fmc_capped_at is None or fmc_capped_at >= estimated_cost:
            auto_approved = True
            auto_reason = "no_amr_shortfall"

    if auto_approved:
        defect.cost_decision = "approved"
        defect.cost_decided_at = now
        defect.cost_decided_by = None  # system

        # Write the audit review row. decision_method='auto_threshold' is
        # the spec's bucket for cost-based auto-approvals (both CMR
        # below-threshold and AMR no-shortfall).
        review = DefectReview(
            defect_id=defect_id,
            decision=DefectReviewDecision.APPROVED,
            decision_method=DefectReviewDecisionMethod.AUTO_THRESHOLD,
            reviewer_id=None,
            reason=f"cost auto-approved: {auto_reason}",
        )
        session.add(review)
        await session.flush()
        await log_event(
            session,
            entity_type=WoActivityLogEntityType.DEFECT_REVIEW,
            entity_id=review.id,
            action="cost_approved",
            actor_id=None,
            details={
                "defect_id": defect_id,
                "estimated_cost": str(estimated_cost),
                "billing_type": billing_type,
                "method": "auto_threshold",
                "reason": auto_reason,
                "fmc_capped_at": str(fmc_capped_at) if fmc_capped_at else None,
            },
        )
    else:
        # No auto-approval — log the cost_set event so the customer-side
        # dashboard knows a new cost is pending their action.
        await session.flush()
        await log_event(
            session,
            entity_type=WoActivityLogEntityType.DEFECT_REVIEW,
            entity_id=defect_id,  # entity_id refers to the defect being reviewed
            action="cost_set",
            actor_id=actor_id,
            details={
                "defect_id": defect_id,
                "estimated_cost": str(estimated_cost),
                "billing_type": billing_type,
                "fmc_capped_at": str(fmc_capped_at) if fmc_capped_at else None,
            },
        )

    return CostSetResult(
        defect=defect,
        billing_type=billing_type,
        auto_approved=auto_approved,
        auto_approve_reason=auto_reason,
    )


async def customer_cost_decision(
    session: AsyncSession,
    *,
    defect_id: int,
    decision: DefectReviewDecision,
    actor_id: int,
    reason: str | None = None,
) -> DefectReview:
    """Customer (DSP owner/manager) approves or rejects a cost that needs
    manual review. Writes the defects.cost_decision columns + a
    defect_reviews audit row + an activity-log entry. Caller commits.

    Rejecting a cost does NOT auto-cancel the defect — the SW can re-quote
    by calling set_defect_cost again with a new estimate.

    Raises ValueError if the defect has no cost set yet, or if it was
    already auto-approved (would be a UI bug to surface the chip).
    """
    defect = (
        await session.execute(select(Defect).where(Defect.id == defect_id))
    ).scalar_one_or_none()
    if defect is None:
        raise ValueError(f"defect id={defect_id} not found")
    if defect.estimated_cost is None:
        raise ValueError(f"defect id={defect_id} has no estimated_cost set; SW must quote first")
    if defect.cost_decision in ("approved", "rejected") and defect.cost_decided_by is None:
        # Auto-approved by system — surface as conflict so the UI can refresh.
        raise ValueError(
            f"defect id={defect_id} cost was already auto-approved; nothing to decide"
        )

    now = utc_now()
    defect.cost_decision = decision.value
    defect.cost_decided_at = now
    defect.cost_decided_by = actor_id
    session.add(defect)

    review = DefectReview(
        defect_id=defect_id,
        decision=decision,
        decision_method=DefectReviewDecisionMethod.MANUAL,
        reviewer_id=actor_id,
        reason=reason,
    )
    session.add(review)
    await session.flush()
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.DEFECT_REVIEW,
        entity_id=review.id,
        action="cost_approved" if decision == DefectReviewDecision.APPROVED else "cost_rejected",
        actor_id=actor_id,
        details={
            "defect_id": defect_id,
            "estimated_cost": str(defect.estimated_cost),
            "fmc_capped_at": str(defect.fmc_capped_at) if defect.fmc_capped_at else None,
            "method": "manual",
            "reason": reason,
        },
    )
    return review
