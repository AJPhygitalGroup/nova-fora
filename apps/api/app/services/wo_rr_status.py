"""RR status rollup — derive `repair_request.status` from child WO states.

Spec contract: "Don't write `repair_request.status` directly — always go
through the helper, which reads all line items and computes the new
state." In iter-1 the line_item flow is dormant, so we substitute a
WO-status-based rollup with the same semantics:

  - 0 child WOs                                   → open
  - any child WO in pending_acceptance / accepted /
    in_progress                                    → accepted
  - all child WOs terminal AND at least 1
    completed                                       → fulfilled
  - all child WOs terminal AND none completed
    (i.e. all declined or cancelled)               → cancelled

The 'stale' status (also a member of RepairRequestStatus) is set by a
separate timeout job, not this rollup. We never write 'stale' here.

Emits a `repair_request:N status_changed` activity log entry only when
the rollup result differs from the current rr.status — that way callers
can safely call refresh_rr_status() defensively on every WO-status
mutation without flooding the audit log with no-op entries.

Why a separate module: the rollup is the one place RR.status SHOULD be
mutated programmatically (the other being the user-explicit
`POST /repair-requests/{id}/cancel`). Keeping it in its own file makes
the contract obvious and makes the per-route wire-up calls grep-able.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.work_orders import (
    RepairRequest,
    RepairRequestStatus,
    WoActivityLogEntityType,
    WorkOrder,
    WorkOrderStatus,
)
from app.services.wo_activity_log import log_status_change


_OPEN_WO_STATUSES: frozenset[WorkOrderStatus] = frozenset({
    WorkOrderStatus.PENDING_ACCEPTANCE,
    WorkOrderStatus.ACCEPTED,
    WorkOrderStatus.IN_PROGRESS,
})


def _compute_rr_status(child_statuses: list[WorkOrderStatus]) -> RepairRequestStatus:
    """Pure function — derive the new RR status from its child WO
    statuses. No DB access. Easy to unit-test.
    """
    if not child_statuses:
        return RepairRequestStatus.OPEN
    if any(s in _OPEN_WO_STATUSES for s in child_statuses):
        return RepairRequestStatus.ACCEPTED
    # All child WOs are terminal (completed / declined / cancelled).
    if any(s == WorkOrderStatus.COMPLETED for s in child_statuses):
        return RepairRequestStatus.FULFILLED
    return RepairRequestStatus.CANCELLED


async def refresh_rr_status(
    session: AsyncSession,
    *,
    repair_request_id: int,
    actor_id: int | None = None,
) -> RepairRequestStatus | None:
    """Recompute and persist rr.status from its child WOs.

    Returns the final status (None if the RR doesn't exist — defensive
    no-op so callers can blanket-invoke on any wo.repair_request_id
    without first checking it exists). Caller commits.

    Emits status_changed activity log on the RR only when the new status
    differs from the previous one.
    """
    rr = (
        await session.execute(
            select(RepairRequest).where(RepairRequest.id == repair_request_id)
        )
    ).scalar_one_or_none()
    if rr is None:
        return None

    child_statuses: list[WorkOrderStatus] = list(
        (
            await session.execute(
                select(WorkOrder.status).where(WorkOrder.repair_request_id == rr.id)
            )
        ).scalars()
    )
    new_status = _compute_rr_status(child_statuses)

    prev_value = rr.status.value if hasattr(rr.status, "value") else str(rr.status)
    new_value = new_status.value
    if prev_value == new_value:
        return new_status  # no-op, skip the audit row

    rr.status = new_status
    session.add(rr)
    await session.flush()
    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
        entity_id=rr.id,
        from_status=prev_value,
        to_status=new_value,
        actor_id=actor_id,
    )
    return new_status
