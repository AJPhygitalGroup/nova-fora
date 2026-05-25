"""Vendor routing — places an RR with a vendor workshop, creates a WO.

v2.0 routing strategy: **first-match**. Pick the first active vendor
whose `repair_types[]` contains the RR's `repair_type`. Ranked vendor
preferences are deferred to v2.x (per spec §10 TBDs).

Two outcomes:

  - **Routed**: a WO is created in `pending_acceptance`, linked to the
    RR. The RR stays `open` until the WO transitions to `accepted` (then
    we move the RR to `accepted`).
  - **No eligible vendor**: log `no_eligible_vendor` and return None.
    Operator is expected to add a vendor for the repair_type or manually
    re-route (UI in v2.x).

Hard-reject re-route: when a vendor declines a WO (`status='declined'`),
call `route_repair_request` again with `exclude_workshop_ids=[<the
declining workshop>]` — it'll pick the next eligible vendor.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.work_orders import (
    RepairRequest,
    StatusTrackingMode,
    VendorWorkshop,
    WoActivityLogEntityType,
    WorkOrder,
    WorkOrderStatus,
)
from app.services.wo_activity_log import log_event, log_status_change


async def _find_eligible_workshops(
    session: AsyncSession,
    repair_type_value: str,
    exclude_ids: list[int] | None = None,
) -> list[VendorWorkshop]:
    """Active workshops whose repair_types[] includes the RR's type."""
    stmt = (
        select(VendorWorkshop)
        .where(VendorWorkshop.is_active.is_(True))
        .where(VendorWorkshop.repair_types.any(repair_type_value))
        .order_by(VendorWorkshop.id)  # deterministic
    )
    if exclude_ids:
        stmt = stmt.where(VendorWorkshop.id.notin_(exclude_ids))
    return list((await session.execute(stmt)).scalars().all())


async def route_repair_request(
    session: AsyncSession,
    *,
    repair_request_id: int,
    actor_id: int | None = None,
    exclude_workshop_ids: list[int] | None = None,
    target_workshop_id: int | None = None,
) -> WorkOrder | None:
    """Place the RR with the first eligible vendor workshop.

    Returns the created WorkOrder (in `pending_acceptance`) or None if no
    eligible vendor was found. Caller commits.

    When `target_workshop_id` is set, the router validates that the
    requested workshop actually handles the RR's repair_type and routes
    there directly — letting the DSP override the auto-pick on approve.
    Falls through to "no eligible vendor" if the target doesn't qualify
    or is in exclude_workshop_ids.
    """
    rr = (
        await session.execute(
            select(RepairRequest).where(RepairRequest.id == repair_request_id)
        )
    ).scalar_one_or_none()
    if rr is None:
        raise ValueError(f"repair_request {repair_request_id} not found")

    repair_type_value = (
        rr.repair_type.value if hasattr(rr.repair_type, "value") else str(rr.repair_type)
    )
    eligible = await _find_eligible_workshops(
        session, repair_type_value, exclude_ids=exclude_workshop_ids
    )

    if not eligible:
        await log_event(
            session,
            entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
            entity_id=rr.id,
            action="no_eligible_vendor",
            actor_id=actor_id,
            details={
                "repair_type": repair_type_value,
                "vehicle_id": rr.vehicle_id,
                "excluded_workshop_ids": exclude_workshop_ids or [],
            },
        )
        return None

    # If the caller asked for a specific workshop, look it up inside the
    # eligible set. Eligibility already covers "is_active + handles
    # repair_type + not excluded", so this enforces the DSP's pick
    # without leaking an out-of-scope workshop in.
    if target_workshop_id is not None:
        workshop = next((w for w in eligible if w.id == target_workshop_id), None)
        if workshop is None:
            await log_event(
                session,
                entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
                entity_id=rr.id,
                action="targeted_workshop_not_eligible",
                actor_id=actor_id,
                details={
                    "repair_type": repair_type_value,
                    "target_workshop_id": target_workshop_id,
                    "eligible_ids": [w.id for w in eligible],
                },
            )
            # Fall through to auto-pick so the approve doesn't fail outright.
            workshop = eligible[0]
    else:
        workshop = eligible[0]
    tracking_mode = workshop.status_tracking_mode
    if hasattr(tracking_mode, "value"):
        tracking_mode_enum = tracking_mode
    else:
        tracking_mode_enum = StatusTrackingMode(str(tracking_mode))

    wo = WorkOrder(
        repair_request_id=rr.id,
        vehicle_id=rr.vehicle_id,
        vendor_workshop_id=workshop.id,
        dsp_id=rr.dsp_id,
        status=WorkOrderStatus.PENDING_ACCEPTANCE,
        status_tracking_mode=tracking_mode_enum,
        is_rush=rr.is_rush,  # denormalize per spec
        created_by_id=actor_id,
    )
    session.add(wo)
    await session.flush()  # populate wo.id

    await log_status_change(
        session,
        entity_type=WoActivityLogEntityType.WORK_ORDER,
        entity_id=wo.id,
        from_status=None,
        to_status=WorkOrderStatus.PENDING_ACCEPTANCE.value,
        actor_id=actor_id,
    )
    await log_event(
        session,
        entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
        entity_id=rr.id,
        action="routed",
        actor_id=actor_id,
        details={
            "work_order_id": wo.id,
            "vendor_workshop_id": workshop.id,
            "vendor_name": workshop.name,
            "tracking_mode": tracking_mode_enum.value,
        },
    )
    # Best-effort SSE fan-out so the destination DSP + the receiving vendor
    # see the new WO land on their home cards without polling. The commit
    # happens in the caller's transaction — publishing here is fine because
    # subscribers only need to know "something changed, refetch your list",
    # and a brief window where the publish lands before the commit just
    # triggers an empty refetch on rare race; the next event will catch up.
    try:
        from app.services.pubsub import publish_work_order_event
        await publish_work_order_event({
            "event": "created",
            "work_order_id": wo.id,
            "dsp_id": wo.dsp_id,
            "vendor_workshop_id": wo.vendor_workshop_id,
            "assigned_technician_id": None,
        })
    except Exception:  # noqa: BLE001
        # Never block routing on a pubsub failure.
        pass

    # Roll up the RR status now that it has at least one child WO. First
    # route fires the open → accepted transition; re-route after a decline
    # keeps it 'accepted' (the rollup ignores the declined WO once a new
    # one is in pending_acceptance).
    from app.services.wo_rr_status import refresh_rr_status  # local import to avoid cycles
    await refresh_rr_status(
        session, repair_request_id=rr.id, actor_id=actor_id
    )

    return wo
