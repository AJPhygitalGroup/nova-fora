#!/bin/sh
# Production entrypoint — runs migrations, then starts uvicorn.
# docker-compose.dev.yml overrides this with --reload for hot reload.
set -e

# Alembic migrations (uncomment when alembic is configured — Semana 3 of sprint)
# echo "[entrypoint] running migrations..."
# python -m alembic upgrade head

echo "[entrypoint] starting uvicorn on :8000"
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 2 \
    --proxy-headers \
    --forwarded-allow-ips='*'
