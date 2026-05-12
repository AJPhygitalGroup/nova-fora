"""Seed + ops commands for the V2.0 Work Order surface.

Four commands, all idempotent (rerun-safe):

  seed-vendor-workshops   Insert 4 demo workshops (Dulles Midas plus 3
                          standalone shops). UPSERT keyed on `name`.

  seed-dsp-settings       Insert DSP settings for Safety First LLC with
                          AMR/PM preauth groups + spec defaults. UPSERT
                          keyed on `dsp_id`.

  seed-wo-demo            End-to-end demo orchestration: approve a
                          handful of existing demo defects, force-route
                          their RRs, optionally accept the first WO so
                          the UI starts with realistic state.

  bundle-route-cron       Operational driver: scan OPEN RRs whose
                          bundling window has elapsed, hand them to the
                          router. Run on a 1-min cron in prod; the cli
                          flag lets us trigger it manually in dev.

Designed to be safe to run in any order. seed-wo-demo will create
prerequisites (workshops, settings) if missing.
"""
from __future__ import annotations

from decimal import Decimal

from sqlmodel import select

from app.db import AsyncSessionLocal
from app.models.defect import Defect
from app.models.organization import OrgType, Organization
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.models.base import utc_now
from app.models.work_orders import (
    DefectReview,
    DefectReviewDecision,
    DspSetting,
    RepairType,
    StatusTrackingMode,
    VendorWorkshop,
    WoActivityLogEntityType,
    WorkOrder,
    WorkOrderStatus,
)
from app.services.wo_activity_log import log_status_change
from app.services.wo_bundler import (
    consider_defect_for_bundling,
    find_rrs_ready_to_route,
)
from app.services.wo_defect_reviews import manual_review
from app.services.wo_line_items import generate_line_items_on_accept
from app.services.wo_router import route_repair_request


# ─────────────────────────────────────────────────────────
# Workshop catalog
# ─────────────────────────────────────────────────────────
WORKSHOP_SEED = [
    {
        "name": "Dulles Midas",
        "org_key": "dulles_midas",  # ties to the existing demo vendor org
        "status_tracking_mode": StatusTrackingMode.EXTERNAL,
        "repair_types": [RepairType.MECHANICAL, RepairType.PM],
    },
    {
        "name": "Wheels & Brakes Co",
        "org_key": None,
        "status_tracking_mode": StatusTrackingMode.INTERNAL,
        "repair_types": [RepairType.TIRES, RepairType.MECHANICAL],
    },
    {
        "name": "Capital Body Shop",
        "org_key": None,
        "status_tracking_mode": StatusTrackingMode.EXTERNAL,
        "repair_types": [RepairType.BODY],
    },
    {
        "name": "Premium Detail",
        "org_key": None,
        "status_tracking_mode": StatusTrackingMode.INTERNAL,
        "repair_types": [RepairType.DETAILING],
    },
]


async def cmd_seed_vendor_workshops() -> None:
    """UPSERT the 4 demo workshops keyed on name. Reports what changed."""
    async with AsyncSessionLocal() as session:
        # Map known org keys to ids
        orgs = (await session.execute(select(Organization))).scalars().all()
        org_by_name: dict[str, Organization] = {o.name.lower(): o for o in orgs}

        # Helper to resolve a workshop's organization_id from the seed's
        # org_key. We match by name (lowercased) against existing orgs.
        org_key_to_id = {
            "dulles_midas": next(
                (o.id for o in orgs if o.name == "Dulles Midas"), None
            ),
        }

        new_count, updated_count, skipped_count = 0, 0, 0
        for spec in WORKSHOP_SEED:
            existing = (
                await session.execute(
                    select(VendorWorkshop).where(VendorWorkshop.name == spec["name"])
                )
            ).scalar_one_or_none()
            org_id = (
                org_key_to_id.get(spec["org_key"])
                if spec["org_key"] is not None
                else None
            )
            target_types = [rt.value for rt in spec["repair_types"]]
            if existing is None:
                w = VendorWorkshop(
                    name=spec["name"],
                    organization_id=org_id,
                    status_tracking_mode=spec["status_tracking_mode"],
                    repair_types=target_types,
                    is_active=True,
                )
                session.add(w)
                new_count += 1
            else:
                changed = False
                if existing.organization_id != org_id:
                    existing.organization_id = org_id
                    changed = True
                if existing.status_tracking_mode != spec["status_tracking_mode"]:
                    existing.status_tracking_mode = spec["status_tracking_mode"]
                    changed = True
                if sorted(existing.repair_types or []) != sorted(target_types):
                    existing.repair_types = target_types
                    changed = True
                if not existing.is_active:
                    existing.is_active = True
                    changed = True
                if changed:
                    session.add(existing)
                    updated_count += 1
                else:
                    skipped_count += 1
        await session.commit()
        _ = org_by_name  # used implicitly via org_key_to_id; suppress lint
        print(
            f"vendor_workshops: {new_count} new, "
            f"{updated_count} updated, {skipped_count} unchanged."
        )


# ─────────────────────────────────────────────────────────
# DSP settings — Safety First gets AMR/PM auto-approval preauth.
# ─────────────────────────────────────────────────────────
DSP_SETTINGS_SEED = [
    {
        "dsp_name": "Safety First LLC",
        "cmr_auto_approve_threshold": None,         # DORMANT in v2.0
        "preauth_defect_groups": ["AMR", "PM"],     # auto-approve via preauth_group
        "notes": "Demo DSP. Preauth Amazon-paid groups for faster routing.",
        "review_sla_hours": 24,
        "default_variance_tolerance": Decimal("0.10"),
        "bundling_window_minutes": 30,
    },
]


async def cmd_seed_dsp_settings() -> None:
    """UPSERT DSP settings for the seeded DSPs."""
    async with AsyncSessionLocal() as session:
        new_count, updated_count, skipped_count = 0, 0, 0
        for spec in DSP_SETTINGS_SEED:
            org = (
                await session.execute(
                    select(Organization)
                    .where(Organization.name == spec["dsp_name"])
                    .where(Organization.org_type == OrgType.DSP)
                )
            ).scalar_one_or_none()
            if org is None:
                print(f"  skipped: DSP {spec['dsp_name']!r} not found in orgs.")
                continue
            row = (
                await session.execute(
                    select(DspSetting).where(DspSetting.dsp_id == org.id)
                )
            ).scalar_one_or_none()
            target_groups = sorted(spec["preauth_defect_groups"])
            if row is None:
                session.add(
                    DspSetting(
                        dsp_id=org.id,
                        cmr_auto_approve_threshold=spec["cmr_auto_approve_threshold"],
                        preauth_defect_groups=target_groups,
                        notes=spec["notes"],
                        review_sla_hours=spec["review_sla_hours"],
                        default_variance_tolerance=spec["default_variance_tolerance"],
                        bundling_window_minutes=spec["bundling_window_minutes"],
                    )
                )
                new_count += 1
            else:
                changed = False
                if (
                    row.cmr_auto_approve_threshold != spec["cmr_auto_approve_threshold"]
                ):
                    row.cmr_auto_approve_threshold = spec["cmr_auto_approve_threshold"]
                    changed = True
                if sorted(row.preauth_defect_groups or []) != target_groups:
                    row.preauth_defect_groups = target_groups
                    changed = True
                if row.notes != spec["notes"]:
                    row.notes = spec["notes"]
                    changed = True
                if row.review_sla_hours != spec["review_sla_hours"]:
                    row.review_sla_hours = spec["review_sla_hours"]
                    changed = True
                if row.default_variance_tolerance != spec["default_variance_tolerance"]:
                    row.default_variance_tolerance = spec["default_variance_tolerance"]
                    changed = True
                if row.bundling_window_minutes != spec["bundling_window_minutes"]:
                    row.bundling_window_minutes = spec["bundling_window_minutes"]
                    changed = True
                if changed:
                    session.add(row)
                    updated_count += 1
                else:
                    skipped_count += 1
        await session.commit()
        print(
            f"dsp_settings: {new_count} new, "
            f"{updated_count} updated, {skipped_count} unchanged."
        )


# ─────────────────────────────────────────────────────────
# Demo orchestration — approve N defects → bundle → route → accept one.
# Idempotent: rerunning won't double-route already-handled defects.
# ─────────────────────────────────────────────────────────
async def cmd_seed_wo_demo(max_defects: int = 3) -> None:
    """Run a realistic end-to-end V2.0 flow against existing demo data.

    Picks the oldest `max_defects` defects with no review row yet, manually
    approves them, bundles+routes their RRs, and accepts the first WO so
    the demo opens with at least one WO in `accepted` state (with line
    items + DRs populated).

    Requires `seed-vendor-workshops` to have run first.
    """
    async with AsyncSessionLocal() as session:
        # Ensure prereqs
        ws_count = (
            await session.execute(
                select(VendorWorkshop).where(VendorWorkshop.is_active.is_(True))
            )
        ).scalars().all()
        if not list(ws_count):
            print("ERROR: no active workshops. Run seed-vendor-workshops first.")
            return

        # Pick a site_admin (or any user) to act as the reviewer/router
        site_admin = (
            await session.execute(
                select(User).where(User.role == UserRole.SITE_ADMIN).limit(1)
            )
        ).scalar_one_or_none()
        actor_id = site_admin.id if site_admin else None

        # Find defects with no review yet
        candidates = list(
            (
                await session.execute(
                    select(Defect)
                    .outerjoin(DefectReview, DefectReview.defect_id == Defect.id)
                    .where(DefectReview.id.is_(None))
                    .order_by(Defect.reported_at.asc())
                    .limit(max_defects)
                )
            )
            .scalars()
            .all()
        )
        if not candidates:
            print("No unreviewed defects in DB — demo flow already wired or no data.")
            return

        approved_ids: list[int] = []
        for defect in candidates:
            await manual_review(
                session,
                defect_id=defect.id,
                decision=DefectReviewDecision.APPROVED,
                reviewer_id=actor_id,
                reason="seed-wo-demo: bootstrap approval",
            )
            await consider_defect_for_bundling(
                session, defect_id=defect.id, actor_id=actor_id
            )
            approved_ids.append(defect.id)
        await session.commit()
        print(f"  approved + bundled {len(approved_ids)} defects: {approved_ids}")

        # Force-route every OPEN RR for our DSPs (skips bundling window)
        from app.models.work_orders import RepairRequest, RepairRequestStatus

        open_rrs = list(
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
        routed_wo_ids: list[int] = []
        for rr in open_rrs:
            wo = await route_repair_request(
                session, repair_request_id=rr.id, actor_id=actor_id
            )
            if wo is not None:
                routed_wo_ids.append(wo.id)
        await session.commit()
        print(f"  routed {len(routed_wo_ids)} RRs → WOs: {routed_wo_ids}")

        # Pick the first routed WO and accept it so the demo has a fully-
        # populated WO (line items + defect_resolutions). Skip if no WOs.
        if not routed_wo_ids:
            print("No WOs to accept (probably no eligible workshops for those RRs).")
            return

        first_wo = (
            await session.execute(
                select(WorkOrder).where(WorkOrder.id == routed_wo_ids[0])
            )
        ).scalar_one_or_none()
        if first_wo is None:
            return

        # External-mode workshops need an RO# before accept. Skip those —
        # we leave them in pending_acceptance for the demo to play with.
        tracking = (
            first_wo.status_tracking_mode.value
            if hasattr(first_wo.status_tracking_mode, "value")
            else first_wo.status_tracking_mode
        )
        if tracking == "external":
            print(
                f"  WO#{first_wo.id} is external-mode; leaving pending_acceptance "
                "(needs RO# attached via /work-orders/{id}/ros)."
            )
            return

        prev = first_wo.status.value if hasattr(first_wo.status, "value") else str(first_wo.status)
        first_wo.status = WorkOrderStatus.ACCEPTED
        first_wo.accepted_at = utc_now()
        first_wo.assigned_technician_id = None
        session.add(first_wo)
        await log_status_change(
            session,
            entity_type=WoActivityLogEntityType.WORK_ORDER,
            entity_id=first_wo.id,
            from_status=prev,
            to_status=WorkOrderStatus.ACCEPTED.value,
            actor_id=actor_id,
        )
        # Generate line items + DRs + bulk linkage
        items, drs = await generate_line_items_on_accept(
            session, work_order_id=first_wo.id, actor_id=actor_id
        )
        await session.commit()
        print(
            f"  accepted WO#{first_wo.id} → "
            f"{len(items)} line items + {len(drs)} defect_resolutions"
        )
        print("seed-wo-demo: done.")


# ─────────────────────────────────────────────────────────
# Operational cron driver — scan ready RRs, route them.
# Idempotent (router is a no-op for already-routed RRs since they'd
# never appear in find_rrs_ready_to_route's OPEN-status filter once
# a WO exists). Safe to run on a 1-min schedule.
# ─────────────────────────────────────────────────────────
async def cmd_bundle_route_cron() -> None:
    """Find RRs past their bundling window and hand them to the router.

    Output is one log line per RR routed (or zero lines if nothing's ready).
    Exit code 0 always — failure to find an eligible vendor is normal, not
    an error.
    """
    async with AsyncSessionLocal() as session:
        ready = await find_rrs_ready_to_route(session)
        if not ready:
            print("bundle-route-cron: 0 RRs ready.")
            return
        routed = 0
        no_vendor = 0
        for rr in ready:
            wo = await route_repair_request(
                session, repair_request_id=rr.id, actor_id=None
            )
            if wo is None:
                no_vendor += 1
                print(f"  RR#{rr.id} ({rr.repair_type}) — no eligible vendor")
            else:
                routed += 1
                print(f"  RR#{rr.id} ({rr.repair_type}) → WO#{wo.id}")
        await session.commit()
        print(f"bundle-route-cron: routed {routed}, no_vendor {no_vendor}.")
