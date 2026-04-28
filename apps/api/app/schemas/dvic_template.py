"""Schemas for the DVIC template endpoint (Phase 3).

The /dvic-template endpoint groups checklist items by section + part_category
to drive the inspector wizard. Each section is a navigable tab in the UI,
each part_category is a sub-group, each item is one line of the PDF.
"""
from pydantic import BaseModel, ConfigDict, Field

from app.models.defect_catalog import DvicSection


class DvicSubPosition(BaseModel):
    """One option for an in-row sub-position picker (e.g. low_beam / high_beam)."""

    key: str
    label: str


class DvicItem(BaseModel):
    """One checklist line — directly maps to a row of the PDF."""

    id: int                            # row id (stable for client-side dedup)
    part: str                          # DefectPart enum value
    part_label: str                    # Human label
    part_icon: str                     # Emoji
    defect_type: str                   # DefectType enum value
    defect_type_label: str
    defect_type_icon: str
    description: str                   # Verbatim PDF text — shown to inspector

    # Position dimensions
    position: str | None = None        # Pre-set position when applicable
    position_label: str | None = None
    position_options: list[dict] = Field(
        default_factory=list,
        description="If non-empty, inspector picks one. Each: {key, label}.",
    )
    sub_positions: list[DvicSubPosition] | None = None

    # Optional follow-up form spec (JSON Schema draft-07)
    details_schema: dict | None = None
    requires_details: bool = False

    ordering: int = 0


class DvicPartCategory(BaseModel):
    """A group of items inside a section (e.g. 'Lights and light covers')."""

    name: str
    items: list[DvicItem] = Field(default_factory=list)


class DvicSectionGroup(BaseModel):
    """One of the 6 physical sections — top level of the wizard."""

    id: DvicSection
    label: str                         # "Front Side"
    icon: str
    description: str                   # Short blurb shown under tile
    categories: list[DvicPartCategory] = Field(default_factory=list)

    @property
    def item_count(self) -> int:
        return sum(len(c.items) for c in self.categories)


class DvicTemplateResponse(BaseModel):
    """GET /dvic-template?asset_type=X response."""

    asset_type: str
    asset_type_label: str
    sections: list[DvicSectionGroup]
    total_items: int

    model_config = ConfigDict(from_attributes=True)
