"""Directory endpoints — read-only lookups for users + organizations.

Used by the frontend to populate dropdowns (vendor pickers, technician
assignment, DSP filters) without scraping data from other domain endpoints.

Scoping (MVP):
  - SITE_ADMIN sees everything.
  - DSP_OWNER sees: own org's users + all vendor orgs + own DSP.
  - VENDOR_ADMIN sees: own vendor's users + all DSP orgs + own vendor.
  - TECHNICIAN  sees: own vendor's users + own vendor + all DSP orgs (so the
                     "My DSPs" tab and inspection picker work — techs don't
                     need cross-vendor visibility, but they DO need to know
                     which DSPs they're servicing).

Cross-vendor (V-X seeing V-Y) is NEVER allowed at the directory layer —
that's a multi-tenant leak. The future per-tech DSP assignment table
(post-Jun 15) will narrow the DSP visibility further.
"""
from sqlalchemy import or_
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.organization import OrgType, Organization
from app.models.user import User, UserRole
from app.schemas.user import UserResponse
from app.services.permissions import is_dsp_role, is_vendor_role

# Vendor-side org types — a DSP picks among these; a vendor never sees
# another vendor's row here.
_VENDOR_ORG_TYPES = (OrgType.VENDOR, OrgType.BODY_REPAIR_VENDOR)

router = APIRouter(prefix="", tags=["directory"])


# ─────────────────────────────────────────────────────
# GET /organizations — list orgs (filterable by org_type)
# ─────────────────────────────────────────────────────
@router.get("/organizations", response_model=list[dict])
async def list_organizations(
    org_type: str | None = Query(default=None, description="dsp | vendor | platform"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    q = select(Organization).where(Organization.is_active == True)  # noqa: E712

    # Role scoping (2026-06-08 review #d). The previous code only
    # special-cased TECHNICIAN; DSP_OWNER / VENDOR_ADMIN — and every
    # secondary role — fell through UNFILTERED and could enumerate ALL
    # orgs (other vendors' + DSPs' names, phones, addresses), directly
    # contradicting this module's "cross-vendor is NEVER allowed" rule.
    # Now enforced for the whole taxonomy:
    #   - site_admin     → all orgs.
    #   - DSP-side roles  → vendor/body-shop orgs (to pick one) + own org.
    #                       NOT other DSPs, NOT the platform org.
    #   - vendor-side     → DSP orgs (their customers) + own org.
    #                       NOT other vendors, NOT the platform org.
    #   - anything else   → own org only (safe default).
    if current.role == UserRole.SITE_ADMIN:
        pass
    elif is_dsp_role(current.role):
        q = q.where(or_(
            Organization.org_type.in_(_VENDOR_ORG_TYPES),
            Organization.id == current.organization_id,
        ))
    elif is_vendor_role(current.role):
        q = q.where(or_(
            Organization.org_type == OrgType.DSP,
            Organization.id == current.organization_id,
        ))
    else:
        q = q.where(Organization.id == current.organization_id)

    if org_type:
        try:
            ot = OrgType(org_type)
        except ValueError:
            return []
        q = q.where(Organization.org_type == ot)

    q = q.order_by(Organization.name)
    rows = (await session.execute(q)).scalars().all()
    return [
        {
            "id": o.id_str,
            "name": o.name,
            "org_type": o.org_type.value,
            "phone": o.phone,
            "address": o.address,
        }
        for o in rows
    ]


# ─────────────────────────────────────────────────────
# GET /users — list users (filterable by role + org)
# ─────────────────────────────────────────────────────
@router.get("/users", response_model=list[UserResponse])
async def list_users(
    role: UserRole | None = Query(default=None),
    organization_id: str | None = Query(default=None, description="DSP-XXXX / V-XXX / int"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[UserResponse]:
    q = select(User, Organization).join(Organization, User.organization_id == Organization.id)

    # Default scoping — DSP/Vendor/Tech see only their own org's users
    if current.role != UserRole.SITE_ADMIN:
        q = q.where(User.organization_id == current.organization_id)

    if role is not None:
        q = q.where(User.role == role.value)

    if organization_id is not None:
        # Parse 'DSP-1234' / 'V-005' / 'NF-006' / int
        s = organization_id.strip().upper()
        for prefix in ("V-", "DSP-", "NF-"):
            if s.startswith(prefix):
                s = s[len(prefix):]
                break
        try:
            oid = int(s)
        except ValueError:
            return []
        # Site admin can filter to any org; others can only filter to own
        if current.role == UserRole.SITE_ADMIN or oid == current.organization_id:
            q = q.where(User.organization_id == oid)
        else:
            return []

    q = q.order_by(User.full_name)
    rows = (await session.execute(q)).all()
    return [
        UserResponse.from_user_and_org(
            user, org.name, org.id_str, org.org_type.value
        )
        for user, org in rows
    ]
