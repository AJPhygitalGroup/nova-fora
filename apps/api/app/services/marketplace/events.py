"""`marketplace_events` writer — the marketplace audit trail."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.marketplace import MarketplaceEvent

ACTOR_SHOP_USER = "shop_user"
ACTOR_PROSPECT = "prospect"
ACTOR_DSP_TOKEN = "dsp_token"
ACTOR_SYSTEM = "system"
ACTOR_ADMIN = "admin"


async def log(
    session: AsyncSession,
    event: str,
    *,
    actor_kind: str,
    actor_user_id: int | None = None,
    offer_id: int | None = None,
    quote_id: int | None = None,
    vehicle_id: int | None = None,
    shop_org_id: int | None = None,
    note: str | None = None,
    details: dict[str, Any] | None = None,
) -> MarketplaceEvent:
    row = MarketplaceEvent(
        event=event,
        actor_kind=actor_kind,
        actor_user_id=actor_user_id,
        offer_id=offer_id,
        quote_id=quote_id,
        vehicle_id=vehicle_id,
        shop_org_id=shop_org_id,
        note=note,
        details=details or {},
    )
    session.add(row)
    return row
