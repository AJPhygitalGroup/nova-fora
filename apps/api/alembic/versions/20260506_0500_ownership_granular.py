"""ownership: granular Cortex values (amazon_owned / amazon_leased / dsp_owned / rental)

Revision ID: 20260506_0500
Revises: 20260506_0400
Create Date: 2026-05-06 05:00:00.000000

Replaces the simplified 3-value ownership enum (branded / owner / rented)
with the 4 granular values Amazon's Cortex portal uses
(AMAZON_OWNED / AMAZON_LEASED / DSP_OWNED / RENTAL). The wizard's
branded-only filter now treats amazon_owned + amazon_leased as branded.

Existing data is migrated:
  branded → amazon_owned   (defensible default; amazon_leased is the other
                            valid interpretation but we don't have the
                            FMC info to tell them apart)
  owner   → dsp_owned
  rented  → rental
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260506_0500"
down_revision: Union[str, None] = "20260506_0400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Translate existing rows
    op.execute(
        "UPDATE vehicles SET ownership = 'amazon_owned' WHERE ownership = 'branded'"
    )
    op.execute(
        "UPDATE vehicles SET ownership = 'dsp_owned'    WHERE ownership = 'owner'"
    )
    op.execute(
        "UPDATE vehicles SET ownership = 'rental'       WHERE ownership = 'rented'"
    )
    # New default for new rows
    op.alter_column(
        "vehicles", "ownership",
        server_default=sa.text("'amazon_owned'"),
    )


def downgrade() -> None:
    op.execute(
        "UPDATE vehicles SET ownership = 'rented'  WHERE ownership = 'rental'"
    )
    op.execute(
        "UPDATE vehicles SET ownership = 'owner'   WHERE ownership = 'dsp_owned'"
    )
    op.execute(
        "UPDATE vehicles SET ownership = 'branded' WHERE ownership IN ('amazon_owned', 'amazon_leased')"
    )
    op.alter_column(
        "vehicles", "ownership",
        server_default=sa.text("'branded'"),
    )
