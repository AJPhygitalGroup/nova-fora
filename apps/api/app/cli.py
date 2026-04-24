"""Internal CLI commands. Run with: python -m app.cli <command>

Available commands:
  seed              Seed 4 demo users + 3 orgs (idempotent — safe to re-run).
  seed-vehicles     Seed 8 Ribrell 21 vehicles (from the 2026-04-15 scrape).
  seed-inspections  Seed 8 inspections for those vehicles (2026-04-15 morning).
  reset-password <email> <new_password>   Admin override for lost passwords.
"""
import asyncio
import sys

from sqlmodel import select

from app.auth.hashing import hash_password
from app.db import AsyncSessionLocal
from app.models.base import utc_now
from app.models.inspection import (
    DefectSeverity,
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
    # Each defect: (section, part, desc, severity, category)
    (
        "PR013", 86209, "2026-04-15T07:15:23Z",
        [
            ("2. Driver Side", "Rear bumper", "Minor scrape on rear bumper", DefectSeverity.LOW, "Body"),
        ],
    ),
    (
        "PR021", 91248, "2026-04-15T07:16:42Z",
        [],  # clean
    ),
    (
        "PR016", 95073, "2026-04-15T07:17:10Z",
        [
            ("1. Front Side", "Windshield", "Chip near driver vision area — spreading", DefectSeverity.HIGH, "Glass"),
            ("3. Passenger Side", "Side mirror", "Mirror glass cracked", DefectSeverity.MEDIUM, "Body"),
        ],
    ),
    (
        "PR005", 83646, "2026-04-15T07:23:20Z",
        [
            ("4. Rear", "Brake lights", "Left brake light intermittent", DefectSeverity.MEDIUM, "Lighting"),
        ],
    ),
    (
        "PR025", 84267, "2026-04-15T07:31:01Z",
        [],  # clean
    ),
    (
        "PR026", 0, "2026-04-15T07:31:17Z",
        [
            ("6. Brakes", "Rear brake pads", "Grinding sound on hard stops", DefectSeverity.CRITICAL, "Brakes"),
        ],
    ),
    (
        "PR004", 90708, "2026-04-15T07:32:18Z",
        [],  # clean
    ),
    (
        "PR006", 99597, "2026-04-15T07:41:35Z",
        [
            ("7. Tires", "Front left tire", "Tread at 3/32 — due for replacement", DefectSeverity.HIGH, "Tires"),
            ("5. In-Cab", "Seatbelt", "Retractor sticks", DefectSeverity.LOW, "Safety"),
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

            # Derive result
            if not defects:
                result = InspectionResult.PASSED
            else:
                has_critical = any(d[3] == DefectSeverity.CRITICAL for d in defects)
                has_high = any(d[3] == DefectSeverity.HIGH for d in defects)
                result = InspectionResult.FLAGGED if (has_critical or has_high) else InspectionResult.CONDITIONAL

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

            for (section, part, desc, severity, category) in defects:
                rd = ReportedDefect(
                    inspection_id=insp.id,
                    section=section,
                    part=part,
                    description=desc,
                    severity=severity,
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
