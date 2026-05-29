"""work_order_notes.escalation_reason — SW escalation marker on customer notes.

Adds an optional `escalation_reason` column to `work_order_notes`. NULL
for regular notes; one of `('cmr', 'exceeded_price_cap')` when the SW
flags the note via the new "Escalate" button (Vendor View mockup p.7).

Iter-1 keeps the value set as a string + CHECK constraint (matches the
rest of the WO V2 enum-as-VARCHAR convention). Iter-2 may promote it
to a dedicated escalation table if we need multi-step escalations.

Revision ID: 20260525_1900
Revises: 20260525_0700
Create Date: 2026-05-25 19:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260525_1900"
down_revision = "20260525_0700"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_order_notes",
        sa.Column("escalation_reason", sa.String(length=30), nullable=True),
    )
    op.create_check_constraint(
        "work_order_notes_escalation_chk",
        "work_order_notes",
        "escalation_reason IS NULL "
        "OR escalation_reason IN ('cmr', 'exceeded_price_cap')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "work_order_notes_escalation_chk",
        "work_order_notes",
        type_="check",
    )
    op.drop_column("work_order_notes", "escalation_reason")
