"""WorkOrderPhoto — photos tied to a WO + optionally to a line/defect.

Kept distinct from the existing polymorphic `photos` table (which serves
inspections + defects). The WO V2.0 flow adds a `stage` enum and link
columns (`line_item_id`, `defect_resolution_id`) that don't fit in the
polymorphic shape.

Convention from the spec:
  - WO-level photos (`stage` ∈ vehicle_arrival, key_placement,
    parking_spot, general): both `line_item_id` and `defect_resolution_id`
    are NULL.
  - Completion / submission photos: set at least one of the link columns.
  - Rejection photos: set the link column that matches what's being
    rejected (defect_resolution_id for a defect; line_item_id for a
    billable item).
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class WorkOrderPhotoStage(str, Enum):
    """work_order_photos.stage — VARCHAR(30)."""

    SUBMISSION = "submission"
    COMPLETION = "completion"
    REJECTION = "rejection"
    VEHICLE_ARRIVAL = "vehicle_arrival"
    KEY_PLACEMENT = "key_placement"
    PARKING_SPOT = "parking_spot"
    GENERAL = "general"


class WorkOrderPhoto(SQLModel, table=True):
    __tablename__ = "work_order_photos"

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
    line_item_id: int | None = Field(
        default=None, foreign_key="work_order_line_items.id"
    )
    defect_resolution_id: int | None = Field(
        default=None, foreign_key="defect_resolutions.id"
    )

    stage: WorkOrderPhotoStage = Field(
        sa_column=Column(
            "stage",
            sa.Enum(
                WorkOrderPhotoStage,
                native_enum=False,
                length=30,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
        ),
    )
    storage_path: str = Field(max_length=500, nullable=False)
    caption: str | None = Field(default=None)

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    created_by_id: int | None = Field(default=None, foreign_key="users.id")
