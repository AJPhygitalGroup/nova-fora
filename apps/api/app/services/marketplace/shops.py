"""Marketplace shops — profiles, specialties, onboarding, recipients (spec §8).

Shops are Nova Fora orgs with `org_type` `vendor` or `body_repair_vendor`.
  - registered: org has ≥1 active user → logs in, sees the board in-app;
    its vendor admins get the emails.
  - prospect:   no active users → gets emails at the profile's contact
    email with a magic link to the board. At its first quote it confirms
    the email + accepts the DFS Repair Partner terms, and an invitation is
    created through the existing invitation flow (invitations table +
    /signup/accept page).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.base import utc_now
from app.models.invitation import Invitation, InvitationStatus
from app.models.marketplace import (
    MarketplaceShopProfile,
    MarketplaceSpecialty,
    ShopOnboardingStatus,
)
from app.models.organization import Organization, OrgType
from app.models.user import User, UserRole, UserStatus
from app.services.marketplace import tokens
from app.settings import get_settings

SHOP_ORG_TYPES = (OrgType.VENDOR, OrgType.BODY_REPAIR_VENDOR)
# Roles that may submit / revise / withdraw quotes for their shop.
QUOTING_ROLES = (UserRole.VENDOR_ADMIN, UserRole.SERVICE_WRITER)


def _v(x) -> str:
    return x.value if hasattr(x, "value") else str(x)


def is_shop_org(org: Organization | None) -> bool:
    return org is not None and _v(org.org_type) in {t.value for t in SHOP_ORG_TYPES}


def default_specialties(org_type) -> list[str]:
    """Spec §3: body_repair_vendor → body, vendor → general."""
    if _v(org_type) == OrgType.BODY_REPAIR_VENDOR.value:
        return [MarketplaceSpecialty.BODY.value]
    return [MarketplaceSpecialty.GENERAL.value]


@dataclass
class ShopActor:
    """Who is acting on the shop side of a request."""

    org: Organization
    profile: MarketplaceShopProfile
    user: User | None  # None → prospect via magic link

    @property
    def kind(self) -> str:
        from app.services.marketplace.events import ACTOR_PROSPECT, ACTOR_SHOP_USER

        return ACTOR_SHOP_USER if self.user is not None else ACTOR_PROSPECT

    @property
    def can_quote(self) -> bool:
        if self.user is None:
            return True  # prospect link is the shop's own inbox
        return _v(self.user.role) in {r.value for r in QUOTING_ROLES}


async def has_active_users(session: AsyncSession, org_id: int) -> bool:
    return (
        await session.execute(
            select(User.id)
            .where(User.organization_id == org_id)
            .where(User.status == UserStatus.ACTIVE)
            .limit(1)
        )
    ).first() is not None


async def refresh_onboarding_status(
    session: AsyncSession, profile: MarketplaceShopProfile
) -> ShopOnboardingStatus:
    if await has_active_users(session, profile.organization_id):
        status = ShopOnboardingStatus.REGISTERED
    elif profile.terms_accepted_at is not None:
        status = ShopOnboardingStatus.INVITED
    else:
        status = ShopOnboardingStatus.PROSPECT
    if _v(profile.onboarding_status) != status.value:
        profile.onboarding_status = status
        session.add(profile)
    return status


async def ensure_shop_profile(session: AsyncSession, org: Organization) -> MarketplaceShopProfile:
    """Get or lazily create the org's marketplace profile."""
    profile = (
        await session.execute(
            select(MarketplaceShopProfile).where(MarketplaceShopProfile.organization_id == org.id)
        )
    ).scalar_one_or_none()
    if profile is None:
        profile = MarketplaceShopProfile(
            organization_id=org.id,
            specialties=default_specialties(org.org_type),
            onboarding_status=ShopOnboardingStatus.PROSPECT,
        )
        session.add(profile)
        await session.flush()
    await refresh_onboarding_status(session, profile)
    return profile


async def list_shops(session: AsyncSession) -> list[tuple[Organization, MarketplaceShopProfile]]:
    """Every active shop org with its (ensured) profile."""
    orgs = (
        (
            await session.execute(
                select(Organization)
                .where(Organization.org_type.in_([t.value for t in SHOP_ORG_TYPES]))
                .where(Organization.is_active.is_(True))
                .order_by(Organization.id)
            )
        )
        .scalars()
        .all()
    )
    out = []
    for org in orgs:
        out.append((org, await ensure_shop_profile(session, org)))
    return out


async def shop_admin_emails(session: AsyncSession, org_id: int) -> list[str]:
    rows = (
        (
            await session.execute(
                select(User.email)
                .where(User.organization_id == org_id)
                .where(User.status == UserStatus.ACTIVE)
                .where(User.role == UserRole.VENDOR_ADMIN)
                .order_by(User.id)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def shop_recipients(session: AsyncSession, profile: MarketplaceShopProfile) -> list[str]:
    """Registered → active vendor admins; prospect/invited → contact email."""
    status = await refresh_onboarding_status(session, profile)
    if status == ShopOnboardingStatus.REGISTERED:
        emails = await shop_admin_emails(session, profile.organization_id)
        if emails:
            return emails
    return [profile.contact_email] if profile.contact_email else []


# ─────────────────────────────────────────────────────────
# Prospect magic link
# ─────────────────────────────────────────────────────────
def _magic_link_valid(profile: MarketplaceShopProfile) -> bool:
    if not (
        profile.magic_token_hash and profile.magic_token_salt and profile.magic_token_issued_at
    ):
        return False
    ttl = timedelta(days=get_settings().marketplace_prospect_link_ttl_days)
    return utc_now() - profile.magic_token_issued_at < ttl


async def magic_link_token(session: AsyncSession, profile: MarketplaceShopProfile) -> str:
    """The prospect's board token — reused while valid, rotated when expired."""
    if _magic_link_valid(profile):
        return tokens.derive_token(tokens.SHOP_BOARD, profile.magic_token_salt)
    token, salt, digest = tokens.issue(tokens.SHOP_BOARD)
    profile.magic_token_salt = salt
    profile.magic_token_hash = digest
    profile.magic_token_issued_at = utc_now()
    session.add(profile)
    await session.flush()
    return token


def board_url(token: str | None = None) -> str:
    base = get_settings().app_url.rstrip("/")
    return f"{base}/marketplace/board?invite={token}" if token else f"{base}/marketplace/board"


async def resolve_magic_token(
    session: AsyncSession, raw: str | None
) -> tuple[Organization, MarketplaceShopProfile] | None:
    """Prospect token → (org, profile), or None when invalid / expired.

    Once the shop has an active user the magic link stops working — the
    shop logs in like any registered vendor.
    """
    if not tokens.looks_like_token(raw):
        return None
    digest = tokens.hash_token(raw)
    profile = (
        await session.execute(
            select(MarketplaceShopProfile).where(MarketplaceShopProfile.magic_token_hash == digest)
        )
    ).scalar_one_or_none()
    if profile is None or not profile.is_active or not _magic_link_valid(profile):
        return None
    org = (
        await session.execute(
            select(Organization).where(Organization.id == profile.organization_id)
        )
    ).scalar_one_or_none()
    if not is_shop_org(org) or not org.is_active:
        return None
    if await refresh_onboarding_status(session, profile) == ShopOnboardingStatus.REGISTERED:
        return None
    return org, profile


# ─────────────────────────────────────────────────────────
# Prospect onboarding at first quote
# ─────────────────────────────────────────────────────────
async def _system_inviter(session: AsyncSession) -> User | None:
    s = get_settings()
    if s.marketplace_system_user_email:
        user = (
            await session.execute(
                select(User).where(User.email == s.marketplace_system_user_email.lower())
            )
        ).scalar_one_or_none()
        if user is not None:
            return user
    return (
        await session.execute(
            select(User)
            .where(User.role == UserRole.SITE_ADMIN)
            .where(User.status == UserStatus.ACTIVE)
            .order_by(User.id)
            .limit(1)
        )
    ).scalar_one_or_none()


def _accept_url(token: str) -> str:
    # Same URL the invitations router builds — the existing SignupAcceptPage.
    return f"{get_settings().app_url.rstrip('/')}/signup/accept?token={token}"


async def accept_terms_and_invite(
    session: AsyncSession,
    *,
    org: Organization,
    profile: MarketplaceShopProfile,
    email: str,
    full_name: str,
) -> tuple[Invitation | None, str | None]:
    """Record the terms acceptance and invite the prospect's first user.

    Returns (invitation, accept_url). The invitation email itself is queued
    by the caller (after commit). No invitation is created when a user with
    that email already exists, or a pending one is reused.
    """
    email = email.strip().lower()
    now = utc_now()
    profile.terms_accepted_at = now
    profile.terms_version = get_settings().marketplace_terms_version
    profile.terms_accepted_email = email
    profile.terms_accepted_name = full_name
    if not profile.contact_email:
        profile.contact_email = email
    session.add(profile)

    if (await session.execute(select(User.id).where(User.email == email))).first() is not None:
        await refresh_onboarding_status(session, profile)
        return None, None

    inv = (
        (
            await session.execute(
                select(Invitation)
                .where(Invitation.email == email)
                .where(Invitation.org_id == org.id)
                .where(Invitation.status == InvitationStatus.PENDING)
                .where(Invitation.expires_at > now)
            )
        )
        .scalars()
        .first()
    )
    if inv is None:
        inviter = await _system_inviter(session)
        if inviter is None:
            # invitations.invited_by_id is NOT NULL; without any site admin
            # we can only record the terms. Ops can invite from the admin UI.
            await refresh_onboarding_status(session, profile)
            return None, None
        inv = Invitation(
            email=email,
            full_name=full_name,
            role=UserRole.VENDOR_ADMIN,
            org_id=org.id,
            invited_by_id=inviter.id,
            expires_at=now + timedelta(days=get_settings().invitation_ttl_days),
        )
        session.add(inv)
        await session.flush()
    inv.last_email_sent_at = now
    session.add(inv)
    profile.invitation_id = inv.id
    await refresh_onboarding_status(session, profile)
    return inv, _accept_url(inv.token)
