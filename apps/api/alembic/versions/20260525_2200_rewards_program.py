"""rewards_programs + rewards_tiers — vendor loyalty program (mockup p.11).

Per-vendor settings: vendor_bucks_pct (% of DFS payout that converts
to bucks) + vendor_bucks_duration_months (3-12). Up to 5 reward tiers
per program (criteria_metric + criteria_count → reward_label).

The accrual + spending engine ships in iter-2; iter-1 is just the
schema + admin CRUD so the SW can configure the program.

Revision ID: 20260525_2200
Revises: 20260525_2100
Create Date: 2026-05-25 22:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260525_2200"
down_revision = "20260525_2100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rewards_programs",
        sa.Column("id", sa.Integer, primary_key=True, nullable=False),
        sa.Column(
            "vendor_workshop_id", sa.Integer,
            sa.ForeignKey("vendor_workshops.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "vendor_bucks_pct", sa.Numeric(5, 2),
            server_default=sa.text("0"), nullable=False,
        ),
        sa.Column(
            "vendor_bucks_duration_months", sa.Integer,
            server_default=sa.text("6"), nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.UniqueConstraint(
            "vendor_workshop_id",
            name="uq_rewards_programs_vendor_workshop_id",
        ),
        sa.CheckConstraint(
            "vendor_bucks_pct >= 0 AND vendor_bucks_pct <= 100",
            name="rewards_programs_bucks_pct_chk",
        ),
        sa.CheckConstraint(
            "vendor_bucks_duration_months >= 3 AND vendor_bucks_duration_months <= 12",
            name="rewards_programs_duration_chk",
        ),
    )

    op.create_table(
        "rewards_tiers",
        sa.Column("id", sa.Integer, primary_key=True, nullable=False),
        sa.Column(
            "rewards_program_id", sa.Integer,
            sa.ForeignKey("rewards_programs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tier_order", sa.Integer, nullable=False),
        sa.Column("metric_label", sa.String(length=80), nullable=False),
        sa.Column("metric_target", sa.Integer, nullable=False),
        sa.Column("reward_label", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.UniqueConstraint(
            "rewards_program_id", "tier_order",
            name="uq_rewards_tiers_program_order",
        ),
        sa.CheckConstraint(
            "tier_order >= 1 AND tier_order <= 5",
            name="rewards_tiers_order_range_chk",
        ),
        sa.CheckConstraint(
            "metric_target > 0",
            name="rewards_tiers_target_positive_chk",
        ),
    )
    op.create_index(
        "ix_rewards_tiers_program_id",
        "rewards_tiers",
        ["rewards_program_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_rewards_tiers_program_id", table_name="rewards_tiers")
    op.drop_table("rewards_tiers")
    op.drop_table("rewards_programs")
