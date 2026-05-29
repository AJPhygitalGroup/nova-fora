"""Drop the two WO V2 triggers that the iter-1 spec marks dormant.

Both were created in the V2.0 rebuild migration as forward-compat
scaffolding for the line_item flow. The iter-1 spec § "Do NOT implement"
explicitly lists them under "kept in schema, no runtime use" — but the
DB still has them and the `assert_external_mode_ro_present` one bites
when the SW accepts a WO on an external-mode workshop (e.g., Dulles
Midas) before an RO# is attached. That's friction the spec demo
doesn't have (the SW types the RO# AFTER acceptance in iter-1).

When the line_item flow lights up in iter-2, both triggers come back
via a new migration with the proper guard rails wired up.

Revision ID: 20260525_0700_drop_dormant_triggers
Revises: 20260525_0300
Create Date: 2026-05-25 07:00:00.000000
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260525_0700"
down_revision = "20260525_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the triggers + their backing functions if they exist. Using
    # IF EXISTS so the migration is safe to re-run.
    op.execute("DROP TRIGGER IF EXISTS trg_work_orders_assert_external_mode_ro ON work_orders;")
    op.execute("DROP FUNCTION IF EXISTS assert_external_mode_ro_present();")
    op.execute("DROP TRIGGER IF EXISTS trg_work_orders_assert_defect_repair_links ON work_orders;")
    op.execute("DROP FUNCTION IF EXISTS assert_defect_repair_links_on_complete();")


def downgrade() -> None:
    # No-op: iter-2 will re-create both with their new spec contracts.
    # Recreating them verbatim here would resurrect the same iter-1
    # friction the upgrade was meant to remove.
    pass
