"""Organization model — represents a DSP, Vendor, or the platform itself.

Design note: organizations have an internal integer `id` but the frontend demo
expects string IDs with prefixes (DSP-4201, V-001, NF-000). The API serializes
with `id_str` — see app/schemas/organization.py.
"""
from enum import Enum

from sqlmodel import Field

from app.models.base import TimestampMixin


class OrgType(str, Enum):
    """Top-level org classification."""

    DSP = "dsp"          # Delivery Service Provider (ej. Ribrell 21) — Amazon last-mile
    VENDOR = "vendor"    # Mechanic shop / repair vendor (ej. Dulles Midas)
    PLATFORM = "platform"  # Nova Fora itself (site admin's home org)


class Organization(TimestampMixin, table=True):
    __tablename__ = "organizations"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, max_length=200, nullable=False)
    org_type: OrgType = Field(index=True, nullable=False)

    # Contact
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)

    # Soft-delete flag (never hard-delete orgs with historical data)
    is_active: bool = Field(default=True, index=True)

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID with type prefix.

        DSP-4201 / V-001 / NF-000 — matches shapes in nova-fora-demo/src/data/mockData.js.
        """
        if self.id is None:
            return ""
        if self.org_type == OrgType.DSP:
            return f"DSP-{self.id:04d}"
        if self.org_type == OrgType.VENDOR:
            return f"V-{self.id:03d}"
        return f"NF-{self.id:03d}"
