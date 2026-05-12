"""Pydantic schemas for /defects (V2.2).

V2.2 §4.3 — Defect rows carry vehicle_id + optional inspection_id, the
structured (part, position, defect_type, details) tuple, and source.
Severity (`classification`) and operational routing (`group`) are derived
on read via JOIN with `defect_applicability` and `defect_rule` — they are
not stored on the Defect row itself.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.defect import Defect, DefectSource


class DefectV2Create(BaseModel):
    """POST /defects body.

    Frontend may pass `vehicle_id` / `inspection_id` as either bare ints
    or with the prefixed string IDs (`VAN-XXXX`, `INS-XXXXX`).

    `source = 'inspection'` requires `inspection_id` to be set; any other
    source requires it to be NULL.
    """

    vehicle_id: str = Field(..., description="Int or 'VAN-XXXX'")
    inspection_id: str | None = Field(
        default=None,
        description="Int or 'INS-XXXXX'. NULL for off-inspection sources.",
    )
    source: DefectSource

    part: str = Field(..., max_length=40, description="DefectPart enum value")
    position: str | None = Field(default=None, max_length=30)
    defect_type: str = Field(..., max_length=40, description="DefectType enum value")
    details: dict = Field(default_factory=dict)
    notes: str | None = Field(default=None, max_length=2000)

    reported_at: datetime | None = Field(
        default=None,
        description="Defaults to server now() when omitted.",
    )

    model_config = ConfigDict(extra="forbid")


class DefectV2Update(BaseModel):
    """PATCH /defects/{id} body — only mutable fields.

    `(part, position, defect_type)` is immutable post-create — to correct
    a misclassified defect, delete and re-create. Workflow status updates
    do NOT belong here (future `defect_status` table).
    """

    notes: str | None = None
    details: dict | None = None

    model_config = ConfigDict(extra="forbid")


class DefectV2Response(BaseModel):
    id: str                              # FD-XXX
    vehicle_id: str                      # VAN-0004
    fleet_id: str                        # PR005
    plate: str                           # license plate
    vehicle_class: str                   # e.g. "regular_cargo_van"
    dsp_id: str | None = None            # DSP-XXXX
    dsp: str | None = None               # org name
    inspection_id: str | None = None     # INS-XXXXX or null
    source: DefectSource
    part: str
    position: str | None = None
    defect_type: str
    details: dict
    notes: str | None = None

    # Derived from defect_applicability (read-time JOIN)
    classification: str | None = None    # Sev1/Sev2/Sev3/ULC/Advisory
    group: str | None = None             # AMR/Body/CMR/CNMR/PM/Tires/Detailing/Netradyne

    # V2.0 derived lifecycle status — V1 had defect.status as a column, V2.0
    # composes it from defect_reviews + repair_request + work_order state so
    # the frontend can keep its single-status badge. Possible values:
    #   pending_review — no review row yet (DSP must approve/reject)
    #   rejected       — latest review is rejected
    #   approved       — approved, not yet routed to a workshop
    #   scheduled      — approved, WO exists and is not completed
    #   repaired       — approved, WO is completed
    review_status: str = "pending_review"

    reported_by_id: int
    reported_by: str | None = None
    reported_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_defect(
        cls,
        d: Defect,
        *,
        vehicle,
        inspection_id_str: str | None,
        reporter,
        org=None,
        classification: str | None = None,
        group: str | None = None,
        review_status: str = "pending_review",
    ) -> "DefectV2Response":
        return cls(
            id=d.id_str,
            vehicle_id=vehicle.id_str,
            fleet_id=vehicle.fleet_id,
            plate=vehicle.plate,
            vehicle_class=(
                vehicle.vehicle_class.value
                if hasattr(vehicle.vehicle_class, "value")
                else str(vehicle.vehicle_class)
            ),
            dsp_id=org.id_str if org else None,
            dsp=org.name if org else None,
            inspection_id=inspection_id_str,
            source=d.source,
            part=d.part,
            position=d.position,
            defect_type=d.defect_type,
            details=d.details or {},
            notes=d.notes,
            classification=classification,
            group=group,
            review_status=review_status,
            reported_by_id=d.reported_by_id,
            reported_by=reporter.full_name if reporter else None,
            reported_at=d.reported_at,
            created_at=d.created_at,
            updated_at=d.updated_at,
        )


class DefectV2ListResponse(BaseModel):
    items: list[DefectV2Response]
    total: int
    page: int
    per_page: int
