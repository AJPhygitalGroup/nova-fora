"""DB-backed fixtures for the marketplace tests.

Unlike the live-API authz suite one level up, these tests run against a
dedicated, throwaway PostgreSQL database:

    MARKETPLACE_TEST_DATABASE_URL  (default
        postgresql+asyncpg://nova:dev_pass@localhost:55432/nova_test)

    docker run -d --name mkt-test-pg -e POSTGRES_USER=nova \\
        -e POSTGRES_PASSWORD=dev_pass -e POSTGRES_DB=nova_test \\
        -p 55432:5432 postgres:16-alpine

The session fixture DROPS the `public` schema of that database, then runs
the real Alembic chain (upgrade head → downgrade -1 → upgrade head) so the
marketplace migration is exercised both ways. Never point it at a DB you
care about. If the DB is unreachable the module skips.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

TEST_DB = os.environ.get(
    "MARKETPLACE_TEST_DATABASE_URL",
    "postgresql+asyncpg://nova:dev_pass@localhost:55432/nova_test",
)
# Settings are read once (lru_cache) — configure BEFORE importing app code.
os.environ["DATABASE_URL"] = TEST_DB
os.environ["SKIP_BOOT_SEED"] = "1"
os.environ["SMTP_HOST"] = ""
os.environ["SMTP_FROM"] = "Nova Fora <jescalona@dantzigfleets.com>"
os.environ["MARKETPLACE_FROM_EMAIL"] = "jescalona@dantzigfleets.com"
os.environ["MARKETPLACE_FROM_NAME"] = "DFS Repair Marketplace"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["APP_URL"] = "https://app.test"
os.environ["ENV"] = "test"
os.environ["MARKETPLACE_TOKEN_SECRET"] = "test-marketplace-secret"

import asyncio  # noqa: E402
import itertools  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool  # noqa: E402

API_DIR = Path(__file__).resolve().parents[2]
_KEEP_TABLES = {"alembic_version", "decline_reason_codes"}


async def _probe() -> bool:
    eng = create_async_engine(TEST_DB, poolclass=NullPool)
    try:
        async with eng.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001
        return False
    finally:
        await eng.dispose()


async def _reset_schema() -> None:
    eng = create_async_engine(TEST_DB, poolclass=NullPool)
    async with eng.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await eng.dispose()


def _alembic(*args: str) -> None:
    env = {**os.environ, "DATABASE_URL": TEST_DB, "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"alembic {' '.join(args)} failed:\n{proc.stdout}\n{proc.stderr}")


@pytest.fixture(scope="session", autouse=True)
def _api_must_be_reachable():
    """Override the parent suite's live-API probe — these tests own their DB."""
    yield


@pytest.fixture(scope="session")
def migrated_db():
    if not asyncio.run(_probe()):
        pytest.skip(
            f"marketplace test DB not reachable at {TEST_DB} (see tests/marketplace/conftest.py)"
        )
    asyncio.run(_reset_schema())
    _alembic("upgrade", "head")
    _alembic("downgrade", "-1")  # marketplace migration must reverse cleanly…
    _alembic("upgrade", "head")  # …and re-apply.
    return TEST_DB


@pytest_asyncio.fixture
async def engine(migrated_db):
    from app.services.marketplace.rules import seed_rows

    eng = create_async_engine(TEST_DB, poolclass=NullPool)
    async with eng.begin() as conn:
        tables = (
            (
                await conn.execute(
                    text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                )
            )
            .scalars()
            .all()
        )
        wipe = [t for t in tables if t not in _KEEP_TABLES]
        if wipe:
            await conn.execute(text(f"TRUNCATE {', '.join(wipe)} RESTART IDENTITY CASCADE"))
        for row in seed_rows():
            await conn.execute(
                text(
                    "INSERT INTO marketplace_rules "
                    "(category, part, defect_types, specialty, active) "
                    "VALUES (:category, :part, :defect_types, :specialty, true)"
                ),
                row,
            )
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def maker(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)


@pytest_asyncio.fixture
async def db(maker):
    async with maker() as session:
        yield session


@pytest.fixture(autouse=True)
def outbox(monkeypatch):
    """Capture post-commit marketplace emails instead of sending them."""
    sent: list = []
    monkeypatch.setattr(
        "app.services.marketplace.notifications.dispatch", lambda msgs: sent.extend(msgs)
    )
    return sent


@pytest_asyncio.fixture
async def client(maker):
    from app.db import get_session
    from app.main import app

    async def _session():
        async with maker() as s:
            try:
                yield s
            except Exception:
                await s.rollback()
                raise

    app.dependency_overrides[get_session] = _session
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
    app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────
# Factories
# ─────────────────────────────────────────────────────
_seq = itertools.count(1)


class World:
    """Tiny data builder bound to one session (commits on each call)."""

    def __init__(self, session: AsyncSession):
        self.s = session

    async def org(self, name: str, org_type: str, **kw):
        from app.models.organization import Organization, OrgType

        org = Organization(name=name, org_type=OrgType(org_type), **kw)
        self.s.add(org)
        await self.s.commit()
        return org

    async def user(
        self,
        org,
        role: str,
        email: str | None = None,
        station: str | None = None,
        status: str = "active",
    ):
        from app.models.user import User, UserRole, UserStatus

        n = next(_seq)
        u = User(
            email=email or f"user{n}@example.com",
            full_name=f"User {n}",
            password_hash="x",
            organization_id=org.id,
            role=UserRole(role),
            status=UserStatus(status),
            station=station,
        )
        self.s.add(u)
        await self.s.commit()
        return u

    async def vehicle(self, dsp, fleet_id: str | None = None):
        from app.models.vehicle import Vehicle

        n = next(_seq)
        v = Vehicle(
            dsp_id=dsp.id,
            fleet_id=fleet_id or f"PR{n:03d}",
            vin=f"1FTBW3XG{n:09d}"[:17],
            plate=f"VA-{n:04d}",
            year=2023,
            make="Ford",
            model="Transit 250",
        )
        self.s.add(v)
        await self.s.commit()
        return v

    async def inspection(self, vehicle, inspector):
        from app.models.inspection import Inspection, InspectionResult, InspectionStatus

        ins = Inspection(
            vehicle_id=vehicle.id,
            dsp_id=vehicle.dsp_id,
            inspector_id=inspector.id,
            status=InspectionStatus.SUBMITTED,
            result=InspectionResult.FLAGGED,
        )
        self.s.add(ins)
        await self.s.commit()
        return ins

    async def defect(
        self,
        vehicle,
        reporter,
        part: str,
        defect_type: str,
        *,
        position: str | None = None,
        notes: str | None = None,
        details: dict | None = None,
        reported_at=None,
        inspection=None,
    ):
        """A defect. Pass `inspection` to model a nightly DVIC report (the
        same physical damage gets a fresh row per inspection)."""
        from app.models.base import utc_now
        from app.models.defect import Defect, DefectSource

        d = Defect(
            vehicle_id=vehicle.id,
            inspection_id=inspection.id if inspection else None,
            source=DefectSource.INSPECTION if inspection else DefectSource.DRIVER_REPORT,
            part=part,
            position=position,
            defect_type=defect_type,
            details=details or {},
            notes=notes,
            reported_by_id=reporter.id,
            reported_at=reported_at or utc_now(),
        )
        self.s.add(d)
        await self.s.commit()
        return d

    async def photo(self, defect, uploader):
        from app.models.photo import Photo, PhotoCategory

        p = Photo(
            defect_id=defect.id,
            category=PhotoCategory.DAMAGE,
            storage_key=f"photos/defects/FD-{defect.id:03d}/{next(_seq)}.jpg",
            content_type="image/jpeg",
            size_bytes=1000,
            uploaded_by_id=uploader.id,
        )
        self.s.add(p)
        await self.s.commit()
        return p


@pytest_asyncio.fixture
async def world(db):
    return World(db)


def bearer(user) -> dict:
    from app.auth.jwt import create_access_token

    return {"Authorization": f"Bearer {create_access_token(user_id=user.id)}"}


@pytest_asyncio.fixture
async def scenario(world, db):
    """One DSP (station DDC4) with a van carrying CMR + non-CMR defects, two
    general shops, one body shop. Offers are synced."""
    from app.services.marketplace.eligibility import sync_offers

    dsp = await world.org("Safety First LLC", "dsp", phone="703-555-0100")
    owner = await world.user(dsp, "dsp_owner", email="owner@safetyfirst.com", station="ddc4")
    van = await world.vehicle(dsp, fleet_id="PR006")
    tail = await world.defect(
        van, owner, "tail_light", "cracked", position="rear_left", notes="Lens cracked, bulb works"
    )
    mirror = await world.defect(van, owner, "side_mirror", "broken", position="driver")
    bumper = await world.defect(van, owner, "bumper", "dent", position="front")
    await world.defect(van, owner, "headlight", "not_working", position="front_left")  # AMR
    await world.photo(tail, owner)

    shop_a = await world.org("Chemas Autohaus", "vendor")
    admin_a = await world.user(shop_a, "vendor_admin", email="chema@chemas.com")
    shop_b = await world.org("Dulles Midas", "vendor")
    admin_b = await world.user(shop_b, "vendor_admin", email="olger@midas.com")
    body = await world.org("Capital Body Shop", "body_repair_vendor")
    admin_body = await world.user(body, "vendor_admin", email="mike@capitalbody.com")

    result = await sync_offers(db)
    await db.commit()
    offers = {o.part: o for o in result.created}
    return {
        "dsp": dsp,
        "owner": owner,
        "van": van,
        "defects": {"tail": tail, "mirror": mirror, "bumper": bumper},
        "offers": offers,
        "shop_a": shop_a,
        "admin_a": admin_a,
        "shop_b": shop_b,
        "admin_b": admin_b,
        "body": body,
        "admin_body": admin_body,
    }
