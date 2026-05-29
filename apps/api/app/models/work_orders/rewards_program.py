"""RewardsProgram + RewardsTier — per-vendor loyalty program.

Mockup page 11. A vendor can configure up to 5 reward tiers (criteria +
reward description) plus a vendor-bucks payout ratio. DSPs accrue
vendor bucks per defect repaired at this vendor's shop; bucks expire
after a configurable duration so they have to spend them.

Iter-1 ships the schema + admin CRUD only. The actual accrual /
spending engine lights up in iter-2.
"""
from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Column, Numeric, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class RewardsProgram(SQLModel, table=True):
    __tablename__ = "rewards_programs"
    __table_args__ = (
        CheckConstraint(
            "vendor_bucks_pct >= 0 AND vendor_bucks_pct <= 100",
            name="rewards_programs_bucks_pct_chk",
        ),
        CheckConstraint(
            "vendor_bucks_duration_months >= 3 AND vendor_bucks_duration_months <= 12",
            name="rewards_programs_duration_chk",
        ),
        UniqueConstraint(
            "vendor_workshop_id",
            name="uq_rewards_programs_vendor_workshop_id",
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
    # Percentage of the DFS per-defect payout that becomes vendor bucks
    # for the DSP. 0 = no bucks; 100 = the entire payout becomes bucks
    # (effectively a fully-deferred reward).
    vendor_bucks_pct: Decimal = Field(
        default=Decimal("0"),
        sa_column=Column(
            "vendor_bucks_pct",
            Numeric(5, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    # How long the DSP has to spend bucks before they expire (3-12 months
    # range per spec). Bucks expiry runs daily via cron in iter-2.
    vendor_bucks_duration_months: int = Field(
        default=6,
        sa_column=Column(
            "vendor_bucks_duration_months",
            sa.Integer,
            nullable=False,
            server_default=sa.text("6"),
        ),
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
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            onupdate=sa.text("now()"),
        ),
    )


class RewardsTier(SQLModel, table=True):
    """One tier within a vendor's rewards program. Up to 5 per program.

    Example: metric_label='repaired_light_bulbs', metric_target=1000,
    reward_label='3 Free Safety Inspections'. The mockup example reads
    "1000 repaired lights to unlock 3 Free Safety Inspections".
    """

    __tablename__ = "rewards_tiers"
    __table_args__ = (
        CheckConstraint(
            "tier_order >= 1 AND tier_order <= 5",
            name="rewards_tiers_order_range_chk",
        ),
        CheckConstraint(
            "metric_target > 0",
            name="rewards_tiers_target_positive_chk",
        ),
        UniqueConstraint(
            "rewards_program_id", "tier_order",
            name="uq_rewards_tiers_program_order",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    rewards_program_id: int = Field(
        sa_column=Column(
            "rewards_program_id",
            sa.Integer,
            sa.ForeignKey("rewards_programs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    tier_order: int = Field(
        sa_column=Column("tier_order", sa.Integer, nullable=False),
        description="1..5 — display + unlock ordering within the program.",
    )
    metric_label: str = Field(
        max_length=80,
        nullable=False,
        description="Human label for what gets counted, e.g. 'Repaired light bulbs'.",
    )
    metric_target: int = Field(
        sa_column=Column("metric_target", sa.Integer, nullable=False),
        description="Count threshold the DSP must hit to unlock the reward.",
    )
    reward_label: str = Field(
        max_length=200,
        nullable=False,
        description="What the DSP gets, e.g. '3 Free Safety Inspections'.",
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
