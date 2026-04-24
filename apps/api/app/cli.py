"""Internal CLI commands. Run with: python -m app.cli <command>

Available commands:
  seed             Seed 4 demo users + 3 orgs (idempotent — safe to re-run).
  seed-vehicles    Seed 8 Ribrell 21 vehicles (from the 2026-04-15 scrape).
  reset-password <email> <new_password>   Admin override for lost passwords.
"""
import asyncio
import sys

from sqlmodel import select

from app.auth.hashing import hash_password
from app.db import AsyncSessionLocal
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
