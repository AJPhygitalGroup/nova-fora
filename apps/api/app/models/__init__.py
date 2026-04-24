"""SQLModel table definitions.

Import all models here so Alembic's autogenerate sees them.
Adding a new table = add an import line below + run `alembic revision --autogenerate`.
"""
from app.models.base import timestamp_column, utc_now
from app.models.inspection import (
    DefectSeverity,
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

__all__ = [
    "DefectSeverity",
    "DefectStatus",
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
    "timestamp_column",
    "utc_now",
]
