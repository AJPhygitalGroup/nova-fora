"""DefectResolution — junction WO ↔ Defect with its own status machine.

When a WO is created (router places an RR), one DefectResolution row is
spawned per defect in the RR. The DR's status follows its linked line
items (`work_order_line_item_resolutions` junction):

  - DR stays `pending` while ANY linked line item is non-terminal.
  - Once every linked item is terminal:
      ≥1 `done`           → DR → `resolved` (resolved_at = latest update)
      all `deferred`      → DR → `deferred`
      all `declined`      → DR → `declined`

Currently app-side responsibility (no DB trigger). May earn a trigger in
v2.x once the sync rules are stable.

UNIQUE(work_order_id, defect_id) — one DR per (WO, defect) pair.
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class DefectResolutionStatus(str, Enum):
    """defect_resolutions.status — VARCHAR(20).

    PENDING + IN_PROGRESS are the only states the app actively flips to;
    the terminal three (resolved/deferred/declined) are set by the line-
    item sync logic.
    """

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    DEFERRED = "deferred"
    DECLINED = "declined"


class DefectResolution(SQLModel, table=True):
    __tablename__ = "defect_resolutions"

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
    defect_id: int = Field(
        foreign_key="defects.id", index=True, nullable=False
    )
    status: DefectResolutionStatus = Field(
        sa_column=Column(
            "status",
            sa.Enum(
                DefectResolutionStatus,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            server_default=DefectResolutionStatus.PENDING.value,
        ),
    )
    notes: str | None = Field(default=None)

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )
    resolved_at: datetime | None = Field(
        default=None,
        sa_column=Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
