"""Health check endpoints — /health (liveness) and /health/ready (readiness)."""
import redis.asyncio as redis
from fastapi import APIRouter, Response, status
from pydantic import BaseModel

from app.db import check_db
from app.settings import get_settings

router = APIRouter(tags=["health"])
settings = get_settings()


class HealthResponse(BaseModel):
    status: str
    env: str


class ReadyResponse(BaseModel):
    status: str
    db: str
    redis: str


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness probe — 200 if the process is running. EasyPanel uses this."""
    return HealthResponse(status="ok", env=settings.env)


async def _check_redis() -> bool:
    try:
        r = redis.from_url(settings.redis_url)
        await r.ping()
        await r.aclose()
        return True
    except Exception:
        return False


@router.get("/health/ready", response_model=ReadyResponse)
async def ready(response: Response) -> ReadyResponse:
    """Readiness probe — 200 if DB + Redis respond, 503 otherwise."""
    db_ok = await check_db()
    redis_ok = await _check_redis()

    if not (db_ok and redis_ok):
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return ReadyResponse(
        status="ok" if (db_ok and redis_ok) else "degraded",
        db="ok" if db_ok else "fail",
        redis="ok" if redis_ok else "fail",
    )
