"""Inspection + ReportedDefect Pydantic schemas."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.inspection import (
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
      - If `part_v2` is set → treat as v2: validate against catalog.
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
    notes: str | None = Field(default=None, max_length=2000)

    # ── legacy fields (transition only) ──
    section: str | None = Field(default=None, max_length=100)
    part: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=100)

    model_config = ConfigDict(extra="forbid")

    def is_v2(self) -> bool:
        return bool(self.part_v2 and self.defect_type_v2)


class DefectResponse(BaseModel):
    """One defect in a response (embedded inside InspectionResponse or flat).

    Includes BOTH legacy fields (section, part, description) AND v2 fields
    (part_label, position_label, defect_type_label, etc.) so the frontend
    can render rich structured info when available and fall back to free
    text for legacy rows.
    """

    id: str          # FD-XXX
    inspection_id: str    # INS-XXXXX
    section: str
    part: str
    description: str
    category: str | None = None
    status: DefectStatus
    photo_count: int
    created_at: datetime

    # ── v2 schema fields (optional — populated when row is v2) ──
    is_v2: bool = False
    part_label: str | None = None
    part_icon: str | None = None
    position: str | None = None
    position_label: str | None = None
    defect_type: str | None = None
    defect_type_label: str | None = None
    defect_type_icon: str | None = None
    details: dict | None = None

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
        # Lazy import to avoid circular references (defect_labels imports models).
        from app.defect_labels import PART_LABELS, POSITION_LABELS, TYPE_LABELS
        from app.models.defect_catalog import (
            DefectPart,
            DefectPosition,
            DefectType,
        )

        is_v2 = bool(d.part_enum and d.defect_type_enum)
        part_label = None
        part_icon = None
        defect_type_label = None
        defect_type_icon = None
        position_label = None

        if d.part_enum:
            try:
                pe = DefectPart(d.part_enum)
                part_label = PART_LABELS.get(pe, {}).get("label")
                part_icon = PART_LABELS.get(pe, {}).get("icon")
            except ValueError:
                pass

        if d.defect_type_enum:
            try:
                te = DefectType(d.defect_type_enum)
                defect_type_label = TYPE_LABELS.get(te, {}).get("label")
                defect_type_icon = TYPE_LABELS.get(te, {}).get("icon")
            except ValueError:
                pass

        if d.position:
            try:
                pos = DefectPosition(d.position)
                position_label = POSITION_LABELS.get(pos, {}).get("label")
            except ValueError:
                pass

        return cls(
            id=d.id_str,
            inspection_id=inspection_id_str,
            section=d.section,
            part=d.part,
            description=d.description,
            category=d.category,
            status=d.status,
            photo_count=d.photo_count,
            created_at=d.created_at,
            # v2 fields
            is_v2=is_v2,
            part_label=part_label,
            part_icon=part_icon,
            position=d.position,
            position_label=position_label,
            defect_type=d.defect_type_enum,
            defect_type_label=defect_type_label,
            defect_type_icon=defect_type_icon,
            details=d.details if d.details else None,
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
