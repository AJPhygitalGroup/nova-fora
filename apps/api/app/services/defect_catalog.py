"""Defect catalog assembly (V2.2 — junction-split).

Builds the per-vehicle-class CatalogResponse from:
  - DefectRule × DefectApplicability (filtered by vehicle_class)
  - DefectPartSystem (UI grouping)
  - PART_LABELS / TYPE_LABELS / POSITION_LABELS / SYSTEM_LABELS (display)

The catalog rarely changes — frontend caches per vehicle_class per session.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.defect_labels import (
    PART_LABELS,
    POSITION_LABELS,
    SYSTEM_LABELS,
    TYPE_LABELS,
    VEHICLE_CLASS_LABELS,
)
from app.models.defect_catalog import (
    DefectApplicability,
    DefectPart,
    DefectPartSystem,
    DefectPosition,
    DefectRule,
    DefectSystem,
    DefectType,
    VehicleClass,
)
from app.schemas.defect_catalog import (
    CatalogResponse,
    DefectTypeInfo,
    PartAppearance,
    PartInfo,
    PositionInfo,
    SystemInfo,
)


async def build_catalog(
    session: AsyncSession, vehicle_class: VehicleClass
) -> CatalogResponse:
    """Assemble the catalog filtered for one vehicle_class.

    Returns parts (with their per-class allowed defect types + positions),
    systems, and a parts-by-primary-system index for fast tile rendering.
    """
    # Fetch reference rows
    part_systems = (
        await session.execute(select(DefectPartSystem))
    ).scalars().all()

    # Active applicability rows for this class, joined with their rules
    applicability_rows = (
        await session.execute(
            select(DefectRule, DefectApplicability)
            .join(DefectApplicability, DefectApplicability.rule_id == DefectRule.id)
            .where(DefectApplicability.vehicle_class == vehicle_class.value)
            .where(DefectRule.is_active == True)  # noqa: E712
            .where(DefectApplicability.is_active == True)  # noqa: E712
        )
    ).all()

    # Index appearances by part
    appearances_by_part: dict[DefectPart, list[PartAppearance]] = {}
    for ps in part_systems:
        appearances_by_part.setdefault(ps.part, []).append(
            PartAppearance(
                system=ps.system,
                is_primary=ps.is_primary,
                display_group=ps.display_group,
            )
        )

    # Index defect types by part
    types_by_part: dict[DefectPart, list[DefectTypeInfo]] = {}
    for rule, app in applicability_rows:
        # Build PositionInfo[] from the per-class valid_positions
        valid_positions: list[PositionInfo] = []
        for pos_str in app.valid_positions or []:
            try:
                pos_enum = DefectPosition(pos_str)
            except ValueError:
                continue
            pos_labels = POSITION_LABELS.get(
                pos_enum, {"label": pos_str, "icon": "•"}
            )
            valid_positions.append(
                PositionInfo(
                    id=pos_enum,
                    label=pos_labels["label"],
                    icon=pos_labels["icon"],
                )
            )

        type_enum = (
            rule.defect_type
            if isinstance(rule.defect_type, DefectType)
            else DefectType(rule.defect_type)
        )
        type_labels = TYPE_LABELS.get(
            type_enum, {"label": type_enum.value, "icon": "❓"}
        )
        type_info = DefectTypeInfo(
            id=type_enum,
            label=type_labels["label"],
            icon=type_labels["icon"],
            details_schema=app.details_schema or {},
            requires_details=bool(app.details_schema),
            classification=app.classification,
            group=rule.group,
            valid_positions=valid_positions,
            position_required=app.position_required,
            allow_null_position=app.allow_null_position,
            threshold=app.threshold or {},
            notes=app.notes,  # NB: per-class override; falls back to rule.notes_default in UI
            needs_review=app.needs_review,
        )
        part_enum = (
            rule.part
            if isinstance(rule.part, DefectPart)
            else DefectPart(rule.part)
        )
        types_by_part.setdefault(part_enum, []).append(type_info)

    # Alphabetical inside each part
    for ts in types_by_part.values():
        ts.sort(key=lambda t: t.label)

    # Build PartInfo list — only parts with ≥1 applicability row are surfaced
    parts: list[PartInfo] = []
    for part_id in DefectPart:
        if part_id not in types_by_part:
            continue
        labels = PART_LABELS.get(part_id, {"label": part_id.value, "icon": "❓"})
        parts.append(
            PartInfo(
                id=part_id,
                label=labels["label"],
                icon=labels["icon"],
                appearances=appearances_by_part.get(part_id, []),
                defect_types=types_by_part[part_id],
            )
        )
    parts.sort(key=lambda p: p.label)

    # Systems
    systems: list[SystemInfo] = []
    for sys_id in DefectSystem:
        labels = SYSTEM_LABELS.get(sys_id, {"label": sys_id.value, "icon": "❓"})
        systems.append(SystemInfo(id=sys_id, label=labels["label"], icon=labels["icon"]))

    # parts_by_system (primary only)
    parts_by_system: dict[DefectSystem, list[DefectPart]] = {
        s: [] for s in DefectSystem
    }
    for part in parts:
        for app_ in part.appearances:
            if app_.is_primary:
                parts_by_system[app_.system].append(part.id)
                break

    vc_label = VEHICLE_CLASS_LABELS.get(vehicle_class, {}).get(
        "label", vehicle_class.value
    )

    return CatalogResponse(
        vehicle_class=vehicle_class,
        vehicle_class_label=vc_label,
        systems=systems,
        parts=parts,
        parts_by_system=parts_by_system,
    )
