"""body_repair: Phase 1 — pave_reports table

Stores parsed PAVE PDF metadata + the JSON payload from the parser
(port of NOVABODY/core's pave_parser at branch mbk/body-repair-demo,
554 lines).

Each row: one uploaded PDF, FK→body_repair_requests with CASCADE
delete (PDF blob cleanup happens elsewhere). Phase enum lets us
store pre-repair and post-repair snapshots against the same request
so Phase 4 can compute the damage diff.

Revision ID: 20260603_2200
Revises: 20260603_2100
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260603_2200"
down_revision = "20260603_2100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "body_repair_pave_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "request_id", sa.Integer(),
            sa.ForeignKey("body_repair_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("phase", sa.String(length=15), nullable=False, server_default="pre"),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=True),
        sa.Column("parse_status", sa.String(length=10), nullable=False, server_default="ok"),
        sa.Column("vin", sa.String(length=20), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("make", sa.String(length=50), nullable=True),
        sa.Column("model", sa.String(length=80), nullable=True),
        sa.Column("inspection_date_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_score", sa.Integer(), nullable=True),
        sa.Column("damage_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("parsed_json", sa.JSON(), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=True),
        sa.Column("source_url", sa.String(length=1000), nullable=True),
        sa.Column(
            "uploaded_by_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
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
    op.create_index(
        "ix_body_repair_pave_reports_request_id",
        "body_repair_pave_reports", ["request_id"], unique=False,
    )
    op.create_index(
        "ix_body_repair_pave_reports_phase",
        "body_repair_pave_reports", ["phase"], unique=False,
    )
    op.create_index(
        "ix_body_repair_pave_reports_vin",
        "body_repair_pave_reports", ["vin"], unique=False,
    )
    op.create_index(
        "ix_body_repair_pave_reports_total_score",
        "body_repair_pave_reports", ["total_score"], unique=False,
    )
    op.create_index(
        "ix_body_repair_pave_reports_parse_status",
        "body_repair_pave_reports", ["parse_status"], unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_body_repair_pave_reports_parse_status", table_name="body_repair_pave_reports")
    op.drop_index("ix_body_repair_pave_reports_total_score", table_name="body_repair_pave_reports")
    op.drop_index("ix_body_repair_pave_reports_vin", table_name="body_repair_pave_reports")
    op.drop_index("ix_body_repair_pave_reports_phase", table_name="body_repair_pave_reports")
    op.drop_index("ix_body_repair_pave_reports_request_id", table_name="body_repair_pave_reports")
    op.drop_table("body_repair_pave_reports")
