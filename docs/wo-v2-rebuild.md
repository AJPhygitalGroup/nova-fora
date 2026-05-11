# Work Order V2.0 — Rebuild Plan (Nova Fora)

**Branch:** `wo-v2-rebuild`
**Started:** 2026-05-11
**Spec source:** [Notion — Work Order Schema V2.0 (Current Spec)](https://www.notion.so/Work-Order-Schema-V2-0-Current-Spec-359f04c9cacc81dc942fc5c2fd87f649)
**Companion:** [Notion — Logic Map](https://www.notion.so/359f04c9cacc81efa1cbc4cd1c45a5b6) · [QC Inspection → Repair Walkthrough](https://www.notion.so/358f04c9cacc815d83b1fef4c6b8b9a9)

This file is the **single source of progress** for the V2.0 rebuild. It bridges between the canonical Notion spec and the live code. When code lands, check off the box. When a contract gets a product decision, append to the Decision Log.

---

## Adaptations from spec to Nova Fora

These are the divergences from the canonical Notion spec, agreed before starting:

| Spec assumption | Nova Fora adaptation | Why |
|---|---|---|
| Postgres schema `work_orders.*` and `defects.*` (cross-schema FKs) | **Flat `public` schema** for everything | One-schema codebase; the Postgres-side namespacing isn't worth the migration churn for a demo at this stage |
| User identity as `text 'nova_user:42'` (interim) | **`int` FKs to `users.id` directly** from day 1 | We already have `users.id`; skip the text intermediate phase entirely |
| Full surface including cost approval, variance reapproval, billing split, Stripe | **v2.0 active surface only** (per spec §7 ✓ rows) | Cost approval / variance reapproval / AMR-CMR split / Stripe are explicitly deferred in the spec; their enum values stay dormant |
| 16 `public.v_wo_*` views (PostgREST-facing) | **Skip the views** | Nova Fora exposes data via FastAPI routes, not PostgREST. The views are redundant |
| `customer_org_name text` (denormalized, no FK) | **`dsp_id int REFERENCES organizations(id)`** | We already have the master `organizations` table; use it directly |
| `work_orders.vendors` (workshop catalog) | New table **`vendor_workshops`** in `public` | Distinct from `organizations.org_type=vendor` (the tenant) — workshop catalog has its own attributes (`status_tracking_mode`, `repair_types[]`) |
| V1 `work_orders` / `work_order_items` data preservation | **WIPE + REBUILD** | Demo only — no production data to lose. Migration drops V1 tables, creates V2.0 from scratch |

## What we are NOT building (deferred — schema captures, app ignores)

Per the spec's "v2.0 active surface vs deferred surface" table:

- ❌ Cost-approval ping flow (`pending_cost_approval` enum value stays in schema; never used)
- ❌ Variance reapproval flow (variance is **log-only** in `activity_log`; line item goes directly to `done`)
- ❌ Customer AMR/CMR billing split in UI
- ❌ Stripe invoicing at WO close
- ❌ `customer_settings.cmr_auto_approve_threshold` consumption (the field exists, app skips the threshold check)

**Three concrete v2.0 behavior adjustments** (from spec §7):

1. Line item initial status is **always `pending`** — no cost-approval gating.
2. **Bulk auto-linkage**: when a `defect_repair` line item is created, app links it to **every** `defect_resolution` on the WO. Imprecise but satisfies the completion trigger.
3. **Variance is log-only**: write `activity_log(action='variance_breached')`, line item goes to `done` regardless.

---

## Target tables (14)

All in `public` schema. Adapted from spec §3.

| Table | Purpose | Notes |
|---|---|---|
| `vendor_workshops` | Per-shop catalog (the spec's `vendors`) | Has `status_tracking_mode`, `repair_types[]`, `is_active` |
| `dsp_settings` | Per-DSP config (the spec's `customer_settings`) | Keyed by `dsp_id` not text; defaults: review_sla=24h, bundling_window=30min, variance=10% |
| `repair_requests` | Bundles defects per `(vehicle, repair_type)` within bundling window | Status: `open/accepted/cancelled/fulfilled/stale` |
| `repair_request_defects` | M:N RR ↔ Defect | PK is the pair |
| `work_orders` | Rebuilt — different shape than V1 | Status: `pending_acceptance/accepted/in_progress/completed/cancelled/declined` |
| `work_order_ros` | RO numbers from vendor POS | Partial UNIQUE on `(work_order_id) WHERE is_primary` |
| `defect_resolutions` | Junction WO ↔ Defect with own status machine | Status follows linked line items |
| `work_order_line_items` | Actual work units (spec's `line_items`) | Category + billing_type + estimated/final price; external sync via `(external_source, external_id)` partial UNIQUE |
| `work_order_line_item_resolutions` | M:N line_item ↔ defect_resolution | Spec's `line_item_defect_resolutions` |
| `work_order_notes` | Threaded notes | `author_role` enum (customer/vendor_service_writer/technician/admin/system) |
| `work_order_photos` | Photos with stage enum | Stages: submission/completion/rejection/vehicle_arrival/key_placement/parking_spot/general |
| `decline_reason_codes` | Lookup for structured decline reasons | 8 seed codes (parts_unavailable, specialty_required, capacity_full, customer_unreachable, cost_too_high, safety_concern, out_of_warranty, other) |
| `wo_activity_log` | Audit log (spec's `activity_log`) | `entity_type` CHECK allowlist; `details` jsonb |
| `defect_reviews` | Scope-approval audit | `decision: approved/rejected`, `decision_method: manual/auto_preauth_group/auto_threshold` |

## Target enums (9)

| Enum | Values |
|---|---|
| `repair_type` | mechanical, body, tires, pm, cnmr, detailing, netradyne |
| `status_tracking_mode` | external, internal |
| `repair_request_status` | open, accepted, cancelled, fulfilled, stale |
| `work_order_status_v2` | pending_acceptance, accepted, in_progress, completed, cancelled, declined |
| `line_item_category` | defect_repair, customer_request, vendor_addition, recall, overhead, uncategorized |
| `line_item_billing_type` | amr, cmr |
| `line_item_status` | pending_scope_approval, pending_cost_approval, pending, pending_variance_reapproval, done, deferred, declined |
| `defect_resolution_status` | pending, in_progress, resolved, deferred, declined |
| `note_author_role` | customer, vendor_service_writer, technician, admin, system |

Stored as `VARCHAR(length=30)` (`native_enum=False`), per the Nova Fora convention from `CLAUDE.md` §3.2.

## Target triggers (3 we keep — the spec has 7 but 5 are `updated_at` setters which SQLAlchemy handles)

| Trigger | Fires on | Purpose |
|---|---|---|
| `set_updated_at` | BEFORE UPDATE on 5 tables | Auto-fill `updated_at` (handled by SQLAlchemy event listener, no DB trigger needed) |
| `assert_defect_repair_links_on_complete` | BEFORE UPDATE on `work_orders` | Refuses to mark `completed` if any `defect_repair` line item lacks a defect_resolution link |
| `assert_external_mode_ro_present` | BEFORE UPDATE on `work_orders` | Refuses to mark `accepted` for external-mode vendor if no RO is attached |

**Decision:** the two assertion triggers go in the Alembic migration as raw SQL. The 5 updated_at triggers are replaced by a SQLAlchemy `@event.listens_for(..., 'before_update')` registered in `models/base.py`.

---

## Execution plan — 7 PRs

Each PR is a self-contained commit on this branch. We merge to `main` only after PR 7 lands and the demo flow is end-to-end verified.

### PR 1 — Migration (drop V1 + create V2.0)
- Alembic revision `wo_v2_rebuild`
- DROP `work_orders` (V1), DROP `work_order_items`
- CREATE 14 new tables + 9 enums (as `VARCHAR`) + 2 assertion triggers
- Seed `decline_reason_codes` (8 rows)
- Status: **TODO**

### PR 2 — SQLModels
- New folder `app/models/work_orders/` with one file per table
- Export all in `models/__init__.py` so Alembic autogenerate sees them
- `@event.listens_for(..., 'before_update')` for `updated_at` setting
- Status: **TODO**

### PR 3 — Service layer
- `services/bundler.py` — async worker watching approved defects, creating RRs after bundling window
- `services/wo_router.py` — first-match vendor routing
- `services/line_items.py` — generator at vendor acceptance + bulk auto-linkage
- `services/activity_log.py` — writer used by every status transition
- `services/defect_reviews.py` — auto-approve via preauth groups, manual via UI
- Status: **TODO**

### PR 4 — API routes
- `routes/repair_requests.py` (list/get/create/accept/cancel)
- `routes/work_orders.py` — rebuilt for V2.0
- `routes/vendor_workshops.py`
- `routes/dsp_settings.py`
- `routes/defect_reviews.py` (the review queue + per-defect approve/reject)
- All routes pass `lang` for i18n errors (per Phase 6)
- Status: **TODO**

### PR 5 — Seed
- `cli.py` new commands `seed-vendor-workshops`, `seed-dsp-settings`, `seed-decline-codes`
- Repopulate Safety First LLC demo (Jon Doe) with realistic V2.0 data
- Status: **TODO**

### PR 6 — Frontend client wiring
- `src/api/client.js` — new endpoint helpers for the new routes
- `src/data/mockData.js` — shapes aligned with V2.0 responses
- Status: **TODO**

### PR 7 — `WorkOrders.jsx` adaptation
- Vendor inbox grouping by `(vendor_id, vehicle_id, repair_type)`
- Customer view roll-up by vehicle
- Line item UI (category badges, billing type, prices, status pills)
- RO management (add/edit, primary toggle)
- Defect review queue surface (new tab in AdminPanel)
- Status: **TODO**

---

## Decision Log

Append-only. Date each entry.

### 2026-05-11 — Initial decisions
- (1a) Wipe V1 data, no migration of `work_orders`/`work_order_items`
- (2b) Flat `public` schema, no cross-schema namespacing
- (3b) Int FKs to `users.id` directly, skip `'nova_user:42'` text convention
- (4a) v2.0 active surface only; cost approval / variance reapproval / AMR-CMR split / Stripe deferred
- (5) Slack driver-bot project paused until V2.0 lands
- (6b) Feature branch `wo-v2-rebuild`; `main` stays V1-functional

---

## Open TBDs (carried from spec §10)

These don't block v2.0 ship but we should make a call before v2.x:

- Vendor preference ranking (replace first-match routing)
- Subcontracted work (V1's `original_work_order_id`)
- Post-acceptance hard-reject (vendor accepts then mid-work can't do specific defect)
- Customer declines variance reapproval (when v2.x lights variance up)
- Billing assignment for `vendor_addition` and `recall` (default `cmr` for now)
- Auto-ping cadence for cost approvals (when v2.x lights cost approval up)
- `is_stale` threshold + owning process
- Activity log retention / partitioning
