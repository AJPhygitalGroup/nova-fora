"""dsp_critical_defects: per-DSP overlay for inspection rules

Jorge 2026-06-07. Adds a thin table that lets each DSP flag which
inspection rules they want highlighted as critical this week. The
shared Amazon catalog stays untouched; this is a (dsp, rule)
overlay with no payload beyond `set_by_id` + `created_at`.

Iter-1 scope is visual badge only — wizard / report rendering
surfaces the badge but no downstream gate logic. Per-DSP toggle
matches how inspectors rotate focus across categories week to
week (Safety First on lights this week, REJE on brakes).

Revision ID: 20260607_2000
Revises: 20260606_0500
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260607_2000"
down_revision = "20260606_0500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dsp_critical_defects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "dsp_id", sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "inspection_rule_id", sa.Integer(),
            sa.ForeignKey("inspection_rule.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "set_by_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint(
            "dsp_id", "inspection_rule_id",
            name="dsp_critical_defects_dsp_rule_uq",
        ),
    )
    op.create_index(
        "ix_dsp_critical_defects_dsp_id",
        "dsp_critical_defects", ["dsp_id"], unique=False,
    )
    op.create_index(
        "ix_dsp_critical_defects_inspection_rule_id",
        "dsp_critical_defects", ["inspection_rule_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_dsp_critical_defects_inspection_rule_id", table_name="dsp_critical_defects")
    op.drop_index("ix_dsp_critical_defects_dsp_id", table_name="dsp_critical_defects")
    op.drop_table("dsp_critical_defects")
