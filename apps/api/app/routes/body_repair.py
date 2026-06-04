"""Body Repair routes — port of web-mbk-body-repair-demo.

Phase 0 endpoints (this commit):
  POST /body-repair/requests        — customer submits a new request
  GET  /body-repair/requests        — list scoped to caller's role

Phase 1+ will add: PAVE upload, vendor queue, quote submission/selection,
pickup proposal, repair lifecycle, completion + photo capture, messages,
activity timeline.

Tenancy:
  - dsp_owner: only their own DSP's requests (filtered to user.org_id)
  - body_repair_vendor_admin: requests assigned to their org OR
    everything in pending_quotes (open for bidding)
  - site_admin: everything
  - vendor (regular mech): no access (403)

The body repair flow is independent from WO V2 — different lifecycle,
different role surfaces, different vendor org type. We don't try to
shoehorn it into the WorkOrder schema.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.body_repair import (
    BodyRepairRequest,
    BodyRepairRequestStatus,
    BodyRepairSubmissionMode,
)
from app.models.organization import Organization, OrgType
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle

router = APIRouter(prefix="/body-repair", tags=["body-repair"])


# ─────────────────────────────────────────────────────
# Request/Response shapes
# ─────────────────────────────────────────────────────
class CreateRequestBody(BaseModel):
    """Customer submission payload — Phase 0 only supports `mode='text'`.

    Future modes ('parts', 'grade') will add their own required fields
    via discriminated-union extensions or sibling endpoints.
    """

    vehicle_id: int = Field(..., gt=0, description="int id of the vehicle the customer wants repaired")
    mode: BodyRepairSubmissionMode = Field(default=BodyRepairSubmissionMode.TEXT)
    text_description: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(extra="forbid")


class BodyRepairRequestResponse(BaseModel):
    """Wire shape — mirrors mockData conventions (prefixed ids, ISO
    timestamps). camelCase happens via keysToCamel on the frontend."""

    id: str
    dsp_id: str
    vehicle_id: str
    assigned_vendor_id: str | None
    submission_mode: str
    text_description: str | None
    status: str
    selected_quote_id: int | None
    quote_selected_at: datetime | None
    pickup_proposed_at: datetime | None
    pickup_confirmed_at: datetime | None
    picked_up_at: datetime | None
    repair_started_at: datetime | None
    repair_completed_at: datetime | None
    returned_at: datetime | None
    paid_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # Denormalized for the list view — saves an N+1 on every render.
    vehicle_fleet_id: str | None = None
    vehicle_year: int | None = None
    vehicle_make: str | None = None
    vehicle_model: str | None = None
    dsp_name: str | None = None
    vendor_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class BodyRepairRequestListResponse(BaseModel):
    items: list[BodyRepairRequestResponse]
    total: int


# ─────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────
async def _build_response(
    session: AsyncSession, req: BodyRepairRequest
) -> BodyRepairRequestResponse:
    """Denormalize vehicle + org names for the wire response."""
    veh = (await session.execute(select(Vehicle).where(Vehicle.id == req.vehicle_id))).scalar_one_or_none()
    dsp = (await session.execute(select(Organization).where(Organization.id == req.dsp_id))).scalar_one_or_none()
    vendor = None
    if req.assigned_vendor_id is not None:
        vendor = (
            await session.execute(
                select(Organization).where(Organization.id == req.assigned_vendor_id)
            )
        ).scalar_one_or_none()
    return BodyRepairRequestResponse(
        id=req.id_str,
        dsp_id=dsp.id_str if dsp else f"DSP-{req.dsp_id:04d}",
        vehicle_id=veh.id_str if veh else f"VAN-{req.vehicle_id:04d}",
        assigned_vendor_id=(vendor.id_str if vendor else None),
        submission_mode=req.submission_mode.value if hasattr(req.submission_mode, "value") else req.submission_mode,
        text_description=req.text_description,
        status=req.status.value if hasattr(req.status, "value") else req.status,
        selected_quote_id=req.selected_quote_id,
        quote_selected_at=req.quote_selected_at,
        pickup_proposed_at=req.pickup_proposed_at,
        pickup_confirmed_at=req.pickup_confirmed_at,
        picked_up_at=req.picked_up_at,
        repair_started_at=req.repair_started_at,
        repair_completed_at=req.repair_completed_at,
        returned_at=req.returned_at,
        paid_at=req.paid_at,
        created_at=req.created_at,
        updated_at=req.updated_at,
        vehicle_fleet_id=veh.fleet_id if veh else None,
        vehicle_year=veh.year if veh else None,
        vehicle_make=veh.make if veh else None,
        vehicle_model=veh.model if veh else None,
        dsp_name=dsp.name if dsp else None,
        vendor_name=vendor.name if vendor else None,
    )


# ─────────────────────────────────────────────────────
# POST /body-repair/requests — customer creates new request
# ─────────────────────────────────────────────────────
@router.post(
    "/requests",
    response_model=BodyRepairRequestResponse,
    summary="Customer submits a new body repair request (Phase 0: text mode only)",
    responses={
        400: {"description": "Validation failure (e.g. text mode requires text_description)."},
        403: {"description": "Caller is not a DSP owner or site admin."},
        404: {"description": "Vehicle not found OR belongs to a different DSP."},
    },
)
async def create_request(
    body: CreateRequestBody,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BodyRepairRequestResponse:
    """Customer-side entry into the body repair flow.

    Phase 0 scope: text mode only — customer types a free-form
    description of what they want fixed. The submission lands in
    `pending_quotes` state, ready for vendor pickup in Phase 2.

    Auth: dsp_owner of the vehicle's DSP, OR site_admin (for support /
    impersonation). Cross-DSP create is blocked at the vehicle lookup.
    """
    # Auth gate — only the customer (DSP owner) or site_admin can
    # create requests. Body repair vendors can't create on behalf of
    # the customer in Phase 0.
    if current.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "only dsp_owner or site_admin can submit body repair requests",
        )

    # Phase 0: enforce mode='text' + non-empty text_description.
    if body.mode != BodyRepairSubmissionMode.TEXT:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"submission mode '{body.mode.value}' will land in a later phase — "
            f"only 'text' is supported in Phase 0",
        )
    if not (body.text_description and body.text_description.strip()):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "text_description is required when mode='text'",
        )

    # Vehicle lookup + tenancy enforcement.
    veh = (
        await session.execute(select(Vehicle).where(Vehicle.id == body.vehicle_id))
    ).scalar_one_or_none()
    if veh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    if current.role == UserRole.DSP_OWNER and veh.dsp_id != current.organization_id:
        # Same 404 (not 403) — don't leak the existence of other DSPs'
        # vehicles. Matches the pattern elsewhere in the codebase.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")

    req = BodyRepairRequest(
        dsp_id=veh.dsp_id,
        vehicle_id=veh.id,
        submission_mode=BodyRepairSubmissionMode.TEXT,
        text_description=body.text_description.strip(),
        status=BodyRepairRequestStatus.PENDING_QUOTES,
        created_by_id=current.id,
    )
    session.add(req)
    await session.commit()
    await session.refresh(req)
    return await _build_response(session, req)


# ─────────────────────────────────────────────────────
# GET /body-repair/requests — role-scoped list
# ─────────────────────────────────────────────────────
@router.get(
    "/requests",
    response_model=BodyRepairRequestListResponse,
    summary="List body repair requests, scoped by caller's role",
)
async def list_requests(
    status_filter: BodyRepairRequestStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BodyRepairRequestListResponse:
    """Role-scoped read of the body repair queue.

    Scoping rules:
      - dsp_owner             → WHERE dsp_id = current.org_id
      - body_repair_vendor_*  → WHERE assigned_vendor_id = current.org_id
                                OR status='pending_quotes' (open for bidding)
      - site_admin            → no filter
      - vendor (regular mech) → 403; body repair is its own surface
    """
    if current.role == UserRole.VENDOR_ADMIN or current.role == UserRole.SERVICE_WRITER:
        # Regular mech vendors don't see body repair work — different
        # org type entirely. The Body Repair Vendor tab is the entry
        # point for orgs with that capability.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "body repair is handled by body_repair_vendor orgs — not a mechanical vendor surface",
        )

    stmt = select(BodyRepairRequest).order_by(BodyRepairRequest.created_at.desc())

    if current.role == UserRole.DSP_OWNER:
        stmt = stmt.where(BodyRepairRequest.dsp_id == current.organization_id)
    elif current.role == UserRole.SITE_ADMIN:
        pass  # no extra filter
    else:
        # Body repair vendor — see their assigned work + the open queue.
        # Role check via the org_type rather than UserRole: a
        # body_repair_vendor's admin can be any role bound to that org.
        org = (
            await session.execute(
                select(Organization).where(Organization.id == current.organization_id)
            )
        ).scalar_one_or_none()
        if org is None or org.org_type != OrgType.BODY_REPAIR_VENDOR:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not a body repair vendor")
        stmt = stmt.where(
            (BodyRepairRequest.assigned_vendor_id == current.organization_id)
            | (BodyRepairRequest.status == BodyRepairRequestStatus.PENDING_QUOTES.value)
        )

    if status_filter is not None:
        stmt = stmt.where(BodyRepairRequest.status == status_filter.value)

    stmt = stmt.limit(limit)
    rows = list((await session.execute(stmt)).scalars().all())
    items = [await _build_response(session, r) for r in rows]
    return BodyRepairRequestListResponse(items=items, total=len(items))


# ─────────────────────────────────────────────────────
# GET /body-repair/requests/{id} — detail view
# ─────────────────────────────────────────────────────
@router.get(
    "/requests/{req_id}",
    response_model=BodyRepairRequestResponse,
)
async def get_request(
    req_id: str = Path(..., examples=["BRR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BodyRepairRequestResponse:
    """Detail view. Same tenancy rules as the list endpoint —
    cross-tenant returns 404 silently."""

    # Accept either prefixed or bare int (Nova Fora convention).
    raw = str(req_id).strip()
    int_id: int | None = None
    if raw.upper().startswith("BRR-"):
        raw_num = raw[4:]
        if raw_num.isdigit():
            int_id = int(raw_num)
    elif raw.isdigit():
        int_id = int(raw)
    if int_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    req = (
        await session.execute(select(BodyRepairRequest).where(BodyRepairRequest.id == int_id))
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    # Tenancy.
    if current.role == UserRole.DSP_OWNER and req.dsp_id != current.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    if current.role == UserRole.VENDOR_ADMIN or current.role == UserRole.SERVICE_WRITER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not a body repair surface")
    # Body repair vendor — must be assigned OR request is still open.
    if current.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN):
        org = (
            await session.execute(
                select(Organization).where(Organization.id == current.organization_id)
            )
        ).scalar_one_or_none()
        if org is None or org.org_type != OrgType.BODY_REPAIR_VENDOR:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not a body repair vendor")
        if (
            req.assigned_vendor_id != current.organization_id
            and req.status != BodyRepairRequestStatus.PENDING_QUOTES
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    return await _build_response(session, req)
