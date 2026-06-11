"""Centralized multi-tenant scoping for list endpoints.

CLAUDE.md rule #8: "A vendor must never see another vendor's data."
Before this module, each list endpoint hand-rolled its scoping with a
pattern like:

    if current.role == UserRole.DSP_OWNER:
        stmt = stmt.where(table.dsp_id == current.organization_id)
    elif dsp_id is not None:               # ← anyone could pass dsp_id
        stmt = stmt.where(table.dsp_id == dsp_id)
    # else: UNFILTERED                      # ← every non-listed role leaked

Two cross-tenant leaks fell out of that shape (2026-06-08 review):
  1. Non-enumerated roles (dsp_manager, dsp_inspector, dsp_viewer,
     service_writer, vendor_viewer) skipped every branch → the query
     ran UNFILTERED, returning every tenant's rows.
  2. The `elif dsp_id is not None` branch let ANY non-owner pass an
     arbitrary `dsp_id` and read that DSP's data.

`resolve_dsp_scope` collapses the decision into one audited place:

  - DSP roles (owner / manager / inspector / viewer) → their own org's
    dsp_id, ALWAYS. A `dsp_id` query param is ignored — a DSP user can
    never address another DSP.
  - site_admin → the `dsp_id` param if provided, else unrestricted.
  - vendor roles (admin / service_writer / technician / viewer) → the
    set of DSP ids the vendor org's workshops have served (via WOs).
    Matches the existing dashboards behavior (`_dsp_ids_for_workshop`).
    A passed `dsp_id` narrows to that DSP only if it's in the served
    set; otherwise the result is empty (no leak).
  - any other / unknown role → deny (empty allow-set).

`allowed_dsp_ids is None` is the ONLY "no filter" signal and is
reachable solely by site_admin. Every other caller gets a concrete
(possibly empty) set the endpoint must constrain its query to.

Work-order-centric endpoints (`/work-orders`, `/repair-requests`)
scope vendors by WORKSHOP, not by served-DSP — a vendor must see only
WOs routed to *their* workshops, not every WO at a DSP they happen to
also serve. Those endpoints use `vendor_workshop_ids` from this module
instead of `allowed_dsp_ids` for the vendor branch.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.user import User, UserRole
from app.services.permissions import is_dsp_role, is_vendor_role


@dataclass
class DspScope:
    """Resolved tenant scope for a list query.

    allowed_dsp_ids:
        None  → unrestricted (site_admin without a dsp_id filter).
        set() → deny everything (unknown role, or vendor with no served
                DSPs / a dsp_id outside their served set).
        {ids} → constrain the query to exactly these dsp ids.
    is_vendor:
        True when the caller is a vendor role — work-order endpoints
        prefer `vendor_workshop_ids` over `allowed_dsp_ids`.
    vendor_workshop_ids:
        Workshop ids owned by the vendor's org (empty for non-vendors).
    """

    allowed_dsp_ids: set[int] | None
    is_vendor: bool = False
    vendor_workshop_ids: list[int] = field(default_factory=list)

    @property
    def denies_everything(self) -> bool:
        """True when the scope can match no rows — endpoints can short-
        circuit with an empty response instead of running the query."""
        return self.allowed_dsp_ids is not None and len(self.allowed_dsp_ids) == 0


async def _vendor_workshop_ids(session: AsyncSession, org_id: int | None) -> list[int]:
    """Workshop ids owned by a vendor org. Covers ALL vendor roles —
    the legacy per-endpoint helpers only matched admin + technician,
    which is exactly how service_writer / vendor_viewer leaked."""
    if org_id is None:
        return []
    from app.models.work_orders import VendorWorkshop

    return list(
        (
            await session.execute(
                select(VendorWorkshop.id).where(
                    VendorWorkshop.organization_id == org_id
                )
            )
        ).scalars().all()
    )


async def _served_dsp_ids(session: AsyncSession, workshop_ids: list[int]) -> set[int]:
    """DSP org ids that any of these workshops have served (via WOs).
    Mirrors dashboards._dsp_ids_for_workshop but batched across the
    vendor's whole workshop set."""
    if not workshop_ids:
        return set()
    from app.models.work_orders import WorkOrder

    rows = (
        await session.execute(
            select(WorkOrder.dsp_id)
            .where(WorkOrder.vendor_workshop_id.in_(workshop_ids))
            .distinct()
        )
    ).scalars().all()
    return {d for d in rows if d is not None}


async def resolve_dsp_scope(
    session: AsyncSession,
    current: User,
    requested_dsp_id: int | None = None,
) -> DspScope:
    """Resolve the dsp-id scope a caller is allowed to read.

    See the module docstring for the full policy. The returned
    `allowed_dsp_ids` is the authoritative filter the endpoint must
    apply to its dsp-keyed column.
    """
    role = current.role

    # DSP roles — own org only, regardless of any dsp_id param. A DSP
    # user cannot address another DSP.
    if is_dsp_role(role):
        own = current.organization_id
        return DspScope(allowed_dsp_ids={own} if own is not None else set())

    # Platform admin — optional narrowing, otherwise unrestricted.
    if role == UserRole.SITE_ADMIN:
        if requested_dsp_id is not None:
            return DspScope(allowed_dsp_ids={requested_dsp_id})
        return DspScope(allowed_dsp_ids=None)

    # Vendor roles — scoped to the DSPs their workshops serve.
    if is_vendor_role(role):
        workshop_ids = await _vendor_workshop_ids(session, current.organization_id)
        served = await _served_dsp_ids(session, workshop_ids)
        if requested_dsp_id is not None:
            # Narrowing to one DSP is allowed ONLY if the vendor serves
            # it — otherwise deny (empty), never widen.
            served = served & {requested_dsp_id}
        return DspScope(
            allowed_dsp_ids=served,
            is_vendor=True,
            vendor_workshop_ids=workshop_ids,
        )

    # Unknown / unhandled role — deny everything.
    return DspScope(allowed_dsp_ids=set())
