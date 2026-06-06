"""body_repair: add body_repair_requests.pickup_blob

JSON column holding pickup logistics the customer provides at
confirm-pickup time (van_location, key_location, contact_name,
contact_phone, access_notes) plus duration_days the vendor proposes.

A single blob is enough at this stage of the port — the demo's
dedicated BodyRepairPickup table covers Phase 4 features
(counter-propose, reschedule, reminder ladder) we haven't ported yet.

Revision ID: 20260606_0200
Revises: 20260604_0030
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260606_0200"
down_revision = "20260604_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "body_repair_requests",
        sa.Column("pickup_blob", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("body_repair_requests", "pickup_blob")
