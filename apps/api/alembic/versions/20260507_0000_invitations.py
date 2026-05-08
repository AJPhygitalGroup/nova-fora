"""invitations table — token-based onboarding for new owners + vendors

Revision ID: 20260507_0000
Revises: 20260506_0500
Create Date: 2026-05-07 00:00:00.000000

Adds the invitations table that backs the /auth/invitations endpoints.
A site_admin / dsp_owner / vendor_admin creates a row, the invitee gets an
email with the token, and POSTing the token to /auth/invitations/{token}/accept
creates the User (and the Organization, if a new-org invite) plus issues
auth tokens.

Schema notes:
  - `token` is unique and indexed — single-use lookup key.
  - `org_id` nullable so new-org invites can be created without a parent
    organization existing yet (created on accept).
  - `email` deliberately NOT unique — admins can re-invite after expiry/revoke.
  - All status / role / org_type stored as VARCHAR per CLAUDE.md rule #2.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260507_0000"
down_revision: Union[str, None] = "20260506_0500"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=200), nullable=True),
        sa.Column("role", sa.String(length=30), nullable=False),
        sa.Column(
            "org_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("org_type", sa.String(length=20), nullable=True),
        sa.Column("org_name", sa.String(length=200), nullable=True),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "invited_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=False,
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "accepted_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("last_email_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("token", name="invitations_token_uq"),
    )
    op.create_index("ix_invitations_email", "invitations", ["email"])
    op.create_index("ix_invitations_token", "invitations", ["token"])
    op.create_index("ix_invitations_status", "invitations", ["status"])
    op.create_index("ix_invitations_expires_at", "invitations", ["expires_at"])
    op.create_index("ix_invitations_org_id", "invitations", ["org_id"])
    op.create_index("ix_invitations_invited_by_id", "invitations", ["invited_by_id"])


def downgrade() -> None:
    op.drop_index("ix_invitations_invited_by_id", "invitations")
    op.drop_index("ix_invitations_org_id", "invitations")
    op.drop_index("ix_invitations_expires_at", "invitations")
    op.drop_index("ix_invitations_status", "invitations")
    op.drop_index("ix_invitations_token", "invitations")
    op.drop_index("ix_invitations_email", "invitations")
    op.drop_table("invitations")
