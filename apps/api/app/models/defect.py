"""Defect model — V2.2 standalone `defects` table.

Spec: `docs/defect-schema-v2.2-spec.md` §4.3. The legacy `reported_defects`
table is dropped in the V2.2 migration (no data migration — fresh start).

Properties:
  - Vehicle is mandatory; `inspection_id` is OPTIONAL (defects can come from
    off-inspection sources per `DefectSource`).
  - CHECK constraint: `source = 'inspection'` ↔ `inspection_id IS NOT NULL`.
  - No workflow `status` column — workflow lives in a separate (future)
    `defect_status` table per spec §2.
  - Severity (`DefectClassification`) and routing (`DefectGroup`) are NOT
    stored on the row — derive at read time via JOIN with `defect_applicability`
    and `defect_rule`. Per-row severity overrides land in a future table.
  - All structured: (part, position, defect_type, details). No free-text
    columns beyond `notes`.
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class DefectSource(str, Enum):
    """How the defect entered the system. V2.2 spec §3.

    `inspection` requires `inspection_id` — enforced by CHECK constraint.
    All other sources require `inspection_id` to be NULL.
    """

    INSPECTION = "inspection"                    # structured DVIC walkaround
    MAINTENANCE_REQUEST = "maintenance_request"  # ticket from DSP / fleet ops
    DRIVER_REPORT = "driver_report"              # driver flagged outside DVIC
    CUSTOMER_REPORT = "customer_report"          # external complaint
    SHOP_FINDING = "shop_finding"                # vendor surfaced during repair work
    OTHER = "other"                              # catchall for ad-hoc entries


class Defect(SQLModel, table=True):
    """One defect on one vehicle, optionally tied to a parent inspection.

    Logical key per the spec: (vehicle_id, inspection_id, part, position, defect_type).
    Unique index (created in the migration as a functional index with COALESCE
    on the nullables) enforces that.

    Enum value columns (`source`, `part`, `position`, `defect_type`) are stored
    as VARCHAR — see app/models/organization.py for the rationale (avoids
    ALTER TYPE downtime when the catalog evolves).
    """

    __tablename__ = "defects"
    __table_args__ = (
        CheckConstraint(
            "(source = 'inspection' AND inspection_id IS NOT NULL) "
            "OR (source <> 'inspection' AND inspection_id IS NULL)",
            name="defects_source_inspection_consistency",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)

    # ── Subject ──
    vehicle_id: int = Field(
        foreign_key="vehicles.id", index=True, nullable=False,
        description="The vehicle the defect is on. Always required.",
    )
    inspection_id: int | None = Field(
        default=None, foreign_key="inspections.id",
        description="Parent inspection, when the defect was found during one. "
                    "NULL for off-inspection sources. The CHECK constraint pairs "
                    "this with `source`.",
    )

    # ── Channel ──
    source: DefectSource = Field(
        sa_column=Column(
            "source",
            sa.Enum(
                DefectSource,
                native_enum=False,
                length=25,  # longest value: 'maintenance_request' = 19 chars
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
        ),
    )

    # ── The defect itself ──
    # Stored as enum *values* (strings). Service layer validates against the
    # DefectPart / DefectPosition / DefectType enums in app/models/defect_catalog.py.
    part: str = Field(
        max_length=40, index=True, nullable=False,
        description="DefectPart enum value, e.g. 'tire'.",
    )
    position: str | None = Field(
        default=None, max_length=30,
        description="DefectPosition enum value. NULL when the part has no positional dimension.",
    )
    defect_type: str = Field(
        max_length=40, index=True, nullable=False,
        description="DefectType enum value, e.g. 'low_tread'.",
    )

    # Follow-up answers — validated against defect_details_schema at write time.
    # JSONB so we can index / filter by JSON path (e.g. tread_depth_32nds < 4).
    details: dict = Field(
        default_factory=dict,
        sa_column=Column("details", JSONB, nullable=False, server_default="{}"),
    )

    # Free-text escape hatch — target <5% of rows post-launch.
    notes: str | None = Field(default=None, max_length=2000)

    # ── Reporter ──
    reported_by_id: int = Field(
        foreign_key="users.id", index=True, nullable=False,
        description="The user who reported the defect.",
    )
    reported_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "reported_at",
            sa.DateTime(timezone=True),
            nullable=False,
            index=True,
        ),
    )

    # ── Audit ──
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID: FD-XXX (3 digits min, expands as needed).

        V2.2 reuses the FD- prefix that the demo frontend has wired in
        components and mock data. The legacy DEF-XXXXXX prefix from the V2
        partial implementation is retired with this migration."""
        return f"FD-{self.id:03d}" if self.id is not None else ""
