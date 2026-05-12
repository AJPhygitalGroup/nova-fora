"""Invitation model — token-based onboarding for new users.

Two creation paths:
  1. New org   — inviter sets `org_type` + `org_name`. Org is created when the
                 invitee accepts (org_id will be NULL until then).
  2. Existing org — inviter sets `org_id`. Invitee joins it on accept.

A row is created when an authorized user (site_admin / dsp_owner / vendor_admin)
sends an invite. The `token` is a URL-safe random string the invitee receives
by email. Tokens expire after `INVITATION_TTL_DAYS` (default 7).

Status lifecycle:
  pending → accepted    (invitee opened the link + signed up)
  pending → expired     (background job marks past expires_at)
  pending → revoked     (inviter cancels via DELETE)

Email delivery is fire-and-forget at create time. `last_email_sent_at` lets
us re-send (POST /resend) without losing audit history.
"""
from datetime import datetime, timedelta, timezone
from enum import Enum
from secrets import token_urlsafe

import sqlalchemy as sa
from sqlalchemy import Column, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now
from app.models.organization import OrgType
from app.models.user import UserRole


# Default TTL — overridable in settings
INVITATION_TTL_DAYS = 7


class InvitationStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    EXPIRED = "expired"
    REVOKED = "revoked"


def _new_token() -> str:
    """43-char URL-safe random — ~256 bits of entropy."""
    return token_urlsafe(32)


def _default_expiry() -> datetime:
    return utc_now() + timedelta(days=INVITATION_TTL_DAYS)


class Invitation(SQLModel, table=True):
    """One row per invitation sent. Globally unique by `token`.

    Email column is intentionally NOT unique — an admin may need to re-invite
    the same address after a previous invitation expired or was revoked.
    Active (`pending`) invitations for the same email are filtered server-side
    on create so we don't spam the inbox.
    """

    __tablename__ = "invitations"
    __table_args__ = (
        UniqueConstraint("token", name="invitations_token_uq"),
    )

    id: int | None = Field(default=None, primary_key=True)

    # ── Invitee identity ──
    email: str = Field(index=True, max_length=255, nullable=False)
    full_name: str | None = Field(default=None, max_length=200)

    # ── Role + org context ──
    role: UserRole = Field(
        sa_column=Column(
            "role",
            sa.Enum(UserRole, native_enum=False, length=30,
                    values_callable=lambda e: [m.value for m in e]),
            nullable=False,
        ),
    )
    # Existing-org case: org_id set, org_type/org_name NULL (joins existing).
    # New-org case: org_id NULL, org_type + org_name set (org created on accept).
    org_id: int | None = Field(
        default=None,
        sa_column=Column(
            "org_id", sa.Integer,
            ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True, index=True,
        ),
    )
    org_type: OrgType | None = Field(
        default=None,
        sa_column=Column(
            "org_type",
            sa.Enum(OrgType, native_enum=False, length=20,
                    values_callable=lambda e: [m.value for m in e]),
            nullable=True,
        ),
    )
    org_name: str | None = Field(default=None, max_length=200)

    # ── Vendor workshop attachment (new-org vendor invites only) ──
    # When the invitee accepts and we create the vendor Organization, we
    # also auto-create a VendorWorkshop seeded with these fields. NULL on
    # all other invite shapes (DSP, existing-org joins, etc.).
    vendor_repair_types: list[str] | None = Field(
        default=None,
        sa_column=Column(
            "vendor_repair_types",
            ARRAY(sa.String(length=20)),
            nullable=True,
        ),
    )
    vendor_status_tracking_mode: str | None = Field(
        default=None,
        sa_column=Column(
            "vendor_status_tracking_mode",
            sa.String(length=20),
            nullable=True,
        ),
    )

    # ── Lifecycle ──
    token: str = Field(default_factory=_new_token, max_length=64, nullable=False, index=True)
    status: InvitationStatus = Field(
        default=InvitationStatus.PENDING,
        sa_column=Column(
            "status",
            sa.Enum(InvitationStatus, native_enum=False, length=20,
                    values_callable=lambda e: [m.value for m in e]),
            nullable=False, index=True, server_default="pending",
        ),
    )
    expires_at: datetime = Field(
        default_factory=_default_expiry,
        sa_column=Column(
            "expires_at", sa.DateTime(timezone=True),
            nullable=False, index=True,
        ),
    )

    # ── Audit ──
    invited_by_id: int = Field(
        sa_column=Column(
            "invited_by_id", sa.Integer,
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=False, index=True,
        ),
    )
    accepted_at: datetime | None = Field(
        default=None,
        sa_column=Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
    )
    accepted_by_id: int | None = Field(
        default=None,
        sa_column=Column(
            "accepted_by_id", sa.Integer,
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    last_email_sent_at: datetime | None = Field(
        default=None,
        sa_column=Column("last_email_sent_at", sa.DateTime(timezone=True), nullable=True),
    )

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at"),
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at"),
    )

    # ── Helpers ──
    @property
    def id_str(self) -> str:
        """Frontend-compatible ID — INV-<id>."""
        return f"INV-{self.id:04d}" if self.id is not None else ""

    @property
    def is_expired(self) -> bool:
        # Defensive: status may be stale; check the timestamp too.
        if self.status != InvitationStatus.PENDING:
            return False
        now = datetime.now(timezone.utc)
        return self.expires_at < now

    def can_be_used(self) -> bool:
        return self.status == InvitationStatus.PENDING and not self.is_expired
