#!/bin/sh
# Production entrypoint — runs migrations, then starts uvicorn.
# docker-compose.dev.yml overrides this with --reload for hot reload.
set -e

# Alembic migrations. Docker Swarm can run multiple replicas simultaneously;
# Alembic's default behavior is safe here because Postgres acquires a table
# lock during DDL. Worst case: replicas race, one wins, others see "already
# applied" and continue. If we scale to >2 replicas later, add advisory lock.
echo "[entrypoint] running alembic migrations..."
python -m alembic upgrade head

echo "[entrypoint] starting uvicorn on :8000"
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 2 \
    --proxy-headers \
    --forwarded-allow-ips='*'
