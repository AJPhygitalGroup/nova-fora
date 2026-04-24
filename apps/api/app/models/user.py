"""User model — one row per human using the platform.

Roles used by the frontend demo (src/data/mockData.js):
  - dsp_owner     (e.g. Tamika Gambrell @ Ribrell 21)
  - vendor_admin  (e.g. Olger Joya @ Dulles Midas)
  - technician    (e.g. David Torres @ Dulles Midas)
  - site_admin    (e.g. Maria Chen @ Nova Fora)

For MVP we store a single role per user. If multi-role becomes needed
(Sec. 3.2 of the plan mentions it), we add a `user_roles` association table
in a later migration.
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field

from app.models.base import TimestampMixin


class UserRole(str, Enum):
    DSP_OWNER = "dsp_owner"
    VENDOR_ADMIN = "vendor_admin"
    TECHNICIAN = "technician"
    SITE_ADMIN = "site_admin"


class UserStatus(str, Enum):
    ACTIVE = "active"
    PENDING = "pending"    # invited, not yet accepted
    INVITED = "invited"    # alias kept for frontend parity
    DISABLED = "disabled"  # soft-disabled by admin


class User(TimestampMixin, table=True):
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
