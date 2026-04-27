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
    """One defect entry. Supports BOTH legacy (free-text) and v2 (catalog)
    schemas during the transition. New clients should use v2 fields.

    Validation order at the route layer:
      - If `part_v2` is set → treat as v2: validate against catalog,
        derive severity from catalog (overridable via severity_override).
      - Else if legacy fields are set → store as legacy free-text rows.
    """

    # ── v2 fields (preferred) ──
    part_v2: str | None = Field(
        default=None, max_length=40,
        description="DefectPart enum value, e.g. 'tire'."
    )
    position: str | None = Field(default=None, max_length=30)
    defect_type_v2: str | None = Field(default=None, max_length=40)
    details: dict = Field(default_factory=dict)
    severity_override: str | None = Field(
        default=None, pattern=r"^(low|medium|high|critical)$"
    )
    notes: str | None = Field(default=None, max_length=2000)

    # ── legacy fields (transition only) ──
    section: str | None = Field(default=None, max_length=100)
    part: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    severity: DefectSeverity | None = None
    category: str | None = Field(default=None, max_length=100)

    model_config = ConfigDict(extra="forbid")

    def is_v2(self) -> bool:
        return bool(self.part_v2 and self.defect_type_v2)


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
    vendor: str | None = None       # inspector's organization (vendor org)
    vendor_id: str | None = None    # V-005 etc.
    status: InspectionStatus
    result: InspectionResult
    odometer_miles: int | None
    keys_received: int | None = None
    incomplete_reason: str | None = None  # vehicle_wont_start / not_at_lot / no_keys
    submitted_at: datetime | None
    created_at: datetime
    defect_count: int = 0
    # Workflow breakdown — lets the dashboard show per-row status without
    # re-fetching each defect. Sum equals defect_count.
    defect_count_pending: int = 0      # status='pending' (untouched)
    defect_count_approved: int = 0     # acknowledged / sent_to_vendor / scheduled / converted_to_wo
    defect_count_rejected: int = 0     # status='dismissed'

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
