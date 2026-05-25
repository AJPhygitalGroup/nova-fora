"""Rewards program endpoints — vendor loyalty config (mockup p.11).

A vendor configures one `RewardsProgram` per workshop:
  • vendor_bucks_pct (0-100)       — % of DFS payout converted to bucks
  • vendor_bucks_duration_months (3-12) — bucks expiry window
  • up to 5 `RewardsTier` rows      — criteria + reward label

Tenancy:
  • site_admin: any workshop
  • vendor_admin: only workshops their org owns
  • everyone else: read-only

The accrual / spending engine isn't built yet — iter-1 just stores
the config so the admin UI matches the mockup. Iter-2 will wire
the actual vendor-bucks ledger.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.user import User, UserRole
from app.models.work_orders import (
    RewardsProgram,
    RewardsTier,
    VendorWorkshop,
)

router = APIRouter(prefix="/rewards", tags=["rewards"])


# ─────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────
class RewardsTierResp(BaseModel):
    id: int
    rewards_program_id: int
    tier_order: int
    metric_label: str
    metric_target: int
    reward_label: str
    created_at: datetime


class RewardsProgramResp(BaseModel):
    id: int | None = None
    vendor_workshop_id: int
    vendor_bucks_pct: Decimal = Decimal("0")
    vendor_bucks_duration_months: int = 6
    tiers: list[RewardsTierResp] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ProgramUpsertBody(BaseModel):
    """PUT body for the program settings (program is auto-created if missing)."""
    model_config = ConfigDict(extra="forbid")
    vendor_bucks_pct: Decimal = Field(..., ge=0, le=100)
    vendor_bucks_duration_months: int = Field(..., ge=3, le=12)


class TierUpsertBody(BaseModel):
    """POST / PATCH body for a single tier. tier_order is required on POST,
    optional on PATCH (the existing one stays unless explicitly changed)."""
    model_config = ConfigDict(extra="forbid")
    tier_order: int | None = Field(default=None, ge=1, le=5)
    metric_label: str = Field(..., min_length=1, max_length=80)
    metric_target: int = Field(..., gt=0)
    reward_label: str = Field(..., min_length=1, max_length=200)


# ─────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────
async def _resolve_workshop(
    session: AsyncSession, workshop_id: int, current: User
) -> VendorWorkshop:
    """Fetch workshop and authorise the caller. site_admin sees all;
    vendor_admin only their org's workshops; everyone else read-only
    (callers must enforce read-vs-write separately)."""
    ws = (
        await session.execute(
            select(VendorWorkshop).where(VendorWorkshop.id == workshop_id)
        )
    ).scalar_one_or_none()
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "workshop not found")
    return ws


def _can_mutate(current: User, ws: VendorWorkshop) -> bool:
    if current.role == UserRole.SITE_ADMIN:
        return True
    if current.role == UserRole.VENDOR_ADMIN and ws.organization_id == current.organization_id:
        return True
    return False


async def _program_with_tiers(
    session: AsyncSession, workshop_id: int
) -> RewardsProgramResp:
    """Build the response payload for a workshop. Returns an empty
    placeholder when no program exists yet (so the UI can render a
    fresh form without an extra round-trip)."""
    prog = (
        await session.execute(
            select(RewardsProgram).where(RewardsProgram.vendor_workshop_id == workshop_id)
        )
    ).scalar_one_or_none()
    if prog is None:
        return RewardsProgramResp(vendor_workshop_id=workshop_id)
    tiers = (
        await session.execute(
            select(RewardsTier)
            .where(RewardsTier.rewards_program_id == prog.id)
            .order_by(RewardsTier.tier_order.asc())
        )
    ).scalars().all()
    return RewardsProgramResp(
        id=prog.id,
        vendor_workshop_id=prog.vendor_workshop_id,
        vendor_bucks_pct=prog.vendor_bucks_pct,
        vendor_bucks_duration_months=prog.vendor_bucks_duration_months,
        tiers=[
            RewardsTierResp(
                id=t.id,
                rewards_program_id=t.rewards_program_id,
                tier_order=t.tier_order,
                metric_label=t.metric_label,
                metric_target=t.metric_target,
                reward_label=t.reward_label,
                created_at=t.created_at,
            )
            for t in tiers
        ],
        created_at=prog.created_at,
        updated_at=prog.updated_at,
    )


# ─────────────────────────────────────────────────────
# GET program (one-shot: settings + tiers)
# ─────────────────────────────────────────────────────
@router.get(
    "/programs/{workshop_id}",
    response_model=RewardsProgramResp,
    summary="Fetch the workshop's rewards program + all tiers",
)
async def get_program(
    workshop_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RewardsProgramResp:
    await _resolve_workshop(session, workshop_id, current)
    return await _program_with_tiers(session, workshop_id)


# ─────────────────────────────────────────────────────
# PUT program settings (upserts the program row)
# ─────────────────────────────────────────────────────
@router.put(
    "/programs/{workshop_id}",
    response_model=RewardsProgramResp,
    summary="Create or update the rewards-program settings",
)
async def upsert_program(
    body: ProgramUpsertBody,
    workshop_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RewardsProgramResp:
    ws = await _resolve_workshop(session, workshop_id, current)
    if not _can_mutate(current, ws):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your workshop")

    prog = (
        await session.execute(
            select(RewardsProgram).where(RewardsProgram.vendor_workshop_id == workshop_id)
        )
    ).scalar_one_or_none()
    if prog is None:
        prog = RewardsProgram(
            vendor_workshop_id=workshop_id,
            vendor_bucks_pct=body.vendor_bucks_pct,
            vendor_bucks_duration_months=body.vendor_bucks_duration_months,
        )
        session.add(prog)
    else:
        prog.vendor_bucks_pct = body.vendor_bucks_pct
        prog.vendor_bucks_duration_months = body.vendor_bucks_duration_months
        session.add(prog)
    await session.commit()
    return await _program_with_tiers(session, workshop_id)


# ─────────────────────────────────────────────────────
# POST tier
# ─────────────────────────────────────────────────────
@router.post(
    "/programs/{workshop_id}/tiers",
    response_model=RewardsTierResp,
    status_code=status.HTTP_201_CREATED,
    summary="Add a tier to the workshop's rewards program (max 5)",
)
async def add_tier(
    body: TierUpsertBody,
    workshop_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RewardsTierResp:
    ws = await _resolve_workshop(session, workshop_id, current)
    if not _can_mutate(current, ws):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your workshop")
    if body.tier_order is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "tier_order required on POST")

    # Auto-bootstrap the program if missing (saves the UI a separate PUT).
    prog = (
        await session.execute(
            select(RewardsProgram).where(RewardsProgram.vendor_workshop_id == workshop_id)
        )
    ).scalar_one_or_none()
    if prog is None:
        prog = RewardsProgram(vendor_workshop_id=workshop_id)
        session.add(prog)
        await session.flush()

    existing_count = (
        await session.execute(
            select(RewardsTier).where(RewardsTier.rewards_program_id == prog.id)
        )
    ).scalars().all()
    if len(existing_count) >= 5:
        raise HTTPException(status.HTTP_409_CONFLICT, "max 5 tiers per program reached")

    tier = RewardsTier(
        rewards_program_id=prog.id,
        tier_order=body.tier_order,
        metric_label=body.metric_label,
        metric_target=body.metric_target,
        reward_label=body.reward_label,
    )
    session.add(tier)
    await session.commit()
    await session.refresh(tier)
    return RewardsTierResp(
        id=tier.id,
        rewards_program_id=tier.rewards_program_id,
        tier_order=tier.tier_order,
        metric_label=tier.metric_label,
        metric_target=tier.metric_target,
        reward_label=tier.reward_label,
        created_at=tier.created_at,
    )


# ─────────────────────────────────────────────────────
# PATCH tier
# ─────────────────────────────────────────────────────
@router.patch(
    "/tiers/{tier_id}",
    response_model=RewardsTierResp,
    summary="Update a single tier (label/target/reward/order)",
)
async def patch_tier(
    body: TierUpsertBody,
    tier_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RewardsTierResp:
    tier = (
        await session.execute(select(RewardsTier).where(RewardsTier.id == tier_id))
    ).scalar_one_or_none()
    if tier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tier not found")
    prog = (
        await session.execute(
            select(RewardsProgram).where(RewardsProgram.id == tier.rewards_program_id)
        )
    ).scalar_one_or_none()
    if prog is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "program not found")
    ws = await _resolve_workshop(session, prog.vendor_workshop_id, current)
    if not _can_mutate(current, ws):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your workshop")

    tier.metric_label = body.metric_label
    tier.metric_target = body.metric_target
    tier.reward_label = body.reward_label
    if body.tier_order is not None:
        tier.tier_order = body.tier_order
    session.add(tier)
    await session.commit()
    await session.refresh(tier)
    return RewardsTierResp(
        id=tier.id,
        rewards_program_id=tier.rewards_program_id,
        tier_order=tier.tier_order,
        metric_label=tier.metric_label,
        metric_target=tier.metric_target,
        reward_label=tier.reward_label,
        created_at=tier.created_at,
    )


# ─────────────────────────────────────────────────────
# DELETE tier
# ─────────────────────────────────────────────────────
@router.delete(
    "/tiers/{tier_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a tier from the program",
)
async def delete_tier(
    tier_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    tier = (
        await session.execute(select(RewardsTier).where(RewardsTier.id == tier_id))
    ).scalar_one_or_none()
    if tier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tier not found")
    prog = (
        await session.execute(
            select(RewardsProgram).where(RewardsProgram.id == tier.rewards_program_id)
        )
    ).scalar_one_or_none()
    if prog is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "program not found")
    ws = await _resolve_workshop(session, prog.vendor_workshop_id, current)
    if not _can_mutate(current, ws):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your workshop")
    await session.delete(tier)
    await session.commit()
    return None
