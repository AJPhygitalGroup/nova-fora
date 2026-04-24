"""FastAPI application entry point."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import auth, health
from app.settings import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run once at startup / shutdown."""
    print(f"[nova-api] starting (env={settings.env})")
    print(f"[nova-api] frontend allowed origin: {settings.app_url}")
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
# In dev, allow the Vite frontend. In prod, set APP_URL to your real frontend origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.app_url,
        "http://localhost:5173",  # Vite default
        "http://localhost:5174",  # Vite fallback
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ────────────────────────────────────────────
app.include_router(health.router)
app.include_router(auth.router)


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
