"""SQLModel table definitions.

Import all models here so Alembic's autogenerate sees them.
Adding a new table = add an import line below + run `alembic revision --autogenerate`.
"""
from app.models.base import timestamp_column, utc_now
from app.models.defect_catalog import (
    AssetType,
    DefectDetailsSchema,
    DefectPart,
    DefectPartSystem,
    DefectPartValidity,
    DefectPosition,
    DefectSystem,
    DefectType,
    DvicSection,
    DvicTemplateItem,
)
from app.models.inspection import (
    DefectStatus,
    Inspection,
    InspectionResult,
    InspectionStatus,
    OdometerSource,
    ReportedDefect,
)
from app.models.organization import OrgType, Organization
from app.models.photo import Photo, PhotoCategory
from app.models.user import User, UserRole, UserStatus
from app.models.vehicle import Vehicle
from app.models.work_order import (
    WorkOrder,
    WorkOrderFlag,
    WorkOrderItem,
    WorkOrderStatus,
)

__all__ = [
    "AssetType",
    "DefectDetailsSchema",
    "DefectPart",
    "DefectPartSystem",
    "DefectPartValidity",
    "DefectPosition",
    "DefectStatus",
    "DefectSystem",
    "DefectType",
    "DvicSection",
    "DvicTemplateItem",
    "Inspection",
    "InspectionResult",
    "InspectionStatus",
    "OdometerSource",
    "OrgType",
    "Organization",
    "Photo",
    "PhotoCategory",
    "ReportedDefect",
    "User",
    "UserRole",
    "UserStatus",
    "Vehicle",
    "WorkOrder",
    "WorkOrderFlag",
    "WorkOrderItem",
    "WorkOrderStatus",
    "timestamp_column",
    "utc_now",
]
