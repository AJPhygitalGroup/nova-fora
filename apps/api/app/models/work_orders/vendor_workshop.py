"""VendorWorkshop — per-shop catalog (the spec's `work_orders.vendors`).

Distinct from `organizations` rows where `org_type=vendor`. A vendor
organization is the tenant identity (auth, billing); a vendor_workshop is
the operational catalog entry with `repair_types[]` and a
`status_tracking_mode` flag that drives WO acceptance rules.

`organization_id` is nullable: not every workshop belongs to a Nova Fora
tenant org yet (think: the local shop that doesn't have an admin account).
When it's NULL, no users from any org claim ownership; the workshop is a
"directory listing" only.
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now
from app.models.work_orders.enums import StatusTrackingMode


class VendorWorkshop(SQLModel, table=True):
    __tablename__ = "vendor_workshops"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=200, nullable=False)
    organization_id: int | None = Field(
        default=None,
        foreign_key="organizations.id",
        index=True,
        description="The Nova Fora tenant org that owns this workshop, if any. "
                    "NULL = workshop is a directory entry without an account.",
    )
    status_tracking_mode: StatusTrackingMode = Field(
        sa_column=Column(
            "status_tracking_mode",
            sa.Enum(
                StatusTrackingMode,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            server_default=StatusTrackingMode.EXTERNAL.value,
        ),
    )
    repair_types: list[str] = Field(
        default_factory=list,
        sa_column=Column(
            "repair_types",
            ARRAY(sa.String(length=20)),
            nullable=False,
            server_default="{}",
        ),
        description="Subset of RepairType.value strings the shop performs. "
                    "First-match routing checks this array.",
    )
    is_active: bool = Field(default=True, nullable=False, index=True)

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID. VW-001 etc."""
        return f"VW-{self.id:03d}" if self.id is not None else ""
