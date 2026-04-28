"""GET /dvic-template?asset_type=X — drives the inspector wizard.

Returns the DVIC checklist for the requested asset type, grouped by:
  section (top-level wizard tab) → part_category (sub-group) → items (rows)

Each row is a transcribed line from the Amazon DVIC PDF. The asset_type
filter (Cargo vs DOT step van) controls which rows are visible — DOT
trucks see ~30% more checks (documentation, fuel cap, mud flap, decals,
air pressure gauge, battery cover for box trucks, etc.).

Caching: 5 min Cache-Control private. Reference data, rarely changes.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.defect_labels import (
    ASSET_TYPE_LABELS,
    DVIC_SECTION_LABELS,
    PART_LABELS,
    POSITION_LABELS,
    TYPE_LABELS,
)
from app.models.defect_catalog import (
    AssetType,
    DefectPart,
    DefectPosition,
    DefectType,
    DvicSection,
    DvicTemplateItem,
)
from app.models.user import User
from app.schemas.dvic_template import (
    DvicItem,
    DvicPartCategory,
    DvicSectionGroup,
    DvicSubPosition,
    DvicTemplateResponse,
)

router = APIRouter(prefix="/dvic-template", tags=["catalog"])


# Section ordering matches the Amazon DVIC PDFs
_SECTION_ORDER = [
    DvicSection.GENERAL,
    DvicSection.FRONT_SIDE,
    DvicSection.BACK_SIDE,
    DvicSection.DRIVER_SIDE,
    DvicSection.PASSENGER_SIDE,
    DvicSection.IN_CAB,
]


def _build_position_options(csv: str) -> list[dict]:
    """Convert position_options_csv into a list of {key, label} dicts."""
    out = []
    for raw in csv.split(","):
        s = raw.strip()
        if not s:
            continue
        try:
            pos = DefectPosition(s)
        except ValueError:
            continue
        label = POSITION_LABELS.get(pos, {}).get("label", pos.value)
        out.append({"key": pos.value, "label": label})
    return out


def _resolve_part_label(part_str: str) -> tuple[str, str]:
    """(label, icon) for a part enum value."""
    try:
        p = DefectPart(part_str)
        info = PART_LABELS.get(p, {})
        return info.get("label", part_str), info.get("icon", "❓")
    except ValueError:
        return part_str, "❓"


def _resolve_type_label(type_str: str) -> tuple[str, str]:
    try:
        t = DefectType(type_str)
        info = TYPE_LABELS.get(t, {})
        return info.get("label", type_str), info.get("icon", "❓")
    except ValueError:
        return type_str, "❓"


def _resolve_position_label(pos_str: str | None) -> str | None:
    if not pos_str:
        return None
    try:
        p = DefectPosition(pos_str)
        return POSITION_LABELS.get(p, {}).get("label", pos_str)
    except ValueError:
        return pos_str


@router.get(
    "",
    response_model=DvicTemplateResponse,
    summary="DVIC checklist for an asset type — drives the inspector wizard",
)
async def get_dvic_template(
    response: Response,
    asset_type: str = Query(
        ...,
        description="extra_large_cargo_van | large_cargo_van | step_van_medium | step_van_large",
    ),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DvicTemplateResponse:
    # Validate asset_type
    try:
        at_enum = AssetType(asset_type)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unknown asset_type: {asset_type!r}. Valid: "
            + ", ".join(at.value for at in AssetType),
        ) from None

    at_label = ASSET_TYPE_LABELS.get(at_enum, {}).get("label", asset_type)

    # Fetch all active rows that match asset_type. SQL: asset_types_csv contains
    # the enum value as a comma-separated token. We use a LIKE on the CSV with
    # commas as boundaries to avoid e.g. matching "step_van_medium" inside
    # "step_van_medium_xl" (theoretical but safe).
    needle = f"%{at_enum.value}%"
    stmt = (
        select(DvicTemplateItem)
        .where(DvicTemplateItem.is_active == True)  # noqa: E712
        .where(DvicTemplateItem.asset_types_csv.like(needle))
        .order_by(DvicTemplateItem.section, DvicTemplateItem.ordering)
    )
    rows = (await session.execute(stmt)).scalars().all()

    # Filter precisely (LIKE was just an index-friendly pre-filter)
    rows = [
        r for r in rows
        if at_enum.value in [s.strip() for s in r.asset_types_csv.split(",")]
    ]

    # Group: section → part_category → list[items]
    by_section: dict[DvicSection, dict[str, list[DvicItem]]] = {}
    for r in rows:
        part_label, part_icon = _resolve_part_label(
            r.part_enum.value if hasattr(r.part_enum, "value") else r.part_enum
        )
        type_label, type_icon = _resolve_type_label(
            r.defect_type_enum.value if hasattr(r.defect_type_enum, "value") else r.defect_type_enum
        )
        position_str = (
            r.position.value if (r.position is not None and hasattr(r.position, "value"))
            else r.position
        )
        position_label = _resolve_position_label(position_str)

        sub_positions = None
        if r.sub_positions:
            sub_positions = [
                DvicSubPosition(key=sp["key"], label=sp["label"])
                for sp in r.sub_positions
                if isinstance(sp, dict) and "key" in sp and "label" in sp
            ]

        item = DvicItem(
            id=r.id,
            part=r.part_enum.value if hasattr(r.part_enum, "value") else r.part_enum,
            part_label=part_label,
            part_icon=part_icon,
            defect_type=r.defect_type_enum.value if hasattr(r.defect_type_enum, "value") else r.defect_type_enum,
            defect_type_label=type_label,
            defect_type_icon=type_icon,
            description=r.description,
            position=position_str,
            position_label=position_label,
            position_options=_build_position_options(r.position_options_csv),
            sub_positions=sub_positions,
            details_schema=r.details_schema,
            requires_details=bool(r.details_schema),
            ordering=r.ordering,
        )

        section_key = r.section if hasattr(r.section, "value") else DvicSection(r.section)
        by_section.setdefault(section_key, {}).setdefault(r.part_category, []).append(item)

    # Build response — preserve the canonical section ordering even if a
    # given asset has zero items in some section
    sections: list[DvicSectionGroup] = []
    for sec in _SECTION_ORDER:
        cats_dict = by_section.get(sec, {})
        if not cats_dict:
            continue
        info = DVIC_SECTION_LABELS.get(sec, {})
        # Categories ordered by the lowest item ordering they contain
        cats_sorted = sorted(
            cats_dict.items(),
            key=lambda kv: min(it.ordering for it in kv[1]),
        )
        categories = [
            DvicPartCategory(name=name, items=items)
            for name, items in cats_sorted
        ]
        sections.append(
            DvicSectionGroup(
                id=sec,
                label=info.get("label", sec.value),
                icon=info.get("icon", "📋"),
                description=info.get("description", ""),
                categories=categories,
            )
        )

    total = sum(s.item_count for s in sections)

    response.headers["Cache-Control"] = "private, max-age=300"
    return DvicTemplateResponse(
        asset_type=at_enum.value,
        asset_type_label=at_label,
        sections=sections,
        total_items=total,
    )
