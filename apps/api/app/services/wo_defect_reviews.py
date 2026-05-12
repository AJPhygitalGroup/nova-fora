"""Defect review service — scope-approval workflow.

A defect leaves the defects table in its raw form. Before any work is
scheduled, a DSP admin must approve the scope (decision='approved') —
either manually via the review UI, or automatically because the defect's
group is listed in the DSP's `preauth_defect_groups`.

Two entry points:

  - `auto_review_on_defect_create(defect_id)` — called right after a
    defect is inserted. Checks if the defect's derived group is in the
    DSP's preauth list; if yes, writes an `auto_preauth_group` review
    and triggers the bundler synchronously.

  - `manual_review(defect_id, decision, reviewer_id, reason)` — called
    from the review queue endpoint. Writes a `manual` review row, logs
    to wo_activity_log, and (on 'approved') hands off to the bundler.

The `auto_threshold` path is a placeholder for v2.x — schema captures
it but the app never sets it.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.defect import Defect
from app.models.defect_catalog import (
    DefectApplicability,
    DefectRule,
    VehicleClass,
)
from app.models.vehicle import Vehicle
from app.models.work_orders import (
    DefectReview,
    DefectReviewDecision,
    DefectReviewDecisionMethod,
    DspSetting,
    WoActivityLogEntityType,
)
from app.services.wo_activity_log import log_event


async def _resolve_defect_group(
    session: AsyncSession, defect: Defect, vehicle_class: str
) -> str | None:
    """Look up `defect_rule.group` for this (part, defect_type, vehicle_class).

    Returns the group string (e.g. 'AMR', 'Body') or None if no rule
    matches — in which case auto-preauth obviously can't fire.
    """
    row = (
        await session.execute(
            select(DefectRule.group)
            .join(DefectApplicability, DefectApplicability.rule_id == DefectRule.id)
            .where(DefectRule.part == defect.part)
            .where(DefectRule.defect_type == defect.defect_type)
            .where(DefectApplicability.vehicle_class == vehicle_class)
        )
    ).first()
    if row is None:
        return None
    group = row[0]
    return group.value if hasattr(group, "value") else str(group)


async def _load_dsp_setting(session: AsyncSession, dsp_id: int) -> DspSetting | None:
    return (
        await session.execute(select(DspSetting).where(DspSetting.dsp_id == dsp_id))
    ).scalar_one_or_none()


async def auto_review_on_defect_create(
    session: AsyncSession, defect_id: int
) -> DefectReview | None:
    """Check preauth_defect_groups; write an auto review if the defect
    qualifies. Returns the created review row, or None if no auto-approval
    applies (caller falls through to manual review queue).

    Caller is responsible for committing the session.
    """
    defect = (
        await session.execute(select(Defect).where(Defect.id == defect_id))
    ).scalar_one_or_none()
    if defect is None:
        return None

    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == defect.vehicle_id))
    ).scalar_one_or_none()
    if vehicle is None:
        return None  # dangling — punt to manual

    dsp_setting = await _load_dsp_setting(session, vehicle.dsp_id)
    if dsp_setting is None or not dsp_setting.preauth_defect_groups:
        return None  # DSP hasn't opted in to any preauth groups

    group = await _resolve_defect_group(session, defect, vehicle.vehicle_class)
    if group is None or group not in dsp_setting.preauth_defect_groups:
        return None

    review = DefectReview(
        defect_id=defect_id,
        decision=DefectReviewDecision.APPROVED,
        decision_method=DefectReviewDecisionMethod.AUTO_PREAUTH_GROUP,
        reviewer_id=None,
        reason=f"Auto-approved via preauth group: {group}",
    )
    session.add(review)
    await session.flush()
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.DEFECT_REVIEW,
        entity_id=review.id,
        action="defect_auto_approved",
        actor_id=None,
        details={"defect_id": defect_id, "group": group, "method": "auto_preauth_group"},
    )
    return review


async def manual_review(
    session: AsyncSession,
    *,
    defect_id: int,
    decision: DefectReviewDecision,
    reviewer_id: int,
    reason: str | None = None,
) -> DefectReview:
    """Record a manual decision. Approved defects become eligible for
    bundling (caller hands off to wo_bundler.consider_defect_for_bundling).

    Caller is responsible for committing the session.
    """
    review = DefectReview(
        defect_id=defect_id,
        decision=decision,
        decision_method=DefectReviewDecisionMethod.MANUAL,
        reviewer_id=reviewer_id,
        reason=reason,
    )
    session.add(review)
    await session.flush()
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.DEFECT_REVIEW,
        entity_id=review.id,
        action=(
            "defect_manually_approved"
            if decision == DefectReviewDecision.APPROVED
            else "defect_manually_rejected"
        ),
        actor_id=reviewer_id,
        details={"defect_id": defect_id, "method": "manual", "reason": reason},
    )
    return review
