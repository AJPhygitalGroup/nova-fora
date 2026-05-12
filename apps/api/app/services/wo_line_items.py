"""Line item generation + bulk auto-linkage at WO acceptance.

Spec (§7 "Line items provenance" + the three v2.0 adjustments):

  At vendor acceptance, the app creates:
    1. One `work_order_line_items` row per defect on the WO (category
       = `defect_repair`).
    2. Concurrently, one `defect_resolutions` row per defect (status =
       `pending`).
    3. Bulk auto-linkage: every `defect_repair` line item gets linked
       to **every** `defect_resolution` on the WO via
       `work_order_line_item_resolutions`. Imprecise (per-defect cost
       attribution is approximate) but satisfies the completion trigger
       which requires every defect_repair line item to be linked.

v2.0 simplifications (per spec):
  - Line items always start as `pending` — no cost-approval gating.
  - `billing_type` defaults to `cmr` unless we can derive otherwise from
    the defect's group (AMR/PM → amr; everything else → cmr). The
    customer doesn't see the split yet; this is for v2.x billing.
  - Bulk auto-linkage instead of per-defect linkage.

Mid-repair finds (`source='shop_finding'`) attach to the existing RR via
`add_mid_repair_defect_line_item()` — the new defect goes through its
own `defect_review` (auto or manual); if approved, this helper spawns
the line item + the linkage to a new DefectResolution.

Parts-pending defer: `defer_line_item_with_followup_rr()` flips a line
item to `deferred` with `decline_reason_code='parts_unavailable'` and
spawns a follow-up RR pointing to the original via
`parent_repair_request_id`.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.defect import Defect
from app.models.defect_catalog import (
    DefectApplicability,
    DefectRule,
)
from app.models.vehicle import Vehicle
from app.models.work_orders import (
    DefectResolution,
    DefectResolutionStatus,
    LineItemBillingType,
    LineItemCategory,
    LineItemStatus,
    RepairRequest,
    RepairRequestDefect,
    RepairRequestStatus,
    WoActivityLogEntityType,
    WorkOrder,
    WorkOrderLineItem,
    WorkOrderLineItemResolution,
)
from app.services.wo_activity_log import log_event


# Maps defect_rule.group → billing_type. AMR / PM are Amazon-paid;
# everything else is customer-paid. Same as the simulator's
# `billingForGroup()` in `derive.ts`.
_GROUP_TO_BILLING_TYPE: dict[str, LineItemBillingType] = {
    "AMR": LineItemBillingType.AMR,
    "PM":  LineItemBillingType.AMR,
    # All others default to CMR
}


async def _billing_type_for_defect(
    session: AsyncSession, defect: Defect, vehicle_class: str
) -> LineItemBillingType:
    """Derive AMR vs CMR billing from the defect's rule group."""
    row = (
        await session.execute(
            select(DefectRule.group)
            .join(DefectApplicability, DefectApplicability.rule_id == DefectRule.id)
            .where(DefectRule.part == defect.part)
            .where(DefectRule.defect_type == defect.defect_type)
            .where(DefectApplicability.vehicle_class == vehicle_class)
        )
    ).first()
    if row is None:
        return LineItemBillingType.CMR
    group_value = row[0]
    group_str = group_value.value if hasattr(group_value, "value") else str(group_value)
    return _GROUP_TO_BILLING_TYPE.get(group_str, LineItemBillingType.CMR)


async def generate_line_items_on_accept(
    session: AsyncSession,
    *,
    work_order_id: int,
    actor_id: int | None = None,
) -> tuple[list[WorkOrderLineItem], list[DefectResolution]]:
    """Run at the moment a vendor flips a WO to `accepted`.

    For each defect on the WO's parent RR:
      - Create a DefectResolution(status=pending).
      - Create a WorkOrderLineItem(category=defect_repair, status=pending,
        billing_type derived from defect group).
    Then bulk-link every line item to every defect_resolution.

    Returns (created_line_items, created_defect_resolutions). Caller commits.
    """
    wo = (
        await session.execute(select(WorkOrder).where(WorkOrder.id == work_order_id))
    ).scalar_one_or_none()
    if wo is None:
        raise ValueError(f"work_order {work_order_id} not found")

    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == wo.vehicle_id))
    ).scalar_one_or_none()
    vehicle_class = vehicle.vehicle_class if vehicle else "regular_cargo_van"

    # Pull the defects bundled into the parent RR
    rr_defect_ids = list(
        (
            await session.execute(
                select(RepairRequestDefect.defect_id).where(
                    RepairRequestDefect.repair_request_id == wo.repair_request_id
                )
            )
        )
        .scalars()
        .all()
    )

    defects = list(
        (
            await session.execute(select(Defect).where(Defect.id.in_(rr_defect_ids)))
        )
        .scalars()
        .all()
    ) if rr_defect_ids else []

    new_resolutions: list[DefectResolution] = []
    new_line_items: list[WorkOrderLineItem] = []

    for defect in defects:
        dr = DefectResolution(
            work_order_id=wo.id,
            defect_id=defect.id,
            status=DefectResolutionStatus.PENDING,
        )
        session.add(dr)
        new_resolutions.append(dr)

        billing = await _billing_type_for_defect(session, defect, vehicle_class)
        li = WorkOrderLineItem(
            work_order_id=wo.id,
            description=f"{defect.part} — {defect.defect_type}",
            category=LineItemCategory.DEFECT_REPAIR,
            billing_type=billing,
            status=LineItemStatus.PENDING,
            created_by_id=actor_id,
        )
        session.add(li)
        new_line_items.append(li)

    # Flush so both DR and line item rows get IDs before linkage
    await session.flush()

    # Bulk auto-linkage: every defect_repair line item ↔ every defect_resolution.
    # In v2.0 this is intentional imprecision; v2.x will narrow it.
    for li in new_line_items:
        for dr in new_resolutions:
            session.add(
                WorkOrderLineItemResolution(
                    line_item_id=li.id,
                    defect_resolution_id=dr.id,
                )
            )

    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        action="line_items_generated",
        actor_id=actor_id,
        details={
            "line_item_ids": [li.id for li in new_line_items],
            "defect_resolution_ids": [dr.id for dr in new_resolutions],
            "linkage_pairs": len(new_line_items) * len(new_resolutions),
        },
    )
    await session.flush()
    return new_line_items, new_resolutions


async def add_mid_repair_line_item(
    session: AsyncSession,
    *,
    work_order_id: int,
    description: str,
    category: LineItemCategory,
    billing_type: LineItemBillingType,
    estimated_price: Decimal | None = None,
    customer_requested: bool = False,
    actor_id: int | None = None,
) -> WorkOrderLineItem:
    """Mid-visit addition (customer_request, vendor_addition, overhead, recall).

    Stays as `pending` since cost-approval gating is dormant in v2.0 —
    schema would otherwise set `pending_cost_approval` for over-threshold
    CMR items. Adjust when v2.x lights cost approval up.
    """
    li = WorkOrderLineItem(
        work_order_id=work_order_id,
        description=description,
        estimated_price=estimated_price,
        category=category,
        billing_type=billing_type,
        status=LineItemStatus.PENDING,
        customer_requested=customer_requested,
        created_by_id=actor_id,
    )
    session.add(li)
    await session.flush()
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=work_order_id,
        action="mid_repair_line_item_added",
        actor_id=actor_id,
        details={
            "line_item_id": li.id,
            "category": category.value,
            "billing_type": billing_type.value,
            "description": description,
        },
    )
    return li


async def defer_line_item_with_followup_rr(
    session: AsyncSession,
    *,
    line_item_id: int,
    reason_code: str = "parts_unavailable",
    status_reason: str | None = None,
    actor_id: int | None = None,
) -> RepairRequest | None:
    """Flip a line item to `deferred` and spawn a follow-up RR.

    Returns the newly-created follow-up RR (or None if the line item
    isn't a `defect_repair` — non-defect items don't need a follow-up).
    """
    li = (
        await session.execute(
            select(WorkOrderLineItem).where(WorkOrderLineItem.id == line_item_id)
        )
    ).scalar_one_or_none()
    if li is None:
        raise ValueError(f"line_item {line_item_id} not found")

    prev_status = li.status.value if hasattr(li.status, "value") else str(li.status)
    li.status = LineItemStatus.DEFERRED
    li.decline_reason_code = reason_code
    if status_reason:
        li.status_reason = status_reason
    session.add(li)

    await log_event(
        session,
        entity_type=WoActivityLogEntityType.LINE_ITEM,
        entity_id=li.id,
        action="deferred",
        actor_id=actor_id,
        details={"from": prev_status, "reason_code": reason_code},
    )

    if li.category != LineItemCategory.DEFECT_REPAIR:
        await session.flush()
        return None

    # Spawn the follow-up RR. Same vehicle + repair_type as the original.
    wo = (
        await session.execute(select(WorkOrder).where(WorkOrder.id == li.work_order_id))
    ).scalar_one_or_none()
    if wo is None:
        return None

    parent_rr = (
        await session.execute(
            select(RepairRequest).where(RepairRequest.id == wo.repair_request_id)
        )
    ).scalar_one_or_none()
    if parent_rr is None:
        return None

    followup = RepairRequest(
        vehicle_id=parent_rr.vehicle_id,
        dsp_id=parent_rr.dsp_id,
        repair_type=parent_rr.repair_type,
        status=RepairRequestStatus.OPEN,
        is_rush=parent_rr.is_rush,
        parent_repair_request_id=parent_rr.id,
        created_by_id=actor_id,
    )
    session.add(followup)
    await session.flush()

    # Carry over the defects linked to this line item — bulk auto-linkage
    # means a single line item may map to many DRs; we copy ALL underlying
    # defect_ids forward.
    dr_ids = list(
        (
            await session.execute(
                select(WorkOrderLineItemResolution.defect_resolution_id).where(
                    WorkOrderLineItemResolution.line_item_id == li.id
                )
            )
        )
        .scalars()
        .all()
    )
    defect_ids = list(
        (
            await session.execute(
                select(DefectResolution.defect_id).where(DefectResolution.id.in_(dr_ids))
            )
        )
        .scalars()
        .all()
    ) if dr_ids else []
    for did in set(defect_ids):
        session.add(
            RepairRequestDefect(repair_request_id=followup.id, defect_id=did)
        )

    await log_event(
        session,
        entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
        entity_id=followup.id,
        action="followup_spawned",
        actor_id=actor_id,
        details={
            "parent_repair_request_id": parent_rr.id,
            "from_line_item_id": li.id,
            "carried_defect_ids": list(set(defect_ids)),
        },
    )
    await session.flush()
    return followup
