"""vehicles.location column

Revision ID: 20260512_2000
Revises: 20260512_1600
Create Date: 2026-05-12 20:00:00.000000

Persist per-vehicle location so a DSP can flip a van between
`parking_lot` and `offsite` and have the change stick across reloads.
The vendor side sets `checked_out` when a WO pulls the van for overnight
repair (transitions back to `parking_lot` on WO completion).

Stored as VARCHAR with a CHECK constraint per CLAUDE.md rule #2.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260512_2000"
down_revision: Union[str, None] = "20260512_1600"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vehicles",
        sa.Column(
            "location",
            sa.String(length=20),
            nullable=False,
            server_default="parking_lot",
            comment="Current physical location of the van. "
                    "parking_lot | offsite | checked_out.",
        ),
    )
    op.create_index(
        "ix_vehicles_location", "vehicles", ["location"], unique=False,
    )
    op.create_check_constraint(
        "ck_vehicles_location",
        "vehicles",
        "location IN ('parking_lot', 'offsite', 'checked_out')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_vehicles_location", "vehicles", type_="check")
    op.drop_index("ix_vehicles_location", table_name="vehicles")
    op.drop_column("vehicles", "location")
