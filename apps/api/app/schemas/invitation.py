"""Pydantic schemas for /auth/invitations.

Two creation shapes (validator picks the one that's valid):
  - existing-org:  org_id is set, org_type/org_name are NULL
  - new-org:       org_id is NULL, org_type + org_name are set

Acceptance is two phases:
  - GET  /auth/invitations/{token}/preview  → returns minimal shape so the
                                              public Sign-up page can render
                                              the form pre-populated.
  - POST /auth/invitations/{token}/accept   → creates the user (+ org if new),
                                              returns auth tokens for auto-login.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models.invitation import InvitationStatus
from app.models.organization import OrgType
from app.models.user import UserRole
from app.models.work_orders.enums import RepairType, StatusTrackingMode


# ─────────────────────────────────────────────────────────
# Create
# ─────────────────────────────────────────────────────────
class InvitationCreate(BaseModel):
    """POST /auth/invitations body."""

    email: EmailStr
    full_name: Optional[str] = Field(default=None, max_length=200)
    role: UserRole

    # Either-or: existing org vs new org
    org_id: Optional[int] = None
    org_type: Optional[OrgType] = None
    org_name: Optional[str] = Field(default=None, max_length=200)

    # ── Vendor workshop bundling (only valid on new-org VENDOR invites) ──
    # When set, the accept flow creates a VendorWorkshop atomically with
    # the Org. Skipping these keeps the legacy "create org only" behavior.
    vendor_repair_types: Optional[list[RepairType]] = None
    vendor_status_tracking_mode: Optional[StatusTrackingMode] = None

    @model_validator(mode="after")
    def _exactly_one_org_path(self) -> "InvitationCreate":
        has_existing = self.org_id is not None
        has_new = self.org_type is not None and self.org_name
        if has_existing and (self.org_type or self.org_name):
            raise ValueError(
                "set either org_id (existing) or org_type+org_name (new), not both"
            )
        if not has_existing and not has_new:
            raise ValueError(
                "must provide org_id (existing org) or org_type+org_name (new org)"
            )
        if has_new and self.org_type == OrgType.PLATFORM:
            raise ValueError("cannot create platform orgs via invitation")
        # Role family must match org type for new-org invites — the route
        # double-checks this for existing-org invites too via permissions.is_*_role.
        if has_new:
            from app.services.permissions import is_dsp_role, is_vendor_role
            if self.org_type == OrgType.DSP and not is_dsp_role(self.role):
                raise ValueError(
                    f"role '{self.role.value}' is not valid for a DSP organization"
                )
            if self.org_type == OrgType.VENDOR and not is_vendor_role(self.role):
                raise ValueError(
                    f"role '{self.role.value}' is not valid for a Vendor organization"
                )

        # Vendor workshop fields: only meaningful on new-org vendor invites.
        # Reject misuse early so the UI can't accidentally orphan a workshop.
        workshop_set = (
            self.vendor_repair_types is not None
            or self.vendor_status_tracking_mode is not None
        )
        if workshop_set and not (has_new and self.org_type == OrgType.VENDOR):
            raise ValueError(
                "vendor_repair_types / vendor_status_tracking_mode are only "
                "valid on new-org vendor invites (org_type='vendor' + org_name)"
            )
        if (
            self.vendor_repair_types is not None
            and len(self.vendor_repair_types) == 0
        ):
            raise ValueError(
                "vendor_repair_types must contain at least one repair_type "
                "(or omit the field entirely)"
            )
        return self

    model_config = ConfigDict(extra="forbid")


# ─────────────────────────────────────────────────────────
# Response
# ─────────────────────────────────────────────────────────
class InvitationResponse(BaseModel):
    """Shape returned by POST/GET /auth/invitations.

    Includes the accept URL so the inviter (in the dev-stub email mode)
    can copy/paste it manually to the invitee.
    """

    id: str  # INV-XXXX
    email: str
    full_name: Optional[str] = None
    role: str
    org_id: Optional[str] = None     # DSP-XXXX / V-XXX when set
    org_name: Optional[str] = None
    org_type: Optional[str] = None   # dsp | vendor
    vendor_repair_types: Optional[list[str]] = None
    vendor_status_tracking_mode: Optional[str] = None
    status: str
    expires_at: datetime
    invited_by_id: int
    invited_by_name: Optional[str] = None
    accept_url: str
    accepted_at: Optional[datetime] = None
    last_email_sent_at: Optional[datetime] = None
    smtp_delivered: bool = False     # True when SMTP send succeeded
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InvitationListResponse(BaseModel):
    items: list[InvitationResponse]
    total: int


# ─────────────────────────────────────────────────────────
# Public preview — what the Sign-up page reads from the token
# ─────────────────────────────────────────────────────────
class InvitationPreview(BaseModel):
    """Slim shape for the public accept screen.

    No PII beyond what the invitee already knows (their own email + the org
    they were invited to). Inviter name is included so it doesn't look like
    a phishing email.
    """

    email: str
    full_name: Optional[str] = None
    role: str
    role_label: str
    org_name: str
    org_type: str
    inviter_name: str
    expires_at: datetime
    status: str = InvitationStatus.PENDING.value


# ─────────────────────────────────────────────────────────
# Accept
# ─────────────────────────────────────────────────────────
class InvitationAcceptPayload(BaseModel):
    """POST /auth/invitations/{token}/accept body."""

    full_name: str = Field(min_length=2, max_length=200)
    password: str = Field(min_length=8, max_length=128)
    phone: Optional[str] = Field(default=None, max_length=30)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        has_letter = any(c.isalpha() for c in v)
        has_digit = any(c.isdigit() for c in v)
        if not (has_letter and has_digit):
            raise ValueError("password must contain at least one letter and one number")
        return v

    model_config = ConfigDict(extra="forbid")


class InvitationAcceptResponse(BaseModel):
    """Returned after a successful accept — includes JWT pair for auto-login
    plus the freshly-created user + organization shapes.
    """

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict
    organization: dict
