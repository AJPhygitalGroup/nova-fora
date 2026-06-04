"""Organization model — represents a DSP, Vendor, or the platform itself.

Design note: organizations have an internal integer `id` but the frontend demo
expects string IDs with prefixes (DSP-4201, V-001, NF-000). The API serializes
with `id_str` — see app/schemas/organization.py.

Enum storage: we deliberately store enums as VARCHAR (not PG native enum types)
so adding/renaming values doesn't require schema migrations. The `sa_column`
override prevents SQLModel's default behavior of casting to `::orgtype`.
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class OrgType(str, Enum):
    """Top-level org classification."""

    DSP = "dsp"          # Delivery Service Provider (ej. Ribrell 21) — Amazon last-mile
    VENDOR = "vendor"    # Mechanic shop / repair vendor (ej. Dulles Midas)
    PLATFORM = "platform"  # Nova Fora itself (site admin's home org)
    # 2026-06-03 Jorge — body repair port from web-mbk-body-repair-demo.
    # Distinct from VENDOR because body shops have a different lifecycle
    # (quote → schedule pickup → in-shop → pre/post PAVE diff → drop-off
    # → payment) and different role surfaces (no SW assigning techs,
    # quotes-first instead of accept/decline of pre-priced work).
    BODY_REPAIR_VENDOR = "body_repair_vendor"


class Organization(SQLModel, table=True):
    __tablename__ = "organizations"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, max_length=200, nullable=False)
    # Stored as VARCHAR(20) via sa.Enum(..., native_enum=False). Uses .value on
    # write and reconstructs Enum on read — matches the VARCHAR migration.
    org_type: OrgType = Field(
        sa_column=Column(
            "org_type",
            sa.Enum(OrgType, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e]),
            nullable=False,
            index=True,
        )
    )

    # Contact
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)

    # Soft-delete flag (never hard-delete orgs with historical data)
    is_active: bool = Field(default=True, index=True)

    # Timestamps inline (TIMESTAMPTZ) — see app/models/base.py for why.
    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))

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
        if self.org_type == OrgType.BODY_REPAIR_VENDOR:
            return f"BRV-{self.id:03d}"
        return f"NF-{self.id:03d}"
