"""RepairFeedback — DSP-side review of a completed work order.

Powers the Vendor Scorecard (mockup p.4 + Mohammed's demo, May 25).
After the SW marks a WO as completed, the DSP gets a "pending
feedback" badge on their Defects Repaired tile. Clicking opens a
review modal where the DSP votes thumbs-up / thumbs-down, optionally
picks an "Impressive" or "Negative" attribute (turnaround time,
communication, professionalism, work quality, price), and may flag
the work for escalation.

The aggregate per workshop drives the Vendor Scorecard view:
satisfaction rate, top attribute mentions, recent feedback drilldown.

Schema choice: one row per (WO, submitter) tuple — DSP changes their
mind, the latest row wins. We could enforce UNIQUE (work_order_id,
submitted_by_id) but iter-1 leaves it open so historical reviews
remain queryable for auditing.
"""
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Column
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class RepairFeedback(SQLModel, table=True):
    __tablename__ = "repair_feedback"
    __table_args__ = (
        CheckConstraint(
            "vote IN ('up', 'down')",
            name="repair_feedback_vote_chk",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    work_order_id: int = Field(
        sa_column=Column(
            "work_order_id",
            sa.Integer,
            sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    # Denormalised so aggregate scorecard queries don't need to walk
    # WO → workshop or WO → dsp every time.
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
    )
    vote: str = Field(max_length=8, nullable=False)
    reason: str | None = Field(default=None)
    escalate: bool = Field(
        default=False,
        sa_column=Column(
            "escalate",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        description="Only meaningful on vote='down' — flags egregious quality",
    )
    impressive_attribute: str | None = Field(
        default=None,
        max_length=40,
        description="When vote='up', optional attribute they want to highlight: "
                    "turnaround_time / communication / professionalism / work_quality / price",
    )
    negative_attribute: str | None = Field(
        default=None,
        max_length=40,
        description="When vote='down', optional attribute they want to call out",
    )
    submitted_by_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="DSP user who submitted. NULL for system-imported reviews.",
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
