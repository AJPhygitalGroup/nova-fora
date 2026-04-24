"""add inspections.status (DRAFT | SUBMITTED)

Revision ID: 20260424_2230
Revises: 20260424_2130
Create Date: 2026-04-24 22:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "20260424_2230"
down_revision: Union[str, None] = "20260424_2130"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add nullable first so existing rows don't violate NOT NULL on insert of the column
    op.add_column(
        "inspections",
        sa.Column(
            "status",
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=True,
            server_default="draft",
        ),
    )

    # Backfill: existing rows were all created atomically with defects → they
    # are effectively SUBMITTED, not DRAFT.
    op.execute("UPDATE inspections SET status = 'submitted' WHERE status IS NULL OR status = 'draft'")

    # Now enforce NOT NULL
    op.alter_column("inspections", "status", nullable=False)

    op.create_index("ix_inspections_status", "inspections", ["status"])


def downgrade() -> None:
    op.drop_index("ix_inspections_status", table_name="inspections")
    op.drop_column("inspections", "status")
