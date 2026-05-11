"""Work Order endpoints — STUB during the V2.0 rebuild.

The V1 router was archived to `_work_orders_v1_legacy.py` (kept for
reference; not imported by anything). PR 4 of the wo-v2-rebuild branch
will re-implement this router against the V2.0 schema.

See `docs/wo-v2-rebuild.md` for the rollout plan.
"""
from fastapi import APIRouter, status

router = APIRouter(prefix="/work-orders", tags=["work-orders"])


@router.get(
    "",
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    summary="Stub — work orders endpoints are being rebuilt for V2.0",
)
async def list_work_orders_stub() -> dict:
    """Returns a 503 with explanatory payload so the frontend can show
    a maintenance banner instead of crashing on a missing endpoint.
    """
    return {
        "detail": "work_orders endpoints are being rebuilt for V2.0",
        "branch": "wo-v2-rebuild",
        "see": "docs/wo-v2-rebuild.md",
    }
