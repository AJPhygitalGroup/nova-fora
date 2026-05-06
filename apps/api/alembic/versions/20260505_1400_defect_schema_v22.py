"""Defect schema V2.2 — junction split + vehicle_class taxonomy

Revision ID: 20260505_1400
Revises: 20260428_1500
Create Date: 2026-05-05 14:00:00.000000

Implements the V2.2 Defect Data Schema (`docs/defect-schema-v2.2-spec.md`).
Per user decision (2026-05-05): NO data migration — start fresh on the new
schema after wizard bug fixes land.

What this migration does:
  1. Truncates operational data (vehicles, inspections, defects, photos,
     work_orders, work_order_items). Keeps users + organizations so
     auth/login still works after the migration.
  2. Drops legacy FKs from photos.defect_id and work_order_items.defect_id
     (they pointed at reported_defects.id).
  3. Drops legacy tables: reported_defects, dvic_template_item,
     defect_details_schema, defect_part_validity.
  4. Replaces vehicles.asset_type with vehicles.vehicle_class.
  5. Re-creates photos.defect_id / work_order_items.defect_id FKs pointing
     at defects.id.
  6. Creates V2.2 catalog tables: defect_rule, defect_applicability,
     part_group_default.

Legacy data is unrecoverable after this migration — that's intentional per
the user's "borremos todo y empecemos de nuevo" decision.
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260505_1400"
down_revision: Union[str, None] = "20260428_1500"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ─────────────────────────────────────────────────────
    # 1. Truncate operational data (preserves users + organizations)
    # ─────────────────────────────────────────────────────
    op.execute(
        "TRUNCATE TABLE "
        "work_order_items, work_orders, photos, defects, reported_defects, "
        "inspections, vehicles "
        "RESTART IDENTITY CASCADE"
    )

    # ─────────────────────────────────────────────────────
    # 2. Drop legacy FKs pointing at reported_defects
    # ─────────────────────────────────────────────────────
    # SQLModel auto-generated names follow `<table>_<col>_fkey` in Postgres.
    op.drop_constraint(
        "photos_defect_id_fkey", "photos", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_work_order_items_defect_id", "work_order_items", type_="foreignkey"
    )

    # ─────────────────────────────────────────────────────
    # 3. Drop legacy tables
    # ─────────────────────────────────────────────────────
    # reported_defects has child FKs from defect_severity_override (already
    # dropped in 20260428_1400) and is referenced by no other live table now.
    op.drop_table("reported_defects")
    op.drop_table("dvic_template_item")
    op.drop_table("defect_details_schema")
    op.drop_table("defect_part_validity")

    # ─────────────────────────────────────────────────────
    # 4. Replace vehicles.asset_type with vehicles.vehicle_class
    # ─────────────────────────────────────────────────────
    op.drop_index("ix_vehicles_asset_type", table_name="vehicles")
    op.drop_column("vehicles", "asset_type")
    op.add_column(
        "vehicles",
        sa.Column(
            "vehicle_class",
            sqlmodel.sql.sqltypes.AutoString(length=30),
            nullable=False,
            server_default="regular_cargo_van",
        ),
    )
    op.create_index(
        "ix_vehicles_vehicle_class", "vehicles", ["vehicle_class"]
    )

    # ─────────────────────────────────────────────────────
    # 5. Re-create FKs pointing at defects.id
    # ─────────────────────────────────────────────────────
    op.create_foreign_key(
        "photos_defect_id_fkey",
        "photos", "defects",
        ["defect_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_work_order_items_defect_id",
        "work_order_items", "defects",
        ["defect_id"], ["id"],
    )

    # ─────────────────────────────────────────────────────
    # 6. Create V2.2 catalog tables
    # ─────────────────────────────────────────────────────

    # ── part_group_default ──
    op.create_table(
        "part_group_default",
        sa.Column("part", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column("group", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column("rationale", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("part"),
    )

    # ── defect_rule ──
    op.create_table(
        "defect_rule",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("part", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column("defect_type", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column("group", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column(
            "notes_default",
            sqlmodel.sql.sqltypes.AutoString(length=2000),
            nullable=True,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
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
        sa.UniqueConstraint("part", "defect_type", name="defect_rule_part_type_uq"),
    )
    op.create_index("ix_defect_rule_part", "defect_rule", ["part"])
    op.create_index("ix_defect_rule_defect_type", "defect_rule", ["defect_type"])
    op.create_index("ix_defect_rule_group", "defect_rule", ["group"])
    op.create_index("ix_defect_rule_is_active", "defect_rule", ["is_active"])

    # ── defect_applicability ──
    op.create_table(
        "defect_applicability",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("rule_id", sa.Integer(), nullable=False),
        sa.Column(
            "vehicle_class",
            sqlmodel.sql.sqltypes.AutoString(length=30),
            nullable=False,
        ),
        sa.Column(
            "valid_positions",
            postgresql.ARRAY(sa.String(length=30)),
            nullable=False,
            server_default="{}",
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
        sa.Column(
            "threshold",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "classification",
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=True,
        ),
        sa.Column(
            "details_schema",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "notes",
            sqlmodel.sql.sqltypes.AutoString(length=2000),
            nullable=True,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "needs_review",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
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
        sa.ForeignKeyConstraint(
            ["rule_id"], ["defect_rule.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "rule_id", "vehicle_class", name="defect_applicability_rule_class_uq"
        ),
    )
    op.create_index(
        "ix_defect_applicability_rule_id", "defect_applicability", ["rule_id"]
    )
    op.create_index(
        "ix_defect_applicability_vehicle_class",
        "defect_applicability",
        ["vehicle_class"],
    )
    op.create_index(
        "ix_defect_applicability_is_active",
        "defect_applicability",
        ["is_active"],
    )
    op.create_index(
        "ix_defect_applicability_needs_review",
        "defect_applicability",
        ["needs_review"],
    )


def downgrade() -> None:
    """Best-effort downgrade — does NOT restore truncated data.

    Recreates legacy tables empty and reverses schema changes. Most
    practical use is "back out and apply a corrected V2.2 migration";
    not "return to V1 production state".
    """
    # ─────────────────────────────────────────────────────
    # 1. Drop V2.2 catalog tables
    # ─────────────────────────────────────────────────────
    op.drop_index(
        "ix_defect_applicability_needs_review",
        table_name="defect_applicability",
    )
    op.drop_index(
        "ix_defect_applicability_is_active",
        table_name="defect_applicability",
    )
    op.drop_index(
        "ix_defect_applicability_vehicle_class",
        table_name="defect_applicability",
    )
    op.drop_index(
        "ix_defect_applicability_rule_id",
        table_name="defect_applicability",
    )
    op.drop_table("defect_applicability")

    op.drop_index("ix_defect_rule_is_active", table_name="defect_rule")
    op.drop_index("ix_defect_rule_group", table_name="defect_rule")
    op.drop_index("ix_defect_rule_defect_type", table_name="defect_rule")
    op.drop_index("ix_defect_rule_part", table_name="defect_rule")
    op.drop_table("defect_rule")

    op.drop_table("part_group_default")

    # ─────────────────────────────────────────────────────
    # 2. Drop FKs to defects.id (they're being repointed)
    # ─────────────────────────────────────────────────────
    op.drop_constraint(
        "fk_work_order_items_defect_id", "work_order_items", type_="foreignkey"
    )
    op.drop_constraint(
        "photos_defect_id_fkey", "photos", type_="foreignkey"
    )

    # ─────────────────────────────────────────────────────
    # 3. Reverse vehicles.vehicle_class → asset_type
    # ─────────────────────────────────────────────────────
    op.drop_index("ix_vehicles_vehicle_class", table_name="vehicles")
    op.drop_column("vehicles", "vehicle_class")
    op.add_column(
        "vehicles",
        sa.Column(
            "asset_type",
            sqlmodel.sql.sqltypes.AutoString(length=30),
            nullable=False,
            server_default="extra_large_cargo_van",
        ),
    )
    op.create_index("ix_vehicles_asset_type", "vehicles", ["asset_type"])

    # ─────────────────────────────────────────────────────
    # 4. Recreate legacy tables (empty)
    # ─────────────────────────────────────────────────────
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

    op.create_table(
        "defect_details_schema",
        sa.Column("part", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column("defect_type", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column("json_schema", sa.JSON(), nullable=False, server_default="{}"),
        sa.PrimaryKeyConstraint("part", "defect_type"),
    )
    op.create_index(
        "ix_defect_details_schema_part", "defect_details_schema", ["part"]
    )

    # dvic_template_item — minimal recreate (lots of columns originally)
    op.create_table(
        "dvic_template_item",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "asset_types_csv",
            sqlmodel.sql.sqltypes.AutoString(length=300),
            nullable=False,
        ),
        sa.Column(
            "section",
            sqlmodel.sql.sqltypes.AutoString(length=25),
            nullable=False,
        ),
        sa.Column(
            "part_category",
            sqlmodel.sql.sqltypes.AutoString(length=60),
            nullable=False,
        ),
        sa.Column(
            "part_enum",
            sqlmodel.sql.sqltypes.AutoString(length=40),
            nullable=False,
        ),
        sa.Column(
            "defect_type_enum",
            sqlmodel.sql.sqltypes.AutoString(length=40),
            nullable=False,
        ),
        sa.Column(
            "position",
            sqlmodel.sql.sqltypes.AutoString(length=30),
            nullable=True,
        ),
        sa.Column(
            "position_options_csv",
            sqlmodel.sql.sqltypes.AutoString(length=200),
            nullable=False,
            server_default="",
        ),
        sa.Column("sub_positions", sa.JSON(), nullable=True),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=500),
            nullable=False,
        ),
        sa.Column("details_schema", sa.JSON(), nullable=True),
        sa.Column(
            "ordering", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # reported_defects — minimal recreate
    op.create_table(
        "reported_defects",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("inspection_id", sa.Integer(), nullable=False),
        sa.Column(
            "section",
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=False,
        ),
        sa.Column(
            "part",
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=False,
        ),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=2000),
            nullable=False,
        ),
        sa.Column(
            "category",
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=True,
        ),
        sa.Column(
            "status",
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "photo_count", sa.Integer(), nullable=False, server_default=sa.text("0")
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
    )

    # ─────────────────────────────────────────────────────
    # 5. Re-create legacy FKs pointing at reported_defects
    # ─────────────────────────────────────────────────────
    op.create_foreign_key(
        "photos_defect_id_fkey",
        "photos", "reported_defects",
        ["defect_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_work_order_items_defect_id",
        "work_order_items", "reported_defects",
        ["defect_id"], ["id"],
    )
