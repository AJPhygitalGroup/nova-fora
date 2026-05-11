"""RepairRequest — bundling layer between approved defects and WorkOrders.

After a defect's scope is approved (defect_review.decision='approved'),
the bundler worker waits `dsp_settings.bundling_window_minutes` (default
30) before creating an RR. During that window, additional approved
defects for the same `(vehicle_id, repair_type)` join the forming RR.

One RR routes to one vendor → one WO at creation. If the vendor declines
(`work_orders.status='declined'`), the RR stays `open` and a re-route
creates another WO under the same RR (multi-WO-per-RR pattern).

Parts-pending defers spawn a follow-up RR via `parent_repair_request_id`.
"""
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now
from app.models.work_orders.enums import RepairRequestStatus, RepairType


class RepairRequest(SQLModel, table=True):
    __tablename__ = "repair_requests"

    id: int | None = Field(default=None, primary_key=True)
    vehicle_id: int = Field(foreign_key="vehicles.id", index=True, nullable=False)
    dsp_id: int = Field(
        foreign_key="organizations.id",
        index=True,
        nullable=False,
        description="DSP that owns the vehicle. Denormalized for query speed.",
    )
    repair_type: RepairType = Field(
        sa_column=Column(
            "repair_type",
            sa.Enum(
                RepairType,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
        ),
    )
    status: RepairRequestStatus = Field(
        sa_column=Column(
            "status",
            sa.Enum(
                RepairRequestStatus,
                native_enum=False,
                length=30,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
            server_default=RepairRequestStatus.OPEN.value,
        ),
    )
    is_rush: bool = Field(default=False, nullable=False)
    sla_due_at: datetime | None = Field(
        default=None,
        sa_column=Column("sla_due_at", sa.DateTime(timezone=True), nullable=True),
    )
    parent_repair_request_id: int | None = Field(
        default=None,
        foreign_key="repair_requests.id",
        index=True,
        description="Set on follow-up RRs (e.g., parts_unavailable defer). "
                    "Points to the RR that spawned this one.",
    )

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )
    created_by_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="The Nova user who triggered creation. NULL when the "
                    "bundler worker created it (system path).",
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID. RR-00123 etc."""
        return f"RR-{self.id:05d}" if self.id is not None else ""
