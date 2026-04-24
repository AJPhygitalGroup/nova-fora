"""Base model utilities — shared across all SQLModel tables."""
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, text
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    """Return current UTC datetime (tz-aware)."""
    return datetime.now(UTC)


class TimestampMixin(SQLModel):
    """Adds created_at / updated_at to any table.

    Note: updated_at is NOT auto-updated by the DB — each service method must
    set it on mutation. SQLAlchemy's `onupdate` hook only fires on ORM-level
    updates and we want explicit control.

    Columns are TIMESTAMPTZ (timezone-aware) to match the migration. Python
    datetimes must be tz-aware (see `utc_now()`).
    """

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "created_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "updated_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
