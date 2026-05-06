"""Vehicle request/response schemas — matches nova-fora-demo/src/data/mockData.js.

V2.2 NOTE: replaces V1's `asset_type` with `vehicle_class` (driving the new
`defect_applicability` lookup).
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.defect_catalog import VehicleClass
from app.models.organization import Organization
from app.models.vehicle import Ownership, Vehicle


class VehicleResponse(BaseModel):
    """Frontend-facing vehicle shape."""

    id: str              # "VAN-0004"
    dsp_id: str          # "DSP-0004"
    dsp: str             # "Ribrell 21" (org name)
    fleet_id: str        # "PR006"
    vin: str
    plate: str
    year: int
    make: str
    model: str
    mileage: int
    grounded: bool
    grounded_reason: str | None = None
    grounded_at: datetime | None = None
    vehicle_class: str = "regular_cargo_van"  # drives catalog applicability
    ownership: str = "branded"                # branded | owner | rented

    # Derived from inspections / defects
    defect_count: int = 0
    last_inspected: str | None = None
    photos: int = 0
    inspector: str | None = None

    is_active: bool = True

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_vehicle(cls, v: Vehicle, org: Organization) -> "VehicleResponse":
        return cls(
            id=v.id_str,
            dsp_id=org.id_str,
            dsp=org.name,
            fleet_id=v.fleet_id,
            vin=v.vin,
            plate=v.plate,
            year=v.year,
            make=v.make,
            model=v.model,
            mileage=v.mileage,
            grounded=v.grounded,
            grounded_reason=v.grounded_reason,
            grounded_at=v.grounded_at,
            vehicle_class=(
                v.vehicle_class.value if hasattr(v.vehicle_class, "value")
                else str(v.vehicle_class)
            ),
            ownership=(
                v.ownership.value if hasattr(v.ownership, "value")
                else str(v.ownership)
            ),
            is_active=v.is_active,
        )


class VehicleCreate(BaseModel):
    """POST /vehicles body."""

    dsp_id: int | None = None
    fleet_id: str = Field(min_length=1, max_length=50)
    vin: str = Field(min_length=17, max_length=17, pattern=r"^[A-HJ-NPR-Z0-9]{17}$")
    plate: str = Field(min_length=1, max_length=20)
    year: int = Field(ge=1980, le=2100)
    make: str = Field(min_length=1, max_length=50)
    model: str = Field(min_length=1, max_length=100)
    mileage: int = Field(default=0, ge=0)
    vehicle_class: VehicleClass = VehicleClass.REGULAR_CARGO_VAN
    ownership: Ownership = Ownership.BRANDED

    model_config = ConfigDict(extra="forbid")


class VehicleUpdate(BaseModel):
    """PATCH /vehicles/{id} body — all fields optional."""

    fleet_id: str | None = Field(default=None, min_length=1, max_length=50)
    plate: str | None = Field(default=None, min_length=1, max_length=20)
    year: int | None = Field(default=None, ge=1980, le=2100)
    make: str | None = Field(default=None, min_length=1, max_length=50)
    model: str | None = Field(default=None, min_length=1, max_length=100)
    mileage: int | None = Field(default=None, ge=0)
    grounded: bool | None = None
    grounded_reason: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None
    vehicle_class: VehicleClass | None = None
    ownership: Ownership | None = None

    model_config = ConfigDict(extra="forbid")


class VehicleListResponse(BaseModel):
    """Paginated list response."""

    items: list[VehicleResponse]
    total: int
    page: int
    per_page: int
