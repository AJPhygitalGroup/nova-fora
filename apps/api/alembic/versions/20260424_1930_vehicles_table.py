"""vehicles table — DSP-owned vans

Revision ID: 20260424_1930
Revises: 20260424_1600
Create Date: 2026-04-24 19:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260424_1930"
down_revision: Union[str, None] = "20260424_1600"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "vehicles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("dsp_id", sa.Integer(), nullable=False),
        sa.Column("fleet_id", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=False),
        sa.Column("vin", sqlmodel.sql.sqltypes.AutoString(length=17), nullable=False),
        sa.Column("plate", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("make", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=False),
        sa.Column("model", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column(
            "mileage",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "grounded",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "grounded_reason",
            sqlmodel.sql.sqltypes.AutoString(length=500),
            nullable=True,
        ),
        sa.Column("grounded_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["dsp_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("vin", name="uq_vehicles_vin"),
    )
    op.create_index("ix_vehicles_dsp_id", "vehicles", ["dsp_id"])
    op.create_index("ix_vehicles_fleet_id", "vehicles", ["fleet_id"])
    op.create_index("ix_vehicles_vin", "vehicles", ["vin"])
    op.create_index("ix_vehicles_grounded", "vehicles", ["grounded"])
    op.create_index("ix_vehicles_is_active", "vehicles", ["is_active"])

    # Composite: listing vehicles of a specific DSP by fleet_id is the hot path.
    op.create_index(
        "ix_vehicles_dsp_fleet", "vehicles", ["dsp_id", "fleet_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_vehicles_dsp_fleet", table_name="vehicles")
    op.drop_index("ix_vehicles_is_active", table_name="vehicles")
    op.drop_index("ix_vehicles_grounded", table_name="vehicles")
    op.drop_index("ix_vehicles_vin", table_name="vehicles")
    op.drop_index("ix_vehicles_fleet_id", table_name="vehicles")
    op.drop_index("ix_vehicles_dsp_id", table_name="vehicles")
    op.drop_table("vehicles")
