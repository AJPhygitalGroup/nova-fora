"""vehicle.ownership + dvic_template_item.requires_branding

Revision ID: 20260506_0200
Revises: 20260506_0100
Create Date: 2026-05-06 02:00:00.000000

Adds two related fields:
  - vehicles.ownership                   (branded | owner | rented)
  - dvic_template_item.requires_branding (filters DOT decal / Prime decal
                                          items for non-Branded vans)

Both default to the safe baseline ("branded" / False) so existing rows
behave identically until callers opt in.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260506_0200"
down_revision: Union[str, None] = "20260506_0100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vehicles",
        sa.Column(
            "ownership",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'branded'"),
        ),
    )
    op.create_index("ix_vehicles_ownership", "vehicles", ["ownership"])

    op.add_column(
        "dvic_template_item",
        sa.Column(
            "requires_branding",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("dvic_template_item", "requires_branding")
    op.drop_index("ix_vehicles_ownership", "vehicles")
    op.drop_column("vehicles", "ownership")
