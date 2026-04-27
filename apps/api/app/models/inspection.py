"""Inspection + ReportedDefect models — the DVIC (Daily Vehicle Inspection
Checklist) data.

Flow (simplified for MVP):
  Driver selects vehicle → walks 11 sections (front, sides, lights, brakes,
  tires, interior, etc.) → reports defects per section → submits.
  One Inspection = one walkaround of one van. Defects are one-to-many.

The draft workflow (Section 4 of the plan) is deferred — for now, POST
/inspections creates a fully-submitted row in one call.

Denormalized dsp_id: we store it on Inspection too (not just via vehicle ->
dsp) so the hot query "all inspections for DSP X today" is a single-index
scan, no join.
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


class DefectSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class DefectStatus(str, Enum):
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


# ─────────────────────────────────────────────────────
# ReportedDefect
# ─────────────────────────────────────────────────────
class ReportedDefect(SQLModel, table=True):
    __tablename__ = "reported_defects"

    id: int | None = Field(default=None, primary_key=True)

    # Parent inspection
    inspection_id: int = Field(
        foreign_key="inspections.id", index=True, nullable=False
    )

    # What's wrong
    section: str = Field(max_length=100, nullable=False, index=True)
    # e.g. "1. Front Side", "5. In-Cab"
    part: str = Field(max_length=100, nullable=False)
    # e.g. "Windshield", "Brake Lights"
    description: str = Field(max_length=2000, nullable=False)
    category: str | None = Field(default=None, max_length=100)
    # e.g. "Glass", "Lighting", "Brakes" — used later to match vendor catalogs

    severity: DefectSeverity = Field(
        sa_column=Column(
            "severity",
            sa.Enum(
                DefectSeverity,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
        )
    )

    status: DefectStatus = Field(
        default=DefectStatus.PENDING,
        sa_column=Column(
            "status",
            sa.Enum(
                DefectStatus,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
            server_default="pending",
        ),
    )

    # Photos counter (populated when photos are added in later PR)
    photo_count: int = Field(default=0, nullable=False)

    # Timestamps
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID. FD-123 format."""
        return f"FD-{self.id:03d}" if self.id is not None else ""
