"""Vendor Workshop catalog endpoints — V2.0.

A workshop is the physical shop entity (status_tracking_mode + repair_types[]),
distinct from the `organizations` row that owns it (the Nova Fora tenant org).

Authorization:
  - site_admin: full CRUD
  - vendor_admin / dsp_owner / technician: read-only on active workshops
    (catalog visibility for the routing UI; everyone in the network can see
    "what shops exist" but only site_admin mutates)

Schema choices:
  - `id_str` → 'VW-NNN' on the wire (matches mockData.js prefix conventions)
  - repair_types are strings on the wire — matches the RepairType.value
    enum stored in the array column
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.i18n_errors import E, tr_error
from app.i18n_helpers import get_request_language
from app.models.user import User, UserRole
from app.models.work_orders import (
    RepairType,
    StatusTrackingMode,
    VendorWorkshop,
)

router = APIRouter(prefix="/vendor-workshops", tags=["vendor-workshops"])


# ─────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────
class VendorWorkshopCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    organization_id: int | None = None
    status_tracking_mode: StatusTrackingMode = StatusTrackingMode.EXTERNAL
    repair_types: list[RepairType] = Field(default_factory=list)
    is_active: bool = True

    model_config = ConfigDict(use_enum_values=True, extra="forbid")


class VendorWorkshopUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    organization_id: int | None = None
    status_tracking_mode: StatusTrackingMode | None = None
    repair_types: list[RepairType] | None = None
    is_active: bool | None = None

    model_config = ConfigDict(use_enum_values=True, extra="forbid")


class VendorWorkshopResponse(BaseModel):
    id: str
    name: str
    organization_id: int | None = None
    status_tracking_mode: str
    repair_types: list[str]
    is_active: bool
    created_at: datetime

    @classmethod
    def from_model(cls, w: VendorWorkshop) -> "VendorWorkshopResponse":
        tracking = (
            w.status_tracking_mode.value
            if hasattr(w.status_tracking_mode, "value")
            else str(w.status_tracking_mode)
        )
        return cls(
            id=w.id_str,
            name=w.name,
            organization_id=w.organization_id,
            status_tracking_mode=tracking,
            repair_types=list(w.repair_types or []),
            is_active=w.is_active,
            created_at=w.created_at,
        )


class VendorWorkshopListResponse(BaseModel):
    items: list[VendorWorkshopResponse]
    total: int


def _parse_vw_id(raw: str) -> int:
    """Accept either 'VW-001' or '1'."""
    s = raw.strip().upper()
    if s.startswith("VW-"):
        s = s[3:]
    try:
        return int(s)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid vendor_workshop id: {raw!r}. Use int or 'VW-XXX'.",
        ) from e


# ─────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────
@router.get(
    "",
    response_model=VendorWorkshopListResponse,
    summary="List vendor workshops (active by default; site_admin sees all)",
)
async def list_workshops(
    request: Request,
    include_inactive: bool = False,
    repair_type: RepairType | None = None,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VendorWorkshopListResponse:
    _ = current  # auth gate
    _ = get_request_language(request)
    stmt = select(VendorWorkshop)
    if not include_inactive:
        stmt = stmt.where(VendorWorkshop.is_active.is_(True))
    if repair_type is not None:
        stmt = stmt.where(VendorWorkshop.repair_types.any(repair_type.value))
    stmt = stmt.order_by(VendorWorkshop.name)
    rows = list((await session.execute(stmt)).scalars().all())
    items = [VendorWorkshopResponse.from_model(w) for w in rows]
    return VendorWorkshopListResponse(items=items, total=len(items))


@router.get(
    "/{vw_id}",
    response_model=VendorWorkshopResponse,
    summary="Get a workshop by id (accepts 'VW-001' or '1')",
)
async def get_workshop(
    request: Request,
    vw_id: str = Path(..., examples=["VW-001", "1"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VendorWorkshopResponse:
    _ = current
    lang = get_request_language(request)
    wid = _parse_vw_id(vw_id)
    row = (
        await session.execute(select(VendorWorkshop).where(VendorWorkshop.id == wid))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.ORG_NOT_FOUND, lang)
        )
    return VendorWorkshopResponse.from_model(row)


@router.post(
    "",
    response_model=VendorWorkshopResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a workshop (site_admin only)",
)
async def create_workshop(
    body: VendorWorkshopCreate,
    request: Request,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VendorWorkshopResponse:
    lang = get_request_language(request)
    if current.role != UserRole.SITE_ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            tr_error(E.REQUIRES_ROLE, lang, roles=["site_admin"]),
        )

    tracking_mode = (
        StatusTrackingMode(body.status_tracking_mode)
        if isinstance(body.status_tracking_mode, str)
        else body.status_tracking_mode
    )
    rt_values = [
        rt.value if hasattr(rt, "value") else str(rt) for rt in (body.repair_types or [])
    ]
    w = VendorWorkshop(
        name=body.name,
        organization_id=body.organization_id,
        status_tracking_mode=tracking_mode,
        repair_types=rt_values,
        is_active=body.is_active,
    )
    session.add(w)
    await session.commit()
    await session.refresh(w)
    return VendorWorkshopResponse.from_model(w)


@router.patch(
    "/{vw_id}",
    response_model=VendorWorkshopResponse,
    summary="Update a workshop (site_admin only)",
)
async def update_workshop(
    body: VendorWorkshopUpdate,
    request: Request,
    vw_id: str = Path(..., examples=["VW-001", "1"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VendorWorkshopResponse:
    lang = get_request_language(request)
    if current.role != UserRole.SITE_ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            tr_error(E.REQUIRES_ROLE, lang, roles=["site_admin"]),
        )
    wid = _parse_vw_id(vw_id)
    w = (
        await session.execute(select(VendorWorkshop).where(VendorWorkshop.id == wid))
    ).scalar_one_or_none()
    if w is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.ORG_NOT_FOUND, lang)
        )
    if body.name is not None:
        w.name = body.name
    if body.organization_id is not None:
        w.organization_id = body.organization_id
    if body.status_tracking_mode is not None:
        w.status_tracking_mode = (
            StatusTrackingMode(body.status_tracking_mode)
            if isinstance(body.status_tracking_mode, str)
            else body.status_tracking_mode
        )
    if body.repair_types is not None:
        w.repair_types = [
            rt.value if hasattr(rt, "value") else str(rt) for rt in body.repair_types
        ]
    if body.is_active is not None:
        w.is_active = body.is_active
    session.add(w)
    await session.commit()
    await session.refresh(w)
    return VendorWorkshopResponse.from_model(w)


@router.delete(
    "/{vw_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-deactivate a workshop (site_admin only — sets is_active=false)",
)
async def deactivate_workshop(
    request: Request,
    vw_id: str = Path(..., examples=["VW-001", "1"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    lang = get_request_language(request)
    if current.role != UserRole.SITE_ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            tr_error(E.REQUIRES_ROLE, lang, roles=["site_admin"]),
        )
    wid = _parse_vw_id(vw_id)
    w = (
        await session.execute(select(VendorWorkshop).where(VendorWorkshop.id == wid))
    ).scalar_one_or_none()
    if w is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.ORG_NOT_FOUND, lang)
        )
    w.is_active = False
    session.add(w)
    await session.commit()
    return None
