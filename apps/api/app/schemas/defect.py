"""Pydantic schemas for /defects/v2 — see Notion 'Defect Data Schema' spec.

These shapes serve the new standalone `defects` table only. Legacy
`reported_defects` schemas live in app/schemas/inspection.py and stay
unchanged until that table is retired.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.defect import Defect, DefectSource


class DefectV2Create(BaseModel):
    """POST /defects/v2 body. See Notion §2 + §2.1.

    Frontend may pass `vehicle_id` / `inspection_id` as either bare ints
    or with the prefixed string IDs (`VAN-XXXX`, `INS-XXXXX`).

    `source = 'inspection'` requires `inspection_id` to be set; any other
    source requires it to be NULL. The route layer enforces this in addition
    to the DB CHECK constraint so the user gets a clear 400 instead of a 500.
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
    """PATCH /defects/v2/{id} body — only mutable fields.

    `(part, position, defect_type)` is immutable post-create — to correct a
    misclassified defect, delete and re-create. Workflow status updates do
    NOT belong here (that's a future `defect_status` table).
    """

    notes: str | None = None
    details: dict | None = None

    model_config = ConfigDict(extra="forbid")


class DefectV2Response(BaseModel):
    id: str                          # DEF-XXXXXX
    vehicle_id: str                  # VAN-0004
    fleet_id: str                    # PR005
    plate: str                       # license plate
    dsp_id: str | None = None        # DSP-XXXX (org id_str, derived via vehicle.dsp_id)
    dsp: str | None = None           # org name
    inspection_id: str | None = None  # INS-XXXXX or null
    source: DefectSource
    part: str
    position: str | None = None
    defect_type: str
    details: dict
    notes: str | None = None
    reported_by_id: int
    reported_by: str | None = None   # reporter.full_name
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
    ) -> "DefectV2Response":
        return cls(
            id=d.id_str,
            vehicle_id=vehicle.id_str,
            fleet_id=vehicle.fleet_id,
            plate=vehicle.plate,
            dsp_id=org.id_str if org else None,
            dsp=org.name if org else None,
            inspection_id=inspection_id_str,
            source=d.source,
            part=d.part,
            position=d.position,
            defect_type=d.defect_type,
            details=d.details or {},
            notes=d.notes,
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
