"""Work Order endpoints — V2.0 (replaces the V1 stub).

State machine on POST /{id}/{action}:
  pending_acceptance → accepted     (POST /accept)
  pending_acceptance → declined     (POST /decline)
  accepted          → in_progress   (POST /start)
  in_progress       → completed     (POST /complete)
  <any pre-terminal>→ cancelled     (POST /cancel)

The two DB triggers from PR 1 enforce:
  - assert_defect_repair_links_on_complete  — complete blocked if any
    defect_repair line item lacks a link.
  - assert_external_mode_ro_present         — accept blocked if external-
    mode workshop has no RO# attached.

Line item, RO, and note sub-resources live as POST/PATCH/DELETE under
the WO root (/{wo_id}/line-items/*, /{wo_id}/ros/*, /{wo_id}/notes/*).

Authorization:
  - site_admin       : full visibility + every transition
  - dsp_owner        : list/get own DSP, cancel
  - vendor_admin     : list/get WOs at their workshops, all vendor-side
                       transitions (accept/decline/start/complete) + line
                       items + ROs + notes
  - technician       : list/get assigned WOs, start/complete + notes
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

import json
import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user, get_current_user_from_query_token
from app.db import get_session
from app.i18n_errors import E, tr_error
from app.i18n_helpers import get_request_language
from app.models.base import utc_now
from app.models.user import User, UserRole
from app.models.defect import Defect
from app.models.inspection import Inspection
from app.models.organization import Organization
from app.models.vehicle import Vehicle
from app.models.defect import DefectSource
from app.models.work_orders import (
    DefectResolution,
    DefectReviewDecision,
    DspWoResponse,
    LineItemBillingType,
    LineItemCategory,
    LineItemStatus,
    NoteAuthorRole,
    RepairRequestDefect,
    StatusTrackingMode,
    VendorWorkshop,
    WoActivityLog,
    WoActivityLogEntityType,
    WorkOrder,
    WorkOrderLineItem,
    WorkOrderNote,
    WorkOrderNoteChannel,
    WorkOrderPhoto,
    WorkOrderPhotoStage,
    WorkOrderRo,
    WorkOrderStatus,
)
from app.services.wo_activity_log import log_event, log_status_change
from app.services.wo_defect_resolutions import sync_all_drs_for_wo
from app.services.wo_rr_status import refresh_rr_status
from app.services.wo_line_items import (
    add_mid_repair_line_item,
    defer_line_item_with_followup_rr,
    generate_line_items_on_accept,
)
from app.services.wo_router import route_repair_request
from app.services.pubsub import (
    publish_work_order_event,
    subscribe_work_order_events,
)

log = logging.getLogger("nova.work_orders")
router = APIRouter(prefix="/work-orders", tags=["work-orders"])


# ─────────────────────────────────────────────────────
# Pubsub helpers — best-effort instant-latency events
# ─────────────────────────────────────────────────────
async def _publish_wo_changed(wo: WorkOrder, event_name: str) -> None:
    """Best-effort publish of a WO state change. Logs but never raises so
    the underlying mutation always completes regardless of pubsub health."""
    try:
        await publish_work_order_event({
            "event": event_name,
            "work_order_id": wo.id,
            "dsp_id": wo.dsp_id,
            "vendor_workshop_id": wo.vendor_workshop_id,
            "assigned_technician_id": wo.assigned_technician_id,
        })
    except Exception as e:  # noqa: BLE001
        log.warning("WO event publish (%s, id=%s) failed: %s", event_name, wo.id, e)




# ─────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────
WO_STATUS = Literal[
    "pending_acceptance", "accepted", "in_progress",
    "completed", "cancelled", "declined",
]
LI_STATUS = Literal[
    "pending_scope_approval", "pending_cost_approval", "pending",
    "pending_variance_reapproval", "done", "deferred", "declined",
]
DR_STATUS = Literal["pending", "in_progress", "resolved", "deferred", "declined"]


class WorkOrderResponse(BaseModel):
    id: str
    repair_request_id: int
    vehicle_id: int
    vendor_workshop_id: int
    dsp_id: int
    status: WO_STATUS
    status_tracking_mode: str
    assigned_technician_id: int | None = None
    is_stale: bool
    is_rush: bool
    last_mileage: int | None = None
    cancelled_reason: str | None = None
    declined_reason: str | None = None
    decline_reason_code: str | None = None
    created_at: datetime
    updated_at: datetime
    accepted_at: datetime | None = None
    in_progress_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    declined_at: datetime | None = None
    marked_stale_at: datetime | None = None
    # Physical vehicle custody — set by POST /work-orders/{id}/checkout.
    # Distinct from in_progress_at: vendor has the van but tech might not
    # be working on it yet. Vehicle-scoped fan-out (same picked_up_at
    # written to every accepted sibling WO on the vehicle).
    picked_up_at: datetime | None = None
    picked_up_by_id: int | None = None
    picked_up_by_name: str | None = None
    # Pickup photos taken by the tech at handoff — surfaced on the DSP
    # customer home (CheckoutVehiclesModal). Each entry: { id, url,
    # caption?, uploaded_at }. Filtered to stage='vehicle_arrival' from
    # the work_order_photos table.
    vehicle_arrival_photos: list[dict] | None = None
    created_by_id: int | None = None

    # Denormalized display fields — populated server-side via JOINs so
    # vendor_admin / technician scopes (which don't have access to the full
    # vehicles / organizations / inspections endpoints) can render proper
    # labels without the empty "Customer DSP" placeholder. All optional so
    # callers that build a response purely from the WO row still work.
    dsp_name: str | None = None
    vehicle_fleet_id: str | None = None
    vehicle_plate: str | None = None
    vehicle_id_str: str | None = None
    vehicle_year: int | None = None
    vehicle_make: str | None = None
    vehicle_model: str | None = None
    workshop_name: str | None = None
    assigned_technician_name: str | None = None
    inspection_mileage_floor: int | None = None  # min odometer at completion
    # Compact primary-RO snapshot for the list view — lets the SW chips
    # ("Pending Parts", "Pending FMC", "Awaiting Customer") filter without
    # an N-fetch detail round trip. The detail endpoint still returns the
    # full `ros` array; this is the minimum the list table needs.
    primary_ro: dict | None = None
    # Defect rollups for the customer-side "pending action" badges:
    #   - pending_cost_count   = defects with estimated_cost set AND
    #                            cost_decision still NULL → DSP must
    #                            approve/reject the cost (often a shortfall).
    #   - pending_review_count = defects with no DefectReview row → DSP
    #                            hasn't scope-approved yet.
    # Both are 0 when nothing's waiting on the DSP.
    pending_cost_count: int = 0
    pending_review_count: int = 0

    # Scheduling + DSP response (PR: scheduled repairs)
    scheduled_at: datetime | None = None
    repair_bucket: str | None = None       # 'overnight' | 'shop'
    dsp_response: str | None = None        # 'confirmed' | 'not_available'
    dsp_response_at: datetime | None = None
    key_location: str | None = None
    # Derived from `cancelled_reason` — when the DSP cancels the WO we
    # prefix the reason with "[customer]". The vendor side uses this to
    # group customer-cancelled WOs in a separate section and to hide
    # them from the technician's queue (cleaner work surface for techs).
    cancelled_by_customer: bool = False

    @classmethod
    def from_model(
        cls,
        wo: WorkOrder,
        *,
        dsp_name: str | None = None,
        vehicle_fleet_id: str | None = None,
        vehicle_plate: str | None = None,
        vehicle_id_str: str | None = None,
        vehicle_year: int | None = None,
        vehicle_make: str | None = None,
        vehicle_model: str | None = None,
        workshop_name: str | None = None,
        assigned_technician_name: str | None = None,
        picked_up_by_name: str | None = None,
        vehicle_arrival_photos: list[dict] | None = None,
        inspection_mileage_floor: int | None = None,
        primary_ro: dict | None = None,
        pending_cost_count: int = 0,
        pending_review_count: int = 0,
    ) -> "WorkOrderResponse":
        return cls(
            id=wo.id_str,
            repair_request_id=wo.repair_request_id,
            vehicle_id=wo.vehicle_id,
            vendor_workshop_id=wo.vendor_workshop_id,
            dsp_id=wo.dsp_id,
            status=wo.status.value if hasattr(wo.status, "value") else wo.status,
            status_tracking_mode=(
                wo.status_tracking_mode.value
                if hasattr(wo.status_tracking_mode, "value")
                else wo.status_tracking_mode
            ),
            assigned_technician_id=wo.assigned_technician_id,
            is_stale=wo.is_stale,
            is_rush=wo.is_rush,
            last_mileage=wo.last_mileage,
            cancelled_reason=wo.cancelled_reason,
            declined_reason=wo.declined_reason,
            decline_reason_code=wo.decline_reason_code,
            created_at=wo.created_at,
            updated_at=wo.updated_at,
            accepted_at=wo.accepted_at,
            in_progress_at=wo.in_progress_at,
            completed_at=wo.completed_at,
            cancelled_at=wo.cancelled_at,
            declined_at=wo.declined_at,
            marked_stale_at=wo.marked_stale_at,
            picked_up_at=wo.picked_up_at,
            picked_up_by_id=wo.picked_up_by_id,
            picked_up_by_name=picked_up_by_name,
            vehicle_arrival_photos=vehicle_arrival_photos,
            created_by_id=wo.created_by_id,
            dsp_name=dsp_name,
            vehicle_fleet_id=vehicle_fleet_id,
            vehicle_plate=vehicle_plate,
            vehicle_id_str=vehicle_id_str,
            vehicle_year=vehicle_year,
            vehicle_make=vehicle_make,
            vehicle_model=vehicle_model,
            workshop_name=workshop_name,
            assigned_technician_name=assigned_technician_name,
            inspection_mileage_floor=inspection_mileage_floor,
            primary_ro=primary_ro,
            pending_cost_count=pending_cost_count,
            pending_review_count=pending_review_count,
            scheduled_at=wo.scheduled_at,
            repair_bucket=(
                wo.repair_bucket.value if hasattr(wo.repair_bucket, "value")
                else (str(wo.repair_bucket) if wo.repair_bucket else None)
            ),
            dsp_response=(
                wo.dsp_response.value if hasattr(wo.dsp_response, "value")
                else (str(wo.dsp_response) if wo.dsp_response else None)
            ),
            dsp_response_at=wo.dsp_response_at,
            key_location=wo.key_location,
            cancelled_by_customer=(
                bool(wo.cancelled_reason)
                and wo.cancelled_reason.lower().startswith("[customer]")
            ),
        )


class WorkOrderListResponse(BaseModel):
    items: list[WorkOrderResponse]
    total: int


class LineItemResponse(BaseModel):
    id: int
    work_order_id: int
    ro_id: int | None = None
    description: str
    estimated_price: Decimal | None = None
    final_price: Decimal | None = None
    category: str
    billing_type: str
    status: LI_STATUS
    status_reason: str | None = None
    decline_reason_code: str | None = None
    customer_requested: bool
    cost_approved_at: datetime | None = None
    customer_reapproved_at: datetime | None = None
    external_source: str | None = None
    external_id: str | None = None
    created_at: datetime
    updated_at: datetime
    created_by_id: int | None = None

    @classmethod
    def from_model(cls, li: WorkOrderLineItem) -> "LineItemResponse":
        return cls(
            id=li.id,
            work_order_id=li.work_order_id,
            ro_id=li.ro_id,
            description=li.description,
            estimated_price=li.estimated_price,
            final_price=li.final_price,
            category=li.category.value if hasattr(li.category, "value") else li.category,
            billing_type=li.billing_type.value if hasattr(li.billing_type, "value") else li.billing_type,
            status=li.status.value if hasattr(li.status, "value") else li.status,
            status_reason=li.status_reason,
            decline_reason_code=li.decline_reason_code,
            customer_requested=li.customer_requested,
            cost_approved_at=li.cost_approved_at,
            customer_reapproved_at=li.customer_reapproved_at,
            external_source=li.external_source,
            external_id=li.external_id,
            created_at=li.created_at,
            updated_at=li.updated_at,
            created_by_id=li.created_by_id,
        )


class DefectResolutionResp(BaseModel):
    id: int
    work_order_id: int
    defect_id: int
    status: DR_STATUS
    notes: str | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, dr: DefectResolution) -> "DefectResolutionResp":
        return cls(
            id=dr.id,
            work_order_id=dr.work_order_id,
            defect_id=dr.defect_id,
            status=dr.status.value if hasattr(dr.status, "value") else dr.status,
            notes=dr.notes,
            resolved_at=dr.resolved_at,
            created_at=dr.created_at,
            updated_at=dr.updated_at,
        )


class WorkOrderRoResp(BaseModel):
    id: int
    work_order_id: int
    ro_number: str
    is_primary: bool
    modification_reason: str | None = None
    added_at: datetime
    added_by_id: int | None = None

    @classmethod
    def from_model(cls, ro: WorkOrderRo) -> "WorkOrderRoResp":
        return cls(
            id=ro.id,
            work_order_id=ro.work_order_id,
            ro_number=ro.ro_number,
            is_primary=ro.is_primary,
            modification_reason=ro.modification_reason,
            added_at=ro.added_at,
            added_by_id=ro.added_by_id,
        )


class NoteResp(BaseModel):
    id: int
    work_order_id: int
    author_id: int | None = None
    author_role: str
    channel: str = Field(
        default="internal",
        description="'internal' (vendor team only) or 'customer' (bilateral SW ↔ DSP thread).",
    )
    body: str
    escalation_reason: str | None = Field(
        default=None,
        description="'cmr' or 'exceeded_price_cap' when SW escalated this note. Else NULL.",
    )
    created_at: datetime

    @classmethod
    def from_model(cls, n: WorkOrderNote) -> "NoteResp":
        return cls(
            id=n.id,
            work_order_id=n.work_order_id,
            author_id=n.author_id,
            author_role=n.author_role.value if hasattr(n.author_role, "value") else n.author_role,
            channel=n.channel.value if hasattr(n.channel, "value") else (n.channel or "internal"),
            body=n.body,
            escalation_reason=n.escalation_reason,
            created_at=n.created_at,
        )


class WoDefectResp(BaseModel):
    """Defect + reporter + photos in the WO detail payload.

    Shipped as part of WorkOrderDetailResponse so the vendor's WO card can
    render "what was reported" without a second round-trip to /defects
    and /defects/{id}/photos. Photos carry presigned GET urls (1h TTL).
    """

    id: str                    # FD-XXX
    part: str
    defect_type: str
    position: str | None = None
    source: str
    reported_at: datetime
    reported_by: str | None = None     # user.full_name
    notes: str | None = None
    photos: list[dict] = Field(default_factory=list)
    # [{ id, category, url, content_type, size_bytes, width, height,
    #    uploaded_by, uploaded_at }] — flat dicts so we don't have to
    # cross-import PhotoResponse into this schema.
    # Cost state (drives the DSP's $ Approve cost modal — billing_type
    # for AMR/CMR split; estimated_cost + fmc_capped_at for the shortfall
    # math; cost_decision for the current state).
    billing_type: str | None = None
    estimated_cost: Decimal | None = None
    fmc_capped_at: Decimal | None = None
    cost_decision: str | None = None


class WorkOrderDetailResponse(WorkOrderResponse):
    line_items: list[LineItemResponse] = Field(default_factory=list)
    defect_resolutions: list[DefectResolutionResp] = Field(default_factory=list)
    ros: list[WorkOrderRoResp] = Field(default_factory=list)
    notes: list[NoteResp] = Field(default_factory=list)
    # The defects this WO covers (via WO → RR → repair_request_defects →
    # defect). Each carries its photos so the vendor sees the field
    # evidence the inspector captured.
    defects: list[WoDefectResp] = Field(default_factory=list)
    # Vehicle context lifted from the joined Vehicle row so the WO card
    # can render VIN / FMC / last_known_mileage without a second
    # /vehicles/{id} call. (vehicle_year/make/model live on the parent
    # WorkOrderResponse now — the list view needs them too.)
    vehicle_vin: str | None = None
    vehicle_fmc: str | None = None
    vehicle_mileage: int | None = None


# Action bodies
class DeclineBody(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    decline_reason_code: str = Field(..., max_length=40)
    reroute: bool = Field(
        default=True,
        description="If True (default), attempt to route the RR to the next eligible vendor.",
    )
    model_config = ConfigDict(extra="forbid")


class CancelBody(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    model_config = ConfigDict(extra="forbid")


class CompleteBody(BaseModel):
    # V2.0: last_mileage required at completion (Amazon billing audit +
    # the spec's intent — it's the at-completion odometer reading).
    # Backend additionally checks it's >= the inspection's odometer
    # reading so a tech can't accidentally enter a lower number.
    last_mileage: int = Field(..., ge=0)
    odometer_photo_path: str | None = Field(default=None, max_length=500)
    work_photo_path: str | None = Field(default=None, max_length=500)
    model_config = ConfigDict(extra="forbid")


class AssignTechBody(BaseModel):
    technician_id: int | None = Field(
        default=None,
        description="Set to None to clear assignment.",
    )
    # When the vendor assigns a tech they typically pin the slot at the
    # same time. Both optional — the vendor can also schedule later via
    # POST /work-orders/{id}/schedule.
    scheduled_at: datetime | None = Field(default=None)
    repair_bucket: Literal["overnight", "shop"] | None = Field(default=None)
    model_config = ConfigDict(extra="forbid")


class ScheduleBody(BaseModel):
    """POST /work-orders/{id}/schedule — vendor pins the repair slot."""

    scheduled_at: datetime | None = Field(
        default=None,
        description="When the vendor expects to start. NULL clears the slot.",
    )
    repair_bucket: Literal["overnight", "shop"] | None = Field(
        default=None,
        description="overnight | shop. NULL clears the classification.",
    )
    model_config = ConfigDict(extra="forbid")


class DspResponseBody(BaseModel):
    """POST /work-orders/{id}/dsp-response — DSP confirms/flags the slot."""

    response: Literal["confirmed", "not_available"] = Field(...)
    key_location: str | None = Field(default=None, max_length=80)
    model_config = ConfigDict(extra="forbid")


class DspRescheduleBody(BaseModel):
    """POST /work-orders/{id}/dsp-reschedule — DSP picks a new slot.

    Use when the originally-proposed slot doesn't work for the customer.
    Saves the new `scheduled_at` and marks `dsp_response='confirmed'` since
    the DSP themselves picked this date. Vendor / service writer side sees
    the new slot as already-confirmed.
    """

    scheduled_at: datetime = Field(...)
    key_location: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=500)
    model_config = ConfigDict(extra="forbid")


# Sub-resource bodies
class LineItemCreateBody(BaseModel):
    description: str = Field(..., min_length=1)
    category: LineItemCategory
    billing_type: LineItemBillingType = LineItemBillingType.CMR
    estimated_price: Decimal | None = Field(default=None, ge=0)
    customer_requested: bool = False
    model_config = ConfigDict(use_enum_values=True, extra="forbid")


class LineItemPatchBody(BaseModel):
    description: str | None = Field(default=None, min_length=1)
    estimated_price: Decimal | None = Field(default=None, ge=0)
    final_price: Decimal | None = Field(default=None, ge=0)
    ro_id: int | None = None
    status: LI_STATUS | None = None
    status_reason: str | None = None
    decline_reason_code: str | None = Field(default=None, max_length=40)
    model_config = ConfigDict(extra="forbid")


class LineItemDeferBody(BaseModel):
    reason_code: str = Field(default="parts_unavailable", max_length=40)
    status_reason: str | None = Field(default=None, max_length=500)
    model_config = ConfigDict(extra="forbid")


class RoCreateBody(BaseModel):
    ro_number: str = Field(..., min_length=1, max_length=60)
    is_primary: bool = False
    modification_reason: str | None = None
    model_config = ConfigDict(extra="forbid")


class RoPatchBody(BaseModel):
    # ro_number lets the SW overwrite the TBD-{wo.id} placeholder that
    # /accept auto-creates. The Review modal sends the real vendor RO#
    # once the SW pulls it from RO Writer / Mitchell / Auto Integrate.
    ro_number: str | None = Field(default=None, min_length=1, max_length=60)
    is_primary: bool | None = None
    modification_reason: str | None = None
    model_config = ConfigDict(extra="forbid")


class NoteBody(BaseModel):
    body: str = Field(..., min_length=1)
    author_role: NoteAuthorRole = NoteAuthorRole.ADMIN
    channel: WorkOrderNoteChannel = Field(
        default=WorkOrderNoteChannel.INTERNAL,
        description="'internal' (vendor team only) or 'customer' (visible to DSP).",
    )
    escalation_reason: str | None = Field(
        default=None,
        description="Set to 'cmr' or 'exceeded_price_cap' to flag this customer "
                    "note for SW escalation (mockup p.7). Only meaningful on "
                    "channel='customer'; backend rejects it on internal notes.",
    )
    model_config = ConfigDict(use_enum_values=True, extra="forbid")


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
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid work_order id: {raw!r}. Use int or 'WO-XXXXX'.",
        ) from e


async def _load_wo_or_404(
    session: AsyncSession, wo_id: int, lang: str
) -> WorkOrder:
    wo = (
        await session.execute(select(WorkOrder).where(WorkOrder.id == wo_id))
    ).scalar_one_or_none()
    if wo is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.WORK_ORDER_NOT_FOUND, lang)
        )
    return wo


async def _max_inspection_mileage_for_wo(
    session: AsyncSession, wo: WorkOrder
) -> int | None:
    """Find the highest odometer reading from any inspection that
    contributed a defect to this WO. Returns None if no inspection has
    an odometer recorded (e.g. defect came from a driver_report).

    The chain: WO → RepairRequest → repair_request_defects → Defect →
    Inspection.odometer_miles. We take MAX since a WO can be bundled
    across multiple inspections / vehicles in theory (rare but valid).
    """
    inspection_ids_rows = (
        await session.execute(
            select(Defect.inspection_id)
            .join(
                RepairRequestDefect,
                RepairRequestDefect.defect_id == Defect.id,
            )
            .where(RepairRequestDefect.repair_request_id == wo.repair_request_id)
            .where(Defect.inspection_id.is_not(None))
        )
    ).all()
    inspection_ids = [row[0] for row in inspection_ids_rows if row[0] is not None]
    if not inspection_ids:
        return None
    max_row = (
        await session.execute(
            select(Inspection.odometer_miles)
            .where(Inspection.id.in_(inspection_ids))
            .where(Inspection.odometer_miles.is_not(None))
            .order_by(Inspection.odometer_miles.desc())
            .limit(1)
        )
    ).first()
    if max_row is None or max_row[0] is None:
        return None
    return int(max_row[0])


async def _resolve_display_fields(
    session: AsyncSession, wo: WorkOrder
) -> dict:
    """Resolve denormalized display labels for a single WO.

    Returns the kwargs that `WorkOrderResponse.from_model` accepts:
      dsp_name, vehicle_fleet_id, vehicle_plate, vehicle_id_str,
      workshop_name, assigned_technician_name, inspection_mileage_floor.

    Vendor / tech-scoped callers don't have permission to list every DSP,
    vehicle, and inspection separately — surfacing the labels alongside
    each WO row keeps the UI single-fetch and avoids the empty
    "Customer DSP" placeholder.
    """
    out: dict = {}
    veh = (
        await session.execute(select(Vehicle).where(Vehicle.id == wo.vehicle_id))
    ).scalar_one_or_none()
    if veh is not None:
        out["vehicle_fleet_id"] = veh.fleet_id
        out["vehicle_plate"] = veh.plate
        out["vehicle_id_str"] = veh.id_str
        out["vehicle_year"] = veh.year
        out["vehicle_make"] = veh.make
        out["vehicle_model"] = veh.model
    org = (
        await session.execute(
            select(Organization).where(Organization.id == wo.dsp_id)
        )
    ).scalar_one_or_none()
    if org is not None:
        out["dsp_name"] = org.name
    ws = (
        await session.execute(
            select(VendorWorkshop).where(VendorWorkshop.id == wo.vendor_workshop_id)
        )
    ).scalar_one_or_none()
    if ws is not None:
        out["workshop_name"] = ws.name
    if wo.assigned_technician_id is not None:
        tech = (
            await session.execute(
                select(User).where(User.id == wo.assigned_technician_id)
            )
        ).scalar_one_or_none()
        if tech is not None:
            out["assigned_technician_name"] = tech.full_name
    # 2026-06-02 Phase B — resolve the user who performed the pickup
    # (may differ from assigned_technician_id: a SW can checkout for a
    # tech, or one tech can run a courtesy pickup for another).
    if wo.picked_up_by_id is not None:
        picker = (
            await session.execute(
                select(User).where(User.id == wo.picked_up_by_id)
            )
        ).scalar_one_or_none()
        if picker is not None:
            out["picked_up_by_name"] = picker.full_name
    # vehicle_arrival photos — only loaded when there are any.
    # Storage_path → presigned download URL via generate_download_url
    # (1h TTL). Filtered to non-deleted + stage='vehicle_arrival'.
    if wo.picked_up_at is not None:
        from app.models.work_orders import WorkOrderPhoto, WorkOrderPhotoStage
        from app.storage.s3 import generate_download_url

        photo_rows = (
            await session.execute(
                select(WorkOrderPhoto)
                .where(WorkOrderPhoto.work_order_id == wo.id)
                .where(WorkOrderPhoto.stage == WorkOrderPhotoStage.VEHICLE_ARRIVAL.value)
                .order_by(WorkOrderPhoto.created_at.asc())
            )
        ).scalars().all()
        if photo_rows:
            out["vehicle_arrival_photos"] = [
                {
                    "id": p.id_str if hasattr(p, "id_str") else p.id,
                    "url": generate_download_url(p.storage_path),
                    "caption": p.caption,
                    "uploaded_at": p.created_at.isoformat() if p.created_at else None,
                }
                for p in photo_rows
            ]
    out["inspection_mileage_floor"] = await _max_inspection_mileage_for_wo(
        session, wo
    )

    # Compact primary-RO snapshot for the list view (spec §3.6 fields the
    # SW chip filters depend on: pickup_type, scheduled_start_at,
    # parts_*, submitted_to_fmc_at, fmc_approved_at). One small query per
    # WO — cheap at list-page sizes and keeps the table render single-fetch.
    primary_ro_row = (
        await session.execute(
            select(WorkOrderRo)
            .where(WorkOrderRo.work_order_id == wo.id)
            .where(WorkOrderRo.is_primary.is_(True))
            .limit(1)
        )
    ).scalar_one_or_none()
    # Per-WO defect rollups for the customer-side action badges.
    # Both queries scope to defects linked to this WO's RR — that's what
    # the SW + DSP think of as "the defects on this WO". Subqueries are
    # cheap enough at list-page scale (~50 WOs).
    from app.models.work_orders import DefectReview
    pending_cost = (
        await session.execute(
            select(func.count(Defect.id))
            .join(RepairRequestDefect, RepairRequestDefect.defect_id == Defect.id)
            .where(RepairRequestDefect.repair_request_id == wo.repair_request_id)
            .where(Defect.estimated_cost.is_not(None))
            .where(Defect.cost_decision.is_(None))
        )
    ).scalar() or 0
    pending_review = (
        await session.execute(
            select(func.count(Defect.id))
            .join(RepairRequestDefect, RepairRequestDefect.defect_id == Defect.id)
            .outerjoin(DefectReview, DefectReview.defect_id == Defect.id)
            .where(RepairRequestDefect.repair_request_id == wo.repair_request_id)
            .where(DefectReview.id.is_(None))
        )
    ).scalar() or 0
    out["pending_cost_count"] = int(pending_cost)
    out["pending_review_count"] = int(pending_review)

    if primary_ro_row is not None:
        out["primary_ro"] = {
            "id": primary_ro_row.id,
            "ro_number": primary_ro_row.ro_number,
            "is_primary": primary_ro_row.is_primary,
            "added_at": primary_ro_row.added_at.isoformat() if primary_ro_row.added_at else None,
            "parts_ordered_at": (
                primary_ro_row.parts_ordered_at.isoformat()
                if primary_ro_row.parts_ordered_at else None
            ),
            "parts_received_at": (
                primary_ro_row.parts_received_at.isoformat()
                if primary_ro_row.parts_received_at else None
            ),
            "submitted_to_fmc_at": (
                primary_ro_row.submitted_to_fmc_at.isoformat()
                if primary_ro_row.submitted_to_fmc_at else None
            ),
            "fmc_approved_at": (
                primary_ro_row.fmc_approved_at.isoformat()
                if primary_ro_row.fmc_approved_at else None
            ),
            "scheduled_start_at": (
                primary_ro_row.scheduled_start_at.isoformat()
                if primary_ro_row.scheduled_start_at else None
            ),
            "pickup_requested_at": (
                primary_ro_row.pickup_requested_at.isoformat()
                if primary_ro_row.pickup_requested_at else None
            ),
            "pickup_type": primary_ro_row.pickup_type,
            "pickup_duration_text": primary_ro_row.pickup_duration_text,
            "pickup_location": primary_ro_row.pickup_location,
            "pickup_notes": primary_ro_row.pickup_notes,
            "key_location": primary_ro_row.key_location,
            "vendor_status": primary_ro_row.vendor_status,
            "estimated_duration_minutes": primary_ro_row.estimated_duration_minutes,
        }
    return out


async def _build_wo_response(
    session: AsyncSession, wo: WorkOrder
) -> WorkOrderResponse:
    """Single-row WO response with all display fields resolved."""
    display = await _resolve_display_fields(session, wo)
    return WorkOrderResponse.from_model(wo, **display)


async def _vendor_workshop_ids_for_user(session: AsyncSession, user: User) -> list[int]:
    if user.role not in (UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN):
        return []
    if user.organization_id is None:
        return []
    return list(
        (
            await session.execute(
                select(VendorWorkshop.id).where(
                    VendorWorkshop.organization_id == user.organization_id
                )
            )
        )
        .scalars()
        .all()
    )


async def _can_view_wo(session: AsyncSession, wo: WorkOrder, user: User) -> bool:
    if user.role == UserRole.SITE_ADMIN:
        return True
    if user.role == UserRole.DSP_OWNER:
        return wo.dsp_id == user.organization_id
    if user.role == UserRole.VENDOR_ADMIN:
        workshop_ids = await _vendor_workshop_ids_for_user(session, user)
        return wo.vendor_workshop_id in workshop_ids
    if user.role == UserRole.TECHNICIAN:
        workshop_ids = await _vendor_workshop_ids_for_user(session, user)
        return (
            wo.vendor_workshop_id in workshop_ids
            or wo.assigned_technician_id == user.id
        )
    return False


def _vendor_side_role(role: UserRole) -> bool:
    return role in (UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN)


def _tech_or_vendor_role(role: UserRole) -> bool:
    return role in (UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN)


async def _ensure_can_act(
    session: AsyncSession,
    *,
    wo: WorkOrder,
    user: User,
    allowed_roles: tuple[UserRole, ...],
    lang: str,
) -> None:
    if user.role not in allowed_roles:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            tr_error(E.REQUIRES_ROLE, lang, roles=[r.value for r in allowed_roles]),
        )
    if user.role == UserRole.SITE_ADMIN:
        return
    if user.role == UserRole.DSP_OWNER:
        if wo.dsp_id != user.organization_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_WORK_ORDER, lang)
            )
        return
    if user.role in (UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN):
        workshop_ids = await _vendor_workshop_ids_for_user(session, user)
        is_their_workshop = wo.vendor_workshop_id in workshop_ids
        is_their_assignment = (
            user.role == UserRole.TECHNICIAN
            and wo.assigned_technician_id == user.id
        )
        if not (is_their_workshop or is_their_assignment):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_WORK_ORDER, lang)
            )


# ─────────────────────────────────────────────────────
# List / detail
# ─────────────────────────────────────────────────────
@router.get(
    "",
    response_model=WorkOrderListResponse,
    summary="List work orders (scoped to caller's role)",
)
async def list_work_orders(
    request: Request,
    status_filter: WO_STATUS | None = Query(default=None, alias="status"),
    dsp_id: int | None = Query(default=None),
    vendor_workshop_id: int | None = Query(default=None),
    vehicle_id: int | None = Query(default=None),
    assigned_to_me: bool = Query(default=False),
    scheduled_within_hours: int | None = Query(
        default=None, ge=1, le=720,
        description="If set, only return WOs whose scheduled_at falls within "
                    "the next N hours from now. Drives the DSP-side "
                    "'Scheduled Repairs' home card (typically 36).",
    ),
    has_confirmed_pickup: bool | None = Query(
        default=None,
        description="If true, only WOs whose primary RO has scheduled_start_at "
                    "set (DSP confirmed the drop-off — that's how confirmation is "
                    "captured in iter-1). If false, only WOs with pickup_type set "
                    "but scheduled_start_at still null (i.e., the AWAITING CUSTOMER "
                    "bucket). Drives the SW dashboard 'Customer Confirmed Pickup' section.",
    ),
    limit: int = Query(default=100, ge=1, le=500),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderListResponse:
    _ = get_request_language(request)
    stmt = select(WorkOrder)

    if current.role == UserRole.DSP_OWNER:
        stmt = stmt.where(WorkOrder.dsp_id == current.organization_id)
    elif current.role == UserRole.VENDOR_ADMIN:
        workshop_ids = await _vendor_workshop_ids_for_user(session, current)
        if not workshop_ids:
            return WorkOrderListResponse(items=[], total=0)
        stmt = stmt.where(WorkOrder.vendor_workshop_id.in_(workshop_ids))
    elif current.role == UserRole.TECHNICIAN:
        workshop_ids = await _vendor_workshop_ids_for_user(session, current)
        condition = WorkOrder.assigned_technician_id == current.id
        if workshop_ids:
            condition = condition | WorkOrder.vendor_workshop_id.in_(workshop_ids)
        stmt = stmt.where(condition)
        # Technicians don't see DSP-cancelled WOs — those are work that's
        # already off the table; surfacing them on the tech queue is just
        # noise. Vendor admins / service writers still see them
        # (their list path above doesn't apply this filter).
        if status_filter is None:
            stmt = stmt.where(WorkOrder.status != WorkOrderStatus.CANCELLED.value)
    else:
        # site_admin — optional filters
        if dsp_id is not None:
            stmt = stmt.where(WorkOrder.dsp_id == dsp_id)
        if vendor_workshop_id is not None:
            stmt = stmt.where(WorkOrder.vendor_workshop_id == vendor_workshop_id)

    if assigned_to_me:
        stmt = stmt.where(WorkOrder.assigned_technician_id == current.id)
    if status_filter is not None:
        stmt = stmt.where(WorkOrder.status == status_filter)
    if vehicle_id is not None:
        # Useful for the vehicle-detail "service history" panel. Tenancy
        # filters above already restrict the visible WOs; an out-of-scope
        # vehicle_id just yields an empty list rather than leaking data.
        stmt = stmt.where(WorkOrder.vehicle_id == vehicle_id)
    if scheduled_within_hours is not None:
        # Pre-accept WOs aren't yet "scheduled"; only include WOs that
        # the vendor has actually pinned a slot for. Exclude cancelled +
        # declined so the DSP card doesn't show abandoned rows.
        from datetime import timedelta
        horizon = utc_now() + timedelta(hours=scheduled_within_hours)
        stmt = (
            stmt
            .where(WorkOrder.scheduled_at.is_not(None))
            .where(WorkOrder.scheduled_at <= horizon)
            .where(WorkOrder.status.notin_(["cancelled", "declined", "completed"]))
        )
    if has_confirmed_pickup is not None:
        # Filter via EXISTS on the primary RO row so we don't multiply
        # the result set if a WO ever ends up with multiple primary ROs
        # (the partial UNIQUE index forbids it but EXISTS is defensive).
        ro_subq = select(WorkOrderRo.id).where(
            WorkOrderRo.work_order_id == WorkOrder.id,
            WorkOrderRo.is_primary.is_(True),
        )
        if has_confirmed_pickup:
            ro_subq = (
                ro_subq.where(WorkOrderRo.pickup_requested_at.is_not(None))
                .where(WorkOrderRo.scheduled_start_at.is_not(None))
            )
        else:
            ro_subq = (
                ro_subq.where(WorkOrderRo.pickup_type.is_not(None))
                .where(WorkOrderRo.scheduled_start_at.is_(None))
            )
        stmt = stmt.where(ro_subq.exists())

    # Scheduled-list callers want chronological order (earliest first); the
    # default WO list view stays newest-first.
    if scheduled_within_hours is not None:
        stmt = stmt.order_by(WorkOrder.scheduled_at.asc()).limit(limit)
    else:
        stmt = stmt.order_by(WorkOrder.created_at.desc()).limit(limit)
    rows = list((await session.execute(stmt)).scalars().all())
    items = [await _build_wo_response(session, w) for w in rows]
    return WorkOrderListResponse(items=items, total=len(items))


# ─────────────────────────────────────────────────────
# Live event stream (SSE)
# ─────────────────────────────────────────────────────
@router.get(
    "/events",
    summary="SSE stream of work-order state changes",
    response_class=StreamingResponse,
)
async def stream_wo_events(
    current: User = Depends(get_current_user_from_query_token),
    session: AsyncSession = Depends(get_session),
):
    """Server-Sent Events stream of WO lifecycle changes for the caller.

    Auth: pass JWT as `?token=...` (browser EventSource can't set headers).
    Events: `{event, work_order_id, dsp_id, vendor_workshop_id,
              assigned_technician_id}` where `event` ∈
    {created, accepted, declined, started, completed, cancelled,
    assigned, scheduled, dsp_response, rescheduled}.

    Filters server-side by role so a vendor never sees another vendor's
    WOs and a DSP never sees another DSP's. Heartbeat every 15s keeps
    proxies from killing idle connections.
    """
    # Pre-compute the user's eligibility set ONCE per connection. Workshops
    # don't change membership in the middle of a stream, and re-querying on
    # every event would be ~N round-trips per minute under load.
    is_dsp = current.role in (
        UserRole.DSP_OWNER, UserRole.DSP_MANAGER,
        UserRole.DSP_INSPECTOR, UserRole.DSP_VIEWER,
    )
    is_vendor = current.role in (
        UserRole.VENDOR_ADMIN, UserRole.SERVICE_WRITER,
        UserRole.VENDOR_VIEWER,
    )
    is_tech = current.role == UserRole.TECHNICIAN
    workshop_ids: set[int] = set()
    if is_vendor or is_tech:
        workshop_ids = set(
            await _vendor_workshop_ids_for_user(session, current)
        )

    def envelope_visible(env: dict) -> bool:
        if current.role == UserRole.SITE_ADMIN:
            return True
        if is_dsp:
            return env.get("dsp_id") == current.organization_id
        if is_vendor:
            return env.get("vendor_workshop_id") in workshop_ids
        if is_tech:
            return (
                env.get("vendor_workshop_id") in workshop_ids
                or env.get("assigned_technician_id") == current.id
            )
        return False

    async def event_generator():
        yield ": connected\n\n"
        async for envelope in subscribe_work_order_events():
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
    "/by-ro/{ro_number}",
    response_model=WorkOrderDetailResponse,
    summary="Get a work order by its primary RO number (user-facing canonical handle)",
)
async def get_work_order_by_ro(
    request: Request,
    ro_number: str = Path(..., min_length=1, max_length=60, examples=["12345"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderDetailResponse:
    """Lookup a WO by its primary RO# (the Repair Order number the
    Service Writer enters at accept time). This is the canonical
    user-facing handle going forward — the internal WO id (WO-XXXXX) is
    being deprecated as a user-visible identifier in favour of the
    vendor's RO# (Jorge decision 2026-05-29).

    Returns 404 if no WO has that RO# as primary OR if tenancy hides it
    from the requester. Tenancy is enforced the same way as the
    `/{wo_id}` route via `_can_view_wo`.

    Path placement: registered BEFORE `/{wo_id}` because `/by-ro/<x>`
    has two segments and `/{wo_id}` only matches one — no conflict in
    practice, but the deliberate order keeps intent readable.
    """
    lang = get_request_language(request)
    wo = (
        await session.execute(
            select(WorkOrder)
            .join(WorkOrderRo, WorkOrderRo.work_order_id == WorkOrder.id)
            .where(WorkOrderRo.ro_number == ro_number)
            .where(WorkOrderRo.is_primary.is_(True))
        )
    ).scalar_one_or_none()
    if wo is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            tr_error(E.WORK_ORDER_NOT_FOUND, lang),
        )
    if not await _can_view_wo(session, wo, current):
        # 404 rather than 403 — don't confirm RO# existence to a vendor
        # who shouldn't see it.
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            tr_error(E.WORK_ORDER_NOT_FOUND, lang),
        )
    # Delegate to the existing /{wo_id} loader so we don't duplicate the
    # ~165 lines of line_items / DRs / ROs / notes / defects+photos
    # assembly. FastAPI handlers are plain async functions; calling one
    # from another is safe (it re-runs the tenancy check, which is
    # idempotent here).
    return await get_work_order(
        request=request,
        wo_id=wo.id_str,
        current=current,
        session=session,
    )


@router.get(
    "/{wo_id}",
    response_model=WorkOrderDetailResponse,
    summary="Get a work order with line items / DRs / ROs / notes",
)
async def get_work_order(
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderDetailResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    if not await _can_view_wo(session, wo, current):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_WORK_ORDER, lang)
        )

    line_items = list(
        (
            await session.execute(
                select(WorkOrderLineItem)
                .where(WorkOrderLineItem.work_order_id == wo.id)
                .order_by(WorkOrderLineItem.id)
            )
        )
        .scalars()
        .all()
    )
    drs = list(
        (
            await session.execute(
                select(DefectResolution)
                .where(DefectResolution.work_order_id == wo.id)
                .order_by(DefectResolution.id)
            )
        )
        .scalars()
        .all()
    )
    ros = list(
        (
            await session.execute(
                select(WorkOrderRo)
                .where(WorkOrderRo.work_order_id == wo.id)
                .order_by(WorkOrderRo.added_at.desc())
            )
        )
        .scalars()
        .all()
    )
    notes = list(
        (
            await session.execute(
                select(WorkOrderNote)
                .where(WorkOrderNote.work_order_id == wo.id)
                .order_by(WorkOrderNote.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    # Pull every defect attached to this WO's RR plus the reporter user
    # and the defect's photos. The vendor's card shows the inspector-side
    # evidence (description + reporter + photo grid) before they accept.
    from app.models.photo import Photo
    from app.storage.s3 import generate_download_url

    defect_rows = list(
        (
            await session.execute(
                select(Defect, User)
                .join(RepairRequestDefect, RepairRequestDefect.defect_id == Defect.id)
                .outerjoin(User, User.id == Defect.reported_by_id)
                .where(RepairRequestDefect.repair_request_id == wo.repair_request_id)
                .order_by(Defect.reported_at.asc())
            )
        )
        .all()
    )
    defect_ids = [d.id for d, _u in defect_rows]
    photos_by_defect: dict[int, list[Photo]] = {did: [] for did in defect_ids}
    if defect_ids:
        photo_rows = list(
            (
                await session.execute(
                    select(Photo)
                    .where(Photo.defect_id.in_(defect_ids))
                    .where(Photo.is_deleted.is_(False))
                    .order_by(Photo.uploaded_at.asc())
                )
            )
            .scalars()
            .all()
        )
        for p in photo_rows:
            photos_by_defect.setdefault(p.defect_id, []).append(p)

    # Resolve billing_type per defect via the same helper the cost endpoint
    # uses (AMR for AMR/Netradyne, CMR for everything else). One-shot via
    # the catalog group; cached implicitly per request session.
    from app.services.wo_defect_costs import derive_billing_type
    from app.services.wo_defect_reviews import _resolve_defect_group

    # Pre-fetch the vehicle once for vehicle_class (used by the billing
    # derivation). We reload the existing veh variable from below; do it
    # eagerly here too so the loop has access.
    _veh_for_billing = (
        await session.execute(select(Vehicle).where(Vehicle.id == wo.vehicle_id))
    ).scalar_one_or_none()

    defects_payload: list[WoDefectResp] = []
    for d, reporter in defect_rows:
        ph_list = photos_by_defect.get(d.id, [])
        billing = None
        if _veh_for_billing is not None:
            try:
                group = await _resolve_defect_group(session, d, _veh_for_billing.vehicle_class)
                billing = derive_billing_type(group)
            except Exception:  # noqa: BLE001
                billing = None

        defects_payload.append(WoDefectResp(
            id=d.id_str,
            part=(d.part.value if hasattr(d.part, "value") else str(d.part)),
            defect_type=(d.defect_type.value if hasattr(d.defect_type, "value") else str(d.defect_type)),
            position=(d.position.value if hasattr(d.position, "value") else d.position),
            source=(d.source.value if hasattr(d.source, "value") else str(d.source)),
            reported_at=d.reported_at,
            reported_by=reporter.full_name if reporter else None,
            notes=d.notes,
            billing_type=billing,
            estimated_cost=d.estimated_cost,
            fmc_capped_at=d.fmc_capped_at,
            cost_decision=d.cost_decision,
            photos=[
                {
                    "id": p.id_str,
                    "category": p.category.value if hasattr(p.category, "value") else str(p.category),
                    "url": generate_download_url(p.storage_key),
                    "content_type": p.content_type,
                    "size_bytes": p.size_bytes,
                    "width": p.width,
                    "height": p.height,
                    "uploaded_at": p.uploaded_at.isoformat(),
                }
                for p in ph_list
            ],
        ))

    # Vehicle context — same Vehicle row the WO already joins for the
    # display fields, just lift the extra columns the card needs.
    veh = (
        await session.execute(select(Vehicle).where(Vehicle.id == wo.vehicle_id))
    ).scalar_one_or_none()

    base = await _build_wo_response(session, wo)
    # vehicle_year/make/model already populated on `base` via _resolve_display_fields.
    return WorkOrderDetailResponse(
        **base.model_dump(),
        line_items=[LineItemResponse.from_model(li) for li in line_items],
        defect_resolutions=[DefectResolutionResp.from_model(dr) for dr in drs],
        ros=[WorkOrderRoResp.from_model(r) for r in ros],
        notes=[NoteResp.from_model(n) for n in notes],
        defects=defects_payload,
        vehicle_vin=veh.vin if veh else None,
        vehicle_fmc=veh.fmc if veh else None,
        vehicle_mileage=veh.mileage if veh else None,
    )


# ─────────────────────────────────────────────────────
# Lifecycle transitions
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/accept",
    response_model=WorkOrderResponse,
    summary="Vendor accepts a pending WO. Generates line items + DRs.",
)
async def accept_wo(
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    if wo.status != WorkOrderStatus.PENDING_ACCEPTANCE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO is {wo.status.value if hasattr(wo.status, 'value') else wo.status}; only pending_acceptance can be accepted",
        )

    prev = wo.status.value if hasattr(wo.status, "value") else str(wo.status)
    wo.status = WorkOrderStatus.ACCEPTED
    wo.accepted_at = utc_now()
    session.add(wo)
    # Flush so the trigger sees the new status; on external-mode workshops
    # without an RO this raises.
    try:
        await session.flush()
    except Exception as e:
        # asyncpg wraps trigger errors; surface a clean 409
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot accept: external-mode workshop requires at least one RO# attached first.",
        ) from e

    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=prev,
        to_status=WorkOrderStatus.ACCEPTED.value,
        actor_id=current.id,
    )
    # Spec catalog also wants the friendly verb (analytics readability).
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="accepted",
        actor_id=current.id,
        details={"prev_status": prev},
    )
    await generate_line_items_on_accept(
        session, work_order_id=wo.id, actor_id=current.id
    )

    # Auto-create a placeholder primary RO so the iter-1 SW flow
    # (Pending → Pending FMC → Pending Parts → Ready to Schedule) can
    # fire sync events without an explicit "Add RO" step. The SW edits
    # the placeholder to the real vendor RO# from the modal later. The
    # placeholder uses 'TBD-{wo.id}' so it's obvious it needs replacing.
    existing_primary = (
        await session.execute(
            select(WorkOrderRo)
            .where(WorkOrderRo.work_order_id == wo.id)
            .where(WorkOrderRo.is_primary.is_(True))
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing_primary is None:
        placeholder = WorkOrderRo(
            work_order_id=wo.id,
            ro_number=f"TBD-{wo.id}",
            is_primary=True,
            added_by_id=current.id,
        )
        session.add(placeholder)
        await session.flush()
        await log_event(
            session,
            entity_type=WoActivityLogEntityType.RO,
            entity_id=placeholder.id,
            action="ro_added",
            actor_id=current.id,
            details={
                "ro_number": placeholder.ro_number,
                "is_primary": True,
                "placeholder": True,
            },
        )

    await refresh_rr_status(
        session, repair_request_id=wo.repair_request_id, actor_id=current.id
    )
    await session.commit()
    await session.refresh(wo)
    await _publish_wo_changed(wo, "accepted")
    return await _build_wo_response(session, wo)


@router.post(
    "/{wo_id}/decline",
    response_model=WorkOrderResponse,
    summary="Vendor declines a pending WO. Optionally re-routes to next vendor.",
)
async def decline_wo(
    body: DeclineBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    if wo.status != WorkOrderStatus.PENDING_ACCEPTANCE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO is {wo.status.value if hasattr(wo.status, 'value') else wo.status}; only pending_acceptance can be declined",
        )

    prev = wo.status.value if hasattr(wo.status, "value") else str(wo.status)
    declining_workshop_id = wo.vendor_workshop_id
    wo.status = WorkOrderStatus.DECLINED
    wo.declined_at = utc_now()
    wo.declined_reason = body.reason
    wo.decline_reason_code = body.decline_reason_code
    session.add(wo)

    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=prev,
        to_status=WorkOrderStatus.DECLINED.value,
        actor_id=current.id,
    )
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="declined",
        actor_id=current.id,
        details={"reason": body.reason, "reason_code": body.decline_reason_code},
    )

    # Try re-routing under the same RR if asked
    if body.reroute:
        await route_repair_request(
            session,
            repair_request_id=wo.repair_request_id,
            actor_id=current.id,
            exclude_workshop_ids=[declining_workshop_id],
        )

    # Refresh AFTER any re-route — if a new WO got spawned, the rollup
    # picks it up and keeps the RR in 'accepted' instead of flipping to
    # 'cancelled' just because the prior WO is now declined.
    await refresh_rr_status(
        session, repair_request_id=wo.repair_request_id, actor_id=current.id
    )
    await session.commit()
    await session.refresh(wo)
    await _publish_wo_changed(wo, "declined")
    return await _build_wo_response(session, wo)


@router.post(
    "/{wo_id}/start",
    response_model=WorkOrderResponse,
    summary="Tech / vendor starts the work (in_progress)",
)
async def start_wo(
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN),
        lang=lang,
    )
    if wo.status != WorkOrderStatus.ACCEPTED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO is {wo.status.value if hasattr(wo.status, 'value') else wo.status}; only accepted can transition to in_progress",
        )

    prev = wo.status.value if hasattr(wo.status, "value") else str(wo.status)
    wo.status = WorkOrderStatus.IN_PROGRESS
    wo.in_progress_at = utc_now()
    session.add(wo)
    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=prev,
        to_status=WorkOrderStatus.IN_PROGRESS.value,
        actor_id=current.id,
    )
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="started",
        actor_id=current.id,
        details={"prev_status": prev},
    )
    await refresh_rr_status(
        session, repair_request_id=wo.repair_request_id, actor_id=current.id
    )
    await session.commit()
    await session.refresh(wo)
    await _publish_wo_changed(wo, "started")
    return await _build_wo_response(session, wo)


@router.post(
    "/{wo_id}/complete",
    response_model=WorkOrderResponse,
    summary="Mark WO as completed. Trigger blocks if defect_repair lacks links.",
)
async def complete_wo(
    body: CompleteBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN),
        lang=lang,
    )
    if wo.status != WorkOrderStatus.IN_PROGRESS:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO is {wo.status.value if hasattr(wo.status, 'value') else wo.status}; only in_progress can complete",
        )

    # Mileage sanity: at-completion reading can never be LOWER than the
    # inspection that surfaced any of the defects (van went FORWARD between
    # the walkaround and the repair finish; going backwards is a typo or
    # fraud signal). The check is informational when no inspection
    # contributed (e.g. driver_report defects).
    inspection_mileage = await _max_inspection_mileage_for_wo(session, wo)
    if inspection_mileage is not None and body.last_mileage < inspection_mileage:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            (
                f"completion mileage {body.last_mileage} cannot be lower than the "
                f"inspection odometer ({inspection_mileage}). Verify the reading."
            ),
        )
    # Defensive: prior mileage already on the WO (e.g. from a partial
    # mid-visit reading) is also a floor.
    if wo.last_mileage is not None and body.last_mileage < wo.last_mileage:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            (
                f"completion mileage {body.last_mileage} cannot be lower than the "
                f"previously recorded mileage ({wo.last_mileage})."
            ),
        )

    prev = wo.status.value if hasattr(wo.status, "value") else str(wo.status)

    # Auto-finalize any line items still in non-terminal states before
    # flipping the WO to completed. Bug discovered during E2E test:
    # without this step, line_items stayed in `pending` and the DR sync
    # left every DR at `pending` too — so a completed WO would show
    # "unresolved" defects.
    #
    # Rule: if the tech says the WO is done, every line item is `done`
    # *unless* it was explicitly deferred or declined earlier. We only
    # touch non-terminal items; explicit deferrals/declines stick.
    pending_lis = list(
        (
            await session.execute(
                select(WorkOrderLineItem).where(
                    WorkOrderLineItem.work_order_id == wo.id
                )
            )
        )
        .scalars()
        .all()
    )
    finalized_count = 0
    for li in pending_lis:
        li_status = li.status.value if hasattr(li.status, "value") else str(li.status)
        if li_status in (
            LineItemStatus.PENDING.value,
            LineItemStatus.PENDING_SCOPE_APPROVAL.value,
            LineItemStatus.PENDING_COST_APPROVAL.value,
            LineItemStatus.PENDING_VARIANCE_REAPPROVAL.value,
        ):
            li.status = LineItemStatus.DONE
            session.add(li)
            finalized_count += 1
            await log_status_change(
                session,
                entity_type=WoActivityLogEntityType.LINE_ITEM,
                entity_id=li.id,
                from_status=li_status,
                to_status=LineItemStatus.DONE.value,
                actor_id=current.id,
            )
    if finalized_count:
        await session.flush()

    wo.status = WorkOrderStatus.COMPLETED
    wo.completed_at = utc_now()
    wo.last_mileage = body.last_mileage
    session.add(wo)
    try:
        await session.flush()
    except Exception as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot complete: defect_repair line item(s) lack a defect link. "
            "Ensure every defect_repair item is tied to a defect resolution.",
        ) from e

    # Persist the two completion photos (odometer + work-done) when the
    # caller provided storage paths. The frontend's complete modal
    # requires both before enabling submit, but we keep them optional
    # at the API layer so a future "complete without photos" exception
    # path (e.g. admin override) doesn't have to bypass the route.
    if body.odometer_photo_path:
        session.add(WorkOrderPhoto(
            work_order_id=wo.id,
            stage=WorkOrderPhotoStage.COMPLETION,
            storage_path=body.odometer_photo_path,
            caption="Odometer reading at completion",
            created_by_id=current.id,
        ))
    if body.work_photo_path:
        session.add(WorkOrderPhoto(
            work_order_id=wo.id,
            stage=WorkOrderPhotoStage.COMPLETION,
            storage_path=body.work_photo_path,
            caption="Work completed evidence",
            created_by_id=current.id,
        ))

    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=prev,
        to_status=WorkOrderStatus.COMPLETED.value,
        actor_id=current.id,
    )
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="completed",
        actor_id=current.id,
        details={
            "prev_status": prev,
            "last_mileage": body.last_mileage,
            "finalized_line_items": finalized_count,
        },
    )
    # Sync DR statuses now that line items are terminal
    await sync_all_drs_for_wo(session, work_order_id=wo.id, actor_id=current.id)
    await refresh_rr_status(
        session, repair_request_id=wo.repair_request_id, actor_id=current.id
    )
    # Vendor bucks accrual — credit the DSP for each paid defect closed
    # in this WO. Idempotent (skips defects that already have an
    # accrual row), no-ops if the vendor has no active rewards program.
    try:
        from app.services.vendor_bucks import accrue_for_completed_wo
        await accrue_for_completed_wo(
            session, work_order_id=wo.id, actor_id=current.id,
        )
    except Exception as e:  # noqa: BLE001
        # Never block the WO complete on a rewards-ledger failure;
        # log and move on. The vendor's bucks balance just stays at the
        # last accrued value until the next completion retries.
        log.warning("vendor_bucks accrual failed for WO %s: %s", wo.id, e)
    await session.commit()
    await session.refresh(wo)
    await _publish_wo_changed(wo, "completed")
    return await _build_wo_response(session, wo)


@router.post(
    "/{wo_id}/cancel",
    response_model=WorkOrderResponse,
    summary="Cancel a non-terminal WO (DSP, vendor, or admin)",
)
async def cancel_wo(
    body: CancelBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.DSP_OWNER, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    if wo.status in (
        WorkOrderStatus.COMPLETED,
        WorkOrderStatus.CANCELLED,
        WorkOrderStatus.DECLINED,
    ):
        return await _build_wo_response(session, wo)

    prev = wo.status.value if hasattr(wo.status, "value") else str(wo.status)
    wo.status = WorkOrderStatus.CANCELLED
    wo.cancelled_at = utc_now()
    # Tag the reason with a recognizable prefix when the DSP cancels so
    # the vendor side can render "Cancelled by customer" / hide the WO
    # from the technician feed without adding a column. The prefix lives
    # in `cancelled_reason` text (e.g. "[customer] DSP changed mind").
    # Vendor-initiated cancels just store the raw reason.
    raw_reason = (body.reason or "").strip()
    if current.role == UserRole.DSP_OWNER:
        wo.cancelled_reason = (
            f"[customer] {raw_reason}" if raw_reason else "[customer]"
        )
    else:
        wo.cancelled_reason = raw_reason or None
    session.add(wo)
    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=prev,
        to_status=WorkOrderStatus.CANCELLED.value,
        actor_id=current.id,
    )
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="cancelled",
        actor_id=current.id,
        details={
            "prev_status": prev,
            "reason": wo.cancelled_reason,
            "by_role": current.role.value,
        },
    )
    await refresh_rr_status(
        session, repair_request_id=wo.repair_request_id, actor_id=current.id
    )
    await session.commit()
    await session.refresh(wo)
    await _publish_wo_changed(wo, "cancelled")
    return await _build_wo_response(session, wo)


@router.post(
    "/{wo_id}/assign-technician",
    response_model=WorkOrderResponse,
    summary="Assign / clear the WO's technician (vendor side)",
)
async def assign_technician(
    body: AssignTechBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    wo.assigned_technician_id = body.technician_id
    # Scheduling — vendor typically pins the slot at the same time they
    # assign a tech. Both fields are optional; setting them here mirrors
    # the dedicated /schedule endpoint below so the UI doesn't need two
    # round-trips. Setting either resets `dsp_response` to NULL because
    # the previous confirmation no longer applies to a new slot.
    schedule_changed = False
    if body.scheduled_at is not None:
        wo.scheduled_at = body.scheduled_at
        schedule_changed = True
    if body.repair_bucket is not None:
        wo.repair_bucket = body.repair_bucket
        schedule_changed = True
    if schedule_changed:
        wo.dsp_response = None
        wo.dsp_response_at = None
    session.add(wo)
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="technician_assigned",
        actor_id=current.id,
        details={
            "technician_id": body.technician_id,
            "scheduled_at": body.scheduled_at.isoformat() if body.scheduled_at else None,
            "repair_bucket": body.repair_bucket,
        },
    )
    await session.commit()
    await session.refresh(wo)
    await _publish_wo_changed(wo, "assigned")
    return await _build_wo_response(session, wo)


# ─────────────────────────────────────────────────────
# Scheduling — vendor pins a slot + bucket
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/schedule",
    response_model=WorkOrderResponse,
    summary="Vendor / service_writer pins scheduled_at + repair_bucket",
)
async def schedule_wo(
    body: ScheduleBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    """Pin (or clear) the scheduled slot + bucket after the fact.

    Anyone on the vendor side (admin, service_writer, technician) can
    update the slot — the shop manager often re-buckets between
    overnight and shop depending on parts availability mid-day.
    Resetting either field clears `dsp_response` so the DSP re-confirms.
    """
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(
            UserRole.SITE_ADMIN,
            UserRole.VENDOR_ADMIN,
            UserRole.TECHNICIAN,
        ),
        lang=lang,
    )
    wo.scheduled_at = body.scheduled_at
    wo.repair_bucket = body.repair_bucket
    # Any reschedule invalidates the prior DSP response. The DSP card
    # surfaces it as "Awaiting your response" again.
    wo.dsp_response = None
    wo.dsp_response_at = None
    session.add(wo)
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="scheduled",
        actor_id=current.id,
        details={
            "scheduled_at": body.scheduled_at.isoformat() if body.scheduled_at else None,
            "repair_bucket": body.repair_bucket,
        },
    )
    await session.commit()
    await session.refresh(wo)
    await _publish_wo_changed(wo, "scheduled")
    return await _build_wo_response(session, wo)


# ─────────────────────────────────────────────────────
# DSP response — confirm / mark not_available
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/dsp-response",
    response_model=WorkOrderResponse,
    summary="DSP confirms the scheduled slot or flags a conflict",
)
async def dsp_response_wo(
    body: DspResponseBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    """DSP-owner side: 'confirmed' (van will be at the spot) or
    'not_available' (scheduling conflict; vendor reschedules).

    Cancellation is a separate action (POST /cancel) because it ends the
    WO lifecycle rather than mutating the proposed slot.
    """
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    if current.role != UserRole.SITE_ADMIN:
        if current.role != UserRole.DSP_OWNER or wo.dsp_id != current.organization_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                tr_error(E.NOT_YOUR_WORK_ORDER, lang),
            )
    if wo.scheduled_at is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot respond: this WO has not been scheduled yet.",
        )
    wo.dsp_response = body.response
    wo.dsp_response_at = utc_now()
    if body.key_location is not None:
        wo.key_location = body.key_location.strip() or None
    session.add(wo)
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action=f"dsp_response_{body.response}",
        actor_id=current.id,
        details={
            "key_location": wo.key_location,
        },
    )
    await session.commit()
    await session.refresh(wo)
    await _publish_wo_changed(wo, "dsp_response")
    return await _build_wo_response(session, wo)


@router.post(
    "/{wo_id}/dsp-reschedule",
    response_model=WorkOrderResponse,
    summary="DSP picks a new slot the van will actually be available",
)
async def dsp_reschedule_wo(
    body: DspRescheduleBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    """DSP-owner action when the vendor's proposed slot doesn't work.

    Instead of leaving the WO in 'not_available' purgatory (where the
    vendor has to chase the DSP for a new date), the DSP picks the new
    slot directly. We:
      - update `scheduled_at` to the new date,
      - set `dsp_response='confirmed'` (the DSP is committing to the slot
        they themselves just chose),
      - optionally update `key_location` (defaults to whatever was
        already there).
    A short note can ride on the request body and lands in the activity
    log so the vendor side can see why the reschedule happened.
    """
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    if current.role != UserRole.SITE_ADMIN:
        if current.role != UserRole.DSP_OWNER or wo.dsp_id != current.organization_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                tr_error(E.NOT_YOUR_WORK_ORDER, lang),
            )
    if wo.status in (
        WorkOrderStatus.COMPLETED,
        WorkOrderStatus.CANCELLED,
        WorkOrderStatus.DECLINED,
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot reschedule a completed / cancelled / declined WO.",
        )
    wo.scheduled_at = body.scheduled_at
    wo.dsp_response = DspWoResponse.CONFIRMED
    wo.dsp_response_at = utc_now()
    if body.key_location is not None:
        wo.key_location = body.key_location.strip() or None
    session.add(wo)
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="dsp_rescheduled",
        actor_id=current.id,
        details={
            "scheduled_at": body.scheduled_at.isoformat(),
            "key_location": wo.key_location,
            "notes": body.notes,
        },
    )
    await session.commit()
    await session.refresh(wo)
    await _publish_wo_changed(wo, "rescheduled")
    return await _build_wo_response(session, wo)


# ─────────────────────────────────────────────────────
# Line items
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/line-items",
    response_model=LineItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a mid-repair line item (customer_request / vendor_addition / etc.)",
)
async def add_line_item(
    body: LineItemCreateBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LineItemResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    category = (
        LineItemCategory(body.category)
        if isinstance(body.category, str)
        else body.category
    )
    billing = (
        LineItemBillingType(body.billing_type)
        if isinstance(body.billing_type, str)
        else body.billing_type
    )
    li = await add_mid_repair_line_item(
        session,
        work_order_id=wo.id,
        description=body.description,
        category=category,
        billing_type=billing,
        estimated_price=body.estimated_price,
        customer_requested=body.customer_requested,
        actor_id=current.id,
    )
    await session.commit()
    await session.refresh(li)
    return LineItemResponse.from_model(li)


@router.patch(
    "/{wo_id}/line-items/{li_id}",
    response_model=LineItemResponse,
    summary="Patch a line item (price, status, notes, etc.)",
)
async def patch_line_item(
    body: LineItemPatchBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    li_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LineItemResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN),
        lang=lang,
    )
    li = (
        await session.execute(
            select(WorkOrderLineItem)
            .where(WorkOrderLineItem.id == li_id)
            .where(WorkOrderLineItem.work_order_id == wo.id)
        )
    ).scalar_one_or_none()
    if li is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "line item not found on this WO"
        )

    prev_status = li.status.value if hasattr(li.status, "value") else str(li.status)

    if body.description is not None:
        li.description = body.description
    if body.estimated_price is not None:
        li.estimated_price = body.estimated_price
    if body.final_price is not None:
        li.final_price = body.final_price
    if body.ro_id is not None:
        li.ro_id = body.ro_id
    if body.status is not None:
        li.status = LineItemStatus(body.status)
    if body.status_reason is not None:
        li.status_reason = body.status_reason
    if body.decline_reason_code is not None:
        li.decline_reason_code = body.decline_reason_code

    session.add(li)

    if body.status is not None and body.status != prev_status:
        await log_status_change(
            session,
            entity_type=WoActivityLogEntityType.LINE_ITEM,
            entity_id=li.id,
            from_status=prev_status,
            to_status=body.status,
            actor_id=current.id,
        )

    await session.commit()
    await session.refresh(li)
    return LineItemResponse.from_model(li)


@router.post(
    "/{wo_id}/line-items/{li_id}/defer",
    response_model=LineItemResponse,
    summary="Defer a line item (parts unavailable, etc.). Spawns a follow-up RR.",
)
async def defer_line_item(
    body: LineItemDeferBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    li_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LineItemResponse:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN),
        lang=lang,
    )
    li = (
        await session.execute(
            select(WorkOrderLineItem)
            .where(WorkOrderLineItem.id == li_id)
            .where(WorkOrderLineItem.work_order_id == wo.id)
        )
    ).scalar_one_or_none()
    if li is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "line item not found on this WO"
        )
    await defer_line_item_with_followup_rr(
        session,
        line_item_id=li.id,
        reason_code=body.reason_code,
        status_reason=body.status_reason,
        actor_id=current.id,
    )
    await session.commit()
    await session.refresh(li)
    return LineItemResponse.from_model(li)


# ─────────────────────────────────────────────────────
# ROs
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/ros",
    response_model=WorkOrderRoResp,
    status_code=status.HTTP_201_CREATED,
    summary="Attach an RO# to the WO (vendor side)",
)
async def add_ro(
    body: RoCreateBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderRoResp:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )

    # If is_primary=True, demote any existing primary first.
    if body.is_primary:
        existing_primary = (
            await session.execute(
                select(WorkOrderRo)
                .where(WorkOrderRo.work_order_id == wo.id)
                .where(WorkOrderRo.is_primary.is_(True))
            )
        ).scalar_one_or_none()
        if existing_primary is not None:
            existing_primary.is_primary = False
            session.add(existing_primary)

    ro = WorkOrderRo(
        work_order_id=wo.id,
        ro_number=body.ro_number,
        is_primary=body.is_primary,
        modification_reason=body.modification_reason,
        added_by_id=current.id,
    )
    session.add(ro)
    await session.flush()
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.RO,
        entity_id=ro.id,
        action="ro_added",
        actor_id=current.id,
        details={
            "ro_number": body.ro_number,
            "is_primary": body.is_primary,
            "work_order_id": wo.id,
        },
    )
    await session.commit()
    await session.refresh(ro)
    return WorkOrderRoResp.from_model(ro)


@router.patch(
    "/{wo_id}/ros/{ro_id}",
    response_model=WorkOrderRoResp,
    summary="Patch an RO (toggle primary / set modification_reason)",
)
async def patch_ro(
    body: RoPatchBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    ro_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderRoResp:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN),
        lang=lang,
    )
    ro = (
        await session.execute(
            select(WorkOrderRo)
            .where(WorkOrderRo.id == ro_id)
            .where(WorkOrderRo.work_order_id == wo.id)
        )
    ).scalar_one_or_none()
    if ro is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "RO not found on this WO")

    if body.is_primary is True and not ro.is_primary:
        existing_primary = (
            await session.execute(
                select(WorkOrderRo)
                .where(WorkOrderRo.work_order_id == wo.id)
                .where(WorkOrderRo.is_primary.is_(True))
            )
        ).scalar_one_or_none()
        if existing_primary is not None:
            existing_primary.is_primary = False
            session.add(existing_primary)
        ro.is_primary = True
    elif body.is_primary is False:
        ro.is_primary = False
    if body.modification_reason is not None:
        ro.modification_reason = body.modification_reason
    if body.ro_number is not None:
        new_num = body.ro_number.strip()
        if new_num and new_num != ro.ro_number:
            prior = ro.ro_number
            ro.ro_number = new_num
            await log_event(
                session,
                entity_type=WoActivityLogEntityType.RO,
                entity_id=ro.id,
                action="ro_number_changed",
                actor_id=current.id,
                details={"prior": prior, "new": new_num},
            )
    session.add(ro)
    await session.commit()
    await session.refresh(ro)
    return WorkOrderRoResp.from_model(ro)


# ─────────────────────────────────────────────────────
# Notes
# ─────────────────────────────────────────────────────
@router.post(
    "/{wo_id}/notes",
    response_model=NoteResp,
    status_code=status.HTTP_201_CREATED,
    summary="Append a note to the WO thread",
)
async def add_note(
    body: NoteBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteResp:
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    if not await _can_view_wo(session, wo, current):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_WORK_ORDER, lang)
        )
    role = (
        NoteAuthorRole(body.author_role)
        if isinstance(body.author_role, str)
        else body.author_role
    )
    channel = (
        WorkOrderNoteChannel(body.channel)
        if isinstance(body.channel, str)
        else body.channel
    )
    # Authorization: only vendor-side roles can write 'internal'; customers
    # can post only to 'customer'. (site_admin bypass.)
    if current.role != UserRole.SITE_ADMIN:
        if channel == WorkOrderNoteChannel.INTERNAL and current.role in (
            UserRole.DSP_OWNER,
            UserRole.DSP_MANAGER,
            UserRole.DSP_INSPECTOR,
            UserRole.DSP_VIEWER,
        ):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "DSP users cannot post to the internal vendor thread",
            )

    # Escalation only applies to customer-facing notes — the mockup's
    # "Escalate" button lives on the customer thread (mockup p.7).
    # Reject any attempt to escalate an internal note so the field's
    # semantics stay clean for downstream queries.
    escalation = body.escalation_reason
    if escalation is not None:
        if channel != WorkOrderNoteChannel.CUSTOMER:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "escalation_reason only allowed on channel='customer' notes",
            )
        if escalation not in ("cmr", "exceeded_price_cap"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "escalation_reason must be 'cmr' or 'exceeded_price_cap'",
            )

    note = WorkOrderNote(
        work_order_id=wo.id,
        author_id=current.id,
        author_role=role,
        channel=channel,
        body=body.body,
        escalation_reason=escalation,
    )
    session.add(note)
    await session.flush()
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.NOTE,
        entity_id=note.id,
        action="note_escalated" if escalation else "note_added",
        actor_id=current.id,
        details={
            "work_order_id": wo.id,
            "author_role": role.value,
            "channel": channel.value,
            **({"escalation_reason": escalation} if escalation else {}),
        },
    )
    await session.commit()
    await session.refresh(note)
    return NoteResp.from_model(note)


@router.get(
    "/{wo_id}/notes",
    response_model=list[NoteResp],
    summary="List notes on a WO, optionally filtered by channel (iter-1)",
)
async def list_notes(
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    channel: str | None = Query(
        default=None,
        description="Optional filter: 'internal' or 'customer'. Omit to return both.",
    ),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[NoteResp]:
    """Spec §3.11 — clients fetch a specific note channel (internal-only
    for the vendor's private thread, customer-only for the SW ↔ DSP
    surface) without having to filter the embedded notes from the WO
    detail response.

    DSP users are limited to channel='customer' regardless of the query
    param; vendor users can request either side.
    """
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    if not await _can_view_wo(session, wo, current):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_WORK_ORDER, lang)
        )

    # Validate channel param if given.
    if channel is not None and channel not in ("internal", "customer"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "channel must be 'internal' or 'customer'",
        )

    # DSP-side users can't read 'internal' notes regardless of what they ask for.
    is_dsp_side = current.role in (
        UserRole.DSP_OWNER,
        UserRole.DSP_MANAGER,
        UserRole.DSP_INSPECTOR,
        UserRole.DSP_VIEWER,
    )
    effective_channel = channel
    if is_dsp_side:
        effective_channel = "customer"

    q = select(WorkOrderNote).where(WorkOrderNote.work_order_id == wo.id)
    if effective_channel is not None:
        q = q.where(WorkOrderNote.channel == WorkOrderNoteChannel(effective_channel))
    q = q.order_by(WorkOrderNote.created_at.desc())

    rows = list((await session.execute(q)).scalars().all())
    return [NoteResp.from_model(n) for n in rows]


# ═════════════════════════════════════════════════════
# WO V2 iter-1 — vehicle-scoped pickup (spec §7.D)
# ═════════════════════════════════════════════════════
#
# Pickup is a vehicle-level event, NOT a per-RO event: one truck trip
# covers every ready RO on the same van. Spec invariant: SW sends a
# pickup request → write pickup_requested_at + pickup_type +
# pickup_duration_text to EVERY ready primary RO on the vehicle in one
# UPDATE. Same on customer confirm — write scheduled_start_at +
# pickup_location + key_location + pickup_notes to every ready RO and
# flip the affected WOs to in_progress.
#
# Don't refactor to per-RO scheduling without explicit SW + DSP signoff
# (see project_wo_v2_status.md memory and the spec for the rationale).


def _wo_can_request_pickup(wo: WorkOrder) -> bool:
    """A WO is pickup-eligible iff vendor accepted it (so an RO# is
    attached or about to be) and the work hasn't yet started."""
    return wo.status == WorkOrderStatus.ACCEPTED


class PickupRequestBody(BaseModel):
    """Body for POST /work-orders/{id}/pickup-request — SW action."""

    model_config = ConfigDict(extra="forbid")

    pickup_type: str = Field(
        ...,
        description="'overnight_rush' or 'in_shop' (CHECK constraint on work_order_ros).",
    )
    pickup_duration_text: str | None = Field(
        default=None, max_length=120,
        description="Human ETA the SW shares with the DSP (e.g. '2-3 business days').",
    )


class PickupRequestResponse(BaseModel):
    work_order_id: str
    vehicle_id: int
    updated_ro_ids: list[int] = Field(
        ..., description="Every primary RO that was updated in the vehicle-scoped fan-out.",
    )
    updated_work_order_ids: list[int] = Field(
        ..., description="Every WO whose RO was touched (siblings on the same vehicle).",
    )


class ConfirmPickupBody(BaseModel):
    """Body for POST /work-orders/{id}/confirm-pickup — customer (DSP) action."""

    model_config = ConfigDict(extra="forbid")

    scheduled_start_at: datetime = Field(
        ..., description="When the DSP commits the vehicle will be ready for pickup.",
    )
    pickup_location: str = Field(..., min_length=1, max_length=200)
    key_location: str | None = Field(default=None, max_length=200)
    pickup_notes: str | None = Field(default=None)


class ConfirmPickupResponse(BaseModel):
    work_order_id: str
    vehicle_id: int
    updated_ro_ids: list[int]
    in_progress_work_order_ids: list[int] = Field(
        ..., description="WOs that flipped to in_progress as part of this confirmation.",
    )


async def _ready_primary_ros_for_vehicle(
    session: AsyncSession,
    *,
    vehicle_id: int,
    require_pickup_requested: bool = False,
    require_scheduled_start: bool = False,
    require_not_picked_up: bool = False,
) -> list[tuple[WorkOrderRo, WorkOrder]]:
    """Return (ro, wo) pairs for every PRIMARY RO whose WO is accepted on
    this vehicle, optionally narrowed by pickup-stage filters.

    Used by all pickup-stage endpoints to fan out the same write to
    every sibling RO on the same vehicle in one query (the spec
    invariant). Filters compose — pass any combo:

      require_pickup_requested → SW already sent the pickup request
                                  (ro.pickup_requested_at IS NOT NULL)
      require_scheduled_start  → DSP already confirmed pickup details
                                  (ro.scheduled_start_at IS NOT NULL)
      require_not_picked_up    → tech hasn't checked out yet
                                  (wo.picked_up_at IS NULL)
    """
    q = (
        select(WorkOrderRo, WorkOrder)
        .join(WorkOrder, WorkOrder.id == WorkOrderRo.work_order_id)
        .where(WorkOrder.vehicle_id == vehicle_id)
        .where(WorkOrder.status == WorkOrderStatus.ACCEPTED)
        .where(WorkOrderRo.is_primary.is_(True))
    )
    if require_pickup_requested:
        q = q.where(WorkOrderRo.pickup_requested_at.is_not(None))
    if require_scheduled_start:
        q = q.where(WorkOrderRo.scheduled_start_at.is_not(None))
    if require_not_picked_up:
        q = q.where(WorkOrder.picked_up_at.is_(None))
    rows = (await session.execute(q)).all()
    return [(row[0], row[1]) for row in rows]


@router.post(
    "/{wo_id}/pickup-request",
    response_model=PickupRequestResponse,
    summary="SW: ask the customer to drop off the vehicle (spec §7.D, vehicle-scoped)",
)
async def send_pickup_request(
    body: PickupRequestBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PickupRequestResponse:
    """Vehicle-scoped fan-out: writes pickup_requested_at + pickup_type +
    pickup_duration_text to EVERY accepted WO's primary RO on the vehicle.

    The triggering WO must be accepted with a primary RO. If a sibling
    WO on the same vehicle is also accepted, the SW's ask covers all of
    them — they share the truck trip.
    """
    lang = get_request_language(request)

    if body.pickup_type not in ("overnight_rush", "in_shop"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "pickup_type must be 'overnight_rush' or 'in_shop'",
        )

    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.SERVICE_WRITER),
        lang=lang,
    )

    if not _wo_can_request_pickup(wo):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"work order status is {wo.status.value}; pickup requires 'accepted'",
        )

    pairs = await _ready_primary_ros_for_vehicle(session, vehicle_id=wo.vehicle_id)
    if not pairs:
        # Spec's no-RO# guardrail: SW must set a primary RO# before sending pickup.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "no accepted WO on this vehicle has a primary RO# — set one first",
        )

    now = utc_now()
    updated_ro_ids: list[int] = []
    updated_wo_ids: list[int] = []
    for ro, sibling_wo in pairs:
        ro.pickup_requested_at = now
        ro.pickup_type = body.pickup_type
        ro.pickup_duration_text = body.pickup_duration_text
        session.add(ro)
        updated_ro_ids.append(ro.id)
        updated_wo_ids.append(sibling_wo.id)
        await log_event(
            session,
            entity_type=WoActivityLogEntityType.RO,
            entity_id=ro.id,
            action="pickup_requested",
            actor_id=current.id,
            details={
                "vehicle_id": wo.vehicle_id,
                "work_order_id": sibling_wo.id,
                "pickup_type": body.pickup_type,
                "pickup_duration_text": body.pickup_duration_text,
                "triggering_work_order_id": wo.id,
                "sibling_count": len(pairs) - 1,
            },
        )

    await session.commit()

    # SSE fan-out so every affected WO's dashboard row refreshes, not
    # just the triggering one. Best-effort.
    for sibling_wo in (p[1] for p in pairs):
        try:
            await _publish_wo_changed(sibling_wo, "pickup_requested")
        except Exception:  # noqa: BLE001
            pass

    return PickupRequestResponse(
        work_order_id=wo.id_str,
        vehicle_id=wo.vehicle_id,
        updated_ro_ids=updated_ro_ids,
        updated_work_order_ids=updated_wo_ids,
    )


@router.post(
    "/{wo_id}/confirm-pickup",
    response_model=ConfirmPickupResponse,
    summary="Customer (DSP): confirm pickup, flips affected WOs to in_progress (spec §7.D)",
)
async def confirm_pickup(
    body: ConfirmPickupBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ConfirmPickupResponse:
    """Vehicle-scoped fan-out: writes scheduled_start_at + pickup_location
    + key_location + pickup_notes to EVERY accepted WO's primary RO on
    the vehicle that already had a pickup_requested_at.

    Customer-side action: DSP owner / manager (or site_admin), scoped to
    the vehicle's DSP.

    Status note (2026-06-02 bug fix): previously this endpoint ALSO
    flipped wo.status to IN_PROGRESS for each sibling. That was wrong —
    the DSP confirming pickup details (location/keys/time) is the
    customer's *agreement*, not the start of the work. The tech still
    has to be assigned and actually start the visit. Leaving the WO in
    `accepted` keeps it visible on the SW dashboard as "Awaiting tech /
    ready to schedule" via deriveStatusKey on the frontend. The
    backend's POST /work-orders/{id}/start endpoint is the canonical
    accepted → in_progress transition.
    """
    lang = get_request_language(request)

    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.DSP_OWNER, UserRole.DSP_MANAGER),
        lang=lang,
    )

    pairs = await _ready_primary_ros_for_vehicle(
        session, vehicle_id=wo.vehicle_id, require_pickup_requested=True
    )
    if not pairs:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "no accepted WO on this vehicle has a pending pickup request",
        )

    updated_ro_ids: list[int] = []
    confirmed_wo_ids: list[int] = []
    for ro, sibling_wo in pairs:
        ro.scheduled_start_at = body.scheduled_start_at
        ro.pickup_location = body.pickup_location
        ro.key_location = body.key_location
        ro.pickup_notes = body.pickup_notes
        session.add(ro)
        updated_ro_ids.append(ro.id)
        confirmed_wo_ids.append(sibling_wo.id)

        await log_event(
            session,
            entity_type=WoActivityLogEntityType.RO,
            entity_id=ro.id,
            action="pickup_confirmed",
            actor_id=current.id,
            details={
                "vehicle_id": wo.vehicle_id,
                "work_order_id": sibling_wo.id,
                "pickup_location": body.pickup_location,
                "key_location": body.key_location,
                "scheduled_start_at": body.scheduled_start_at.isoformat(),
                "triggering_work_order_id": wo.id,
                "sibling_count": len(pairs) - 1,
            },
        )
        # No status flip — the WO stays `accepted` until the SW (or
        # tech) calls POST /work-orders/{id}/start. See docstring.

    # Vehicle-scoped pickup can touch sibling WOs across different RRs
    # (rare but possible — two RRs on the same vehicle, both with
    # accepted WOs at the same shop). Refresh every unique parent RR.
    rr_ids_touched = {p[1].repair_request_id for p in pairs}
    for rr_id in rr_ids_touched:
        await refresh_rr_status(
            session, repair_request_id=rr_id, actor_id=current.id
        )

    await session.commit()

    for sibling_wo in (p[1] for p in pairs):
        try:
            await _publish_wo_changed(sibling_wo, "pickup_confirmed")
        except Exception:  # noqa: BLE001
            pass

    return ConfirmPickupResponse(
        work_order_id=wo.id_str,
        vehicle_id=wo.vehicle_id,
        updated_ro_ids=updated_ro_ids,
        # Kept on the response shape for back-compat; will always be []
        # now that confirm-pickup no longer flips status. The accepted
        # → in_progress transition is now ONLY through /start.
        in_progress_work_order_ids=[],
    )


# ─────────────────────────────────────────────────────
# POST /work-orders/{id}/checkout — tech records pickup at DSP lot
# ─────────────────────────────────────────────────────
class _CheckoutPhoto(BaseModel):
    """Single photo committed after a successful presigned PUT."""

    storage_key: str = Field(..., min_length=1, max_length=500)
    content_type: str = Field(..., min_length=1, max_length=80)
    size_bytes: int | None = Field(default=None, ge=1)
    caption: str | None = Field(default=None, max_length=200)


class CheckoutBody(BaseModel):
    """Tech body: notes + photos (already uploaded to MinIO via
    /uploads/presigned then committed here). At least one photo
    recommended but not enforced — sometimes the tech can't snap one
    (e.g. weather, customer rush)."""

    photos: list[_CheckoutPhoto] = Field(default_factory=list, max_length=10)
    notes: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(extra="forbid")


@router.post(
    "/{wo_id}/checkout",
    response_model=WorkOrderResponse,
    summary="Vendor/tech records pickup at the DSP lot — vehicle-scoped fan-out",
    responses={
        409: {"description": "WO must be accepted with scheduled_start_at; cannot checkout twice."},
    },
)
async def checkout_wo(
    body: CheckoutBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkOrderResponse:
    """Tech (or SW) records "I have the vehicle" at the DSP lot.

    Vehicle-scoped fan-out: writes `picked_up_at=now()` + `picked_up_by_id=
    current.id` to EVERY accepted sibling WO on the vehicle that already
    has `scheduled_start_at` (DSP confirmed pickup) AND is not yet
    picked up. One truck trip = one event for every job on that van.

    Photos: only the TARGET WO gets the WorkOrderPhoto rows (stage
    'vehicle_arrival'). The frontend on the DSP customer home queries
    by vehicle; if any sibling has photos, those photos surface on
    every sibling row at render time.

    Status NOT changed. WO stays `accepted` (with picked_up_at set).
    The canonical accepted → in_progress transition is still POST
    /work-orders/{id}/start. Decoupling lets the dashboard show "tech
    has the van" distinctly from "tech is wrenching".

    Auth: site_admin / vendor_admin / service_writer / technician of
    the workshop that owns the WO. Cross-tenant returns 403 via
    `_ensure_can_act`.
    """
    lang = get_request_language(request)

    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(
            UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN,
            UserRole.SERVICE_WRITER, UserRole.TECHNICIAN,
        ),
        lang=lang,
    )
    if wo.status != WorkOrderStatus.ACCEPTED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO is {wo.status.value if hasattr(wo.status, 'value') else wo.status}; "
            f"only accepted WOs can be checked out",
        )
    if wo.picked_up_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"WO already picked up at {wo.picked_up_at.isoformat()}",
        )

    pairs = await _ready_primary_ros_for_vehicle(
        session,
        vehicle_id=wo.vehicle_id,
        require_scheduled_start=True,
        require_not_picked_up=True,
    )
    if not pairs:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "no accepted WO on this vehicle has a confirmed pickup window "
            "(scheduled_start_at must be set by the DSP first)",
        )

    now = utc_now()
    updated_wo_ids: list[int] = []
    for _ro, sibling_wo in pairs:
        sibling_wo.picked_up_at = now
        sibling_wo.picked_up_by_id = current.id
        session.add(sibling_wo)
        updated_wo_ids.append(sibling_wo.id)
        await log_event(
            session,
            entity_type=WoActivityLogEntityType.WORK_ORDER,
            entity_id=sibling_wo.id,
            action="checked_out",
            actor_id=current.id,
            details={
                "vehicle_id": wo.vehicle_id,
                "triggering_work_order_id": wo.id,
                "sibling_count": len(pairs) - 1,
                "photo_count": len(body.photos),
            },
        )

    # Photos — only on the TARGET WO. Siblings stay un-photographed at
    # the DB level; the frontend joins vehicle-wide at render time so
    # all rows for the same van display the same images.
    if body.photos:
        from app.models.work_orders import WorkOrderPhoto, WorkOrderPhotoStage
        for p in body.photos:
            row = WorkOrderPhoto(
                work_order_id=wo.id,
                stage=WorkOrderPhotoStage.VEHICLE_ARRIVAL,
                storage_path=p.storage_key,
                caption=(
                    (body.notes or "").strip() if (body.notes and not p.caption)
                    else p.caption
                ),
                created_by_id=current.id,
            )
            session.add(row)

    await session.commit()
    await session.refresh(wo)

    for sibling_wo in (p[1] for p in pairs):
        try:
            await _publish_wo_changed(sibling_wo, "checked_out")
        except Exception:  # noqa: BLE001
            pass

    return await _build_wo_response(session, wo)



# ═════════════════════════════════════════════════════
# WO V2 iter-1 — RO sync events (spec §3.6 + activity-log catalog)
# ═════════════════════════════════════════════════════
#
# Single endpoint for the SW to stamp the manually-managed sync columns
# on a work_order_ro row. Five events:
#
#   parts_ordered    → parts_ordered_at = now()
#   parts_received   → parts_received_at = now()
#   submitted_to_fmc → submitted_to_fmc_at = now()
#   fmc_approved     → fmc_approved_at = now()
#   no_show          → vendor_status = 'no_show'    (no dedicated column)
#
# Each emits the matching wo_activity_log action verb so the customer
# dashboard timeline + analytics queries get a clean event stream. In
# production this same code path is hit by a vendor-system webhook
# (RO Writer / Mitchell / Auto Integrate); the SW button is just the
# manual fallback.

_RO_SYNC_EVENTS = ("parts_ordered", "parts_received", "submitted_to_fmc", "fmc_approved", "no_show")
# Subset that requires an FMC-billed (AMR) flavour to make sense. Only
# soft-enforced via a comment for now — adding a hard check would mean
# joining out to defects.defect_group, which a sloppy SW would just route
# around. Keep the affordance, document the expectation.


class RoSyncEventBody(BaseModel):
    """Body for POST /work-orders/{wo_id}/ros/{ro_id}/sync-event."""

    model_config = ConfigDict(extra="forbid")

    event: str = Field(
        ...,
        description="One of: parts_ordered, parts_received, submitted_to_fmc, fmc_approved, no_show.",
    )
    note: str | None = Field(
        default=None, max_length=500,
        description="Free-text context (vendor reference number, FMC ticket ID, etc.).",
    )


class RoSyncEventResponse(BaseModel):
    ro_id: int
    work_order_id: str
    event: str
    stamped_at: datetime
    prior_value: datetime | str | None = Field(
        default=None,
        description="What the column was before (for idempotency / debugging). "
                    "datetime for *_at columns, str for vendor_status (no_show).",
    )


@router.post(
    "/manual",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Manual SW-created WO from scratch (wizard from Vendor Home + Create WO)",
)
async def manual_create_wo(
    body: dict = Body(...),
    request: Request = None,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Wizard-driven manual WO creation (mockup pages 4-6).

    Chain:
      1. Validate inputs (SW role + workshop access + vehicle + catalog)
      2. Create Defect — source mapped from reason_code:
           newly_discovered  → shop_finding
           secondary         → shop_finding
           auto_integrate    → maintenance_request
           customer_requested→ customer_report
           other             → other
      3. Manual auto-approve the scope review with current SW as reviewer.
         (Per the mockup banner: "Shop created defects must be approved by
         customers for work authorization" — the customer's separate cost
         decision still gates billing; this step just clears the scope-
         review gate so the bundler can route it.)
      4. Bundler picks up the approved defect → RR.
      5. Force-route the RR to the chosen workshop (defaults to caller's
         first workshop if not given). Creates a WO in pending_acceptance.
      6. If ro_number given, patch the auto-created TBD-{id} placeholder.

    The SW finds the new WO in their Work Orders list immediately — no
    extra step. Customer sees the defect in their existing review queue
    AFTER acceptance (the WO acceptance is the SW's job per normal flow).
    """
    from app.routes.vehicles import _parse_vehicle_id
    from app.services.defect_validation import validate_defect_write, DefectValidationError
    from app.services.wo_defect_reviews import manual_review
    from app.services.wo_bundler import consider_defect_for_bundling
    from app.services.wo_router import route_repair_request

    lang = get_request_language(request) if request else "en"

    # ── Role gate ─────────────────────────────────────
    if current.role not in (UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.SERVICE_WRITER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "manual create requires vendor SW role")

    # ── Vehicle ──────────────────────────────────────
    vehicle_raw = body.get("vehicle_id") or body.get("vehicleId")
    if not vehicle_raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "vehicle_id required")
    vid = _parse_vehicle_id(str(vehicle_raw))
    vehicle = (await session.execute(select(Vehicle).where(Vehicle.id == vid))).scalar_one_or_none()
    if vehicle is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")

    # ── Defect inputs ────────────────────────────────
    part = body.get("part")
    defect_type = body.get("defect_type") or body.get("defectType")
    position = body.get("position")
    description = body.get("description") or body.get("notes")
    reason_code = (body.get("reason_code") or body.get("reasonCode") or "newly_discovered").strip()

    if not part or not defect_type:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "part + defect_type required")

    # Map reason_code → DefectSource (validates the reason too).
    REASON_TO_SOURCE = {
        "newly_discovered": DefectSource.SHOP_FINDING,
        "secondary": DefectSource.SHOP_FINDING,
        "auto_integrate": DefectSource.MAINTENANCE_REQUEST,
        "customer_requested": DefectSource.CUSTOMER_REPORT,
        "other": DefectSource.OTHER,
    }
    src = REASON_TO_SOURCE.get(reason_code)
    if src is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"reason_code must be one of: {list(REASON_TO_SOURCE)}",
        )

    # ── Catalog validation ───────────────────────────
    try:
        await validate_defect_write(
            session,
            part=part,
            defect_type=defect_type,
            position=position,
            details={},
            source=src,
            inspection_id=None,
            vehicle_class=vehicle.vehicle_class,
        )
    except DefectValidationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    # ── Create the Defect ────────────────────────────
    defect = Defect(
        vehicle_id=vid,
        inspection_id=None,
        source=src,
        part=part,
        defect_type=defect_type,
        position=position,
        details={},
        notes=(f"[reason: {reason_code}] " + (description or "")).strip(),
        reported_by_id=current.id,
    )
    session.add(defect)
    try:
        await session.flush()
    except IntegrityError as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "duplicate defect on this vehicle (same part/position/type already exists)",
        ) from e

    # ── Auto-approve scope so bundler can route ──────
    await manual_review(
        session,
        defect_id=defect.id,
        decision=DefectReviewDecision.APPROVED,
        reviewer_id=current.id,
        reason=f"shop-created via Vendor Home wizard (reason: {reason_code})",
    )

    # ── Bundler → RR ─────────────────────────────────
    await consider_defect_for_bundling(session, defect_id=defect.id, actor_id=current.id)

    # ── Resolve target workshop + force-route ────────
    target_ws = body.get("vendor_workshop_id") or body.get("vendorWorkshopId")
    if target_ws is None:
        # Default to the caller's first workshop.
        my_workshops = await _vendor_workshop_ids_for_user(session, current)
        if not my_workshops:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "no vendor_workshop_id provided and you have no workshops",
            )
        target_ws = my_workshops[0]
    target_ws = int(target_ws)

    # Find the RR the bundler just created for this defect.
    rr_row = (
        await session.execute(
            select(RepairRequestDefect.repair_request_id)
            .where(RepairRequestDefect.defect_id == defect.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if rr_row is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "bundler did not create an RR for the new defect (unexpected)",
        )

    new_wo = await route_repair_request(
        session,
        repair_request_id=rr_row,
        actor_id=current.id,
        target_workshop_id=target_ws,
    )

    # ── Optional: replace the auto TBD-{id} placeholder RO ──
    ro_number_raw = body.get("ro_number") or body.get("roNumber")
    if new_wo is not None and ro_number_raw:
        # The /accept endpoint adds the placeholder, but here the WO is
        # still pending_acceptance (no placeholder yet). Add an RO row
        # directly so the SW's typed RO# sticks from the start.
        new_ro = WorkOrderRo(
            work_order_id=new_wo.id,
            ro_number=str(ro_number_raw).strip(),
            is_primary=True,
            added_by_id=current.id,
        )
        session.add(new_ro)

    await session.commit()
    if new_wo is not None:
        await session.refresh(new_wo)

    return {
        "defect_id": defect.id,
        "repair_request_id": rr_row,
        "work_order_id": new_wo.id if new_wo else None,
        "work_order_id_str": new_wo.id_str if new_wo else None,
        "routed": new_wo is not None,
    }


@router.post(
    "/{wo_id}/ros/{ro_id}/sync-event",
    response_model=RoSyncEventResponse,
    summary="SW: stamp an RO sync event (parts_ordered, FMC submitted, no_show, …)",
)
async def ro_sync_event(
    body: RoSyncEventBody,
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    ro_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RoSyncEventResponse:
    """Record a sync milestone on a WO's RO. In production this is what
    a vendor-system webhook would call; in iter-1 the SW also has buttons
    on the WO modal.

    Pre-conditions:
      - WO must be accepted or in_progress (sync events don't make sense
        before acceptance or after completion).
      - RO must belong to this WO.
      - Event is not idempotent — re-stamping overwrites the prior value
        and the response carries `prior_value` so the UI can warn the SW
        ("you already recorded this 4h ago — sure you want to overwrite?").
    """
    lang = get_request_language(request)

    if body.event not in _RO_SYNC_EVENTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"event must be one of {_RO_SYNC_EVENTS}",
        )

    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    await _ensure_can_act(
        session,
        wo=wo,
        user=current,
        allowed_roles=(UserRole.SITE_ADMIN, UserRole.VENDOR_ADMIN, UserRole.SERVICE_WRITER),
        lang=lang,
    )

    if wo.status not in (WorkOrderStatus.ACCEPTED, WorkOrderStatus.IN_PROGRESS):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"work order status is {wo.status.value}; "
            "sync events require accepted or in_progress",
        )

    ro = (
        await session.execute(
            select(WorkOrderRo)
            .where(WorkOrderRo.id == ro_id)
            .where(WorkOrderRo.work_order_id == wo.id)
        )
    ).scalar_one_or_none()
    if ro is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "RO not found on this WO")

    now = utc_now()
    prior_value: datetime | str | None = None
    if body.event == "parts_ordered":
        prior_value = ro.parts_ordered_at
        ro.parts_ordered_at = now
    elif body.event == "parts_received":
        prior_value = ro.parts_received_at
        ro.parts_received_at = now
    elif body.event == "submitted_to_fmc":
        prior_value = ro.submitted_to_fmc_at
        ro.submitted_to_fmc_at = now
    elif body.event == "fmc_approved":
        prior_value = ro.fmc_approved_at
        ro.fmc_approved_at = now
    elif body.event == "no_show":
        prior_value = ro.vendor_status
        ro.vendor_status = "no_show"

    session.add(ro)

    details: dict = {
        "vehicle_id": wo.vehicle_id,
        "work_order_id": wo.id,
        "ro_number": ro.ro_number,
        "stamped_at": now.isoformat(),
        "note": body.note,
    }
    if prior_value is not None:
        details["prior_value"] = (
            prior_value.isoformat() if isinstance(prior_value, datetime) else str(prior_value)
        )

    await log_event(
        session,
        entity_type=WoActivityLogEntityType.RO,
        entity_id=ro.id,
        action=body.event,  # spec-matched verb (parts_ordered, no_show, …)
        actor_id=current.id,
        details=details,
    )

    await session.commit()
    await session.refresh(ro)

    # Best-effort SSE — touch the WO so the DSP dashboard refreshes its
    # row. The sync-event itself isn't directly visible to DSP today, but
    # the timeline panel reads from wo_activity_log so a refetch surfaces it.
    try:
        await _publish_wo_changed(wo, f"ro_{body.event}")
    except Exception:  # noqa: BLE001
        pass

    return RoSyncEventResponse(
        ro_id=ro.id,
        work_order_id=wo.id_str,
        event=body.event,
        stamped_at=now,
        prior_value=prior_value,
    )


# ═════════════════════════════════════════════════════
# WO V2 iter-1 — activity log read endpoint
# ═════════════════════════════════════════════════════
#
# Returns the merged audit trail for a WO and all its child entities
# (ROs, notes — the demo shows these inline under the "Activity (N)"
# disclosure). We DON'T mix in defect_review activity here because that
# lives on the RR, not the WO; the customer-side defect approval modal
# has its own activity tab on the defect itself.


class ActivityLogEntry(BaseModel):
    """A single wo_activity_log row reshaped for the WO modal timeline."""

    id: int
    entity_type: Literal[
        "repair_request", "work_order", "line_item",
        "defect_resolution", "defect_review", "note", "ro",
    ]
    entity_id: int
    action: str
    actor_id: int | None
    actor_name: str | None
    details: dict
    created_at: datetime


class ActivityLogResponse(BaseModel):
    items: list[ActivityLogEntry]
    total: int = Field(
        ..., description="Total count over the filter (independent of limit)."
    )


@router.get(
    "/{wo_id}/activity",
    response_model=ActivityLogResponse,
    summary="Read the activity timeline for a WO (WO + its ROs + notes)",
)
async def get_wo_activity(
    request: Request,
    wo_id: str = Path(..., examples=["WO-00001"]),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ActivityLogResponse:
    """Merge the WO's own log with its child ROs' + notes' logs, sorted
    newest first. Used by the WO detail modal's "Activity (N)" panel.

    Tenancy: same as get_work_order — the caller has to be able to see
    the WO at all.
    """
    lang = get_request_language(request)
    wo = await _load_wo_or_404(session, _parse_wo_id(wo_id), lang)
    if not await _can_view_wo(session, wo, current):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_WORK_ORDER, lang)
        )

    # Look up the child entity IDs once — we OR them into the main query
    # so we don't have to UNION two SELECTs.
    ro_ids = list(
        (
            await session.execute(
                select(WorkOrderRo.id).where(WorkOrderRo.work_order_id == wo.id)
            )
        ).scalars()
    )
    note_ids = list(
        (
            await session.execute(
                select(WorkOrderNote.id).where(WorkOrderNote.work_order_id == wo.id)
            )
        ).scalars()
    )

    # Build (entity_type, entity_id) predicates for each child set.
    conditions = [
        and_(
            WoActivityLog.entity_type == WoActivityLogEntityType.WORK_ORDER,
            WoActivityLog.entity_id == wo.id,
        )
    ]
    if ro_ids:
        conditions.append(
            and_(
                WoActivityLog.entity_type == WoActivityLogEntityType.RO,
                WoActivityLog.entity_id.in_(ro_ids),
            )
        )
    if note_ids:
        conditions.append(
            and_(
                WoActivityLog.entity_type == WoActivityLogEntityType.NOTE,
                WoActivityLog.entity_id.in_(note_ids),
            )
        )
    # The repair_request the WO descends from also belongs in the timeline
    # (routed / no_eligible_vendor / status rollups). Cheap join, single
    # row from the WO so just OR in the RR's entries.
    conditions.append(
        and_(
            WoActivityLog.entity_type == WoActivityLogEntityType.REPAIR_REQUEST,
            WoActivityLog.entity_id == wo.repair_request_id,
        )
    )

    base = select(WoActivityLog).where(or_(*conditions))

    # Total count for pagination metadata. Use the same WHERE so we don't
    # diverge from the page query.
    total_q = select(func.count(WoActivityLog.id)).where(or_(*conditions))
    total = (await session.execute(total_q)).scalar() or 0

    page_q = (
        base.order_by(WoActivityLog.created_at.desc(), WoActivityLog.id.desc())
        .offset(offset)
        .limit(limit)
    )
    log_rows = list((await session.execute(page_q)).scalars().all())

    # Resolve actor names in one round-trip so the timeline can print
    # "Mario set parts_ordered_at" instead of "user 17".
    actor_ids = {r.actor_id for r in log_rows if r.actor_id is not None}
    actor_names: dict[int, str] = {}
    if actor_ids:
        users = (
            await session.execute(
                select(User.id, User.full_name).where(User.id.in_(actor_ids))
            )
        ).all()
        actor_names = {uid: name for uid, name in users}

    items = [
        ActivityLogEntry(
            id=r.id,
            entity_type=(
                r.entity_type.value if hasattr(r.entity_type, "value")
                else str(r.entity_type)
            ),
            entity_id=r.entity_id,
            action=r.action,
            actor_id=r.actor_id,
            actor_name=actor_names.get(r.actor_id) if r.actor_id else None,
            details=r.details or {},
            created_at=r.created_at,
        )
        for r in log_rows
    ]
    return ActivityLogResponse(items=items, total=total)
