"""WO V2.0 activity log writer.

Every status transition on RR / WO / line_item / defect_resolution /
defect_review writes a row to `wo_activity_log`. Other event types
(note_added, ro_assigned, variance_breached, etc.) also flow through
here so we have one consistent audit trail.

Required `details` shape for status_changed (per spec §7):
    {"from": "<old_value>", "to": "<new_value>"}

Other `action` types define their own `details` shape per feature.
See docs/wo-v2-rebuild.md for the deferred surface (cost_approved
events stay in the schema but the app never writes them in v2.0).
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.work_orders import WoActivityLog, WoActivityLogEntityType


async def log_status_change(
    session: AsyncSession,
    *,
    entity_type: WoActivityLogEntityType,
    entity_id: int,
    from_status: str | None,
    to_status: str,
    actor_id: int | None,
) -> WoActivityLog:
    """Convenience for the most common case — a status transition.

    `from_status` may be None when the entity transitions from "no row" /
    NULL into its first concrete status (rare; used by the bundler when
    spawning a new RR straight into 'open' and wanting an audit entry).
    """
    return await log_event(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        action="status_changed",
        actor_id=actor_id,
        details={"from": from_status, "to": to_status},
    )


async def log_event(
    session: AsyncSession,
    *,
    entity_type: WoActivityLogEntityType,
    entity_id: int,
    action: str,
    actor_id: int | None,
    details: dict[str, Any] | None = None,
) -> WoActivityLog:
    """Generic writer — any action with arbitrary `details`.

    Caller owns the session commit; this only adds the row to the unit
    of work so callers can batch multiple writes (e.g., bundling adds N
    defects + 1 RR creation event in one commit).
    """
    row = WoActivityLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_id=actor_id,
        details=details or {},
    )
    session.add(row)
    await session.flush()  # populate `id` for callers that need it
    return row
