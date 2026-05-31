"""User response schemas — matches the shape the frontend demo expects.

See nova-fora-demo/src/data/mockData.js for reference shapes.
Key transformation: integer IDs become string IDs with prefix (DSP-4201, V-001, NF-000).
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.user import User, UserRole, UserStatus


class UserResponse(BaseModel):
    """Shape returned by /auth/me and /users/* endpoints.

    Matches nova-fora-demo/src/data/mockData.js `users` entries.
    """

    id: str  # stringified int — "1", "2", etc. (frontend treats as opaque)
    email: EmailStr
    name: str = Field(..., description="Full name. Frontend uses `name`, not `full_name`.")
    org: str = Field(..., description="Organization display name.")
    org_id: str = Field(..., description="Org ID with prefix: DSP-4201 / V-001 / NF-000.")
    org_type: str = Field(..., description="dsp | vendor | platform")
    role: UserRole
    role_label: str = Field(..., description="Human-readable role (e.g. 'DSP Fleet Owner').")
    avatar: str | None = None
    station: str | None = None
    language: str
    status: UserStatus
    two_fa_enabled: bool
    last_login_at: datetime | None = None

    # Populated only when the request's JWT carries an `acting_as_id`
    # claim (= site admin is impersonating this user via /auth/impersonate).
    # Lets the frontend show the "Viewing as X" banner + exit button even
    # after a page reload, without keeping the admin identity in client
    # state only. Null on every other path.
    acting_as: dict | None = None

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_user_and_org(cls, user: User, org_name: str, org_id_str: str, org_type: str) -> "UserResponse":
        return cls(
            id=str(user.id),
            email=user.email,
            name=user.full_name,
            org=org_name,
            org_id=org_id_str,
            org_type=org_type,
            role=user.role,
            role_label=_role_label(user.role),
            avatar=user.avatar,
            station=user.station,
            language=user.language,
            status=user.status,
            two_fa_enabled=user.two_fa_enabled,
            last_login_at=user.last_login_at,
        )


def _role_label(role: UserRole) -> str:
    """Human-readable role used by the frontend (Role in top nav, etc.)."""
    labels = {
        # DSP
        UserRole.DSP_OWNER:      "DSP Fleet Owner",
        UserRole.DSP_MANAGER:    "DSP Manager",
        UserRole.DSP_INSPECTOR:  "DSP Inspector",
        UserRole.DSP_VIEWER:     "DSP Viewer",
        # Vendor
        UserRole.VENDOR_ADMIN:   "Vendor Admin",
        UserRole.SERVICE_WRITER: "Service Writer",
        UserRole.TECHNICIAN:     "Technician",
        UserRole.VENDOR_VIEWER:  "Vendor Viewer",
        # Platform
        UserRole.SITE_ADMIN:     "Site Admin",
    }
    # Defensive fallback — the enum may grow; never crash /auth/me on an
    # unmapped role.
    return labels.get(role, str(role).replace("_", " ").title())
