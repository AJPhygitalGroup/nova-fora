"""WorkOrderNote — threaded notes on a WO.

`author_role` records who's "speaking" so the UI can render with the
right styling (customer vs vendor vs technician vs system). `author_id`
is NULL for system notes (router placement, status auto-transitions).

`channel` discriminates 'internal' (vendor team only — visible to SW +
technicians) from 'customer' (bilateral SW ↔ DSP thread). One table for
both flows keeps the activity-log unified; the channel field gates who
sees what.
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Column
from sqlmodel import Field, SQLModel

from app.models.base import utc_now
from app.models.work_orders.enums import NoteAuthorRole


class WorkOrderNoteChannel(str, Enum):
    """Visibility scope for a note (WO V2 spec §3.11).

    'internal' = vendor's private thread (SW, technicians, admin).
    'customer' = bilateral SW ↔ DSP chat surface.

    Stored as VARCHAR(20) + CHECK constraint (CLAUDE.md rule #2).
    """

    INTERNAL = "internal"
    CUSTOMER = "customer"


class WorkOrderNote(SQLModel, table=True):
    __tablename__ = "work_order_notes"
    __table_args__ = (
        CheckConstraint(
            "channel IN ('internal', 'customer')",
            name="work_order_notes_channel_chk",
        ),
        # Escalation reason — set when the SW flags a customer-facing
        # note for special attention (mockup page 7, Mohammed's demo
        # called this "Escalate"). CMR = customer maintenance request
        # the vendor needs the DSP to accept; exceeded_price_cap = the
        # estimate ran above what FMC will reimburse.
        CheckConstraint(
            "escalation_reason IS NULL "
            "OR escalation_reason IN ('cmr', 'exceeded_price_cap')",
            name="work_order_notes_escalation_chk",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    work_order_id: int = Field(
        sa_column=Column(
            "work_order_id",
            sa.Integer,
            sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    author_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="NULL for system notes (no human author).",
    )
    author_role: NoteAuthorRole = Field(
        sa_column=Column(
            "author_role",
            sa.Enum(
                NoteAuthorRole,
                native_enum=False,
                length=30,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
        ),
    )
    channel: WorkOrderNoteChannel = Field(
        default=WorkOrderNoteChannel.INTERNAL,
        sa_column=Column(
            "channel",
            sa.Enum(
                WorkOrderNoteChannel,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            server_default="internal",
        ),
    )
    body: str = Field(nullable=False)
    # Optional escalation marker — only meaningful on channel='customer'
    # notes. NULL = regular note. Constrained at DB level via
    # work_order_notes_escalation_chk above.
    escalation_reason: str | None = Field(
        default=None,
        max_length=30,
        description="'cmr' or 'exceeded_price_cap' when the SW marks the "
                    "note as escalated. NULL for regular notes.",
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
