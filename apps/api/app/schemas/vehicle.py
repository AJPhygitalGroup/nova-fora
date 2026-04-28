"""Vehicle request/response schemas — matches nova-fora-demo/src/data/mockData.js.

Derived fields (defect_count, last_inspected, photos) are set to defaults
here. Later, when inspections/defects are live, the endpoint will JOIN
with those tables and populate these fields from real data.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.organization import Organization
from app.models.vehicle import Vehicle


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
    asset_type: str = "extra_large_cargo_van"  # drives DVIC template selection

    # Derived from inspections / defects (stubbed until Semana 3 PR 2)
    defect_count: int = 0
    last_inspected: str | None = None  # "Today, 6:15 AM" or ISO timestamp
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
            asset_type=(
                v.asset_type.value if hasattr(v.asset_type, "value")
                else str(v.asset_type)
            ),
            is_active=v.is_active,
        )


class VehicleCreate(BaseModel):
    """POST /vehicles body.

    `dsp_id` is optional: if omitted and the caller is a dsp_owner, it defaults
    to the caller's own org. site_admin must specify dsp_id explicitly.
    """

    dsp_id: int | None = None
    fleet_id: str = Field(min_length=1, max_length=50)
    vin: str = Field(min_length=17, max_length=17, pattern=r"^[A-HJ-NPR-Z0-9]{17}$")
    plate: str = Field(min_length=1, max_length=20)
    year: int = Field(ge=1980, le=2100)
    make: str = Field(min_length=1, max_length=50)
    model: str = Field(min_length=1, max_length=100)
    mileage: int = Field(default=0, ge=0)

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

    model_config = ConfigDict(extra="forbid")


class VehicleListResponse(BaseModel):
    """Paginated list response matching common frontend table expectations."""

    items: list[VehicleResponse]
    total: int
    page: int
    per_page: int
