"""CustomerPreferredVendor — DSP's preferred vendor workshop per repair type.

Spec §10 invariant: a DSP can rank their preferred vendors per repair
type. Iter-1 ships only the boolean `is_primary` flag (one primary per
(dsp, repair_type) pair). Iter-2 will add `rank` so multiple workshops
can be ordered.

Mockup p.10: vendors see a gold ribbon "You are the primary vendor"
badge on the My DSPs card when they're primary for that DSP — drives
the SW's awareness of customer expectations.

`repair_type` is nullable so a DSP can pin a vendor as primary across
all repair types at once (most common case). When non-null, the row
only applies to that specific repair type. The router will eventually
read this table before the first-eligible fallback (spec §7.G).
"""
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Column, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class CustomerPreferredVendor(SQLModel, table=True):
    __tablename__ = "customer_preferred_vendors"
    __table_args__ = (
        # Avoid two rows for the same (dsp, vendor, repair_type) triple.
        # NULL repair_type is treated as a distinct value by SQL UNIQUE
        # — the partial index in the migration enforces single-primary-per
        # -repair-type semantics on top of this.
        UniqueConstraint(
            "dsp_id", "vendor_workshop_id", "repair_type",
            name="uq_cust_pref_vendor_triple",
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
    vendor_workshop_id: int = Field(
        sa_column=Column(
            "vendor_workshop_id",
            sa.Integer,
            sa.ForeignKey("vendor_workshops.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    repair_type: str | None = Field(
        default=None,
        max_length=20,
        description="RepairType enum value, or NULL for 'applies to all repair types'.",
    )
    is_primary: bool = Field(
        default=False,
        sa_column=Column(
            "is_primary",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        description="Single source of truth for the 'primary vendor' "
                    "badge. Iter-2 may demote this to `rank=1`.",
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
    created_by_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="Who set this preference. NULL for seed-data entries.",
    )
