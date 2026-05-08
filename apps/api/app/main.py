"""FastAPI application entry point."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import (
    auth,
    defect_catalog,
    defects,
    directory,
    dvic_template,
    health,
    inspection_rules,
    inspections,
    invitations,
    uploads,
    vehicles,
    work_orders,
)
from app.settings import get_settings
from app.storage import ensure_bucket

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run once at startup / shutdown."""
    print(f"[nova-api] starting (env={settings.env})")
    print(f"[nova-api] frontend allowed origin: {settings.app_url}")

    # Ensure the S3/MinIO bucket exists + has CORS applied. Non-fatal: if
    # MinIO isn't reachable yet (first deploy), we log but keep booting so
    # /health stays up. Photo endpoints will error on demand instead.
    try:
        ensure_bucket()
    except Exception as e:  # noqa: BLE001
        print(f"[nova-api] WARN: ensure_bucket() failed: {e}")

    # Re-sync the V2.2 defect catalog (defect_rule + defect_applicability +
    # defect_part_system + part_group_default) on every boot. Idempotent
    # UPSERT — safe to re-run. Wrapped in try/except so a transient DB
    # hiccup doesn't block boot.
    #
    # Set SKIP_BOOT_SEED=1 to opt out (e.g. one-off debug shell).
    if not settings.skip_boot_seed:
        try:
            from app.cli import cmd_seed_defect_catalog, cmd_seed_dvic_template
            print("[nova-api] re-syncing defect catalog…")
            await cmd_seed_defect_catalog()
            print("[nova-api] re-syncing DVIC template…")
            await cmd_seed_dvic_template()
        except Exception as e:  # noqa: BLE001
            print(f"[nova-api] WARN: catalog re-sync failed: {e}")

    yield
    print("[nova-api] shutting down")


app = FastAPI(
    title="Nova Fora API",
    description="Backend API for Nova Fora fleet management platform.",
    version="0.1.0",
    lifespan=lifespan,
    # Hide the default `/openapi.json` docs routes in prod (optional — toggle via env later)
    docs_url="/docs",
    redoc_url=None,
)

# ── CORS ──────────────────────────────────────────────
# Origins come from env var CORS_ORIGINS (comma-separated). If empty,
# fall back to [app_url, localhost:5173, localhost:5174] — useful for dev.
def _cors_origins() -> list[str]:
    raw = settings.cors_origins.strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return [
        settings.app_url,
        "http://localhost:5173",  # Vite default
        "http://localhost:5174",  # Vite fallback
    ]


_allowed_origins = _cors_origins()
print(f"[nova-api] CORS allowed origins: {_allowed_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ────────────────────────────────────────────
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(invitations.router)
app.include_router(vehicles.router)
app.include_router(inspections.router)
app.include_router(defects.router)
app.include_router(defect_catalog.router)
app.include_router(dvic_template.router)
app.include_router(inspection_rules.router)
app.include_router(work_orders.router)
app.include_router(directory.router)
app.include_router(uploads.router)


@app.get("/", tags=["root"])
async def root() -> dict:
    """Root route — just a sanity check."""
    return {
        "name": "Nova Fora API",
        "version": "0.1.0",
        "env": settings.env,
        "docs": "/docs",
        "health": "/health",
    }
