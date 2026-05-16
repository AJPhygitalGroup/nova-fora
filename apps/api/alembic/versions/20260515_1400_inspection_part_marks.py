"""inspections: per-part pass/N/A tracking for the new checklist UI

Revision ID: 20260515_1400
Revises: 20260513_2200
Create Date: 2026-05-15 14:00:00.000000

Adds the `inspection_part_marks` table that backs the NOVABODY-style
checklist rework. The walkaround now requires the inspector to mark
EVERY part on the vehicle's catalog as one of:

  - `pass` → explicit row in this table
  - `na`   → explicit row in this table
  - `defect` → implicit; signaled by an existing row in `defects` for
              the same (inspection_id, part). NOT stored here.

The composite PK (inspection_id, part) makes re-taps idempotent — the
upsert at the route layer overwrites the existing mark instead of
stacking history. Activity log captures decision history when wired.

Schema:
  inspection_id  INT NOT NULL  → FK inspections(id) ON DELETE CASCADE
  part           VARCHAR(40)   → DefectPart enum value as string
  status         VARCHAR(10)   → CHECK ('pass', 'na')
  marked_at      TIMESTAMPTZ
  marked_by_id   INT NULL      → FK users(id) ON DELETE SET NULL

Reversible — drop the table in downgrade.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260515_1400"
down_revision: Union[str, None] = "20260513_2200"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "inspection_part_marks",
        sa.Column(
            "inspection_id",
            sa.Integer(),
            sa.ForeignKey("inspections.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "part",
            sa.String(length=40),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=10),
            nullable=False,
        ),
        sa.Column(
            "marked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "marked_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint(
            "status IN ('pass', 'na')",
            name="ck_inspection_part_marks_status",
        ),
        comment="Per-(inspection, part) pass/N/A marks for the checklist UI. "
                "Defect status is implicit via the defects table.",
    )
    # Secondary index on inspection_id alone (the PK already covers it as
    # the leading column, but an explicit name makes the intent obvious
    # to the DBA reviewing the schema).
    op.create_index(
        "ix_inspection_part_marks_inspection_id",
        "inspection_part_marks",
        ["inspection_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_inspection_part_marks_inspection_id",
        table_name="inspection_part_marks",
    )
    op.drop_table("inspection_part_marks")
