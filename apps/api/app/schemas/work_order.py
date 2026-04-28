"""WorkOrder + WorkOrderItem Pydantic schemas."""
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.work_order import WorkOrderFlag, WorkOrderStatus


# ─────────────────────────────────────────────────────
# Item schemas (WO line items, M:N to defects)
# ─────────────────────────────────────────────────────
class WorkOrderItemCreate(BaseModel):
    """One line item when creating a WO. References an existing defect."""

    defect_id: str = Field(..., description="Int or 'FD-XXX'")
    repair_notes: str | None = Field(default=None, max_length=2000)
    line_parts_cost: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    line_labor_cost: Decimal | None = Field(default=None, ge=0, decimal_places=2)

    model_config = ConfigDict(extra="forbid")


class WorkOrderItemResponse(BaseModel):
    """One item embedded inside WorkOrderResponse — surfaces the linked
    defect's display fields so the FE doesn't N+1.
    """

    id: str  # WOI-XXXX
    defect_id: str  # FD-XXX
    repair_notes: str | None = None
    line_parts_cost: Decimal | None = None
    line_labor_cost: Decimal | None = None

    # Denorm of the linked defect (so the FE renders without extra fetches)
    defect_section: str | None = None
    defect_part: str | None = None
    defect_description: str | None = None
    defect_status: str | None = None
    defect_is_v2: bool = False
    defect_part_label: str | None = None
    defect_part_icon: str | None = None
    defect_position_label: str | None = None
    defect_type_label: str | None = None
    defect_type_icon: str | None = None
    defect_details: dict | None = None

    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ─────────────────────────────────────────────────────
# WorkOrder schemas
# ─────────────────────────────────────────────────────
class WorkOrderCreate(BaseModel):
    """POST /work-orders body.

    A WO is born from one or more existing defects. The DSP picks defects
    that have been approved (status ∈ acknowledged/sent_to_vendor) and
    bundles them into a single trip-to-shop.

    The vendor is explicit (DSP picks who fixes it). Vehicle is derived from
    the defects (all must belong to the same vehicle — enforced server-side).
    """

    vendor_id: str = Field(..., description="Vendor org id ('V-XXX' or int)")
    items: list[WorkOrderItemCreate] = Field(
        ..., min_length=1,
        description="Defects to bundle into this WO. Min 1.",
    )
    flags: list[WorkOrderFlag] = Field(default_factory=list)
    scheduled_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=4000)
    fmc: str | None = Field(default=None, max_length=40)
    ro_number: str | None = Field(default=None, max_length=50)

    model_config = ConfigDict(extra="forbid")

    @field_validator("flags")
    @classmethod
    def _dedup_flags(cls, v: list[WorkOrderFlag]) -> list[WorkOrderFlag]:
        seen, out = set(), []
        for f in v:
            if f not in seen:
                seen.add(f)
                out.append(f)
        return out


class WorkOrderStatusUpdate(BaseModel):
    """PATCH /work-orders/{id}/status body.

    Server-side validation enforces the state-machine transitions
    (see WorkOrderStatusTransition below).
    """

    status: WorkOrderStatus
    decline_reason: str | None = Field(default=None, max_length=500)
    cancel_reason: str | None = Field(default=None, max_length=500)
    scheduled_at: datetime | None = None
    notes_append: str | None = Field(
        default=None, max_length=2000,
        description="Optional note to append to the WO's notes field.",
    )

    model_config = ConfigDict(extra="forbid")


class WorkOrderAssign(BaseModel):
    """PATCH /work-orders/{id}/assign body — vendor assigns a technician."""

    technician_id: str | None = Field(
        default=None,
        description="User id (int or 'usr-XXX') of the tech to assign. "
                    "Pass null/omit to unassign.",
    )
    notes_append: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(extra="forbid")


class WorkOrderItemAdd(BaseModel):
    """POST /work-orders/{id}/items — add another defect to existing WO."""

    items: list[WorkOrderItemCreate] = Field(..., min_length=1)

    model_config = ConfigDict(extra="forbid")


class WorkOrderQuoteUpdate(BaseModel):
    """PATCH /work-orders/{id}/quote — vendor submits parts/labor cost."""

    parts_cost: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    labor_cost: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    ro_number: str | None = Field(default=None, max_length=50)

    model_config = ConfigDict(extra="forbid")


class WorkOrderResponse(BaseModel):
    """GET /work-orders/{id} — full detail with items inline."""

    id: str  # WO-XXXXX

    # Parties (string-id'd for FE)
    dsp_id: str
    dsp: str
    vendor_id: str
    vendor: str

    # Vehicle context
    vehicle_id: str       # VAN-XXXX
    fleet_id: str | None = None
    plate: str | None = None
    year: int | None = None
    make: str | None = None
    model: str | None = None
    vin: str | None = None
    last_mileage: int | None = None

    # People
    created_by: str | None = None  # user.full_name
    created_by_id: str | None = None
    assigned_technician: str | None = None
    assigned_technician_id: str | None = None

    # Workflow
    status: WorkOrderStatus
    flags: list[str] = Field(default_factory=list)

    # Schedule
    scheduled_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None

    # Commercial
    ro_number: str | None = None
    fmc: str | None = None
    parts_cost: Decimal | None = None
    labor_cost: Decimal | None = None
    total_cost: Decimal | None = None

    # Reasons / context
    notes: str | None = None
    decline_reason: str | None = None
    cancel_reason: str | None = None

    # Counters
    photo_count: int = 0
    item_count: int = 0

    # Bundled defects
    items: list[WorkOrderItemResponse] = Field(default_factory=list)

    # Timestamps
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkOrderListItem(BaseModel):
    """GET /work-orders list item — flat, no items inline (lighter)."""

    id: str
    dsp_id: str
    dsp: str
    vendor_id: str
    vendor: str
    vehicle_id: str
    fleet_id: str | None = None
    plate: str | None = None
    status: WorkOrderStatus
    flags: list[str] = Field(default_factory=list)
    item_count: int = 0
    photo_count: int = 0
    scheduled_at: datetime | None = None
    completed_at: datetime | None = None
    total_cost: Decimal | None = None
    ro_number: str | None = None
    assigned_technician: str | None = None
    created_by: str | None = None
    created_at: datetime

    # Quick-look summary line (most-severe defect or count)
    summary: str | None = None

    model_config = ConfigDict(from_attributes=True)


class WorkOrderListResponse(BaseModel):
    items: list[WorkOrderListItem]
    total: int
    page: int
    per_page: int


# ─────────────────────────────────────────────────────
# State machine — allowed transitions
# ─────────────────────────────────────────────────────
# Each key maps the CURRENT status to the set of statuses that can be
# reached from there. Used by the route layer to 400 on invalid moves.
WORK_ORDER_TRANSITIONS: dict[WorkOrderStatus, set[WorkOrderStatus]] = {
    WorkOrderStatus.PENDING: {
        WorkOrderStatus.ACKNOWLEDGED,
        WorkOrderStatus.DECLINED,
        WorkOrderStatus.CANCELED,
    },
    WorkOrderStatus.ACKNOWLEDGED: {
        WorkOrderStatus.SCHEDULED,
        WorkOrderStatus.IN_PROGRESS,
        WorkOrderStatus.DECLINED,
        WorkOrderStatus.CANCELED,
    },
    WorkOrderStatus.SCHEDULED: {
        WorkOrderStatus.IN_PROGRESS,
        WorkOrderStatus.CANCELED,
    },
    WorkOrderStatus.IN_PROGRESS: {
        WorkOrderStatus.COMPLETED,
    },
    # Terminal states — no further transitions
    WorkOrderStatus.COMPLETED: set(),
    WorkOrderStatus.DECLINED: set(),
    WorkOrderStatus.CANCELED: set(),
}
