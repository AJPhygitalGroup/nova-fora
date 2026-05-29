"""SQLModel table definitions.

Import all models here so Alembic's autogenerate sees them.
Adding a new table = add an import line below + run `alembic revision --autogenerate`.

WO V2.0 note (branch `wo-v2-rebuild`):
  The V1 `WorkOrder` / `WorkOrderItem` models were deleted in PR 2 of
  the rebuild. The 14 new V2.0 entities live in `app.models.work_orders`
  (folder package). They're exported here for Alembic visibility AND for
  convenience: callers can keep doing `from app.models import WorkOrder`.
"""
from app.models.base import timestamp_column, utc_now
from app.models.defect import Defect, DefectSource
from app.models.defect_catalog import (
    DefectApplicability,
    DefectClassification,
    DefectGroup,
    DefectPart,
    DefectPartSystem,
    DefectPosition,
    DefectRule,
    DefectSystem,
    DefectType,
    DvicSection,
    DvicTemplateItem,
    InspectionRule,
    InspectionRuleLine,
    InspectionRuleSource,
    InspectionRuleTarget,
    PartGroupDefault,
    VehicleClass,
)
from app.models.inspection import (
    DefectStatus,
    Inspection,
    InspectionResult,
    InspectionStatus,
    OdometerSource,
)
from app.models.inspection_part_mark import (
    InspectionPartMark,
    InspectionPartMarkStatus,
)
from app.models.invitation import Invitation, InvitationStatus
from app.models.organization import OrgType, Organization
from app.models.photo import Photo, PhotoCategory
from app.models.user import User, UserRole, UserStatus
from app.models.vehicle import Ownership, Vehicle
from app.models.vehicle_note import VehicleNote
from app.models.work_orders import (
    CustomerPreferredVendor,
    DeclineReasonCode,
    RepairFeedback,
    DvicNightlyConfirmation,
    DvicSchedule,
    RewardsProgram,
    RewardsTier,
    DefectResolution,
    DefectResolutionStatus,
    DefectReview,
    DefectReviewDecision,
    DefectReviewDecisionMethod,
    DspSetting,
    LineItemBillingType,
    LineItemCategory,
    LineItemStatus,
    NoteAuthorRole,
    RepairRequest,
    RepairRequestDefect,
    RepairRequestStatus,
    RepairType,
    StatusTrackingMode,
    VendorBucksLedger,
    VendorWorkshop,
    WoActivityLog,
    WoActivityLogEntityType,
    WorkOrder,
    WorkOrderLineItem,
    WorkOrderLineItemResolution,
    WorkOrderNote,
    WorkOrderPhoto,
    WorkOrderPhotoStage,
    WorkOrderRo,
    WorkOrderStatus,
)

__all__ = [
    # Defects
    "Defect",
    "DefectApplicability",
    "DefectClassification",
    "DefectGroup",
    "DefectPart",
    "DefectPartSystem",
    "DefectPosition",
    "DefectRule",
    "DefectSource",
    "DefectStatus",
    "DefectSystem",
    "DefectType",
    "DvicSection",
    "DvicTemplateItem",
    # Inspections
    "Inspection",
    "InspectionPartMark",
    "InspectionPartMarkStatus",
    "InspectionResult",
    "InspectionRule",
    "InspectionRuleLine",
    "InspectionRuleSource",
    "InspectionRuleTarget",
    "InspectionStatus",
    "OdometerSource",
    # Invitations
    "Invitation",
    "InvitationStatus",
    # Org / user / vehicle
    "OrgType",
    "Organization",
    "Ownership",
    "PartGroupDefault",
    "Photo",
    "PhotoCategory",
    "User",
    "UserRole",
    "UserStatus",
    "Vehicle",
    "VehicleClass",
    "VehicleNote",
    # WO V2.0 (14 tables + enums)
    "CustomerPreferredVendor",
    "DeclineReasonCode",
    "RepairFeedback",
    "RewardsProgram",
    "RewardsTier",
    "DefectResolution",
    "DefectResolutionStatus",
    "DefectReview",
    "DefectReviewDecision",
    "DefectReviewDecisionMethod",
    "DspSetting",
    "LineItemBillingType",
    "LineItemCategory",
    "LineItemStatus",
    "NoteAuthorRole",
    "RepairRequest",
    "RepairRequestDefect",
    "RepairRequestStatus",
    "RepairType",
    "StatusTrackingMode",
    "VendorWorkshop",
    "WoActivityLog",
    "WoActivityLogEntityType",
    "WorkOrder",
    "WorkOrderLineItem",
    "WorkOrderLineItemResolution",
    "WorkOrderNote",
    "WorkOrderPhoto",
    "WorkOrderPhotoStage",
    "WorkOrderRo",
    "WorkOrderStatus",
    # Base utilities
    "timestamp_column",
    "utc_now",
]
