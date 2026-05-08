"""GET /defect-catalog?vehicle_class=X — drives the wizard tile rendering.

V2.2: catalog is filtered server-side by vehicle_class so the wizard only
sees rules that apply to the vehicle being inspected. Frontend caches per
(user, vehicle_class) tuple for the session.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.i18n_helpers import get_request_language
from app.models.defect_catalog import VehicleClass
from app.models.user import User
from app.schemas.defect_catalog import CatalogResponse
from app.services.defect_catalog import build_catalog

router = APIRouter(prefix="/defect-catalog", tags=["catalog"])


@router.get(
    "",
    response_model=CatalogResponse,
    summary="Defect taxonomy filtered for a given vehicle_class",
)
async def get_defect_catalog(
    request: Request,
    response: Response,
    vehicle_class: str = Query(
        ...,
        description="One of: custom_delivery_van, regular_cargo_van, "
                    "step_van_dot, electric_vehicle, box_truck_dot",
    ),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CatalogResponse:
    try:
        vc = VehicleClass(vehicle_class)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unknown vehicle_class: {vehicle_class!r}. Valid: "
            + ", ".join(v.value for v in VehicleClass),
        ) from None

    catalog = await build_catalog(session, vc, lang=get_request_language(request))
    response.headers["Cache-Control"] = "private, max-age=300"
    return catalog
