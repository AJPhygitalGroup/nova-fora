"""vendor_bucks — accrual engine for the rewards program (mockup p.11).

Single entry-point `accrue_for_completed_wo` is called from the WO
complete handler. It:

  1. Reads the vendor's active RewardsProgram (if any).
  2. For each defect on the WO with `estimated_cost > 0` and
     `cost_decision='approved'`, credits the DSP
     `estimated_cost * vendor_bucks_pct / 100`.
  3. Writes one VendorBucksLedger row per defect with
     `entry_type='accrual'` and `expires_at = today +
     vendor_bucks_duration_months months`.

Idempotency: skips defects that already have an accrual row to avoid
double-credit if /complete is called twice (e.g., user retry). The
helper looks for an existing (vendor_workshop_id, dsp_id, defect_id,
entry_type='accrual') row before inserting.

Iter-1 ships accrual only. Iter-2 will add:
  - `redeem_bucks` (deduct on DSP redemption of a reward tier)
  - Cron `expire_aged_entries` that sweeps past-due accruals + writes
     matching 'expiry' rows.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.defect import Defect
from app.models.work_orders import (
    RepairRequestDefect,
    RewardsProgram,
    VendorBucksLedger,
    WorkOrder,
)


async def accrue_for_completed_wo(
    session: AsyncSession,
    *,
    work_order_id: int,
    actor_id: int | None = None,
) -> list[VendorBucksLedger]:
    """Write accrual rows for every paid defect on the WO that doesn't
    already have one. Returns the newly-created rows (empty list when
    no program exists or no defects qualify).
    """
    wo = (
        await session.execute(select(WorkOrder).where(WorkOrder.id == work_order_id))
    ).scalar_one_or_none()
    if wo is None:
        return []

    # Active rewards program for the vendor's workshop. (The schema
    # has no `is_active` flag in iter-1 — presence of the row implies
    # active. iter-2 may add a flag if vendors want to pause the program
    # without deleting it.)
    program = (
        await session.execute(
            select(RewardsProgram)
            .where(RewardsProgram.vendor_workshop_id == wo.vendor_workshop_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if program is None or program.vendor_bucks_pct <= 0:
        return []

    pct = Decimal(program.vendor_bucks_pct) / Decimal(100)
    expiry = date.today() + timedelta(days=program.vendor_bucks_duration_months * 30)

    # Pull every defect attached to this WO's RR.
    defects = list(
        (
            await session.execute(
                select(Defect)
                .join(RepairRequestDefect, RepairRequestDefect.defect_id == Defect.id)
                .where(RepairRequestDefect.repair_request_id == wo.repair_request_id)
            )
        )
        .scalars()
        .all()
    )
    if not defects:
        return []

    created: list[VendorBucksLedger] = []
    for d in defects:
        # Only paid + approved defects accrue bucks. Skip when missing
        # cost or rejected.
        if d.estimated_cost is None or d.estimated_cost <= 0:
            continue
        if d.cost_decision != "approved":
            continue

        # Idempotency: skip if an accrual row already exists.
        existing = (
            await session.execute(
                select(VendorBucksLedger)
                .where(VendorBucksLedger.vendor_workshop_id == wo.vendor_workshop_id)
                .where(VendorBucksLedger.dsp_id == wo.dsp_id)
                .where(VendorBucksLedger.defect_id == d.id)
                .where(VendorBucksLedger.entry_type == "accrual")
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing is not None:
            continue

        amount = (Decimal(d.estimated_cost) * pct).quantize(Decimal("0.01"))
        if amount <= 0:
            continue

        row = VendorBucksLedger(
            vendor_workshop_id=wo.vendor_workshop_id,
            dsp_id=wo.dsp_id,
            rewards_program_id=program.id,
            defect_id=d.id,
            work_order_id=wo.id,
            entry_type="accrual",
            amount=amount,
            expires_at=expiry,
            notes=f"Defect {d.id} repair completed",
            created_by_id=actor_id,
        )
        session.add(row)
        created.append(row)

    if created:
        await session.flush()
    return created
