"""V2.0 Work Order models — 14 SQLModel tables in the `public` schema.

Each entity lives in its own file for readability. They are re-exported
here so callers can `from app.models.work_orders import WorkOrder, …`
without knowing the file layout.

See docs/wo-v2-rebuild.md for the schema spec + adaptation log.

Convention notes:
  - All enums are stored as VARCHAR (CLAUDE.md rule #2). Each enum class
    is a `str, Enum` so writes use `.value` cleanly.
  - No SQLAlchemy `relationship()` between models — pure int FK columns.
    Routes/services do explicit joins. Keeps imports flat + avoids the
    well-known SQLModel circular-import pain.
  - `updated_at` is auto-set by the global listener in `models/base.py`.
  - `id_str` properties match the frontend's prefix convention (WO-XXXXX,
    RR-XXX, etc.) when relevant.
"""
from app.models.work_orders.customer_preferred_vendor import CustomerPreferredVendor
from app.models.work_orders.decline_reason_code import DeclineReasonCode
from app.models.work_orders.dvic_nightly_confirmation import DvicNightlyConfirmation
from app.models.work_orders.vendor_bucks_ledger import VendorBucksLedger
from app.models.work_orders.rewards_program import RewardsProgram, RewardsTier
from app.models.work_orders.defect_resolution import (
    DefectResolution,
    DefectResolutionStatus,
)
from app.models.work_orders.defect_review import (
    DefectReview,
    DefectReviewDecision,
    DefectReviewDecisionMethod,
)
from app.models.work_orders.dsp_setting import DspSetting
from app.models.work_orders.enums import (
    DspWoResponse,
    LineItemBillingType,
    LineItemCategory,
    LineItemStatus,
    NoteAuthorRole,
    RepairBucket,
    RepairRequestStatus,
    RepairType,
    StatusTrackingMode,
    WorkOrderStatus,
)
from app.models.work_orders.repair_request import RepairRequest
from app.models.work_orders.repair_request_defect import RepairRequestDefect
from app.models.work_orders.vendor_workshop import VendorWorkshop
from app.models.work_orders.wo_activity_log import (
    WoActivityLog,
    WoActivityLogEntityType,
)
from app.models.work_orders.work_order import WorkOrder
from app.models.work_orders.work_order_line_item import WorkOrderLineItem
from app.models.work_orders.work_order_line_item_resolution import (
    WorkOrderLineItemResolution,
)
from app.models.work_orders.work_order_note import WorkOrderNote, WorkOrderNoteChannel
from app.models.work_orders.work_order_photo import WorkOrderPhoto, WorkOrderPhotoStage
from app.models.work_orders.work_order_ro import WorkOrderRo

__all__ = [
    # Enums
    "DefectResolutionStatus",
    "DefectReviewDecision",
    "DefectReviewDecisionMethod",
    "DspWoResponse",
    "LineItemBillingType",
    "LineItemCategory",
    "LineItemStatus",
    "NoteAuthorRole",
    "RepairBucket",
    "RepairRequestStatus",
    "RepairType",
    "StatusTrackingMode",
    "WoActivityLogEntityType",
    "WorkOrderNoteChannel",
    "WorkOrderPhotoStage",
    "WorkOrderStatus",
    # Tables
    "CustomerPreferredVendor",
    "DeclineReasonCode",
    "DvicNightlyConfirmation",
    "RewardsProgram",
    "RewardsTier",
    "DefectResolution",
    "DefectReview",
    "DspSetting",
    "RepairRequest",
    "RepairRequestDefect",
    "VendorBucksLedger",
    "VendorWorkshop",
    "WoActivityLog",
    "WorkOrder",
    "WorkOrderLineItem",
    "WorkOrderLineItemResolution",
    "WorkOrderNote",
    "WorkOrderPhoto",
    "WorkOrderRo",
]
