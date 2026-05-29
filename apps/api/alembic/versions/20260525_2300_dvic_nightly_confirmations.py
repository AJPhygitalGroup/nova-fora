"""dvic_nightly_confirmations — vendor nightly "DSP ready" confirm.

Backs the Upcoming DVIC chips on the Vendor Home banner (mockup p.2).
One row per (vendor_workshop, dsp, date) tuple — UNIQUE constraint
enforces "one confirmation per night per DSP per shop". Absence of
a row = not yet confirmed.

Revision ID: 20260525_2300
Revises: 20260525_2200
Create Date: 2026-05-25 23:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260525_2300"
down_revision = "20260525_2200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dvic_nightly_confirmations",
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
        sa.Column("confirmation_date", sa.Date(), nullable=False),
        sa.Column(
            "confirmed_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column(
            "confirmed_by_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint(
            "vendor_workshop_id", "dsp_id", "confirmation_date",
            name="uq_dvic_nightly_triple",
        ),
    )
    op.create_index(
        "ix_dvic_nightly_ws_id",
        "dvic_nightly_confirmations",
        ["vendor_workshop_id"],
    )
    op.create_index(
        "ix_dvic_nightly_dsp_id",
        "dvic_nightly_confirmations",
        ["dsp_id"],
    )
    op.create_index(
        "ix_dvic_nightly_date",
        "dvic_nightly_confirmations",
        ["confirmation_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_dvic_nightly_date", table_name="dvic_nightly_confirmations")
    op.drop_index("ix_dvic_nightly_dsp_id", table_name="dvic_nightly_confirmations")
    op.drop_index("ix_dvic_nightly_ws_id", table_name="dvic_nightly_confirmations")
    op.drop_table("dvic_nightly_confirmations")
