"""WorkOrderRo — vendor-side Repair Order numbers attached to a WO.

A single WO can have multiple ROs over its lifetime (e.g., when a vendor
splits work across multiple internal tickets). Exactly one is marked
`is_primary=True` — enforced by the partial UNIQUE index
`uq_wo_ros_one_primary ON work_order_ros (work_order_id) WHERE is_primary`
in the V2.0 migration.

`modification_reason` is optional free text; the spec uses it to track
why a non-primary RO was added (e.g., "split for paint work").
"""
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class WorkOrderRo(SQLModel, table=True):
    __tablename__ = "work_order_ros"

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
