"""drop severity columns + DefectSeverityOverride table

Revision ID: 20260428_1400
Revises: 20260428_1200
Create Date: 2026-04-28 14:00:00.000000

Removes the severity grading concept (low/medium/high/critical) from the
data model. Aligns with the Amazon DVIC PDFs which treat each check as
binary (satisfactory vs not). Workflow / urgency cues now come from:
  - Inspection result (passed | flagged | incomplete) — derived from
    defect presence, no severity rank.
  - Work order flags (rush_order, stale, pending_fmc, subcontracted) —
    operational priority, set by humans.
  - Defect status (pending → acknowledged → converted_to_wo) — workflow.

Drops:
  reported_defects.severity                 (FK on enum-like VARCHAR + index)
  defect_details_schema.default_severity
  dvic_template_item.default_severity
  defect_severity_override (entire table — never populated)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260428_1400"
down_revision: Union[str, None] = "20260428_1200"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── reported_defects.severity ──
    # Drop the index + enum check + column.
    try:
        op.drop_index("ix_reported_defects_severity", table_name="reported_defects")
    except Exception:
        pass  # index name may differ across PG versions
    op.drop_column("reported_defects", "severity")

    # ── defect_details_schema.default_severity ──
    op.drop_column("defect_details_schema", "default_severity")

    # ── dvic_template_item.default_severity ──
    op.drop_column("dvic_template_item", "default_severity")

    # ── defect_severity_override (entire table) ──
    op.drop_table("defect_severity_override")


def downgrade() -> None:
    # Re-create the dropped table (best-effort — won't restore data).
    op.create_table(
        "defect_severity_override",
        sa.Column("defect_id", sa.Integer(), primary_key=True),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column("set_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["defect_id"], ["reported_defects.id"]),
        sa.ForeignKeyConstraint(["set_by_id"], ["users.id"]),
    )

    op.add_column(
        "dvic_template_item",
        sa.Column(
            "default_severity",
            sa.String(length=20),
            nullable=False,
            server_default="medium",
        ),
    )
    op.add_column(
        "defect_details_schema",
        sa.Column(
            "default_severity",
            sa.String(length=20),
            nullable=False,
            server_default="medium",
        ),
    )
    op.add_column(
        "reported_defects",
        sa.Column(
            "severity",
            sa.String(length=20),
            nullable=False,
            server_default="medium",
        ),
    )
    op.create_index(
        "ix_reported_defects_severity", "reported_defects", ["severity"]
    )
