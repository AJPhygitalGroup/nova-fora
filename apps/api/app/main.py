"""FastAPI application entry point."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import (
    auth,
    defect_catalog,
    defects,
    defects_v2,
    directory,
    dvic_template,
    health,
    inspections,
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
app.include_router(vehicles.router)
app.include_router(inspections.router)
app.include_router(defects.router)
app.include_router(defects_v2.router)
app.include_router(defect_catalog.router)
app.include_router(dvic_template.router)
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
