"""defect_reviews.reject_reason_code — structured reject codes (mockup p.9).

Adds an optional `reject_reason_code` column to `defect_reviews`. NULL
unless `decision='rejected'`. Iter-1 ships three values:

  • 'shop_no_capability'    — vendor can't perform this kind of work
  • 'illegitimate_defect'   — defect isn't real / shouldn't have been
                              reported (counts against inspector KPI)
  • 'other'                 — catch-all

When the value is 'illegitimate_defect', downstream analytics attributes
the rejection to the defect's `reported_by_id` for inspector grading.

Revision ID: 20260525_2000
Revises: 20260525_1900
Create Date: 2026-05-25 20:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260525_2000"
down_revision = "20260525_1900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "defect_reviews",
        sa.Column("reject_reason_code", sa.String(length=40), nullable=True),
    )
    op.create_check_constraint(
        "defect_reviews_reject_reason_chk",
        "defect_reviews",
        "reject_reason_code IS NULL "
        "OR reject_reason_code IN ('shop_no_capability', 'illegitimate_defect', 'other')",
    )
    # Helpful for the inspector KPI rollup.
    op.create_index(
        "ix_defect_reviews_reject_reason_code",
        "defect_reviews",
        ["reject_reason_code"],
        postgresql_where=sa.text("reject_reason_code IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_defect_reviews_reject_reason_code", table_name="defect_reviews")
    op.drop_constraint(
        "defect_reviews_reject_reason_chk",
        "defect_reviews",
        type_="check",
    )
    op.drop_column("defect_reviews", "reject_reason_code")
