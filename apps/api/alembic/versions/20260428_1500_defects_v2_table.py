"""defects v2 — standalone defects table per the Notion Defect Data Schema spec

Revision ID: 20260428_1500
Revises: 20260428_1400
Create Date: 2026-04-28 15:00:00.000000

Creates the new `defects` table per the post-consensus spec (vehicle FK
mandatory, inspection FK optional, defect_source enum, CHECK constraint).
The legacy `reported_defects` table coexists during the migration period —
see app/cli.py `backfill-defects` for the data migration step.

Validation triggers (assert_position_valid, assert_details_valid) are NOT
created here — they are tracked as a follow-up PR. Validation runs at the
app layer in `app/services/defect_validation.py`.
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260428_1500"
down_revision: Union[str, None] = "20260428_1400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "defects",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vehicle_id", sa.Integer(), nullable=False),
        sa.Column("inspection_id", sa.Integer(), nullable=True),
        sa.Column(
            "source",
            sqlmodel.sql.sqltypes.AutoString(length=30),
            nullable=False,
        ),
        sa.Column(
            "part",
            sqlmodel.sql.sqltypes.AutoString(length=40),
            nullable=False,
        ),
        sa.Column(
            "position",
            sqlmodel.sql.sqltypes.AutoString(length=30),
            nullable=True,
        ),
        sa.Column(
            "defect_type",
            sqlmodel.sql.sqltypes.AutoString(length=40),
            nullable=False,
        ),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "notes",
            sqlmodel.sql.sqltypes.AutoString(length=2000),
            nullable=True,
        ),
        sa.Column("reported_by_id", sa.Integer(), nullable=False),
        sa.Column(
            "reported_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"]),
        sa.ForeignKeyConstraint(["inspection_id"], ["inspections.id"]),
        sa.ForeignKeyConstraint(["reported_by_id"], ["users.id"]),
        sa.CheckConstraint(
            "(source = 'inspection' AND inspection_id IS NOT NULL) "
            "OR (source <> 'inspection' AND inspection_id IS NULL)",
            name="defects_source_inspection_consistency",
        ),
    )

    # Single-column indexes
    op.create_index("ix_defects_vehicle_id", "defects", ["vehicle_id"])
    op.create_index("ix_defects_source", "defects", ["source"])
    op.create_index("ix_defects_part", "defects", ["part"])
    op.create_index("ix_defects_defect_type", "defects", ["defect_type"])
    op.create_index("ix_defects_reported_by_id", "defects", ["reported_by_id"])
    op.create_index("ix_defects_reported_at", "defects", ["reported_at"])

    # Composite for dashboard aggregations
    op.create_index(
        "ix_defects_part_defect_type", "defects", ["part", "defect_type"]
    )

    # Vehicle + reported_at desc — supports "recent defects on this vehicle"
    op.execute(
        "CREATE INDEX ix_defects_vehicle_reported_at "
        "ON defects (vehicle_id, reported_at DESC)"
    )

    # Partial: only index inspection_id when set (filter "defects for inspection X")
    op.execute(
        "CREATE INDEX ix_defects_inspection_id_partial "
        "ON defects (inspection_id) WHERE inspection_id IS NOT NULL"
    )

    # GIN on details for JSONB path queries (e.g. details->>'tread_depth_32nds')
    op.execute("CREATE INDEX ix_defects_details_gin ON defects USING gin (details)")

    # Unique: block exact duplicates per vehicle within an inspection
    # (or per vehicle for off-inspection rows). COALESCE makes NULL
    # inspection_id and NULL position behave as a single bucket.
    op.execute(
        "CREATE UNIQUE INDEX uq_defects_vehicle_insp_part_pos_type "
        "ON defects (vehicle_id, COALESCE(inspection_id::text, ''), "
        "part, COALESCE(position, ''), defect_type)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_defects_vehicle_insp_part_pos_type")
    op.execute("DROP INDEX IF EXISTS ix_defects_details_gin")
    op.execute("DROP INDEX IF EXISTS ix_defects_inspection_id_partial")
    op.execute("DROP INDEX IF EXISTS ix_defects_vehicle_reported_at")
    op.drop_index("ix_defects_part_defect_type", table_name="defects")
    op.drop_index("ix_defects_reported_at", table_name="defects")
    op.drop_index("ix_defects_reported_by_id", table_name="defects")
    op.drop_index("ix_defects_defect_type", table_name="defects")
    op.drop_index("ix_defects_part", table_name="defects")
    op.drop_index("ix_defects_source", table_name="defects")
    op.drop_index("ix_defects_vehicle_id", table_name="defects")
    op.drop_table("defects")
