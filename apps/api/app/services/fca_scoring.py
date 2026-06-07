"""Fleet Condition Assessment (FCA) scoring.

Port of NOVABODY/core@mbk/body-repair-demo's nova/utils/fca_scoring.py.

Single source of truth for grade letters + "reach a target grade"
recommendations in nova-fora's body repair flow.
"""
from __future__ import annotations


# (min_fcs, max_fcs, grade). PAVE caps the running sum at 1000.
GRADE_BANDS = [
    (0, 3, 5),     # Great
    (4, 9, 4),     # Good
    (10, 17, 3),   # Fair
    (18, 27, 2),   # Poor
    (28, 50, 1),   # Poor
    (51, 10 ** 9, 0),  # Poor
]
GRADE_LABELS = {5: "Great", 4: "Good", 3: "Fair", 2: "Poor", 1: "Poor", 0: "Poor"}

# Highest FCS that still grades AT LEAST G (upper bound of G's band).
CEILING_FCS = {5: 3, 4: 9, 3: 17, 2: 27, 1: 50, 0: 10 ** 9}

# FCA "Max Individual Damage Score" — a damage above this must be
# repaired to reach the grade.
MAX_INDIVIDUAL_CAP = {5: 1, 4: 3, 3: 4, 2: 4, 1: 4, 0: 4}

POOR_GRADE_CEILING = 2  # any grade <= this is "Poor"

# Safety margin: the recommendation aims this many FCS points BELOW
# the target grade's ceiling so re-inspection variance or a new dent
# doesn't drop the van out of grade.
TARGET_FCS_BUFFER = 3

# Friendly definitions, shown in the PaveSummaryCard tooltip on the
# grade badge. Verbatim from the demo's GRADE_DEFINITIONS dict.
GRADE_DEFINITIONS = {
    5: "Great — minimal damage, ready for delivery.",
    4: "Good — light wear, still on-grade.",
    3: "Fair — moderate damage, repairs recommended.",
    2: "Poor — heavy damage or priority items present.",
    1: "Poor — extensive damage.",
    0: "Poor — at risk of grounding.",
}


def grade_for_fcs(fcs: int) -> int:
    """Map a Fleet Condition Score to its grade (0-5)."""
    for lo, hi, grade in GRADE_BANDS:
        if lo <= fcs <= hi:
            return grade
    return 0


def fcs_of(damages: list[dict]) -> int:
    """Fleet Condition Score = sum of the scored (non-Included) damage scores."""
    return sum(
        d["fleet_score"] for d in damages if d.get("fleet_score") is not None
    )


def grade_label(grade: int | None) -> str | None:
    if grade is None:
        return None
    return GRADE_LABELS.get(grade)


def grade_definition(grade: int | None) -> str | None:
    if grade is None:
        return None
    return GRADE_DEFINITIONS.get(grade)


def _group_by_component(damages: list[dict], cap: int) -> list[dict]:
    """Collapse damages into repair units (one per component), preserving
    document order. Verbatim port of demo's _group_by_component."""
    order: list[str] = []
    comps: dict = {}
    for d in damages:
        key = d.get("component") or f"__item_{d.get('item_no')}"
        comp = comps.get(key)
        if comp is None:
            comp = {
                "component": key,
                "item_nos": [],
                "scored_total": 0,
                "has_priority": False,
                "over_cap": False,
                "group": d.get("component_group"),
            }
            comps[key] = comp
            order.append(key)
        if d.get("item_no") is not None:
            comp["item_nos"].append(d["item_no"])
        score = d.get("fleet_score")
        if score is not None:
            comp["scored_total"] += score
            if score > cap:
                comp["over_cap"] = True
        if d.get("is_priority"):
            comp["has_priority"] = True
    return [comps[k] for k in order]


def recommend_for_target(damages: list[dict], target_grade: int) -> dict:
    """Recommend the components to repair to reach `target_grade` (or
    better). Verbatim port of demo's recommend_for_target.

    Two-step, per FCA spec:
      1. Mandatory: every component with a priority (auto-Poor) damage
         OR a damage above the grade's cap.
      2. Greedy worst-first on the remaining scored components until
         projected FCS lands inside the target band (minus buffer).

    Returns the recommendation plus a per-component breakdown the UI
    can render and re-score against.
    """
    target_grade = int(target_grade)
    ceiling = CEILING_FCS[target_grade]
    # Stop greedy a buffer below the ceiling so the van lands inside
    # the band, not at its edge.
    effective_ceiling = max(0, ceiling - TARGET_FCS_BUFFER)
    cap = MAX_INDIVIDUAL_CAP[target_grade]

    current_fcs = fcs_of(damages)
    comps = _group_by_component(damages, cap)
    current_grade = grade_for_fcs(current_fcs)
    if current_grade > POOR_GRADE_CEILING and any(c["has_priority"] for c in comps):
        current_grade = POOR_GRADE_CEILING

    selected: dict[str, str] = {}  # component name -> reason

    # Step 1: mandatory repairs.
    for comp in comps:
        if comp["has_priority"]:
            selected[comp["component"]] = "priority"
        elif comp["over_cap"]:
            selected[comp["component"]] = "over_cap"

    def projected_fcs() -> int:
        removed = sum(c["scored_total"] for c in comps if c["component"] in selected)
        return current_fcs - removed

    # Step 2: greedy worst-first on the remaining scored components.
    if projected_fcs() > effective_ceiling:
        remaining = sorted(
            (c for c in comps
             if c["component"] not in selected and c["scored_total"] > 0),
            key=lambda c: (-c["scored_total"], c["component"]),
        )
        for comp in remaining:
            if projected_fcs() <= effective_ceiling:
                break
            selected[comp["component"]] = "reduce_fcs"

    proj_fcs = projected_fcs()
    proj_grade = grade_for_fcs(proj_fcs)
    # Any unaddressed priority component keeps the vehicle Poor regardless of FCS.
    if proj_grade > POOR_GRADE_CEILING and any(
        c["has_priority"] and c["component"] not in selected for c in comps
    ):
        proj_grade = POOR_GRADE_CEILING

    recommended = sorted({
        i for c in comps if c["component"] in selected
        for i in c["item_nos"]
    })
    mandatory = sorted({
        i for c in comps
        if selected.get(c["component"]) in ("priority", "over_cap")
        for i in c["item_nos"]
    })

    breakdown = [{
        "component": c["component"],
        "group": c["group"],
        "item_nos": c["item_nos"],
        "scored_total": c["scored_total"],
        "has_priority": c["has_priority"],
        "selected": c["component"] in selected,
        "reason": selected.get(c["component"]),
    } for c in comps]

    return {
        "target_grade": target_grade,
        "target_label": GRADE_LABELS[target_grade],
        "ceiling_fcs": ceiling,
        "current_fcs": current_fcs,
        "current_grade": current_grade,
        "current_label": GRADE_LABELS[current_grade],
        "projected_fcs": proj_fcs,
        "projected_grade": proj_grade,
        "projected_label": GRADE_LABELS[proj_grade],
        "reaches_target": proj_grade >= target_grade,
        "recommended_item_nos": recommended,
        "mandatory_item_nos": mandatory,
        "components": breakdown,
    }
