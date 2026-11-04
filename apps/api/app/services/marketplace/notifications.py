"""Marketplace email — rendering + post-commit delivery (spec §9).

| Email                    | From                          | To        | Reply-To          |
|--------------------------|-------------------------------|-----------|-------------------|
| Digest, decision notices | DFS mailbox                   | Shop      | DFS mailbox       |
| New / revised quote      | DFS mailbox, "<Shop> via DFS" | DSP owner | shop's chosen one |

Request-path emails are QUEUED on the session (`session.info`) and sent
only after the transaction commits (SQLAlchemy `after_commit`), in a
worker thread so SMTP latency never blocks a request. A rollback drops
the queue — no email for a decision that did not persist. The daily
digest is a batch job and sends synchronously (see digest.py).
"""

from __future__ import annotations

import html
import logging
import threading
from decimal import Decimal

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlmodel import select

from app.defect_labels import PART_LABELS, POSITION_LABELS, TYPE_LABELS
from app.models.invitation import Invitation
from app.models.marketplace import (
    MarketplaceOffer,
    MarketplaceQuote,
    MarketplaceQuoteLine,
    OfferWithdrawReason,
)
from app.models.organization import Organization
from app.models.user import User, UserRole, UserStatus
from app.models.vehicle import Vehicle
from app.services import email as email_service
from app.services.email import EmailMessage
from app.settings import get_settings

log = logging.getLogger(__name__)

_OUTBOX_KEY = "marketplace_outbox"


# ─────────────────────────────────────────────────────────
# Outbox (send after commit)
# ─────────────────────────────────────────────────────────
def queue(session: AsyncSession, msg: EmailMessage) -> None:
    if not msg.to:
        return
    session.info.setdefault(_OUTBOX_KEY, []).append(msg)


def dispatch(messages: list[EmailMessage]) -> None:
    """Deliver queued messages. Tests replace this with a capture."""

    def _run() -> None:
        for m in messages:
            try:
                email_service.send(m)
            except Exception:  # noqa: BLE001 — never raise out of delivery
                log.exception("marketplace email failed", extra={"to": m.to})

    # Non-daemon: a CLI process (bundle-route-cron) waits for delivery
    # before exiting instead of killing the thread mid-SMTP.
    threading.Thread(target=_run, name="marketplace-email", daemon=False).start()


@event.listens_for(Session, "after_commit")
def _flush_outbox_after_commit(session: Session) -> None:
    messages = session.info.pop(_OUTBOX_KEY, None)
    if messages:
        dispatch(list(messages))


@event.listens_for(Session, "after_rollback")
def _drop_outbox_after_rollback(session: Session) -> None:
    session.info.pop(_OUTBOX_KEY, None)


# ─────────────────────────────────────────────────────────
# Formatting helpers
# ─────────────────────────────────────────────────────────
def money(amount: Decimal | float | int | None) -> str:
    return f"${Decimal(amount or 0):,.2f}"


def _label(table: dict, value: str | None) -> str:
    if not value:
        return ""
    for k, meta in table.items():
        if (k.value if hasattr(k, "value") else str(k)) == value:
            return meta.get("label") or value
    return value.replace("_", " ").capitalize()


def offer_label(offer: MarketplaceOffer) -> str:
    part = _label(PART_LABELS, offer.part)
    typ = _label(TYPE_LABELS, offer.defect_type).lower()
    pos = _label(POSITION_LABELS, offer.position)
    return f"{part}{f' ({pos})' if pos else ''} — {typ}"


def vehicle_label(v: Vehicle) -> str:
    return f"{v.year} {v.make} {v.model}"


def _e(s: object) -> str:
    return html.escape(str(s or ""))


def _dfs_sender() -> dict:
    s = get_settings()
    return {
        "from_name": s.marketplace_from_name,
        "from_address": s.marketplace_from_email or None,
        "reply_to": s.marketplace_reply_to or None,
    }


def _wrap_html(title: str, body: str) -> str:
    return f"""<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
                   color:#1f2937; max-width:600px; margin:32px auto; padding:0 16px;">
  <h2 style="color:#0f172a; margin:0 0 12px;">{_e(title)}</h2>
  {body}
  <p style="font-size:12px; color:#64748b; margin-top:32px;">
    DFS Repair Marketplace · Dantzig Fleet Solutions
  </p>
</body></html>"""


def _button(label: str, url: str, color: str = "#2563eb") -> str:
    return (
        f'<a href="{_e(url)}" style="display:inline-block; background:{color}; color:#fff; '
        f"text-decoration:none; padding:10px 16px; border-radius:8px; font-weight:600; "
        f'margin:0 8px 8px 0;">{_e(label)}</a>'
    )


async def _quote_context(
    session: AsyncSession, quote: MarketplaceQuote
) -> tuple[Vehicle, Organization, list[tuple[MarketplaceQuoteLine, MarketplaceOffer]]]:
    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == quote.vehicle_id))
    ).scalar_one()
    shop = (
        await session.execute(select(Organization).where(Organization.id == quote.shop_org_id))
    ).scalar_one()
    lines = (
        await session.execute(
            select(MarketplaceQuoteLine, MarketplaceOffer)
            .join(MarketplaceOffer, MarketplaceOffer.id == MarketplaceQuoteLine.offer_id)
            .where(MarketplaceQuoteLine.quote_id == quote.id)
            .order_by(MarketplaceQuoteLine.id)
        )
    ).all()
    return vehicle, shop, [(ln, of) for ln, of in lines]


def _lines_text(lines) -> str:
    out = []
    for ln, of in lines:
        amt = f" — {money(ln.amount)}" if ln.amount is not None else ""
        out.append(f"  • {offer_label(of)}{amt}")
    return "\n".join(out)


def _lines_html(lines) -> str:
    items = "".join(
        f"<li>{_e(offer_label(of))}"
        f"{' — ' + _e(money(ln.amount)) if ln.amount is not None else ''}</li>"
        for ln, of in lines
    )
    return f'<ul style="margin:8px 0 16px; padding-left:20px;">{items}</ul>'


# ─────────────────────────────────────────────────────────
# DSP — new / revised quote
# ─────────────────────────────────────────────────────────
async def dsp_owner_emails(session: AsyncSession, dsp_id: int) -> list[str]:
    return list(
        (
            await session.execute(
                select(User.email)
                .where(User.organization_id == dsp_id)
                .where(User.role == UserRole.DSP_OWNER)
                .where(User.status == UserStatus.ACTIVE)
                .order_by(User.id)
            )
        )
        .scalars()
        .all()
    )


def review_action_url(review_url: str, quote: MarketplaceQuote, action: str) -> str:
    return f"{review_url}&quote={quote.id_str}&action={action}"


def render_dsp_quote_email(
    *,
    to: str,
    quote: MarketplaceQuote,
    shop_name: str,
    vehicle: Vehicle,
    lines,
    review_url: str,
    is_revision: bool,
) -> EmailMessage:
    """The quote email to the DSP owner. From "<Shop> via DFS", Reply-To the
    shop's chosen email, four buttons that all open the token page."""
    s = get_settings()
    van = f"{vehicle_label(vehicle)} · {vehicle.fleet_id} · VIN {vehicle.vin}"
    verb = "sent a revised quote" if is_revision else "sent a quote"
    subject = (
        f"{'Revised quote' if is_revision else 'New quote'}: {money(quote.total_amount)} "
        f"for van {vehicle.fleet_id} — {shop_name}"
    )
    urls = {
        a: review_action_url(review_url, quote, a)
        for a in ("approve", "reject", "revise", "compare")
    }
    notes = f"\nShop notes: {quote.notes}\n" if quote.notes else ""
    text = (
        f"{shop_name} {verb} for your van {van}.\n\n"
        f"Total: {money(quote.total_amount)}\n"
        f"{_lines_text(lines)}\n{notes}\n"
        f"Approve this quote:  {urls['approve']}\n"
        f"Reject (reason):     {urls['reject']}\n"
        f"Ask for lower price: {urls['revise']}\n"
        f"Compare all quotes for this van: {urls['compare']}\n\n"
        "Please use the buttons above to decide — replies to this email go "
        f"straight to {shop_name} and are not tracked by DFS.\n"
        "You pay the shop directly. Nothing is charged to you by DFS.\n"
    )
    notes_html = (
        f'<p style="margin:0 0 12px;"><strong>Shop notes:</strong> {_e(quote.notes)}</p>'
        if quote.notes
        else ""
    )
    body = f"""
  <p style="margin:0 0 8px;"><strong>{_e(shop_name)}</strong> {_e(verb)} for your van
     <strong>{_e(van)}</strong>.</p>
  <p style="font-size:22px; font-weight:700; margin:12px 0 4px;">{_e(money(quote.total_amount))}</p>
  {_lines_html(lines)}
  {notes_html}
  <p style="margin:16px 0 8px;">
    {_button("Approve this quote", urls["approve"], "#16a34a")}
    {_button("Reject", urls["reject"], "#dc2626")}
    {_button("Ask for lower price", urls["revise"], "#d97706")}
    {_button("Compare all quotes for this van", urls["compare"])}
  </p>
  <p style="font-size:13px; color:#475569;">
    Please decide with the buttons. Replying to this email reaches {_e(shop_name)}
    directly, but DFS does not track replies. You pay the shop directly.
  </p>"""
    return EmailMessage(
        to=to,
        subject=subject,
        text=text,
        html=_wrap_html(f"Quote from {shop_name}", body),
        from_name=f"{shop_name} via DFS",
        from_address=s.marketplace_from_email or None,
        reply_to=quote.reply_to_email,
    )


async def queue_quote_to_dsp(
    session: AsyncSession,
    quote: MarketplaceQuote,
    *,
    review_url: str,
    is_revision: bool,
) -> int:
    vehicle, shop, lines = await _quote_context(session, quote)
    recipients = await dsp_owner_emails(session, quote.dsp_id)
    for to in recipients:
        queue(
            session,
            render_dsp_quote_email(
                to=to,
                quote=quote,
                shop_name=shop.name,
                vehicle=vehicle,
                lines=lines,
                review_url=review_url,
                is_revision=is_revision,
            ),
        )
    return len(recipients)


# ─────────────────────────────────────────────────────────
# Shop — decision notices
# ─────────────────────────────────────────────────────────
async def _shop_recipients(session: AsyncSession, quote: MarketplaceQuote) -> list[str]:
    from app.services.marketplace.shops import ensure_shop_profile, shop_recipients

    shop = (
        await session.execute(select(Organization).where(Organization.id == quote.shop_org_id))
    ).scalar_one()
    profile = await ensure_shop_profile(session, shop)
    emails = await shop_recipients(session, profile)
    if quote.reply_to_email and quote.reply_to_email.lower() not in {e.lower() for e in emails}:
        emails.append(quote.reply_to_email)
    return emails


async def queue_shop_notice(
    session: AsyncSession,
    quote: MarketplaceQuote,
    *,
    subject: str,
    intro: str,
    detail: str | None = None,
    extra_html: str = "",
) -> None:
    from app.services.marketplace.shops import board_url

    vehicle, _shop, lines = await _quote_context(session, quote)
    van = f"{vehicle_label(vehicle)} · VIN {vehicle.vin}"
    detail_text = f"\n{detail}\n" if detail else ""
    text = (
        f"{intro}\n\nQuote {quote.id_str} — {van}\nTotal: {money(quote.total_amount)}\n"
        f"{_lines_text(lines)}\n{detail_text}\nOpen your marketplace board: {board_url()}\n"
    )
    detail_html = (
        f'<p style="margin:0 0 12px; padding:10px 12px; background:#f1f5f9; border-radius:8px;">'
        f"{_e(detail)}</p>"
        if detail
        else ""
    )
    body = f"""
  <p style="margin:0 0 12px;">{_e(intro)}</p>
  <p style="margin:0 0 4px;"><strong>Quote {_e(quote.id_str)}</strong> — {_e(van)}</p>
  <p style="margin:0 0 4px;">Total: <strong>{_e(money(quote.total_amount))}</strong></p>
  {_lines_html(lines)}
  {detail_html}
  {extra_html}
  <p>{_button("Open the marketplace board", board_url())}</p>"""
    for to in await _shop_recipients(session, quote):
        queue(
            session,
            EmailMessage(
                to=to,
                subject=subject,
                text=text,
                html=_wrap_html(subject, body),
                **_dfs_sender(),
            ),
        )


async def queue_quote_approved(
    session: AsyncSession, quote: MarketplaceQuote, *, dsp: Organization, work_ref: str | None
) -> None:
    contact = f"{dsp.name}" + (f" · {dsp.phone}" if dsp.phone else "")
    work = f" It is on your Nova Fora queue as {work_ref}." if work_ref else ""
    await queue_shop_notice(
        session,
        quote,
        subject=f"Approved: quote {quote.id_str} — {money(quote.total_amount)}",
        intro=(
            "Good news — the fleet owner approved your quote. Please contact them "
            f"to schedule the repair.{work}"
        ),
        detail=(
            f"Customer: {contact}. The customer pays you directly. "
            f"DFS coordination fee owed: {money(quote.fee_amount)} "
            f"({Decimal(quote.fee_rate) * 100:.0f}%)."
            + (f" Note from the customer: {quote.decision_note}" if quote.decision_note else "")
        ),
    )


async def queue_quote_rejected(session: AsyncSession, quote: MarketplaceQuote) -> None:
    await queue_shop_notice(
        session,
        quote,
        subject=f"Quote {quote.id_str} was not accepted",
        intro=(
            "The fleet owner rejected this quote. While the defects are still open "
            "you can send a new quote from your board."
        ),
        detail=f"Reason: {quote.decision_note}" if quote.decision_note else None,
    )


async def queue_revision_requested(session: AsyncSession, quote: MarketplaceQuote) -> None:
    await queue_shop_notice(
        session,
        quote,
        subject=f"Lower price requested: quote {quote.id_str}",
        intro=(
            "The fleet owner asked whether you can lower your price. Revise the "
            "quote from your board — only you can change the price."
        ),
        detail=f"Note from the customer: {quote.decision_note}" if quote.decision_note else None,
    )


async def queue_quote_not_selected(session: AsyncSession, quote: MarketplaceQuote) -> None:
    await queue_shop_notice(
        session,
        quote,
        subject=f"Quote {quote.id_str} was not selected",
        intro=(
            "The fleet owner approved another shop's quote for some of these defects. "
            "Defects that are still open stay on your board if you want to quote them again."
        ),
    )


async def queue_quote_closed(
    session: AsyncSession, quote: MarketplaceQuote, *, reason: OfferWithdrawReason
) -> None:
    await queue_shop_notice(
        session,
        quote,
        subject=f"Quote {quote.id_str} closed — defect no longer available",
        intro=(
            "One or more defects on this quote are no longer on the marketplace "
            "(they were routed to a repair order or removed), so the quote was closed."
        ),
        detail=f"Reason: {reason.value.replace('_', ' ')}",
    )


# ─────────────────────────────────────────────────────────
# Prospect invitation (existing invitation flow)
# ─────────────────────────────────────────────────────────
def queue_invitation(
    session: AsyncSession, inv: Invitation, *, org: Organization, accept_url: str
) -> None:
    msg = email_service.render_invitation_email(
        invitee_name=inv.full_name,
        inviter_name="DFS Repair Marketplace",
        org_label=org.name,
        role_label="Vendor Admin",
        accept_url=accept_url,
        expires_in_days=get_settings().invitation_ttl_days,
        lang="en",
    )
    msg.to = inv.email
    sender = _dfs_sender()
    msg.from_name = sender["from_name"]
    msg.from_address = sender["from_address"]
    msg.reply_to = sender["reply_to"]
    queue(session, msg)
