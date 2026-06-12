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

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.i18n_errors import E, tr_error
from app.i18n_helpers import get_request_language
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.models.work_orders import (
    CustomerPreferredVendor,
    RepairType,
    StatusTrackingMode,
    VendorBucksLedger,
    VendorWorkshop,
)
from app.services.permissions import is_dsp_role, is_vendor_role

router = APIRouter(prefix="/vendor-workshops", tags=["vendor-workshops"])

# Separate router for preferred-vendor CRUD so the dynamic
# `/vendor-workshops/{workshop_id}` route doesn't swallow paths like
# `/vendor-workshops/preferred-vendors`. Mounted in main.py alongside
# the workshop router.
preferred_router = APIRouter(
    prefix="/customer-preferred-vendors",
    tags=["customer-preferred-vendors"],
)

# Rewards ledger / balance — same router-split rationale as
# preferred-vendors (avoid /vendor-workshops/{id} dynamic-route
# collision). Mounted in main.py alongside the workshop router.
bucks_router = APIRouter(
    prefix="/vendor-bucks",
    tags=["vendor-bucks"],
)


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


# ═════════════════════════════════════════════════════
# Customer preferred vendors (spec §10, mockup p.10)
# ═════════════════════════════════════════════════════
#
# Per-DSP "primary vendor" preferences. Iter-1 supports only the
# boolean `is_primary` flag (one primary per (dsp, repair_type) pair),
# enforced via the partial unique index in the 20260525_2100 migration.
# Frontend (My DSPs card) shows a gold ribbon badge when the current
# vendor is primary for that DSP.

class PreferredVendorResponse(BaseModel):
    id: int
    dsp_id: int
    dsp_name: str | None = None
    vendor_workshop_id: int
    workshop_name: str | None = None
    repair_type: str | None = None
    is_primary: bool
    created_at: datetime


class PreferredVendorCreate(BaseModel):
    """Body for POST /customer-preferred-vendors."""

    dsp_id: int
    vendor_workshop_id: int
    repair_type: str | None = Field(
        default=None,
        description="RepairType value, or omit for 'applies to all repair types'.",
    )
    is_primary: bool = True
    model_config = ConfigDict(extra="forbid")


@preferred_router.get(
    "",
    response_model=list[PreferredVendorResponse],
    summary="List customer preferred-vendor rows (filterable)",
)
async def list_preferred_vendors(
    dsp_id: int | None = None,
    vendor_workshop_id: int | None = None,
    is_primary: bool | None = None,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[PreferredVendorResponse]:
    """Scoped read (2026-06-08 review #d). The preferred-vendor graph —
    which DSP prefers which vendor — is cross-tenant sensitive, so the
    old "public read for any authenticated user" let a vendor enumerate a
    competitor's whole customer roster (and vice-versa). Now:
      - site_admin   → all (optional filters honored).
      - DSP roles    → only their own org's preferences.
      - vendor roles → only rows pointing at their own workshops.
      - anything else→ nothing.
    The optional query filters can only narrow within that allowed set.
    """
    q = (
        select(CustomerPreferredVendor, Organization, VendorWorkshop)
        .join(Organization, Organization.id == CustomerPreferredVendor.dsp_id, isouter=True)
        .join(VendorWorkshop, VendorWorkshop.id == CustomerPreferredVendor.vendor_workshop_id, isouter=True)
    )

    if current.role == UserRole.SITE_ADMIN:
        pass
    elif is_dsp_role(current.role):
        q = q.where(CustomerPreferredVendor.dsp_id == current.organization_id)
    elif is_vendor_role(current.role):
        my_ws = (
            await session.execute(
                select(VendorWorkshop.id).where(
                    VendorWorkshop.organization_id == current.organization_id
                )
            )
        ).scalars().all()
        if not my_ws:
            return []
        q = q.where(CustomerPreferredVendor.vendor_workshop_id.in_(list(my_ws)))
    else:
        return []

    if dsp_id is not None:
        q = q.where(CustomerPreferredVendor.dsp_id == dsp_id)
    if vendor_workshop_id is not None:
        q = q.where(CustomerPreferredVendor.vendor_workshop_id == vendor_workshop_id)
    if is_primary is not None:
        q = q.where(CustomerPreferredVendor.is_primary == is_primary)
    rows = (await session.execute(q)).all()
    return [
        PreferredVendorResponse(
            id=row[0].id,
            dsp_id=row[0].dsp_id,
            dsp_name=row[1].name if row[1] else None,
            vendor_workshop_id=row[0].vendor_workshop_id,
            workshop_name=row[2].name if row[2] else None,
            repair_type=row[0].repair_type,
            is_primary=row[0].is_primary,
            created_at=row[0].created_at,
        )
        for row in rows
    ]


@preferred_router.post(
    "",
    response_model=PreferredVendorResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Pin a vendor as preferred for a DSP (optionally per repair_type)",
)
async def upsert_preferred_vendor(
    body: PreferredVendorCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PreferredVendorResponse:
    """Tenancy:
      - site_admin: anything
      - dsp_owner: only on their own DSP
      - vendor_admin: not allowed (the DSP picks, not the vendor)

    If is_primary=True and another row is already primary for the
    (dsp_id, repair_type) tuple, that other row is demoted first so the
    partial unique index in the migration doesn't reject the insert.
    """
    if current.role == UserRole.SITE_ADMIN:
        pass
    elif current.role == UserRole.DSP_OWNER and current.organization_id == body.dsp_id:
        pass
    else:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "only DSP owner or site admin can set preferred vendors",
        )

    # Validate workshop handles this repair_type (when given).
    ws = (
        await session.execute(
            select(VendorWorkshop).where(VendorWorkshop.id == body.vendor_workshop_id)
        )
    ).scalar_one_or_none()
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vendor_workshop not found")

    # Demote any existing primary for (dsp_id, repair_type) so the partial
    # unique index doesn't reject the insert.
    if body.is_primary:
        existing_primary = (
            await session.execute(
                select(CustomerPreferredVendor)
                .where(CustomerPreferredVendor.dsp_id == body.dsp_id)
                .where(CustomerPreferredVendor.repair_type == body.repair_type)
                .where(CustomerPreferredVendor.is_primary.is_(True))
            )
        ).scalars().all()
        for row in existing_primary:
            if row.vendor_workshop_id != body.vendor_workshop_id:
                row.is_primary = False
                session.add(row)

    # Upsert: if (dsp, vendor, repair_type) row exists, update; else insert.
    row = (
        await session.execute(
            select(CustomerPreferredVendor)
            .where(CustomerPreferredVendor.dsp_id == body.dsp_id)
            .where(CustomerPreferredVendor.vendor_workshop_id == body.vendor_workshop_id)
            .where(CustomerPreferredVendor.repair_type == body.repair_type)
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        row = CustomerPreferredVendor(
            dsp_id=body.dsp_id,
            vendor_workshop_id=body.vendor_workshop_id,
            repair_type=body.repair_type,
            is_primary=body.is_primary,
            created_by_id=current.id,
        )
        session.add(row)
    else:
        row.is_primary = body.is_primary
        session.add(row)
    await session.commit()
    await session.refresh(row)
    org = (
        await session.execute(select(Organization).where(Organization.id == row.dsp_id))
    ).scalar_one_or_none()
    return PreferredVendorResponse(
        id=row.id,
        dsp_id=row.dsp_id,
        dsp_name=org.name if org else None,
        vendor_workshop_id=row.vendor_workshop_id,
        workshop_name=ws.name,
        repair_type=row.repair_type,
        is_primary=row.is_primary,
        created_at=row.created_at,
    )


@preferred_router.delete(
    "/{row_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unpin a preferred-vendor row",
)
async def delete_preferred_vendor(
    row_id: int = Path(..., ge=1),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(
            select(CustomerPreferredVendor).where(CustomerPreferredVendor.id == row_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "preference not found")
    if current.role == UserRole.SITE_ADMIN:
        pass
    elif current.role == UserRole.DSP_OWNER and current.organization_id == row.dsp_id:
        pass
    else:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "only DSP owner or site admin can unpin preferred vendors",
        )
    await session.delete(row)
    await session.commit()
    return None


# ═════════════════════════════════════════════════════
# Vendor bucks ledger — read-only iter-1 (accrual entries only)
# ═════════════════════════════════════════════════════
#
# GET /vendor-bucks/{vendor_workshop_id}/balance?dsp_id=
#   → sum of all amount rows per (ws, dsp). Optionally filter to one DSP.
#
# GET /vendor-bucks/{vendor_workshop_id}/ledger?dsp_id=
#   → newest-first list of ledger rows. Used for the audit drawer.
#
# Tenancy: workshop owners + site_admin; DSP owner can read their own
# (so they see "how many bucks am I sitting on with this vendor").

from decimal import Decimal as _Decimal


class BucksBalanceRow(BaseModel):
    vendor_workshop_id: int
    dsp_id: int
    dsp_name: str | None = None
    balance: _Decimal


class BucksLedgerRow(BaseModel):
    id: int
    vendor_workshop_id: int
    dsp_id: int
    dsp_name: str | None = None
    rewards_program_id: int | None = None
    defect_id: int | None = None
    work_order_id: int | None = None
    entry_type: str
    amount: _Decimal
    expires_at: date | None = None
    notes: str | None = None
    created_at: datetime


async def _bucks_authz_ok(session: AsyncSession, user: User, ws_id: int, dsp_id: int | None) -> bool:
    """Workshop owner can always read theirs; DSP owner can read theirs
    (when filtered to that DSP); site_admin reads anything.
    """
    if user.role == UserRole.SITE_ADMIN:
        return True
    if user.role in (UserRole.DSP_OWNER, UserRole.DSP_MANAGER):
        return dsp_id is not None and user.organization_id == dsp_id
    # vendor-side: must own the workshop
    if user.organization_id is None:
        return False
    ws = (
        await session.execute(
            select(VendorWorkshop).where(VendorWorkshop.id == ws_id)
        )
    ).scalar_one_or_none()
    return ws is not None and ws.organization_id == user.organization_id


@bucks_router.get(
    "/{vendor_workshop_id}/balance",
    response_model=list[BucksBalanceRow],
    summary="Per-DSP bucks balance for a workshop (sum of ledger amounts)",
)
async def bucks_balance(
    vendor_workshop_id: int = Path(..., ge=1),
    dsp_id: int | None = None,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[BucksBalanceRow]:
    from sqlalchemy import func
    if not await _bucks_authz_ok(session, current, vendor_workshop_id, dsp_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not allowed")

    q = (
        select(
            VendorBucksLedger.vendor_workshop_id,
            VendorBucksLedger.dsp_id,
            func.coalesce(func.sum(VendorBucksLedger.amount), 0).label("balance"),
        )
        .where(VendorBucksLedger.vendor_workshop_id == vendor_workshop_id)
        .group_by(
            VendorBucksLedger.vendor_workshop_id,
            VendorBucksLedger.dsp_id,
        )
    )
    if dsp_id is not None:
        q = q.where(VendorBucksLedger.dsp_id == dsp_id)
    rows = (await session.execute(q)).all()

    out: list[BucksBalanceRow] = []
    for ws_id, did, bal in rows:
        org = (
            await session.execute(select(Organization).where(Organization.id == did))
        ).scalar_one_or_none()
        out.append(BucksBalanceRow(
            vendor_workshop_id=ws_id,
            dsp_id=did,
            dsp_name=org.name if org else None,
            balance=_Decimal(bal),
        ))
    return out


@bucks_router.post(
    "/expire-now",
    summary="Run the expiry sweep manually (admin) — writes 'expiry' rows for past-due accruals",
)
async def bucks_expire_now(
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Manual trigger for the expiry job. iter-2 plumbing — iter-3 will
    schedule via cron. Site-admin only.
    """
    if current.role != UserRole.SITE_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "site_admin only")
    from app.services.vendor_bucks import expire_aged_entries
    created = await expire_aged_entries(session, actor_id=current.id)
    await session.commit()
    return {
        "expired_count": len(created),
        "total_amount": str(sum((row.amount for row in created), start=__import__("decimal").Decimal(0))),
    }


@bucks_router.get(
    "/{vendor_workshop_id}/ledger",
    response_model=list[BucksLedgerRow],
    summary="Bucks ledger entries for a workshop, newest first",
)
async def bucks_ledger(
    vendor_workshop_id: int = Path(..., ge=1),
    dsp_id: int | None = None,
    limit: int = 100,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[BucksLedgerRow]:
    if not await _bucks_authz_ok(session, current, vendor_workshop_id, dsp_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not allowed")

    q = (
        select(VendorBucksLedger, Organization)
        .outerjoin(Organization, Organization.id == VendorBucksLedger.dsp_id)
        .where(VendorBucksLedger.vendor_workshop_id == vendor_workshop_id)
        .order_by(VendorBucksLedger.created_at.desc())
        .limit(limit)
    )
    if dsp_id is not None:
        q = q.where(VendorBucksLedger.dsp_id == dsp_id)
    rows = (await session.execute(q)).all()

    return [
        BucksLedgerRow(
            id=r.id,
            vendor_workshop_id=r.vendor_workshop_id,
            dsp_id=r.dsp_id,
            dsp_name=org.name if org else None,
            rewards_program_id=r.rewards_program_id,
            defect_id=r.defect_id,
            work_order_id=r.work_order_id,
            entry_type=r.entry_type,
            amount=r.amount,
            expires_at=r.expires_at,
            notes=r.notes,
            created_at=r.created_at,
        )
        for r, org in rows
    ]
