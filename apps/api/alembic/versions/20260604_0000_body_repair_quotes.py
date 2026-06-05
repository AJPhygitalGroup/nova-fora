"""body_repair: Phase 2 — quotes + line items + revisions

Port of NOVABODY/core@mbk/body-repair-demo's migration
f5a6b7c8d9e0_body_repair_quotes.py + a6b7c8d9e0f1_body_repair_revision_pricing.py
collapsed into one (the revision-pricing extra columns ship from day
one since the table doesn't exist on this side yet — no incremental
forklift needed).

4 tables:
  body_repair_quotes            — vendor bid
  body_repair_quote_line_items  — vendor scope lines
  body_repair_quote_revisions   — mid-repair scope change record
  body_repair_quote_revision_line_items — new scope lines on a revision

All FKs CASCADE on quote/revision deletion; vendor_org_id RESTRICTs
(never delete an org with outstanding bids).

Revision ID: 20260604_0000
Revises: 20260603_2200
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260604_0000"
down_revision = "20260603_2200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── body_repair_quotes ─────────────────────────────────
    op.create_table(
        "body_repair_quotes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "body_repair_request_id", sa.Integer(),
            sa.ForeignKey("body_repair_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "vendor_org_id", sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=15), nullable=False, server_default="active"),
        sa.Column("vendor_raw_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("base_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("list_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tier_1_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tier_2_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("commission_pct", sa.Numeric(5, 2), nullable=True),
        sa.Column("duration_days", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("renewed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_body_repair_quotes_request_id", "body_repair_quotes", ["body_repair_request_id"], unique=False)
    op.create_index("ix_body_repair_quotes_vendor_org_id", "body_repair_quotes", ["vendor_org_id"], unique=False)
    op.create_index("ix_body_repair_quotes_status", "body_repair_quotes", ["status"], unique=False)
    op.create_index("ix_body_repair_quotes_valid_until", "body_repair_quotes", ["valid_until"], unique=False)

    # ── body_repair_quote_line_items ───────────────────────
    op.create_table(
        "body_repair_quote_line_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "quote_id", sa.Integer(),
            sa.ForeignKey("body_repair_quotes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("parts_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("labor_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_body_repair_quote_line_items_quote_id", "body_repair_quote_line_items", ["quote_id"], unique=False)

    # ── body_repair_quote_revisions ────────────────────────
    op.create_table(
        "body_repair_quote_revisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "quote_id", sa.Integer(),
            sa.ForeignKey("body_repair_quotes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=15), nullable=False, server_default="proposed"),
        sa.Column("old_list_cents", sa.Integer(), nullable=True),
        sa.Column("new_list_cents", sa.Integer(), nullable=True),
        sa.Column("baseline_cents", sa.Integer(), nullable=True),
        sa.Column("delta_cents", sa.Integer(), nullable=True),
        sa.Column("auto_applied", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("new_vendor_raw_cents", sa.Integer(), nullable=True),
        sa.Column("new_base_cents", sa.Integer(), nullable=True),
        sa.Column("new_tier_1_cents", sa.Integer(), nullable=True),
        sa.Column("new_tier_2_cents", sa.Integer(), nullable=True),
        sa.Column("new_duration_days", sa.Integer(), nullable=True),
        sa.Column("old_duration_days", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_body_repair_quote_revisions_quote_id", "body_repair_quote_revisions", ["quote_id"], unique=False)
    op.create_index("ix_body_repair_quote_revisions_status", "body_repair_quote_revisions", ["status"], unique=False)

    # ── body_repair_quote_revision_line_items ──────────────
    op.create_table(
        "body_repair_quote_revision_line_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "revision_id", sa.Integer(),
            sa.ForeignKey("body_repair_quote_revisions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("parts_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("labor_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_body_repair_quote_revision_line_items_revision_id", "body_repair_quote_revision_line_items", ["revision_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_body_repair_quote_revision_line_items_revision_id", table_name="body_repair_quote_revision_line_items")
    op.drop_table("body_repair_quote_revision_line_items")
    op.drop_index("ix_body_repair_quote_revisions_status", table_name="body_repair_quote_revisions")
    op.drop_index("ix_body_repair_quote_revisions_quote_id", table_name="body_repair_quote_revisions")
    op.drop_table("body_repair_quote_revisions")
    op.drop_index("ix_body_repair_quote_line_items_quote_id", table_name="body_repair_quote_line_items")
    op.drop_table("body_repair_quote_line_items")
    op.drop_index("ix_body_repair_quotes_valid_until", table_name="body_repair_quotes")
    op.drop_index("ix_body_repair_quotes_status", table_name="body_repair_quotes")
    op.drop_index("ix_body_repair_quotes_vendor_org_id", table_name="body_repair_quotes")
    op.drop_index("ix_body_repair_quotes_request_id", table_name="body_repair_quotes")
    op.drop_table("body_repair_quotes")
