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
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.defect_catalog import (
    InspectionRule,
    InspectionRuleSource,
    InspectionRuleTarget,
    DvicSection,
    VehicleClass,
)
from app.models.user import User

router = APIRouter(prefix="/inspection-rules", tags=["catalog"])


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
