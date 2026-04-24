"""Organization response schemas — serializes id with prefix for frontend compat."""
from pydantic import BaseModel, ConfigDict

from app.models.organization import OrgType, Organization


class OrganizationResponse(BaseModel):
    """Shape for /organizations/* endpoints.

    id is serialized with the type prefix (DSP-4201, V-001, NF-000) matching
    nova-fora-demo/src/data/mockData.js.
    """

    id: str
    name: str
    org_type: OrgType
    phone: str | None = None
    address: str | None = None
    is_active: bool

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_org(cls, org: Organization) -> "OrganizationResponse":
        return cls(
            id=org.id_str,
            name=org.name,
            org_type=org.org_type,
            phone=org.phone,
            address=org.address,
            is_active=org.is_active,
        )
