"""DFS CMR repair marketplace — shop board, DSP review page, admin.

Shop endpoints (registered shop user via Bearer JWT, OR prospect via the
`X-Marketplace-Invite` magic-link header):
  GET  /marketplace/shop/me
  PATCH /marketplace/shop/me
  GET  /marketplace/board                     open offers, my live quote per van
  GET  /marketplace/quotes                    my quotes (every state)
  POST /marketplace/quotes                    submit a per-van quote
  POST /marketplace/quotes/{id}/revise
  POST /marketplace/quotes/{id}/withdraw

DSP review page (public — `X-Review-Token` header from the email link):
  GET  /marketplace/review
  POST /marketplace/review/quotes/{id}/approve
  POST /marketplace/review/quotes/{id}/reject
  POST /marketplace/review/quotes/{id}/request-revision

Admin (site_admin): rules, offers, quotes, shop profiles, manual sync.

Tenancy: shops only ever see their own quotes, never another shop's
quote or price, and never the DSP's identity until their quote is
approved. The review token is scoped to exactly one (DSP, van).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.defect_labels import PART_LABELS, POSITION_LABELS, TYPE_LABELS
from app.models.marketplace import (
    LIVE_QUOTE_STATES,
    MarketplaceOffer,
    MarketplaceQuote,
    MarketplaceRule,
    MarketplaceShopProfile,
    MarketplaceSpecialty,
    OfferState,
)
from app.models.organization import Organization
from app.models.photo import Photo
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.services.marketplace import events
from app.services.marketplace import notifications as _notifications  # noqa: F401 — registers the after-commit email hook
from app.services.marketplace.eligibility import sync_offers
from app.services.marketplace.notifications import offer_label
from app.services.marketplace.quotes import (
    LineInput,
    ProspectOnboarding,
    QuoteError,
    approve_quote,
    quote_line_rows,
    reject_quote,
    request_revision,
    revise_quote,
    submit_quote,
    withdraw_quote,
)
from app.services.marketplace.review_tokens import TokenError, resolve_review_token
from app.services.marketplace.shops import (
    ShopActor,
    ensure_shop_profile,
    is_shop_org,
    resolve_magic_token,
)
from app.settings import get_settings

router = APIRouter(prefix="/marketplace", tags=["marketplace"])
_bearer = HTTPBearer(auto_error=False)


def _v(x) -> str:
    return x.value if hasattr(x, "value") else str(x)


def _parse_id(raw: str | int, prefix: str) -> int:
    """Accept 'MQ-00012' / 'MO-00007' / 'VAN-0001' or a bare int."""
    s = str(raw).strip()
    if s.upper().startswith(prefix + "-"):
        s = s[len(prefix) + 1 :]
    try:
        value = int(s)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{prefix} id not found") from None
    if value <= 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{prefix} id not found")
    return value


def _http(exc: QuoteError | TokenError) -> HTTPException:
    return HTTPException(exc.status_code, exc.detail)


async def _commit(session: AsyncSession) -> None:
    try:
        await session.commit()
    except DBAPIError as exc:  # deadlock / serialization — tell the client to retry
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "busy — please retry") from exc


# ─────────────────────────────────────────────────────
# Wire shapes
# ─────────────────────────────────────────────────────
def _label(table: dict, value: str | None) -> str | None:
    if not value:
        return None
    for k, meta in table.items():
        if _v(k) == value:
            return meta.get("label") or value
    return value.replace("_", " ").capitalize()


class PhotoOut(BaseModel):
    id: str
    url: str


class OfferOut(BaseModel):
    id: str
    part: str
    part_label: str | None
    position: str | None
    position_label: str | None
    defect_type: str
    defect_type_label: str | None
    label: str
    specialty: str
    notes: str | None
    reported_at: datetime | None
    state: str
    photos: list[PhotoOut] = []


class VehicleOut(BaseModel):
    id: str
    year: int
    make: str
    model: str
    vin: str
    vehicle_class: str
    # Revealed only to the DSP, or to the winning shop after approval.
    fleet_id: str | None = None
    plate: str | None = None


class QuoteLineOut(BaseModel):
    offer_id: str
    label: str
    amount: Decimal | None
    note: str | None


class DspRevealOut(BaseModel):
    name: str
    phone: str | None
    address: str | None


class ShopQuoteOut(BaseModel):
    """A quote as its OWN shop sees it. `dsp` is null until approved."""

    id: str
    vehicle: VehicleOut
    station: str | None
    state: str
    revision: int
    total_amount: Decimal
    fee_rate: Decimal
    fee_amount: Decimal
    shop_keeps: Decimal
    fee_status: str | None
    reply_to_email: str
    notes: str | None
    lines: list[QuoteLineOut]
    decision: str | None
    decision_note: str | None
    decided_at: datetime | None
    closed_reason: str | None
    submitted_at: datetime
    work_ref: str | None = None
    dsp: DspRevealOut | None = None


class BoardVanOut(BaseModel):
    vehicle: VehicleOut
    station: str | None
    offers: list[OfferOut]
    my_quote: ShopQuoteOut | None


class ShopProfileOut(BaseModel):
    organization_id: str
    name: str
    org_type: str
    specialties: list[str]
    onboarding_status: str
    contact_email: str | None
    quote_reply_email: str | None
    terms_accepted: bool
    terms_version: str
    terms_url: str | None
    fee_rate: Decimal
    is_prospect: bool
    can_quote: bool


class BoardOut(BaseModel):
    shop: ShopProfileOut
    vans: list[BoardVanOut]


async def _photos_for(session: AsyncSession, defect_ids: list[int]) -> dict[int, list[PhotoOut]]:
    if not defect_ids:
        return {}
    from app.storage import generate_download_url

    out: dict[int, list[PhotoOut]] = {}
    rows = (
        (
            await session.execute(
                select(Photo)
                .where(Photo.defect_id.in_(defect_ids))
                .where(Photo.is_deleted.is_(False))
                .order_by(Photo.id)
            )
        )
        .scalars()
        .all()
    )
    for p in rows:
        try:
            url = generate_download_url(p.storage_key)
        except Exception:  # noqa: BLE001 — storage misconfig shouldn't 500 the board
            continue
        out.setdefault(p.defect_id, []).append(PhotoOut(id=p.id_str, url=url))
    return out


def _offer_out(o: MarketplaceOffer, photos: dict[int, list[PhotoOut]]) -> OfferOut:
    return OfferOut(
        id=o.id_str,
        part=o.part,
        part_label=_label(PART_LABELS, o.part),
        position=o.position,
        position_label=_label(POSITION_LABELS, o.position),
        defect_type=o.defect_type,
        defect_type_label=_label(TYPE_LABELS, o.defect_type),
        label=offer_label(o),
        specialty=_v(o.specialty),
        notes=o.notes,
        reported_at=o.reported_at,
        state=_v(o.state),
        photos=photos.get(o.defect_id or 0, []),
    )


def _vehicle_out(v: Vehicle, *, reveal: bool) -> VehicleOut:
    return VehicleOut(
        id=v.id_str,
        year=v.year,
        make=v.make,
        model=v.model,
        vin=v.vin,
        vehicle_class=_v(v.vehicle_class),
        fleet_id=v.fleet_id if reveal else None,
        plate=v.plate if reveal else None,
    )


async def _shop_quote_out(
    session: AsyncSession, q: MarketplaceQuote, vehicle: Vehicle, station: str | None
) -> ShopQuoteOut:
    approved = _v(q.state) == "approved"
    lines = await quote_line_rows(session, q.id)
    dsp = None
    if approved:
        org = (
            await session.execute(select(Organization).where(Organization.id == q.dsp_id))
        ).scalar_one()
        dsp = DspRevealOut(name=org.name, phone=org.phone, address=org.address)
    work_ref = None
    if q.work_order_id:
        work_ref = f"WO-{q.work_order_id:05d}"
    elif q.body_repair_request_id:
        work_ref = f"BRR-{q.body_repair_request_id:05d}"
    return ShopQuoteOut(
        id=q.id_str,
        vehicle=_vehicle_out(vehicle, reveal=approved),
        station=station,
        state=_v(q.state),
        revision=q.revision,
        total_amount=q.total_amount,
        fee_rate=q.fee_rate,
        fee_amount=q.fee_amount,
        shop_keeps=Decimal(q.total_amount) - Decimal(q.fee_amount),
        fee_status=_v(q.fee_status) if q.fee_status else None,
        reply_to_email=q.reply_to_email,
        notes=q.notes,
        lines=[
            QuoteLineOut(offer_id=of.id_str, label=offer_label(of), amount=ln.amount, note=ln.note)
            for ln, of in lines
        ],
        decision=q.decision,
        decision_note=q.decision_note,
        decided_at=q.decided_at,
        closed_reason=q.closed_reason,
        submitted_at=q.submitted_at,
        work_ref=work_ref if approved else None,
        dsp=dsp,
    )


# ─────────────────────────────────────────────────────
# Shop auth
# ─────────────────────────────────────────────────────
async def get_shop_actor(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    x_marketplace_invite: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> ShopActor:
    if credentials is not None:
        user = await get_current_user(request, credentials, session)
        org = (
            await session.execute(
                select(Organization).where(Organization.id == user.organization_id)
            )
        ).scalar_one_or_none()
        if not is_shop_org(org):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "the marketplace board is for repair shops"
            )
        profile = await ensure_shop_profile(session, org)
        if not profile.is_active:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "this shop is not active on the marketplace"
            )
        return ShopActor(org=org, profile=profile, user=user)
    if x_marketplace_invite:
        resolved = await resolve_magic_token(session, x_marketplace_invite)
        if resolved is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "this board link expired or your shop already has an account — please log in",
            )
        org, profile = resolved
        return ShopActor(org=org, profile=profile, user=None)
    raise HTTPException(
        status.HTTP_401_UNAUTHORIZED, "missing credentials", headers={"WWW-Authenticate": "Bearer"}
    )


def _profile_out(actor: ShopActor) -> ShopProfileOut:
    s = get_settings()
    p = actor.profile
    return ShopProfileOut(
        organization_id=actor.org.id_str,
        name=actor.org.name,
        org_type=_v(actor.org.org_type),
        specialties=list(p.specialties or []),
        onboarding_status=_v(p.onboarding_status),
        contact_email=p.contact_email,
        quote_reply_email=p.quote_reply_email
        or (actor.user.email if actor.user else p.contact_email),
        terms_accepted=p.terms_accepted_at is not None,
        terms_version=s.marketplace_terms_version,
        terms_url=s.marketplace_terms_url or None,
        fee_rate=Decimal(str(s.marketplace_fee_rate)),
        is_prospect=actor.user is None,
        can_quote=actor.can_quote,
    )


@router.get("/shop/me", response_model=ShopProfileOut)
async def shop_me(
    actor: ShopActor = Depends(get_shop_actor),
    session: AsyncSession = Depends(get_session),
) -> ShopProfileOut:
    out = _profile_out(actor)
    await session.commit()  # persists a lazily-created profile
    return out


class ShopProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contact_email: EmailStr | None = None
    quote_reply_email: EmailStr | None = None


@router.patch("/shop/me", response_model=ShopProfileOut)
async def update_shop_me(
    body: ShopProfilePatch,
    actor: ShopActor = Depends(get_shop_actor),
    session: AsyncSession = Depends(get_session),
) -> ShopProfileOut:
    if actor.user is not None and _v(actor.user.role) != UserRole.VENDOR_ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the shop admin can edit the profile")
    if body.contact_email is not None:
        actor.profile.contact_email = str(body.contact_email).lower()
    if body.quote_reply_email is not None:
        actor.profile.quote_reply_email = str(body.quote_reply_email).lower()
    session.add(actor.profile)
    await session.commit()
    return _profile_out(actor)


@router.get("/board", response_model=BoardOut)
async def board(
    actor: ShopActor = Depends(get_shop_actor),
    session: AsyncSession = Depends(get_session),
) -> BoardOut:
    specialties = list(actor.profile.specialties or [])
    offers = list(
        (
            await session.execute(
                select(MarketplaceOffer)
                .where(MarketplaceOffer.state == OfferState.OPEN)
                .where(MarketplaceOffer.specialty.in_(specialties or ["__none__"]))
                .order_by(MarketplaceOffer.vehicle_id, MarketplaceOffer.id)
            )
        )
        .scalars()
        .all()
    )
    vehicle_ids = {o.vehicle_id for o in offers}
    vehicles = {
        v.id: v
        for v in (await session.execute(select(Vehicle).where(Vehicle.id.in_(vehicle_ids or {0}))))
        .scalars()
        .all()
    }
    my_live = {
        q.vehicle_id: q
        for q in (
            await session.execute(
                select(MarketplaceQuote)
                .where(MarketplaceQuote.shop_org_id == actor.org.id)
                .where(MarketplaceQuote.state.in_(LIVE_QUOTE_STATES))
            )
        )
        .scalars()
        .all()
    }
    photos = await _photos_for(session, [o.defect_id for o in offers if o.defect_id])
    vans: dict[int, BoardVanOut] = {}
    for o in offers:
        v = vehicles.get(o.vehicle_id)
        if v is None:
            continue
        if o.vehicle_id not in vans:
            mq = my_live.get(o.vehicle_id)
            vans[o.vehicle_id] = BoardVanOut(
                vehicle=_vehicle_out(v, reveal=False),
                station=o.station,
                offers=[],
                my_quote=await _shop_quote_out(session, mq, v, o.station) if mq else None,
            )
        vans[o.vehicle_id].offers.append(_offer_out(o, photos))
    out = BoardOut(shop=_profile_out(actor), vans=list(vans.values()))
    await session.commit()
    return out


@router.get("/quotes", response_model=list[ShopQuoteOut])
async def my_quotes(
    state: str | None = Query(default=None, max_length=30),
    actor: ShopActor = Depends(get_shop_actor),
    session: AsyncSession = Depends(get_session),
) -> list[ShopQuoteOut]:
    stmt = (
        select(MarketplaceQuote, Vehicle)
        .join(Vehicle, Vehicle.id == MarketplaceQuote.vehicle_id)
        .where(MarketplaceQuote.shop_org_id == actor.org.id)
        .order_by(MarketplaceQuote.updated_at.desc())
        .limit(200)
    )
    if state:
        stmt = stmt.where(MarketplaceQuote.state == state)
    rows = (await session.execute(stmt)).all()
    return [await _shop_quote_out(session, q, v, None) for q, v in rows]


class QuoteLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    offer_id: str | int
    amount: Decimal | None = Field(default=None, gt=0, le=100000, decimal_places=2)
    note: str | None = Field(default=None, max_length=500)


class QuoteSubmitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vehicle_id: str | int
    lines: list[QuoteLineIn] = Field(..., min_length=1, max_length=50)
    total: Decimal | None = Field(default=None, gt=0, le=100000, decimal_places=2)
    reply_to_email: EmailStr | None = None
    notes: str | None = Field(default=None, max_length=2000)
    # Prospect onboarding (first quote only — spec §8).
    account_email: EmailStr | None = None
    account_name: str | None = Field(default=None, min_length=1, max_length=200)
    accept_terms: bool = False


class QuoteReviseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lines: list[QuoteLineIn] | None = Field(default=None, min_length=1, max_length=50)
    total: Decimal | None = Field(default=None, gt=0, le=100000, decimal_places=2)
    reply_to_email: EmailStr | None = None
    notes: str | None = Field(default=None, max_length=2000)


def _lines_in(lines: list[QuoteLineIn]) -> list[LineInput]:
    return [
        LineInput(offer_id=_parse_id(ln.offer_id, "MO"), amount=ln.amount, note=ln.note)
        for ln in lines
    ]


async def _quote_response(session: AsyncSession, q: MarketplaceQuote) -> ShopQuoteOut:
    v = (await session.execute(select(Vehicle).where(Vehicle.id == q.vehicle_id))).scalar_one()
    station = (
        await session.execute(
            select(MarketplaceOffer.station)
            .where(MarketplaceOffer.vehicle_id == q.vehicle_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    return await _shop_quote_out(session, q, v, station)


@router.post("/quotes", response_model=ShopQuoteOut, status_code=status.HTTP_201_CREATED)
async def create_quote(
    body: QuoteSubmitIn,
    actor: ShopActor = Depends(get_shop_actor),
    session: AsyncSession = Depends(get_session),
) -> ShopQuoteOut:
    reply_to = (
        str(body.reply_to_email)
        if body.reply_to_email
        else (
            actor.profile.quote_reply_email
            or (actor.user.email if actor.user else actor.profile.contact_email)
        )
    )
    if not reply_to:
        raise HTTPException(422, "reply_to_email is required")
    onboarding = None
    if actor.user is None and actor.profile.terms_accepted_at is None:
        email = str(body.account_email) if body.account_email else actor.profile.contact_email
        if not (email and body.account_name and body.accept_terms):
            raise HTTPException(
                422,
                "confirm your email, enter your name and accept the DFS Repair Partner "
                "terms to send your first quote",
            )
        onboarding = ProspectOnboarding(
            email=email, full_name=body.account_name, accept_terms=body.accept_terms
        )
    try:
        quote = await submit_quote(
            session,
            actor,
            vehicle_id=_parse_id(body.vehicle_id, "VAN"),
            lines=_lines_in(body.lines),
            total=body.total,
            reply_to_email=reply_to,
            notes=body.notes,
            onboarding=onboarding,
        )
    except QuoteError as exc:
        raise _http(exc) from exc
    out = await _quote_response(session, quote)
    await _commit(session)
    return out


@router.post("/quotes/{quote_id}/revise", response_model=ShopQuoteOut)
async def revise(
    body: QuoteReviseIn,
    quote_id: str = Path(..., max_length=20),
    actor: ShopActor = Depends(get_shop_actor),
    session: AsyncSession = Depends(get_session),
) -> ShopQuoteOut:
    try:
        quote = await revise_quote(
            session,
            actor,
            _parse_id(quote_id, "MQ"),
            lines=_lines_in(body.lines) if body.lines is not None else None,
            total=body.total,
            reply_to_email=str(body.reply_to_email) if body.reply_to_email else None,
            notes=body.notes,
        )
    except QuoteError as exc:
        raise _http(exc) from exc
    out = await _quote_response(session, quote)
    await _commit(session)
    return out


@router.post("/quotes/{quote_id}/withdraw", response_model=ShopQuoteOut)
async def withdraw(
    quote_id: str = Path(..., max_length=20),
    actor: ShopActor = Depends(get_shop_actor),
    session: AsyncSession = Depends(get_session),
) -> ShopQuoteOut:
    try:
        quote = await withdraw_quote(session, actor, _parse_id(quote_id, "MQ"))
    except QuoteError as exc:
        raise _http(exc) from exc
    out = await _quote_response(session, quote)
    await _commit(session)
    return out


# ─────────────────────────────────────────────────────
# DSP review page (public, token-scoped)
# ─────────────────────────────────────────────────────
class ReviewQuoteOut(BaseModel):
    id: str
    shop_name: str
    state: str
    revision: int
    total_amount: Decimal
    reply_to_email: str
    notes: str | None
    lines: list[QuoteLineOut]
    submitted_at: datetime
    decision: str | None
    decision_note: str | None
    decided_at: datetime | None
    closed_reason: str | None


class ReviewOut(BaseModel):
    vehicle: VehicleOut
    dsp_name: str
    offers: list[OfferOut]
    live_quotes: list[ReviewQuoteOut]
    other_quotes: list[ReviewQuoteOut]


async def _review_payload(session: AsyncSession, vehicle_id: int, dsp_id: int) -> ReviewOut:
    vehicle = (await session.execute(select(Vehicle).where(Vehicle.id == vehicle_id))).scalar_one()
    dsp = (
        await session.execute(select(Organization).where(Organization.id == dsp_id))
    ).scalar_one()
    offers = list(
        (
            await session.execute(
                select(MarketplaceOffer)
                .where(MarketplaceOffer.vehicle_id == vehicle_id)
                .where(MarketplaceOffer.dsp_id == dsp_id)
                .where(
                    MarketplaceOffer.state.in_([OfferState.OPEN.value, OfferState.AWARDED.value])
                )
                .order_by(MarketplaceOffer.id)
            )
        )
        .scalars()
        .all()
    )
    photos = await _photos_for(session, [o.defect_id for o in offers if o.defect_id])
    rows = (
        await session.execute(
            select(MarketplaceQuote, Organization)
            .join(Organization, Organization.id == MarketplaceQuote.shop_org_id)
            .where(MarketplaceQuote.vehicle_id == vehicle_id)
            .where(MarketplaceQuote.dsp_id == dsp_id)
            .order_by(MarketplaceQuote.total_amount, MarketplaceQuote.id)
        )
    ).all()
    live, other = [], []
    for q, shop in rows:
        lines = await quote_line_rows(session, q.id)
        item = ReviewQuoteOut(
            id=q.id_str,
            shop_name=shop.name,
            state=_v(q.state),
            revision=q.revision,
            total_amount=q.total_amount,
            reply_to_email=q.reply_to_email,
            notes=q.notes,
            lines=[
                QuoteLineOut(
                    offer_id=of.id_str, label=offer_label(of), amount=ln.amount, note=ln.note
                )
                for ln, of in lines
            ],
            submitted_at=q.submitted_at,
            decision=q.decision,
            decision_note=q.decision_note,
            decided_at=q.decided_at,
            closed_reason=q.closed_reason,
        )
        (live if q.is_live else other).append(item)
    return ReviewOut(
        vehicle=_vehicle_out(vehicle, reveal=True),
        dsp_name=dsp.name,
        offers=[_offer_out(o, photos) for o in offers],
        live_quotes=live,
        other_quotes=other,
    )


@router.get("/review", response_model=ReviewOut)
async def review_page(
    x_review_token: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> ReviewOut:
    try:
        token = await resolve_review_token(session, x_review_token)
    except TokenError as exc:
        raise _http(exc) from exc
    out = await _review_payload(session, token.vehicle_id, token.dsp_id)
    await session.commit()
    return out


class ApproveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str | None = Field(default=None, max_length=2000)
    expected_revision: int | None = Field(default=None, ge=1)


class RejectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., min_length=1, max_length=2000)


class RevisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str = Field(..., min_length=1, max_length=2000)


class DecisionOut(BaseModel):
    quote_id: str
    state: str
    work_ref: str | None = None
    review: ReviewOut | None = None
    token_used_up: bool = False


async def _after_decision(
    session: AsyncSession, token, quote: MarketplaceQuote, work_ref: str | None = None
) -> DecisionOut:
    used_up = token.exhausted_at is not None
    review = None if used_up else await _review_payload(session, token.vehicle_id, token.dsp_id)
    await _commit(session)
    return DecisionOut(
        quote_id=quote.id_str,
        state=_v(quote.state),
        work_ref=work_ref,
        review=review,
        token_used_up=used_up,
    )


@router.post("/review/quotes/{quote_id}/approve", response_model=DecisionOut)
async def review_approve(
    body: ApproveIn,
    quote_id: str = Path(..., max_length=20),
    x_review_token: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> DecisionOut:
    try:
        # No FOR UPDATE on the token: the offer row locks serialize approvals,
        # and locking the token first would invert the offers → token order
        # that submit/revise use (deadlock).
        token = await resolve_review_token(session, x_review_token)
        result = await approve_quote(
            session,
            token,
            _parse_id(quote_id, "MQ"),
            note=body.note,
            expected_revision=body.expected_revision,
        )
    except (QuoteError, TokenError) as exc:
        raise _http(exc) from exc
    return await _after_decision(session, token, result.quote, result.work_ref)


@router.post("/review/quotes/{quote_id}/reject", response_model=DecisionOut)
async def review_reject(
    body: RejectIn,
    quote_id: str = Path(..., max_length=20),
    x_review_token: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> DecisionOut:
    try:
        token = await resolve_review_token(session, x_review_token)
        quote = await reject_quote(session, token, _parse_id(quote_id, "MQ"), reason=body.reason)
    except (QuoteError, TokenError) as exc:
        raise _http(exc) from exc
    return await _after_decision(session, token, quote)


@router.post("/review/quotes/{quote_id}/request-revision", response_model=DecisionOut)
async def review_request_revision(
    body: RevisionIn,
    quote_id: str = Path(..., max_length=20),
    x_review_token: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> DecisionOut:
    try:
        token = await resolve_review_token(session, x_review_token)
        quote = await request_revision(session, token, _parse_id(quote_id, "MQ"), note=body.note)
    except (QuoteError, TokenError) as exc:
        raise _http(exc) from exc
    return await _after_decision(session, token, quote)


# ─────────────────────────────────────────────────────
# Admin (site_admin)
# ─────────────────────────────────────────────────────
async def _require_admin(current: User = Depends(get_current_user)) -> User:
    if _v(current.role) != UserRole.SITE_ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "site admin only")
    return current


class RuleOut(BaseModel):
    id: str
    category: str
    part: str
    defect_types: list[str]
    specialty: str
    active: bool


class RulePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    defect_types: list[str] | None = Field(default=None, max_length=100)
    specialty: MarketplaceSpecialty | None = None
    active: bool | None = None


class RuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: str = Field(..., min_length=1, max_length=40)
    part: str = Field(..., min_length=1, max_length=40)
    defect_types: list[str] = Field(..., min_length=1, max_length=100)
    specialty: MarketplaceSpecialty


def _rule_out(r: MarketplaceRule) -> RuleOut:
    return RuleOut(
        id=r.id_str,
        category=r.category,
        part=r.part,
        defect_types=list(r.defect_types or []),
        specialty=_v(r.specialty),
        active=r.active,
    )


@router.get("/admin/rules", response_model=list[RuleOut])
async def admin_rules(
    _: User = Depends(_require_admin), session: AsyncSession = Depends(get_session)
) -> list[RuleOut]:
    rows = (
        (
            await session.execute(
                select(MarketplaceRule).order_by(MarketplaceRule.category, MarketplaceRule.part)
            )
        )
        .scalars()
        .all()
    )
    return [_rule_out(r) for r in rows]


@router.post("/admin/rules", response_model=RuleOut, status_code=201)
async def admin_create_rule(
    body: RuleCreate,
    admin: User = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
) -> RuleOut:
    exists = (
        await session.execute(select(MarketplaceRule.id).where(MarketplaceRule.part == body.part))
    ).first()
    if exists:
        raise HTTPException(409, "a rule for this part already exists — edit it instead")
    rule = MarketplaceRule(
        category=body.category,
        part=body.part,
        defect_types=body.defect_types,
        specialty=body.specialty,
        active=True,
    )
    session.add(rule)
    await session.flush()
    await events.log(
        session,
        "rule_created",
        actor_kind=events.ACTOR_ADMIN,
        actor_user_id=admin.id,
        details=body.model_dump(mode="json"),
    )
    await session.commit()
    return _rule_out(rule)


@router.patch("/admin/rules/{rule_id}", response_model=RuleOut)
async def admin_patch_rule(
    body: RulePatch,
    rule_id: str = Path(..., max_length=20),
    admin: User = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
) -> RuleOut:
    rule = (
        await session.execute(
            select(MarketplaceRule).where(MarketplaceRule.id == _parse_id(rule_id, "MR"))
        )
    ).scalar_one_or_none()
    if rule is None:
        raise HTTPException(404, "rule not found")
    changes = body.model_dump(exclude_none=True, mode="json")
    if body.defect_types is not None:
        rule.defect_types = body.defect_types
    if body.specialty is not None:
        rule.specialty = body.specialty
    if body.active is not None:
        rule.active = body.active
    session.add(rule)
    await events.log(
        session,
        "rule_updated",
        actor_kind=events.ACTOR_ADMIN,
        actor_user_id=admin.id,
        details={"rule": rule.part, **changes},
    )
    await session.commit()
    return _rule_out(rule)


class AdminOfferOut(BaseModel):
    id: str
    vehicle_id: str
    dsp_id: int
    station: str | None
    label: str
    specialty: str
    state: str
    created_at: datetime
    digested_at: datetime | None
    awarded_quote_id: str | None
    withdrawn_reason: str | None


@router.get("/admin/offers", response_model=list[AdminOfferOut])
async def admin_offers(
    state: str | None = Query(default=None, max_length=20),
    _: User = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[AdminOfferOut]:
    stmt = select(MarketplaceOffer).order_by(MarketplaceOffer.id.desc()).limit(500)
    if state:
        stmt = stmt.where(MarketplaceOffer.state == state)
    return [
        AdminOfferOut(
            id=o.id_str,
            vehicle_id=f"VAN-{o.vehicle_id:04d}",
            dsp_id=o.dsp_id,
            station=o.station,
            label=offer_label(o),
            specialty=_v(o.specialty),
            state=_v(o.state),
            created_at=o.created_at,
            digested_at=o.digested_at,
            awarded_quote_id=f"MQ-{o.awarded_quote_id:05d}" if o.awarded_quote_id else None,
            withdrawn_reason=o.withdrawn_reason,
        )
        for o in (await session.execute(stmt)).scalars().all()
    ]


class AdminQuoteOut(BaseModel):
    id: str
    shop_org_id: int
    vehicle_id: str
    dsp_id: int
    state: str
    total_amount: Decimal
    fee_amount: Decimal
    fee_status: str | None
    decision: str | None
    decision_note: str | None
    decided_at: datetime | None
    submitted_at: datetime


@router.get("/admin/quotes", response_model=list[AdminQuoteOut])
async def admin_quotes(
    state: str | None = Query(default=None, max_length=30),
    fee_status: str | None = Query(default=None, max_length=20),
    _: User = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[AdminQuoteOut]:
    stmt = select(MarketplaceQuote).order_by(MarketplaceQuote.id.desc()).limit(500)
    if state:
        stmt = stmt.where(MarketplaceQuote.state == state)
    if fee_status:
        stmt = stmt.where(MarketplaceQuote.fee_status == fee_status)
    return [
        AdminQuoteOut(
            id=q.id_str,
            shop_org_id=q.shop_org_id,
            vehicle_id=f"VAN-{q.vehicle_id:04d}",
            dsp_id=q.dsp_id,
            state=_v(q.state),
            total_amount=q.total_amount,
            fee_amount=q.fee_amount,
            fee_status=_v(q.fee_status) if q.fee_status else None,
            decision=q.decision,
            decision_note=q.decision_note,
            decided_at=q.decided_at,
            submitted_at=q.submitted_at,
        )
        for q in (await session.execute(stmt)).scalars().all()
    ]


class AdminShopPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contact_email: EmailStr | None = None
    specialties: list[MarketplaceSpecialty] | None = Field(default=None, min_length=1, max_length=2)
    is_active: bool | None = None


class AdminShopOut(BaseModel):
    organization_id: int
    name: str
    org_type: str
    specialties: list[str]
    onboarding_status: str
    contact_email: str | None
    is_active: bool


@router.get("/admin/shops", response_model=list[AdminShopOut])
async def admin_shops(
    _: User = Depends(_require_admin), session: AsyncSession = Depends(get_session)
) -> list[AdminShopOut]:
    from app.services.marketplace.shops import list_shops

    out = [
        AdminShopOut(
            organization_id=org.id,
            name=org.name,
            org_type=_v(org.org_type),
            specialties=list(p.specialties or []),
            onboarding_status=_v(p.onboarding_status),
            contact_email=p.contact_email,
            is_active=p.is_active,
        )
        for org, p in await list_shops(session)
    ]
    await session.commit()
    return out


@router.patch("/admin/shops/{org_id}", response_model=AdminShopOut)
async def admin_patch_shop(
    body: AdminShopPatch,
    org_id: str = Path(..., max_length=20),
    admin: User = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
) -> AdminShopOut:
    raw = org_id.split("-", 1)[-1] if "-" in org_id else org_id
    try:
        oid = int(raw)
    except ValueError:
        raise HTTPException(404, "shop not found") from None
    org = (
        await session.execute(select(Organization).where(Organization.id == oid))
    ).scalar_one_or_none()
    if not is_shop_org(org):
        raise HTTPException(404, "shop not found")
    p: MarketplaceShopProfile = await ensure_shop_profile(session, org)
    if body.contact_email is not None:
        p.contact_email = str(body.contact_email).lower()
    if body.specialties is not None:
        p.specialties = sorted({_v(s) for s in body.specialties})
    if body.is_active is not None:
        p.is_active = body.is_active
    session.add(p)
    await events.log(
        session,
        "shop_updated",
        actor_kind=events.ACTOR_ADMIN,
        actor_user_id=admin.id,
        shop_org_id=org.id,
        details=body.model_dump(exclude_none=True, mode="json"),
    )
    await session.commit()
    return AdminShopOut(
        organization_id=org.id,
        name=org.name,
        org_type=_v(org.org_type),
        specialties=list(p.specialties or []),
        onboarding_status=_v(p.onboarding_status),
        contact_email=p.contact_email,
        is_active=p.is_active,
    )


class SyncOut(BaseModel):
    created: int
    withdrawn: int


@router.post("/admin/sync", response_model=SyncOut)
async def admin_sync(
    _: User = Depends(_require_admin), session: AsyncSession = Depends(get_session)
) -> SyncOut:
    result = await sync_offers(session)
    await _commit(session)
    return SyncOut(created=len(result.created), withdrawn=len(result.withdrawn))
