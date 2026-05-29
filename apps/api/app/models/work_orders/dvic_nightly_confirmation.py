"""DvicNightlyConfirmation — vendor's nightly "DSP is ready" confirmation.

Mockup p.2 "Upcoming DVIC" workflow: the vendor SW confirms that each
DSP they service tonight has the van + keys ready, so the inspector
isn't sent out to a closed yard. One row per (vendor_workshop, dsp,
confirmation_date) tuple — UNIQUE constraint enforces "one
confirmation per night per DSP per shop".

Iter-1 stores just the confirmation event (the absence of a row =
"not yet confirmed"). Iter-2 may add a `decline_reason` to support
"DSP not available tonight" with the inspector skipping the visit.

The chip on the VendorHome banner reads from this table:
  - No row for tonight   → red chip ("CEIB")     — click to confirm
  - Row exists for today → green chip ("CEIB Confirmed")
"""
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy import Column, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class DvicNightlyConfirmation(SQLModel, table=True):
    __tablename__ = "dvic_nightly_confirmations"
    __table_args__ = (
        UniqueConstraint(
            "vendor_workshop_id", "dsp_id", "confirmation_date",
            name="uq_dvic_nightly_triple",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    vendor_workshop_id: int = Field(
        sa_column=Column(
            "vendor_workshop_id",
            sa.Integer,
            sa.ForeignKey("vendor_workshops.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    dsp_id: int = Field(
        sa_column=Column(
            "dsp_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    confirmation_date: date = Field(
        sa_column=Column(
            "confirmation_date",
            sa.Date,
            nullable=False,
            index=True,
        ),
        description="Calendar date the confirmation applies to (the DSP's "
                    "local 'tonight'). Iter-1 uses UTC date which is fine "
                    "for the demo timezone (US East).",
    )
    confirmed_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "confirmed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    confirmed_by_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="Which user clicked confirm. NULL for system/cron entries.",
    )
