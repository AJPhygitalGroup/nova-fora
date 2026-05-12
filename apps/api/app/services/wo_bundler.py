"""RepairRequest bundling — group approved defects per (vehicle, repair_type).

Lifecycle (per spec §7 "Bundling window"):

  1. A defect is approved (`defect_reviews.decision='approved'`).
  2. `consider_defect_for_bundling(defect_id)` runs:
       - Resolves the defect's `repair_type` from `defect_rule.group`
         (maps DefectGroup → RepairType — see `_GROUP_TO_REPAIR_TYPE`).
       - Looks for an OPEN RR on the same (vehicle, repair_type) created
         within `dsp_settings.bundling_window_minutes`. If found, attaches
         the defect via `repair_request_defects`.
       - Otherwise, creates a fresh RR (status='open') and attaches the
         defect.
  3. After the bundling window elapses with no new attachments,
     `finalize_pending_rrs()` (CLI / cron) picks up the RR and hands it
     off to the router (which spawns the WO).

For demo purposes we expose `bypass_window=True` on
`consider_defect_for_bundling` — useful when you want to route
immediately (no 30-min wait). The route layer can also call
`finalize_pending_rrs()` synchronously on operator request.

v2.0 simplifications:
  - "Already-bundled" guard is best-effort: we only check OPEN RRs.
    Defects on a CANCELLED RR can be re-bundled later (e.g., follow-up
    after parts_unavailable defer).
  - No SELECT … FOR UPDATE — concurrent approvals on the same vehicle
    are unlikely in the demo. Add row locks in v2.x when scale matters.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.base import utc_now
from app.models.defect import Defect
from app.models.defect_catalog import (
    DefectApplicability,
    DefectRule,
)
from app.models.vehicle import Vehicle
from app.models.work_orders import (
    DspSetting,
    RepairRequest,
    RepairRequestDefect,
    RepairRequestStatus,
    RepairType,
    WoActivityLogEntityType,
)
from app.services.wo_activity_log import log_event, log_status_change


# Bucket maps from defect's `defect_rule.group` (a DefectGroup) to a
# `repair_type` (a RepairType). Same intent table as the simulator's
# `billingForGroup()` in `derive.ts` but for routing rather than billing.
#
# Anything missing falls back to MECHANICAL — safe default since most
# vendors carry mechanical capability and the router will surface a
# "no_eligible_vendor" alert if the bucket truly mismatches.
_GROUP_TO_REPAIR_TYPE: dict[str, RepairType] = {
    "AMR":        RepairType.MECHANICAL,  # AMR vs CMR is a billing concept; work bucket is mechanical
    "CMR":        RepairType.MECHANICAL,
    "Body":       RepairType.BODY,
    "Tires":      RepairType.TIRES,
    "PM":         RepairType.PM,
    "CNMR":       RepairType.CNMR,
    "Detailing":  RepairType.DETAILING,
    "Netradyne":  RepairType.NETRADYNE,
}

DEFAULT_BUNDLING_WINDOW_MINUTES = 30


async def _resolve_repair_type(
    session: AsyncSession, defect: Defect, vehicle_class: str
) -> RepairType:
    """defect_rule.group → RepairType. Defaults to mechanical if no rule."""
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
        return RepairType.MECHANICAL
    group_value = row[0]
    group_str = group_value.value if hasattr(group_value, "value") else str(group_value)
    return _GROUP_TO_REPAIR_TYPE.get(group_str, RepairType.MECHANICAL)


async def _get_window_minutes(session: AsyncSession, dsp_id: int) -> int:
    """Look up the DSP's bundling window, defaulting to 30 min if no row."""
    s = (
        await session.execute(select(DspSetting).where(DspSetting.dsp_id == dsp_id))
    ).scalar_one_or_none()
    return s.bundling_window_minutes if s else DEFAULT_BUNDLING_WINDOW_MINUTES


async def _find_open_rr(
    session: AsyncSession,
    vehicle_id: int,
    repair_type: RepairType,
    window_cutoff,
) -> RepairRequest | None:
    """Latest OPEN RR for the (vehicle, repair_type) created within window.

    Picks the most recently updated one — sibling approvals stretch the
    window forward each time they bundle.
    """
    result = await session.execute(
        select(RepairRequest)
        .where(RepairRequest.vehicle_id == vehicle_id)
        .where(RepairRequest.repair_type == repair_type)
        .where(RepairRequest.status == RepairRequestStatus.OPEN)
        .where(RepairRequest.updated_at >= window_cutoff)
        .order_by(RepairRequest.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _is_defect_already_on_rr(
    session: AsyncSession, defect_id: int, repair_request_id: int
) -> bool:
    """Idempotency check — same defect shouldn't appear twice on one RR."""
    return bool(
        (
            await session.execute(
                select(RepairRequestDefect)
                .where(RepairRequestDefect.repair_request_id == repair_request_id)
                .where(RepairRequestDefect.defect_id == defect_id)
            )
        ).first()
    )


async def consider_defect_for_bundling(
    session: AsyncSession,
    *,
    defect_id: int,
    actor_id: int | None = None,
) -> RepairRequest:
    """Attach an approved defect to an open RR or create a new one.

    Returns the RR the defect ended up on. Caller commits.
    """
    defect = (
        await session.execute(select(Defect).where(Defect.id == defect_id))
    ).scalar_one_or_none()
    if defect is None:
        raise ValueError(f"defect {defect_id} not found")

    vehicle = (
        await session.execute(select(Vehicle).where(Vehicle.id == defect.vehicle_id))
    ).scalar_one_or_none()
    if vehicle is None:
        raise ValueError(f"vehicle {defect.vehicle_id} for defect {defect_id} not found")

    repair_type = await _resolve_repair_type(session, defect, vehicle.vehicle_class)
    window_min = await _get_window_minutes(session, vehicle.dsp_id)
    window_cutoff = utc_now() - timedelta(minutes=window_min)

    rr = await _find_open_rr(session, vehicle.id, repair_type, window_cutoff)

    if rr is None:
        rr = RepairRequest(
            vehicle_id=vehicle.id,
            dsp_id=vehicle.dsp_id,
            repair_type=repair_type,
            status=RepairRequestStatus.OPEN,
            is_rush=False,
            created_by_id=actor_id,
        )
        session.add(rr)
        await session.flush()  # populate rr.id
        await log_status_change(
            session,
            entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
            entity_id=rr.id,
            from_status=None,
            to_status=RepairRequestStatus.OPEN.value,
            actor_id=actor_id,
        )

    if not await _is_defect_already_on_rr(session, defect_id, rr.id):
        session.add(
            RepairRequestDefect(
                repair_request_id=rr.id,
                defect_id=defect_id,
            )
        )
        await log_event(
            session,
            entity_type=WoActivityLogEntityType.REPAIR_REQUEST,
            entity_id=rr.id,
            action="defect_attached",
            actor_id=actor_id,
            details={"defect_id": defect_id},
        )

    # Touch the RR so the bundling window restarts from this attachment.
    rr.updated_at = utc_now()
    session.add(rr)
    await session.flush()
    return rr


async def find_rrs_ready_to_route(
    session: AsyncSession,
) -> list[RepairRequest]:
    """Scan OPEN RRs whose bundling window has elapsed.

    Used by the CLI / cron driver to hand off to the router. Window is
    per-DSP (`dsp_settings.bundling_window_minutes`) so we filter inside
    Python rather than SQL.
    """
    open_rrs = (
        (
            await session.execute(
                select(RepairRequest).where(
                    RepairRequest.status == RepairRequestStatus.OPEN
                )
            )
        )
        .scalars()
        .all()
    )
    ready: list[RepairRequest] = []
    now = utc_now()
    for rr in open_rrs:
        window_min = await _get_window_minutes(session, rr.dsp_id)
        if now - rr.updated_at >= timedelta(minutes=window_min):
            ready.append(rr)
    return ready
