"""User model — one row per human using the platform.

Role taxonomy (single role per user, stored as VARCHAR per CLAUDE.md rule #2):

DSP organization (org_type=dsp):
  - dsp_owner       Owner — billing, users, fleet, full authority. Can invite anyone in the org.
  - dsp_manager     Fleet manager — fleet, defects, schedule, WOs. No billing/users.
                    Can invite inspectors + viewers.
  - dsp_inspector   Runs DVIC walkarounds + reports defects. Read-only on WOs.
  - dsp_viewer      Read-only across the DSP.

Vendor organization (org_type=vendor):
  - vendor_admin    Owner/admin — billing, users, WO acceptance, tech assignment. Can invite anyone.
  - service_writer  Receives WOs, assigns technicians, talks with DSP. No billing/users.
                    Can invite technicians + viewers.
  - technician      Picks up assigned WOs, marks progress, completes.
  - vendor_viewer   Read-only.

Platform (org_type=platform):
  - site_admin      Nova Fora team — full system access.

Permission helpers live in `app/services/permissions.py` — most code should
ask `is_org_admin(user)` rather than checking specific role values, so adding
roles in the future doesn't require touching every gate.
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class UserRole(str, Enum):
    # DSP roles
    DSP_OWNER = "dsp_owner"
    DSP_MANAGER = "dsp_manager"
    DSP_INSPECTOR = "dsp_inspector"
    DSP_VIEWER = "dsp_viewer"

    # Vendor roles
    VENDOR_ADMIN = "vendor_admin"
    SERVICE_WRITER = "service_writer"
    TECHNICIAN = "technician"
    VENDOR_VIEWER = "vendor_viewer"

    # Platform
    SITE_ADMIN = "site_admin"


class UserStatus(str, Enum):
    ACTIVE = "active"
    PENDING = "pending"    # invited, not yet accepted
    INVITED = "invited"    # alias kept for frontend parity
    DISABLED = "disabled"  # soft-disabled by admin


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: int | None = Field(default=None, primary_key=True)

    # Identity
    email: str = Field(index=True, unique=True, max_length=255, nullable=False)
    full_name: str = Field(max_length=200, nullable=False)
    password_hash: str = Field(max_length=255, nullable=False)

    # Org membership
    organization_id: int = Field(foreign_key="organizations.id", index=True, nullable=False)
    # Stored as VARCHAR — see note in organization.py about enum storage.
    role: UserRole = Field(
        sa_column=Column(
            "role",
            sa.Enum(UserRole, native_enum=False, length=30, values_callable=lambda e: [m.value for m in e]),
            nullable=False,
            index=True,
        )
    )

    # UI niceties (populated from the demo shapes)
    avatar: str | None = Field(default=None, max_length=10)  # 2-char initials like "TG"
    language: str = Field(default="en", max_length=5)

    # Status / lifecycle — also VARCHAR for flexibility
    status: UserStatus = Field(
        default=UserStatus.ACTIVE,
        sa_column=Column(
            "status",
            sa.Enum(UserStatus, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e]),
            nullable=False,
            index=True,
            server_default="active",
        ),
    )
    station: str | None = Field(default=None, max_length=20)  # DSP station: DSE4, DWA6...
    two_fa_enabled: bool = Field(default=False)
    # TIMESTAMPTZ to match the migration — tz-aware datetimes only.
    last_login_at: datetime | None = Field(
        default=None,
        sa_column=Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Who invited this user (nullable = created by system / seed / signup)
    invited_by_id: int | None = Field(default=None, foreign_key="users.id")

    # Timestamps (TIMESTAMPTZ) — see app/models/base.py for why inline.
    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))
