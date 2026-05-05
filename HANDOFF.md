# Nova Fora — Project Handoff

> Drop-in briefing for picking up Nova Fora work in a new dev environment
> (different machine, fresh Claude session, new contributor). Read this
> first, then `CLAUDE.md`, then `git log --oneline -20`.

---

## TL;DR

Fleet-inspection SaaS for Amazon DSP fleets. The product replaces paper
DVIRs with a mobile-first wizard that records defects with photos +
GPS + odometer, then routes them to vendors via work orders.

- **Production frontend:** https://nova-fora-web.vamj8y.easypanel.host
- **Production API:** https://nova-fora-api.vamj8y.easypanel.host
- **Repo:** https://github.com/AJPhygitalGroup/nova-fora
- **Hosting:** Hostinger VPS + EasyPanel + Docker Swarm + Traefik + Let's Encrypt
- **Auto-deploy:** push to `main` → EasyPanel rebuilds + redeploys both services
- **Test environment deadline:** June 15, 2026 (UAT-ready at `test.nova4a.com`)

---

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Backend | FastAPI + SQLModel + Alembic + asyncpg | Python 3.12 |
| Database | PostgreSQL 17 | + Redis 7 + MinIO (S3-compatible) |
| Frontend | React 19 + Vite 8 + Tailwind 4 | JSX (no TS) + Framer Motion + Lucide |
| Auth | JWT Bearer with auto-refresh | `Authorization: Bearer …` |
| Live updates | Server-Sent Events | `apps/api/app/services/pubsub.py` |
| Photos | Presigned PUT direct to MinIO | Browser → MinIO; metadata → API |

---

## Recent state (already in production)

Working features as of this handoff:

- **DVIC catalog complete** — 87 rows transcribed from the Apr 2026 Amazon
  Cargo + DOT DVIR PDFs. 5 asset types (`extra_large_cargo_van`,
  `large_cargo_van`, `step_van_medium`, `step_van_large`, `electric_delivery_vehicle`).
- **Inspection wizard, 6 steps:** DSP picker → keys recorder → vehicle
  picker (with status badges) → start-or-skip gate (3-reason "Vehicle not
  inspected" fast-path) → odometer → defects hub.
- **DvicWizard hub + 7-step defect flow:** section → item → position →
  sub-position → details → review → **photo gate (mandatory)**. Auto-advance
  on every single-select tap (no Next button between picker steps).
- **Mandatory photos:** per-defect (photo gate, server-side rollback via
  `DELETE /defects/{id}` if user backs out) + odometer (blocks step 5 →
  step 6 transition until both mileage and photo land).
- **Vehicle picker badges:** ✓ Inspected / ⚠ Flagged · N / ⛔ Not inspected
  · {reason}. Sorted un-inspected → done. Progress strip on top.
- **Defects page:** Bulk Convert (multi-select → 1 WO with N items, same-van
  guard) + Bulk Reject (any vans) + Status filter row (Logged / Repair
  Ordered / Scheduled / Rejected / Open).
- **Work Orders:** state machine (Pending → In Progress → Completed) with
  role gates, technician assignment, decline + subcontract paths.
- **Auto-seed on boot:** API lifespan re-runs `seed-defect-catalog` and
  `seed-dvic-template` on every container start. Idempotent UPSERT +
  orphan deactivation. No `docker exec` needed after deploys.

**Demo persona:** Jon Doe (DSP_OWNER) at Safety First LLC (DSP-0004).
Email: `jon@safetyfirst.com`.

---

## Pending work (priority order for June 15)

### 🚨 Currently being scoped (next up)

These are flagged but not yet specced out — the user will describe details
in the next session.

- [ ] **Defect data schema changes** — pending detailed spec from product.
  Will likely touch `apps/api/app/models/defect.py`,
  `apps/api/app/models/defect_catalog.py`, the Defect schemas in
  `apps/api/app/schemas/`, and possibly require an Alembic migration.
  Coordinate with the catalog auto-coverage block in
  `seed_defect_catalog.py` so allow-list stays in sync.

- [ ] **Inspection process bug fixes** — pending bug list from field
  testing. Touch points likely:
  - `nova-fora-demo/src/components/CreateInspectionWizard.jsx` (7-step parent flow)
  - `nova-fora-demo/src/components/DvicWizard.jsx` (7-step defect flow)
  - `apps/api/app/routes/inspections.py` (DRAFT → SUBMITTED transitions)
  - `apps/api/app/services/defect_validation.py` (catalog allow-list)

### High priority (Sprint 2 + Sprint 8 debt)

1. **i18n EN/ES** — contractually required from day 1, never shipped.
   Need `react-i18next` integrated, `en.json` / `es.json` resource files,
   user language preference in DB, language picker in header.
2. **`test.nova4a.com` custom domain + HTTP basic auth** — currently on
   the EasyPanel default URL. Pilot UAT can't start until this is live.
3. **Sentry + log aggregation** — bug bash doesn't scale without it.

### Medium priority

4. **Bulk Vehicle CSV upload with delta preview** — fixes v1's silent
   destructive sync. Modal: "These N vehicles will be deactivated — confirm?"
5. **2FA TOTP** in `/admin/security`.
6. **Start a Quote backend** — `POST /body-quote` + `quote_requests` table.
   Frontend modal already exists; missing persistence.
7. **Group Discount Pooling** (0% / 5% / 8% / 12% / 15% tiers).

### Lower priority

8. **DA Rewards data wiring** — `Rewards.jsx` exists with mock data;
   wire to `/api/da-rewards`.
9. **Edit Vehicle modal** — full-form modal (replaces the per-field
   pencil anti-pattern from v1).
10. **Custom Defects builder** (DSP-side admin).
11. **UAT documentation** — role guide, v1→v2 changelog, instructions.

---

## Conventions (don't break these)

Full details in `CLAUDE.md`. The non-negotiables:

- **String-prefixed IDs everywhere on the wire**: `VAN-XXXX`, `WO-XXXXX`,
  `FD-XXX`, `DSP-XXXX`, `V-XXX`, `INS-XXXXX`, `DEF-XXXXXX`. The backing
  column is an integer; the API converts both ways.
- **Enums as VARCHAR**: `sa.Enum(MyEnum, native_enum=False)` so adding
  values doesn't require an `ALTER TYPE` migration.
- **Timestamps as `TIMESTAMPTZ`** (timezone-aware UTC).
- **Snake-case wire / camelCase JS** — API responds snake_case;
  `keysToCamel` in `nova-fora-demo/src/api/client.js` converts on read.
  `camelToSnake` converts on write.
- **Multi-tenant isolation** — every query filters by `dsp_id` /
  `vendor_id` / `organization_id`. The `get_current_user` dependency
  enforces role-scoped access on all routes.
- **Photos** — never stream through the API. Presigned PUT direct to
  MinIO, then commit metadata via `/defects/{id}/photos` or
  `/inspections/{id}/photos`. See `PhotoUploader.jsx` for the canonical
  client-side flow.
- **Catalog allow-list** — every `(part, defect_type)` combo must exist
  in `defect_details_schema`, otherwise the validator rejects with
  `"defect_type X is not allowed on part Y"`. The auto-coverage block at
  the bottom of `seed_defect_catalog.py` derives missing rows from the
  DVIC template — keeps the two seeds in sync automatically.

---

## Setup on a new machine

```bash
# Prereqs: Node 20+, Python 3.12+, Git

# 1. Clone
git clone https://github.com/AJPhygitalGroup/nova-fora.git
cd nova-fora
git pull origin main

# 2. Frontend
cd nova-fora-demo
npm install

# Point at the production API while developing the UI:
echo "VITE_API_BASE_URL=https://nova-fora-api.vamj8y.easypanel.host" > .env.local

npm run dev   # http://localhost:5173

# 3. Backend (only if you're touching API code — frontend dev can skip this)
cd ../apps/api
python3.12 -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Required env vars (DATABASE_URL etc.) — copy from your prod EasyPanel
# config or stand up local Postgres + MinIO + Redis with docker-compose.

uvicorn app.main:app --reload --port 8000
```

---

## Source of truth pointers

Files to read in order when picking up the project:

1. `CLAUDE.md` — project conventions, the "house rules"
2. `HANDOFF.md` — this file (recent state + pending work)
3. `git log --oneline -20` — last 20 commits show trajectory
4. `apps/api/app/main.py` — FastAPI entry point + lifespan
5. `apps/api/app/models/defect_catalog.py` — DVIC + catalog data model
6. `apps/api/app/seed_dvic_template.py` — 87-row DVIC transcription
7. `apps/api/app/seed_defect_catalog.py` — allow-list with auto-coverage
8. `nova-fora-demo/src/App.jsx` — React entry point
9. `nova-fora-demo/src/components/CreateInspectionWizard.jsx` — 6-step
   inspection flow (DSP → keys → vehicle → start-gate → odometer → defects)
10. `nova-fora-demo/src/components/DvicWizard.jsx` — 7-step defect flow
    (section → item → position → sub-position → details → review → photo)
11. `nova-fora-demo/src/api/client.js` — single API client with all endpoints

---

## Verification checklist after clone

Run these locally to confirm everything is wired correctly:

```bash
# Last commit should be a3e2826 or later
git log --oneline -1

# Frontend builds clean
cd nova-fora-demo && npm run build

# Catalog seed loads without errors (no DB required for this check)
cd apps/api && python -c "
from app.seed_defect_catalog import DETAILS_SCHEMA_ROWS
from app.seed_dvic_template import DVIC_ROWS
print(f'DVIC rows:    {len(DVIC_ROWS)}')      # expect 87
print(f'Catalog rows: {len(DETAILS_SCHEMA_ROWS)}')  # expect 394+
"

# Production API health check
curl https://nova-fora-api.vamj8y.easypanel.host/health
# expect: {"status":"ok"}
```

If any of these fail, something is off — flag it before continuing.

---

## Key recent commits (newest first)

```
a3e2826  Mandatory photo gates: per-defect + odometer
f18a4ca  Dedup SIDE_VIEW_CAMERA + auto-deactivate orphan DVIC rows on re-seed
89dd20d  DVIC catalog edits: turn signal 2-axis · license plate split · state inspection tag
93c1db4  Auto-advance on item / position / sub-position taps
ce3a9de  DvicWizard becomes the defects hub + Complete Inspection submits
9295403  Show inspection status badges on vehicle picker cards
428cba0  Add Start-or-Skip gate before odometer in inspection wizard
b52fe66  Auto-seed defect catalog + DVIC template on every API boot
a87508e  Fix DVIC catalog gaps + auto-derive coverage
e2fe70f  Add Status filter row to TodaysDefectsTable
3595d6b  Add Bulk Reject companion to Bulk Convert
768e653  Add bulk-convert defects → single work order flow
```

---

## How to start a new Claude session for this project

After cloning to the new machine, open Claude Code in the repo root
(`cd nova-fora`). Your first message can be as short as:

> "Read `HANDOFF.md` and `CLAUDE.md`, then check the last 10 commits.
> My next task is: [DESCRIBE TASK HERE]."

The agent will have everything it needs.

---

*Last updated: see `git log -1 -- HANDOFF.md`.*
