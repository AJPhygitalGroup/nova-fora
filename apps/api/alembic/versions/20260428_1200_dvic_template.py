"""dvic_template_item table + vehicles.asset_type column

Revision ID: 20260428_1200
Revises: 20260428_0010
Create Date: 2026-04-28 12:00:00.000000

Phase 1 of DVIC template restructure (matches Amazon DVIC PDF spec).

Adds:
  - vehicles.asset_type            enum {extra_large_cargo_van, large_cargo_van,
                                         step_van_medium, step_van_large}
                                   defaults to extra_large_cargo_van so existing
                                   rows backfill cleanly.
  - dvic_template_item             new reference table — 1 row per PDF check line
                                   tagged with asset_types[] for filtering.

Doesn't modify existing data — fully additive.
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "20260428_1200"
down_revision: Union[str, None] = "20260428_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── vehicles.asset_type ──
    op.add_column(
        "vehicles",
        sa.Column(
            "asset_type",
            sa.String(length=30),
            nullable=False,
            server_default="extra_large_cargo_van",
        ),
    )
    op.create_index("ix_vehicles_asset_type", "vehicles", ["asset_type"])

    # ── dvic_template_item ──
    op.create_table(
        "dvic_template_item",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "asset_types_csv",
            sqlmodel.sql.sqltypes.AutoString(length=300),
            nullable=False,
        ),
        sa.Column("section", sa.String(length=25), nullable=False),
        sa.Column(
            "part_category",
            sqlmodel.sql.sqltypes.AutoString(length=60),
            nullable=False,
        ),
        sa.Column("part_enum", sa.String(length=40), nullable=False),
        sa.Column("defect_type_enum", sa.String(length=40), nullable=False),
        sa.Column("position", sa.String(length=30), nullable=True),
        sa.Column(
            "position_options_csv",
            sqlmodel.sql.sqltypes.AutoString(length=200),
            nullable=False,
            server_default="",
        ),
        sa.Column("sub_positions", sa.JSON(), nullable=True),
        sa.Column(
            "default_severity",
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=False,
            server_default="medium",
        ),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=500),
            nullable=False,
        ),
        sa.Column("details_schema", sa.JSON(), nullable=True),
        sa.Column("ordering", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_dvic_template_item_asset_types_csv",
        "dvic_template_item",
        ["asset_types_csv"],
    )
    op.create_index(
        "ix_dvic_template_item_section", "dvic_template_item", ["section"]
    )
    op.create_index(
        "ix_dvic_template_item_part_enum", "dvic_template_item", ["part_enum"]
    )
    op.create_index(
        "ix_dvic_template_item_is_active", "dvic_template_item", ["is_active"]
    )


def downgrade() -> None:
    op.drop_index("ix_dvic_template_item_is_active", table_name="dvic_template_item")
    op.drop_index("ix_dvic_template_item_part_enum", table_name="dvic_template_item")
    op.drop_index("ix_dvic_template_item_section", table_name="dvic_template_item")
    op.drop_index(
        "ix_dvic_template_item_asset_types_csv", table_name="dvic_template_item"
    )
    op.drop_table("dvic_template_item")

    op.drop_index("ix_vehicles_asset_type", table_name="vehicles")
    op.drop_column("vehicles", "asset_type")
