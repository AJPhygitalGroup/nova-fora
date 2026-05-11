"""WoActivityLog — audit log for V2.0 status transitions + key events.

Polymorphic by (entity_type, entity_id) so a single table captures every
status_changed across RR / WO / LineItem / DefectResolution / DefectReview,
plus other event types (note_added, ro_assigned, cost_approved, etc.).

`details` is JSONB so each `action` defines its own shape. For
`action='status_changed'` the spec mandates:

    {"from": "<old>", "to": "<new>"}

— readers (including the simulator's `statusAt()` helper) depend on it.

`entity_type` is CHECK-constrained in the DB to a small allowlist; do
not add new entity types without a migration update.
"""
from datetime import datetime
from enum import Enum
from typing import Any

import sqlalchemy as sa
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class WoActivityLogEntityType(str, Enum):
    """wo_activity_log.entity_type — VARCHAR(30).

    CHECK-constrained allowlist; mirror any addition in the migration.
    """

    REPAIR_REQUEST = "repair_request"
    WORK_ORDER = "work_order"
    LINE_ITEM = "line_item"
    DEFECT_RESOLUTION = "defect_resolution"
    DEFECT_REVIEW = "defect_review"
    NOTE = "note"
    RO = "ro"


class WoActivityLog(SQLModel, table=True):
    __tablename__ = "wo_activity_log"

    id: int | None = Field(default=None, primary_key=True)
    entity_type: WoActivityLogEntityType = Field(
        sa_column=Column(
            "entity_type",
            sa.Enum(
                WoActivityLogEntityType,
                native_enum=False,
                length=30,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
        ),
    )
    entity_id: int = Field(nullable=False)
    action: str = Field(max_length=60, nullable=False)
    actor_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="NULL for system-driven actions (bundler, router, "
                    "schedulers, automated reviews).",
    )
    details: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(
            "details",
            JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
