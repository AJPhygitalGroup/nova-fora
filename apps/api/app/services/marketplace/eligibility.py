"""Which defects are offered, and keeping offers in sync (spec §3, §4).

A defect is ELIGIBLE when:
  1. its (part, defect_type) matches an ACTIVE `marketplace_rules` row;
  2. it is not on a work order in pending_acceptance / accepted /
     in_progress — checked by physical defect (see `defect_key`), because
     nightly inspections write a fresh `defects` row for damage that is
     already on a WO;
  3. it is not on a COMPLETED work order (already repaired);
  4. no offer for the same physical defect is open, or was awarded
     recently (`MARKETPLACE_REOFFER_AFTER_DAYS`) — the next night's
     duplicate report must not be re-offered while the shop is fixing it.

`DefectGroup.CMR` / `derive_billing_type()` are deliberately NOT used.

`sync_offers()` is idempotent: it creates missing offers and withdraws
open offers that stopped being eligible. `withdraw_offers_for_repair_request()`
is the hook the WO router calls when a defect lands on a WO.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.base import utc_now
from app.models.defect import Defect
from app.models.marketplace import (
    LIVE_QUOTE_STATES,
    MarketplaceOffer,
    MarketplaceQuote,
    MarketplaceQuoteLine,
    MarketplaceRule,
    OfferState,
    OfferWithdrawReason,
    QuoteCloseReason,
    QuoteState,
)
from app.models.user import User, UserRole, UserStatus
from app.models.vehicle import Vehicle
from app.models.work_orders import RepairRequestDefect, WorkOrder, WorkOrderStatus
from app.services.marketplace import events
from app.services.marketplace.rules import active_rules_by_part, match_rule
from app.settings import get_settings

ACTIVE_WO_STATES = (
    WorkOrderStatus.PENDING_ACCEPTANCE.value,
    WorkOrderStatus.ACCEPTED.value,
    WorkOrderStatus.IN_PROGRESS.value,
)
UNASSIGNED_STATION = "UNASSIGNED"


def _v(x) -> str:
    return x.value if hasattr(x, "value") else str(x)


def defect_key(
    vehicle_id: int,
    part: str,
    position: str | None,
    defect_type: str,
    details: dict | None = None,
) -> str:
    """Physical-defect identity across nightly inspections.

    Mirrors the defects functional unique index minus `inspection_id`:
    (vehicle, part, position, defect_type, wheel_position, damage_seq).
    """
    d = details or {}
    return ":".join(
        [
            str(vehicle_id),
            part,
            position or "",
            defect_type,
            str(d.get("wheel_position") or ""),
            str(d.get("damage_seq") or ""),
        ]
    )


def key_of(defect: Defect) -> str:
    return defect_key(
        defect.vehicle_id, defect.part, defect.position, defect.defect_type, defect.details
    )


def is_rule_eligible(
    rules_by_part: dict[str, MarketplaceRule], part: str, defect_type: str
) -> bool:
    """Rule check only (condition 1). Pure — used by tests and the sync."""
    return match_rule(rules_by_part, part, defect_type) is not None


async def dsp_station(session: AsyncSession, dsp_id: int) -> str | None:
    """A DSP's station code (DDC4, DVA5…). Vehicles carry no station, so we
    take it from the DSP's users — owner first, then anyone with one set."""
    rows = (
        await session.execute(
            select(User.station, User.role)
            .where(User.organization_id == dsp_id)
            .where(User.status == UserStatus.ACTIVE)
            .where(User.station.is_not(None))
            .order_by(User.id)
        )
    ).all()
    owner = next((st for st, role in rows if _v(role) == UserRole.DSP_OWNER.value and st), None)
    if owner:
        return owner.strip().upper()
    anyone = next((st for st, _ in rows if st), None)
    return anyone.strip().upper() if anyone else None


async def _defect_ids_on_wos(
    session: AsyncSession, statuses: tuple[str, ...], vehicle_ids: set[int] | None = None
) -> set[int]:
    stmt = (
        select(RepairRequestDefect.defect_id)
        .join(WorkOrder, WorkOrder.repair_request_id == RepairRequestDefect.repair_request_id)
        .where(WorkOrder.status.in_(statuses))
    )
    if vehicle_ids is not None:
        stmt = stmt.where(WorkOrder.vehicle_id.in_(vehicle_ids))
    return set((await session.execute(stmt)).scalars().all())


async def _keys_on_active_wos(session: AsyncSession, vehicle_ids: set[int]) -> set[str]:
    if not vehicle_ids:
        return set()
    ids = await _defect_ids_on_wos(session, ACTIVE_WO_STATES, vehicle_ids)
    if not ids:
        return set()
    rows = (await session.execute(select(Defect).where(Defect.id.in_(ids)))).scalars().all()
    return {key_of(d) for d in rows}


# ─────────────────────────────────────────────────────────
# Closing quotes when offers go away
# ─────────────────────────────────────────────────────────
async def close_live_quotes_for_offers(
    session: AsyncSession,
    offer_ids: list[int],
    *,
    new_state: QuoteState,
    reason: QuoteCloseReason,
    exclude_quote_id: int | None = None,
    note: str | None = None,
) -> list[MarketplaceQuote]:
    """Move every live quote that covers any of `offer_ids` to `new_state`.

    Locks the quotes FOR UPDATE in id order (callers already hold the offer
    locks, so the global order is offers → quotes, which keeps concurrent
    approvals / withdrawals deadlock-free).
    """
    if not offer_ids:
        return []
    quote_ids_stmt = (
        select(MarketplaceQuoteLine.quote_id)
        .where(MarketplaceQuoteLine.offer_id.in_(offer_ids))
        .distinct()
    )
    stmt = (
        select(MarketplaceQuote)
        .where(MarketplaceQuote.id.in_(quote_ids_stmt))
        .where(MarketplaceQuote.state.in_(LIVE_QUOTE_STATES))
        .order_by(MarketplaceQuote.id)
        .with_for_update()
    )
    if exclude_quote_id is not None:
        stmt = stmt.where(MarketplaceQuote.id != exclude_quote_id)
    quotes = list((await session.execute(stmt)).scalars().all())
    now = utc_now()
    for q in quotes:
        q.state = new_state
        q.closed_reason = reason.value
        q.closed_at = now
        session.add(q)
        await events.log(
            session,
            "quote_not_selected" if new_state == QuoteState.NOT_SELECTED else "quote_closed",
            actor_kind=events.ACTOR_SYSTEM,
            quote_id=q.id,
            vehicle_id=q.vehicle_id,
            shop_org_id=q.shop_org_id,
            note=note,
            details={"reason": reason.value, "offer_ids": offer_ids},
        )
    return quotes


async def withdraw_offers(
    session: AsyncSession,
    offers: list[MarketplaceOffer],
    reason: OfferWithdrawReason,
    *,
    details: dict | None = None,
) -> list[MarketplaceQuote]:
    """Withdraw (already locked) open offers and close their live quotes.

    Returns the closed quotes so the caller can notify the shops.
    """
    from app.services.marketplace import notifications  # avoid import cycle

    offers = [o for o in offers if _v(o.state) == OfferState.OPEN.value]
    if not offers:
        return []
    now = utc_now()
    for o in offers:
        o.state = OfferState.WITHDRAWN
        o.withdrawn_at = now
        o.withdrawn_reason = reason.value
        session.add(o)
        await events.log(
            session,
            "offer_withdrawn",
            actor_kind=events.ACTOR_SYSTEM,
            offer_id=o.id,
            vehicle_id=o.vehicle_id,
            details={"reason": reason.value, **(details or {})},
        )
    closed = await close_live_quotes_for_offers(
        session,
        [o.id for o in offers],
        new_state=QuoteState.WITHDRAWN,
        reason=QuoteCloseReason.OFFER_WITHDRAWN,
        note="Defect is no longer available on the marketplace.",
    )
    await session.flush()
    for q in closed:
        await notifications.queue_quote_closed(session, q, reason=reason)
    return closed


async def withdraw_offers_for_repair_request(
    session: AsyncSession, *, repair_request_id: int, work_order_id: int | None = None
) -> list[MarketplaceOffer]:
    """Router hook: a WO was created for this RR → withdraw open offers for
    its defects (by defect id AND by physical key, so last night's duplicate
    report of the same damage is withdrawn too)."""
    defect_ids = list(
        (
            await session.execute(
                select(RepairRequestDefect.defect_id).where(
                    RepairRequestDefect.repair_request_id == repair_request_id
                )
            )
        )
        .scalars()
        .all()
    )
    if not defect_ids:
        return []
    defects = (
        (await session.execute(select(Defect).where(Defect.id.in_(defect_ids)))).scalars().all()
    )
    keys = {key_of(d) for d in defects}
    offers = list(
        (
            await session.execute(
                select(MarketplaceOffer)
                .where(MarketplaceOffer.state == OfferState.OPEN)
                .where(
                    or_(
                        MarketplaceOffer.defect_id.in_(defect_ids),
                        MarketplaceOffer.defect_key.in_(keys),
                    )
                )
                .order_by(MarketplaceOffer.id)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    await withdraw_offers(
        session,
        offers,
        OfferWithdrawReason.ROUTED_TO_WORK_ORDER,
        details={"repair_request_id": repair_request_id, "work_order_id": work_order_id},
    )
    return offers


# ─────────────────────────────────────────────────────────
# Sync
# ─────────────────────────────────────────────────────────
@dataclass
class SyncResult:
    created: list[MarketplaceOffer] = field(default_factory=list)
    withdrawn: list[MarketplaceOffer] = field(default_factory=list)


async def sync_offers(session: AsyncSession, *, now: datetime | None = None) -> SyncResult:
    """Create offers for newly eligible defects and withdraw stale ones.

    Idempotent — safe to run from cron as often as wanted. Caller commits.
    """
    s = get_settings()
    now = now or utc_now()
    result = SyncResult()
    rules = await active_rules_by_part(session)

    # ── 1. Withdraw open offers that are no longer eligible ──
    open_offers = list(
        (
            await session.execute(
                select(MarketplaceOffer)
                .where(MarketplaceOffer.state == OfferState.OPEN)
                .order_by(MarketplaceOffer.id)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    if open_offers:
        vehicle_ids = {o.vehicle_id for o in open_offers}
        active_keys = await _keys_on_active_wos(session, vehicle_ids)
        by_reason: dict[OfferWithdrawReason, list[MarketplaceOffer]] = {}
        for o in open_offers:
            if o.defect_id is None:
                reason = OfferWithdrawReason.DEFECT_DELETED
            elif o.defect_key in active_keys:
                reason = OfferWithdrawReason.ROUTED_TO_WORK_ORDER
            elif not is_rule_eligible(rules, o.part, o.defect_type):
                reason = OfferWithdrawReason.NO_LONGER_ELIGIBLE
            else:
                continue
            by_reason.setdefault(reason, []).append(o)
        for reason, offers in by_reason.items():
            await withdraw_offers(session, offers, reason, details={"source": "sync"})
            result.withdrawn.extend(offers)

    # ── 2. Create offers for eligible defects ──
    if not rules:
        return result
    cutoff = now - timedelta(days=s.marketplace_lookback_days)
    rows = (
        await session.execute(
            select(Defect, Vehicle)
            .join(Vehicle, Vehicle.id == Defect.vehicle_id)
            .where(Vehicle.is_active.is_(True))
            .where(Defect.reported_at >= cutoff)
            .where(Defect.part.in_(list(rules.keys())))
            .order_by(Defect.reported_at, Defect.id)
        )
    ).all()
    if not rows:
        return result

    vehicle_ids = {v.id for _, v in rows}
    defect_ids = [d.id for d, _ in rows]
    active_keys = await _keys_on_active_wos(session, vehicle_ids)
    completed_ids = await _defect_ids_on_wos(
        session, (WorkOrderStatus.COMPLETED.value,), vehicle_ids
    )
    offered_defects = set(
        (
            await session.execute(
                select(MarketplaceOffer.defect_id).where(MarketplaceOffer.defect_id.in_(defect_ids))
            )
        )
        .scalars()
        .all()
    )
    live = (
        await session.execute(
            select(MarketplaceOffer.defect_key, MarketplaceOffer.state, MarketplaceOffer.awarded_at)
            .where(MarketplaceOffer.vehicle_id.in_(vehicle_ids))
            .where(MarketplaceOffer.state.in_([OfferState.OPEN.value, OfferState.AWARDED.value]))
        )
    ).all()
    open_keys = {k for k, st, _ in live if _v(st) == OfferState.OPEN.value}
    awarded_at_by_key: dict[str, datetime] = {}
    for k, st, at in live:
        if _v(st) == OfferState.AWARDED.value and at is not None:
            awarded_at_by_key[k] = max(at, awarded_at_by_key.get(k, at))
    reoffer_cutoff = now - timedelta(days=s.marketplace_reoffer_after_days)

    stations: dict[int, str | None] = {}
    for defect, vehicle in rows:
        rule = match_rule(rules, defect.part, defect.defect_type)
        if rule is None or defect.id in offered_defects or defect.id in completed_ids:
            continue
        key = key_of(defect)
        if key in active_keys or key in open_keys:
            continue
        awarded_at = awarded_at_by_key.get(key)
        if awarded_at is not None and (
            awarded_at >= reoffer_cutoff or defect.reported_at <= awarded_at
        ):
            continue
        if vehicle.dsp_id not in stations:
            stations[vehicle.dsp_id] = await dsp_station(session, vehicle.dsp_id)
        offer = MarketplaceOffer(
            defect_id=defect.id,
            vehicle_id=vehicle.id,
            dsp_id=vehicle.dsp_id,
            rule_id=rule.id,
            specialty=rule.specialty,
            station=stations[vehicle.dsp_id] or UNASSIGNED_STATION,
            defect_key=key,
            part=defect.part,
            position=defect.position,
            defect_type=defect.defect_type,
            notes=defect.notes,
            reported_at=defect.reported_at,
            state=OfferState.OPEN,
        )
        try:
            # Savepoint: a concurrent sync that inserted the same physical
            # defect trips the partial unique index — skip, don't abort.
            async with session.begin_nested():
                session.add(offer)
                await session.flush()
        except IntegrityError:
            continue
        open_keys.add(key)
        result.created.append(offer)
        await events.log(
            session,
            "offer_created",
            actor_kind=events.ACTOR_SYSTEM,
            offer_id=offer.id,
            vehicle_id=vehicle.id,
            details={"defect_id": defect.id, "rule": rule.category, "station": offer.station},
        )
    await session.flush()
    return result


async def van_has_open_offers(session: AsyncSession, vehicle_id: int) -> bool:
    return (
        await session.execute(
            select(MarketplaceOffer.id)
            .where(MarketplaceOffer.vehicle_id == vehicle_id)
            .where(MarketplaceOffer.state == OfferState.OPEN)
            .limit(1)
        )
    ).first() is not None
