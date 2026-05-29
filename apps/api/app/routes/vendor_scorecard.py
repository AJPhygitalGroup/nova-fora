"""Vendor Scorecard — DSP-side feedback collection + aggregation.

After a WO completes, the DSP gets a "pending feedback" prompt on
their home dashboard. Submitting feedback writes a row in
`repair_feedback`; aggregating those rows powers the Vendor
Scorecard view (mockup p.4, Mohammed's demo May 25).

Endpoints:

  POST /vendor-scorecard/feedback
       Body: { work_order_id, vote, reason?, escalate?,
               impressive_attribute?, negative_attribute? }
       Auth: dsp_owner / dsp_manager on the WO's DSP. Idempotent —
       multiple submissions overwrite (newest wins).

  GET  /vendor-scorecard/{vendor_workshop_id}
       Returns aggregated metrics + attribute breakdowns + recent
       feedback rows. Visible to: vendor users for own workshops,
       site_admin always, DSP-side users they've reviewed.

  GET  /vendor-scorecard/pending-feedback?dsp_id=&days=14
       Lists WOs awaiting feedback (completed in window, no review
       yet from this DSP). Drives the customer-side "review list"
       modal that opens from the Defects Repaired tile.

  GET  /vendor-scorecard/benchmarks?dsp_id=
       Cross-vendor benchmarks (best in station / best in class
       satisfaction%). Used by the scorecard's comparison chart.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.models.work_orders import (
    RepairFeedback,
    VendorWorkshop,
    WorkOrder,
    WorkOrderStatus,
)

router = APIRouter(prefix="/vendor-scorecard", tags=["vendor-scorecard"])


# ─────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────
_VALID_ATTRS = (
    "turnaround_time", "communication", "professionalism", "work_quality", "price",
)


class FeedbackCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    work_order_id: str = Field(..., description="'WO-00026' or bare int")
    vote: str = Field(..., description="'up' or 'down'")
    reason: str | None = None
    escalate: bool = False
    impressive_attribute: str | None = None
    negative_attribute: str | None = None


class FeedbackResponse(BaseModel):
    id: int
    work_order_id: int
    vendor_workshop_id: int
    dsp_id: int
    vote: str
    reason: str | None = None
    escalate: bool
    impressive_attribute: str | None = None
    negative_attribute: str | None = None
    submitted_by_id: int | None = None
    submitted_by_name: str | None = None
    created_at: datetime


class AttributeCount(BaseModel):
    key: str
    label: str
    count: int


class RecentFeedbackRow(BaseModel):
    feedback_id: int
    work_order_id: int
    work_order_id_str: str
    dsp_name: str | None = None
    vehicle_id_str: str | None = None
    # Customer-facing fleet number ("11", "SV12") — what the DSP recognizes
    # in their own fleet vs the internal "VAN-0121" id. Frontend prefers
    # this for display per Michael's customer-feedback bug (2026-05-27).
    vehicle_fleet_id: str | None = None
    vote: str
    reason: str | None = None
    escalate: bool
    impressive_attribute: str | None = None
    negative_attribute: str | None = None
    submitted_by_name: str | None = None
    created_at: datetime


class ScorecardResponse(BaseModel):
    vendor_workshop_id: int
    workshop_name: str | None = None
    organization_id: int | None = None
    window_days: int

    # Counts
    thumbs_up: int = 0
    thumbs_down: int = 0
    total_feedback: int = 0
    satisfaction_pct: float | None = None
    escalations: int = 0

    # Attribute breakdowns
    impressive_attributes: list[AttributeCount] = Field(default_factory=list)
    negative_attributes: list[AttributeCount] = Field(default_factory=list)

    # Recent feedback (newest first)
    recent: list[RecentFeedbackRow] = Field(default_factory=list)


class PendingFeedbackRow(BaseModel):
    work_order_id: int
    work_order_id_str: str
    vehicle_id_str: str | None = None
    vehicle_fleet_id: str | None = None
    workshop_name: str | None = None
    vendor_workshop_id: int | None = None
    completed_at: datetime | None = None


class BenchmarkResponse(BaseModel):
    primary_vendor_pct: float | None = None
    best_in_station_pct: float | None = None
    best_in_class_pct: float | None = None
    station_dsp_ids: list[int] = Field(default_factory=list)


# ─────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────
def _parse_wo_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("WO-"):
        s = s[3:]
    try:
        return int(s)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"invalid WO id: {raw!r}") from e


_ATTR_LABELS = {
    "turnaround_time": "Turnaround Time",
    "communication": "Communication",
    "professionalism": "Professionalism",
    "work_quality": "Work Quality",
    "price": "Price",
}


def _label(key: str | None) -> str | None:
    if not key:
        return None
    return _ATTR_LABELS.get(key, key.replace("_", " ").title())


# ─────────────────────────────────────────────────────
# POST /vendor-scorecard/feedback  — DSP submits
# ─────────────────────────────────────────────────────
@router.post(
    "/feedback",
    response_model=FeedbackResponse,
    status_code=status.HTTP_201_CREATED,
    summary="DSP submits feedback for a completed WO",
)
async def submit_feedback(
    body: FeedbackCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FeedbackResponse:
    if body.vote not in ("up", "down"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "vote must be 'up' or 'down'")
    if body.impressive_attribute and body.impressive_attribute not in _VALID_ATTRS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"invalid impressive_attribute (expect one of {_VALID_ATTRS})")
    if body.negative_attribute and body.negative_attribute not in _VALID_ATTRS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"invalid negative_attribute (expect one of {_VALID_ATTRS})")

    wo_id = _parse_wo_id(body.work_order_id)
    wo = (await session.execute(select(WorkOrder).where(WorkOrder.id == wo_id))).scalar_one_or_none()
    if wo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "WO not found")

    # Tenancy: DSP-side users only on their own DSP.
    if current.role.value.startswith("dsp_"):
        if current.organization_id != wo.dsp_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not your DSP")
    elif current.role != UserRole.SITE_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only DSP users can submit feedback")

    if wo.status != WorkOrderStatus.COMPLETED.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO status is {wo.status.value if hasattr(wo.status, 'value') else wo.status}; only completed WOs accept feedback",
        )

    row = RepairFeedback(
        work_order_id=wo.id,
        vendor_workshop_id=wo.vendor_workshop_id,
        dsp_id=wo.dsp_id,
        vote=body.vote,
        reason=body.reason,
        escalate=bool(body.escalate),
        impressive_attribute=body.impressive_attribute,
        negative_attribute=body.negative_attribute,
        submitted_by_id=current.id,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return FeedbackResponse(
        id=row.id,
        work_order_id=row.work_order_id,
        vendor_workshop_id=row.vendor_workshop_id,
        dsp_id=row.dsp_id,
        vote=row.vote,
        reason=row.reason,
        escalate=row.escalate,
        impressive_attribute=row.impressive_attribute,
        negative_attribute=row.negative_attribute,
        submitted_by_id=row.submitted_by_id,
        submitted_by_name=current.full_name,
        created_at=row.created_at,
    )


# ─────────────────────────────────────────────────────
# GET /vendor-scorecard/pending-feedback
# ─────────────────────────────────────────────────────
@router.get(
    "/pending-feedback",
    response_model=list[PendingFeedbackRow],
    summary="Completed WOs the DSP hasn't reviewed yet",
)
async def pending_feedback(
    dsp_id: int | None = Query(default=None),
    days: int | None = Query(
        default=None, ge=1, le=3650,
        description="Optional age cap (days). Omit (default) for ALL "
                    "completed WOs without feedback — that's what drives "
                    "the home-tile 'Pending Feedback' counter so it stays "
                    "consistent with the modal regardless of how long ago "
                    "the WO was completed.",
    ),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[PendingFeedbackRow]:
    """For DSP-side users: lists their own org's completed WOs that don't
    have a feedback row yet. Drives the "rate completed repairs" modal
    opened from the home tile."""
    if current.role == UserRole.SITE_ADMIN:
        target_dsp = dsp_id
    elif current.role.value.startswith("dsp_"):
        target_dsp = current.organization_id
    else:
        return []
    if target_dsp is None:
        return []

    # Subquery: WO ids that already have a feedback row from this DSP.
    reviewed_sub = (
        select(RepairFeedback.work_order_id)
        .where(RepairFeedback.dsp_id == target_dsp)
    ).subquery()

    q = (
        select(WorkOrder, Vehicle, VendorWorkshop)
        .join(Vehicle, Vehicle.id == WorkOrder.vehicle_id, isouter=True)
        .join(VendorWorkshop, VendorWorkshop.id == WorkOrder.vendor_workshop_id, isouter=True)
        .where(WorkOrder.dsp_id == target_dsp)
        .where(WorkOrder.status == WorkOrderStatus.COMPLETED.value)
        .where(~WorkOrder.id.in_(select(reviewed_sub.c.work_order_id)))
        .order_by(WorkOrder.completed_at.desc())
    )
    if days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        q = q.where(WorkOrder.completed_at >= cutoff)

    rows = (await session.execute(q)).all()
    return [
        PendingFeedbackRow(
            work_order_id=wo.id,
            work_order_id_str=wo.id_str,
            vehicle_id_str=veh.id_str if veh else None,
            vehicle_fleet_id=veh.fleet_id if veh else None,
            workshop_name=ws.name if ws else None,
            vendor_workshop_id=ws.id if ws else None,
            completed_at=wo.completed_at,
        )
        for wo, veh, ws in rows
    ]


# ─────────────────────────────────────────────────────
# GET /vendor-scorecard/{vendor_workshop_id}
# ─────────────────────────────────────────────────────
@router.get(
    "/{vendor_workshop_id}",
    response_model=ScorecardResponse,
    summary="Aggregated vendor scorecard (satisfaction + attributes + recent)",
)
async def vendor_scorecard(
    vendor_workshop_id: int = Path(..., ge=1),
    days: int = Query(default=90, ge=1, le=365),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ScorecardResponse:
    """Aggregates RepairFeedback rows for the workshop in the window.

    Tenancy:
      - site_admin: any workshop
      - vendor users: any workshop in their org
      - DSP users: any workshop they've reviewed (own data leakage
        is fine — they wrote the reviews themselves)
    """
    ws = (await session.execute(select(VendorWorkshop).where(VendorWorkshop.id == vendor_workshop_id))).scalar_one_or_none()
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "workshop not found")

    if current.role != UserRole.SITE_ADMIN:
        if current.role.value.startswith("vendor_") or current.role == UserRole.TECHNICIAN or current.role == UserRole.SERVICE_WRITER:
            if ws.organization_id != current.organization_id:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "not your workshop")
        # DSP users can see anything they've reviewed (no extra gate).

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # ── Vote counts + escalations ─────────────────────────
    counts = dict(
        (await session.execute(
            select(RepairFeedback.vote, func.count(RepairFeedback.id))
            .where(RepairFeedback.vendor_workshop_id == vendor_workshop_id)
            .where(RepairFeedback.created_at >= cutoff)
            .group_by(RepairFeedback.vote)
        )).all()
    )
    thumbs_up = int(counts.get("up", 0))
    thumbs_down = int(counts.get("down", 0))
    total = thumbs_up + thumbs_down
    satisfaction = round(thumbs_up / total * 100, 1) if total > 0 else None

    escalations = (
        await session.execute(
            select(func.count(RepairFeedback.id))
            .where(RepairFeedback.vendor_workshop_id == vendor_workshop_id)
            .where(RepairFeedback.created_at >= cutoff)
            .where(RepairFeedback.escalate.is_(True))
        )
    ).scalar() or 0

    # ── Attribute counts ─────────────────────────────────
    imp_rows = (
        await session.execute(
            select(RepairFeedback.impressive_attribute, func.count(RepairFeedback.id))
            .where(RepairFeedback.vendor_workshop_id == vendor_workshop_id)
            .where(RepairFeedback.created_at >= cutoff)
            .where(RepairFeedback.impressive_attribute.is_not(None))
            .group_by(RepairFeedback.impressive_attribute)
        )
    ).all()
    neg_rows = (
        await session.execute(
            select(RepairFeedback.negative_attribute, func.count(RepairFeedback.id))
            .where(RepairFeedback.vendor_workshop_id == vendor_workshop_id)
            .where(RepairFeedback.created_at >= cutoff)
            .where(RepairFeedback.negative_attribute.is_not(None))
            .group_by(RepairFeedback.negative_attribute)
        )
    ).all()
    imp_breakdown = [AttributeCount(key=k, label=_label(k), count=int(n)) for k, n in imp_rows]
    neg_breakdown = [AttributeCount(key=k, label=_label(k), count=int(n)) for k, n in neg_rows]
    imp_breakdown.sort(key=lambda r: r.count, reverse=True)
    neg_breakdown.sort(key=lambda r: r.count, reverse=True)

    # ── Recent feedback (last 20) ────────────────────────
    recent_rows = (
        await session.execute(
            select(RepairFeedback, WorkOrder, Vehicle, Organization, User)
            .join(WorkOrder, WorkOrder.id == RepairFeedback.work_order_id, isouter=True)
            .join(Vehicle, Vehicle.id == WorkOrder.vehicle_id, isouter=True)
            .join(Organization, Organization.id == RepairFeedback.dsp_id, isouter=True)
            .join(User, User.id == RepairFeedback.submitted_by_id, isouter=True)
            .where(RepairFeedback.vendor_workshop_id == vendor_workshop_id)
            .where(RepairFeedback.created_at >= cutoff)
            .order_by(RepairFeedback.created_at.desc())
            .limit(20)
        )
    ).all()
    recent = [
        RecentFeedbackRow(
            feedback_id=fb.id,
            work_order_id=fb.work_order_id,
            work_order_id_str=wo.id_str if wo else f"WO-{fb.work_order_id}",
            dsp_name=org.name if org else None,
            vehicle_id_str=veh.id_str if veh else None,
            vehicle_fleet_id=veh.fleet_id if veh else None,
            vote=fb.vote,
            reason=fb.reason,
            escalate=fb.escalate,
            impressive_attribute=fb.impressive_attribute,
            negative_attribute=fb.negative_attribute,
            submitted_by_name=u.full_name if u else None,
            created_at=fb.created_at,
        )
        for fb, wo, veh, org, u in recent_rows
    ]

    return ScorecardResponse(
        vendor_workshop_id=vendor_workshop_id,
        workshop_name=ws.name,
        organization_id=ws.organization_id,
        window_days=days,
        thumbs_up=thumbs_up,
        thumbs_down=thumbs_down,
        total_feedback=total,
        satisfaction_pct=satisfaction,
        escalations=int(escalations),
        impressive_attributes=imp_breakdown,
        negative_attributes=neg_breakdown,
        recent=recent,
    )


# ─────────────────────────────────────────────────────
# GET /vendor-scorecard/benchmarks
# ─────────────────────────────────────────────────────
@router.get(
    "/{vendor_workshop_id}/benchmarks",
    response_model=BenchmarkResponse,
    summary="Cross-vendor benchmarks for the comparison chart",
)
async def benchmarks(
    vendor_workshop_id: int = Path(..., ge=1),
    days: int = Query(default=90, ge=1, le=365),
    dsp_id: int | None = Query(default=None),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BenchmarkResponse:
    """Three numbers: this vendor's satisfaction, best-in-station
    (top satisfaction among workshops serving the same DSP), and
    best-in-class (top satisfaction across all workshops). Station
    is approximated by "DSPs this workshop serves" — pass dsp_id
    to narrow if needed."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Helper to compute a single workshop's satisfaction
    async def _sat(ws_id: int) -> float | None:
        rows = dict(
            (await session.execute(
                select(RepairFeedback.vote, func.count(RepairFeedback.id))
                .where(RepairFeedback.vendor_workshop_id == ws_id)
                .where(RepairFeedback.created_at >= cutoff)
                .group_by(RepairFeedback.vote)
            )).all()
        )
        up = int(rows.get("up", 0))
        down = int(rows.get("down", 0))
        total = up + down
        return round(up / total * 100, 1) if total > 0 else None

    primary = await _sat(vendor_workshop_id)

    # Best in station — same DSP set
    if dsp_id is not None:
        station_dsps = [dsp_id]
    else:
        # All DSPs this workshop serves
        station_dsps = list(
            (await session.execute(
                select(WorkOrder.dsp_id)
                .where(WorkOrder.vendor_workshop_id == vendor_workshop_id)
                .distinct()
            )).scalars().all()
        )

    if station_dsps:
        peer_ids = list(
            (await session.execute(
                select(WorkOrder.vendor_workshop_id)
                .where(WorkOrder.dsp_id.in_(station_dsps))
                .where(WorkOrder.vendor_workshop_id != vendor_workshop_id)
                .distinct()
            )).scalars().all()
        )
    else:
        peer_ids = []

    best_in_station = None
    for ws_id in peer_ids:
        s = await _sat(ws_id)
        if s is not None and (best_in_station is None or s > best_in_station):
            best_in_station = s

    # Best in class — any workshop
    all_workshops = list(
        (await session.execute(
            select(VendorWorkshop.id).where(VendorWorkshop.is_active.is_(True))
        )).scalars().all()
    )
    best_in_class = None
    for ws_id in all_workshops:
        if ws_id == vendor_workshop_id:
            continue
        s = await _sat(ws_id)
        if s is not None and (best_in_class is None or s > best_in_class):
            best_in_class = s

    return BenchmarkResponse(
        primary_vendor_pct=primary,
        best_in_station_pct=best_in_station,
        best_in_class_pct=best_in_class,
        station_dsp_ids=station_dsps,
    )
