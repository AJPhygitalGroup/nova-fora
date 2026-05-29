"""VendorBucksLedger — append-only credit log for the rewards program.

Mockup p.11 + Jorge round 4: when a defect is completed (DR transitions
to RESOLVED), the vendor's rewards program credits the DSP a % of the
defect's estimated_cost as "vendor bucks". The DSP can spend those
bucks on the vendor's reward tiers (free safety inspection, etc.).

Each row is one event:
  - entry_type='accrual'   — defect completion credit (positive amount)
  - entry_type='redemption' — DSP spent bucks (negative amount, iter-2)
  - entry_type='expiry'    — past the duration window (negative amount, iter-2)

iter-1 ships only `accrual` so demos show a balance growing per
defect resolved. Redemption + expiry land in iter-2 with the cron.
Balance is computed by SUM(amount) per (vendor_workshop, dsp) — cheap
because the ledger stays small (10s/100s rows per pair).
"""
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Column
from sqlalchemy.types import Numeric
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class VendorBucksLedger(SQLModel, table=True):
    __tablename__ = "vendor_bucks_ledger"
    __table_args__ = (
        CheckConstraint(
            "entry_type IN ('accrual', 'redemption', 'expiry', 'adjustment')",
            name="vendor_bucks_ledger_type_chk",
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
    )
    rewards_program_id: int | None = Field(
        default=None,
        foreign_key="rewards_programs.id",
        description="Program in force at the time of the entry. NULL if "
                    "the vendor later deletes the program — historical "
                    "ledger rows survive.",
    )
    defect_id: int | None = Field(
        default=None,
        foreign_key="defects.id",
        description="The defect that triggered the accrual. NULL for "
                    "redemption / expiry / manual adjustments.",
    )
    work_order_id: int | None = Field(
        default=None,
        foreign_key="work_orders.id",
        description="Convenience — which WO closed it.",
    )
    entry_type: str = Field(
        max_length=20,
        nullable=False,
        description="'accrual' | 'redemption' | 'expiry' | 'adjustment'",
    )
    amount: Decimal = Field(
        sa_column=Column(
            "amount",
            Numeric(10, 2),
            nullable=False,
        ),
        description="Positive for accrual, negative for redemption/expiry.",
    )
    expires_at: date | None = Field(
        default=None,
        sa_column=Column(
            "expires_at",
            sa.Date,
            nullable=True,
            index=True,
        ),
        description="When this accrued amount expires (iter-2 cron sweeps "
                    "rows past this date and writes the matching 'expiry' "
                    "entry). NULL on entries that don't expire.",
    )
    notes: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    created_by_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="User who triggered it (the SW completing the WO, "
                    "or NULL for system/cron entries).",
    )
