"""Internal CLI commands. Run with: python -m app.cli <command>

Available commands:
  seed                   Seed 4 demo users + 3 orgs (idempotent).
  seed-vehicles          Seed 8 Ribrell 21 vehicles (from 2026-04-15 scrape).
  seed-inspections       Seed 8 inspections for those vehicles.
  seed-defect-catalog    Seed defect_part_system, defect_part_validity,
                          defect_details_schema reference tables (v2 spec).
  seed-dvic-template     Seed dvic_template_item rows (transcribed from
                          Amazon DVIC Cargo + DOT PDFs, Apr 2026).
  backfill-defects       Copy v2-tagged rows from reported_defects → defects
                          (idempotent). Run after the 20260428_1500 migration.
  create-service-user <email> <full_name> <org_id> <role>
                         Create a new user (e.g. for a Slack bot or other
                          machine integration). Generates a random password
                          and prints it ONCE — capture it before exiting.
                          org_id accepts NF-006 / V-005 / DSP-0004 / int.
                          role: site_admin | dsp_owner | vendor_admin | technician.
  reset-password <email> <new_password>   Admin override for lost passwords.
"""
import asyncio
import sys

from sqlmodel import select

from app.auth.hashing import hash_password
from app.db import AsyncSessionLocal
from app.models.base import utc_now
from app.models.inspection import (
    Inspection,
    InspectionResult,
    OdometerSource,
    ReportedDefect,
)
from app.models.organization import OrgType, Organization
from app.models.user import User, UserRole, UserStatus
from app.models.vehicle import Vehicle

# ─────────────────────────────────────────────────────
# Demo seed data — matches nova-fora-demo/src/data/mockData.js
# ─────────────────────────────────────────────────────

DEMO_PASSWORD = "nova2026!"  # All 4 demo users share this. Tell them on first login.

ORG_SEED = [
    {
        "key": "ribrell21",
        "name": "Ribrell 21",
        "org_type": OrgType.DSP,
        "phone": None,
        "address": None,
    },
    {
        "key": "dulles_midas",
        "name": "Dulles Midas",
        "org_type": OrgType.VENDOR,
        "phone": None,
        "address": None,
    },
    {
        "key": "nova_fora",
        "name": "Nova Fora",
        "org_type": OrgType.PLATFORM,
        "phone": None,
        "address": None,
    },
]


USER_SEED = [
    {
        "email": "tamika@ribrell21.com",
        "full_name": "Tamika Gambrell",
        "org_key": "ribrell21",
        "role": UserRole.DSP_OWNER,
        "avatar": "TG",
        "station": "DSE4",
    },
    {
        "email": "olger@dullesmidas.com",
        "full_name": "Olger Joya",
        "org_key": "dulles_midas",
        "role": UserRole.VENDOR_ADMIN,
        "avatar": "OJ",
        "station": None,
    },
    {
        "email": "david@dullesmidas.com",
        "full_name": "David Torres",
        "org_key": "dulles_midas",
        "role": UserRole.TECHNICIAN,
        "avatar": "DT",
        "station": None,
    },
    {
        "email": "maria@novafora.com",
        "full_name": "Maria Chen",
        "org_key": "nova_fora",
        "role": UserRole.SITE_ADMIN,
        "avatar": "MC",
        "station": None,
    },
]


async def cmd_seed() -> None:
    """Insert demo orgs + users if not already present. Idempotent."""
    async with AsyncSessionLocal() as session:
        # Orgs (upsert by name)
        org_by_key: dict[str, Organization] = {}
        for spec in ORG_SEED:
            existing = (
                await session.execute(
                    select(Organization).where(Organization.name == spec["name"])
                )
            ).scalar_one_or_none()
            if existing:
                print(f"[seed] org exists: {spec['name']} (id={existing.id})")
                org_by_key[spec["key"]] = existing
                continue
            new_org = Organization(
                name=spec["name"],
                org_type=spec["org_type"],
                phone=spec["phone"],
                address=spec["address"],
            )
            session.add(new_org)
            await session.flush()  # populate id
            org_by_key[spec["key"]] = new_org
            print(f"[seed] org created: {spec['name']} (id={new_org.id}, {new_org.id_str})")

        # Users (upsert by email)
        hashed_default = hash_password(DEMO_PASSWORD)
        for spec in USER_SEED:
            existing_user = (
                await session.execute(
                    select(User).where(User.email == spec["email"])
                )
            ).scalar_one_or_none()
            if existing_user:
                print(f"[seed] user exists: {spec['email']}")
                continue
            org = org_by_key[spec["org_key"]]
            new_user = User(
                email=spec["email"],
                full_name=spec["full_name"],
                password_hash=hashed_default,
                organization_id=org.id,
                role=spec["role"],
                avatar=spec["avatar"],
                station=spec["station"],
                status=UserStatus.ACTIVE,
                language="en",
            )
            session.add(new_user)
            print(f"[seed] user created: {spec['email']} ({spec['role'].value})")

        await session.commit()
    print(f"\n✅ Seed complete. Demo password: {DEMO_PASSWORD}")
    print("Login as: tamika@ribrell21.com / olger@dullesmidas.com / david@dullesmidas.com / maria@novafora.com")


# ─────────────────────────────────────────────────────
# Vehicle seed — from the real 2026-04-15 Ribrell 21 scrape
# (see Ribrell21_Inspections_2026-04-15.xlsx + generate_ribrell_excel.py).
# VINs are synthetic but pass the 17-char / no-I-O-Q format check.
# ─────────────────────────────────────────────────────

VEHICLE_SEED_RIBRELL = [
    # (fleet_id, vin, plate, year, make, model, mileage)
    ("PR013", "1FMCU9GD5MUA00013", "WA-3K13-AZ", 2021, "Mercedes", "Sprinter 2500", 86209),
    ("PR021", "1FMCU9GD5MUA00021", "WA-3K21-AZ", 2021, "Mercedes", "Sprinter 2500", 91248),
    ("PR016", "1FMCU9GD5MUA00016", "WA-3K16-AZ", 2021, "Mercedes", "Sprinter 2500", 95073),
    ("PR005", "1FMCU9GD5MUA00005", "WA-3K05-AZ", 2020, "Ford",     "Transit 250",  83646),
    ("PR025", "1FMCU9GD5MUA00025", "WA-3K25-AZ", 2022, "Ram",      "ProMaster 2500", 84267),
    ("PR026", "1FMCU9GD5MUA00026", "WA-3K26-AZ", 2022, "Ram",      "ProMaster 2500", 0),  # pending WO
    ("PR004", "1FMCU9GD5MUA00004", "WA-3K04-AZ", 2020, "Ford",     "Transit 250",  90708),
    ("PR006", "1FMCU9GD5MUA00006", "WA-3K06-AZ", 2020, "Ford",     "Transit 250",  99597),
]


async def cmd_seed_vehicles() -> None:
    """Create 8 vehicles for Ribrell 21 (idempotent)."""
    async with AsyncSessionLocal() as session:
        ribrell = (
            await session.execute(
                select(Organization).where(Organization.name == "Ribrell 21")
            )
        ).scalar_one_or_none()
        if ribrell is None:
            print("ERROR: Organization 'Ribrell 21' not found. Run 'seed' first.")
            sys.exit(1)

        created = 0
        skipped = 0
        for (fleet_id, vin, plate, year, make, model, mileage) in VEHICLE_SEED_RIBRELL:
            existing = (
                await session.execute(select(Vehicle).where(Vehicle.vin == vin))
            ).scalar_one_or_none()
            if existing:
                print(f"[seed-vehicles] exists: {fleet_id} (vin={vin})")
                skipped += 1
                continue
            v = Vehicle(
                dsp_id=ribrell.id,
                fleet_id=fleet_id,
                vin=vin,
                plate=plate,
                year=year,
                make=make,
                model=model,
                mileage=mileage,
            )
            session.add(v)
            await session.flush()
            print(f"[seed-vehicles] created: {fleet_id} (id={v.id}, {v.id_str})")
            created += 1

        await session.commit()
        print(f"\n✅ Vehicles seed complete. {created} created, {skipped} already existed.")


# ─────────────────────────────────────────────────────
# Inspection seed — 2026-04-15 Ribrell 21 scrape
# Synthetic defects modeled after what a typical DVIC morning looks like.
# ─────────────────────────────────────────────────────

from datetime import datetime, timezone

INSPECTION_SEED_RIBRELL = [
    # (fleet_id, mileage, utc_submitted_at, defects[])
    # Each defect: (section, part, desc, category)
    (
        "PR013", 86209, "2026-04-15T07:15:23Z",
        [
            ("2. Driver Side", "Rear bumper", "Minor scrape on rear bumper", "Body"),
        ],
    ),
    (
        "PR021", 91248, "2026-04-15T07:16:42Z",
        [],  # clean
    ),
    (
        "PR016", 95073, "2026-04-15T07:17:10Z",
        [
            ("1. Front Side", "Windshield", "Chip near driver vision area — spreading", "Glass"),
            ("3. Passenger Side", "Side mirror", "Mirror glass cracked", "Body"),
        ],
    ),
    (
        "PR005", 83646, "2026-04-15T07:23:20Z",
        [
            ("4. Rear", "Brake lights", "Left brake light intermittent", "Lighting"),
        ],
    ),
    (
        "PR025", 84267, "2026-04-15T07:31:01Z",
        [],  # clean
    ),
    (
        "PR026", 0, "2026-04-15T07:31:17Z",
        [
            ("6. Brakes", "Rear brake pads", "Grinding sound on hard stops", "Brakes"),
        ],
    ),
    (
        "PR004", 90708, "2026-04-15T07:32:18Z",
        [],  # clean
    ),
    (
        "PR006", 99597, "2026-04-15T07:41:35Z",
        [
            ("7. Tires", "Front left tire", "Tread at 3/32 — due for replacement", "Tires"),
            ("5. In-Cab", "Seatbelt", "Retractor sticks", "Safety"),
        ],
    ),
]


async def cmd_seed_inspections() -> None:
    """Create one inspection per van from the 2026-04-15 scrape. Idempotent."""
    async with AsyncSessionLocal() as session:
        ribrell = (
            await session.execute(
                select(Organization).where(Organization.name == "Ribrell 21")
            )
        ).scalar_one_or_none()
        if ribrell is None:
            print("ERROR: Organization 'Ribrell 21' not found. Run 'seed' first.")
            sys.exit(1)

        # Inspector: David Torres (technician at Dulles Midas vendor).
        # In real ops, technicians (drivers for DVIC, vendor techs for QC DVIC)
        # are who fill out inspection forms. dsp_owners review, not create.
        david = (
            await session.execute(
                select(User).where(User.email == "david@dullesmidas.com")
            )
        ).scalar_one_or_none()

        created = 0
        skipped = 0
        for (fleet_id, mileage, submitted_iso, defects) in INSPECTION_SEED_RIBRELL:
            vehicle = (
                await session.execute(
                    select(Vehicle).where(
                        Vehicle.dsp_id == ribrell.id, Vehicle.fleet_id == fleet_id
                    )
                )
            ).scalar_one_or_none()
            if vehicle is None:
                print(f"[seed-inspections] skip: {fleet_id} (vehicle not found)")
                continue

            # Skip if this vehicle already has an inspection on the same date
            target_dt = datetime.fromisoformat(submitted_iso.replace("Z", "+00:00"))
            existing = (
                await session.execute(
                    select(Inspection)
                    .where(Inspection.vehicle_id == vehicle.id)
                    .where(Inspection.submitted_at == target_dt)
                )
            ).scalar_one_or_none()
            if existing:
                print(f"[seed-inspections] exists: {fleet_id} @ {submitted_iso}")
                skipped += 1
                continue

            # Derive result — any defects → FLAGGED
            result = InspectionResult.PASSED if not defects else InspectionResult.FLAGGED

            insp = Inspection(
                vehicle_id=vehicle.id,
                dsp_id=ribrell.id,
                inspector_id=david.id if david else None,
                result=result,
                odometer_miles=mileage if mileage > 0 else None,
                odometer_source=OdometerSource.MANUAL,
                started_at=target_dt,
                submitted_at=target_dt,
            )
            session.add(insp)
            await session.flush()

            for (section, part, desc, category) in defects:
                rd = ReportedDefect(
                    inspection_id=insp.id,
                    section=section,
                    part=part,
                    description=desc,
                    category=category,
                )
                session.add(rd)

            # Update vehicle mileage from inspection (if higher)
            if mileage > vehicle.mileage:
                vehicle.mileage = mileage
                vehicle.updated_at = utc_now()
                session.add(vehicle)

            print(f"[seed-inspections] created: {fleet_id} {result.value} ({len(defects)} defects)")
            created += 1

        await session.commit()
        print(f"\n✅ Inspections seed complete. {created} created, {skipped} already existed.")


# ─────────────────────────────────────────────────────
# Defect catalog seed (v2 schema reference tables)
# ─────────────────────────────────────────────────────
async def cmd_seed_defect_catalog() -> None:
    """Idempotent UPSERT of defect_part_system, defect_part_validity,
    defect_details_schema rows. Safe to re-run after spec edits."""
    from app.models.defect_catalog import (
        DefectDetailsSchema,
        DefectPartSystem,
        DefectPartValidity,
    )
    from app.seed_defect_catalog import get_seed_data

    seed = get_seed_data()

    async with AsyncSessionLocal() as session:
        # ── part_system ──
        ps_count = 0
        for part, system, is_primary, group in seed["part_system"]:
            row = (
                await session.execute(
                    select(DefectPartSystem)
                    .where(DefectPartSystem.part == part)
                    .where(DefectPartSystem.system == system)
                )
            ).scalar_one_or_none()
            if row is None:
                session.add(DefectPartSystem(
                    part=part, system=system,
                    is_primary=is_primary, display_group=group,
                ))
                ps_count += 1
            else:
                row.is_primary = is_primary
                row.display_group = group
                session.add(row)

        # ── part_validity ──
        pv_count = 0
        for part, valid_positions, position_required, allow_null in seed["part_validity"]:
            row = (
                await session.execute(
                    select(DefectPartValidity).where(DefectPartValidity.part == part)
                )
            ).scalar_one_or_none()
            csv = ",".join(p.value for p in valid_positions)
            if row is None:
                session.add(DefectPartValidity(
                    part=part,
                    valid_positions_csv=csv,
                    position_required=position_required,
                    allow_null_position=allow_null,
                ))
                pv_count += 1
            else:
                row.valid_positions_csv = csv
                row.position_required = position_required
                row.allow_null_position = allow_null
                session.add(row)

        # ── details_schema ──
        ds_count = 0
        for part, defect_type, json_schema in seed["details_schema"]:
            row = (
                await session.execute(
                    select(DefectDetailsSchema)
                    .where(DefectDetailsSchema.part == part)
                    .where(DefectDetailsSchema.defect_type == defect_type)
                )
            ).scalar_one_or_none()
            if row is None:
                session.add(DefectDetailsSchema(
                    part=part, defect_type=defect_type,
                    json_schema=json_schema,
                ))
                ds_count += 1
            else:
                row.json_schema = json_schema
                session.add(row)

        await session.commit()
        print(f"✅ Defect catalog seed:")
        print(f"   part_system     — {ps_count} new, {len(seed['part_system']) - ps_count} updated")
        print(f"   part_validity   — {pv_count} new, {len(seed['part_validity']) - pv_count} updated")
        print(f"   details_schema  — {ds_count} new, {len(seed['details_schema']) - ds_count} updated")


async def cmd_seed_dvic_template() -> None:
    """Idempotent UPSERT of dvic_template_item from the Amazon DVIC PDFs.

    Dedup key: (asset_types_csv, section, part_enum, defect_type_enum, position).
    Re-running after a PDF revision updates description/severity/etc.

    Orphan handling: any row in DB whose key is no longer in the seed (e.g.
    after a consolidation that merges two CARGO+DOT rows into one ALL_ASSETS
    row) is flipped to is_active=False so the wizard stops surfacing it.
    Hard-delete is skipped intentionally — defects already authored against
    that row's labels still need the row around for historical rendering.
    """
    from app.models.defect_catalog import DvicTemplateItem
    from app.seed_dvic_template import get_dvic_template_seed

    rows = get_dvic_template_seed()

    # Pre-compute the set of keys we expect to touch — used at the end to
    # find orphans.
    seed_keys: set[tuple] = set()
    for r in rows:
        position_val = r["position"].value if r["position"] is not None else None
        section_val = r["section"].value if hasattr(r["section"], "value") else r["section"]
        seed_keys.add(
            (
                r["asset_types_csv"],
                section_val,
                r["part_enum"].value,
                r["defect_type_enum"].value,
                position_val,
            )
        )

    async with AsyncSessionLocal() as session:
        new_count, updated_count = 0, 0
        for r in rows:
            position_val = r["position"].value if r["position"] is not None else None
            existing = (
                await session.execute(
                    select(DvicTemplateItem)
                    .where(DvicTemplateItem.asset_types_csv == r["asset_types_csv"])
                    .where(DvicTemplateItem.section == r["section"])
                    .where(DvicTemplateItem.part_enum == r["part_enum"])
                    .where(DvicTemplateItem.defect_type_enum == r["defect_type_enum"])
                    .where(
                        DvicTemplateItem.position == position_val
                        if position_val is not None
                        else DvicTemplateItem.position.is_(None)
                    )
                )
            ).scalar_one_or_none()

            if existing is None:
                session.add(
                    DvicTemplateItem(
                        asset_types_csv=r["asset_types_csv"],
                        section=r["section"],
                        part_category=r["part_category"],
                        part_enum=r["part_enum"],
                        defect_type_enum=r["defect_type_enum"],
                        position=r["position"],
                        position_options_csv=r["position_options_csv"],
                        sub_positions=r["sub_positions"],
                        description=r["description"],
                        details_schema=r["details_schema"],
                        ordering=r["ordering"],
                        is_active=True,
                    )
                )
                new_count += 1
            else:
                existing.part_category = r["part_category"]
                existing.position_options_csv = r["position_options_csv"]
                existing.sub_positions = r["sub_positions"]
                existing.description = r["description"]
                existing.details_schema = r["details_schema"]
                existing.ordering = r["ordering"]
                existing.is_active = True
                session.add(existing)
                updated_count += 1

        # Deactivate any DB row whose key is no longer in the seed. This
        # covers the case where the seed file removed/merged a row — without
        # this step the wizard would keep showing the old row alongside the
        # new one (the "two identical tiles" bug after consolidation).
        all_existing = (
            await session.execute(select(DvicTemplateItem))
        ).scalars().all()
        deactivated_count = 0
        for row_db in all_existing:
            position_val = row_db.position.value if row_db.position is not None else None
            section_val = row_db.section.value if hasattr(row_db.section, "value") else row_db.section
            key = (
                row_db.asset_types_csv,
                section_val,
                row_db.part_enum.value,
                row_db.defect_type_enum.value,
                position_val,
            )
            if key not in seed_keys and row_db.is_active:
                row_db.is_active = False
                session.add(row_db)
                deactivated_count += 1

        await session.commit()
        print("✅ DVIC template seed:")
        print(f"   {new_count} new rows, {updated_count} updated, {deactivated_count} deactivated")
        print(f"   Seed total: {len(rows)}")


async def cmd_backfill_defects() -> None:
    """Copy v2-tagged rows from reported_defects → defects (idempotent).

    Selection: any ReportedDefect with both `part_enum` and `defect_type_enum`
    populated. These were already authored against the v2 catalog; the legacy
    free-text columns on the row are ignored.

    Mapping:
      vehicle_id      ← inspection.vehicle_id (always present)
      inspection_id   ← reported_defect.inspection_id
      source          ← 'inspection' (all backfilled rows came from one)
      part            ← reported_defect.part_enum
      position        ← reported_defect.position
      defect_type     ← reported_defect.defect_type_enum
      details         ← reported_defect.details or {}
      notes           ← reported_defect.notes
      reported_by_id  ← reported_defect.reported_by_id ?? inspection.inspector_id
      reported_at     ← reported_defect.reported_at ?? reported_defect.created_at

    Idempotency: skip rows whose
      (vehicle_id, inspection_id, part, position, defect_type) tuple already
    exists in `defects`. Safe to re-run after partial failures or after
    additional reported_defects rows are written.

    Rejected rows: a row with no reporter (no reported_by_id AND no
    inspector on the parent inspection) is skipped — Defect.reported_by_id
    is NOT NULL. This indicates a seeding gap; printed with the FD- id.
    """
    from app.models.defect import Defect, DefectSource
    from app.models.inspection import Inspection, ReportedDefect

    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(ReportedDefect, Inspection)
                .join(Inspection, ReportedDefect.inspection_id == Inspection.id)
                .where(ReportedDefect.part_enum.is_not(None))
                .where(ReportedDefect.defect_type_enum.is_not(None))
            )
        ).all()

        copied = 0
        skipped = 0
        rejected = 0

        for rd, insp in rows:
            existing = (
                await session.execute(
                    select(Defect)
                    .where(Defect.vehicle_id == insp.vehicle_id)
                    .where(Defect.inspection_id == insp.id)
                    .where(Defect.part == rd.part_enum)
                    .where(
                        Defect.position == rd.position
                        if rd.position is not None
                        else Defect.position.is_(None)
                    )
                    .where(Defect.defect_type == rd.defect_type_enum)
                )
            ).scalar_one_or_none()
            if existing:
                skipped += 1
                continue

            reporter_id = rd.reported_by_id or insp.inspector_id
            if reporter_id is None:
                print(
                    f"[backfill-defects] reject FD-{rd.id:03d}: "
                    f"no reporter (reported_by_id and inspection.inspector_id both NULL)"
                )
                rejected += 1
                continue

            d = Defect(
                vehicle_id=insp.vehicle_id,
                inspection_id=insp.id,
                source=DefectSource.INSPECTION,
                part=rd.part_enum,
                position=rd.position,
                defect_type=rd.defect_type_enum,
                details=rd.details or {},
                notes=rd.notes,
                reported_by_id=reporter_id,
                reported_at=rd.reported_at or rd.created_at,
            )
            session.add(d)
            copied += 1

        await session.commit()
        print(
            f"\n✅ Defects backfill: {copied} copied, "
            f"{skipped} skipped (already in defects), {rejected} rejected."
        )


def _parse_org_id(raw: str) -> int:
    """Accept 'NF-006', 'V-005', 'DSP-0004', or a bare int."""
    s = raw.strip().upper()
    for prefix in ("DSP-", "NF-", "V-"):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    return int(s)


async def cmd_create_service_user(
    email: str, full_name: str, org_id_raw: str, role_str: str
) -> None:
    """Create a user with a randomly-generated password.

    Used for service accounts (Slack bots, ingest pipelines, etc.) that need
    to authenticate against the API with a real `users.id`. The password is
    printed ONCE — capture it from stdout, store it in a secret manager,
    rotate later via `reset-password` if needed.
    """
    import secrets

    # ── Validate role ──
    try:
        role = UserRole(role_str)
    except ValueError:
        print(
            f"ERROR: invalid role {role_str!r}. "
            f"Allowed: {[r.value for r in UserRole]}"
        )
        sys.exit(1)

    # ── Validate + look up org ──
    try:
        org_pk = _parse_org_id(org_id_raw)
    except ValueError:
        print(f"ERROR: invalid org id {org_id_raw!r}.")
        sys.exit(1)

    async with AsyncSessionLocal() as session:
        org = (
            await session.execute(select(Organization).where(Organization.id == org_pk))
        ).scalar_one_or_none()
        if org is None:
            print(f"ERROR: no organization with id {org_id_raw!r} (parsed as {org_pk}).")
            sys.exit(1)

        # ── Refuse if email already exists ──
        email_lc = email.strip().lower()
        existing = (
            await session.execute(select(User).where(User.email == email_lc))
        ).scalar_one_or_none()
        if existing is not None:
            print(
                f"ERROR: user {email_lc!r} already exists (id={existing.id}, "
                f"org_id={existing.organization_id}, role={existing.role.value}). "
                f"Use 'reset-password' to rotate credentials."
            )
            sys.exit(1)

        # ── Generate password ──
        password = secrets.token_urlsafe(32)

        # ── Build initials for avatar (first letter of first two words, max 2 chars) ──
        parts = [p for p in full_name.split() if p]
        avatar = "".join(p[0].upper() for p in parts[:2]) or "??"

        user = User(
            email=email_lc,
            full_name=full_name,
            password_hash=hash_password(password),
            organization_id=org_pk,
            role=role,
            avatar=avatar,
            language="en",
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        sep = "─" * 72
        print()
        print(sep)
        print("✅ Service user created. The password below is shown ONCE — copy it now.")
        print(sep)
        print(f"  user_id     : {user.id}")
        print(f"  email       : {user.email}")
        print(f"  full_name   : {user.full_name}")
        print(f"  organization: {org.name} ({org.id_str})")
        print(f"  role        : {user.role.value}")
        print(f"  password    : {password}")
        print(sep)
        print(
            "Store this in a secret manager. To rotate later: "
            f"`python -m app.cli reset-password {user.email} <new_password>`."
        )
        print(sep)


async def cmd_reset_password(email: str, new_password: str) -> None:
    async with AsyncSessionLocal() as session:
        user = (
            await session.execute(select(User).where(User.email == email.lower()))
        ).scalar_one_or_none()
        if user is None:
            print(f"ERROR: no user with email {email}")
            sys.exit(1)
        user.password_hash = hash_password(new_password)
        session.add(user)
        await session.commit()
        print(f"✅ Password reset for {email}")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "seed":
        asyncio.run(cmd_seed())
    elif cmd == "seed-vehicles":
        asyncio.run(cmd_seed_vehicles())
    elif cmd == "seed-inspections":
        asyncio.run(cmd_seed_inspections())
    elif cmd == "seed-defect-catalog":
        asyncio.run(cmd_seed_defect_catalog())
    elif cmd == "seed-dvic-template":
        asyncio.run(cmd_seed_dvic_template())
    elif cmd == "backfill-defects":
        asyncio.run(cmd_backfill_defects())
    elif cmd == "create-service-user":
        if len(sys.argv) != 6:
            print(
                "Usage: python -m app.cli create-service-user "
                "<email> <full_name> <org_id> <role>"
            )
            sys.exit(1)
        asyncio.run(
            cmd_create_service_user(
                sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
            )
        )
    elif cmd == "reset-password":
        if len(sys.argv) != 4:
            print("Usage: python -m app.cli reset-password <email> <new_password>")
            sys.exit(1)
        asyncio.run(cmd_reset_password(sys.argv[2], sys.argv[3]))
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
