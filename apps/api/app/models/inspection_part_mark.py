"""InspectionPartMark — per-(inspection, part) pass/N/A tracking.

Adopted as part of the NOVABODY-style checklist UI rework (2026-05-15).
The walkaround now requires the inspector to *touch* every part on the
vehicle's catalog: each part ends in one of three terminal states —
`pass`, `na`, or `defect`.

  - `defect` is implicit: when at least one row exists in `defects` for
    `(inspection_id, part)`, the part is in defect state. We do NOT
    duplicate that signal here — the defects table is the source of
    truth for it.
  - `pass` and `na` are EXPLICIT marks that this table persists. The
    inspector either taps the ✓ Pass button on a part row, or N/A, or
    uses the per-section "Pass remaining N" bulk button.

The `{marked}/{total}` counter in each section tab and the global
"Complete inspection · X/Y" gate at the bottom both read from a UNION
of (parts with defects on this inspection) ∪ (parts in this table).

Composite PK enforces "one mark per (inspection, part)" — a re-tap
overwrites the existing mark via UPSERT instead of stacking history.
The decision history lives in the activity_log if/when we wire that.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class InspectionPartMarkStatus(str, Enum):
    """The two explicit marks. `defect` is computed from the defects table
    rather than stored here, to keep one source of truth."""

    PASS = "pass"
    NA = "na"


class InspectionPartMark(SQLModel, table=True):
    __tablename__ = "inspection_part_marks"

    inspection_id: int = Field(
        sa_column=Column(
            "inspection_id",
            sa.Integer,
            sa.ForeignKey("inspections.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
    )
    part: str = Field(
        sa_column=Column(
            "part",
            sa.String(length=40),
            primary_key=True,
            nullable=False,
        ),
        description="DefectPart enum value (e.g. 'headlight', 'tire'). Stored "
                    "as the raw string so we don't fight enum-array pain in "
                    "Postgres; the catalog endpoint is the source of truth "
                    "for which parts are valid on a given vehicle_class.",
    )
    status: InspectionPartMarkStatus = Field(
        sa_column=Column(
            "status",
            sa.Enum(
                InspectionPartMarkStatus,
                native_enum=False,
                length=10,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
        ),
    )
    marked_at: datetime = Field(
        default_factory=utc_now,
        sa_column=timestamp_column("marked_at"),
    )
    marked_by_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="Nova user who tapped the button. NULL for system-driven "
                    "marks (e.g. bulk pass on completion).",
    )
