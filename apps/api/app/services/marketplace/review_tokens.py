"""DSP review links — one `approval_tokens` row per (DSP, van) (spec §9).

- Valid while the van has at least one OPEN offer.
- "Used up" (410) once every offer on the van is awarded / withdrawn;
  the row is stamped `exhausted_at`.
- If the van gets new open offers later, the next quote email rotates
  the salt, so links from the previous round stay dead.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.base import utc_now
from app.models.marketplace import ApprovalToken
from app.services.marketplace import tokens
from app.services.marketplace.eligibility import van_has_open_offers
from app.settings import get_settings


class TokenError(Exception):
    """Bad / used-up review token. `status_code` is 404 or 410."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def review_url(token: str) -> str:
    return f"{get_settings().app_url.rstrip('/')}/marketplace/review?t={token}"


async def review_link(session: AsyncSession, *, dsp_id: int, vehicle_id: int) -> str:
    """URL of the van's review page — same link for every email while valid."""
    row = (
        await session.execute(
            select(ApprovalToken)
            .where(ApprovalToken.dsp_id == dsp_id)
            .where(ApprovalToken.vehicle_id == vehicle_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is not None and row.exhausted_at is None and row.revoked_at is None:
        return review_url(tokens.derive_token(tokens.DSP_REVIEW, row.token_salt))

    token, salt, digest = tokens.issue(tokens.DSP_REVIEW)
    now = utc_now()
    if row is None:
        row = ApprovalToken(
            dsp_id=dsp_id, vehicle_id=vehicle_id, token_hash=digest, token_salt=salt, issued_at=now
        )
    else:
        row.token_hash = digest
        row.token_salt = salt
        row.issued_at = now
        row.exhausted_at = None
        row.revoked_at = None
    session.add(row)
    await session.flush()
    return review_url(token)


async def resolve_review_token(
    session: AsyncSession, raw: str | None, *, for_update: bool = False
) -> ApprovalToken:
    """Validate a review token. Raises TokenError(404) for unknown/garbled
    tokens and TokenError(410) for revoked / used-up ones."""
    if not tokens.looks_like_token(raw):
        raise TokenError(404, "review link not found")
    stmt = select(ApprovalToken).where(ApprovalToken.token_hash == tokens.hash_token(raw))
    if for_update:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise TokenError(404, "review link not found")
    if row.revoked_at is not None:
        raise TokenError(410, "this review link was revoked")
    if row.exhausted_at is not None:
        raise TokenError(410, "this review link is used up — every repair on this van is decided")
    if not await van_has_open_offers(session, row.vehicle_id):
        row.exhausted_at = utc_now()
        session.add(row)
        await session.commit()
        raise TokenError(410, "this review link is used up — every repair on this van is decided")
    row.last_used_at = utc_now()
    session.add(row)
    return row


async def mark_exhausted_if_done(session: AsyncSession, row: ApprovalToken) -> bool:
    if await van_has_open_offers(session, row.vehicle_id):
        return False
    row.exhausted_at = utc_now()
    session.add(row)
    return True
