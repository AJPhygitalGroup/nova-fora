"""Thin write-side wrapper for auth_audit_log.

Centralised so every event has the same shape (IP + UA pulled from
the request automatically, `extra` stays a dict) and so future
additions (e.g. shipping to Sentry / a SIEM) land in one place.

Caller commits — this helper only stages the row + flushes for an id.
"""
from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth_audit_log import AuthAuditEvent, AuthAuditLog


def _ip_of(request: Request | None) -> str | None:
    if request is None or request.client is None:
        return None
    # Honor a trusted reverse-proxy header first (Traefik/EasyPanel sets
    # X-Forwarded-For). Strip to the first hop — chain anything after
    # is the proxy itself, not the client. Falls back to the socket peer.
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",", 1)[0].strip()
    return request.client.host


def _ua_of(request: Request | None) -> str | None:
    if request is None:
        return None
    return request.headers.get("user-agent", "")[:500] or None


async def record(
    session: AsyncSession,
    *,
    event_type: AuthAuditEvent,
    actor_user_id: int | None = None,
    target_user_id: int | None = None,
    request: Request | None = None,
    extra: dict[str, Any] | None = None,
) -> AuthAuditLog:
    """Insert a single audit row. Returns the persisted (flushed) row.

    Safe to call from any route — IP / UA / timestamp filled in for you.
    The caller controls the transaction (typical pattern: record() then
    return; the route's session-scoped commit handles persistence).
    """
    row = AuthAuditLog(
        event_type=event_type,
        actor_user_id=actor_user_id,
        target_user_id=target_user_id,
        ip_address=_ip_of(request),
        user_agent=_ua_of(request),
        extra=extra or {},
    )
    session.add(row)
    await session.flush()
    return row
