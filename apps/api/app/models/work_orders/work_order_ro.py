"""WorkOrderRo — vendor-side Repair Order numbers attached to a WO.

A single WO can have multiple ROs over its lifetime (e.g., when a vendor
splits work across multiple internal tickets, or when a deferral spawns
a follow-up). Exactly one is marked `is_primary=True` — enforced by the
partial UNIQUE index
`uq_wo_ros_one_primary ON work_order_ros (work_order_id) WHERE is_primary`
in the V2.0 migration.

`modification_reason` is optional free text; the spec uses it to track
why a non-primary RO was added (e.g., "split for paint work").

## Sync-state columns (WO V2 spec §3.6)

The 13 *_at timestamps + pickup/key/vendor text columns mirror the
state of a single visit. In iteration 1 the Service Writer (or the
internal mocks) writes these directly via the wo-v2 endpoints; in
iteration 2 a vendor sync webhook (RO Writer / Mitchell / Auto
Integrate) populates them automatically. Pickup metadata is
vehicle-scoped (spec §7.D invariant): a "send pickup" action updates
every ready RO on the same vehicle in one query.

The spec leaves "columns vs ro_sync_event table" open. For iter-1 we
stay on the simpler columns-on-the-row model because each WO realistic-
ally has one visit at a time. If vendor sync ever produces many state
transitions per visit and the audit trail matters, move to an event
table later (kept backward-compatible by leaving these columns).
"""
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Column
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class WorkOrderRo(SQLModel, table=True):
    __tablename__ = "work_order_ros"
    __table_args__ = (
        CheckConstraint(
            "pickup_type IS NULL OR pickup_type IN ('overnight_rush', 'in_shop')",
            name="work_order_ros_pickup_type_chk",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    work_order_id: int = Field(
        sa_column=Column(
            "work_order_id",
            sa.Integer,
            sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    ro_number: str = Field(max_length=60, nullable=False)
    is_primary: bool = Field(default=False, nullable=False)
    modification_reason: str | None = Field(default=None)

    added_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "added_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    added_by_id: int | None = Field(default=None, foreign_key="users.id")

    # ── Vendor sync state (spec §3.6) ────────────────────────────
    parts_ordered_at: datetime | None = Field(
        default=None,
        sa_column=Column("parts_ordered_at", sa.DateTime(timezone=True), nullable=True),
    )
    parts_received_at: datetime | None = Field(
        default=None,
        sa_column=Column("parts_received_at", sa.DateTime(timezone=True), nullable=True),
    )
    submitted_to_fmc_at: datetime | None = Field(
        default=None,
        sa_column=Column("submitted_to_fmc_at", sa.DateTime(timezone=True), nullable=True),
        description="Stamped when AMR-billed RO is submitted to Amazon FMC for approval.",
    )
    fmc_approved_at: datetime | None = Field(
        default=None,
        sa_column=Column("fmc_approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    scheduled_start_at: datetime | None = Field(
        default=None,
        sa_column=Column("scheduled_start_at", sa.DateTime(timezone=True), nullable=True),
        description="Customer-confirmed start of the visit.",
    )

    # ── Pickup (vehicle-scoped per spec §7.D) ────────────────────
    # When the SW sends a pickup request, the route writes
    # pickup_requested_at + pickup_type + pickup_duration_text to EVERY
    # ready RO on the same vehicle (one truck trip covers them all).
    # Customer confirmation does the same to scheduled_start_at +
    # pickup_location + key_location + pickup_notes.
    pickup_requested_at: datetime | None = Field(
        default=None,
        sa_column=Column("pickup_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    pickup_type: str | None = Field(
        default=None, max_length=20,
        description="'overnight_rush' or 'in_shop' (CHECK constraint).",
    )
    pickup_duration_text: str | None = Field(
        default=None, max_length=120,
        description="Human-readable ETA the SW sends with the pickup ask (e.g., '2-3 business days').",
    )
    pickup_location: str | None = Field(default=None, max_length=200)
    pickup_notes: str | None = Field(default=None)
    key_location: str | None = Field(
        default=None, max_length=200,
        description="Where the DSP left the keys (lockbox, dropoff station, etc.).",
    )

    # ── Vendor-system mirror ─────────────────────────────────────
    vendor_status: str | None = Field(
        default=None, max_length=60,
        description="Mock or real vendor-system status string (RO Writer, Mitchell, etc.).",
    )
    estimated_duration_minutes: int | None = Field(
        default=None,
        description="Vendor's quoted time-on-bay estimate. Optional.",
    )
