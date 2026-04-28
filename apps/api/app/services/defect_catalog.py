"""Defect catalog service — assembly + validation.

Two responsibilities:
  1. Build the full CatalogResponse from the 3 reference tables.
     Cached in-memory per process; refreshed on startup or via admin call.
  2. Validate v2 defect creates against catalog rules before insert.

The catalog rarely changes (config, not data). Caching saves the ~250-row
fan-out on every wizard load.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.defect_labels import (
    PART_LABELS,
    POSITION_LABELS,
    SYSTEM_LABELS,
    TYPE_LABELS,
)
from app.models.defect_catalog import (
    DefectDetailsSchema,
    DefectPart,
    DefectPartSystem,
    DefectPartValidity,
    DefectPosition,
    DefectSystem,
)
from app.schemas.defect_catalog import (
    CatalogResponse,
    DefectTypeInfo,
    PartAppearance,
    PartInfo,
    PositionInfo,
    SystemInfo,
)


# ─────────────────────────────────────────────────────
# Catalog assembly
# ─────────────────────────────────────────────────────
async def build_catalog(session: AsyncSession) -> CatalogResponse:
    """Assemble the full catalog from reference tables. ~50 KB output."""
    # Fetch all reference rows in parallel-friendly serial calls (small data)
    part_systems = (
        await session.execute(select(DefectPartSystem))
    ).scalars().all()
    part_validities = (
        await session.execute(select(DefectPartValidity))
    ).scalars().all()
    details_schemas = (
        await session.execute(select(DefectDetailsSchema))
    ).scalars().all()

    # Index by part for fast lookup
    appearances_by_part: dict[DefectPart, list[PartAppearance]] = {}
    for ps in part_systems:
        appearances_by_part.setdefault(ps.part, []).append(
            PartAppearance(
                system=ps.system,
                is_primary=ps.is_primary,
                display_group=ps.display_group,
            )
        )

    validity_by_part: dict[DefectPart, DefectPartValidity] = {
        v.part: v for v in part_validities
    }

    types_by_part: dict[DefectPart, list[DefectTypeInfo]] = {}
    for ds in details_schemas:
        labels = TYPE_LABELS.get(ds.defect_type, {"label": ds.defect_type.value, "icon": "❓"})
        type_info = DefectTypeInfo(
            id=ds.defect_type,
            label=labels["label"],
            icon=labels["icon"],
            details_schema=ds.json_schema or {},
            requires_details=bool(ds.json_schema),
        )
        types_by_part.setdefault(ds.part, []).append(type_info)

    # Alphabetical ordering inside each part
    for part_id, ts in types_by_part.items():
        ts.sort(key=lambda t: t.label)

    # Build PartInfo list — only parts with at least one defect type are surfaced
    parts: list[PartInfo] = []
    for part_id in DefectPart:
        if part_id not in types_by_part:
            continue  # part has no allowed defect types yet — skip from catalog
        labels = PART_LABELS.get(part_id, {"label": part_id.value, "icon": "❓"})
        validity = validity_by_part.get(part_id)
        valid_positions: list[PositionInfo] = []
        if validity and validity.valid_positions_csv:
            for pos_str in validity.valid_positions_csv.split(","):
                if not pos_str:
                    continue
                try:
                    pos_enum = DefectPosition(pos_str)
                except ValueError:
                    continue
                pos_labels = POSITION_LABELS.get(pos_enum, {"label": pos_str, "icon": "•"})
                valid_positions.append(
                    PositionInfo(id=pos_enum, label=pos_labels["label"], icon=pos_labels["icon"])
                )
        parts.append(
            PartInfo(
                id=part_id,
                label=labels["label"],
                icon=labels["icon"],
                appearances=appearances_by_part.get(part_id, []),
                valid_positions=valid_positions,
                position_required=validity.position_required if validity else False,
                defect_types=types_by_part[part_id],
            )
        )
    parts.sort(key=lambda p: p.label)

    # Systems list
    systems: list[SystemInfo] = []
    for sys_id in DefectSystem:
        labels = SYSTEM_LABELS.get(sys_id, {"label": sys_id.value, "icon": "❓"})
        systems.append(SystemInfo(id=sys_id, label=labels["label"], icon=labels["icon"]))

    # parts_by_system index (primary systems only — most relevant for tile rendering)
    parts_by_system: dict[DefectSystem, list[DefectPart]] = {s: [] for s in DefectSystem}
    for part in parts:
        for app in part.appearances:
            if app.is_primary:
                parts_by_system[app.system].append(part.id)
                break

    return CatalogResponse(
        systems=systems,
        parts=parts,
        parts_by_system=parts_by_system,
    )


# ─────────────────────────────────────────────────────
# v2 defect validation
# ─────────────────────────────────────────────────────
class CatalogValidationError(Exception):
    """Raised when a v2 defect create fails catalog validation.
    Caller (route) translates to HTTP 400 with the message."""


async def validate_v2_defect(
    session: AsyncSession,
    part: DefectPart,
    position: DefectPosition | None,
    defect_type: Any,  # DefectType — typing relaxed to support enum-or-string
    details: dict,
) -> None:
    """Validate a v2 defect against catalog rules.

    Checks:
      1. (part, defect_type) exists in defect_details_schema (allow-list).
      2. Position obeys defect_part_validity rules.
      3. (Future) details JSON validates against the schema.
         For now we only check required keys exist when schema declares them.

    Raises CatalogValidationError on any failure.
    """
    # 1. Lookup the (part, defect_type) row in the allow-list
    type_value = defect_type.value if hasattr(defect_type, "value") else str(defect_type)
    part_value = part.value if hasattr(part, "value") else str(part)

    schema_row = (
        await session.execute(
            select(DefectDetailsSchema)
            .where(DefectDetailsSchema.part == part)
            .where(DefectDetailsSchema.defect_type == defect_type)
        )
    ).scalar_one_or_none()
    if schema_row is None:
        raise CatalogValidationError(
            f"defect_type '{type_value}' is not allowed on part '{part_value}'"
        )

    # 2. Position validity
    validity = (
        await session.execute(
            select(DefectPartValidity).where(DefectPartValidity.part == part)
        )
    ).scalar_one_or_none()

    if validity is None:
        raise CatalogValidationError(f"no validity rule registered for part '{part_value}'")

    valid_positions = [
        DefectPosition(p) for p in validity.valid_positions_csv.split(",") if p
    ]
    if position is None:
        if validity.position_required:
            raise CatalogValidationError(
                f"position is required for part '{part_value}'"
            )
    else:
        if position not in valid_positions:
            valid_str = ", ".join(p.value for p in valid_positions) or "none"
            raise CatalogValidationError(
                f"position '{position.value}' is not valid for part '{part_value}' "
                f"(valid: {valid_str})"
            )

    # 3. Details — minimal validation: if schema declares 'required', ensure those keys are present.
    json_schema = schema_row.json_schema or {}
    required_fields = json_schema.get("required") or []
    for key in required_fields:
        if key not in details:
            raise CatalogValidationError(
                f"details.{key} is required for ('{part_value}', '{type_value}')"
            )
