"""GET /inspection-rules — V2.2 source-rule list (verbatim PDF text + targets).

Audit-and-admin endpoint. The wizard does NOT use this — the wizard reads
`/dvic-template`. This endpoint exists for:
  - Admin UI: edit RSI/VSA flags, source, notion_id back-link.
  - Audits: given a defect, what was the original PDF text?
  - Reporting: count active rules per vehicle_class / line / group.

Filters (all optional, AND-combined):
  - vehicle_class    — only rules whose vehicle_class[] contains this value
  - section          — restrict to a single DvicSection
  - source           — Amazon | DSP
  - line             — Mechanical | Electrical | Body | …
  - q                — full-text ILIKE on defect_text
  - active_only      — defaults to true; pass false to include inactive
"""
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.base import utc_now
from app.models.defect_catalog import (
    DefectClassification,
    DefectGroup,
    DefectPart,
    DefectRule,
    DefectType,
    DvicSection,
    DvicTemplateItem,
    InspectionRule,
    InspectionRuleLine,
    InspectionRuleSource,
    InspectionRuleTarget,
    VehicleClass,
)
from app.models.user import User, UserRole

router = APIRouter(prefix="/inspection-rules", tags=["catalog"])


# ─────────────────────────────────────────────────────
# POST body schema (defined at module level so OpenAPI sees it)
# ─────────────────────────────────────────────────────
class _TargetIn(BaseModel):
    """One (part, defect_type) tuple this rule maps to. Both must already
    exist in the V2.2 catalog (`defect_rule`)."""
    part: DefectPart
    defect_type: DefectType


class InspectionRuleCreate(BaseModel):
    """Body of POST /inspection-rules — create a DSP-source rule.

    Site-admin can override `source` to Amazon, but DSP owners always
    create rules with source=DSP regardless of what they send.
    """

    defect_text: str = Field(min_length=3, max_length=2000)
    source: InspectionRuleSource = InspectionRuleSource.DSP
    section: DvicSection | None = None
    parts: list[str] = Field(default_factory=list, max_length=20)
    classification: DefectClassification | None = None
    group: DefectGroup | None = None
    line: InspectionRuleLine | None = None
    rsi: bool = False
    vsa: bool = False
    notion_id: str | None = Field(default=None, max_length=100)
    vehicle_class: list[str] = Field(min_length=1, max_length=5)
    targets: list[_TargetIn] = Field(min_length=1, max_length=20)
    # When True, also create dvic_template_item rows so the wizard surfaces
    # this rule. The caller chooses section + part_category for the wizard
    # display. When False, the rule lives only in the catalog admin view.
    add_to_wizard: bool = False
    wizard_part_category: str | None = Field(default=None, max_length=100)
    wizard_photo_required: bool = True
    wizard_requires_branding: bool = False

    model_config = ConfigDict(extra="forbid")


@router.get(
    "",
    response_model=dict,
    summary="V2.2 source rules — verbatim PDF text + (part, defect_type) targets",
)
async def list_inspection_rules(
    vehicle_class: str | None = Query(None,
        description="Filter to rules applicable to this vehicle_class"),
    section: str | None = Query(None,
        description="DvicSection: general | front_side | back_side | "
                    "driver_side | passenger_side | in_cab"),
    source: str | None = Query(None, description="Amazon | DSP"),
    q: str | None = Query(None, description="ILIKE search on defect_text"),
    active_only: bool = Query(True),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # Validate enum-like params up front so we return 400 instead of 500
    if vehicle_class is not None:
        try:
            VehicleClass(vehicle_class)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"unknown vehicle_class: {vehicle_class!r}. Valid: "
                + ", ".join(v.value for v in VehicleClass),
            ) from None
    if section is not None:
        try:
            DvicSection(section)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"unknown section: {section!r}. Valid: "
                + ", ".join(s.value for s in DvicSection),
            ) from None
    if source is not None:
        try:
            InspectionRuleSource(source)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"unknown source: {source!r}. Valid: Amazon, DSP",
            ) from None

    stmt = select(InspectionRule)
    if active_only:
        stmt = stmt.where(InspectionRule.is_active == True)  # noqa: E712
    if vehicle_class is not None:
        # ARRAY containment: rule.vehicle_class @> ARRAY[<vc>]
        stmt = stmt.where(InspectionRule.vehicle_class.contains([vehicle_class]))
    if section is not None:
        stmt = stmt.where(InspectionRule.section == section)
    if source is not None:
        stmt = stmt.where(InspectionRule.source == source)
    if q:
        stmt = stmt.where(InspectionRule.defect_text.ilike(f"%{q}%"))
    stmt = stmt.order_by(InspectionRule.section, InspectionRule.id)

    rules = (await session.execute(stmt)).scalars().all()

    # Hydrate targets in one round trip
    rule_ids = [r.id for r in rules]
    targets_by_rule: dict[int, list[dict]] = {rid: [] for rid in rule_ids}
    if rule_ids:
        rows = (
            await session.execute(
                select(InspectionRuleTarget)
                .where(InspectionRuleTarget.rule_id.in_(rule_ids))
            )
        ).scalars().all()
        for t in rows:
            targets_by_rule[t.rule_id].append({
                "part": t.part if isinstance(t.part, str) else t.part.value,
                "defect_type": (
                    t.defect_type if isinstance(t.defect_type, str)
                    else t.defect_type.value
                ),
            })

    items = []
    for r in rules:
        items.append({
            "id": r.id,
            "defect_text": r.defect_text,
            "source": r.source if isinstance(r.source, str) else r.source.value,
            "section": (
                r.section if (r.section is None or isinstance(r.section, str))
                else r.section.value
            ),
            "parts": r.parts or [],
            "classification": (
                r.classification if (r.classification is None
                                     or isinstance(r.classification, str))
                else r.classification.value
            ),
            "group": (
                r.group if (r.group is None or isinstance(r.group, str))
                else r.group.value
            ),
            "line": (
                r.line if (r.line is None or isinstance(r.line, str))
                else r.line.value
            ),
            "rsi": r.rsi,
            "vsa": r.vsa,
            "notion_id": r.notion_id,
            "vehicle_class": r.vehicle_class or [],
            "is_active": r.is_active,
            "targets": sorted(
                targets_by_rule[r.id],
                key=lambda t: (t["part"], t["defect_type"]),
            ),
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        })

    return {
        "total": len(items),
        "rules": items,
    }


@router.get(
    "/{rule_id}",
    response_model=dict,
    summary="Single inspection_rule + its targets",
)
async def get_inspection_rule(
    rule_id: int,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    rule = (
        await session.execute(
            select(InspectionRule).where(InspectionRule.id == rule_id)
        )
    ).scalar_one_or_none()
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"rule {rule_id} not found")

    targets = [
        {
            "part": t.part if isinstance(t.part, str) else t.part.value,
            "defect_type": (
                t.defect_type if isinstance(t.defect_type, str)
                else t.defect_type.value
            ),
        }
        for t in (
            await session.execute(
                select(InspectionRuleTarget)
                .where(InspectionRuleTarget.rule_id == rule_id)
            )
        ).scalars()
    ]

    # Cross-link: which DvicTemplateItem rows reference any of these (part,
    # defect_type) tuples for any vehicle_class in the rule's scope. Useful
    # for the admin UI to show "this source rule drives N wizard rows".
    from app.models.defect_catalog import DefectRule, DvicTemplateItem
    template_count = 0
    if targets:
        # collect rule_ids matching the (part, defect_type) tuples
        defect_rule_rows = (
            await session.execute(select(DefectRule))
        ).scalars().all()
        defect_rule_ids = [
            dr.id for dr in defect_rule_rows
            if any(
                (dr.part if isinstance(dr.part, str) else dr.part.value) == t["part"]
                and (
                    dr.defect_type if isinstance(dr.defect_type, str)
                    else dr.defect_type.value
                ) == t["defect_type"]
                for t in targets
            )
        ]
        if defect_rule_ids:
            rows = (
                await session.execute(
                    select(DvicTemplateItem.id)
                    .where(DvicTemplateItem.rule_id.in_(defect_rule_ids))
                    .where(DvicTemplateItem.is_active == True)  # noqa: E712
                )
            ).all()
            template_count = len(rows)

    return {
        "id": rule.id,
        "defect_text": rule.defect_text,
        "source": rule.source if isinstance(rule.source, str) else rule.source.value,
        "section": (
            rule.section if (rule.section is None or isinstance(rule.section, str))
            else rule.section.value
        ),
        "parts": rule.parts or [],
        "classification": (
            rule.classification if (rule.classification is None
                                    or isinstance(rule.classification, str))
            else rule.classification.value
        ),
        "group": (
            rule.group if (rule.group is None or isinstance(rule.group, str))
            else rule.group.value
        ),
        "line": (
            rule.line if (rule.line is None or isinstance(rule.line, str))
            else rule.line.value
        ),
        "rsi": rule.rsi,
        "vsa": rule.vsa,
        "notion_id": rule.notion_id,
        "vehicle_class": rule.vehicle_class or [],
        "is_active": rule.is_active,
        "targets": targets,
        "template_item_count": template_count,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
    }


# ─────────────────────────────────────────────────────
# POST /inspection-rules — create a DSP custom rule
# ─────────────────────────────────────────────────────
@router.post(
    "",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom inspection_rule (DSP source) + optional wizard rows",
)
async def create_inspection_rule(
    body: InspectionRuleCreate = Body(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Create a DSP-authored inspection rule.

    Authorization: dsp_owner / vendor_admin / site_admin. Technicians +
    drivers can only read.

    NB — multi-tenant scope (post-MVP): `inspection_rule.vehicle_class[]`
    is global today, so a custom rule a DSP owner creates for
    `regular_cargo_van` surfaces in every DSP's fleet of that class. The
    spec calls for an eventual per-DSP scope column on `inspection_rule`
    but for the single-tenant Jun 15 demo we accept this. Until then,
    customers running a multi-DSP demo should restrict creation to
    site_admin via env config or app-level role tightening.

    `source` is forced to DSP for non-admin callers. site_admin can mint
    Amazon-imported rules.

    If `add_to_wizard=true`, also creates one DvicTemplateItem per
    (vehicle_class, target) combo so inspectors see it. Requires
    wizard_part_category. Section is derived from `body.section` or
    falls back to GENERAL when omitted.
    """
    if current.role not in (UserRole.DSP_OWNER, UserRole.VENDOR_ADMIN, UserRole.SITE_ADMIN):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "only DSP owners, vendor admins, and site admins can create rules",
        )

    # Non-site-admins can never mint Amazon-source rules
    source = body.source
    if current.role != UserRole.SITE_ADMIN and source == InspectionRuleSource.AMAZON:
        source = InspectionRuleSource.DSP

    # Validate vehicle_class strings against the enum
    for vc in body.vehicle_class:
        try:
            VehicleClass(vc)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"unknown vehicle_class: {vc!r}",
            ) from None

    # Validate parts strings (free-form on the row but must be DefectPart values)
    valid_parts = {p.value for p in DefectPart}
    for p in body.parts:
        if p not in valid_parts:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"unknown part in parts[]: {p!r}",
            )

    # Confirm each target maps to an existing defect_rule. Otherwise the
    # rule has no operational effect — the wizard would never surface it.
    rule_id_by_tuple: dict[tuple[str, str], int] = {}
    for tgt in body.targets:
        tup = (tgt.part.value, tgt.defect_type.value)
        if tup in rule_id_by_tuple:
            continue
        existing = (
            await session.execute(
                select(DefectRule.id)
                .where(DefectRule.part == tgt.part.value)
                .where(DefectRule.defect_type == tgt.defect_type.value)
                .where(DefectRule.is_active == True)  # noqa: E712
            )
        ).scalar_one_or_none()
        if existing is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"target ({tgt.part.value}, {tgt.defect_type.value}) "
                "has no matching defect_rule — add the catalog rule first.",
            )
        rule_id_by_tuple[tup] = existing

    if body.add_to_wizard and not body.wizard_part_category:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "wizard_part_category is required when add_to_wizard=true",
        )

    # Insert the inspection_rule
    rule = InspectionRule(
        defect_text=body.defect_text,
        source=source,
        section=body.section,
        parts=list(body.parts) or sorted({t.part.value for t in body.targets}),
        classification=body.classification,
        group=body.group,
        line=body.line,
        rsi=body.rsi,
        vsa=body.vsa,
        notion_id=body.notion_id,
        vehicle_class=list(body.vehicle_class),
        is_active=True,
    )
    session.add(rule)
    try:
        await session.flush()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"could not create rule: {e.orig}",
        ) from e

    # Insert targets (composite-PK; safe to add directly)
    for tup in {(t.part.value, t.defect_type.value) for t in body.targets}:
        session.add(InspectionRuleTarget(
            rule_id=rule.id,
            part=tup[0],
            defect_type=tup[1],
        ))

    template_items_added = 0
    if body.add_to_wizard:
        # One DvicTemplateItem per (vehicle_class, target). Section default
        # is GENERAL when not provided.
        section_v = body.section or DvicSection.GENERAL
        for vc in body.vehicle_class:
            for tgt in body.targets:
                rid = rule_id_by_tuple[(tgt.part.value, tgt.defect_type.value)]
                # Skip duplicates — collide-free natural key:
                # (vehicle_class, section, part_category, rule_id, position)
                exists = (
                    await session.execute(
                        select(DvicTemplateItem)
                        .where(DvicTemplateItem.vehicle_class == vc)
                        .where(DvicTemplateItem.section == section_v.value
                               if hasattr(section_v, "value") else section_v)
                        .where(DvicTemplateItem.part_category == body.wizard_part_category)
                        .where(DvicTemplateItem.rule_id == rid)
                        .where(DvicTemplateItem.position.is_(None))
                    )
                ).scalar_one_or_none()
                if exists is not None:
                    continue
                session.add(DvicTemplateItem(
                    vehicle_class=vc,
                    section=section_v,
                    part_category=body.wizard_part_category,
                    rule_id=rid,
                    position=None,
                    description=body.defect_text,
                    ordering=999,    # custom rules sink to the bottom
                    photo_required=body.wizard_photo_required,
                    requires_branding=body.wizard_requires_branding,
                    is_active=True,
                ))
                template_items_added += 1

    await session.commit()
    await session.refresh(rule)

    return {
        "id": rule.id,
        "defect_text": rule.defect_text,
        "source": rule.source if isinstance(rule.source, str) else rule.source.value,
        "section": rule.section if (rule.section is None or isinstance(rule.section, str)) else rule.section.value,
        "parts": rule.parts or [],
        "classification": (
            rule.classification if (rule.classification is None or isinstance(rule.classification, str))
            else rule.classification.value
        ),
        "group": rule.group if (rule.group is None or isinstance(rule.group, str)) else rule.group.value,
        "line": rule.line if (rule.line is None or isinstance(rule.line, str)) else rule.line.value,
        "rsi": rule.rsi,
        "vsa": rule.vsa,
        "notion_id": rule.notion_id,
        "vehicle_class": rule.vehicle_class or [],
        "is_active": rule.is_active,
        "targets": [{"part": t.part.value, "defect_type": t.defect_type.value} for t in body.targets],
        "template_items_added": template_items_added,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
    }
