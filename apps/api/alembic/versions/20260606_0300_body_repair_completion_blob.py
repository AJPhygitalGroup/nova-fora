"""body_repair: add body_repair_requests.completion_blob

JSON column for vendor-side completion details: text notes + photo
storage keys + signoff metadata. Same pattern as pickup_blob — a
single blob covers Phase 4 scope without a dedicated table.

Revision ID: 20260606_0300
Revises: 20260606_0200
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260606_0300"
down_revision = "20260606_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "body_repair_requests",
        sa.Column("completion_blob", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("body_repair_requests", "completion_blob")
