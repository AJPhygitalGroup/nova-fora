"""Role + permission helpers — single place to ask "what can this user do?".

The rest of the codebase should call these helpers rather than comparing
`user.role` against specific enum values directly. That way adding new roles
(or remapping permissions when the spec evolves) is a single-file change.

Coverage today:
  - is_dsp_role / is_vendor_role / is_platform_role  — taxonomy buckets
  - is_org_admin                                     — authorized to manage org
                                                       (billing, users, vehicles)
  - can_invite_role                                  — the invitation matrix
                                                       enforced in
                                                       routes/invitations.py
  - allowed_invite_roles                             — UI-side enumeration
  - vendor_allowed_repair_types                      — set of RepairType
                                                       values a vendor user
                                                       can see (drives the
                                                       inspection-report
                                                       defect filter etc.)
  - defect_group_allowed_for_repair_types            — pure mapping: does
                                                       a defect's group
                                                       resolve to one of
                                                       the allowed
                                                       repair_types?

The full feature-by-feature permission map (e.g. who can approve a defect,
who can assign a WO) will be added here as those features land — keep the
checks in a single module so they're easy to audit.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.user import User, UserRole


# ─────────────────────────────────────────────────────
# Taxonomy buckets
# ─────────────────────────────────────────────────────
_DSP_ROLES = frozenset({
    UserRole.DSP_OWNER,
    UserRole.DSP_MANAGER,
    UserRole.DSP_INSPECTOR,
    UserRole.DSP_VIEWER,
})

_VENDOR_ROLES = frozenset({
    UserRole.VENDOR_ADMIN,
    UserRole.SERVICE_WRITER,
    UserRole.TECHNICIAN,
    UserRole.VENDOR_VIEWER,
})

_PLATFORM_ROLES = frozenset({UserRole.SITE_ADMIN})

# Roles that have org-level admin authority — full control of users +
# fleet/inspections/WOs. Used wherever the legacy code asked for
# `dsp_owner` or `vendor_admin`.
_ORG_ADMIN_ROLES = frozenset({
    UserRole.DSP_OWNER,
    UserRole.DSP_MANAGER,
    UserRole.VENDOR_ADMIN,
    UserRole.SERVICE_WRITER,
    UserRole.SITE_ADMIN,
})


def _coerce(role) -> UserRole | None:
    """Accept either a UserRole or the raw VARCHAR value."""
    if role is None:
        return None
    if isinstance(role, UserRole):
        return role
    try:
        return UserRole(role)
    except ValueError:
        return None


def is_dsp_role(role) -> bool:
    return _coerce(role) in _DSP_ROLES


def is_vendor_role(role) -> bool:
    return _coerce(role) in _VENDOR_ROLES


def is_platform_role(role) -> bool:
    return _coerce(role) in _PLATFORM_ROLES


def is_org_admin(user_or_role) -> bool:
    """True for org-level admins (owner / manager / service_writer / site_admin).

    Accepts either a `User` instance or a raw role value/enum so callers
    don't have to unwrap `user.role` themselves.
    """
    if isinstance(user_or_role, User):
        role = user_or_role.role
    else:
        role = user_or_role
    return _coerce(role) in _ORG_ADMIN_ROLES


# ─────────────────────────────────────────────────────
# Invitation matrix
# ─────────────────────────────────────────────────────
# Who can invite which roles. Site admin is special-cased — they can invite
# anyone, anywhere (existing or new org).
_INVITE_MATRIX: dict[UserRole, frozenset[UserRole]] = {
    UserRole.DSP_OWNER: frozenset({
        UserRole.DSP_OWNER,
        UserRole.DSP_MANAGER,
        UserRole.DSP_INSPECTOR,
        UserRole.DSP_VIEWER,
    }),
    UserRole.DSP_MANAGER: frozenset({
        UserRole.DSP_INSPECTOR,
        UserRole.DSP_VIEWER,
    }),
    UserRole.VENDOR_ADMIN: frozenset({
        UserRole.VENDOR_ADMIN,
        UserRole.SERVICE_WRITER,
        UserRole.TECHNICIAN,
        UserRole.VENDOR_VIEWER,
    }),
    UserRole.SERVICE_WRITER: frozenset({
        UserRole.TECHNICIAN,
        UserRole.VENDOR_VIEWER,
    }),
    UserRole.SITE_ADMIN: frozenset(UserRole),  # everyone
    # Inspectors / technicians / viewers — empty set (cannot invite anyone)
    UserRole.DSP_INSPECTOR: frozenset(),
    UserRole.DSP_VIEWER: frozenset(),
    UserRole.TECHNICIAN: frozenset(),
    UserRole.VENDOR_VIEWER: frozenset(),
}


def can_invite_role(inviter_role, target_role) -> bool:
    """True iff `inviter_role` is allowed to send an invitation for `target_role`.

    Org-scope is enforced separately by the route (the inviter can't add
    users to other orgs unless they're a site_admin) — this function only
    answers the role-membership question.
    """
    inv = _coerce(inviter_role)
    tgt = _coerce(target_role)
    if inv is None or tgt is None:
        return False
    return tgt in _INVITE_MATRIX.get(inv, frozenset())


def allowed_invite_roles(inviter_role) -> list[UserRole]:
    """List of roles `inviter_role` may target. Empty if the inviter can't invite."""
    inv = _coerce(inviter_role)
    if inv is None:
        return []
    return sorted(_INVITE_MATRIX.get(inv, frozenset()), key=lambda r: r.value)


def can_invite_anyone(inviter_role) -> bool:
    return bool(allowed_invite_roles(inviter_role))


# ─────────────────────────────────────────────────────
# Vendor scope by repair_type
# ─────────────────────────────────────────────────────
# A vendor only services certain repair buckets (Dulles Midas does
# mechanical/pm/cnmr; a body shop does body; etc.). Inspection reports +
# heatmap counts must filter defects to the vendor's catalogue — a
# mechanical-only vendor shouldn't see body defects on a van they QC'd.
# DSP + site_admin users get a `None` sentinel (no filter applied).

async def vendor_allowed_repair_types(
    session: AsyncSession, user: User
) -> set[str] | None:
    """Repair types the requesting vendor user can see.

    Returns:
        None  — for non-vendor users (DSP / site_admin → no filter).
        set[str] — repair_type values (e.g. {"mechanical","pm","cnmr"})
                   collected across all of the vendor org's workshops.
                   Empty set means "vendor org has no workshop services
                   configured" — caller should treat that as "see nothing".
    """
    if not is_vendor_role(user.role):
        return None
    if user.organization_id is None:
        return set()
    # Local import — VendorWorkshop pulls a chunk of WO V2 models; keeping
    # it lazy avoids inflating import time for callers that never touch it.
    from app.models.work_orders import VendorWorkshop

    rows = (
        await session.execute(
            select(VendorWorkshop.repair_types).where(
                VendorWorkshop.organization_id == user.organization_id
            )
        )
    ).all()
    allowed: set[str] = set()
    for (rt_list,) in rows:
        if rt_list:
            allowed.update(rt_list)
    return allowed


def defect_group_allowed_for_repair_types(
    group: str | None, allowed_repair_types: set[str]
) -> bool:
    """True iff the defect's DefectGroup maps to one of the allowed
    repair_types.

    `group` is the string in `DefectV2Response.group` ("AMR", "Body",
    "Tires", "PM", "CNMR", "Detailing", "Netradyne") — already derived
    by the defects route from `DefectRule.group`. We re-use the same
    GROUP→RepairType map the wo_bundler uses for routing so a vendor
    sees exactly the defects they could be routed.

    Unknown / missing group defaults to MECHANICAL (matches
    `wo_bundler._resolve_repair_type`'s safe-default behaviour).
    """
    # Local import — wo_bundler imports a lot; lazy keeps it cheap.
    from app.services.wo_bundler import _GROUP_TO_REPAIR_TYPE
    from app.models.work_orders import RepairType

    repair_type = _GROUP_TO_REPAIR_TYPE.get(group or "", RepairType.MECHANICAL)
    rt_value = (
        repair_type.value if hasattr(repair_type, "value") else str(repair_type)
    )
    return rt_value in allowed_repair_types
