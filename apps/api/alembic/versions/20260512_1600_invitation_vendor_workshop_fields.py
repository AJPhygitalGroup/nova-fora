"""invitations: vendor_repair_types + vendor_status_tracking_mode

Revision ID: 20260512_1600
Revises: 20260511_1900
Create Date: 2026-05-12 16:00:00.000000

Lets a site_admin invitation create the VendorWorkshop atomically with
the Org at accept time, instead of forcing a two-step (invite vendor →
create workshop separately). Both columns are NULL except on new-org
vendor invitations.

  vendor_repair_types        text[]    NULL  — array of RepairType.value
                                                strings the new workshop
                                                will handle (validated
                                                application-side; no DB
                                                CHECK so RepairType can
                                                evolve via code-only).
  vendor_status_tracking_mode varchar(20) NULL — 'external' or 'internal'
                                                  (defaults to 'external'
                                                  app-side).

Reverts cleanly; pre-existing invitations are unaffected (NULL means
"don't create a workshop on accept", which is the old behavior).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision: str = "20260512_1600"
down_revision: Union[str, None] = "20260511_1900"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "invitations",
        sa.Column(
            "vendor_repair_types",
            ARRAY(sa.String(length=20)),
            nullable=True,
            comment="On vendor new-org invites only: repair_types[] the auto-created "
                    "VendorWorkshop will be seeded with. NULL = don't create a workshop.",
        ),
    )
    op.add_column(
        "invitations",
        sa.Column(
            "vendor_status_tracking_mode",
            sa.String(length=20),
            nullable=True,
            comment="On vendor new-org invites only: 'external' (default) | 'internal'. "
                    "Drives the RO# requirement at WO acceptance.",
        ),
    )


def downgrade() -> None:
    op.drop_column("invitations", "vendor_status_tracking_mode")
    op.drop_column("invitations", "vendor_repair_types")
