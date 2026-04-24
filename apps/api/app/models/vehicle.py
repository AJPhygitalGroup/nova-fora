"""Vehicle model — the vans that DSPs operate.

Business rules:
  - Every vehicle belongs to exactly one DSP (organizations.org_type = 'dsp').
  - `fleet_id` is the DSP-internal code the driver sees (e.g. "PR006").
  - `vin` is globally unique (even across DSPs).
  - `mileage` is the last-known odometer reading — updated when a Work Order
    completion reports a new value, or when an inspection's odometer OCR fires.
  - Derived fields (defect_count, severity, last_inspected) are computed at
    read-time by JOINs against inspections/defects, NOT stored here.

Frontend compat: `id_str` returns "VAN-XXXX" (see src/data/mockData.js shape).
"""
from datetime import datetime

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class Vehicle(SQLModel, table=True):
    __tablename__ = "vehicles"

    id: int | None = Field(default=None, primary_key=True)

    # Org membership — must point at an organization with org_type='dsp'.
    # Enforced at the service layer (Postgres can't CHECK across tables without trigger).
    dsp_id: int = Field(foreign_key="organizations.id", index=True, nullable=False)

    # DSP-internal code (driver's badge on the van). Not globally unique —
    # two DSPs can have a "PR006" each. But unique WITHIN a DSP.
    fleet_id: str = Field(max_length=50, index=True, nullable=False)

    # Vehicle identity
    vin: str = Field(max_length=17, unique=True, index=True, nullable=False)
    plate: str = Field(max_length=20, nullable=False)  # license plate
    year: int = Field(nullable=False)
    make: str = Field(max_length=50, nullable=False)    # "Mercedes"
    model: str = Field(max_length=100, nullable=False)  # "Sprinter 2500"

    # Current state
    mileage: int = Field(default=0, nullable=False)
    grounded: bool = Field(default=False, index=True, nullable=False)
    grounded_reason: str | None = Field(default=None, max_length=500)
    grounded_at: datetime | None = Field(
        default=None,
        sa_column=Column("grounded_at", DateTime(timezone=True), nullable=True),
    )

    # Soft-delete (preserve historical WOs/inspections referencing this vehicle)
    is_active: bool = Field(default=True, index=True, nullable=False)

    # Timestamps — TIMESTAMPTZ
    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID. VAN-0001, VAN-1042, etc."""
        return f"VAN-{self.id:04d}" if self.id is not None else ""
