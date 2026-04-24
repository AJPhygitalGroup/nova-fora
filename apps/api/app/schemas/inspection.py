"""Inspection + ReportedDefect Pydantic schemas."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.inspection import (
    DefectSeverity,
    DefectStatus,
    Inspection,
    InspectionResult,
    InspectionStatus,
    OdometerSource,
    ReportedDefect,
)


# ─────────────────────────────────────────────────────
# Defect schemas
# ─────────────────────────────────────────────────────
class DefectCreate(BaseModel):
    """One defect entry in POST /inspections body."""

    section: str = Field(min_length=1, max_length=100)
    part: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=2000)
    severity: DefectSeverity
    category: str | None = Field(default=None, max_length=100)

    model_config = ConfigDict(extra="forbid")


class DefectResponse(BaseModel):
    """One defect in a response (embedded inside InspectionResponse or flat)."""

    id: str          # FD-XXX
    inspection_id: str    # INS-XXXXX
    section: str
    part: str
    description: str
    category: str | None = None
    severity: DefectSeverity
    status: DefectStatus
    photo_count: int
    created_at: datetime

    # Denormalized for flat /defects view (fills in when returned from /defects
    # endpoint — optional in embedded view inside an inspection).
    van: str | None = None        # "VAN-0004"
    fleet_id: str | None = None   # "PR005"
    plate: str | None = None      # license plate
    dsp: str | None = None        # "Ribrell 21"
    dsp_id: str | None = None     # "DSP-0004"
    reported_by: str | None = None  # inspector.full_name, e.g. "David Torres"
    inspection_submitted_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_defect(cls, d: ReportedDefect, inspection_id_str: str) -> "DefectResponse":
        return cls(
            id=d.id_str,
            inspection_id=inspection_id_str,
            section=d.section,
            part=d.part,
            description=d.description,
            category=d.category,
            severity=d.severity,
            status=d.status,
            photo_count=d.photo_count,
            created_at=d.created_at,
        )


class DefectStatusUpdate(BaseModel):
    """PATCH /defects/{id} body."""

    status: DefectStatus

    model_config = ConfigDict(extra="forbid")


# ─────────────────────────────────────────────────────
# Inspection schemas
# ─────────────────────────────────────────────────────
class InspectionCreate(BaseModel):
    """POST /inspections body.

    Dual mode:
      - If `defects` is non-empty → creates SUBMITTED inspection atomically
        (the original atomic pattern — still supported for bulk imports /
        programmatic QA flows).
      - If `defects` is empty → creates DRAFT inspection, which the client
        then fills via POST /inspections/{id}/defects one at a time, taking
        photos per defect, and finally calling POST /inspections/{id}/submit.

    The DRAFT mode is what the mobile QC DVIC wizard uses.
    """

    vehicle_id: str = Field(..., description="Integer or 'VAN-XXXX'")
    odometer_miles: int | None = Field(default=None, ge=0)
    odometer_source: OdometerSource | None = None
    notes: str | None = Field(default=None, max_length=2000)
    incomplete_reason: str | None = Field(default=None, max_length=500)
    defects: list[DefectCreate] = Field(default_factory=list)

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
    dsp_id: str            # DSP-0004
    dsp: str               # "Ribrell 21"
    inspector: str | None = None  # full_name of inspector, if any
    inspector_id: str | None = None
    status: InspectionStatus = InspectionStatus.SUBMITTED
    result: InspectionResult
    odometer_miles: int | None
    odometer_source: OdometerSource | None = None
    notes: str | None
    incomplete_reason: str | None
    started_at: datetime | None
    submitted_at: datetime | None
    created_at: datetime
    defects: list[DefectResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class InspectionListItem(BaseModel):
    """GET /inspections list item (lightweight — no defects inline)."""

    id: str
    vehicle_id: str
    fleet_id: str
    dsp_id: str
    dsp: str
    inspector: str | None = None
    result: InspectionResult
    odometer_miles: int | None
    submitted_at: datetime | None
    created_at: datetime
    defect_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class InspectionListResponse(BaseModel):
    items: list[InspectionListItem]
    total: int
    page: int
    per_page: int


class DefectListResponse(BaseModel):
    """GET /defects (flat view across inspections)."""

    items: list[DefectResponse]
    total: int
    page: int
    per_page: int
