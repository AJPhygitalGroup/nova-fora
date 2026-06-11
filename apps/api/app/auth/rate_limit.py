"""Login rate limiting backed by Redis (2026-06-08 review #5c).

`POST /auth/login` had no throttle, so a script could brute-force a
password or spray credentials across accounts unbounded. This adds two
fixed-window counters per attempt:

  - per (email, ip): caps targeted brute force on one account.
  - per ip:          caps credential spraying many emails from one host.

Mirrors the denylist module's conventions: one cached async Redis
client, a shared key prefix, and FAIL-OPEN on any Redis error. A fleet
ops tool must not lock the parking-lot inspector out of login because
Redis hiccuped — so a broker outage degrades to "no limiting" + a log
warning, never a hard 500/lockout.

Counters are fixed-window: the TTL is set only when the counter is
first created, so the window is a clean N-per-W-seconds (not a sliding
window that an attacker keeps alive). A successful login clears the
per-(email, ip) counter so a user who fat-fingered a few times isn't
penalized.
"""
from __future__ import annotations

import logging
from functools import lru_cache

import redis.asyncio as redis
from fastapi import Request

from app.settings import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

_KEY_PREFIX = "nf:ratelimit:login:"

# Tuned for a small pilot: generous enough that no human hits it, tight
# enough that a script does within seconds.
_PER_EMAIL_MAX = 10      # attempts per window for one (email, ip)
_PER_IP_MAX = 50         # attempts per window for one ip (across emails)
_WINDOW_SECONDS = 300    # 5 minutes


@lru_cache(maxsize=1)
def _client() -> redis.Redis:
    return redis.from_url(settings.redis_url, decode_responses=True)


def client_ip(request: Request) -> str:
    """Best-effort real client IP. uvicorn runs with --proxy-headers so
    request.client.host is already the forwarded client, but we parse
    X-Forwarded-For's first hop defensively in case that changes."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


async def _incr_fixed_window(key: str) -> int:
    """Increment a fixed-window counter; set the TTL only on first hit.
    Returns the post-increment count, or 0 on Redis error (fail open →
    no limiting)."""
    try:
        cli = _client()
        count = await cli.incr(key)
        if count == 1:
            await cli.expire(key, _WINDOW_SECONDS)
        return int(count)
    except Exception as e:  # noqa: BLE001
        log.warning("rate_limit incr failed key=%s err=%s", key, e)
        return 0


async def check_login_rate_limit(ip: str, email: str) -> bool:
    """Record an attempt and report whether it's still allowed.

    Returns True if the caller may proceed, False if either counter has
    exceeded its limit (caller should respond 429). Fail-open: a Redis
    outage makes both counters read 0 → always allowed.
    """
    norm_email = (email or "").strip().lower()
    n_email = await _incr_fixed_window(f"{_KEY_PREFIX}email:{norm_email}:{ip}")
    n_ip = await _incr_fixed_window(f"{_KEY_PREFIX}ip:{ip}")
    return not (n_email > _PER_EMAIL_MAX or n_ip > _PER_IP_MAX)


async def clear_login_rate_limit(ip: str, email: str) -> None:
    """Reset the per-(email, ip) counter after a successful login so a
    user who mistyped a few times isn't locked out by their own success."""
    norm_email = (email or "").strip().lower()
    try:
        await _client().delete(f"{_KEY_PREFIX}email:{norm_email}:{ip}")
    except Exception as e:  # noqa: BLE001
        log.warning("rate_limit clear failed err=%s", e)


# Seconds the client should wait before retrying — surfaced in Retry-After.
RETRY_AFTER_SECONDS = _WINDOW_SECONDS
