"""Defect catalog response shape — drives the wizard tile rendering.

The frontend caches this once at session start. ~30-50 KB JSON typical.
"""
from pydantic import BaseModel, ConfigDict, Field

from app.models.defect_catalog import (
    DefectPart,
    DefectPosition,
    DefectSystem,
    DefectType,
)


# ─────────────────────────────────────────────────────
# Building blocks
# ─────────────────────────────────────────────────────
class SystemInfo(BaseModel):
    id: DefectSystem
    label: str
    icon: str


class PartAppearance(BaseModel):
    """Where a part shows up — primary system + any secondaries.

    `display_group` is a UI hint inside that system tile (e.g. lights split
    into 'exterior' / 'cabin_cargo' / 'attached'). None means flat.
    """

    system: DefectSystem
    is_primary: bool
    display_group: str | None = None


class DefectTypeInfo(BaseModel):
    id: DefectType
    label: str
    icon: str
    # JSON Schema (draft-07) dict. Empty {} means no follow-up form.
    details_schema: dict = Field(default_factory=dict)
    requires_details: bool


class PositionInfo(BaseModel):
    id: DefectPosition
    label: str
    icon: str


class PartInfo(BaseModel):
    """Everything the wizard needs to render this part's flow."""

    id: DefectPart
    label: str
    icon: str
    # Where it appears
    appearances: list[PartAppearance]
    # Position rules
    valid_positions: list[PositionInfo] = Field(default_factory=list)
    position_required: bool = False
    # All allowed defect types for this part
    defect_types: list[DefectTypeInfo] = Field(default_factory=list)


# ─────────────────────────────────────────────────────
# Top-level response
# ─────────────────────────────────────────────────────
class CatalogResponse(BaseModel):
    """GET /defect-catalog response."""

    systems: list[SystemInfo]
    parts: list[PartInfo]
    # Convenience: parts indexed by primary system → list of part ids.
    # The frontend can build this client-side too, but baking it in saves a loop.
    parts_by_system: dict[DefectSystem, list[DefectPart]]
    version: str = "v2"

    model_config = ConfigDict(from_attributes=True)


# ─────────────────────────────────────────────────────
# v2 defect create schema (used in POST endpoints)
# ─────────────────────────────────────────────────────
class DefectCreateV2(BaseModel):
    """v2 schema for creating a defect during inspection.

    Required: part + defect_type (validated against catalog).
    Conditional: position required for some parts (validated server-side).
    Optional: details (validated against (part, defect_type) JSON Schema),
              notes (free text).
    """

    part: DefectPart
    position: DefectPosition | None = None
    defect_type: DefectType
    details: dict = Field(default_factory=dict)
    notes: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(extra="forbid")


class DefectV2Detail(BaseModel):
    """Response shape when reading a v2 defect."""

    id: str
    inspection_id: str
    part: DefectPart
    part_label: str
    position: DefectPosition | None = None
    position_label: str | None = None
    defect_type: DefectType
    defect_type_label: str
    details: dict
    notes: str | None = None
    photo_count: int
    status: str
    reported_by: str | None = None
    reported_at: str | None = None
    created_at: str

    model_config = ConfigDict(from_attributes=True)
