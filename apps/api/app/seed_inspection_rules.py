"""Seed `inspection_rule` + `inspection_rule_target` from existing
DvicTemplateItem rows.

Strategy:
  1. Read every active DvicTemplateItem joined to its DefectRule.
  2. Group by (description, section) → one InspectionRule per unique pair.
     - The same description can legitimately appear under different
       sections (e.g. "Cracked windshield" lives in Front Side AND In Cab),
       so (description, section) is the natural key, not description alone.
  3. Aggregate vehicle_class[] across all template items in the group.
  4. Build the targets list from the DISTINCT (part, defect_type) tuples
     pointed at by the grouped template items.
  5. Carry classification/group from the underlying DefectApplicability/Rule
     when consistent across the group; leave NULL when they conflict
     (rare — usually a (description, section) cluster shares severity).

Notes:
  - source defaults to "Amazon" (we don't have provenance metadata in
    DvicTemplateItem). Future Notion sync can flip individual rows to
    "DSP" + populate notion_id.
  - rsi/vsa default to false (no source data); admin UI can toggle.
  - line is left NULL — Nova Fora doesn't yet have line classification
    on its rules. When the Notion roadmap sync lands we can backfill.

UPSERT key: a synthetic hash of (description, section) sealed in
notion_id format `auto:<sha1[0:16]>` so re-running the seed is idempotent
without an extra column. Real Notion IDs would replace these `auto:` keys
once an admin maps the rule to a source page.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Iterable

from sqlalchemy import select

from app.db import AsyncSessionLocal
from app.models.base import utc_now
from app.models.defect_catalog import (
    DefectApplicability,
    DefectRule,
    DvicTemplateItem,
    InspectionRule,
    InspectionRuleSource,
    InspectionRuleTarget,
)


def _auto_notion_id(description: str, section: str | None) -> str:
    """Deterministic synthetic key so re-runs UPSERT cleanly."""
    h = hashlib.sha1(f"{section or '_'}::{description}".encode()).hexdigest()
    return f"auto:{h[:16]}"


def _coerce_str(v) -> str:
    return v if isinstance(v, str) else v.value


def _consistent_value(values: Iterable):
    """Return the single value if all members agree, else None.

    Treats None as "missing" — if some rows have a value and others don't,
    return the agreed value rather than None so we don't lose information.
    """
    seen = set()
    for v in values:
        if v is not None:
            seen.add(v)
    if len(seen) == 1:
        return next(iter(seen))
    return None


async def cmd_seed_inspection_rules() -> None:
    """Idempotent UPSERT keyed by auto-generated notion_id."""
    async with AsyncSessionLocal() as session:
        # Pull all active template items joined with rule + applicability.
        rows = (
            await session.execute(
                select(DvicTemplateItem, DefectRule, DefectApplicability)
                .join(DefectRule, DefectRule.id == DvicTemplateItem.rule_id)
                .join(
                    DefectApplicability,
                    (DefectApplicability.rule_id == DefectRule.id)
                    & (DefectApplicability.vehicle_class
                       == DvicTemplateItem.vehicle_class),
                )
                .where(DvicTemplateItem.is_active == True)  # noqa: E712
                .where(DefectRule.is_active == True)         # noqa: E712
                .where(DefectApplicability.is_active == True)  # noqa: E712
            )
        ).all()

        if not rows:
            print("[seed-inspection-rules] No active DvicTemplateItem rows — nothing to seed.")
            return

        # Group by (description, section) — these become inspection_rule rows.
        # Stash everything we need to derive the rule + targets.
        groups: dict[tuple[str, str | None], dict] = defaultdict(
            lambda: {
                "vehicle_classes": set(),
                "parts": set(),
                "targets": set(),  # (part, defect_type)
                "classifications": [],
                "groups": [],
            }
        )

        for tpl, rule, app in rows:
            description = tpl.description.strip()
            section_v = _coerce_str(tpl.section) if tpl.section is not None else None
            key = (description, section_v)
            g = groups[key]

            g["vehicle_classes"].add(_coerce_str(tpl.vehicle_class))
            g["parts"].add(_coerce_str(rule.part))
            g["targets"].add((_coerce_str(rule.part), _coerce_str(rule.defect_type)))
            if app.classification is not None:
                g["classifications"].append(_coerce_str(app.classification))
            if rule.group is not None:
                g["groups"].append(_coerce_str(rule.group))

        # UPSERT each grouped rule.
        new_count, upd_count = 0, 0
        target_new, target_drop = 0, 0
        for (description, section_v), g in groups.items():
            notion_id = _auto_notion_id(description, section_v)
            existing = (
                await session.execute(
                    select(InspectionRule).where(
                        InspectionRule.notion_id == notion_id
                    )
                )
            ).scalar_one_or_none()

            payload = {
                "defect_text": description,
                "source": InspectionRuleSource.AMAZON,
                "section": section_v,
                "parts": sorted(g["parts"]),
                "classification": _consistent_value(g["classifications"]),
                "group": _consistent_value(g["groups"]),
                "line": None,
                "rsi": False,
                "vsa": False,
                "notion_id": notion_id,
                "vehicle_class": sorted(g["vehicle_classes"]),
                "is_active": True,
            }

            if existing is None:
                rule = InspectionRule(**payload)
                session.add(rule)
                await session.flush()
                rule_id = rule.id
                new_count += 1
            else:
                # Update mutable fields. Don't blow away admin-set rsi/vsa/
                # line/source/notion_id — those are out of seed scope.
                existing.defect_text = payload["defect_text"]
                existing.section = payload["section"]
                existing.parts = payload["parts"]
                existing.classification = payload["classification"]
                existing.group = payload["group"]
                existing.vehicle_class = payload["vehicle_class"]
                existing.is_active = True
                existing.updated_at = utc_now()
                session.add(existing)
                rule_id = existing.id
                upd_count += 1

            # Refresh targets — drop stale rows and add missing ones, no
            # partial updates needed since the table is pure (rule_id, part,
            # defect_type) tuples.
            existing_targets = {
                (_coerce_str(t.part), _coerce_str(t.defect_type)): t
                for t in (
                    await session.execute(
                        select(InspectionRuleTarget)
                        .where(InspectionRuleTarget.rule_id == rule_id)
                    )
                ).scalars()
            }
            for tup in g["targets"]:
                if tup in existing_targets:
                    continue
                part, dt = tup
                session.add(InspectionRuleTarget(
                    rule_id=rule_id, part=part, defect_type=dt,
                ))
                target_new += 1
            # Drop targets that no longer apply.
            for tup in set(existing_targets.keys()) - g["targets"]:
                await session.delete(existing_targets[tup])
                target_drop += 1

        await session.commit()

        print(
            "✅ inspection_rule seed:\n"
            f"   inspection_rule        — {new_count} new, {upd_count} updated\n"
            f"   inspection_rule_target — {target_new} new, {target_drop} dropped\n"
            f"   total grouped rules    — {len(groups)}"
        )
