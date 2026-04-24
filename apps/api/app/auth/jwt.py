"""JWT encode/decode helpers.

Two token types:
  - access   : short-lived (60 min default), used on every request
  - refresh  : long-lived (30 days default), exchanged for a new access token

Both are signed with HS256 + JWT_SECRET. Stateless — no DB lookup needed to
validate (except for user existence, which happens once in the dependency).
"""
from datetime import UTC, datetime, timedelta
from enum import Enum

from jose import JWTError, jwt

from app.settings import get_settings

settings = get_settings()


class TokenType(str, Enum):
    ACCESS = "access"
    REFRESH = "refresh"


class TokenError(Exception):
    """Raised on any JWT error — expired, malformed, wrong type, etc."""


def create_access_token(user_id: int, extra: dict | None = None) -> str:
    """Short-lived token carrying the user id in `sub`."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": TokenType.ACCESS.value,
        "iat": int(now.timestamp()),
        "exp": int(
            (now + timedelta(minutes=settings.jwt_access_token_expire_minutes)).timestamp()
        ),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: int) -> str:
    """Long-lived token — only used against POST /auth/refresh."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": TokenType.REFRESH.value,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=settings.jwt_refresh_token_expire_days)).timestamp()),
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
