"""JWT encode/decode helpers.

Two token types:
  - access   : short-lived (60 min default), used on every request
  - refresh  : long-lived (30 days default), exchanged for a new access token

Both are signed with HS256 + JWT_SECRET. Stateless — no DB lookup needed to
validate (except for user existence, which happens once in the dependency).
"""
import uuid
from datetime import UTC, datetime, timedelta
from enum import Enum

from jose import JWTError, jwt

from app.settings import get_settings

settings = get_settings()


class TokenType(str, Enum):
    ACCESS = "access"
    REFRESH = "refresh"
    # Short-lived, single-purpose token for SSE streams. EventSource can't
    # send an Authorization header, so the token must ride in ?token=...
    # where it can leak via access logs / browser history / Referer. An
    # SSE token is minted on demand, lives ~60s, and is type-gated so the
    # SSE query path REJECTS a full access token — a leaked SSE token
    # expires almost immediately and can't call any other API
    # (2026-06-08 review #b).
    SSE = "sse"


# Seconds an SSE token stays valid. Long enough to open the stream, short
# enough that a leaked copy is near-useless.
SSE_TOKEN_TTL_SECONDS = 60


class TokenError(Exception):
    """Raised on any JWT error — expired, malformed, wrong type, etc."""


def create_access_token(user_id: int, extra: dict | None = None) -> str:
    """Short-lived token carrying the user id in `sub`.

    Stamps a unique `jti` (JWT ID) so the token can be individually
    revoked via the Redis denylist (auth/denylist.py) at logout. UUID4
    hex — 128-bit entropy, no realistic collision risk over the token's
    lifetime.
    """
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": TokenType.ACCESS.value,
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int(
            (now + timedelta(minutes=settings.jwt_access_token_expire_minutes)).timestamp()
        ),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: int, extra: dict | None = None) -> str:
    """Long-lived token — only used against POST /auth/refresh.

    `extra` lets the caller stamp claims that should survive refresh
    rotation. Notably `acting_as_id` (set by /auth/impersonate) needs
    to ride along on the refresh so a token rotation mid-impersonation
    keeps the "really admin X" context.

    Stamped with a unique `jti` so logout can revoke the refresh too
    (otherwise an attacker holding only the refresh could mint fresh
    access tokens after logout, defeating the access-side revoke).
    """
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": TokenType.REFRESH.value,
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=settings.jwt_refresh_token_expire_days)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_sse_token(user_id: int) -> str:
    """Mint a short-lived (SSE_TOKEN_TTL_SECONDS) token scoped to SSE only.

    Carries just `sub` + `type=sse` + `jti` + a near-immediate `exp`. No
    impersonation claim is needed — the minting request's identity is
    already the (possibly impersonated) user, so `sub` scopes the stream
    correctly. The jti lets the denylist revoke it if ever needed.
    """
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": TokenType.SSE.value,
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=SSE_TOKEN_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_type: TokenType) -> dict:
    """Verify signature + expiry + token type. Returns the payload dict.

    Raises TokenError on any failure — caller translates to 401.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as e:
        raise TokenError(f"invalid token: {e}") from e

    if payload.get("type") != expected_type.value:
        raise TokenError(f"wrong token type: expected {expected_type.value}")

    if "sub" not in payload:
        raise TokenError("token missing subject")

    return payload
