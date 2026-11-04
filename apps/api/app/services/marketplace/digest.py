"""Daily per-station digest (spec §5) — `python -m app.cli marketplace-digest`.

1. Sync offers (idempotent) so last night's inspections are included.
2. Take OPEN offers not yet digested (`digested_at IS NULL`) — each
   offer goes out once, the day it is created; after that it stays on
   the board until awarded.
3. Per station, per shop: keep the offers in the shop's specialties.
   Registered shops → their vendor admins; prospects → the profile's
   contact email + a magic link to the board.
4. Claude writes ONLY the opening paragraph. Offer lines come from the
   data through a template. If Claude fails (no key, timeout, refusal,
   anything odd in the output) the email goes out with the template alone.
5. Stamp `digested_at` on every offer processed.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.base import utc_now
from app.models.marketplace import MarketplaceOffer, MarketplaceShopProfile, OfferState
from app.models.organization import Organization
from app.models.photo import Photo
from app.models.vehicle import Vehicle
from app.services import email as email_service
from app.services.email import EmailMessage
from app.services.marketplace import events
from app.services.marketplace.eligibility import UNASSIGNED_STATION, sync_offers
from app.services.marketplace.notifications import _dfs_sender, _e, _wrap_html, offer_label
from app.services.marketplace.shops import (
    board_url,
    list_shops,
    magic_link_token,
    shop_recipients,
)
from app.settings import get_settings

log = logging.getLogger(__name__)

_CATEGORY_WORDS = {
    "body_damage": "body damage",
    "body_panels": "body panels",
    "glass": "glass",
    "lights": "lights",
    "steps": "steps",
    "mirrors": "mirrors",
}

OPENER_SYSTEM = (
    "You write the opening paragraph of a daily email from DFS (Dantzig Fleet "
    "Solutions) to an independent repair shop. The email lists repair "
    "opportunities on Amazon delivery vans that the shop can quote on the DFS "
    "Repair Marketplace. Write 2-3 short, friendly, professional sentences in "
    "English. Use ONLY the facts given. Never mention prices, estimates, "
    "discounts, deadlines, guarantees, customer names or any commitment that is "
    "not in the facts. Do not use bullet points, a greeting line, a sign-off or "
    "a subject line. Plain text only."
)


@dataclass
class OpenerFacts:
    shop_name: str
    station: str
    vans: int
    repairs: int
    categories: list[str]


def template_opener(f: OpenerFacts) -> str:
    cats = ", ".join(f.categories) if f.categories else "repairs"
    return (
        f"Here are today's new repair opportunities near {f.station}: "
        f"{f.repairs} repair{'s' if f.repairs != 1 else ''} on {f.vans} "
        f"van{'s' if f.vans != 1 else ''} ({cats}). Pick the ones you want and "
        "send your price from the marketplace board."
    )


def _opener_is_safe(text: str) -> bool:
    if not text or len(text) > 700:
        return False
    # No money talk and no list formatting from the model.
    return "$" not in text and "\n-" not in text and "\n*" not in text


async def claude_opener(f: OpenerFacts) -> str | None:
    """One short paragraph from Claude, or None on any failure."""
    s = get_settings()
    if not s.anthropic_api_key:
        return None
    try:
        import anthropic

        client = anthropic.AsyncAnthropic(
            api_key=s.anthropic_api_key,
            timeout=s.marketplace_digest_timeout_seconds,
            max_retries=1,
        )
        facts = (
            f"Shop: {f.shop_name}\nStation: {f.station}\nVans: {f.vans}\n"
            f"Repairs: {f.repairs}\nRepair categories: {', '.join(f.categories)}"
        )
        response = await client.messages.create(
            model=s.marketplace_digest_model,
            max_tokens=4000,
            output_config={"effort": "low"},
            system=OPENER_SYSTEM,
            messages=[{"role": "user", "content": f"Facts:\n{facts}\n\nWrite the paragraph."}],
        )
        if response.stop_reason != "end_turn":
            log.warning("digest opener: stop_reason=%s, using template", response.stop_reason)
            return None
        text = " ".join(
            b.text.strip() for b in response.content if getattr(b, "type", None) == "text"
        ).strip()
        return text if _opener_is_safe(text) else None
    except Exception:  # noqa: BLE001 — any failure → template alone
        log.exception("digest opener: Claude call failed, using template")
        return None


# ─────────────────────────────────────────────────────────
# Rendering
# ─────────────────────────────────────────────────────────
@dataclass
class VanGroup:
    vehicle: Vehicle
    offers: list[MarketplaceOffer] = field(default_factory=list)
    photo_counts: dict[int, int] = field(default_factory=dict)


def render_digest(
    *, to: str, shop_name: str, station: str, opener: str, vans: list[VanGroup], link: str
) -> EmailMessage:
    repairs = sum(len(v.offers) for v in vans)
    subject = f"{repairs} new repair{'s' if repairs != 1 else ''} to quote near {station} — DFS"
    text_vans = []
    html_vans = []
    for g in vans:
        v = g.vehicle
        head = f"{v.year} {v.make} {v.model} · VIN {v.vin}"
        items = []
        items_html = []
        for o in g.offers:
            photos = g.photo_counts.get(o.defect_id or 0, 0)
            extra = f" ({photos} photo{'s' if photos != 1 else ''})" if photos else ""
            notes = f"\n      Inspector notes: {o.notes}" if o.notes else ""
            items.append(f"    • {offer_label(o)}{extra}{notes}")
            items_html.append(
                f"<li>{_e(offer_label(o))}{_e(extra)}"
                + (
                    f'<br><span style="color:#475569;">Inspector notes: {_e(o.notes)}</span>'
                    if o.notes
                    else ""
                )
                + "</li>"
            )
        text_vans.append(f"  {head}\n" + "\n".join(items))
        html_vans.append(
            f'<div style="border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; '
            f'margin:0 0 12px;"><div style="font-weight:600;">{_e(head)}</div>'
            f'<ul style="margin:6px 0 0; padding-left:20px;">{"".join(items_html)}</ul></div>'
        )
    text = (
        f"{opener}\n\nStation {station}:\n"
        + "\n\n".join(text_vans)
        + f"\n\nSee photos and send your quotes: {link}\n\n"
        "Fleet owner details are shared once your quote is approved. DFS keeps a 10% "
        "coordination fee on approved quotes; the fleet owner pays you directly.\n"
    )
    body = (
        f'<p style="margin:0 0 16px;">{_e(opener)}</p>'
        f'<p style="margin:0 0 8px; font-weight:600;">Station {_e(station)}</p>'
        + "".join(html_vans)
        + f'<p style="margin:16px 0;"><a href="{_e(link)}" style="display:inline-block; '
        "background:#2563eb; color:#fff; text-decoration:none; padding:12px 20px; "
        'border-radius:8px; font-weight:600;">See photos and send your quotes</a></p>'
        '<p style="font-size:13px; color:#475569;">Fleet owner details are shared once your '
        "quote is approved. DFS keeps a 10% coordination fee on approved quotes; the fleet "
        "owner pays you directly.</p>"
    )
    return EmailMessage(
        to=to,
        subject=subject,
        text=text,
        html=_wrap_html("New repairs to quote", body),
        **_dfs_sender(),
    )


# ─────────────────────────────────────────────────────────
# Run
# ─────────────────────────────────────────────────────────
@dataclass
class DigestResult:
    offers: int = 0
    stations: list[str] = field(default_factory=list)
    emails_sent: int = 0
    emails_attempted: int = 0
    claude_used: int = 0
    by_station: dict[str, int] = field(default_factory=dict)


async def run_digest(
    session: AsyncSession,
    *,
    station: str | None = None,
    dry_run: bool = False,
    now: datetime | None = None,
    opener_fn=None,
) -> DigestResult:
    """Build + send the digest. Commits (unless dry_run)."""
    now = now or utc_now()
    opener_fn = opener_fn or claude_opener
    result = DigestResult()

    await sync_offers(session, now=now)

    stmt = (
        select(MarketplaceOffer)
        .where(MarketplaceOffer.state == OfferState.OPEN)
        .where(MarketplaceOffer.digested_at.is_(None))
        .order_by(MarketplaceOffer.station, MarketplaceOffer.vehicle_id, MarketplaceOffer.id)
    )
    if station:
        stmt = stmt.where(MarketplaceOffer.station == station.strip().upper())
    pending = list((await session.execute(stmt)).scalars().all())
    result.offers = len(pending)
    if not pending:
        if not dry_run:
            await session.commit()
        return result

    vehicle_ids = {o.vehicle_id for o in pending}
    vehicles = {
        v.id: v
        for v in (await session.execute(select(Vehicle).where(Vehicle.id.in_(vehicle_ids))))
        .scalars()
        .all()
    }
    defect_ids = [o.defect_id for o in pending if o.defect_id]
    photo_counts: dict[int, int] = defaultdict(int)
    if defect_ids:
        for (did,) in (
            await session.execute(
                select(Photo.defect_id)
                .where(Photo.defect_id.in_(defect_ids))
                .where(Photo.is_deleted.is_(False))
            )
        ).all():
            photo_counts[did] += 1

    by_station: dict[str, list[MarketplaceOffer]] = defaultdict(list)
    for o in pending:
        by_station[o.station or UNASSIGNED_STATION].append(o)
    result.stations = sorted(by_station)

    shops: list[tuple[Organization, MarketplaceShopProfile]] = [
        (org, p) for org, p in await list_shops(session) if p.is_active
    ]
    for st, offers in sorted(by_station.items()):
        result.by_station[st] = len(offers)
        for org, profile in shops:
            mine = [o for o in offers if o.specialty in set(profile.specialties or [])]
            if not mine:
                continue
            recipients = await shop_recipients(session, profile)
            if not recipients:
                continue
            groups: dict[int, VanGroup] = {}
            for o in mine:
                g = groups.setdefault(o.vehicle_id, VanGroup(vehicle=vehicles[o.vehicle_id]))
                g.offers.append(o)
                if o.defect_id:
                    g.photo_counts[o.defect_id] = photo_counts.get(o.defect_id, 0)
            cats = sorted({_CATEGORY_WORDS.get(c, c) for c in await _categories(session, mine)})
            facts = OpenerFacts(
                shop_name=org.name,
                station=st,
                vans=len(groups),
                repairs=len(mine),
                categories=cats,
            )
            opener = await opener_fn(facts)
            if opener:
                result.claude_used += 1
            else:
                opener = template_opener(facts)
            is_prospect = _v(profile.onboarding_status) != "registered"
            link = (
                board_url(await magic_link_token(session, profile)) if is_prospect else board_url()
            )
            for to in recipients:
                msg = render_digest(
                    to=to,
                    shop_name=org.name,
                    station=st,
                    opener=opener,
                    vans=list(groups.values()),
                    link=link,
                )
                result.emails_attempted += 1
                if dry_run:
                    continue
                if email_service.send(msg):
                    result.emails_sent += 1
            if not dry_run:
                profile.last_digest_at = now
                session.add(profile)
                await events.log(
                    session,
                    "digest_sent",
                    actor_kind=events.ACTOR_SYSTEM,
                    shop_org_id=org.id,
                    details={
                        "station": st,
                        "offer_ids": [o.id for o in mine],
                        "recipients": len(recipients),
                        "claude": opener != template_opener(facts),
                    },
                )
    if dry_run:
        await session.rollback()
        return result
    for o in pending:
        o.digested_at = now
        session.add(o)
    await session.commit()
    return result


def _v(x) -> str:
    return x.value if hasattr(x, "value") else str(x)


async def _categories(session: AsyncSession, offers: list[MarketplaceOffer]) -> list[str]:
    from app.models.marketplace import MarketplaceRule

    rule_ids = {o.rule_id for o in offers if o.rule_id}
    if not rule_ids:
        return []
    return list(
        (
            await session.execute(
                select(MarketplaceRule.category).where(MarketplaceRule.id.in_(rule_ids)).distinct()
            )
        )
        .scalars()
        .all()
    )
