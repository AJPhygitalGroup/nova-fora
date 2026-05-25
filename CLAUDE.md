# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

Monorepo with two deployables:

- `apps/api/` — FastAPI backend (Python 3.12, SQLModel, Alembic, async SQLAlchemy on PostgreSQL, Redis, S3/MinIO).
- `nova-fora-demo/` — React 19 + Vite 8 + Tailwind 4 frontend (plain JSX, no TypeScript). **The backend adapts to this frontend, not the other way around.**

`nova4a-rebuild-plan.md` is the master 2000+ line spec — phases, prompts, sprint calendar through Jun 15, 2026 launch. `docs/deploy-state.md` tracks what is live in production. `README.md` (root) is the high-level intro to those docs.

## Common commands

### Full dev stack (recommended)

```bash
docker compose -f docker-compose.dev.yml up --build
# API at :8000, Postgres :5432, Redis :6379, MinIO :9000 (console :9001)
# Hot reload mounts apps/api/app/ — Python edits refresh automatically.
```

### Backend without Docker

```bash
cd apps/api
uv sync                                       # install deps (uv replaces pip)
docker compose -f ../../docker-compose.dev.yml up postgres redis -d
cp ../../.env.example .env
uv run uvicorn app.main:app --reload
```

### Backend operations

```bash
# Lint + format (ruff is the only linter/formatter)
cd apps/api && uv run ruff check . && uv run ruff format .

# Tests
cd apps/api && uv run pytest
cd apps/api && uv run pytest path/to/test.py::test_name   # single test
# Or inside docker: docker compose -f docker-compose.dev.yml exec api uv run pytest

# Migrations (autogenerate reads SQLModel.metadata via app/models/__init__.py)
cd apps/api && uv run alembic revision --autogenerate -m "describe change"
cd apps/api && uv run alembic upgrade head
cd apps/api && uv run alembic downgrade -1

# Seed data + admin tasks (run via docker exec on the api service or uv run locally)
python -m app.cli seed                        # 3 demo orgs + 4 demo users (password: nova2026!)
python -m app.cli seed-vehicles               # 8 Ribrell 21 vans
python -m app.cli seed-inspections            # 8 historical inspections
python -m app.cli seed-defect-catalog         # v2 defect schema reference tables
python -m app.cli seed-dvic-template          # DVIC template items from Amazon PDFs
python -m app.cli reset-password <email> <new_password>
```

The prod entrypoint (`apps/api/entrypoint.sh`) runs `alembic upgrade head` before uvicorn — local hot-reload dev does not, so run migrations explicitly after pulling.

### Frontend

```bash
cd nova-fora-demo
npm install
npm run dev                                    # Vite dev server (default :5173)
npm run build
npm run lint                                   # eslint (flat config in eslint.config.js)
```

`VITE_API_BASE_URL` (build-time) points the client at the API. Defaults to `http://localhost:8000`. Set in `nova-fora-demo/.env.local` for dev.

## Architecture

### Backend (`apps/api/app/`)

- `main.py` — FastAPI app + CORS + router wiring. `lifespan()` calls `ensure_bucket()` (S3/MinIO bootstrap) on startup and is non-fatal so `/health` stays up if MinIO is unreachable.
- `settings.py` — Pydantic `Settings` (env-driven, cached via `lru_cache`). Notably `s3_endpoint` (internal, in-network) vs `s3_public_endpoint` (signs presigned URLs the browser will hit).
- `db.py` — async SQLAlchemy engine, `AsyncSessionLocal`, `get_session` FastAPI dep, `check_db()` health probe.
- `models/` — one SQLModel per domain entity. **All models must be re-exported in `models/__init__.py`** or Alembic autogenerate will silently miss them.
- `schemas/` — Pydantic request/response shapes (separate from models so DB shape can evolve independently).
- `routes/` — endpoint groups (one router per file, mounted in `main.py`).
- `auth/` — `jwt.py` (HS256 access + refresh tokens), `dependencies.py` (`get_current_user`, `require_role(*roles)`), `hashing.py` (direct bcrypt; passlib was incompatible with bcrypt 4+).
- `services/` — business logic that doesn't belong in routes.
- `storage/s3.py` — boto3 S3/MinIO client. Two cached clients: internal (bucket lifecycle) and public (presigning). Browser uploads via presigned PUT → backend records metadata.
- `cli.py`, `seed_defect_catalog.py`, `seed_dvic_template.py`, `defect_labels.py` — seed + admin tooling, run with `python -m app.cli <subcommand>`.
- `alembic/` — migrations, env wired to read `DATABASE_URL` from `app.settings` (not `alembic.ini`) and import `app.models.*` so autogenerate sees every table.

Domain (read `nova4a-rebuild-plan.md` Sec 3.2 for the full model):
- `Organization` (`OrgType`: `dsp` / `vendor` / `platform`) → `User` (`UserRole`: `dsp_owner` / `vendor_admin` / `technician` / `site_admin`)
- `Vehicle` belongs to a DSP; `asset_type` (`AssetType` enum) selects which DVIC template to load
- `Inspection` → `ReportedDefect` (1:N). Defect lifecycle: pending → acknowledged → sent_to_vendor → scheduled → converted_to_wo (or dismissed)
- `WorkOrder` → `WorkOrderItem` (M:N to defects, with UNIQUE(defect_id) so a defect lives in at most one WO). Lifecycle: pending → acknowledged → scheduled → in_progress → completed (plus declined / canceled). **Superseded for new work by `app/models/work_orders/` (WO V2 — see below).**

### WO V2 (iter-1)

Active schema for all new work-order code paths. Spec: [Notion — Work Order Schema V2.0 — Updated Spec (post-John meeting)](https://www.notion.so/Work-Order-Schema-V2-0-Updated-Spec-post-John-meeting-380f04c9cacc811398d0e3f2f3a3f4d5). Models live under `app/models/work_orders/` (14 SQLModel tables, 11 spec-mandated enums + 2 Nova-Fora extensions: `RepairBucket`, `DspWoResponse`).

Entity map: `RepairRequest` (customer's bundled authorization, survives vendor changes via `parent_repair_request_id`) ←→ `RepairRequestDefect` ↔ `Defect` (defects v2.2). One RR can spawn multiple `WorkOrder` rows (one per vendor). Per-WO state: `WorkOrderRo` (vendor RO# + sync timestamps), `DefectResolution` (per-WO defect handling), `DefectReview` (scope + cost approval audit), `WorkOrderNote` (with `channel='internal'|'customer'`), `WorkOrderPhoto` (stage-typed), `WoActivityLog` (append-only audit).

**Iter-1 dormancy markers** — these are in the schema for forward compatibility but **no runtime code reads/writes them**: `StatusTrackingMode`, `WorkOrderLineItem` (entire flow), the `assert_defect_repair_links_on_complete` + `assert_external_mode_ro_present` triggers, `LineItemStatus.pending_cost_approval` + `pending_variance_reapproval`. Cost approval lives at **defect level** in iter-1 — `defects.estimated_cost` + `defects.fmc_capped_at` + `defects.cost_decision` are the gating columns (see migration `20260524_1200_wo_v2_iter1_additions.py`).

**Cross-cutting WO V2 conventions**: pickup is a vehicle-scoped event (one truck trip, update every ready RO on the vehicle in one query). `customer_org_name` and `assigned_technician_name` from the spec are denormalized; Nova Fora uses FK `dsp_id → organizations` and `assigned_technician_id → users` instead (better than spec — listed as TBD in the spec's open-items).
- `DvicTemplateItem` + defect catalog reference tables (`DefectPartSystem`, `DefectPartValidity`, `DefectDetailsSchema`) drive the inspector wizard; updates are seed runs, not migrations
- `Photo` is polymorphic with FKs to inspection / defect / work_order

### Frontend (`nova-fora-demo/src/`)

- `App.jsx` — owns auth bootstrap (calls `/auth/me` on mount if a JWT is in localStorage), theme toggle, impersonation state.
- `api/client.js` — single source of truth for HTTP. Handles JWT bearer, **snake_case → camelCase response transform** via `keysToCamel`, FastAPI 422 array-detail normalization, and one auto-refresh retry on 401.
- `components/` — feature-level views (one big JSX file each: `RealDVIC.jsx`, `WorkOrders.jsx`, `MyVehicles.jsx`, `AdminPanel.jsx`, wizards, etc.). `components/ui/` for shared primitives.
- `data/mockData.js` — canonical reference for the data shapes the components expect (string-prefixed IDs, camelCase keys). When wiring a component to a real endpoint, match these shapes.

### Cross-cutting conventions (read these before changing data shapes)

1. **String IDs with prefixes are load-bearing.** Models expose an `id_str` property — `VAN-0001`, `WO-54001`, `DSP-4201`, `V-005`, `NF-006`, `INS-47330`, `FD-123`, `WOI-0001`. Schemas serialize using `id_str`. Routes accept either the prefixed string or the bare int as path params. Breaking this contract breaks the demo end-to-end.
2. **Enums are stored as VARCHAR**, never as PG native enum types. Use `sa.Enum(MyEnum, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e])` so adding values is a code change, not an `ALTER TYPE` migration.
3. **All timestamps are TIMESTAMPTZ** and tz-aware. Use `timestamp_column("created_at"|"updated_at")` from `app/models/base.py` — there is no TimestampMixin (SQLModel can't share Column instances across tables). For nullable timestamps, declare the `Column` inline with `DateTime(timezone=True)`.
4. **Wire shape: snake_case on the wire, camelCase in JS.** The API returns snake_case; `keysToCamel` in `api/client.js` flips it. When sending params from JS, the helpers in `client.js` map known camelCase keys back to snake_case — extend the param maps when adding new query params.
5. **Frontend params are bidirectional**: GETs mostly camelCase → snake_case via per-call maps, POST/PATCH bodies stay snake_case.
6. **Do not refactor the frontend demo without authorization.** It works. The risk of touching it is losing weeks. Add API wiring in `src/api/client.js` and modify `useEffect` data-fetch calls — leave structure alone (rule from root `README.md`).
7. **Denormalize hot foreign keys.** E.g., `Inspection.dsp_id` is duplicated from `Vehicle.dsp_id` so the "today's inspections for DSP X" query is a single-index scan. `ReportedDefect.reported_by_id` is denorm'd from `Inspection.inspector_id`. Keep them in sync at write time.
8. **Multi-tenant isolation is mandatory.** A vendor must never see another vendor's data. Filter by `dsp_id` / `vendor_id` / `organization_id` at the route or service layer — past bugs leaked via summary cards even when list endpoints scoped correctly.
9. **CORS allowed origins** come from the `CORS_ORIGINS` env (comma-separated). Empty falls back to `[app_url, localhost:5173, localhost:5174]`. Update env, not code, when adding a frontend host.

## Production

Hostinger VPS + EasyPanel (Docker Swarm + Traefik). `main` auto-deploys (~1–3 min). Live URLs and ops commands are in `docs/deploy-state.md`. The Swarm internal DNS uses `nova-fora_postgres`, `nova-fora_redis`, `nova-fora_api` as hostnames — config that points at `localhost:*` will not work in prod.

## Phase / sprint context

The project is mid-sprint toward a Jun 15, 2026 global test (see `nova4a-rebuild-plan.md` Sec 10 and root `README.md`). Phases are strictly ordered (0 → 8); each phase is one atomic PR. Prompts to execute a phase live in Sec 4 of the plan. When the plan and the live code conflict, the live code wins — update the plan after.
