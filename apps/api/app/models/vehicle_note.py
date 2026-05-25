"""VehicleNote — persistent service-writer notes scoped to a vehicle.

Distinct from `work_order_notes` which are tied to a single WO. Vehicle
notes survive across WOs ("DSP usually drops keys at side door", "VIN
plate is on the passenger door jamb, not the dash"), so the SW landing
view aggregates them in the "SERVICE WRITER NOTES" panel of the van card.

Iter-1 keeps it intentionally minimal: one body, one author, append-only.
The SW UI shows them newest-first. No edit/delete in iter-1 — if a note
gets stale, the SW writes a new one. Hard delete via admin tooling only.
"""
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import utc_now


class VehicleNote(SQLModel, table=True):
    __tablename__ = "vehicle_notes"

    id: int | None = Field(default=None, primary_key=True)
    vehicle_id: int = Field(
        sa_column=Column(
            "vehicle_id",
            sa.Integer,
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    body: str = Field(nullable=False)
    author_id: int | None = Field(
        default=None,
        foreign_key="users.id",
        description="Null for legacy / system-imported notes; required for "
                    "user-authored entries.",
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
