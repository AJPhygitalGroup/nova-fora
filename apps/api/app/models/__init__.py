"""SQLModel table definitions.

Import all models here so Alembic's autogenerate sees them.
Adding a new table = add an import line below + run `alembic revision --autogenerate`.
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
from app.models.organization import OrgType, Organization
from app.models.photo import Photo, PhotoCategory
from app.models.user import User, UserRole, UserStatus
from app.models.vehicle import Ownership, Vehicle
from app.models.work_order import (
    WorkOrder,
    WorkOrderFlag,
    WorkOrderItem,
    WorkOrderStatus,
)

__all__ = [
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
    "Inspection",
    "InspectionResult",
    "InspectionRule",
    "InspectionRuleLine",
    "InspectionRuleSource",
    "InspectionRuleTarget",
    "InspectionStatus",
    "OdometerSource",
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
    "WorkOrder",
    "WorkOrderFlag",
    "WorkOrderItem",
    "WorkOrderStatus",
    "timestamp_column",
    "utc_now",
]
