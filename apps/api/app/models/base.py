"""Base model utilities — shared across all SQLModel tables.

We don't use a TimestampMixin with sa_column because SQLModel has a known
limitation: Column objects can't be shared across multiple Table instances,
and mixin inheritance doesn't clone them. Each table defines its own
created_at / updated_at explicitly via `make_timestamp_cols()`.

Also wires a global `before_update` event listener that auto-fills
`updated_at` on every model that has the column. Replaces the 5 spec
`set_updated_at` triggers from the WO V2.0 schema at the app layer —
keeps backfills flexible (the listener runs on the ORM path, not raw SQL,
so `session.execute(update(...))` bypasses it for explicit timestamps).
"""
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, event, text
from sqlalchemy.orm import Session


def utc_now() -> datetime:
    """Return current UTC datetime (tz-aware)."""
    return datetime.now(UTC)


def timestamp_column(name: str) -> Column:
    """Factory: returns a new Column instance for created_at/updated_at.

    Each call creates a fresh Column, so it's safe to use in multiple tables.
    Columns are TIMESTAMPTZ (timezone=True) to match the migration.
    """
    return Column(
        name,
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )


# ─────────────────────────────────────────────────────────
# Auto-`updated_at` listener — global on Session.before_flush.
#
# Replaces the 5 spec `set_updated_at` BEFORE UPDATE triggers (one per
# WO V2.0 table) at the ORM layer. Fires once per session flush; we walk
# `session.dirty` and bump `updated_at` on each modified instance that has
# the column. Opt-out per-class or per-instance via `__auto_updated_at__`.
#
# Why Session.before_flush rather than Mapper.before_update?
#   - `event.listens_for(Mapper, "before_update", propagate=True)` requires
#     a concrete Mapper instance, not the Mapper class — registering at
#     import time fails with "'memoized_attribute' object is not iterable".
#   - before_flush runs once on the session, scans .dirty, and stamps every
#     candidate. No per-model decoration needed. Slightly broader scope
#     (fires on any update, even ones that didn't change `updated_at` would
#     ordinarily get auto-updated), which matches what we want.
# ─────────────────────────────────────────────────────────
@event.listens_for(Session, "before_flush")
def _auto_set_updated_at_on_flush(session, flush_context, instances) -> None:
    for obj in session.dirty:
        if not session.is_modified(obj, include_collections=False):
            continue
        if not getattr(obj, "__auto_updated_at__", True):
            continue
        if hasattr(obj, "updated_at"):
            obj.updated_at = utc_now()
