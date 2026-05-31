"""FastAPI dependencies for auth — `get_current_user`, role guards.

Includes a separate `get_current_user_from_query_token` dependency for
EventSource / SSE clients, which can't send custom headers in the browser
and must pass the JWT as a query param. Use it ONLY on long-lived event
streams; the standard Bearer header path is correct everywhere else.

All user-facing error messages are routed through `i18n_errors.tr_error`
so they appear in the user's preferred language. The `Request` object is
read directly (instead of `Depends(get_request_language)`) because these
dependencies fire BEFORE other deps resolve.
"""
from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.denylist import is_token_revoked
from app.auth.jwt import TokenError, TokenType, decode_token
from app.db import get_session
from app.i18n_errors import E, tr_error
from app.i18n_helpers import get_request_language
from app.models.user import User, UserRole, UserStatus

# HTTPBearer extracts the `Authorization: Bearer <token>` header.
# auto_error=False → we emit our own 401 with a useful message.
_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Validates the Bearer access token and returns the User row.

    401 if: header missing, token invalid/expired, wrong type, user not found,
    or user status is not ACTIVE.
    """
    lang = get_request_language(request)
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.MISSING_AUTH_HEADER, lang),
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_token(credentials.credentials, expected_type=TokenType.ACCESS)
    except TokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.INVALID_TOKEN, lang),
            headers={"WWW-Authenticate": "Bearer"},
        ) from e

    # Reject tokens revoked via /auth/logout. Cheap Redis GET; fails
    # open on Redis errors (see denylist module docstring) so a Redis
    # blip can't lock the fleet out mid-shift.
    if await is_token_revoked(payload.get("jti")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.INVALID_TOKEN, lang),
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = int(payload["sub"])
    except (ValueError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.INVALID_TOKEN_SUBJECT, lang),
        ) from None

    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.USER_NOT_FOUND, lang),
        )
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=tr_error(E.USER_STATUS, lang, status=user.status.value),
        )
    # Stash impersonation marker on request.state so endpoints that care
    # (today: /auth/me, future: audit logging) can read it without each
    # one re-decoding the token. Always set — None when not impersonating.
    request.state.acting_as_id = payload.get("acting_as_id")
    return user


async def get_current_user_from_query_token(
    request: Request,
    token: str = Query(..., description="JWT access token (SSE only — header-less clients)"),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Same contract as `get_current_user`, but reads the access token from
    `?token=...` instead of the Authorization header.

    Use on SSE endpoints only — browser EventSource cannot set headers.
    Tokens in query strings have a slightly worse exposure profile (server
    access logs, browser history); mitigated by short-lived access tokens.
    """
    lang = get_request_language(request)
    try:
        payload = decode_token(token, expected_type=TokenType.ACCESS)
    except TokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.INVALID_TOKEN, lang),
        ) from e
    # Same denylist check as the header path — SSE clients must respect
    # revoke too (otherwise a logged-out tab could keep streaming).
    if await is_token_revoked(payload.get("jti")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.INVALID_TOKEN, lang),
        )
    try:
        user_id = int(payload["sub"])
    except (ValueError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=tr_error(E.INVALID_TOKEN_SUBJECT, lang),
        ) from None
    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, tr_error(E.USER_NOT_FOUND, lang)
        )
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            tr_error(E.USER_STATUS, lang, status=user.status.value),
        )
    return user


def require_role(*allowed: UserRole):
    """Dependency factory — restrict an endpoint to specific roles.

    Usage:
        @router.get("/admin/users", dependencies=[Depends(require_role(UserRole.SITE_ADMIN))])
    """

    async def _check(
        request: Request,
        current: User = Depends(get_current_user),
    ) -> User:
        if current.role not in allowed:
            lang = get_request_language(request)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=tr_error(
                    E.REQUIRES_ROLE,
                    lang,
                    roles=[r.value for r in allowed],
                ),
            )
        return current

    return _check
