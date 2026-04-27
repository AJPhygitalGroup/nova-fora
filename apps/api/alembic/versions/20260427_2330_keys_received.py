"""inspections.keys_received column

Revision ID: 20260427_2330
Revises: 20260424_2230
Create Date: 2026-04-27 23:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260427_2330"
down_revision: Union[str, None] = "20260424_2230"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "inspections",
        sa.Column("keys_received", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("inspections", "keys_received")
