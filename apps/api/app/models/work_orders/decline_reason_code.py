"""Decline reason codes — lookup table seeded by migration 20260511_1900.

Eight rows shipped: parts_unavailable, specialty_required, capacity_full,
customer_unreachable, cost_too_high, safety_concern, out_of_warranty, other.

`applies_to` is a free string per the spec but the migration's CHECK
constraint restricts to {work_order, line_item, defect}.
`is_terminal` distinguishes codes that allow a follow-up (e.g.
`parts_unavailable` spawns a follow-up RR) from codes that close the
flow definitively.
"""
from datetime import datetime  # noqa: F401  (kept for symmetry with other models)

from sqlmodel import Field, SQLModel


class DeclineReasonCode(SQLModel, table=True):
    __tablename__ = "decline_reason_codes"

    code: str = Field(primary_key=True, max_length=40)
    description: str = Field(max_length=200, nullable=False)
    applies_to: str = Field(
        max_length=20,
        nullable=False,
        description="One of: 'work_order', 'line_item', 'defect' (CHECK constraint).",
    )
    is_terminal: bool = Field(
        default=True,
        nullable=False,
        description="False means the decline allows follow-up work "
                    "(e.g. parts_unavailable → spawn a follow-up RR).",
    )
