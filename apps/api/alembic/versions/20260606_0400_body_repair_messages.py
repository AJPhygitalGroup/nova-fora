"""body_repair: messages thread table

Customer ↔ vendor message thread per request. Drives the
`activity_timeline` synthesis (messages + state-change events
interleaved by timestamp) and the messaging UI in the request panel.

`author_id` is nullable so system messages (e.g. "Atlas Body Shop
submitted a quote") can land here without a synthetic user row.
`author_role` is cached so the UI can render the right pill without
joining users every read.

Revision ID: 20260606_0400
Revises: 20260606_0300
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260606_0400"
down_revision = "20260606_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "body_repair_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "request_id", sa.Integer(),
            sa.ForeignKey("body_repair_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # 'customer' | 'vendor' | 'system' — denormalized for the UI.
        sa.Column("author_role", sa.String(length=20), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "ix_body_repair_messages_request_id_created_at",
        "body_repair_messages", ["request_id", "created_at"], unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_body_repair_messages_request_id_created_at", table_name="body_repair_messages")
    op.drop_table("body_repair_messages")
