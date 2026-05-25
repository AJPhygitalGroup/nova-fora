"""customer_preferred_vendors — DSP-pinned vendor preferences (spec §10).

Creates `customer_preferred_vendors` so a DSP can mark a vendor workshop
as their primary (or eventually ranked) preference for a given repair
type. Iter-1 surfaces this via the "You are the primary vendor" gold
ribbon on the My DSPs card (mockup p.10).

Schema (iter-1 minimal):
  • dsp_id            FK organizations(id) ON DELETE CASCADE
  • vendor_workshop_id FK vendor_workshops(id) ON DELETE CASCADE
  • repair_type        VARCHAR(20) NULL — NULL means "applies to all types"
  • is_primary         BOOL NOT NULL DEFAULT FALSE
  • created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  • created_by_id      FK users(id) ON DELETE SET NULL

Constraints:
  • UNIQUE (dsp_id, vendor_workshop_id, repair_type)
    — keeps one row per (dsp, vendor, type) triple
  • Partial unique index on (dsp_id, repair_type) WHERE is_primary=TRUE
    — only one primary per (dsp, type), enforced at DB level

Iter-2 will add a `rank INT` column for ordered fallback (preferred ->
secondary -> tertiary). Iter-1 just uses the boolean.

Revision ID: 20260525_2100
Revises: 20260525_2000
Create Date: 2026-05-25 21:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260525_2100"
down_revision = "20260525_2000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customer_preferred_vendors",
        sa.Column("id", sa.Integer, primary_key=True, nullable=False),
        sa.Column(
            "dsp_id", sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "vendor_workshop_id", sa.Integer,
            sa.ForeignKey("vendor_workshops.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("repair_type", sa.String(length=20), nullable=True),
        sa.Column(
            "is_primary", sa.Boolean,
            server_default=sa.false(), nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column(
            "created_by_id", sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint(
            "dsp_id", "vendor_workshop_id", "repair_type",
            name="uq_cust_pref_vendor_triple",
        ),
    )
    op.create_index(
        "ix_cust_pref_vendor_dsp_id",
        "customer_preferred_vendors",
        ["dsp_id"],
    )
    op.create_index(
        "ix_cust_pref_vendor_ws_id",
        "customer_preferred_vendors",
        ["vendor_workshop_id"],
    )
    # Single-primary-per-(dsp, repair_type) — partial index covers both
    # NULL repair_type and concrete values.
    op.execute(
        "CREATE UNIQUE INDEX uq_cust_pref_vendor_primary_per_type "
        "ON customer_preferred_vendors (dsp_id, COALESCE(repair_type, '__all__')) "
        "WHERE is_primary = TRUE"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_cust_pref_vendor_primary_per_type")
    op.drop_index("ix_cust_pref_vendor_ws_id", table_name="customer_preferred_vendors")
    op.drop_index("ix_cust_pref_vendor_dsp_id", table_name="customer_preferred_vendors")
    op.drop_table("customer_preferred_vendors")
