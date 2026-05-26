"""vendor_bucks_ledger — append-only credit log for rewards program.

Iter-1 only writes 'accrual' rows; iter-2 wires redemption + expiry
cron. Balance = SUM(amount) GROUP BY (vendor_workshop_id, dsp_id).

Revision ID: 20260525_2400
Revises: 20260525_2300
Create Date: 2026-05-25 23:30:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260525_2400"
down_revision = "20260525_2300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vendor_bucks_ledger",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "vendor_workshop_id", sa.Integer(),
            sa.ForeignKey("vendor_workshops.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "dsp_id", sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "rewards_program_id", sa.Integer(),
            sa.ForeignKey("rewards_programs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "defect_id", sa.Integer(),
            sa.ForeignKey("defects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "work_order_id", sa.Integer(),
            sa.ForeignKey("work_orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("entry_type", sa.String(length=20), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("expires_at", sa.Date(), nullable=True),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column(
            "created_by_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "vendor_bucks_ledger_type_chk",
        "vendor_bucks_ledger",
        "entry_type IN ('accrual', 'redemption', 'expiry', 'adjustment')",
    )
    op.create_index(
        "ix_vendor_bucks_ws_id",
        "vendor_bucks_ledger",
        ["vendor_workshop_id"],
    )
    op.create_index(
        "ix_vendor_bucks_dsp_id",
        "vendor_bucks_ledger",
        ["dsp_id"],
    )
    # Balance query is GROUP BY (ws, dsp) — composite index.
    op.create_index(
        "ix_vendor_bucks_pair",
        "vendor_bucks_ledger",
        ["vendor_workshop_id", "dsp_id"],
    )
    op.create_index(
        "ix_vendor_bucks_expires_at",
        "vendor_bucks_ledger",
        ["expires_at"],
        postgresql_where=sa.text("expires_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_vendor_bucks_expires_at", table_name="vendor_bucks_ledger")
    op.drop_index("ix_vendor_bucks_pair", table_name="vendor_bucks_ledger")
    op.drop_index("ix_vendor_bucks_dsp_id", table_name="vendor_bucks_ledger")
    op.drop_index("ix_vendor_bucks_ws_id", table_name="vendor_bucks_ledger")
    op.drop_constraint(
        "vendor_bucks_ledger_type_chk",
        "vendor_bucks_ledger",
        type_="check",
    )
    op.drop_table("vendor_bucks_ledger")
