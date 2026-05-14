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
DEFECT_REVIEWS_CHANNEL = "nova.defect_reviews.changed"
WORK_ORDERS_CHANNEL = "nova.work_orders.changed"


@lru_cache
def _client() -> redis.Redis:
    """Process-wide async Redis client. Connections are lazy."""
    return redis.from_url(settings.redis_url, decode_responses=True)


async def _publish(channel: str, envelope: dict[str, Any]) -> None:
    """Generic best-effort publish. Logs but never raises."""
    try:
        await _client().publish(channel, json.dumps(envelope, default=str))
    except Exception as e:  # noqa: BLE001
        log.warning("redis publish failed for %s: %s", channel, e)


async def _subscribe(channel: str) -> AsyncIterator[dict[str, Any]]:
    """Generic SSE subscription helper. Emits {"_heartbeat": True} every 15s
    when no real messages arrive so SSE consumers can keep proxies awake."""
    pubsub = _client().pubsub()
    await pubsub.subscribe(channel)
    try:
        while True:
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
                log.warning("malformed pubsub payload on %s, skipping", channel)
                continue
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
        except Exception as e:  # noqa: BLE001
            log.warning("pubsub cleanup failed: %s", e)


# ─────────────────────────────────────────────────────
# defects.created — instant fan-out of newly reported defects
# ─────────────────────────────────────────────────────
async def publish_defect_created(envelope: dict[str, Any]) -> None:
    """Publish a defect.created event. Never raises.

    `envelope` is expected to be `{"dsp_id": int, "defect": <DefectV2Response dict>}` —
    the dsp_id at top level lets subscribers filter without parsing the
    nested response.
    """
    await _publish(DEFECTS_CREATED_CHANNEL, envelope)


async def subscribe_defect_created() -> AsyncIterator[dict[str, Any]]:
    """Async iterator yielding parsed envelopes from the defects.created channel."""
    async for envelope in _subscribe(DEFECTS_CREATED_CHANNEL):
        yield envelope


# ─────────────────────────────────────────────────────
# defect_reviews.changed — approval / rejection lifecycle
# ─────────────────────────────────────────────────────
async def publish_defect_review_event(envelope: dict[str, Any]) -> None:
    """Publish a defect review state change.

    Envelope: {"event": "approved" | "rejected", "defect_id": int,
              "dsp_id": int, "vendor_workshop_id": int | null}.

    Subscribers filter by dsp_id (DSP sees own org) or vendor_workshop_id
    (vendor sees their queue). Site_admin sees everything.
    """
    await _publish(DEFECT_REVIEWS_CHANNEL, envelope)


async def subscribe_defect_review_events() -> AsyncIterator[dict[str, Any]]:
    async for envelope in _subscribe(DEFECT_REVIEWS_CHANNEL):
        yield envelope


# ─────────────────────────────────────────────────────
# work_orders.changed — every state transition on a WO
# ─────────────────────────────────────────────────────
async def publish_work_order_event(envelope: dict[str, Any]) -> None:
    """Publish a work-order state change.

    Envelope: {"event": "created" | "accepted" | "declined" | "started" |
                       "completed" | "cancelled" | "assigned" | "scheduled" |
                       "dsp_response" | "rescheduled",
              "work_order_id": int,
              "dsp_id": int,
              "vendor_workshop_id": int | null,
              "assigned_technician_id": int | null}.

    Subscribers filter server-side based on role:
      - dsp_owner / dsp_manager / etc: dsp_id matches user's organization
      - vendor_admin / service_writer / vendor_viewer: vendor_workshop_id
        is in the user's workshop set
      - technician: assigned_technician_id matches OR vendor_workshop_id
        matches (so techs see assignments and unassigned work in their shop)
      - site_admin: all events
    """
    await _publish(WORK_ORDERS_CHANNEL, envelope)


async def subscribe_work_order_events() -> AsyncIterator[dict[str, Any]]:
    async for envelope in _subscribe(WORK_ORDERS_CHANNEL):
        yield envelope
