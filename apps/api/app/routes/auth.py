"""Authentication endpoints.

  POST /auth/login     email+password → {access, refresh}
  POST /auth/refresh   refresh token → new access (+ rotated refresh)
  POST /auth/logout    stateless JWT — server-side is a no-op, frontend clears storage
  GET  /auth/me        returns the current user (full UserResponse shape)
"""
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.auth.denylist import is_token_revoked, revoke_token
from app.auth.hashing import verify_password
from app.auth.jwt import (
    TokenError,
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.db import get_session
from app.i18n_errors import E, tr_error
from app.i18n_helpers import get_request_language
from app.models.organization import Organization
from app.models.user import User, UserRole, UserStatus
from app.schemas.auth import LoginRequest, RefreshRequest, TokenPair
from app.schemas.user import UserResponse
from app.settings import get_settings
from app.models.base import utc_now

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


async def _build_user_response(
    user: User,
    session: AsyncSession,
    lang: str = "en",
    *,
    acting_as_id: int | None = None,
) -> UserResponse:
    """Fetch the user's org so the response includes org name + prefixed id.

    When `acting_as_id` is set (= site admin impersonating this user via
    /auth/impersonate), look up the admin and attach an `acting_as` dict
    to the response so the frontend can show the "Viewing as X" banner
    and offer an exit even after a page reload.
    """
    org = (
        await session.execute(
            select(Organization).where(Organization.id == user.organization_id)
        )
    ).scalar_one_or_none()
    if org is None:
        # Shouldn't happen due to FK, but defensive.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=tr_error(E.DANGLING_ORG, lang),
        )
    resp = UserResponse.from_user_and_org(
        user=user,
        org_name=org.name,
        org_id_str=org.id_str,
        org_type=org.org_type.value,
    )
    if acting_as_id is not None:
        admin = (
            await session.execute(select(User).where(User.id == acting_as_id))
        ).scalar_one_or_none()
        if admin is not None:
            resp.acting_as = {
                "id": str(admin.id),
                "email": admin.email,
                "name": admin.full_name,
            }
    return resp


@router.post(
    "/login",
    response_model=TokenPair,
    summary="Login with email + password",
    responses={
        401: {"description": "Invalid credentials"},
        403: {"description": "User disabled or pending"},
    },
)
async def login(
    body: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenPair:
    lang = get_request_language(request)
    user = (
        await session.execute(select(User).where(User.email == body.email.lower()))
    ).scalar_one_or_none()

    # Same 401 for both "no user" and "wrong password" → prevents user enumeration.
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.INVALID_CREDENTIALS, lang),
        )

    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=tr_error(E.USER_STATUS, lang, status=user.status.value),
        )

    # Update last_login_at (best effort — don't fail login if this fails)
    user.last_login_at = utc_now()
    session.add(user)
    await session.commit()

    return TokenPair(
        access_token=create_access_token(user_id=user.id),
        refresh_token=create_refresh_token(user_id=user.id),
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )


@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="Exchange a refresh token for a new access + refresh pair",
    responses={401: {"description": "Invalid or expired refresh token"}},
)
async def refresh(
    body: RefreshRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenPair:
    lang = get_request_language(request)
    try:
        payload = decode_token(body.refresh_token, expected_type=TokenType.REFRESH)
    except TokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.INVALID_TOKEN, lang),
        ) from e

    # Reject refresh tokens revoked at logout — without this check, a
    # logged-out client holding the refresh could still mint fresh
    # access tokens, defeating the access-side revoke.
    if await is_token_revoked(payload.get("jti")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.INVALID_TOKEN, lang),
        )

    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.INVALID_TOKEN_SUBJECT, lang),
        ) from None

    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.USER_NO_LONGER_ACTIVE, lang),
        )

    # Propagate the `acting_as_id` claim across refresh so a mid-
    # impersonation rotation keeps the "really admin X" context. Token
    # is signed → the claim can't be forged; safe to trust on read.
    extra = {}
    if "acting_as_id" in payload:
        extra["acting_as_id"] = payload["acting_as_id"]
    return TokenPair(
        access_token=create_access_token(user_id=user.id, extra=extra or None),
        refresh_token=create_refresh_token(user_id=user.id, extra=extra or None),
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )


@router.post(
    "/impersonate/{user_id}",
    response_model=TokenPair,
    summary="Site admin only — mint a token pair for `user_id`",
    responses={
        400: {"description": "Cannot impersonate yourself"},
        403: {"description": "Caller is not a site_admin OR target is a site_admin"},
        404: {"description": "Target user not found or inactive"},
    },
)
async def impersonate(
    user_id: int,
    request: Request,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TokenPair:
    """Mint a token pair scoped to `user_id` while remembering the
    original admin via the `acting_as_id` JWT claim. The claim survives
    refresh rotation so a long impersonation session stays attributed.

    Replaces the App.jsx local-state-only "switch the visible user"
    pattern (App.jsx:91 TODO from Semana 6) which DIDN'T change the API
    identity — meaning the API still saw the admin's token, so backend
    authorization couldn't be verified during impersonation and bugs
    were masked. With real tokens, multi-tenant tests during
    impersonation actually exercise the target's authz envelope.

    Guards:
      - Caller must be site_admin (would be `require_role` but we want
        a friendly 403 message).
      - Cannot impersonate yourself (400 — pointless).
      - Cannot impersonate ANOTHER site_admin (403 — no lateral escalation).
      - Target must exist + be ACTIVE (404 if not).

    Audit: structured log line for now. Pilot P0 will add a real
    audit table; until then the JSON log is grep-able.
    """
    import logging
    log = logging.getLogger(__name__)
    lang = get_request_language(request)

    if current.role != UserRole.SITE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=tr_error(
                E.REQUIRES_ROLE, lang, roles=[UserRole.SITE_ADMIN.value],
            ),
        )
    if user_id == current.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="cannot impersonate yourself",
        )

    target = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if target is None or target.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=tr_error(E.USER_NOT_FOUND, lang),
        )
    if target.role == UserRole.SITE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="cannot impersonate another site_admin",
        )

    extra = {"acting_as_id": current.id}
    log.info(
        "auth.impersonate admin_id=%s admin_email=%s target_id=%s target_email=%s role=%s",
        current.id, current.email, target.id, target.email, target.role.value,
    )
    return TokenPair(
        access_token=create_access_token(user_id=target.id, extra=extra),
        refresh_token=create_refresh_token(user_id=target.id, extra=extra),
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Logout — revokes the access (+ optional refresh) token",
    responses={
        204: {"description": "Tokens revoked. Same client must not reuse them."},
    },
)
async def logout(
    request: Request,
    current: User = Depends(get_current_user),
    body: dict | None = Body(default=None),
) -> None:
    """Real revocation as of 2026-05-29 — was a no-op (Semana 7 TODO,
    flagged by tester #5). The bearer access token's `jti` is inserted
    into the Redis denylist with TTL = remaining lifetime; if the client
    also sends `refresh_token` in the body, that jti is revoked too.

    No-op on tokens minted before this code shipped (they had no `jti`
    claim) — they stay valid until natural expiry. Cleanest deploy: the
    next time each user logs in they'll get jti-stamped tokens and
    subsequent logouts actually revoke.

    Body shape (all optional):
        { "refresh_token": "<jwt>" }
    """
    # The access token came in via the Authorization header; pull it
    # back out of request.headers since the dependency consumed but
    # didn't expose it.
    auth_header = request.headers.get("authorization", "")
    access_jwt = (
        auth_header.split(" ", 1)[1].strip()
        if auth_header.lower().startswith("bearer ")
        else ""
    )
    now_ts = int(utc_now().timestamp())

    if access_jwt:
        try:
            payload = decode_token(access_jwt, expected_type=TokenType.ACCESS)
            jti = payload.get("jti")
            exp = int(payload.get("exp", 0))
            if jti:
                await revoke_token(jti, ttl_seconds=max(1, exp - now_ts))
        except TokenError:
            # Malformed bearer? get_current_user would have already 401'd,
            # so reaching here means decode succeeded once already.
            # Defensive: swallow so logout is best-effort.
            pass

    # Optional refresh-token revoke so a logged-out client can't mint
    # fresh access tokens via /auth/refresh.
    refresh_jwt = (body or {}).get("refresh_token") if isinstance(body, dict) else None
    if refresh_jwt:
        try:
            payload = decode_token(refresh_jwt, expected_type=TokenType.REFRESH)
            jti = payload.get("jti")
            exp = int(payload.get("exp", 0))
            if jti:
                await revoke_token(jti, ttl_seconds=max(1, exp - now_ts))
        except TokenError:
            # Bad refresh token → silently ignore; the access revoke
            # already happened so we don't fail the logout for this.
            pass

    _ = current  # ensures we required auth (already enforced by dep)
    return None


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Return the currently authenticated user",
)
async def me(
    request: Request,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    # get_current_user stashes the impersonation marker on request.state
    # for whoever needs it; /me is the canonical surface.
    acting_as_id = getattr(request.state, "acting_as_id", None)
    return await _build_user_response(
        current,
        session,
        get_request_language(request),
        acting_as_id=acting_as_id,
    )


# ─────────────────────────────────────────────────────
# PATCH /auth/me/language — i18n preference
# ─────────────────────────────────────────────────────
from pydantic import BaseModel, Field, field_validator


class _LanguageUpdate(BaseModel):
    """Body shape for PATCH /auth/me/language."""

    language: str = Field(min_length=2, max_length=5)

    @field_validator("language")
    @classmethod
    def _normalize(cls, v: str) -> str:
        # Accept 'es' / 'es-MX' / 'en' / 'en-US' — store the 2-letter base.
        base = v.lower().split("-", 1)[0]
        if base not in ("es", "en"):
            raise ValueError("only 'es' and 'en' are supported")
        return base


@router.patch(
    "/me/language",
    response_model=UserResponse,
    summary="Update the authenticated user's i18n preference",
)
async def update_language(
    request: Request,
    body: _LanguageUpdate = Body(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    if current.language != body.language:
        current.language = body.language
        current.updated_at = utc_now()
        session.add(current)
        await session.commit()
        await session.refresh(current)
    return await _build_user_response(current, session, get_request_language(request))
