"""body_repair: Phase 0 — requests table + body_repair_vendor org type

Jorge 2026-06-03: port the body repair flow from
web-mbk-body-repair-demo. Phase 0 scope:

  - New OrgType value 'body_repair_vendor' (no schema change — varchar
    column already allows it; the model enum + id_str prefix shipped
    alongside this migration cover the code side).
  - body_repair_requests table — 16-state lifecycle (10 happy + 3
    exception, with forward-compat columns for quote / pickup /
    repair / completion / payment stages that later phases will write
    to). Phase 0 endpoints only write text_description.

Subsequent migrations will add:
  - body_repair_quotes (Phase 2)
  - body_repair_pave_reports (Phase 1) + extract storage rows
  - body_repair_messages (Phase 5)
  - body_repair_activity (Phase 5)

Revision ID: 20260603_2100
Revises: 20260603_1200
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260603_2100"
down_revision = "20260603_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "body_repair_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        # tenancy
        sa.Column(
            "dsp_id", sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "vehicle_id", sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "assigned_vendor_id", sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # submission payload
        sa.Column("submission_mode", sa.String(length=10), nullable=False),
        sa.Column("text_description", sa.Text(), nullable=True),
        sa.Column("target_grade", sa.String(length=20), nullable=True),
        sa.Column("picked_components_json", sa.JSON(), nullable=True),
        # lifecycle
        sa.Column(
            "status", sa.String(length=30), nullable=False,
            server_default="pending_quotes",
        ),
        # quote
        sa.Column("selected_quote_id", sa.Integer(), nullable=True),
        sa.Column("quote_selected_at", sa.DateTime(timezone=True), nullable=True),
        # pickup
        sa.Column("pickup_proposed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pickup_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pickup_window", sa.String(length=60), nullable=True),
        sa.Column("pickup_proposed_date", sa.DateTime(timezone=True), nullable=True),
        # repair + completion
        sa.Column("picked_up_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("repair_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("repair_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        # payment
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_amount_cents", sa.Integer(), nullable=True),
        # audit
        sa.Column(
            "created_by_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cancelled_reason", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    # Indexes for the most common queries.
    op.create_index(
        "ix_body_repair_requests_dsp_id",
        "body_repair_requests", ["dsp_id"], unique=False,
    )
    op.create_index(
        "ix_body_repair_requests_vehicle_id",
        "body_repair_requests", ["vehicle_id"], unique=False,
    )
    op.create_index(
        "ix_body_repair_requests_assigned_vendor_id",
        "body_repair_requests", ["assigned_vendor_id"], unique=False,
    )
    op.create_index(
        "ix_body_repair_requests_status",
        "body_repair_requests", ["status"], unique=False,
    )
    op.create_index(
        "ix_body_repair_requests_selected_quote_id",
        "body_repair_requests", ["selected_quote_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_body_repair_requests_selected_quote_id", table_name="body_repair_requests")
    op.drop_index("ix_body_repair_requests_status", table_name="body_repair_requests")
    op.drop_index("ix_body_repair_requests_assigned_vendor_id", table_name="body_repair_requests")
    op.drop_index("ix_body_repair_requests_vehicle_id", table_name="body_repair_requests")
    op.drop_index("ix_body_repair_requests_dsp_id", table_name="body_repair_requests")
    op.drop_table("body_repair_requests")
