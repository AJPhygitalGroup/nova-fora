"""Auth audit log — append-only record of who did what to whom.

Separate table (not WoActivityLog) because the events are user-scoped,
not WO-scoped: login, logout, impersonate-start. Letting them share a
table would force every consumer of WoActivityLog to filter out auth
noise, and the column shapes diverge (no entity_id, FK targets users
not WOs).

Read surfaces today:
  GET /auth/audit-log  — site_admin only, paginated + filterable.
  (Frontend admin panel listing is mechanical follow-up.)

Write surfaces today:
  routes/auth.py:login        → event_type=login
  routes/auth.py:logout       → event_type=logout
  routes/auth.py:impersonate  → event_type=impersonate_start
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

import sqlalchemy as sa
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class AuthAuditEvent(str, Enum):
    """auth_audit_log.event_type — VARCHAR(40).

    CHECK-constrained allowlist; mirror any addition in the migration.
    """

    LOGIN = "login"
    LOGOUT = "logout"
    IMPERSONATE_START = "impersonate_start"
    # IMPERSONATE_STOP intentionally omitted — frontend.stopImpersonate
    # is local-only (sessionStorage swap), no API call.


class AuthAuditLog(SQLModel, table=True):
    """Append-only audit row. Never updated, never deleted (TRUNCATE only
    in disaster recovery). Indexed by event_type + actor_user_id +
    created_at for the typical "show me X's recent activity" queries.
    """

    __tablename__ = "auth_audit_log"

    id: int | None = Field(default=None, primary_key=True)

    event_type: AuthAuditEvent = Field(
        sa_column=Column(
            "event_type",
            sa.Enum(
                AuthAuditEvent,
                native_enum=False,
                length=40,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
        ),
    )

    # The user who performed the action. NULL for failed-login attempts
    # against unknown emails (we still record the IP + email tried in
    # `extra` so abuse patterns are visible).
    actor_user_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        index=True,
    )

    # The user being acted upon. Only set for impersonate_start (= the
    # impersonated user). NULL for login/logout (you can't act on
    # someone else by logging in).
    target_user_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        index=True,
    )

    # Forensic context. IPv6 fits in 45 chars.
    ip_address: str | None = Field(default=None, max_length=45)
    user_agent: str | None = Field(default=None, max_length=500)

    # Per-event payload. Examples:
    #   login                → {"email_tried": "..."} (for failures)
    #   logout               → {"refresh_revoked": true}
    #   impersonate_start    → {"target_email": "...", "target_role": "..."}
    extra: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(
            "extra",
            JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            index=True,
        ),
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID. AAL-00042 etc."""
        return f"AAL-{self.id:05d}" if self.id is not None else ""
