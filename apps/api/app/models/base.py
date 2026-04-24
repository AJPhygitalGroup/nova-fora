"""Base model utilities — shared across all SQLModel tables."""
from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    """Return current UTC datetime (tz-aware)."""
    return datetime.now(UTC)


class TimestampMixin(SQLModel):
    """Adds created_at / updated_at to any table.

    Note: updated_at is NOT auto-updated by the DB — each service method must
    set it on mutation. SQLAlchemy's `onupdate` hook only fires on ORM-level
    updates and we want explicit control.
    """

    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)
