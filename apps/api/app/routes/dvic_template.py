"""GET /dvic-template?vehicle_class=X — section-first DVIC checklist.

Renders the verbatim Amazon DVIC PDF flow for the wizard. Each item joins
the V2.2 catalog (rule + applicability) so the wizard can show:
  - section / part_category / verbatim description (from dvic_template_item)
  - classification + group + threshold + details_schema (from V2.2 catalog)

Empty array → vehicle_class doesn't have a template seeded yet (e.g.
electric_vehicle, box_truck_dot until those PDFs land).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.defect_labels import (
    PART_LABELS, POSITION_LABELS, TYPE_LABELS, VEHICLE_CLASS_LABELS,
)
from app.models.defect_catalog import (
    DefectApplicability,
    DefectPart,
    DefectPosition,
    DefectRule,
    DefectType,
    DvicSection,
    DvicTemplateItem,
    VehicleClass,
)
from app.models.user import User
from app.models.vehicle import Ownership

router = APIRouter(prefix="/dvic-template", tags=["catalog"])


# Section ordering — matches the Amazon PDF flow
_SECTION_ORDER = [
    DvicSection.GENERAL,
    DvicSection.FRONT_SIDE,
    DvicSection.BACK_SIDE,
    DvicSection.DRIVER_SIDE,
    DvicSection.PASSENGER_SIDE,
    DvicSection.IN_CAB,
]

_SECTION_META = {
    DvicSection.GENERAL: {"label": "General", "icon": "📋",
                          "description": "Documentation, cleanliness, safety accessories"},
    DvicSection.FRONT_SIDE: {"label": "Front Side", "icon": "🔦",
                             "description": "Headlights, hazard light, front suspension"},
    DvicSection.BACK_SIDE: {"label": "Back Side", "icon": "🔴",
                            "description": "Tail lights, license plate, rear body"},
    DvicSection.DRIVER_SIDE: {"label": "Driver Side", "icon": "⬅️",
                              "description": "Driver-side tires, mirror, body, decals"},
    DvicSection.PASSENGER_SIDE: {"label": "Passenger Side", "icon": "➡️",
                                 "description": "Passenger-side tires, mirror, body"},
    DvicSection.IN_CAB: {"label": "In Cab", "icon": "💺",
                         "description": "Wipers, brakes, HVAC, steering, dash, doors"},
}


@router.get(
    "",
    response_model=dict,
    summary="DVIC checklist for a vehicle_class — drives the section-first wizard",
)
async def get_dvic_template(
    response: Response,
    vehicle_class: str = Query(...,
        description="custom_delivery_van | regular_cargo_van | step_van_dot | "
                    "electric_vehicle | box_truck_dot"),
    ownership: str | None = Query(None,
        description="branded | owner | rented — when provided, items "
                    "requiring branding (DOT decal, Prime decal) are hidden "
                    "for owner/rented vans."),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        vc = VehicleClass(vehicle_class)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unknown vehicle_class: {vehicle_class!r}. Valid: "
            + ", ".join(v.value for v in VehicleClass),
        ) from None

    # Validate ownership if provided. None / "branded" → show every item;
    # "owner" or "rented" → hide branded-only items.
    own = None
    if ownership is not None:
        try:
            own = Ownership(ownership)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"unknown ownership: {ownership!r}. Valid: "
                + ", ".join(o.value for o in Ownership),
            ) from None
    hide_branded = own in (Ownership.OWNER, Ownership.RENTED)

    # Fetch all template items for this class, joined with rule + applicability
    stmt = (
        select(DvicTemplateItem, DefectRule, DefectApplicability)
        .join(DefectRule, DefectRule.id == DvicTemplateItem.rule_id)
        .join(DefectApplicability, DefectApplicability.rule_id == DefectRule.id)
        .where(DvicTemplateItem.vehicle_class == vc.value)
        .where(DefectApplicability.vehicle_class == vc.value)
        .where(DvicTemplateItem.is_active == True)  # noqa: E712
        .where(DefectRule.is_active == True)        # noqa: E712
        .where(DefectApplicability.is_active == True)  # noqa: E712
    )
    if hide_branded:
        # Owner / Rented vans don't carry Amazon DOT or Prime decals — hide those
        stmt = stmt.where(DvicTemplateItem.requires_branding == False)  # noqa: E712
    stmt = stmt.order_by(DvicTemplateItem.section, DvicTemplateItem.ordering)
    rows = (await session.execute(stmt)).all()

    # Group: section → part_category → list[items]
    by_section: dict[str, dict[str, list[dict]]] = {}
    for tpl, rule, app in rows:
        sec_key = tpl.section if isinstance(tpl.section, str) else tpl.section.value
        cat_key = tpl.part_category

        # Resolve display labels from the static dictionaries
        try:
            part_enum = DefectPart(rule.part if isinstance(rule.part, str) else rule.part.value)
            part_lbl = PART_LABELS.get(part_enum, {})
        except ValueError:
            part_lbl = {}
        try:
            type_enum = DefectType(
                rule.defect_type if isinstance(rule.defect_type, str) else rule.defect_type.value
            )
            type_lbl = TYPE_LABELS.get(type_enum, {})
        except ValueError:
            type_lbl = {}
        pos_lbl = {}
        if tpl.position is not None:
            pos_v = tpl.position if isinstance(tpl.position, str) else tpl.position.value
            try:
                pos_enum = DefectPosition(pos_v)
                pos_lbl = POSITION_LABELS.get(pos_enum, {})
            except ValueError:
                pass

        item = {
            "id": tpl.id,
            "description": tpl.description,
            "ordering": tpl.ordering,
            "photo_required": tpl.photo_required,
            "requires_branding": tpl.requires_branding,
            # Underlying V2.2 (part, defect_type) — what the wizard POSTs
            "part": rule.part if isinstance(rule.part, str) else rule.part.value,
            "part_label": part_lbl.get("label"),
            "part_icon": part_lbl.get("icon"),
            "defect_type": (
                rule.defect_type if isinstance(rule.defect_type, str)
                else rule.defect_type.value
            ),
            "defect_type_label": type_lbl.get("label"),
            "defect_type_icon": type_lbl.get("icon"),
            "position": (
                tpl.position if (tpl.position is None or isinstance(tpl.position, str))
                else tpl.position.value
            ),
            "position_label": pos_lbl.get("label"),
            # Severity + routing (derived from V2.2 applicability + rule)
            "classification": (
                app.classification if (
                    app.classification is None or isinstance(app.classification, str)
                ) else app.classification.value
            ),
            "group": rule.group if isinstance(rule.group, str) else rule.group.value,
            "threshold": app.threshold or {},
            "details_schema": app.details_schema or {},
            "requires_details": bool(app.details_schema),
            "valid_positions": app.valid_positions or [],
            "position_required": app.position_required,
            "allow_null_position": app.allow_null_position,
            "needs_review": app.needs_review,
        }
        by_section.setdefault(sec_key, {}).setdefault(cat_key, []).append(item)

    # Order sections per the canonical PDF flow + drop empty sections
    sections = []
    for sec in _SECTION_ORDER:
        cats = by_section.get(sec.value, {})
        if not cats:
            continue
        meta = _SECTION_META[sec]
        # Order categories by the smallest ordering inside them
        cats_sorted = sorted(
            cats.items(),
            key=lambda kv: min(it["ordering"] for it in kv[1]),
        )
        sections.append({
            "id": sec.value,
            "label": meta["label"],
            "icon": meta["icon"],
            "description": meta["description"],
            "categories": [
                {
                    "name": name,
                    "items": items,
                }
                for name, items in cats_sorted
            ],
            "item_count": sum(len(items) for _, items in cats_sorted),
        })

    vc_label = VEHICLE_CLASS_LABELS.get(vc, {}).get("label", vc.value)

    response.headers["Cache-Control"] = "private, max-age=300"
    return {
        "vehicle_class": vc.value,
        "vehicle_class_label": vc_label,
        "ownership": own.value if own else None,
        "sections": sections,
        "total_items": sum(s["item_count"] for s in sections),
    }
