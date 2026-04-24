"""inspections + reported_defects tables

Revision ID: 20260424_2000
Revises: 20260424_1930
Create Date: 2026-04-24 20:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260424_2000"
down_revision: Union[str, None] = "20260424_1930"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── inspections ──────────────────────────────────
    op.create_table(
        "inspections",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("vehicle_id", sa.Integer(), nullable=False),
        sa.Column("dsp_id", sa.Integer(), nullable=False),
        sa.Column("inspector_id", sa.Integer(), nullable=True),
        sa.Column(
            "result",
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=False,
            server_default="flagged",
        ),
        sa.Column("odometer_miles", sa.Integer(), nullable=True),
        sa.Column(
            "odometer_source",
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=True,
        ),
        sa.Column("notes", sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=True),
        sa.Column(
            "incomplete_reason",
            sqlmodel.sql.sqltypes.AutoString(length=500),
            nullable=True,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["dsp_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["inspector_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_inspections_vehicle_id", "inspections", ["vehicle_id"])
    op.create_index("ix_inspections_dsp_id", "inspections", ["dsp_id"])
    op.create_index("ix_inspections_inspector_id", "inspections", ["inspector_id"])
    op.create_index("ix_inspections_result", "inspections", ["result"])
    op.create_index("ix_inspections_odometer_miles", "inspections", ["odometer_miles"])
    op.create_index("ix_inspections_submitted_at", "inspections", ["submitted_at"])
    # Hot path: DSP dashboard "inspections today for DSP X"
    op.create_index(
        "ix_inspections_dsp_submitted", "inspections", ["dsp_id", "submitted_at"]
    )

    # ── reported_defects ─────────────────────────────
    op.create_table(
        "reported_defects",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("inspection_id", sa.Integer(), nullable=False),
        sa.Column(
            "section", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False
        ),
        sa.Column("part", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column(
            "description", sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=False
        ),
        sa.Column(
            "category", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True
        ),
        sa.Column(
            "severity", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False
        ),
        sa.Column(
            "status",
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "photo_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
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
        sa.ForeignKeyConstraint(["inspection_id"], ["inspections.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_reported_defects_inspection_id", "reported_defects", ["inspection_id"]
    )
    op.create_index("ix_reported_defects_severity", "reported_defects", ["severity"])
    op.create_index("ix_reported_defects_status", "reported_defects", ["status"])
    op.create_index("ix_reported_defects_section", "reported_defects", ["section"])


def downgrade() -> None:
    op.drop_index("ix_reported_defects_section", table_name="reported_defects")
    op.drop_index("ix_reported_defects_status", table_name="reported_defects")
    op.drop_index("ix_reported_defects_severity", table_name="reported_defects")
    op.drop_index("ix_reported_defects_inspection_id", table_name="reported_defects")
    op.drop_table("reported_defects")

    op.drop_index("ix_inspections_dsp_submitted", table_name="inspections")
    op.drop_index("ix_inspections_submitted_at", table_name="inspections")
    op.drop_index("ix_inspections_odometer_miles", table_name="inspections")
    op.drop_index("ix_inspections_result", table_name="inspections")
    op.drop_index("ix_inspections_inspector_id", table_name="inspections")
    op.drop_index("ix_inspections_dsp_id", table_name="inspections")
    op.drop_index("ix_inspections_vehicle_id", table_name="inspections")
    op.drop_table("inspections")
