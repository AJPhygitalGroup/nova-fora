"""GET /defect-catalog — drives the wizard tile rendering.

The frontend caches this once per session (~30-50 KB JSON). It rarely
changes because reference tables are config, not data.
"""
from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.user import User
from app.schemas.defect_catalog import CatalogResponse
from app.services.defect_catalog import build_catalog

router = APIRouter(prefix="/defect-catalog", tags=["catalog"])


@router.get(
    "",
    response_model=CatalogResponse,
    summary="Defect taxonomy: systems / parts / positions / defect types / JSON Schemas",
)
async def get_defect_catalog(
    response: Response,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CatalogResponse:
    """Returns the full catalog. Cache the response client-side for the
    duration of the user session.

    Response is the same for every authenticated user (no per-user filtering
    at this layer — DSP/vendor-specific catalogs come post-launch).
    """
    catalog = await build_catalog(session)
    # Hint the browser to cache for 5 minutes (small-stake info, refresh
    # automatic on long sessions). The frontend should also cache in memory.
    response.headers["Cache-Control"] = "private, max-age=300"
    return catalog
