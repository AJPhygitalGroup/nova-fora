"""body_repair: add body_repair_requests.approved_list_cents

The customer-approved list price at the moment of quote selection.
Frozen so the vendor's mid-repair revisions measure auto-apply
headroom against the *approved* baseline (not the current list, which
prior auto-applies may have already bumped). Mirrors the demo's
salami-guard logic.

NULL until quote_selected_at fires; populated by the select-quote
endpoint.

Revision ID: 20260604_0030
Revises: 20260604_0000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260604_0030"
down_revision = "20260604_0000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "body_repair_requests",
        sa.Column("approved_list_cents", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("body_repair_requests", "approved_list_cents")
