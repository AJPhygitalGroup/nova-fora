"""Base model utilities — shared across all SQLModel tables.

We don't use a TimestampMixin with sa_column because SQLModel has a known
limitation: Column objects can't be shared across multiple Table instances,
and mixin inheritance doesn't clone them. Each table defines its own
created_at / updated_at explicitly via `make_timestamp_cols()`.
"""
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, text


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
