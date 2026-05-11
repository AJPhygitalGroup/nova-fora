"""WorkOrderLineItem — the actual work units (the spec's `line_items`).

Line items always start as `pending` in v2.0 (no cost-approval gating —
that flow is dormant; see docs/wo-v2-rebuild.md). Initial status logic:
  - All categories at acceptance: status = PENDING.
  - `pending_cost_approval` / `pending_variance_reapproval` enum values
    stay in the schema but the app never sets them in v2.0.

External-sync idempotency:
  - `(external_source, external_id)` UNIQUE partial index (WHERE
    external_source IS NOT NULL). When RO Writer syncs in via the upsert
    pattern, the same source-pk maps to the same row. Manually entered
    rows leave both NULL and don't participate in the dedup.

Linkage to defects:
  - `defect_repair` line items MUST be linked to a defect_resolution via
    `work_order_line_item_resolutions`. The completion trigger refuses
    to close the WO otherwise. In v2.0, app does **bulk auto-linkage**:
    link every defect_repair item to every defect_resolution on the WO.

Variance check (DORMANT in v2.0):
  - When `final_price > estimated_price * (1 + tolerance)`, log to
    wo_activity_log(action='variance_breached') and flip status to DONE
    directly. The `pending_variance_reapproval` state stays unused.
"""
from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now
from app.models.work_orders.enums import (
    LineItemBillingType,
    LineItemCategory,
    LineItemStatus,
)


class WorkOrderLineItem(SQLModel, table=True):
    __tablename__ = "work_order_line_items"

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
    ro_id: int | None = Field(
        default=None,
        foreign_key="work_order_ros.id",
        index=True,
        description="Which RO# this line bills to. NULL for items not yet "
                    "attached to a specific RO.",
    )

    description: str = Field(nullable=False)
    estimated_price: Decimal | None = Field(
        default=None,
        sa_column=Column("estimated_price", sa.Numeric(10, 2), nullable=True),
    )
    final_price: Decimal | None = Field(
        default=None,
        sa_column=Column("final_price", sa.Numeric(10, 2), nullable=True),
    )

    category: LineItemCategory = Field(
        sa_column=Column(
            "category",
            sa.Enum(
                LineItemCategory,
                native_enum=False,
                length=30,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
        ),
    )
    billing_type: LineItemBillingType = Field(
        sa_column=Column(
            "billing_type",
            sa.Enum(
                LineItemBillingType,
                native_enum=False,
                length=10,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            server_default=LineItemBillingType.CMR.value,
        ),
    )
    status: LineItemStatus = Field(
        sa_column=Column(
            "status",
            sa.Enum(
                LineItemStatus,
                native_enum=False,
                length=40,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
            server_default=LineItemStatus.PENDING.value,
        ),
    )
    status_reason: str | None = Field(default=None)
    decline_reason_code: str | None = Field(
        default=None,
        foreign_key="decline_reason_codes.code",
        description="Required when status='declined' or 'deferred' (app contract).",
    )
    customer_requested: bool = Field(default=False, nullable=False)

    cost_approved_at: datetime | None = Field(
        default=None,
        sa_column=Column("cost_approved_at", sa.DateTime(timezone=True), nullable=True),
        description="DORMANT in v2.0. Set when customer responds to a "
                    "cost-approval ping in v2.x.",
    )
    customer_reapproved_at: datetime | None = Field(
        default=None,
        sa_column=Column(
            "customer_reapproved_at", sa.DateTime(timezone=True), nullable=True
        ),
        description="DORMANT in v2.0. Set when customer re-confirms after a "
                    "variance breach in v2.x.",
    )

    external_source: str | None = Field(
        default=None,
        max_length=40,
        description="Integration identifier — 'ro_writer', 'manual', 'system'. "
                    "Together with external_id, drives upsert idempotency.",
    )
    external_id: str | None = Field(default=None, max_length=120)

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )
    created_by_id: int | None = Field(default=None, foreign_key="users.id")
