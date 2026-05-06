"""Vehicle model — the vans that DSPs operate.

Business rules:
  - Every vehicle belongs to exactly one DSP (organizations.org_type = 'dsp').
  - `fleet_id` is the DSP-internal code the driver sees (e.g. "PR006").
  - `vin` is globally unique (even across DSPs).
  - `mileage` is the last-known odometer reading — updated when a Work Order
    completion reports a new value, or when an inspection's odometer OCR fires.
  - `vehicle_class` drives catalog applicability (V2.2 schema). Maps to
    Amazon fleet shorthand: CDV / Cargo / SV / EV / AMXL.
  - `ownership` is administrative metadata (Branded / Owner / Rented) — does
    NOT affect vehicle_class but DOES affect which DVIC items the wizard
    shows. Owner / Rented vans skip items tagged `requires_branding=true`
    (Amazon DOT decal, Prime decal) since those don't apply.
  - Derived fields (defect_count, severity, last_inspected) are computed at
    read-time by JOINs against inspections/defects, NOT stored here.

Frontend compat: `id_str` returns "VAN-XXXX" (see src/data/mockData.js shape).
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now
from app.models.defect_catalog import VehicleClass


class Ownership(str, Enum):
    """How the DSP holds title to the van. Does NOT change vehicle_class
    (a van is mechanically the same regardless of who owns it) but DOES
    suppress DVIC items that only apply to Amazon-branded vans (DOT decal
    USDOT2881058, Prime decal). Stored as VARCHAR per CLAUDE.md rule #2.
    """

    BRANDED = "branded"   # Amazon-branded (carries DOT + Prime decals)
    OWNER = "owner"       # DSP owns the van outright
    RENTED = "rented"     # DSP rents the van (Wheels, Enterprise, etc.)


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

    # Vehicle class — drives `defect_applicability` lookup for catalog/validation.
    # CDV/Cargo/SV/EV/AMXL per Amazon fleet shorthand (see VehicleClass enum).
    # Defaults to regular_cargo_van as the most common case; explicit on insert
    # is preferred so the wizard surfaces the right rules.
    vehicle_class: VehicleClass = Field(
        default=VehicleClass.REGULAR_CARGO_VAN,
        sa_column=Column(
            "vehicle_class",
            sa.Enum(
                VehicleClass,
                native_enum=False,
                length=30,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
            server_default="regular_cargo_van",
        ),
    )

    # Ownership — Branded vs Owner vs Rented. Filters out branding-specific
    # DVIC items when not Branded. Defaults to BRANDED (most common for DSPs).
    ownership: Ownership = Field(
        default=Ownership.BRANDED,
        sa_column=Column(
            "ownership",
            sa.Enum(
                Ownership,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
            server_default="branded",
        ),
    )

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
