"""DspCriticalDefect — per-DSP overlay flagging inspection rules as critical.

Jorge 2026-06-07. The Amazon DVIC catalog is shared across every
DSP, but each customer rotates focus weekly on different defect
categories — Safety First might want "lights" highlighted this
week while REJE focuses on "brakes". A single global `critical`
flag on `inspection_rule` would force every DSP to track the same
list, which doesn't match how inspectors actually use the catalog.

This is a thin overlay table: one row per (dsp, rule) pair that
the DSP wants surfaced as critical. Absent row = not critical.
Toggling off deletes the row (cheap, no audit trail kept in iter-1
beyond `created_at` on the row that existed).

Iter-1 scope (per Jorge's pick): visual badge only — the wizard
and downstream report rendering may surface the badge but neither
the inspection result nor work-order routing change behavior based
on critical status. Blocking-the-van semantics would land in
iter-2 with proper "van quarantined" state tracking.

Tenancy: the DSP that owns the row is the one who sees the
critical badge. Other DSPs see the catalog as if the row didn't
exist. Site_admin sees everything but the toggle is per-DSP, so
the admin acts on behalf of a specific DSP when impersonating.
"""
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Column, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class DspCriticalDefect(SQLModel, table=True):
    __tablename__ = "dsp_critical_defects"
    __table_args__ = (
        # One row per (DSP, rule) pair. Toggling on creates the row,
        # toggling off deletes it — re-toggling on creates a fresh row
        # with a new `created_at`.
        UniqueConstraint(
            "dsp_id", "inspection_rule_id",
            name="dsp_critical_defects_dsp_rule_uq",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)

    dsp_id: int = Field(
        sa_column=Column(
            "dsp_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    inspection_rule_id: int = Field(
        sa_column=Column(
            "inspection_rule_id",
            sa.Integer,
            sa.ForeignKey("inspection_rule.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    # Audit: who flipped it on. Nullable so a deleted user doesn't
    # cascade-delete the critical flag (the row outlives the actor).
    set_by_id: int | None = Field(
        default=None,
        sa_column=Column(
            "set_by_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=timestamp_column("created_at"),
    )
