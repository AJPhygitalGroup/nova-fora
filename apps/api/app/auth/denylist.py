"""Token-revocation denylist backed by Redis.

Sole consumer is `auth/dependencies.py` (rejects revoked jtis at the
401 gate) and `routes/auth.py` (revokes on logout). Keep this module
thin — the entire denylist contract is two functions.

Why a denylist (not a sessions table):
  - JWT is stateless by design; revocation is the one piece that breaks
    the stateless model. Storing only the revoked SET is much smaller
    than tracking every issued token + status. Most tokens never get
    revoked — they just expire.
  - Redis TTL handles cleanup automatically: when the entry's TTL
    matches the token's `exp`, the entry vanishes the moment the token
    would have stopped being trusted anyway. Zero ongoing maintenance.

Storage shape:
  KEY:   "nf:denylist:jti:<jti_hex>"
  VALUE: "1"                       (presence is the signal; no payload)
  TTL:   seconds until the token's `exp` claim

Failure mode: if Redis is unreachable we FAIL OPEN (treat the jti as
not-revoked) and log a warning. The alternative — locking everyone out
on a Redis hiccup — is worse for a fleet operations tool where the
inspector needs to push defects from the parking lot. Pilot P0 will
revisit when we have alerting.
"""
from __future__ import annotations

import logging
from functools import lru_cache

import redis.asyncio as redis

from app.settings import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

# Key prefix lets multiple Nova Fora envs share a Redis without colliding.
_KEY_PREFIX = "nf:denylist:jti:"


@lru_cache(maxsize=1)
def _client() -> redis.Redis:
    """One async Redis client per process. decode_responses=True so we
    deal in strings (the value is just a flag — '1' presence)."""
    return redis.from_url(settings.redis_url, decode_responses=True)


def _key(jti: str) -> str:
    return f"{_KEY_PREFIX}{jti}"


async def revoke_token(jti: str, ttl_seconds: int) -> None:
    """Mark a JWT id as revoked for `ttl_seconds` seconds.

    Called on logout once per token (access + refresh independently).
    No-op if Redis is unreachable — logs a warning instead of raising
    (see the fail-open rationale in the module docstring).

    `ttl_seconds` should be the remaining lifetime of the token (i.e.
    `exp - now`). A floor of 1 second keeps Redis from rejecting
    already-expired keys.
    """
    if not jti:
        return
    ttl = max(1, int(ttl_seconds))
    try:
        await _client().setex(_key(jti), ttl, "1")
    except Exception as e:  # noqa: BLE001
        log.warning("denylist.revoke_token failed jti=%s err=%s", jti, e)


async def is_token_revoked(jti: str) -> bool:
    """True iff `jti` is in the denylist.

    Returns False on Redis errors (fail open). Returns False for
    empty/None jti (legacy tokens minted before the jti field landed —
    they pre-date this code and shouldn't be locked out post-deploy).
    """
    if not jti:
        return False
    try:
        return bool(await _client().exists(_key(jti)))
    except Exception as e:  # noqa: BLE001
        log.warning("denylist.is_token_revoked failed jti=%s err=%s", jti, e)
        return False
