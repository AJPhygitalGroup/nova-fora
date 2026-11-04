"""Create the shop's work when the DSP approves a quote (spec §4, §12 Q2).

Decision — the destination follows the WINNING SHOP's org type, because
each org type has exactly one execution surface in Nova Fora:

  - `body_repair_vendor` → the existing body repair flow. A
    `BodyRepairRequest` is created already in `quote_selected` with a
    `selected` `BodyRepairQuote` priced at the approved total (commission 0
    — the DFS fee is the shop's 10% tracked on the marketplace quote, not a
    markup the DSP pays). The shop continues in its Body Repair queue:
    propose pickup → in repair → complete → sign-off. Body shops have no
    WO V2 surface (HomeRouter/Layout send them to BodyRepairFlow) and
    usually no VendorWorkshop, so an RR + WO would be invisible to them.
  - `vendor` → RR + WO, like the rest of Nova Fora: the marketplace defects
    are linked through `repair_request_defects`, and the WO lands in
    `pending_acceptance` on the shop's workshop so the shop accepts it in
    its normal queue (line items, RO#, tech assignment, pickup fan-out).
    The router is NOT used (it would pick the first matching vendor, not
    the winner). If the shop has no workshop, a non-routable one is
    created (`repair_types=[]`) so first-match routing for other RRs is
    unaffected.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.base import utc_now
from app.models.body_repair import (
    BodyRepairQuote,
    BodyRepairQuoteStatus,
    BodyRepairRequest,
    BodyRepairRequestStatus,
    BodyRepairSubmissionMode,
)
from app.models.marketplace import MarketplaceOffer, MarketplaceQuote, MarketplaceSpecialty
from app.models.organization import Organization, OrgType
from app.models.work_orders import (
    NoteAuthorRole,
    RepairRequest,
    RepairRequestDefect,
    RepairRequestStatus,
    RepairType,
    StatusTrackingMode,
    VendorWorkshop,
    WoActivityLogEntityType,
    WorkOrder,
    WorkOrderNote,
    WorkOrderStatus,
)
from app.models.work_orders.work_order_note import WorkOrderNoteChannel
from app.services.marketplace.notifications import money, offer_label
from app.services.wo_activity_log import log_event, log_status_change


def _v(x) -> str:
    return x.value if hasattr(x, "value") else str(x)


def _cents(amount: Decimal) -> int:
    return int((Decimal(amount) * 100).quantize(Decimal("1")))


def _scope_text(
    quote: MarketplaceQuote, lines: list[tuple[Decimal | None, MarketplaceOffer]]
) -> str:
    items = "\n".join(
        f"- {offer_label(o)}{f' — {money(a)}' if a is not None else ''}"
        + (f"\n  Inspector notes: {o.notes}" if o.notes else "")
        for a, o in lines
    )
    notes = f"\nShop notes: {quote.notes}" if quote.notes else ""
    return (
        f"DFS Repair Marketplace quote {quote.id_str}, approved by the DSP "
        f"for {money(quote.total_amount)}.\n{items}{notes}"
    )


async def _shop_workshop(session: AsyncSession, shop: Organization) -> VendorWorkshop:
    ws = (
        await session.execute(
            select(VendorWorkshop)
            .where(VendorWorkshop.organization_id == shop.id)
            .where(VendorWorkshop.is_active.is_(True))
            .order_by(VendorWorkshop.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if ws is not None:
        return ws
    ws = VendorWorkshop(
        name=shop.name,
        organization_id=shop.id,
        status_tracking_mode=StatusTrackingMode.INTERNAL,
        repair_types=[],  # not routable — only receives marketplace awards
        is_active=True,
    )
    session.add(ws)
    await session.flush()
    return ws


async def _create_work_order(
    session: AsyncSession,
    quote: MarketplaceQuote,
    shop: Organization,
    lines: list[tuple[Decimal | None, MarketplaceOffer]],
) -> str:
    from app.services.wo_rr_status import refresh_rr_status

    offers = [o for _, o in lines]
    repair_type = (
        RepairType.BODY
        if any(_v(o.specialty) == MarketplaceSpecialty.BODY.value for o in offers)
        else RepairType.MECHANICAL
    )
    rr = RepairRequest(
        vehicle_id=quote.vehicle_id,
        dsp_id=quote.dsp_id,
        repair_type=repair_type,
        status=RepairRequestStatus.OPEN,
        is_rush=False,
        created_by_id=None,
    )
    session.add(rr)
    await session.flush()
    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
        entity_id=rr.id,
        from_status=None,
        to_status=RepairRequestStatus.OPEN.value,
        actor_id=None,
    )
    seen: set[int] = set()
    for o in offers:
        if o.defect_id is None or o.defect_id in seen:
            continue
        seen.add(o.defect_id)
        session.add(RepairRequestDefect(repair_request_id=rr.id, defect_id=o.defect_id))
    await session.flush()

    workshop = await _shop_workshop(session, shop)
    wo = WorkOrder(
        repair_request_id=rr.id,
        vehicle_id=quote.vehicle_id,
        vendor_workshop_id=workshop.id,
        dsp_id=quote.dsp_id,
        status=WorkOrderStatus.PENDING_ACCEPTANCE,
        status_tracking_mode=StatusTrackingMode(_v(workshop.status_tracking_mode)),
        is_rush=False,
        created_by_id=None,
    )
    session.add(wo)
    await session.flush()
    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=None,
        to_status=WorkOrderStatus.PENDING_ACCEPTANCE.value,
        actor_id=None,
    )
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
        entity_id=rr.id,
        action="routed",
        actor_id=None,
        details={
            "work_order_id": wo.id,
            "vendor_workshop_id": workshop.id,
            "vendor_name": workshop.name,
            "source": "marketplace",
            "marketplace_quote_id": quote.id,
        },
    )
    session.add(
        WorkOrderNote(
            work_order_id=wo.id,
            author_id=None,
            author_role=NoteAuthorRole.SYSTEM,
            channel=WorkOrderNoteChannel.CUSTOMER,
            body=_scope_text(quote, lines),
        )
    )
    await session.flush()
    await refresh_rr_status(session, repair_request_id=rr.id, actor_id=None)

    quote.repair_request_id = rr.id
    quote.work_order_id = wo.id
    session.add(quote)

    try:  # best-effort SSE fan-out, same as the router
        from app.services.pubsub import publish_work_order_event

        await publish_work_order_event(
            {
                "event": "created",
                "work_order_id": wo.id,
                "dsp_id": wo.dsp_id,
                "vendor_workshop_id": wo.vendor_workshop_id,
                "assigned_technician_id": None,
            }
        )
    except Exception:  # noqa: BLE001
        pass
    return wo.id_str


async def _create_body_repair_job(
    session: AsyncSession,
    quote: MarketplaceQuote,
    shop: Organization,
    lines: list[tuple[Decimal | None, MarketplaceOffer]],
) -> str:
    now = utc_now()
    cents = _cents(quote.total_amount)
    req = BodyRepairRequest(
        dsp_id=quote.dsp_id,
        vehicle_id=quote.vehicle_id,
        assigned_vendor_id=shop.id,
        submission_mode=BodyRepairSubmissionMode.TEXT,
        text_description=_scope_text(quote, lines),
        status=BodyRepairRequestStatus.QUOTE_SELECTED,
        quote_selected_at=now,
        approved_list_cents=cents,
        created_by_id=None,
    )
    session.add(req)
    await session.flush()
    brq = BodyRepairQuote(
        body_repair_request_id=req.id,
        vendor_org_id=shop.id,
        status=BodyRepairQuoteStatus.SELECTED,
        vendor_raw_cents=cents,
        base_cents=cents,
        list_cents=cents,
        tier_1_cents=cents,
        tier_2_cents=cents,
        commission_pct=Decimal("0"),
        notes=f"Approved through the DFS Repair Marketplace ({quote.id_str}).",
    )
    session.add(brq)
    await session.flush()
    req.selected_quote_id = brq.id
    session.add(req)
    quote.body_repair_request_id = req.id
    session.add(quote)
    await session.flush()
    return req.id_str


async def create_work_for_award(
    session: AsyncSession,
    quote: MarketplaceQuote,
    shop: Organization,
    lines: list[tuple[Decimal | None, MarketplaceOffer]],
) -> str:
    """Create the shop's job. Returns its display id (WO-… / BRR-…)."""
    if _v(shop.org_type) == OrgType.BODY_REPAIR_VENDOR.value:
        return await _create_body_repair_job(session, quote, shop, lines)
    return await _create_work_order(session, quote, shop, lines)
