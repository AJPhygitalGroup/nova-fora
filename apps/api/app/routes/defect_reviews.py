"""Defect review queue + approve/reject endpoints — V2.0.

The queue is the set of defects without any review row yet (or with the
latest review being rejected and a new review being requested). The
endpoints write a new `defect_reviews` row each time — readers usually
pull the latest via DISTINCT ON.

Authorization:
  - site_admin: review any defect
  - dsp_owner: review defects on their DSP's vehicles
  - vendor / technician: read-only (no scope authority)

On `approve`, the bundler is invoked synchronously so the defect is
attached to (or spawns) an RR right away. The router is NOT invoked
here — the bundling window must elapse first. The cron / CLI driver
(PR 5) picks RRs up and routes them.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.i18n_errors import E, tr_error
from app.i18n_helpers import get_request_language
from app.models.defect import Defect
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.models.work_orders import (
    DefectReview,
    DefectReviewDecision,
)
from app.services.wo_bundler import consider_defect_for_bundling
from app.services.wo_defect_reviews import manual_review

router = APIRouter(prefix="/defect-reviews", tags=["defect-reviews"])


def _parse_defect_id(raw: str | int) -> int:
    """Accept either 'FD-008' or '8' or 8. Returns int.

    The frontend's V1-shaped defect rows carry `id = "FD-XXX"`; we keep
    the prefix in responses (id_str convention) but the V2.0 review
    routes used to insist on pure int path params. This helper lets the
    UI hit /defect-reviews/defect/FD-008/approve directly.
    """
    if isinstance(raw, int):
        return raw
    s = str(raw).strip().upper()
    if s.startswith("FD-"):
        s = s[3:]
    try:
        return int(s)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid defect id: {raw!r}. Use int or 'FD-XXX'.",
        ) from e


# ─────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────
class DefectReviewResponse(BaseModel):
    id: int
    defect_id: int
    decision: Literal["approved", "rejected"]
    decision_method: Literal["manual", "auto_preauth_group", "auto_threshold"]
    reviewer_id: int | None = None
    reviewed_at: datetime
    reason: str | None = None
    created_at: datetime

    @classmethod
    def from_model(cls, r: DefectReview) -> "DefectReviewResponse":
        return cls(
            id=r.id,
            defect_id=r.defect_id,
            decision=(
                r.decision.value if hasattr(r.decision, "value") else r.decision
            ),
            decision_method=(
                r.decision_method.value
                if hasattr(r.decision_method, "value")
                else r.decision_method
            ),
            reviewer_id=r.reviewer_id,
            reviewed_at=r.reviewed_at,
            reason=r.reason,
            created_at=r.created_at,
        )


class DefectReviewListResponse(BaseModel):
    items: list[DefectReviewResponse]
    total: int


class ReviewBody(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    model_config = ConfigDict(extra="forbid")


class PendingDefectResponse(BaseModel):
    """Lean defect summary for the review queue UI."""

    id: int
    vehicle_id: int
    dsp_id: int
    part: str
    defect_type: str
    position: str | None = None
    source: str
    reported_at: datetime
    hours_pending: float

    @classmethod
    def from_row(
        cls, defect: Defect, vehicle: Vehicle, hours_pending: float
    ) -> "PendingDefectResponse":
        return cls(
            id=defect.id,
            vehicle_id=defect.vehicle_id,
            dsp_id=vehicle.dsp_id,
            part=(defect.part.value if hasattr(defect.part, "value") else str(defect.part)),
            defect_type=(
                defect.defect_type.value
                if hasattr(defect.defect_type, "value")
                else str(defect.defect_type)
            ),
            position=(
                defect.position.value if hasattr(defect.position, "value") else defect.position
            ),
            source=(
                defect.source.value if hasattr(defect.source, "value") else str(defect.source)
            ),
            reported_at=defect.reported_at,
            hours_pending=round(hours_pending, 2),
        )


class PendingDefectListResponse(BaseModel):
    items: list[PendingDefectResponse]
    total: int


def _can_review_for_dsp(user: User, dsp_id: int) -> bool:
    if user.role == UserRole.SITE_ADMIN:
        return True
    if user.role == UserRole.DSP_OWNER and user.organization_id == dsp_id:
        return True
    return False


# ─────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────
@router.get(
    "/queue",
    response_model=PendingDefectListResponse,
    summary="List defects awaiting manual scope review (scoped to caller's DSP)",
)
async def review_queue(
    request: Request,
    dsp_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PendingDefectListResponse:
    """Defects with no review row yet. site_admin sees all (optionally
    filtered by dsp_id query param); DSP owners are scoped to their org."""
    lang = get_request_language(request)
    _ = lang  # reserved
    target_dsp_id: int | None
    if current.role == UserRole.SITE_ADMIN:
        target_dsp_id = dsp_id  # optional filter
    elif current.role == UserRole.DSP_OWNER:
        target_dsp_id = current.organization_id
    else:
        # Read-only roles get an empty queue rather than a 403, so the UI
        # can show "no items" without special-casing.
        return PendingDefectListResponse(items=[], total=0)

    # Defects with no review at all, joined to vehicle for the dsp scope
    stmt = (
        select(Defect, Vehicle)
        .join(Vehicle, Vehicle.id == Defect.vehicle_id)
        .outerjoin(DefectReview, DefectReview.defect_id == Defect.id)
        .where(DefectReview.id.is_(None))
    )
    if target_dsp_id is not None:
        stmt = stmt.where(Vehicle.dsp_id == target_dsp_id)
    stmt = stmt.order_by(Defect.reported_at.asc()).limit(limit)

    rows = list((await session.execute(stmt)).all())
    now = datetime.utcnow().replace(tzinfo=None)
    items: list[PendingDefectResponse] = []
    for defect, vehicle in rows:
        delta = now - defect.reported_at.replace(tzinfo=None)
        hours = delta.total_seconds() / 3600
        items.append(PendingDefectResponse.from_row(defect, vehicle, hours))
    return PendingDefectListResponse(items=items, total=len(items))


@router.get(
    "/defect/{defect_id}",
    response_model=DefectReviewListResponse,
    summary="History of reviews for one defect (most recent first)",
)
async def list_reviews_for_defect(
    request: Request,
    defect_id: str = Path(..., examples=["FD-008", "8"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectReviewListResponse:
    lang = get_request_language(request)
    did = _parse_defect_id(defect_id)
    # Scope check
    defect = (
        await session.execute(select(Defect).where(Defect.id == did))
    ).scalar_one_or_none()
    if defect is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.DEFECT_NOT_FOUND, lang)
        )
    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == defect.vehicle_id))
    ).scalar_one_or_none()
    if vehicle is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.VEHICLE_NOT_FOUND, lang, id=defect.vehicle_id)
        )
    if (
        current.role == UserRole.DSP_OWNER
        and vehicle.dsp_id != current.organization_id
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_DEFECT, lang)
        )

    rows = list(
        (
            await session.execute(
                select(DefectReview)
                .where(DefectReview.defect_id == defect_id)
                .order_by(DefectReview.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    items = [DefectReviewResponse.from_model(r) for r in rows]
    return DefectReviewListResponse(items=items, total=len(items))


@router.post(
    "/defect/{defect_id}/approve",
    response_model=DefectReviewResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Approve defect scope; triggers the bundler synchronously",
)
async def approve_defect(
    request: Request,
    defect_id: str = Path(..., examples=["FD-008", "8"]),
    body: ReviewBody = ReviewBody(),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectReviewResponse:
    lang = get_request_language(request)
    did = _parse_defect_id(defect_id)
    defect = (
        await session.execute(select(Defect).where(Defect.id == did))
    ).scalar_one_or_none()
    if defect is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.DEFECT_NOT_FOUND, lang)
        )
    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == defect.vehicle_id))
    ).scalar_one_or_none()
    if vehicle is None or not _can_review_for_dsp(current, vehicle.dsp_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_DEFECT, lang)
        )

    review = await manual_review(
        session,
        defect_id=defect.id,
        decision=DefectReviewDecision.APPROVED,
        reviewer_id=current.id,
        reason=body.reason,
    )
    # Hand the approved defect to the bundler immediately.
    await consider_defect_for_bundling(
        session, defect_id=defect.id, actor_id=current.id
    )
    await session.commit()
    await session.refresh(review)
    return DefectReviewResponse.from_model(review)


@router.post(
    "/defect/{defect_id}/reject",
    response_model=DefectReviewResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Reject defect scope (no work will be scheduled)",
)
async def reject_defect(
    request: Request,
    defect_id: str = Path(..., examples=["FD-008", "8"]),
    body: ReviewBody = ReviewBody(),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DefectReviewResponse:
    lang = get_request_language(request)
    did = _parse_defect_id(defect_id)
    defect = (
        await session.execute(select(Defect).where(Defect.id == did))
    ).scalar_one_or_none()
    if defect is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.DEFECT_NOT_FOUND, lang)
        )
    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == defect.vehicle_id))
    ).scalar_one_or_none()
    if vehicle is None or not _can_review_for_dsp(current, vehicle.dsp_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_DEFECT, lang)
        )

    review = await manual_review(
        session,
        defect_id=defect.id,
        decision=DefectReviewDecision.REJECTED,
        reviewer_id=current.id,
        reason=body.reason,
    )
    await session.commit()
    await session.refresh(review)
    return DefectReviewResponse.from_model(review)
