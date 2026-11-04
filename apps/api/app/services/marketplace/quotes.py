"""Quote lifecycle — shop actions, DSP decisions, award (spec §4, §6, §9).

Locking order (deadlock-free by construction):
    offers (ascending id)  →  quotes (ascending id)
  - submit / revise take SHARE locks on the offers they cover, so an
    approval (EXCLUSIVE offer locks) and a new quote on the same defect
    serialize: either the quote lands first and the approval marks it
    not_selected, or the approval lands first and the quote sees `awarded`.
  - approve takes EXCLUSIVE locks on its offers, then locks its own quote
    and every competing live quote. Two approvals of overlapping quotes
    serialize on the shared offer; the second sees `awarded` → 409.
  - shop withdraw / DSP reject / ask-for-lower-price lock only the quote.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.base import utc_now
from app.models.marketplace import (
    LIVE_QUOTE_STATES,
    ApprovalToken,
    FeeStatus,
    MarketplaceOffer,
    MarketplaceQuote,
    MarketplaceQuoteLine,
    OfferState,
    QuoteCloseReason,
    QuoteState,
)
from app.models.organization import Organization
from app.services.marketplace import events, notifications
from app.services.marketplace.eligibility import close_live_quotes_for_offers
from app.services.marketplace.review_tokens import mark_exhausted_if_done, review_link
from app.services.marketplace.shops import ShopActor, accept_terms_and_invite
from app.services.marketplace.work import create_work_for_award
from app.settings import get_settings

CENT = Decimal("0.01")
MAX_QUOTE_TOTAL = Decimal("100000.00")


class QuoteError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class LineInput:
    offer_id: int
    amount: Decimal | None = None
    note: str | None = None


@dataclass
class ProspectOnboarding:
    """What a prospect confirms at its first quote (spec §8)."""

    email: str
    full_name: str
    accept_terms: bool


def _v(x) -> str:
    return x.value if hasattr(x, "value") else str(x)


# ─────────────────────────────────────────────────────────
# Money
# ─────────────────────────────────────────────────────────
def fee_rate() -> Decimal:
    return Decimal(str(get_settings().marketplace_fee_rate)).quantize(Decimal("0.0001"))


def compute_fee(total: Decimal) -> Decimal:
    """10% of the shop's price, rounded half-up to the cent (spec §6)."""
    return (Decimal(total) * fee_rate()).quantize(CENT, rounding=ROUND_HALF_UP)


def resolve_total(lines: list[LineInput], total: Decimal | None) -> Decimal:
    """Validate line amounts vs total. Either every line has an amount (total
    is their sum, and must match if also given) or none do (total required)."""
    priced = [ln.amount for ln in lines if ln.amount is not None]
    if priced and len(priced) != len(lines):
        raise QuoteError(422, "price every line or none of them (then send a van total)")
    if priced:
        line_sum = sum((Decimal(a) for a in priced), Decimal("0")).quantize(CENT)
        if total is not None and Decimal(total).quantize(CENT) != line_sum:
            raise QuoteError(422, f"total {total} does not match the line sum {line_sum}")
        result = line_sum
    else:
        if total is None:
            raise QuoteError(422, "a van total is required when lines are not priced")
        result = Decimal(total).quantize(CENT)
    if result <= 0:
        raise QuoteError(422, "the quote total must be greater than zero")
    if result > MAX_QUOTE_TOTAL:
        raise QuoteError(422, f"the quote total cannot exceed {MAX_QUOTE_TOTAL}")
    return result


# ─────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────
async def _lock_offers(
    session: AsyncSession, offer_ids: list[int], *, exclusive: bool
) -> list[MarketplaceOffer]:
    if not offer_ids:
        return []
    stmt = (
        select(MarketplaceOffer)
        .where(MarketplaceOffer.id.in_(sorted(set(offer_ids))))
        .order_by(MarketplaceOffer.id)
        .with_for_update(read=not exclusive)
    )
    return list((await session.execute(stmt)).scalars().all())


async def _lock_quote(session: AsyncSession, quote_id: int) -> MarketplaceQuote | None:
    return (
        await session.execute(
            select(MarketplaceQuote).where(MarketplaceQuote.id == quote_id).with_for_update()
        )
    ).scalar_one_or_none()


async def quote_line_rows(
    session: AsyncSession, quote_id: int
) -> list[tuple[MarketplaceQuoteLine, MarketplaceOffer]]:
    rows = (
        await session.execute(
            select(MarketplaceQuoteLine, MarketplaceOffer)
            .join(MarketplaceOffer, MarketplaceOffer.id == MarketplaceQuoteLine.offer_id)
            .where(MarketplaceQuoteLine.quote_id == quote_id)
            .order_by(MarketplaceQuoteLine.id)
        )
    ).all()
    return [(ln, of) for ln, of in rows]


def _validate_offers_for_shop(
    actor: ShopActor, vehicle_id: int, lines: list[LineInput], offers: list[MarketplaceOffer]
) -> None:
    if not lines:
        raise QuoteError(422, "select at least one defect to quote")
    ids = [ln.offer_id for ln in lines]
    if len(set(ids)) != len(ids):
        raise QuoteError(422, "each defect can appear only once in a quote")
    by_id = {o.id: o for o in offers}
    specialties = set(actor.profile.specialties or [])
    for oid in ids:
        o = by_id.get(oid)
        # Unknown, other van, or outside the shop's specialty → not visible
        # to this shop: same 404 so the board can't be probed.
        if o is None or o.vehicle_id != vehicle_id or _v(o.specialty) not in specialties:
            raise QuoteError(404, f"offer {oid} not found")
        state = _v(o.state)
        if state == OfferState.AWARDED.value:
            raise QuoteError(409, f"{o.id_str} was already awarded — it can no longer be quoted")
        if state != OfferState.OPEN.value:
            raise QuoteError(409, f"{o.id_str} is no longer open")


def _require_quoter(actor: ShopActor) -> None:
    if not actor.profile.is_active:
        raise QuoteError(403, "this shop is not active on the marketplace")
    if not actor.can_quote:
        raise QuoteError(403, "only a vendor admin or service writer can send quotes")


# ─────────────────────────────────────────────────────────
# Shop side
# ─────────────────────────────────────────────────────────
async def submit_quote(
    session: AsyncSession,
    actor: ShopActor,
    *,
    vehicle_id: int,
    lines: list[LineInput],
    total: Decimal | None,
    reply_to_email: str,
    notes: str | None,
    onboarding: ProspectOnboarding | None = None,
) -> MarketplaceQuote:
    _require_quoter(actor)
    amount = resolve_total(lines, total)

    first_quote_prospect = actor.user is None and actor.profile.terms_accepted_at is None
    if first_quote_prospect and (onboarding is None or not onboarding.accept_terms):
        raise QuoteError(
            422,
            "confirm your email and accept the DFS Repair Partner terms to send your first quote",
        )

    offers = await _lock_offers(session, [ln.offer_id for ln in lines], exclusive=False)
    _validate_offers_for_shop(actor, vehicle_id, lines, offers)

    existing = (
        await session.execute(
            select(MarketplaceQuote.id)
            .where(MarketplaceQuote.shop_org_id == actor.org.id)
            .where(MarketplaceQuote.vehicle_id == vehicle_id)
            .where(MarketplaceQuote.state.in_(LIVE_QUOTE_STATES))
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise QuoteError(
            409,
            f"you already have a live quote for this van (MQ-{existing:05d}) — revise it instead",
        )

    now = utc_now()
    quote = MarketplaceQuote(
        shop_org_id=actor.org.id,
        vehicle_id=vehicle_id,
        dsp_id=offers[0].dsp_id,
        state=QuoteState.SUBMITTED,
        revision=1,
        total_amount=amount,
        fee_rate=fee_rate(),
        fee_amount=compute_fee(amount),
        reply_to_email=reply_to_email.strip().lower(),
        notes=notes,
        submitted_by_id=actor.user.id if actor.user else None,
        submitted_at=now,
    )
    try:
        async with session.begin_nested():
            session.add(quote)
            await session.flush()
    except IntegrityError as exc:
        raise QuoteError(409, "you already have a live quote for this van — revise it") from exc
    for ln in lines:
        session.add(
            MarketplaceQuoteLine(
                quote_id=quote.id,
                offer_id=ln.offer_id,
                amount=Decimal(ln.amount).quantize(CENT) if ln.amount is not None else None,
                note=ln.note,
            )
        )
    actor.profile.quote_reply_email = quote.reply_to_email
    session.add(actor.profile)
    await session.flush()
    await events.log(
        session,
        "quote_submitted",
        actor_kind=actor.kind,
        actor_user_id=actor.user.id if actor.user else None,
        quote_id=quote.id,
        vehicle_id=vehicle_id,
        shop_org_id=actor.org.id,
        details={
            "total": str(amount),
            "fee": str(quote.fee_amount),
            "offer_ids": [ln.offer_id for ln in lines],
        },
    )

    if first_quote_prospect and onboarding is not None:
        inv, accept_url = await accept_terms_and_invite(
            session,
            org=actor.org,
            profile=actor.profile,
            email=onboarding.email,
            full_name=onboarding.full_name,
        )
        await events.log(
            session,
            "terms_accepted",
            actor_kind=actor.kind,
            shop_org_id=actor.org.id,
            quote_id=quote.id,
            details={
                "email": onboarding.email.lower(),
                "terms_version": actor.profile.terms_version,
                "invitation_id": inv.id if inv else None,
            },
        )
        if inv is not None and accept_url:
            notifications.queue_invitation(session, inv, org=actor.org, accept_url=accept_url)

    url = await review_link(session, dsp_id=quote.dsp_id, vehicle_id=vehicle_id)
    sent = await notifications.queue_quote_to_dsp(session, quote, review_url=url, is_revision=False)
    if not sent:
        await events.log(
            session,
            "dsp_email_no_recipient",
            actor_kind=events.ACTOR_SYSTEM,
            quote_id=quote.id,
            vehicle_id=vehicle_id,
        )
    return quote


async def _load_own_quote(
    session: AsyncSession, actor: ShopActor, quote_id: int
) -> MarketplaceQuote:
    quote = (
        await session.execute(select(MarketplaceQuote).where(MarketplaceQuote.id == quote_id))
    ).scalar_one_or_none()
    # Never reveal other shops' quotes — same 404 whether missing or foreign.
    if quote is None or quote.shop_org_id != actor.org.id:
        raise QuoteError(404, "quote not found")
    return quote


async def revise_quote(
    session: AsyncSession,
    actor: ShopActor,
    quote_id: int,
    *,
    lines: list[LineInput] | None,
    total: Decimal | None,
    reply_to_email: str | None,
    notes: str | None,
) -> MarketplaceQuote:
    _require_quoter(actor)
    quote = await _load_own_quote(session, actor, quote_id)
    current = await quote_line_rows(session, quote.id)
    current_inputs = [
        LineInput(offer_id=ln.offer_id, amount=ln.amount, note=ln.note) for ln, _ in current
    ]
    if lines is not None:
        new_lines = lines
    elif total is not None:
        # Price-only revision: keep the defects, drop any per-line amounts.
        new_lines = [LineInput(offer_id=c.offer_id, note=c.note) for c in current_inputs]
    else:
        # Notes / reply-to only: keep lines and price as they are.
        new_lines = current_inputs
        if not any(c.amount is not None for c in current_inputs):
            total = quote.total_amount
    amount = resolve_total(new_lines, total)

    new_ids = {ln.offer_id for ln in new_lines}
    offers = await _lock_offers(
        session, list(new_ids | {c.offer_id for c in current_inputs}), exclusive=False
    )
    quote = await _lock_quote(session, quote.id)
    if quote is None or _v(quote.state) not in LIVE_QUOTE_STATES:
        raise QuoteError(409, "only a submitted quote or one with a price request can be revised")
    _validate_offers_for_shop(
        actor, quote.vehicle_id, new_lines, [o for o in offers if o.id in new_ids]
    )

    previous_total = quote.total_amount
    for ln, _ in await quote_line_rows(session, quote.id):
        await session.delete(ln)
    await session.flush()  # deletes before inserts: (quote_id, offer_id) is unique
    for ln in new_lines:
        session.add(
            MarketplaceQuoteLine(
                quote_id=quote.id,
                offer_id=ln.offer_id,
                amount=Decimal(ln.amount).quantize(CENT) if ln.amount is not None else None,
                note=ln.note,
            )
        )
    quote.total_amount = amount
    quote.fee_rate = fee_rate()
    quote.fee_amount = compute_fee(amount)
    if reply_to_email:
        quote.reply_to_email = reply_to_email.strip().lower()
        actor.profile.quote_reply_email = quote.reply_to_email
        session.add(actor.profile)
    if notes is not None:
        quote.notes = notes
    quote.revision = (quote.revision or 1) + 1
    quote.state = QuoteState.SUBMITTED
    quote.submitted_at = utc_now()
    session.add(quote)
    await session.flush()
    await events.log(
        session,
        "quote_revised",
        actor_kind=actor.kind,
        actor_user_id=actor.user.id if actor.user else None,
        quote_id=quote.id,
        vehicle_id=quote.vehicle_id,
        shop_org_id=actor.org.id,
        details={
            "previous_total": str(previous_total),
            "total": str(amount),
            "revision": quote.revision,
        },
    )
    url = await review_link(session, dsp_id=quote.dsp_id, vehicle_id=quote.vehicle_id)
    await notifications.queue_quote_to_dsp(session, quote, review_url=url, is_revision=True)
    return quote


async def withdraw_quote(
    session: AsyncSession, actor: ShopActor, quote_id: int
) -> MarketplaceQuote:
    _require_quoter(actor)
    await _load_own_quote(session, actor, quote_id)
    quote = await _lock_quote(session, quote_id)
    if quote is None or _v(quote.state) not in LIVE_QUOTE_STATES:
        raise QuoteError(409, "only a live quote can be withdrawn")
    quote.state = QuoteState.WITHDRAWN
    quote.closed_reason = QuoteCloseReason.SHOP_WITHDREW.value
    quote.closed_at = utc_now()
    session.add(quote)
    await events.log(
        session,
        "quote_withdrawn",
        actor_kind=actor.kind,
        actor_user_id=actor.user.id if actor.user else None,
        quote_id=quote.id,
        vehicle_id=quote.vehicle_id,
        shop_org_id=actor.org.id,
    )
    await session.flush()
    return quote


# ─────────────────────────────────────────────────────────
# DSP side (token page)
# ─────────────────────────────────────────────────────────
async def _quote_for_token(
    session: AsyncSession, token: ApprovalToken, quote_id: int
) -> MarketplaceQuote:
    quote = (
        await session.execute(select(MarketplaceQuote).where(MarketplaceQuote.id == quote_id))
    ).scalar_one_or_none()
    if quote is None or quote.vehicle_id != token.vehicle_id or quote.dsp_id != token.dsp_id:
        raise QuoteError(404, "quote not found for this van")
    return quote


def _decide(quote: MarketplaceQuote, token: ApprovalToken, decision: str, note: str | None) -> None:
    quote.decision = decision
    quote.decision_note = note
    quote.decided_at = utc_now()
    quote.decided_via_token_id = token.id


@dataclass
class ApprovalResult:
    quote: MarketplaceQuote
    work_ref: str | None
    not_selected: list[MarketplaceQuote]
    shop: Organization
    dsp: Organization


async def approve_quote(
    session: AsyncSession,
    token: ApprovalToken,
    quote_id: int,
    *,
    note: str | None,
    expected_revision: int | None = None,
) -> ApprovalResult:
    quote = await _quote_for_token(session, token, quote_id)
    offer_ids = [ln.offer_id for ln, _ in await quote_line_rows(session, quote.id)]

    offers = await _lock_offers(session, offer_ids, exclusive=True)
    quote = await _lock_quote(session, quote.id)
    # Lines may have changed between the read and the lock (a revise
    # committed in between) — insist on the set we actually locked.
    locked_lines = await quote_line_rows(session, quote.id)
    if {ln.offer_id for ln, _ in locked_lines} != {o.id for o in offers}:
        raise QuoteError(409, "the shop just revised this quote — reload to see the new price")
    if expected_revision is not None and quote.revision != expected_revision:
        raise QuoteError(409, "the shop just revised this quote — reload to see the new price")
    if _v(quote.state) != QuoteState.SUBMITTED.value:
        raise QuoteError(
            409, f"this quote is {_v(quote.state).replace('_', ' ')} and cannot be approved"
        )
    taken = [o for o in offers if _v(o.state) != OfferState.OPEN.value]
    if taken:
        raise QuoteError(
            409,
            "another quote covering these repairs was already approved"
            if any(_v(o.state) == OfferState.AWARDED.value for o in taken)
            else "some of these repairs are no longer open",
        )

    now = utc_now()
    for o in offers:
        o.state = OfferState.AWARDED
        o.awarded_quote_id = quote.id
        o.awarded_at = now
        session.add(o)
    quote.state = QuoteState.APPROVED
    quote.fee_status = FeeStatus.OWED
    _decide(quote, token, QuoteState.APPROVED.value, note)
    session.add(quote)
    await session.flush()

    not_selected = await close_live_quotes_for_offers(
        session,
        offer_ids,
        new_state=QuoteState.NOT_SELECTED,
        reason=QuoteCloseReason.OTHER_QUOTE_APPROVED,
        exclude_quote_id=quote.id,
        note=f"{quote.id_str} was approved for overlapping repairs.",
    )

    shop = (
        await session.execute(select(Organization).where(Organization.id == quote.shop_org_id))
    ).scalar_one()
    dsp = (
        await session.execute(select(Organization).where(Organization.id == quote.dsp_id))
    ).scalar_one()
    lines = [(ln.amount, of) for ln, of in locked_lines]
    work_ref = await create_work_for_award(session, quote, shop, lines)

    await events.log(
        session,
        "quote_approved",
        actor_kind=events.ACTOR_DSP_TOKEN,
        quote_id=quote.id,
        vehicle_id=quote.vehicle_id,
        shop_org_id=quote.shop_org_id,
        note=note,
        details={
            "total": str(quote.total_amount),
            "fee_amount": str(quote.fee_amount),
            "fee_status": FeeStatus.OWED.value,
            "work": work_ref,
            "not_selected": [q.id for q in not_selected],
            "token_id": token.id,
        },
    )
    for o in offers:
        await events.log(
            session,
            "offer_awarded",
            actor_kind=events.ACTOR_DSP_TOKEN,
            offer_id=o.id,
            quote_id=quote.id,
            vehicle_id=o.vehicle_id,
            shop_org_id=quote.shop_org_id,
        )
    await session.flush()
    await notifications.queue_quote_approved(session, quote, dsp=dsp, work_ref=work_ref)
    for q in not_selected:
        await notifications.queue_quote_not_selected(session, q)
    await mark_exhausted_if_done(session, token)
    return ApprovalResult(
        quote=quote, work_ref=work_ref, not_selected=not_selected, shop=shop, dsp=dsp
    )


async def reject_quote(
    session: AsyncSession, token: ApprovalToken, quote_id: int, *, reason: str
) -> MarketplaceQuote:
    await _quote_for_token(session, token, quote_id)
    quote = await _lock_quote(session, quote_id)
    if _v(quote.state) not in LIVE_QUOTE_STATES:
        raise QuoteError(
            409, f"this quote is {_v(quote.state).replace('_', ' ')} and cannot be rejected"
        )
    quote.state = QuoteState.REJECTED
    _decide(quote, token, QuoteState.REJECTED.value, reason)
    session.add(quote)
    await events.log(
        session,
        "quote_rejected",
        actor_kind=events.ACTOR_DSP_TOKEN,
        quote_id=quote.id,
        vehicle_id=quote.vehicle_id,
        shop_org_id=quote.shop_org_id,
        note=reason,
        details={"token_id": token.id},
    )
    await session.flush()
    await notifications.queue_quote_rejected(session, quote)
    return quote


async def request_revision(
    session: AsyncSession, token: ApprovalToken, quote_id: int, *, note: str
) -> MarketplaceQuote:
    await _quote_for_token(session, token, quote_id)
    quote = await _lock_quote(session, quote_id)
    if _v(quote.state) != QuoteState.SUBMITTED.value:
        raise QuoteError(
            409,
            f"this quote is {_v(quote.state).replace('_', ' ')} — a lower price can only be "
            "requested on a submitted quote",
        )
    quote.state = QuoteState.REVISION_REQUESTED
    _decide(quote, token, QuoteState.REVISION_REQUESTED.value, note)
    session.add(quote)
    await events.log(
        session,
        "revision_requested",
        actor_kind=events.ACTOR_DSP_TOKEN,
        quote_id=quote.id,
        vehicle_id=quote.vehicle_id,
        shop_org_id=quote.shop_org_id,
        note=note,
        details={"token_id": token.id},
    )
    await session.flush()
    await notifications.queue_revision_requested(session, quote)
    return quote
