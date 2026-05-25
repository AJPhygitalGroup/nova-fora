"""vehicle_notes — persistent SW notes scoped to a van (not a WO).

Tiny iter-1 addition: lets the Service Writer leave a sticky note
on a van that survives across WOs ("DSP usually drops keys at side
door"). The van detail view aggregates these in the SERVICE WRITER
NOTES panel above ACTIVE WORK.

Append-only. No edit / soft-delete in iter-1 — if a note gets stale
the SW just writes a new one.

Revision ID: 20260525_0300_vehicle_notes
Revises: 20260524_1200_wo_v2_iter1_additions
Create Date: 2026-05-25 03:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260525_0300"
down_revision = "20260524_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vehicle_notes",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "author_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_vehicle_notes_vehicle_id",
        "vehicle_notes",
        ["vehicle_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_vehicle_notes_vehicle_id", table_name="vehicle_notes")
    op.drop_table("vehicle_notes")
