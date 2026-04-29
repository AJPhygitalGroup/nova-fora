"""Defect model — v2 standalone `defects` table per the Notion 'Defect Data
Schema' spec (post-2026-04-28 consensus with Mohammed).

Differences from the legacy `reported_defects` table this gradually replaces:
  - Vehicle is mandatory; `inspection_id` is OPTIONAL (defects can come from
    off-inspection sources — driver report, vendor report, mechanic walkaround).
  - `source` enum records how the defect entered the system.
  - CHECK constraint enforces `source = 'inspection'` ↔ `inspection_id IS NOT NULL`.
  - No workflow `status` column — workflow lives in a separate `defect_status`
    spec/table (see Notion §2 'Excluded fields').
  - No legacy free-text columns (section / part / description / category) —
    every row uses the structured (part, position, defect_type, details) shape.

The legacy `reported_defects` table coexists during the migration period;
new writes target this table. Backfill from reported_defects via
`python -m app.cli backfill-defects`.
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class DefectSource(str, Enum):
    """How the defect entered the system. Notion spec §2.1."""

    INSPECTION = "inspection"                  # structured DVIC walkaround — inspection_id required
    DRIVER_REPORT = "driver_report"            # driver flagged between scheduled inspections
    VENDOR_REPORT = "vendor_report"            # vendor surfaced during unrelated work
    MECHANIC_WALKAROUND = "mechanic_walkaround"  # informal vendor spot-check, not a DVIC


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
                length=30,
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
        """Frontend-compatible ID: DEF-XXXXXX. Distinct from legacy FD-XXX."""
        return f"DEF-{self.id:06d}" if self.id is not None else ""
