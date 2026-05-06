"""Defect catalog response shape (V2.2) — drives the wizard tile rendering.

The catalog is filtered by `vehicle_class` server-side. Returns the full
applicability set for that class: parts, positions, defect types,
classifications (severity), groups (routing), and details_schemas.

Frontend caches once per vehicle_class per session (~30-50 KB JSON).
"""
from pydantic import BaseModel, ConfigDict, Field

from app.models.defect_catalog import (
    DefectClassification,
    DefectGroup,
    DefectPart,
    DefectPosition,
    DefectSystem,
    DefectType,
    VehicleClass,
)


class SystemInfo(BaseModel):
    id: DefectSystem
    label: str
    icon: str


class PartAppearance(BaseModel):
    """Where a part shows up — primary system + any secondaries."""

    system: DefectSystem
    is_primary: bool
    display_group: str | None = None


class DefectTypeInfo(BaseModel):
    """A defect type as scoped to a (part, vehicle_class) applicability row."""

    id: DefectType
    label: str
    icon: str
    details_schema: dict = Field(default_factory=dict)
    requires_details: bool
    classification: DefectClassification | None = None
    group: DefectGroup
    valid_positions: list["PositionInfo"] = Field(default_factory=list)
    position_required: bool = False
    allow_null_position: bool = True
    threshold: dict = Field(default_factory=dict)
    notes: str | None = None
    needs_review: bool = False


class PositionInfo(BaseModel):
    id: DefectPosition
    label: str
    icon: str


class PartInfo(BaseModel):
    """Everything the wizard needs to render this part's flow on a given class."""

    id: DefectPart
    label: str
    icon: str
    appearances: list[PartAppearance]
    defect_types: list[DefectTypeInfo] = Field(default_factory=list)


class CatalogResponse(BaseModel):
    """GET /defect-catalog?vehicle_class=X response."""

    vehicle_class: VehicleClass
    vehicle_class_label: str
    systems: list[SystemInfo]
    parts: list[PartInfo]
    parts_by_system: dict[DefectSystem, list[DefectPart]]
    version: str = "v2.2"

    model_config = ConfigDict(from_attributes=True)


# Forward ref for DefectTypeInfo.valid_positions
DefectTypeInfo.model_rebuild()
