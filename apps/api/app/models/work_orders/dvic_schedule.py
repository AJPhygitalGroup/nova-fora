"""DvicSchedule — vendor-scheduled QC DVIC appointments.

Replaces the old `dvic_nightly_confirmations` chip flow (which only
tracked a per-day confirmation flag with no actual time) with real
scheduled appointments: the vendor admin picks a date + time + DSP from
the new "Schedule QC DVIC" UI in VendorHome; this table stores each
row. The DSP customer home then checks `/dashboards/dsp/{id}/next-qc-dvic`
and shows the readiness banner ONLY when an appointment is within the
next 12 hours.

Cancellations are soft (`cancelled_at` set, row stays for audit) so the
DSP can still see "your inspection was cancelled by the vendor" if we
want to surface that in iter-2.

Recurrence is intentionally NOT in this iter — each row is a one-off
appointment. The Phase B follow-up will add `dvic_schedule_recurrences`
and a `parent_recurrence_id` here.

Multi-tenant scoping: the vendor admin owns scheduling for vehicles
that fall under their workshop's served DSP set. The endpoint validates
this; the table itself stays vendor-neutral so a future "DSP requests an
inspection" flow can also write here without schema changes.
"""
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class DvicSchedule(SQLModel, table=True):
    __tablename__ = "dvic_schedules"
    __table_args__ = (
        # cancelled_at semantics: NULL = active. When set, cancelled_by_id
        # must also be set (we never want a "ghost cancellation").
        CheckConstraint(
            "(cancelled_at IS NULL AND cancelled_by_id IS NULL) "
            "OR (cancelled_at IS NOT NULL AND cancelled_by_id IS NOT NULL)",
            name="dvic_schedules_cancellation_consistency",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)

    vendor_workshop_id: int = Field(
        sa_column=Column(
            "vendor_workshop_id",
            sa.Integer,
            sa.ForeignKey("vendor_workshops.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    dsp_id: int = Field(
        sa_column=Column(
            "dsp_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        description="The customer DSP receiving the inspection.",
    )

    # When the inspection will physically happen. TIMESTAMPTZ (UTC on the
    # wire) — frontend converts to the user's local tz for display. The
    # DSP banner uses `now() < scheduled_at <= now() + 12 hours` to gate.
    scheduled_at: datetime = Field(
        sa_column=Column(
            "scheduled_at",
            sa.DateTime(timezone=True),
            nullable=False,
            index=True,
        ),
    )

    # Free-text note the vendor admin can attach (e.g. "bring extra
    # battery tester", "park at back gate"). Surfaced in the DSP banner
    # tooltip in iter-1, never required.
    notes: str | None = Field(default=None, max_length=500)

    # Soft cancellation. Once set, the row is excluded from "upcoming"
    # queries but stays for audit + "we cancelled your inspection"
    # messaging that will land in iter-2.
    cancelled_at: datetime | None = Field(
        default=None,
        sa_column=Column(
            "cancelled_at",
            sa.DateTime(timezone=True),
            nullable=True,
            index=True,
        ),
    )
    cancelled_by_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="User who cancelled — null when active.",
    )
    cancellation_reason: str | None = Field(default=None, max_length=200)

    # 2026-06-06 Jorge — DSP-side confirmation. The customer clicks the
    # readiness banner, fills in where they're leaving the keys + any
    # notes, and we stamp these. Mirrors the WO pickup confirmation
    # shape. Alembic 20260606_0500.
    dsp_confirmed_at: datetime | None = Field(
        default=None,
        sa_column=Column(
            "dsp_confirmed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    dsp_confirmed_by_id: int | None = Field(
        default=None,
        foreign_key="users.id",
    )
    key_location: str | None = Field(default=None, sa_column=Column("key_location", sa.Text, nullable=True))
    dsp_notes: str | None = Field(default=None, sa_column=Column("dsp_notes", sa.Text, nullable=True))

    created_by_id: int = Field(
        foreign_key="users.id",
        nullable=False,
        description="Vendor admin / SW who scheduled this appointment.",
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=timestamp_column("created_at"),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=timestamp_column("updated_at"),
    )

    @property
    def id_str(self) -> str:
        """`DVIC-00042` — prefixed display id per the load-bearing string-
        id convention. Lets the frontend route by either int or string.
        """
        return f"DVIC-{self.id:05d}" if self.id is not None else "DVIC-?????"
