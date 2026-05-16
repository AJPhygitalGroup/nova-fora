"""Inspection Pydantic schemas (V2.2).

V2.2 NOTE: Defect-related shapes (DefectCreate, DefectResponse,
DefectStatusUpdate, DefectListResponse) moved to `app.schemas.defect`. The
legacy `ReportedDefect` table and its shapes are removed in the V2.2 migration.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.inspection import (
    InspectionResult,
    InspectionStatus,
    OdometerSource,
)
from app.schemas.defect import DefectV2Response


# ─────────────────────────────────────────────────────
# Inspection schemas
# ─────────────────────────────────────────────────────
class InspectionCreate(BaseModel):
    """POST /inspections body.

    Two modes:
      - DRAFT: empty `defect_ids` and no `incomplete_reason` → creates a
        DRAFT inspection that the wizard fills incrementally via
        POST /defects (with vehicle_id + inspection_id) per step.
      - SUBMITTED: `defect_ids` references already-created Defect rows OR
        `incomplete_reason` is set → atomic submit.

    Defects are now first-class — created via POST /defects (not embedded
    in this body). The inspection holds the parent reference.
    """

    vehicle_id: str = Field(..., description="Integer or 'VAN-XXXX'")
    odometer_miles: int | None = Field(default=None, ge=0)
    odometer_source: OdometerSource | None = None
    notes: str | None = Field(default=None, max_length=2000)
    incomplete_reason: str | None = Field(default=None, max_length=500)
    keys_received: int | None = Field(default=None, ge=0, le=200)

    # If provided, overrides the computed result (site_admin / QA workflows)
    result_override: InspectionResult | None = None

    model_config = ConfigDict(extra="forbid")


class InspectionSubmit(BaseModel):
    """POST /inspections/{id}/submit body.

    Optional overrides when finalizing a DRAFT. Result is auto-computed
    from the inspection's defects at submit time unless `result_override`
    is provided.
    """

    odometer_miles: int | None = Field(default=None, ge=0)
    odometer_source: OdometerSource | None = None
    notes: str | None = Field(default=None, max_length=2000)
    incomplete_reason: str | None = Field(default=None, max_length=500)
    result_override: InspectionResult | None = None

    model_config = ConfigDict(extra="forbid")


class InspectionResponse(BaseModel):
    """GET /inspections/{id} response — includes defects inline."""

    id: str                # INS-47330
    vehicle_id: str        # VAN-0008
    fleet_id: str          # PR006
    vehicle_class: str     # 'regular_cargo_van' / 'step_van_dot' / etc.
    dsp_id: str            # DSP-0004
    dsp: str               # "Ribrell 21"
    inspector: str | None = None  # full_name of inspector, if any
    inspector_id: str | None = None
    vendor: str | None = None
    vendor_id: str | None = None
    status: InspectionStatus = InspectionStatus.SUBMITTED
    result: InspectionResult
    odometer_miles: int | None
    odometer_source: OdometerSource | None = None
    keys_received: int | None = None
    notes: str | None
    incomplete_reason: str | None
    started_at: datetime | None
    submitted_at: datetime | None
    created_at: datetime
    defects: list[DefectV2Response] = Field(default_factory=list)
    # Per-part pass/N/A marks for the checklist UI. Map keyed by part
    # value (e.g. "headlight"), value is "pass" or "na". Parts NOT in
    # this map are either unmarked OR have at least one defect (which
    # the client computes as "defect" status from the defects list).
    part_marks: dict[str, str] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


class InspectionListItem(BaseModel):
    """GET /inspections list item (lightweight — no defects inline)."""

    id: str
    vehicle_id: str
    fleet_id: str
    dsp_id: str
    dsp: str
    inspector: str | None = None
    vendor: str | None = None
    vendor_id: str | None = None
    status: InspectionStatus
    result: InspectionResult
    odometer_miles: int | None
    keys_received: int | None = None
    incomplete_reason: str | None = None
    submitted_at: datetime | None
    created_at: datetime
    defect_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class InspectionListResponse(BaseModel):
    items: list[InspectionListItem]
    total: int
    page: int
    per_page: int
