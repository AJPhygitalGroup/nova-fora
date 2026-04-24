"""Internal CLI commands. Run with: python -m app.cli <command>

Available commands:
  seed           Seed 4 demo users + 3 orgs (idempotent — safe to re-run).
  reset-password <email> <new_password>   Admin override for lost passwords.
"""
import asyncio
import sys

from sqlmodel import select

from app.auth.hashing import hash_password
from app.db import AsyncSessionLocal
from app.models.organization import OrgType, Organization
from app.models.user import User, UserRole, UserStatus

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
