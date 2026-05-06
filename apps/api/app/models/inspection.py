"""Inspection model — the DVIC (Daily Vehicle Inspection Checklist) header.

Flow (simplified for MVP):
  Tech selects vehicle → walks 6 DVIC sections → reports defects per section
  → submits. One Inspection = one walkaround of one van. Defects (V2.2
  `defects` table, see app/models/defect.py) are 1:N via `Defect.inspection_id`.

Denormalized dsp_id: stored on Inspection too (not just via vehicle.dsp_id)
so the hot query "all inspections for DSP X today" is a single-index scan.

V2.2 NOTE: the legacy `ReportedDefect` model and `reported_defects` table
were removed in the V2.2 migration. New defects live in `app.models.defect.Defect`.
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


# ─────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────
class InspectionStatus(str, Enum):
    """Lifecycle state. DRAFTs can be edited; SUBMITTED is final."""

    DRAFT = "draft"          # tech started, still adding defects/photos
    SUBMITTED = "submitted"  # finalized — immutable (except status of child defects)


class InspectionResult(str, Enum):
    PASSED = "passed"            # no defects, ready to drive
    FLAGGED = "flagged"          # ≥1 defect, needs follow-up
    CONDITIONAL = "conditional"  # defects but driver can continue
    INCOMPLETE = "incomplete"    # driver couldn't finish (sick, swap)


class OdometerSource(str, Enum):
    MANUAL = "manual"      # user typed it
    OCR = "ocr"            # auto-read from photo (future)
    DERIVED = "derived"    # pulled from last Work Order


class DefectStatus(str, Enum):
    """Workflow lifecycle for a Defect.

    Lives in the `defect_status` table (separate spec) — not on the defect row
    itself per V2.2 §4.3. This enum is referenced by the future status table
    and by service-layer code that filters by status; it is NOT a column on
    `defects`. Kept here for backwards-compat with code that imports it.
    """

    PENDING = "pending"              # fresh — DSP hasn't reviewed yet
    ACKNOWLEDGED = "acknowledged"    # DSP saw + accepted
    SENT_TO_VENDOR = "sent_to_vendor"
    SCHEDULED = "scheduled"          # WO created with specific date
    CONVERTED_TO_WO = "converted_to_wo"
    DISMISSED = "dismissed"          # false positive / no action needed


# ─────────────────────────────────────────────────────
# Inspection
# ─────────────────────────────────────────────────────
class Inspection(SQLModel, table=True):
    __tablename__ = "inspections"

    id: int | None = Field(default=None, primary_key=True)

    # Subject
    vehicle_id: int = Field(foreign_key="vehicles.id", index=True, nullable=False)
    dsp_id: int = Field(foreign_key="organizations.id", index=True, nullable=False)

    # Who performed it (may be null if system-created / bulk import)
    inspector_id: int | None = Field(
        default=None, foreign_key="users.id", index=True
    )

    # Lifecycle — DRAFT while tech is still adding defects/photos; SUBMITTED once
    # /submit is called. Existing rows backfill to 'submitted' via migration.
    status: InspectionStatus = Field(
        default=InspectionStatus.DRAFT,
        sa_column=Column(
            "status",
            sa.Enum(
                InspectionStatus,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
            server_default="draft",
        ),
    )

    # Outcome — only meaningful once status='submitted'; DRAFT rows may hold
    # a 'flagged' default that's re-computed at submit time.
    result: InspectionResult = Field(
        sa_column=Column(
            "result",
            sa.Enum(
                InspectionResult,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
            server_default="flagged",
        )
    )

    # Odometer at time of inspection
    odometer_miles: int | None = Field(default=None, index=True)
    odometer_source: OdometerSource | None = Field(
        default=None,
        sa_column=Column(
            "odometer_source",
            sa.Enum(
                OdometerSource,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=True,
        ),
    )

    # Context
    notes: str | None = Field(default=None, max_length=2000)
    incomplete_reason: str | None = Field(default=None, max_length=500)

    # QC DVIC session-wide: how many physical keys the tech received from
    # the DSP at the start of the session. Recorded once per session before
    # the first vehicle is inspected. Helps reconcile against returned keys.
    keys_received: int | None = Field(default=None, ge=0)

    # Timing
    started_at: datetime | None = Field(
        default=None,
        sa_column=Column("started_at", sa.DateTime(timezone=True), nullable=True),
    )
    submitted_at: datetime | None = Field(
        default=None,
        sa_column=Column("submitted_at", sa.DateTime(timezone=True), nullable=True, index=True),
    )

    # Timestamps
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID. INS-47330, etc."""
        return f"INS-{self.id:05d}" if self.id is not None else ""
