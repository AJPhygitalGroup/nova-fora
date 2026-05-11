"""POST/GET /auth/invitations + accept flow.

Invitation rules (enforced in `_check_can_invite`):
  - site_admin    → can invite any role to any org (or new org)
  - dsp_owner     → can invite dsp_owner to their own org only
  - vendor_admin  → can invite vendor_admin OR technician to their own org only
  - technician    → cannot invite anyone

Public endpoints (no auth):
  - GET  /auth/invitations/{token}/preview  — Sign-up page reads this
  - POST /auth/invitations/{token}/accept   — creates user (+ org), returns JWT pair

Authenticated endpoints:
  - POST   /auth/invitations             — create + send email
  - GET    /auth/invitations             — list (scoped by inviter's org)
  - POST   /auth/invitations/{id}/resend — re-send email + bump expires_at
  - DELETE /auth/invitations/{id}        — revoke (status → revoked)
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.auth.hashing import hash_password
from app.auth.jwt import create_access_token, create_refresh_token
from app.db import get_session
from app.models.base import utc_now
from app.models.invitation import Invitation, InvitationStatus
from app.models.organization import Organization, OrgType
from app.models.user import User, UserRole, UserStatus
from app.schemas.invitation import (
    InvitationAcceptPayload,
    InvitationAcceptResponse,
    InvitationCreate,
    InvitationListResponse,
    InvitationPreview,
    InvitationResponse,
)
from app.services import email as email_service
from app.services.permissions import (
    can_invite_role,
    is_dsp_role,
    is_vendor_role,
)
from app.settings import get_settings

router = APIRouter(prefix="/auth/invitations", tags=["auth"])
settings = get_settings()


# Friendly labels for the email body + sign-up landing
_ROLE_LABELS = {
    UserRole.DSP_OWNER:      "DSP Owner",
    UserRole.DSP_MANAGER:    "DSP Manager",
    UserRole.DSP_INSPECTOR:  "DSP Inspector",
    UserRole.DSP_VIEWER:     "DSP Viewer",
    UserRole.VENDOR_ADMIN:   "Vendor Admin",
    UserRole.SERVICE_WRITER: "Service Writer",
    UserRole.TECHNICIAN:     "Technician",
    UserRole.VENDOR_VIEWER:  "Vendor Viewer",
    UserRole.SITE_ADMIN:     "Site Admin",
}


# ─────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────
def _check_can_invite(
    current: User,
    body: InvitationCreate,
    target_org: Organization | None,
) -> None:
    """Raise 403 if `current` is not allowed to send this invitation.

    Two checks layered:
      1. Role matrix — `services/permissions.can_invite_role` answers
         "is this role allowed to invite that role at all?"
      2. Org scope — non-admin inviters can only invite into their own org
         (which also implies they cannot create new orgs, since that's a
         site_admin-only feature).
    """
    # Site admin: bypass all scoping
    if current.role == UserRole.SITE_ADMIN:
        return

    # Step 1 — role matrix
    if not can_invite_role(current.role, body.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"your role ({current.role.value}) cannot invite {body.role.value} users",
        )

    # Step 2 — org scope. Non-site-admins can only invite within their own
    # existing org (no new-org creation).
    if target_org is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "only site admins can create new organizations via invitation",
        )
    if target_org.id != current.organization_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "you can only invite users to your own organization",
        )

    # Step 3 — role family must match the org type. Catches things like a
    # DSP Owner trying to invite a Technician (Vendor role) to their DSP,
    # which the matrix would block but the message would be confusing.
    org_type = (
        target_org.org_type if isinstance(target_org.org_type, OrgType)
        else OrgType(target_org.org_type)
    )
    if org_type == OrgType.DSP and not is_dsp_role(body.role):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"role {body.role.value} is not valid for a DSP organization",
        )
    if org_type == OrgType.VENDOR and not is_vendor_role(body.role):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"role {body.role.value} is not valid for a Vendor organization",
        )


def _accept_url(token: str) -> str:
    base = settings.app_url.rstrip("/")
    return f"{base}/signup/accept?token={token}"


async def _serialize(
    inv: Invitation,
    session: AsyncSession,
    smtp_delivered: bool = False,
) -> InvitationResponse:
    inviter = (
        await session.execute(select(User).where(User.id == inv.invited_by_id))
    ).scalar_one_or_none()
    org_id_str: str | None = None
    org_name: str | None = inv.org_name
    org_type_v: str | None = inv.org_type.value if inv.org_type else None
    if inv.org_id is not None:
        org = (
            await session.execute(
                select(Organization).where(Organization.id == inv.org_id)
            )
        ).scalar_one_or_none()
        if org is not None:
            org_id_str = org.id_str
            org_name = org_name or org.name
            org_type_v = org_type_v or (
                org.org_type.value if hasattr(org.org_type, "value") else org.org_type
            )

    return InvitationResponse(
        id=inv.id_str,
        email=inv.email,
        full_name=inv.full_name,
        role=inv.role.value if hasattr(inv.role, "value") else inv.role,
        org_id=org_id_str,
        org_name=org_name,
        org_type=org_type_v,
        status=inv.status.value if hasattr(inv.status, "value") else inv.status,
        expires_at=inv.expires_at,
        invited_by_id=inv.invited_by_id,
        invited_by_name=inviter.full_name if inviter else None,
        accept_url=_accept_url(inv.token),
        accepted_at=inv.accepted_at,
        last_email_sent_at=inv.last_email_sent_at,
        smtp_delivered=smtp_delivered,
        created_at=inv.created_at,
    )


def _send_invite_email(
    inv: Invitation,
    inviter_name: str,
    org_label: str,
    lang: str = "en",
) -> bool:
    """Render + send the invitation email in `lang` (en|es).

    `lang` should be the inviter's UI language at send time. We pass it
    through to the renderer so the invitee gets a localized email that
    matches the workspace they were invited from.
    """
    msg = email_service.render_invitation_email(
        invitee_name=inv.full_name,
        inviter_name=inviter_name,
        org_label=org_label,
        role_label=_ROLE_LABELS.get(
            inv.role if isinstance(inv.role, UserRole) else UserRole(inv.role),
            inv.role.value if hasattr(inv.role, "value") else str(inv.role),
        ),
        accept_url=_accept_url(inv.token),
        expires_in_days=settings.invitation_ttl_days,
        lang=lang,
    )
    msg.to = inv.email
    return email_service.send(msg)


# ─────────────────────────────────────────────────────────
# POST /auth/invitations  — create + send email
# ─────────────────────────────────────────────────────────
@router.post(
    "",
    response_model=InvitationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Send an invitation to a new owner / vendor / technician",
)
async def create_invitation(
    body: InvitationCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InvitationResponse:
    # Resolve target org (if existing-org case)
    target_org: Organization | None = None
    if body.org_id is not None:
        target_org = (
            await session.execute(
                select(Organization).where(Organization.id == body.org_id)
            )
        ).scalar_one_or_none()
        if target_org is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "organization not found")

    _check_can_invite(current, body, target_org)

    # Reject if there's already a pending, non-expired invite for this email
    now = utc_now()
    existing_pending = (
        await session.execute(
            select(Invitation).where(
                Invitation.email == body.email.lower(),
                Invitation.status == InvitationStatus.PENDING.value,
                Invitation.expires_at > now,
            )
        )
    ).scalars().first()
    if existing_pending is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "an active invitation already exists for this email — revoke or "
            "resend it instead of creating a duplicate.",
        )

    # Reject if a user with this email is already on the platform
    existing_user = (
        await session.execute(select(User).where(User.email == body.email.lower()))
    ).scalar_one_or_none()
    if existing_user is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "a user with this email already exists",
        )

    # Build the row (token + expires_at default in the model)
    inv = Invitation(
        email=body.email.lower(),
        full_name=body.full_name,
        role=body.role,
        org_id=target_org.id if target_org else None,
        org_type=body.org_type,
        org_name=body.org_name,
        invited_by_id=current.id,
        expires_at=now + timedelta(days=settings.invitation_ttl_days),
    )
    session.add(inv)
    await session.commit()
    await session.refresh(inv)

    # Fire-and-forget email — localized to the inviter's UI language so
    # the invitee receives a message that matches the workspace they
    # were invited from. Defaults to "en" if the user hasn't set one.
    org_label = (
        target_org.name if target_org else (body.org_name or "Nova Fora")
    )
    smtp_ok = _send_invite_email(
        inv, current.full_name, org_label, lang=current.language or "en"
    )
    inv.last_email_sent_at = utc_now()
    session.add(inv)
    await session.commit()
    await session.refresh(inv)

    return await _serialize(inv, session, smtp_delivered=smtp_ok)


# ─────────────────────────────────────────────────────────
# GET /auth/invitations  — list, scoped by the caller's role
# ─────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=InvitationListResponse,
    summary="List invitations the caller can see",
)
async def list_invitations(
    status_filter: str | None = Query(None, alias="status"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InvitationListResponse:
    stmt = select(Invitation)

    # Scoping:
    #   site_admin  → all
    #   dsp_owner / vendor_admin → invitations they sent OR for their org
    if current.role != UserRole.SITE_ADMIN:
        stmt = stmt.where(
            (Invitation.invited_by_id == current.id)
            | (Invitation.org_id == current.organization_id)
        )

    if status_filter:
        try:
            st = InvitationStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"unknown status: {status_filter!r}. Valid: "
                + ", ".join(s.value for s in InvitationStatus),
            ) from None
        stmt = stmt.where(Invitation.status == st.value)

    stmt = stmt.order_by(Invitation.created_at.desc())
    rows = (await session.execute(stmt)).scalars().all()
    items = [await _serialize(r, session) for r in rows]
    return InvitationListResponse(items=items, total=len(items))


# ─────────────────────────────────────────────────────────
# POST /auth/invitations/{id}/resend  — send the email again
# ─────────────────────────────────────────────────────────
@router.post(
    "/{inv_id}/resend",
    response_model=InvitationResponse,
    summary="Re-send the invitation email + bump expires_at",
)
async def resend_invitation(
    inv_id: int = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InvitationResponse:
    inv = (
        await session.execute(select(Invitation).where(Invitation.id == inv_id))
    ).scalar_one_or_none()
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")

    # Same access rule as listing
    if current.role != UserRole.SITE_ADMIN:
        if inv.invited_by_id != current.id and inv.org_id != current.organization_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "not your invitation to resend"
            )

    if inv.status == InvitationStatus.ACCEPTED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invitation already accepted")

    # Reactivate if it was expired/revoked, bump expiry
    inv.status = InvitationStatus.PENDING
    inv.expires_at = utc_now() + timedelta(days=settings.invitation_ttl_days)

    org = None
    if inv.org_id is not None:
        org = (
            await session.execute(
                select(Organization).where(Organization.id == inv.org_id)
            )
        ).scalar_one_or_none()
    org_label = org.name if org else (inv.org_name or "Nova Fora")

    smtp_ok = _send_invite_email(
        inv, current.full_name, org_label, lang=current.language or "en"
    )
    inv.last_email_sent_at = utc_now()
    session.add(inv)
    await session.commit()
    await session.refresh(inv)
    return await _serialize(inv, session, smtp_delivered=smtp_ok)


# ─────────────────────────────────────────────────────────
# DELETE /auth/invitations/{id}  — revoke
# ─────────────────────────────────────────────────────────
@router.delete(
    "/{inv_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke an invitation",
)
async def revoke_invitation(
    inv_id: int = Path(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    inv = (
        await session.execute(select(Invitation).where(Invitation.id == inv_id))
    ).scalar_one_or_none()
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")

    if current.role != UserRole.SITE_ADMIN:
        if inv.invited_by_id != current.id and inv.org_id != current.organization_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "not your invitation to revoke"
            )

    if inv.status == InvitationStatus.ACCEPTED:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "cannot revoke an accepted invitation — disable the user instead",
        )

    inv.status = InvitationStatus.REVOKED
    session.add(inv)
    await session.commit()


# ─────────────────────────────────────────────────────────
# Public preview — no auth, by token
# ─────────────────────────────────────────────────────────
@router.get(
    "/{token}/preview",
    response_model=InvitationPreview,
    summary="Public preview of a pending invitation (used by the Sign-up page)",
)
async def preview_invitation(
    token: str = Path(..., min_length=10, max_length=64),
    session: AsyncSession = Depends(get_session),
) -> InvitationPreview:
    inv = (
        await session.execute(select(Invitation).where(Invitation.token == token))
    ).scalar_one_or_none()
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")
    if inv.status != InvitationStatus.PENDING:
        raise HTTPException(
            status.HTTP_410_GONE,
            f"invitation already {inv.status.value if hasattr(inv.status, 'value') else inv.status}",
        )
    if inv.is_expired:
        raise HTTPException(status.HTTP_410_GONE, "invitation expired")

    inviter = (
        await session.execute(select(User).where(User.id == inv.invited_by_id))
    ).scalar_one_or_none()

    org_name = inv.org_name
    org_type_v = inv.org_type.value if inv.org_type else None
    if inv.org_id is not None and (not org_name or not org_type_v):
        org = (
            await session.execute(
                select(Organization).where(Organization.id == inv.org_id)
            )
        ).scalar_one_or_none()
        if org is not None:
            org_name = org.name
            org_type_v = (
                org.org_type.value if hasattr(org.org_type, "value") else org.org_type
            )

    role_v = inv.role.value if hasattr(inv.role, "value") else inv.role
    return InvitationPreview(
        email=inv.email,
        full_name=inv.full_name,
        role=role_v,
        role_label=_ROLE_LABELS.get(UserRole(role_v), role_v),
        org_name=org_name or "Nova Fora",
        org_type=org_type_v or "platform",
        inviter_name=inviter.full_name if inviter else "the Nova Fora team",
        expires_at=inv.expires_at,
        status=inv.status.value if hasattr(inv.status, "value") else inv.status,
    )


# ─────────────────────────────────────────────────────────
# Public accept — creates User (+ Org if new), returns JWT pair
# ─────────────────────────────────────────────────────────
@router.post(
    "/{token}/accept",
    response_model=InvitationAcceptResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Accept an invitation — creates the account and returns auth tokens",
)
async def accept_invitation(
    body: InvitationAcceptPayload,
    token: str = Path(..., min_length=10, max_length=64),
    session: AsyncSession = Depends(get_session),
) -> InvitationAcceptResponse:
    inv = (
        await session.execute(select(Invitation).where(Invitation.token == token))
    ).scalar_one_or_none()
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")
    if inv.status != InvitationStatus.PENDING:
        raise HTTPException(
            status.HTTP_410_GONE,
            f"invitation already {inv.status.value if hasattr(inv.status, 'value') else inv.status}",
        )
    if inv.is_expired:
        # Mark as expired so subsequent gets show the right state
        inv.status = InvitationStatus.EXPIRED
        session.add(inv)
        await session.commit()
        raise HTTPException(status.HTTP_410_GONE, "invitation expired")

    # Defensive: someone may have signed up with this email between create + accept
    existing = (
        await session.execute(select(User).where(User.email == inv.email))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "a user with this email already exists — log in instead",
        )

    # Create the org if this is a new-org invite
    if inv.org_id is None:
        if not (inv.org_name and inv.org_type):
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "invitation is missing org details",
            )
        org = Organization(
            name=inv.org_name,
            org_type=inv.org_type,
        )
        session.add(org)
        await session.flush()  # need org.id for the user FK
    else:
        org = (
            await session.execute(
                select(Organization).where(Organization.id == inv.org_id)
            )
        ).scalar_one_or_none()
        if org is None:
            raise HTTPException(
                status.HTTP_410_GONE,
                "the organization for this invitation no longer exists",
            )

    role = inv.role if isinstance(inv.role, UserRole) else UserRole(inv.role)
    user = User(
        email=inv.email,
        full_name=body.full_name,
        password_hash=hash_password(body.password),
        organization_id=org.id,
        role=role,
        status=UserStatus.ACTIVE,
        invited_by_id=inv.invited_by_id,
        last_login_at=utc_now(),
    )
    session.add(user)
    await session.flush()

    inv.status = InvitationStatus.ACCEPTED
    inv.accepted_at = utc_now()
    inv.accepted_by_id = user.id
    inv.org_id = org.id  # backfill so listings show the org link
    session.add(inv)

    await session.commit()
    await session.refresh(user)
    await session.refresh(org)

    org_type_v = org.org_type.value if hasattr(org.org_type, "value") else org.org_type
    user_role_v = user.role.value if hasattr(user.role, "value") else user.role

    return InvitationAcceptResponse(
        access_token=create_access_token(user_id=user.id),
        refresh_token=create_refresh_token(user_id=user.id),
        user={
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user_role_v,
            "organization_id": user.organization_id,
        },
        organization={
            "id": org.id_str,
            "name": org.name,
            "org_type": org_type_v,
        },
    )
