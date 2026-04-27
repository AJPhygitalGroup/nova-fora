"""defect catalog v2 — additive columns + reference tables

Revision ID: 20260427_2350
Revises: 20260427_2330
Create Date: 2026-04-27 23:50:00.000000

Implements the v2 Defect Data Schema (Notion spec). All changes are
additive — legacy columns stay populated. Backfill happens in a separate
script (cli command) so this migration runs fast and is idempotent.
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "20260427_2350"
down_revision: Union[str, None] = "20260427_2330"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── reported_defects: new v2 columns (all nullable) ──
    op.add_column(
        "reported_defects",
        sa.Column("part_enum", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=True),
    )
    op.add_column(
        "reported_defects",
        sa.Column("position", sqlmodel.sql.sqltypes.AutoString(length=30), nullable=True),
    )
    op.add_column(
        "reported_defects",
        sa.Column("defect_type_enum", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=True),
    )
    op.add_column(
        "reported_defects",
        sa.Column("details", sa.JSON(), nullable=True),
    )
    op.add_column(
        "reported_defects",
        sa.Column("notes", sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=True),
    )
    op.add_column(
        "reported_defects",
        sa.Column("reported_by_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "reported_defects",
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_reported_defects_reported_by_id",
        "reported_defects", "users",
        ["reported_by_id"], ["id"],
    )
    op.create_index("ix_reported_defects_part_enum", "reported_defects", ["part_enum"])
    op.create_index("ix_reported_defects_defect_type_enum", "reported_defects", ["defect_type_enum"])
    op.create_index("ix_reported_defects_reported_by_id", "reported_defects", ["reported_by_id"])

    # ── defect_part_system (composite PK) ──
    op.create_table(
        "defect_part_system",
        sa.Column("part", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column("system", sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("display_group", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.PrimaryKeyConstraint("part", "system"),
    )
    op.create_index("ix_defect_part_system_part", "defect_part_system", ["part"])
    op.create_index("ix_defect_part_system_system", "defect_part_system", ["system"])
    # Unique partial index: every part has exactly one is_primary=true row
    op.execute(
        "CREATE UNIQUE INDEX ix_defect_part_system_one_primary "
        "ON defect_part_system (part) WHERE is_primary"
    )

    # ── defect_part_validity (PK on part) ──
    op.create_table(
        "defect_part_validity",
        sa.Column("part", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column(
            "valid_positions_csv",
            sqlmodel.sql.sqltypes.AutoString(length=300),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "position_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "allow_null_position",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.PrimaryKeyConstraint("part"),
    )

    # ── defect_details_schema (composite PK) ──
    op.create_table(
        "defect_details_schema",
        sa.Column("part", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column("defect_type", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column("json_schema", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column(
            "default_severity",
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=False,
            server_default="medium",
        ),
        sa.PrimaryKeyConstraint("part", "defect_type"),
    )
    op.create_index("ix_defect_details_schema_part", "defect_details_schema", ["part"])

    # ── defect_severity_override (per-row override of derived severity) ──
    op.create_table(
        "defect_severity_override",
        sa.Column("defect_id", sa.Integer(), nullable=False),
        sa.Column("severity", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column("reason", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column("set_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["defect_id"], ["reported_defects.id"]),
        sa.ForeignKeyConstraint(["set_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("defect_id"),
    )


def downgrade() -> None:
    op.drop_table("defect_severity_override")
    op.drop_index("ix_defect_details_schema_part", table_name="defect_details_schema")
    op.drop_table("defect_details_schema")
    op.drop_table("defect_part_validity")
    op.execute("DROP INDEX IF EXISTS ix_defect_part_system_one_primary")
    op.drop_index("ix_defect_part_system_system", table_name="defect_part_system")
    op.drop_index("ix_defect_part_system_part", table_name="defect_part_system")
    op.drop_table("defect_part_system")

    op.drop_index("ix_reported_defects_reported_by_id", table_name="reported_defects")
    op.drop_index("ix_reported_defects_defect_type_enum", table_name="reported_defects")
    op.drop_index("ix_reported_defects_part_enum", table_name="reported_defects")
    op.drop_constraint("fk_reported_defects_reported_by_id", "reported_defects", type_="foreignkey")
    op.drop_column("reported_defects", "reported_at")
    op.drop_column("reported_defects", "reported_by_id")
    op.drop_column("reported_defects", "notes")
    op.drop_column("reported_defects", "details")
    op.drop_column("reported_defects", "defect_type_enum")
    op.drop_column("reported_defects", "position")
    op.drop_column("reported_defects", "part_enum")
