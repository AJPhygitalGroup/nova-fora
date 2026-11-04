"""Marketplace eligibility rules (spec §3).

`RULE_SEED` mirrors the frozen seed in migration 20261104_1200 (a test
asserts they match). The table is the source of truth at runtime so DFS
can change it without a deploy; `seed_missing_rules()` only inserts parts
that are missing and never overwrites DFS edits.

NOTE: do not use `DefectGroup.CMR` or `derive_billing_type()` here — in the
Nova Fora catalog CMR means Commercial Motor Repair and lights are AMR.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.marketplace import (
    ALL_DEFECT_TYPES,
    MarketplaceRule,
    MarketplaceSpecialty,
)

_PANEL_TYPES = [
    "damaged",
    "cracked",
    "broken",
    "bent",
    "dent",
    "scratch",
    "paint_chip",
    "missing",
    "hanging",
    "loose",
    "other_damage",
]
_GLASS_TYPES = ["cracked", "broken", "damaged", "missing", "other_damage"]
_LIGHT_TYPES = [
    "cracked",
    "broken",
    "cover_cracked",
    "cover_missing",
    "damaged",
    "missing",
    "hanging",
]
_STEP_TYPES = ["damaged", "cracked", "broken", "bent", "loose", "hanging", "missing"]
_MIRROR_TYPES = ["damaged", "cracked", "broken", "loose", "hanging", "missing", "mount_damaged"]

# (category, parts, defect_types, specialty) — spec §3, confirmed Nov 4 2026.
RULE_SEED: list[tuple[str, list[str], list[str], str]] = [
    ("body_damage", ["body_damage"], [ALL_DEFECT_TYPES], "body"),
    (
        "body_panels",
        [
            "bumper",
            "fender",
            "hood",
            "side_panel",
            "side_molding",
            "trim",
            "exterior_door",
            "sliding_side_door",
            "rear_cargo_door",
            "cab_door",
        ],
        _PANEL_TYPES,
        "body",
    ),
    ("glass", ["windshield", "window"], _GLASS_TYPES, "body"),
    (
        "lights",
        [
            "headlight",
            "tail_light",
            "turn_signal",
            "hazard_light",
            "marker_light",
            "clearance_marker_light",
            "license_plate_light",
            "mirror_light",
            "cargo_light",
            "cabin_light",
            "stepwell_light",
        ],
        _LIGHT_TYPES,
        "general",
    ),
    ("steps", ["side_step", "rear_step"], _STEP_TYPES, "general"),
    ("mirrors", ["side_mirror"], _MIRROR_TYPES, "general"),
]


def seed_rows() -> list[dict]:
    """RULE_SEED flattened to one dict per part."""
    return [
        {"category": c, "part": p, "defect_types": list(t), "specialty": s}
        for (c, parts, t, s) in RULE_SEED
        for p in parts
    ]


async def active_rules_by_part(session: AsyncSession) -> dict[str, MarketplaceRule]:
    rows = (
        (await session.execute(select(MarketplaceRule).where(MarketplaceRule.active.is_(True))))
        .scalars()
        .all()
    )
    return {r.part: r for r in rows}


def match_rule(
    rules_by_part: dict[str, MarketplaceRule], part: str, defect_type: str
) -> MarketplaceRule | None:
    """The active rule covering (part, defect_type), or None."""
    rule = rules_by_part.get(part)
    if rule is None or not rule.matches(defect_type):
        return None
    return rule


async def seed_missing_rules(session: AsyncSession) -> int:
    """Insert seed rows whose `part` has no rule yet. Returns count inserted."""
    existing = set((await session.execute(select(MarketplaceRule.part))).scalars().all())
    added = 0
    for row in seed_rows():
        if row["part"] in existing:
            continue
        session.add(
            MarketplaceRule(
                category=row["category"],
                part=row["part"],
                defect_types=row["defect_types"],
                specialty=MarketplaceSpecialty(row["specialty"]),
                active=True,
            )
        )
        added += 1
    await session.flush()
    return added
