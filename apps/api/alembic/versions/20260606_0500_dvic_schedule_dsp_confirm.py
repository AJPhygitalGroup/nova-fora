"""dvic_schedules: add DSP confirmation columns

Jorge 2026-06-06: the DSP readiness banner needs an explicit
"confirmar inspeccion" flow (key drop location + notes), mirroring
the WO pickup confirmation flow. Adds:

  dsp_confirmed_at      timestamptz NULL  - set when DSP confirms
  dsp_confirmed_by_id   int NULL FK→users - audit trail
  key_location          text NULL         - where the inspector finds keys
  dsp_notes             text NULL         - any extra notes for the visit

All nullable so historical rows survive untouched. The DSP-side
endpoint POSTs to set them; the banner flips from "Action Required"
to "Confirmed" on success.

Revision ID: 20260606_0500
Revises: 20260606_0400
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260606_0500"
down_revision = "20260606_0400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dvic_schedules",
        sa.Column("dsp_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "dvic_schedules",
        sa.Column(
            "dsp_confirmed_by_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "dvic_schedules",
        sa.Column("key_location", sa.Text(), nullable=True),
    )
    op.add_column(
        "dvic_schedules",
        sa.Column("dsp_notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("dvic_schedules", "dsp_notes")
    op.drop_column("dvic_schedules", "key_location")
    op.drop_column("dvic_schedules", "dsp_confirmed_by_id")
    op.drop_column("dvic_schedules", "dsp_confirmed_at")
