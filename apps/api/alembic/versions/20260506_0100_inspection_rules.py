"""inspection_rule + inspection_rule_target tables (V2.2 §5.5)

Revision ID: 20260506_0100
Revises: 20260506_0000
Create Date: 2026-05-06 01:00:00.000000

Adds the source-rule layer from V2.2 spec §5.5:
  - inspection_rule       — verbatim PDF/DSP text + regulatory metadata
                            (RSI, VSA, line, notion_id, vehicle_class[])
  - inspection_rule_target — bridge to (part, defect_type) tuples; one
                            source rule can map to many catalog tuples
                            ("Headlight is dim, blinking, or not working"
                             → 3 targets).

Both tables use VARCHAR enums (CLAUDE.md rule #2) and NF's snake_case
table-name convention (singular). `vehicle_class` and `parts` are stored
as ARRAY(VARCHAR) for cardinality ≤ 5 and to avoid join-table overhead.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision: str = "20260506_0100"
down_revision: Union[str, None] = "20260506_0000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "inspection_rule",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("defect_text", sa.String(length=2000), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("section", sa.String(length=25), nullable=True),
        sa.Column(
            "parts",
            ARRAY(sa.String(length=40)),
            nullable=False,
            server_default=sa.text("'{}'::varchar[]"),
        ),
        sa.Column("classification", sa.String(length=20), nullable=True),
        sa.Column("group", sa.String(length=20), nullable=True),
        sa.Column("line", sa.String(length=20), nullable=True),
        sa.Column("rsi", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("vsa", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("notion_id", sa.String(length=100), nullable=True),
        sa.Column(
            "vehicle_class",
            ARRAY(sa.String(length=30)),
            nullable=False,
            server_default=sa.text("'{}'::varchar[]"),
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
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
        sa.UniqueConstraint("notion_id", name="inspection_rule_notion_id_uq"),
    )
    op.create_index(
        "ix_inspection_rule_source", "inspection_rule", ["source"]
    )
    op.create_index(
        "ix_inspection_rule_section", "inspection_rule", ["section"]
    )
    op.create_index(
        "ix_inspection_rule_is_active", "inspection_rule", ["is_active"]
    )
    # GIN index on vehicle_class[] so vehicle_class containment lookups stay fast
    op.create_index(
        "ix_inspection_rule_vehicle_class_gin",
        "inspection_rule",
        ["vehicle_class"],
        postgresql_using="gin",
    )

    op.create_table(
        "inspection_rule_target",
        sa.Column(
            "rule_id",
            sa.Integer(),
            sa.ForeignKey("inspection_rule.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("part", sa.String(length=40), primary_key=True),
        sa.Column("defect_type", sa.String(length=40), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_inspection_rule_target_part_defect",
        "inspection_rule_target",
        ["part", "defect_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_inspection_rule_target_part_defect", "inspection_rule_target")
    op.drop_table("inspection_rule_target")
    op.drop_index("ix_inspection_rule_vehicle_class_gin", "inspection_rule")
    op.drop_index("ix_inspection_rule_is_active", "inspection_rule")
    op.drop_index("ix_inspection_rule_section", "inspection_rule")
    op.drop_index("ix_inspection_rule_source", "inspection_rule")
    op.drop_table("inspection_rule")
