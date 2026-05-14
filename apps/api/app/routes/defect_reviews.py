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

import json
import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user, get_current_user_from_query_token
from app.db import get_session
from app.i18n_errors import E, tr_error
from app.i18n_helpers import get_request_language
from app.models.base import utc_now
from app.models.defect import Defect
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.models.work_orders import (
    DefectReview,
    DefectReviewDecision,
    RepairRequestStatus,
    VendorWorkshop,
    WorkOrder,
)
from app.services.pubsub import (
    publish_defect_review_event,
    subscribe_defect_review_events,
)
from app.services.wo_bundler import consider_defect_for_bundling
from app.services.wo_defect_reviews import manual_review
from app.services.wo_router import route_repair_request

log = logging.getLogger("nova.defect_reviews")
router = APIRouter(prefix="/defect-reviews", tags=["defect-reviews"])


async def _publish_review_changed(
    *, event: str, defect_id: int, dsp_id: int | None, vendor_workshop_id: int | None = None
) -> None:
    """Best-effort publish of a defect-review state change. Never raises."""
    try:
        await publish_defect_review_event({
            "event": event,
            "defect_id": defect_id,
            "dsp_id": dsp_id,
            "vendor_workshop_id": vendor_workshop_id,
        })
    except Exception as e:  # noqa: BLE001
        log.warning("defect_review publish (%s id=%s) failed: %s", event, defect_id, e)


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
    # Populated when this approval triggered the inline router. Lets the
    # UI surface a "Routed to <vendor>" toast instead of leaving the DSP
    # wondering where the WO went.
    routed_workshop_id: int | None = None
    routed_workshop_name: str | None = None
    routed_repair_type: str | None = None
    routed_work_order_id: str | None = None     # WO-XXXXX

    @classmethod
    def from_model(
        cls,
        r: DefectReview,
        *,
        routed_workshop_id: int | None = None,
        routed_workshop_name: str | None = None,
        routed_repair_type: str | None = None,
        routed_work_order_id: str | None = None,
    ) -> "DefectReviewResponse":
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
            routed_workshop_id=routed_workshop_id,
            routed_workshop_name=routed_workshop_name,
            routed_repair_type=routed_repair_type,
            routed_work_order_id=routed_work_order_id,
        )


class DefectReviewListResponse(BaseModel):
    items: list[DefectReviewResponse]
    total: int


class ReviewBody(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    # Optional override for the destination vendor workshop on approve. When
    # null (the default), the auto-router picks the first eligible workshop
    # based on the defect's repair_type. When set, the approve endpoint
    # validates that the workshop actually handles the repair_type and
    # routes there instead — letting the DSP express a "preferred vendor"
    # decision per approval. Ignored on reject.
    vendor_workshop_id: int | None = Field(default=None)
    model_config = ConfigDict(extra="forbid")


class PendingDefectResponse(BaseModel):
    """Lean defect summary for the review queue UI."""

    id: int
    vehicle_id: int
    # Human-readable van code the DSP sees in MyFleet (Amazon Cortex
    # `vehicleName`, e.g. "10" or "PR006"). The numeric vehicle_id above is
    # the DB primary key — it's what the API uses for routing/joins but the
    # DSP never recognizes it. Both surface so the UI can render the fleet
    # code while keeping the canonical id around for follow-up calls.
    fleet_id: str
    plate: str | None = None
    dsp_id: int
    part: str
    defect_type: str
    position: str | None = None
    source: str
    reported_at: datetime
    hours_pending: float
    # repair_type the bundler will route this defect to (mechanical, body,
    # tires, pm, cnmr, detailing, netradyne). Surfaces so the UI's vendor
    # picker can filter workshops to those eligible for THIS defect's
    # category before the user even clicks Approve.
    repair_type: str = "mechanical"

    @classmethod
    def from_row(
        cls,
        defect: Defect,
        vehicle: Vehicle,
        hours_pending: float,
        repair_type: str = "mechanical",
    ) -> "PendingDefectResponse":
        return cls(
            id=defect.id,
            vehicle_id=defect.vehicle_id,
            fleet_id=vehicle.fleet_id,
            plate=vehicle.plate,
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
            repair_type=repair_type,
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
    # Per-row repair_type resolution reuses the bundler's helper so the
    # frontend's vendor picker filters by the SAME bucket the router would
    # later assign on approve. This is N small queries — fine at the
    # default limit=50; if the queue grows we'd batch with a JOIN.
    from app.services.wo_bundler import _resolve_repair_type
    now = datetime.utcnow().replace(tzinfo=None)
    items: list[PendingDefectResponse] = []
    for defect, vehicle in rows:
        delta = now - defect.reported_at.replace(tzinfo=None)
        hours = delta.total_seconds() / 3600
        repair_type = await _resolve_repair_type(session, defect, vehicle.vehicle_class)
        rt_value = repair_type.value if hasattr(repair_type, "value") else str(repair_type)
        items.append(
            PendingDefectResponse.from_row(defect, vehicle, hours, repair_type=rt_value)
        )
    return PendingDefectListResponse(items=items, total=len(items))


# ─────────────────────────────────────────────────────
# Live event stream (SSE)
# ─────────────────────────────────────────────────────
@router.get(
    "/events",
    summary="SSE stream of defect-review state changes (approved / rejected)",
    response_class=StreamingResponse,
)
async def stream_review_events(
    current: User = Depends(get_current_user_from_query_token),
):
    """SSE stream of `defect_review.changed` events. Pass JWT as ?token=...

    Subscribers see only events scoped to their role:
      - dsp_owner / dsp_manager / dsp_inspector / dsp_viewer: own org only
      - site_admin: everything
      - vendor / technician roles: don't review defects → no events
    """
    is_dsp = current.role in (
        UserRole.DSP_OWNER, UserRole.DSP_MANAGER,
        UserRole.DSP_INSPECTOR, UserRole.DSP_VIEWER,
    )

    def envelope_visible(env: dict) -> bool:
        if current.role == UserRole.SITE_ADMIN:
            return True
        if is_dsp:
            return env.get("dsp_id") == current.organization_id
        return False

    async def event_generator():
        yield ": connected\n\n"
        async for envelope in subscribe_defect_review_events():
            if envelope.get("_heartbeat"):
                yield ": heartbeat\n\n"
                continue
            if not envelope_visible(envelope):
                continue
            yield f"data: {json.dumps(envelope, default=str)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
    # Hand the approved defect to the bundler immediately. The bundler
    # groups by (vehicle, repair_type) — that's the right granularity
    # when two defects share a repair_type. We extend it below with a
    # second-tier "fold same-workshop WOs" pass so that, e.g., a horn
    # defect (mechanical) and an inspection-sticker defect (cnmr) on the
    # same van — both routing to Dulles Midas — end up on ONE WO instead
    # of two separate ones at the same vendor.
    rr = await consider_defect_for_bundling(
        session, defect_id=defect.id, actor_id=current.id
    )
    routed_wo_id: int | None = None
    routed_workshop_id: int | None = None
    # `body.vendor_workshop_id` lets the DSP override the auto-pick. When
    # set, both the same-workshop merge check and the router target this
    # workshop instead of the auto-selected one.
    requested_workshop_id = body.vendor_workshop_id
    if rr is not None and rr.status == RepairRequestStatus.OPEN:
        existing_wo = (
            await session.execute(
                select(WorkOrder)
                .where(WorkOrder.repair_request_id == rr.id)
                .where(WorkOrder.status != "cancelled")
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing_wo is not None:
            # Sibling bundling case — the new defect joined an RR that
            # already has a WO. Surface that WO so the UI can still tell
            # the DSP "your defect was added to WO-12345 at Capital Body
            # Shop" instead of leaving them in the dark.
            routed_wo_id = existing_wo.id
            routed_workshop_id = existing_wo.vendor_workshop_id
        else:
            # No WO on this RR yet → resolve the destination workshop
            # before routing. If the same van already has a pre-accept
            # WO at that workshop (from a sibling defect of a DIFFERENT
            # repair_type that routes to the same vendor — e.g. horn +
            # inspection_sticker both at Dulles Midas), MERGE: move this
            # defect onto the existing RR and drop the empty new RR. The
            # vendor then sees one WO covering both defects.
            from app.models.work_orders import RepairRequest as _RR, RepairRequestDefect as _RRD
            from app.services.wo_router import _find_eligible_workshops

            rr_type_value = (
                rr.repair_type.value if hasattr(rr.repair_type, "value")
                else str(rr.repair_type)
            )
            eligible = await _find_eligible_workshops(session, rr_type_value)
            # Honor the DSP's vendor pick if (a) they passed one AND (b) it
            # actually handles this defect's repair_type. Otherwise fall
            # back to the auto-pick (first eligible).
            target_workshop_id: int | None = None
            if requested_workshop_id is not None and any(
                w.id == requested_workshop_id for w in eligible
            ):
                target_workshop_id = requested_workshop_id
            elif eligible:
                target_workshop_id = eligible[0].id

            sibling_wo = None
            if target_workshop_id is not None:
                # Same vehicle + same destination workshop + pre-accept state
                # (still mutable — once accepted/in_progress, vendor has
                # already started scoping the work and we shouldn't merge).
                sibling_wo = (
                    await session.execute(
                        select(WorkOrder)
                        .where(WorkOrder.vehicle_id == rr.vehicle_id)
                        .where(WorkOrder.vendor_workshop_id == target_workshop_id)
                        .where(WorkOrder.status == "pending_acceptance")
                        .where(WorkOrder.repair_request_id != rr.id)
                        .order_by(WorkOrder.created_at.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()

            if sibling_wo is not None:
                # Move the defect from the freshly-created RR onto the
                # sibling RR, then clean up the empty RR. Only update the
                # rrd row's repair_request_id — keeps the defect's audit
                # trail intact.
                await session.execute(
                    _RRD.__table__.update()
                    .where(_RRD.repair_request_id == rr.id)
                    .where(_RRD.defect_id == defect.id)
                    .values(repair_request_id=sibling_wo.repair_request_id)
                )
                # If the original RR is now empty, mark it cancelled so the
                # bundler doesn't pick it up again on the next approve
                # (otherwise a sibling same-repair_type defect could attach
                # to the empty RR and end up routed as a new WO, defeating
                # the merge). CANCELLED here means "merged into another
                # RR" — we don't have a dedicated MERGED status yet.
                remaining = (
                    await session.execute(
                        select(_RRD).where(_RRD.repair_request_id == rr.id).limit(1)
                    )
                ).scalar_one_or_none()
                if remaining is None:
                    orig_rr = (
                        await session.execute(
                            select(_RR).where(_RR.id == rr.id)
                        )
                    ).scalar_one_or_none()
                    if orig_rr is not None:
                        orig_rr.status = RepairRequestStatus.CANCELLED
                        orig_rr.updated_at = utc_now()
                        session.add(orig_rr)
                routed_wo_id = sibling_wo.id
                routed_workshop_id = sibling_wo.vendor_workshop_id
            else:
                # No same-workshop WO to merge into — route normally.
                # Pass the DSP's pick down so the router places the WO at
                # that workshop instead of the auto-first. Validated above:
                # `target_workshop_id` is either requested_workshop_id (if
                # the DSP chose one and it's eligible) or eligible[0].id.
                new_wo = await route_repair_request(
                    session,
                    repair_request_id=rr.id,
                    actor_id=current.id,
                    target_workshop_id=target_workshop_id,
                )
                if new_wo is not None:
                    routed_wo_id = new_wo.id
                    routed_workshop_id = new_wo.vendor_workshop_id

    # Resolve workshop label for the response so the frontend doesn't need
    # a second round-trip just to render "Routed to <vendor>".
    routed_workshop_name: str | None = None
    if routed_workshop_id is not None:
        ws = (
            await session.execute(
                select(VendorWorkshop).where(VendorWorkshop.id == routed_workshop_id)
            )
        ).scalar_one_or_none()
        if ws is not None:
            routed_workshop_name = ws.name

    routed_repair_type: str | None = None
    if rr is not None:
        routed_repair_type = (
            rr.repair_type.value if hasattr(rr.repair_type, "value")
            else str(rr.repair_type)
        )

    await session.commit()
    await session.refresh(review)
    # Fan out the approval — the pending-review queue on the DSP home
    # (and on any other admin's tab) drops this row instantly without
    # waiting for the next polling tick.
    await _publish_review_changed(
        event="approved",
        defect_id=defect.id,
        dsp_id=vehicle.dsp_id,
        vendor_workshop_id=routed_workshop_id,
    )
    return DefectReviewResponse.from_model(
        review,
        routed_workshop_id=routed_workshop_id,
        routed_workshop_name=routed_workshop_name,
        routed_repair_type=routed_repair_type,
        routed_work_order_id=(
            f"WO-{routed_wo_id:05d}" if routed_wo_id is not None else None
        ),
    )


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
    await _publish_review_changed(
        event="rejected",
        defect_id=defect.id,
        dsp_id=vehicle.dsp_id,
    )
    return DefectReviewResponse.from_model(review)
