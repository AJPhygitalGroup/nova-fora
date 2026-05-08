"""vehicles.fmc free-form Fleet Management Company

Revision ID: 20260506_0400
Revises: 20260506_0300
Create Date: 2026-05-06 04:00:00.000000

Adds the FMC column on vehicles. Sourced from Amazon Cortex's
`vehicleProvider` column during bulk upload (Element / LP / Budget /
Penske / Wheels / etc.) and editable in the vehicle form. Nullable
because DSP-owned vans without an FMC relationship leave it empty.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260506_0400"
down_revision: Union[str, None] = "20260506_0300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vehicles",
        sa.Column("fmc", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("vehicles", "fmc")
