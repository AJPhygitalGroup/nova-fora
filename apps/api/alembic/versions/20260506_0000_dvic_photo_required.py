"""dvic_template_item.photo_required column

Revision ID: 20260506_0000
Revises: 20260505_2300
Create Date: 2026-05-06 00:00:00.000000

Per-template-item flag controlling whether the wizard's photo gate is
mandatory. Sensory/audio defects (odor, brake noise, no AC, etc.) skip
the gate; visual/structural defects keep it.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260506_0000"
down_revision: Union[str, None] = "20260505_2300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "dvic_template_item",
        sa.Column(
            "photo_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("dvic_template_item", "photo_required")
