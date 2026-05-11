"""WorkOrder (V2.0) — vendor execution of one RepairRequest.

A WO is born when the router places an RR with a vendor_workshop. One RR
can have multiple WOs over its lifetime (if vendors decline, re-routes
spawn new WOs under the same RR — the multi-WO-per-RR pattern).

Status lifecycle (CHECK enforced in DB):
  pending_acceptance → accepted → in_progress → completed

Branches:
  - cancelled  (DSP or admin abort at any pre-completion state)
  - declined   (vendor refuses from pending_acceptance; requires
               `decline_reason_code` — not enforced in DB, app contract)

Triggers in the DB:
  - assert_defect_repair_links_on_complete  (refuses `completed` if any
    `defect_repair` line item lacks a link to a defect_resolution)
  - assert_external_mode_ro_present  (refuses `accepted` for an external-
    mode vendor without at least one RO# attached)

Timestamp columns (accepted_at / in_progress_at / completed_at / …) are
NOT auto-filled. App must set them at the corresponding status transition
— per the spec, this keeps backfills + seed data flexible.
"""
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now
from app.models.work_orders.enums import StatusTrackingMode, WorkOrderStatus


class WorkOrder(SQLModel, table=True):
    __tablename__ = "work_orders"

    id: int | None = Field(default=None, primary_key=True)

    # Parties / parent context
    repair_request_id: int = Field(
        foreign_key="repair_requests.id", index=True, nullable=False
    )
    vehicle_id: int = Field(foreign_key="vehicles.id", index=True, nullable=False)
    vendor_workshop_id: int = Field(
        foreign_key="vendor_workshops.id", index=True, nullable=False
    )
    dsp_id: int = Field(
        foreign_key="organizations.id",
        index=True,
        nullable=False,
        description="Denormalized from repair_requests.dsp_id for query speed.",
    )

    # Lifecycle
    status: WorkOrderStatus = Field(
        sa_column=Column(
            "status",
            sa.Enum(
                WorkOrderStatus,
                native_enum=False,
                length=30,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
            server_default=WorkOrderStatus.PENDING_ACCEPTANCE.value,
        ),
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
        ),
        description="Inherited from vendor_workshops at creation; drives the "
                    "RO# requirement at acceptance (trigger enforces).",
    )
    assigned_technician_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        index=True,
        description="Set by the dispatcher (service writer) at accept time. "
                    "Optional — some WOs are 'shop pool'.",
    )

    is_stale: bool = Field(default=False, nullable=False)
    is_rush: bool = Field(
        default=False,
        nullable=False,
        description="Denormalized from RepairRequest at creation. WO's value "
                    "is authoritative for its lifecycle; RR changes don't "
                    "auto-propagate to WO.",
    )
    last_mileage: int | None = Field(
        default=None,
        description="Captured at completion by the vendor. Required for AMR "
                    "billing audit; optional but recommended for CMR.",
    )

    # Decline / cancel context
    cancelled_reason: str | None = Field(default=None)
    declined_reason: str | None = Field(default=None)
    decline_reason_code: str | None = Field(
        default=None,
        foreign_key="decline_reason_codes.code",
        description="Structured code from the lookup. Required when "
                    "status='declined' (app contract; not DB-enforced).",
    )

    # Timestamps — set by app at corresponding status transitions
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )
    accepted_at: datetime | None = Field(
        default=None,
        sa_column=Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
    )
    in_progress_at: datetime | None = Field(
        default=None,
        sa_column=Column("in_progress_at", sa.DateTime(timezone=True), nullable=True),
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    cancelled_at: datetime | None = Field(
        default=None,
        sa_column=Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    declined_at: datetime | None = Field(
        default=None,
        sa_column=Column("declined_at", sa.DateTime(timezone=True), nullable=True),
    )
    marked_stale_at: datetime | None = Field(
        default=None,
        sa_column=Column("marked_stale_at", sa.DateTime(timezone=True), nullable=True),
    )

    created_by_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="Nova user who triggered routing. NULL when the router "
                    "worker did it (system).",
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID. WO-54001 etc. (matches mockData.js shapes.)"""
        return f"WO-{self.id:05d}" if self.id is not None else ""
