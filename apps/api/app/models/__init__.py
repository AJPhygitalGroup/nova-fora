"""SQLModel table definitions.

Import all models here so Alembic's autogenerate sees them.
Adding a new table = add an import line below + run `alembic revision --autogenerate`.
"""
from app.models.base import timestamp_column, utc_now
from app.models.organization import OrgType, Organization
from app.models.user import User, UserRole, UserStatus
from app.models.vehicle import Vehicle

__all__ = [
    "OrgType",
    "Organization",
    "User",
    "UserRole",
    "UserStatus",
    "Vehicle",
    "timestamp_column",
    "utc_now",
]
