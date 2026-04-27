"""WorkOrder + WorkOrderItem models — repair-job tracking.

Domain:
  A WorkOrder represents repair work scheduled for ONE vehicle, born from
  one or more approved defects. A WO bundles defects (M:N via WorkOrderItem)
  so a single trip to the shop can address multiple issues at once.

Lifecycle:
  pending      → DSP created, waiting for vendor to accept
  acknowledged → vendor accepted (no schedule yet)
  scheduled    → vendor set scheduled_at
  in_progress  → tech started working (started_at set)
  completed    → tech finished (completed_at set, photos QC_AFTER added)
  declined     → vendor refused (decline_reason populated)
  canceled     → DSP canceled before in_progress

Key design choices:
  - Polymorphic photos already had `work_order_id` reserved (Photo.work_order_id);
    Phase 1 of WO migration adds the FK constraint.
  - `flags` is a TEXT[] (Postgres array) so 'rush_order'/'stale'/'subcontracted'
    can stack without a separate table.
  - Costs nullable — populated when vendor quotes; we don't gate workflow on quote.
  - `ro_number` (Repair Order #) is the vendor's external ref; unique per vendor
    when present (enforced via partial unique index).
"""
from datetime import datetime
from decimal import Decimal
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column, ForeignKey
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


# ─────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────
class WorkOrderStatus(str, Enum):
    """WO lifecycle. Stored as VARCHAR (native_enum=False) for flexibility."""

    PENDING = "pending"            # DSP created, vendor not yet accepted
    ACKNOWLEDGED = "acknowledged"  # vendor accepted, no schedule yet
    SCHEDULED = "scheduled"        # vendor set scheduled_at
    IN_PROGRESS = "in_progress"    # tech started (started_at set)
    COMPLETED = "completed"        # done (completed_at set)
    DECLINED = "declined"          # vendor refused (decline_reason set)
    CANCELED = "canceled"          # DSP canceled


class WorkOrderFlag(str, Enum):
    """Stackable boolean flags. Stored as TEXT[] in Postgres."""

    RUSH_ORDER = "rush_order"        # high priority — same-day expected
    STALE = "stale"                  # been pending > N days
    SUBCONTRACTED = "subcontracted"  # vendor pushed work to another shop
    PENDING_FMC = "pending_fmc"      # waiting on FMC (Wheels/Element/etc.) approval


# ─────────────────────────────────────────────────────
# WorkOrder
# ─────────────────────────────────────────────────────
class WorkOrder(SQLModel, table=True):
    __tablename__ = "work_orders"

    id: int | None = Field(default=None, primary_key=True)

    # Parties
    dsp_id: int = Field(
        foreign_key="organizations.id", index=True, nullable=False,
        description="Customer DSP that owns the vehicle.",
    )
    vendor_id: int = Field(
        foreign_key="organizations.id", index=True, nullable=False,
        description="Repair shop assigned to do the work.",
    )
    vehicle_id: int = Field(
        foreign_key="vehicles.id", index=True, nullable=False,
        description="The van being serviced.",
    )

    # People
    created_by_id: int = Field(
        foreign_key="users.id", index=True, nullable=False,
        description="DSP user who created the WO.",
    )
    assigned_technician_id: int | None = Field(
        default=None, foreign_key="users.id", index=True,
        description="Vendor tech assigned to the job. Null until vendor assigns.",
    )

    # Workflow
    status: WorkOrderStatus = Field(
        default=WorkOrderStatus.PENDING,
        sa_column=Column(
            "status",
            sa.Enum(
                WorkOrderStatus,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
            server_default="pending",
        ),
    )
    flags: list[str] = Field(
        default_factory=list,
        sa_column=Column(
            "flags",
            ARRAY(sa.String(30)),
            nullable=False,
            server_default="{}",
        ),
        description="WorkOrderFlag values. Stackable: ['rush_order', 'stale'].",
    )

    # Schedule timestamps (TIMESTAMPTZ, nullable until each phase begins)
    scheduled_at: datetime | None = Field(
        default=None,
        sa_column=Column("scheduled_at", sa.DateTime(timezone=True), nullable=True, index=True),
    )
    started_at: datetime | None = Field(
        default=None,
        sa_column=Column("started_at", sa.DateTime(timezone=True), nullable=True),
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column("completed_at", sa.DateTime(timezone=True), nullable=True, index=True),
    )

    # Commercial
    ro_number: str | None = Field(
        default=None, max_length=50, index=True,
        description="Vendor's external Repair Order number (e.g., 'RO-2026-8142').",
    )
    fmc: str | None = Field(
        default=None, max_length=40,
        description="Fleet Management Company: Wheels / Element / Rented-Owned / etc.",
    )
    parts_cost: Decimal | None = Field(
        default=None,
        sa_column=Column("parts_cost", sa.Numeric(10, 2), nullable=True),
    )
    labor_cost: Decimal | None = Field(
        default=None,
        sa_column=Column("labor_cost", sa.Numeric(10, 2), nullable=True),
    )

    # Reasons / context
    notes: str | None = Field(default=None, max_length=4000)
    decline_reason: str | None = Field(default=None, max_length=500)
    cancel_reason: str | None = Field(default=None, max_length=500)

    # Denormalized counters (kept in sync by service layer)
    photo_count: int = Field(default=0, nullable=False)
    item_count: int = Field(default=0, nullable=False)

    # Timestamps
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID. WO-54001 etc."""
        return f"WO-{self.id:05d}" if self.id is not None else ""

    @property
    def total_cost(self) -> Decimal | None:
        """Sum of parts + labor (None if neither quoted)."""
        p = self.parts_cost or Decimal("0")
        l = self.labor_cost or Decimal("0")
        if self.parts_cost is None and self.labor_cost is None:
            return None
        return p + l


# ─────────────────────────────────────────────────────
# WorkOrderItem  (junction WorkOrder <-> ReportedDefect)
# ─────────────────────────────────────────────────────
class WorkOrderItem(SQLModel, table=True):
    """One line item on a WO — links to a defect being repaired.

    UNIQUE(defect_id) ensures a defect belongs to at most ONE work order
    (you can't bundle the same defect into two WOs).
    """

    __tablename__ = "work_order_items"
    __table_args__ = (
        sa.UniqueConstraint("defect_id", name="uq_work_order_items_defect"),
    )

    id: int | None = Field(default=None, primary_key=True)

    work_order_id: int = Field(
        sa_column=Column(
            "work_order_id",
            sa.Integer,
            ForeignKey("work_orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    defect_id: int = Field(
        foreign_key="reported_defects.id", nullable=False, index=True,
        description="The defect this WO is repairing. Bumps defect.status → converted_to_wo.",
    )

    # Per-line repair notes (the WO's `notes` is the overall repair plan)
    repair_notes: str | None = Field(default=None, max_length=2000)

    # Per-line costs (optional — most WOs use the parent's parts_cost / labor_cost)
    line_parts_cost: Decimal | None = Field(
        default=None,
        sa_column=Column("line_parts_cost", sa.Numeric(10, 2), nullable=True),
    )
    line_labor_cost: Decimal | None = Field(
        default=None,
        sa_column=Column("line_labor_cost", sa.Numeric(10, 2), nullable=True),
    )

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID. WOI-0001 etc."""
        return f"WOI-{self.id:04d}" if self.id is not None else ""
