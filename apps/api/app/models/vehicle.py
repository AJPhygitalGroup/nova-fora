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
    """How the DSP holds title to the van. Mirrors Amazon Cortex's
    `ownershipType` column verbatim so the value the DSP sees matches the
    one in their fleet portal. The wizard treats Amazon-* values as
    "branded" (carries DOT + Prime decals) and DSP-* values as not branded.

    Stored as VARCHAR per CLAUDE.md rule #2.
    """

    AMAZON_OWNED  = "amazon_owned"   # Amazon owns; carries DOT + Prime decals
    AMAZON_LEASED = "amazon_leased"  # Amazon leases from FMC; carries DOT + Prime decals
    DSP_OWNED     = "dsp_owned"      # DSP owns the van outright (no decals)
    RENTAL        = "rental"         # DSP rents from third party (no decals)


class VehicleLocation(str, Enum):
    """Where the van physically is. The DSP toggles between PARKING_LOT and
    OFFSITE manually; CHECKED_OUT is set by the vendor when they pull the
    van for an overnight repair (the WO transitions back to PARKING_LOT
    once the WO is completed).

    Stored as VARCHAR per CLAUDE.md rule #2.
    """

    PARKING_LOT = "parking_lot"
    OFFSITE     = "offsite"
    CHECKED_OUT = "checked_out"


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

    # Ownership — granular Amazon ownership type (mirrors Cortex
    # `ownershipType`). The wizard hides branding-specific DVIC items
    # (DOT decal, Prime decal) for DSP-* values. Defaults to AMAZON_OWNED
    # which is the most common case for an Amazon DSP.
    ownership: Ownership = Field(
        default=Ownership.AMAZON_OWNED,
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
            server_default="amazon_owned",
        ),
    )

    # Fleet Management Company — free-form because the universe is open
    # (Element / LP / Wheels / Budget / Penske / Holman / Enterprise / …).
    # Sourced from Amazon Cortex's `vehicleProvider` column on bulk upload;
    # editable manually through the vehicle form. Nullable for vans the DSP
    # owns outright with no FMC relationship.
    fmc: str | None = Field(default=None, max_length=50, nullable=True)

    # Current state
    mileage: int = Field(default=0, nullable=False)
    grounded: bool = Field(default=False, index=True, nullable=False)
    grounded_reason: str | None = Field(default=None, max_length=500)
    grounded_at: datetime | None = Field(
        default=None,
        sa_column=Column("grounded_at", DateTime(timezone=True), nullable=True),
    )

    # Where the van is right now. Persisted across sessions so vendor +
    # dispatcher views stay in sync (PARKING_LOT = on lot, OFFSITE = on the
    # road, CHECKED_OUT = pulled by a vendor for overnight repair).
    location: VehicleLocation = Field(
        default=VehicleLocation.PARKING_LOT,
        sa_column=Column(
            "location",
            sa.Enum(
                VehicleLocation,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
            server_default="parking_lot",
        ),
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
