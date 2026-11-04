"""Link tokens for the marketplace — DSP review links and prospect magic links.

Storage rule (spec §9): only the hash is stored. The scheme:

    salt  = 32 random bytes (hex), stored
    token = base64url(HMAC-SHA256(secret, purpose || salt))   — never stored
    hash  = SHA-256(token) hex, stored + unique-indexed for lookup

The server can re-derive the same token from (secret, salt), so every quote
email for a van carries the SAME link — a DSP can click a button in the
first email after the fifth quote arrived. A DB dump alone (hash + salt) is
not enough to forge a link: the secret lives in env
(`MARKETPLACE_TOKEN_SECRET`, falling back to `JWT_SECRET`). Rotating the
salt kills every outstanding link for that row.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

from app.settings import get_settings

DSP_REVIEW = "dsp-review"
SHOP_BOARD = "shop-board"


def _secret() -> bytes:
    s = get_settings()
    return (s.marketplace_token_secret or s.jwt_secret).encode("utf-8")


def new_salt() -> str:
    return secrets.token_hex(32)


def derive_token(purpose: str, salt: str) -> str:
    mac = hmac.new(_secret(), f"{purpose}:{salt}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).rstrip(b"=").decode("ascii")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue(purpose: str) -> tuple[str, str, str]:
    """Fresh (token, salt, hash)."""
    salt = new_salt()
    token = derive_token(purpose, salt)
    return token, salt, hash_token(token)


def looks_like_token(raw: str | None) -> bool:
    """Cheap shape check before hitting the DB (43 url-safe chars)."""
    if not raw or len(raw) != 43:
        return False
    return all(c.isalnum() or c in "-_" for c in raw)


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
