"""Fleet Condition Assessment (FCA) scoring.

Port of NOVABODY/core@mbk/body-repair-demo's nova/utils/fca_scoring.py
trimmed to the helpers the body-repair PAVE summary needs in
Phase 1. The "reach a target grade" recommender + max-individual cap
land with Phase 2c (parts picker UI).

Single source of truth for grade letters in nova-fora's PAVE display.
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
