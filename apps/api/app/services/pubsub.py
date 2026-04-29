"""Async Redis pub/sub for SSE event delivery.

The publisher is best-effort: a failed publish logs a warning but never
breaks the calling request. The DB write is what matters — losing a single
SSE event is a UX nuisance, not a data integrity issue. Subscribers that
care about full history should re-fetch on reconnect.

Channel naming convention: `nova.<entity>.<verb>` — e.g. `nova.defects.created`.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any, AsyncIterator

import redis.asyncio as redis

from app.settings import get_settings

log = logging.getLogger("nova.pubsub")
settings = get_settings()

DEFECTS_CREATED_CHANNEL = "nova.defects.created"


@lru_cache
def _client() -> redis.Redis:
    """Process-wide async Redis client. Connections are lazy."""
    return redis.from_url(settings.redis_url, decode_responses=True)


async def publish_defect_created(envelope: dict[str, Any]) -> None:
    """Publish a defect.created event. Never raises.

    `envelope` is expected to be `{"dsp_id": int, "defect": <DefectV2Response dict>}` —
    the dsp_id at top level lets subscribers filter without parsing the
    nested response.
    """
    try:
        await _client().publish(
            DEFECTS_CREATED_CHANNEL,
            json.dumps(envelope, default=str),
        )
    except Exception as e:  # noqa: BLE001
        log.warning("redis publish failed for %s: %s", DEFECTS_CREATED_CHANNEL, e)


async def subscribe_defect_created() -> AsyncIterator[dict[str, Any]]:
    """Async iterator yielding parsed envelopes from the defects.created channel.

    Caller MUST consume in a try/finally so the underlying pubsub connection
    is released on disconnect. Heartbeats are the caller's responsibility —
    we only emit real messages here.
    """
    pubsub = _client().pubsub()
    await pubsub.subscribe(DEFECTS_CREATED_CHANNEL)
    try:
        while True:
            # 15s timeout = caller can emit a heartbeat between messages.
            msg = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=15.0
            )
            if msg is None:
                yield {"_heartbeat": True}
                continue
            if msg.get("type") != "message":
                continue
            try:
                yield json.loads(msg["data"])
            except json.JSONDecodeError:
                log.warning("malformed pubsub payload, skipping")
                continue
    finally:
        try:
            await pubsub.unsubscribe(DEFECTS_CREATED_CHANNEL)
            await pubsub.aclose()
        except Exception as e:  # noqa: BLE001
            log.warning("pubsub cleanup failed: %s", e)
