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
from app.models.work_orders.enums import (
    DspWoResponse,
    RepairBucket,
    StatusTrackingMode,
    WorkOrderStatus,
)


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
    # Physical vehicle custody — set when the tech (or SW) records the
    # pickup at the DSP lot via POST /work-orders/{id}/checkout. Distinct
    # from `in_progress_at` (which marks when work actually starts) so a
    # van can be "with the vendor but not yet being worked on". Vehicle-
    # scoped fan-out writes the same picked_up_at to every accepted
    # sibling WO on the vehicle. Alembic 20260602_1900.
    picked_up_at: datetime | None = Field(
        default=None,
        sa_column=Column(
            "picked_up_at", sa.DateTime(timezone=True),
            nullable=True, index=True,
        ),
    )
    picked_up_by_id: int | None = Field(
        default=None,
        sa_column=Column(
            "picked_up_by_id", sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Vehicle returned to the DSP lot. Set by POST /work-orders/{id}/checkin.
    # Mirror of picked_up_at + picked_up_by_id but for the return leg.
    # Decoupled from completed_at (work-done + paperwork) so a van can be
    # back at the DSP lot before the invoice is finalised. Vehicle-scoped
    # fan-out writes the same returned_at to every sibling WO that had
    # picked_up_at set. Alembic 20260603_1200.
    returned_at: datetime | None = Field(
        default=None,
        sa_column=Column(
            "returned_at", sa.DateTime(timezone=True),
            nullable=True, index=True,
        ),
    )
    returned_by_id: int | None = Field(
        default=None,
        sa_column=Column(
            "returned_by_id", sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
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

    # ───────── Scheduling (vendor service-writer / shop manager) ────────
    # When the vendor agrees a slot with the DSP, this fixes the time and
    # bucket (overnight vs shop). NULL = not yet scheduled. Both written
    # in tandem on `POST /work-orders/{id}/schedule` or the assign call.
    scheduled_at: datetime | None = Field(
        default=None,
        sa_column=Column(
            "scheduled_at", sa.DateTime(timezone=True), nullable=True, index=True,
        ),
        description="When the vendor expects to start the repair. Drives the "
                    "DSP-side 'Scheduled Repairs' card (filters within 36h).",
    )
    repair_bucket: RepairBucket | None = Field(
        default=None,
        sa_column=Column(
            "repair_bucket",
            sa.Enum(
                RepairBucket,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=True,
            index=True,
        ),
        description="overnight (returned before dispatch) | shop (held longer).",
    )

    # ───────── DSP response (after vendor schedules) ─────────────────────
    # Lets the DSP confirm the van will be at the agreed pickup spot, or
    # flag a conflict. Cancellation is still its own status transition —
    # this is just the agree/disagree on the proposed slot.
    dsp_response: DspWoResponse | None = Field(
        default=None,
        sa_column=Column(
            "dsp_response",
            sa.Enum(
                DspWoResponse,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=True,
        ),
    )
    dsp_response_at: datetime | None = Field(
        default=None,
        sa_column=Column("dsp_response_at", sa.DateTime(timezone=True), nullable=True),
    )
    key_location: str | None = Field(
        default=None,
        max_length=80,
        description="Free-text spot the vendor will find keys (e.g. "
                    "'mailbox 4', 'sleeve on cage'). Set by DSP on confirm.",
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
