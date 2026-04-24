# syntax=docker/dockerfile:1.7
# Multi-stage build for Nova Fora API — target < 300 MB final image.

# ─────────────────────────────────────────────────────
# Stage 1: builder — install deps with uv
# ─────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Install uv (fast Python package manager)
RUN pip install --no-cache-dir uv

WORKDIR /app

# Copy dependency files first — maximizes Docker layer cache hit rate
COPY pyproject.toml uv.lock* ./

# Install deps into .venv (lockfile generated on first run if not present)
RUN uv sync --no-dev --no-install-project

# Copy source
COPY . .

# Install the project itself
RUN uv sync --no-dev


# ─────────────────────────────────────────────────────
# Stage 2: runtime — minimal image
# ─────────────────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

# curl for healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app /app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["sh", "entrypoint.sh"]
