"""DvicTemplateItem — section-first DVIC adapter table

Revision ID: 20260505_2300
Revises: 20260505_1400
Create Date: 2026-05-05 23:00:00.000000

Adds the `dvic_template_item` table that adapts the V2.2 catalog (rule ×
applicability) to the Amazon DVIC PDF layout (section → part_category →
verbatim description). The wizard reads this table to render its 6-tile
section picker; defect creation still uses the underlying defect_rule.

Empty for `electric_vehicle` and `box_truck_dot` until those PDFs land —
seeds for `regular_cargo_van`, `custom_delivery_van`, `step_van_dot` go
in via `python -m app.cli seed-dvic-template`.
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "20260505_2300"
down_revision: Union[str, None] = "20260505_1400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dvic_template_item",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "vehicle_class",
            sqlmodel.sql.sqltypes.AutoString(length=30),
            nullable=False,
        ),
        sa.Column(
            "section",
            sqlmodel.sql.sqltypes.AutoString(length=25),
            nullable=False,
        ),
        sa.Column(
            "part_category",
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=False,
        ),
        sa.Column("rule_id", sa.Integer(), nullable=False),
        sa.Column(
            "position",
            sqlmodel.sql.sqltypes.AutoString(length=30),
            nullable=True,
        ),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=500),
            nullable=False,
        ),
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
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["rule_id"], ["defect_rule.id"], ondelete="CASCADE"
        ),
    )

    # Single-column indexes — match SQLModel `index=True` declarations
    op.create_index(
        "ix_dvic_template_item_vehicle_class",
        "dvic_template_item",
        ["vehicle_class"],
    )
    op.create_index(
        "ix_dvic_template_item_section", "dvic_template_item", ["section"]
    )
    op.create_index(
        "ix_dvic_template_item_rule_id", "dvic_template_item", ["rule_id"]
    )
    op.create_index(
        "ix_dvic_template_item_is_active",
        "dvic_template_item",
        ["is_active"],
    )

    # Composite for the hot path: render template for a given vehicle_class,
    # ordered by section + ordering for stable PDF-shape output.
    op.create_index(
        "ix_dvic_template_class_section_order",
        "dvic_template_item",
        ["vehicle_class", "section", "ordering"],
    )

    # Dedup uniqueness — same rule shouldn't appear twice in the same
    # (class, section, part_category, position) bucket.
    op.execute(
        "CREATE UNIQUE INDEX uq_dvic_template_class_sec_cat_rule_pos "
        "ON dvic_template_item "
        "(vehicle_class, section, part_category, rule_id, COALESCE(position, ''))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_dvic_template_class_sec_cat_rule_pos")
    op.drop_index(
        "ix_dvic_template_class_section_order",
        table_name="dvic_template_item",
    )
    op.drop_index(
        "ix_dvic_template_item_is_active", table_name="dvic_template_item"
    )
    op.drop_index(
        "ix_dvic_template_item_rule_id", table_name="dvic_template_item"
    )
    op.drop_index(
        "ix_dvic_template_item_section", table_name="dvic_template_item"
    )
    op.drop_index(
        "ix_dvic_template_item_vehicle_class",
        table_name="dvic_template_item",
    )
    op.drop_table("dvic_template_item")
