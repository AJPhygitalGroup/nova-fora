"""repair_feedback — DSP-side vendor scorecard reviews.

Captures the thumbs-up/down + attribute reviews the DSP submits
after a WO completes. Drives the Vendor Scorecard satisfaction +
attribute breakdown queries.

Revision ID: 20260525_2500
Revises: 20260525_2400
Create Date: 2026-05-25 25:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260525_2500"
down_revision = "20260525_2400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "repair_feedback",
        sa.Column("id", sa.Integer, primary_key=True, nullable=False),
        sa.Column(
            "work_order_id", sa.Integer,
            sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "vendor_workshop_id", sa.Integer,
            sa.ForeignKey("vendor_workshops.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "dsp_id", sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("vote", sa.String(length=8), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "escalate", sa.Boolean,
            server_default=sa.false(), nullable=False,
        ),
        sa.Column("impressive_attribute", sa.String(length=40), nullable=True),
        sa.Column("negative_attribute", sa.String(length=40), nullable=True),
        sa.Column(
            "submitted_by_id", sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.CheckConstraint("vote IN ('up', 'down')", name="repair_feedback_vote_chk"),
    )
    op.create_index("ix_repair_feedback_workshop", "repair_feedback", ["vendor_workshop_id"])
    op.create_index("ix_repair_feedback_dsp", "repair_feedback", ["dsp_id"])
    op.create_index("ix_repair_feedback_wo", "repair_feedback", ["work_order_id"])


def downgrade() -> None:
    op.drop_index("ix_repair_feedback_wo", table_name="repair_feedback")
    op.drop_index("ix_repair_feedback_dsp", table_name="repair_feedback")
    op.drop_index("ix_repair_feedback_workshop", table_name="repair_feedback")
    op.drop_table("repair_feedback")
