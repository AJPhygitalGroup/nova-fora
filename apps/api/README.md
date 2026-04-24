# Nova Fora API

FastAPI backend. Python 3.12 + SQLModel + Alembic + PostgreSQL + Redis.

## Arranque rápido (Docker — recomendado)

Desde la raíz del repo (`nova-fora/`):

```bash
docker compose -f docker-compose.dev.yml up --build
```

Servicios que levantan:

| Servicio | URL | Para qué |
|---|---|---|
| API | http://localhost:8000 | FastAPI |
| Docs interactivos | http://localhost:8000/docs | Swagger UI |
| Health | http://localhost:8000/health | Liveness |
| Ready | http://localhost:8000/health/ready | DB + Redis check |
| PostgreSQL | localhost:5432 | DB (user `nova` / pass `dev_pass` / db `nova`) |
| Redis | localhost:6379 | Cache + pub/sub |
| MinIO API | http://localhost:9000 | S3 compatible |
| MinIO Console | http://localhost:9001 | UI (minioadmin / minioadmin) |

**Hot reload:** cambios en `apps/api/app/` se recargan automáticamente (`uvicorn --reload`).

## Arranque sin Docker (opcional — requiere Python 3.12)

```bash
# 1. Instalar uv (package manager rápido)
curl -LsSf https://astral.sh/uv/install.sh | sh
# Windows PowerShell: irm https://astral.sh/uv/install.ps1 | iex

# 2. Instalar deps
cd apps/api
uv sync

# 3. Levantar solo Postgres + Redis con Docker
docker compose -f ../../docker-compose.dev.yml up postgres redis -d

# 4. Copiar .env
cp ../../.env.example .env

# 5. Correr la API
uv run uvicorn app.main:app --reload
```

## Estructura

```
apps/api/
├── pyproject.toml              # deps + config (uv)
├── Dockerfile                  # multi-stage prod build
├── entrypoint.sh               # prod entrypoint (migrations + uvicorn)
├── .dockerignore
├── alembic.ini                 # (se añade en Semana 3 del sprint)
├── migrations/                 # (se añade en Semana 3 del sprint)
└── app/
    ├── main.py                 # FastAPI app + CORS + routes
    ├── settings.py             # Pydantic Settings (env vars)
    ├── db.py                   # SQLAlchemy async engine + session
    ├── models/                 # SQLModel tables (Organization, User, Vehicle...)
    ├── schemas/                # Pydantic request/response schemas
    └── routes/                 # API endpoints
        └── health.py           # /health, /health/ready
```

## Verificación manual

```bash
curl http://localhost:8000/health
# → {"status":"ok","env":"development"}

curl http://localhost:8000/health/ready
# → {"status":"ok","db":"ok","redis":"ok"}

curl http://localhost:8000/
# → {"name":"Nova Fora API","version":"0.1.0",...}
```

## Tests

```bash
docker compose -f ../../docker-compose.dev.yml exec api uv run pytest
# o fuera de Docker:
uv run pytest
```

## Lint + format

```bash
uv run ruff check .
uv run ruff format .
```

## Parar todo

```bash
docker compose -f docker-compose.dev.yml down           # mantiene volumes
docker compose -f docker-compose.dev.yml down -v        # borra DB también
```

## Próximos pasos (Semana 2-3 del sprint)

1. Añadir modelos SQLModel en `app/models/` — Organization, User, Vehicle...
2. Configurar Alembic (`uv run alembic init migrations`)
3. Primera migración (`uv run alembic revision --autogenerate -m "initial"`)
4. Endpoints de auth JWT en `app/routes/auth.py`
