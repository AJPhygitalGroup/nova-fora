"""DefectResolution status sync — derive DR status from linked line items.

Spec §7 "defect_resolution status follows its line items":

  - DR stays `pending` while ANY linked line item is non-terminal
    (`pending_scope_approval`, `pending_cost_approval`, `pending`,
    `pending_variance_reapproval`).
  - Once every linked line item reaches a terminal status:
      ≥1 `done`         → DR → `resolved` (resolved_at = max updated_at)
      all `deferred`    → DR → `deferred`
      all `declined`    → DR → `declined`
      mix of done + deferred → DR → `resolved` (done wins)
      mix of done + declined → DR → `resolved`

App-side responsibility — no DB trigger. Call `sync_dr_from_line_items()`
after any line item status change on the same WO. v2.x may migrate this
to a DB trigger once rules stabilize.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.work_orders import (
    DefectResolution,
    DefectResolutionStatus,
    LineItemStatus,
    WoActivityLogEntityType,
    WorkOrderLineItem,
    WorkOrderLineItemResolution,
)
from app.services.wo_activity_log import log_status_change


# Statuses that mean "still waiting" — DR stays pending if ANY linked
# line item is in one of these.
_NON_TERMINAL_LI_STATUSES = {
    LineItemStatus.PENDING_SCOPE_APPROVAL,
    LineItemStatus.PENDING_COST_APPROVAL,
    LineItemStatus.PENDING,
    LineItemStatus.PENDING_VARIANCE_REAPPROVAL,
}


async def _terminal_statuses_for_dr(
    session: AsyncSession, dr_id: int
) -> list[tuple[LineItemStatus, object]]:
    """All (status, updated_at) tuples for line items linked to this DR."""
    rows = (
        await session.execute(
            select(WorkOrderLineItem.status, WorkOrderLineItem.updated_at)
            .join(
                WorkOrderLineItemResolution,
                WorkOrderLineItemResolution.line_item_id == WorkOrderLineItem.id,
            )
            .where(WorkOrderLineItemResolution.defect_resolution_id == dr_id)
        )
    ).all()
    return [(s if isinstance(s, LineItemStatus) else LineItemStatus(s), ts) for s, ts in rows]


async def sync_dr_from_line_items(
    session: AsyncSession,
    *,
    defect_resolution_id: int,
    actor_id: int | None = None,
) -> DefectResolution | None:
    """Recompute one DR's status based on its linked line items.

    Returns the DR (after any status change) or None if not found.
    Caller commits.
    """
    dr = (
        await session.execute(
            select(DefectResolution).where(DefectResolution.id == defect_resolution_id)
        )
    ).scalar_one_or_none()
    if dr is None:
        return None

    pairs = await _terminal_statuses_for_dr(session, dr.id)
    if not pairs:
        return dr  # no linked items yet; DR stays pending

    statuses = [s for s, _ in pairs]

    # Any non-terminal? → keep pending
    if any(s in _NON_TERMINAL_LI_STATUSES for s in statuses):
        if dr.status != DefectResolutionStatus.PENDING:
            prev = dr.status.value if hasattr(dr.status, "value") else str(dr.status)
            dr.status = DefectResolutionStatus.PENDING
            session.add(dr)
            await log_status_change(
                session,
                entity_type=WoActivityLogEntityType.DEFECT_RESOLUTION,
                entity_id=dr.id,
                from_status=prev,
                to_status=DefectResolutionStatus.PENDING.value,
                actor_id=actor_id,
            )
        return dr

    # All terminal — pick the bucket
    has_done = any(s == LineItemStatus.DONE for s in statuses)
    all_deferred = all(s == LineItemStatus.DEFERRED for s in statuses)
    all_declined = all(s == LineItemStatus.DECLINED for s in statuses)

    if has_done:
        new_status = DefectResolutionStatus.RESOLVED
        latest_ts = max(ts for _, ts in pairs)
    elif all_deferred:
        new_status = DefectResolutionStatus.DEFERRED
        latest_ts = None
    elif all_declined:
        new_status = DefectResolutionStatus.DECLINED
        latest_ts = None
    else:
        # Mixed deferred + declined → declined (no work happened)
        new_status = DefectResolutionStatus.DECLINED
        latest_ts = None

    prev = dr.status.value if hasattr(dr.status, "value") else str(dr.status)
    if prev != new_status.value:
        dr.status = new_status
        if new_status == DefectResolutionStatus.RESOLVED and latest_ts is not None:
            dr.resolved_at = latest_ts
        session.add(dr)
        await log_status_change(
            session,
            entity_type=WoActivityLogEntityType.DEFECT_RESOLUTION,
            entity_id=dr.id,
            from_status=prev,
            to_status=new_status.value,
            actor_id=actor_id,
        )

    await session.flush()
    return dr


async def sync_all_drs_for_wo(
    session: AsyncSession,
    *,
    work_order_id: int,
    actor_id: int | None = None,
) -> list[DefectResolution]:
    """Sync every DR on a given WO. Use after batch line item updates."""
    dr_ids = list(
        (
            await session.execute(
                select(DefectResolution.id).where(
                    DefectResolution.work_order_id == work_order_id
                )
            )
        )
        .scalars()
        .all()
    )
    out: list[DefectResolution] = []
    for did in dr_ids:
        synced = await sync_dr_from_line_items(
            session, defect_resolution_id=did, actor_id=actor_id
        )
        if synced is not None:
            out.append(synced)
    return out
