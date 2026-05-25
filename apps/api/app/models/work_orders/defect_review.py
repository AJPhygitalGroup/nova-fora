"""DefectReview — audit trail for defect scope-approval decisions.

Two paths to a row:
  - `manual`             — admin/DSP user explicitly approves or rejects
                            via the review UI. `reviewer_id` set.
  - `auto_preauth_group` — defect belongs to a group listed in the DSP's
                            `preauth_defect_groups`. Reviewer is NULL.
  - `auto_threshold`     — placeholder for v2.x (auto-approve below some
                            cost threshold). Not used in v2.0.

`decision='approved'` is what unlocks bundling: the bundler watches for
approved defects that aren't yet linked to any open RR, and creates one
after the DSP's bundling_window_minutes.

Multiple reviews per defect are allowed (a defect can be reviewed → reset
→ re-reviewed); readers usually pull the latest via:
    SELECT DISTINCT ON (defect_id) ... ORDER BY defect_id, created_at DESC
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class DefectReviewDecision(str, Enum):
    """defect_reviews.decision — VARCHAR(20)."""

    APPROVED = "approved"
    REJECTED = "rejected"


class DefectReviewDecisionMethod(str, Enum):
    """defect_reviews.decision_method — VARCHAR(30)."""

    MANUAL = "manual"
    AUTO_PREAUTH_GROUP = "auto_preauth_group"
    AUTO_THRESHOLD = "auto_threshold"  # placeholder for v2.x


class DefectReview(SQLModel, table=True):
    __tablename__ = "defect_reviews"

    id: int | None = Field(default=None, primary_key=True)
    defect_id: int = Field(
        sa_column=Column(
            "defect_id",
            sa.Integer,
            sa.ForeignKey("defects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    decision: DefectReviewDecision = Field(
        sa_column=Column(
            "decision",
            sa.Enum(
                DefectReviewDecision,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
        ),
    )
    decision_method: DefectReviewDecisionMethod = Field(
        sa_column=Column(
            "decision_method",
            sa.Enum(
                DefectReviewDecisionMethod,
                native_enum=False,
                length=30,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
        ),
    )
    reviewer_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="The Nova user who made the decision. NULL for automated "
                    "decisions (decision_method != 'manual').",
    )
    reviewed_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    reason: str | None = Field(default=None)

    is_rush: bool = Field(
        default=False,
        sa_column=Column(
            "is_rush",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        description="Promoted from the iter-1 demo: surfaces a rush-priority "
                    "filter on the customer's review queue. Set when the parent "
                    "repair_request.is_rush is true at review-creation time.",
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
