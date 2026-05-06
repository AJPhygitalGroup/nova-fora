# Defect Data Schema V2.2 — Current Spec

> Canonical reference for the `defects` schema as currently deployed in Postgres for **DFS Portal**. Imported into the Nova Fora repo on 2026-05-05 as the source spec we are adapting (Path B — see `nova-fora/HANDOFF.md` and the `project_defect_schema_v2_2.md` memory entry).
>
> **In Nova Fora we are NOT adopting this literally** — we keep VARCHAR enums (`CLAUDE.md` rule #2), public schema, string-prefixed IDs (`FD-XXX`, `INS-XXXXX`, `VAN-XXXX`), and service-layer validation instead of triggers + `pg_jsonschema`. The structural changes we ARE adopting (junction split, source enum, classification, group, vehicle_class taxonomy) come from this document.
>
> Source page in Notion: "Defect Data Schema V2.2 Current Spec" (`353f04c9cacc810c9400ef96bbcdd083`).
> Source code reference (DFS Portal): https://github.com/Mo-BK1/dfs-portal/tree/main/src/app/op-planning

---

Sufficient to rebuild the schema in any Postgres database with the `pg_jsonschema` extension. All counts and enum values were generated against the live DFS Portal database on 2026-05-01.

**Source code (DFS Portal — OP Planning):** github.com/Mo-BK1/dfs-portal/tree/main/src/app/op-planning — the inspector simulator, data-schema browser, defect-rules editor, and RWG rules viewer that drive this schema.

**API routes (server-side):** github.com/Mo-BK1/dfs-portal/tree/main/src/app/api/op-planning

**Replication artifacts**

- `defects_schema_v2.sql` — self-contained 908 KB / 2,440-line SQL file with full DDL + 1,908 reference rows (extension setup, schema, 7 enums, 10 tables, all indexes, 5 triggers, 7 views, all reference data in dependency order). Lives at `/Users/mbk/Documents/Code/DFS/defects_schema_v2.sql` — commit it to the repo or hand it off directly. Run on an empty Postgres 14+ with `pg_jsonschema` and you get a byte-identical replica.

> **Out of scope:** workflow state, severity overrides, photos, work orders, inspection templates. Each gets its own spec or table — this doc only names foreign keys that point at them.

---

## 1. Overview

Tables live in the `defects` Postgres schema. Public-schema views (`v_defect_catalog`, `v_defect_rows`, …) wrap them as text-typed projections so anonymous PostgREST clients without USAGE on `defects` can still read.

### Current DB stats

| Object | Count | Notes |
| --- | --- | --- |
| `defect_part` enum values | 105 | Distinct part identifiers (V1 had 70) |
| `defect_type` enum values | 62 | What's wrong |
| `defect_position` enum values | 12 | Where on the vehicle |
| `defect_system` enum values | 15 | UI navigation only — not stored on defects |
| `defect_group` enum values | 8 | Operational routing bucket |
| `defect_classification` enum values | 5 | Severity tier |
| `defect_source` enum values | 6 | Channel a defect entered through |
| `vehicle_class` enum values | 5 | cargo_van, cdv, ev_rivian, step_van_dot, box_truck |
| `defect_rule` rows | 258 | Canonical (part × defect_type) rules |
| `defect_applicability` rows | 1,094 | Per-class applicability with thresholds, schemas, classifications |
| `defect_part_system` rows | 100 | UI grouping (primary + secondary) |
| `part_group_default` rows | 92 | Default routing Group per part |
| `inspection_rules` rows | 75 | DVIC source rules (Amazon + DSP) |
| `inspection_rule_targets` rows | 235 | Bridges DVIC rules to (part, defect_type) tuples |
| `rwg_rules` rows | 54 | Roadworthy Guidelines reference rules |

**Per-class applicability counts**

| Vehicle class | Applicability rows |
| --- | --- |
| `cargo_van` | 205 |
| `cdv` | 205 |
| `ev_rivian` | 209 |
| `step_van_dot` | 230 |
| `box_truck` | 245 |

**Group distribution across `defect_rule`**

| Group | Rules |
| --- | --- |
| AMR | 120 |
| Body | 60 |
| PM | 31 |
| CNMR | 23 |
| Tires | 17 |
| Netradyne | 4 |
| Detailing | 3 |

---

## 2. What's new vs V1

- **Vehicle scoping.** Every defect row references a vehicle. The inspection link is now optional — defects can come from off-inspection channels.
- **Vehicle-class applicability.** A rule applies to specific vehicle classes via `defect_applicability` (junction table). Replaces V1's flat catalog.
- **Group + Classification on each catalog row.** `defect_group` determines operational routing; `defect_classification` (Sev1 / Sev2 / Sev3 / ULC / Advisory) is the severity tier — still nullable with `needs_review = true` until severity research lands.
- **Junction-split catalog.** V1's flat (part × defect_type × vehicle_class) catalog is now `defect_rule` (part × defect_type, 258 rows) + `defect_applicability` (rule × vehicle_class with all per-class details: positions, threshold, schema, classification — 1,094 rows). Halves storage and removes drift risk when a rule applies identically to all classes.
- **Regulatory linkage tables.** `inspection_rules`, `inspection_rule_targets`, and `rwg_rules` carry Amazon DVIC and Roadworthy Guidelines text and link them to catalog tuples.
- **Source-aware defects.** `defect_source` is now 6 values, including off-inspection channels (`maintenance_request`, `driver_report`, `customer_report`, `shop_finding`, `other`).

---

## 3. Enums

```sql
CREATE TYPE defects.vehicle_class AS ENUM (
  'cargo_van', 'cdv', 'ev_rivian', 'step_van_dot', 'box_truck'
);

CREATE TYPE defects.defect_source AS ENUM (
  'inspection', 'maintenance_request', 'driver_report',
  'customer_report', 'shop_finding', 'other'
);

CREATE TYPE defects.defect_position AS ENUM (
  'driver_front', 'passenger_front', 'driver_rear', 'passenger_rear',
  'driver_side', 'passenger_side',
  'front', 'rear',
  'driver', 'passenger',
  'upper', 'lower'
);

CREATE TYPE defects.defect_classification AS ENUM (
  'Sev1', 'Sev2', 'Sev3', 'ULC', 'Advisory'
);

CREATE TYPE defects.defect_group AS ENUM (
  'AMR', 'Body', 'CMR', 'CNMR', 'PM', 'Tires', 'Detailing', 'Netradyne'
);

CREATE TYPE defects.defect_system AS ENUM (
  'tires_wheels', 'lights', 'windshield_wipers', 'mirrors',
  'body_steps', 'doors_windows', 'interior',
  'brakes_steering', 'air_brake', 'hvac',
  'cameras_electronics', 'fluids_under_hood',
  'compliance', 'under_vehicle', 'ev_powertrain'
);

CREATE TYPE defects.defect_part AS ENUM (
  -- tires_wheels
  'tire','rim','wheel_nut','mounting_equipment',
  -- lights
  'headlight','tail_light','turn_signal','hazard_light','marker_light','license_plate_light',
  'cabin_light','cargo_light','stepwell_light','mirror_light','clearance_marker_light',
  -- windshield_wipers
  'windshield','wiper_blade','washer_system',
  -- mirrors
  'side_mirror',
  -- body_steps / frame
  'bumper','fender','hood','side_panel','floor_panel','side_step','rear_step',
  'trim','side_molding','cab_door','frame_rail','cargo_shelf',
  -- doors_windows
  'exterior_door','sliding_side_door','bulkhead_door','rear_cargo_door','roll_up_door','window','door_hardware',
  -- interior
  'driver_seat','passenger_seat','seatbelt','seatbelt_buckle','sun_visor',
  'interior_cleanliness','interior_loose_objects',
  -- brakes_steering
  'parking_brake','service_brake','steering_wheel','alignment',
  -- air_brake (DOT only)
  'slack_adjuster','brake_chamber','brake_lining','brake_drum',
  'air_compressor','air_tank','air_line','low_air_warning',
  -- under_vehicle / suspension
  'suspension','coil_spring','leaf_spring','air_bag','shock_absorber',
  'torque_arm','tie_rod','drag_link','ball_joint','pitman_arm','power_steering',
  'u_bolt','undercarriage_object',
  -- hvac
  'ac','heater','defroster','cabin_fan',
  -- cameras_electronics
  'netradyne_camera','rear_camera','side_camera','camera_monitor','warning_lamp',
  'backup_alarm','seatbelt_alarm','horn','usb_port','phone_charger',
  'delivery_device_cradle','phone_cradle','dashboard_illumination',
  -- ev_powertrain
  'ev_center_display','high_voltage_cable','charging_port_cap','avas_speaker',
  -- fluids_under_hood
  'coolant','brake_fluid','power_steering_fluid','def_fluid','engine_oil','gear_oil',
  'fuel_cap','battery_12v','battery_cover',
  -- compliance / safety
  'license_plate','inspection_sticker','registration_sticker','dot_decal','prime_decal',
  'paper_document','periodic_inspection_sticker','unapproved_sticker',
  'fire_extinguisher','reflective_triangles','spare_fuses','air_pressure_gauge',
  -- attached
  'lift_gate','mud_flap'
);

CREATE TYPE defects.defect_type AS ENUM (
  -- function
  'not_working','intermittent','flickering','on_or_flashing','no_cold_air','no_heat',
  -- physical state
  'missing','damaged','cracked','broken','bent','frayed','torn','rusted','leaking',
  'cover_cracked','cover_missing',
  -- attachment
  'loose','hanging','unsecured','zip_tied_or_taped','off_track','off_center','misaligned','disconnected',
  -- movement
  'stuck','wont_open','wont_close','wont_lock','wont_unlock','wont_latch','wont_retract',
  -- tire-specific
  'flat','low_tread','sidewall_damage','object_embedded','exposed_wire','bulge',
  -- wheel-specific
  'stud_broken','hub_cap_missing',
  -- fluid-specific
  'low_fluid','empty',
  -- documentation
  'expired','illegible','wrong_vehicle',
  -- work needed
  'needs_adjustment','needs_grease','needs_diagnostic','needs_replacement',
  -- feel
  'pulls_left','pulls_right','vibration','noise',
  -- cleanliness
  'dirty','has_loose_objects',
  -- mount / pressure / approval / catchall
  'mount_damaged','over_pressure','non_approved','obstructed','paint_chip',
  'not_adjustable','odor','other_damage'
);
```

**Notes on enum changes from V1**

- `defect_part` adds 35 values for box-truck/step-van DOT (air-brake, suspension, frame), EV Rivian (`ev_center_display`, `high_voltage_cable`, `charging_port_cap`, `avas_speaker`), and missing compliance items (`dot_decal`, `prime_decal`, `paper_document`, `periodic_inspection_sticker`, `unapproved_sticker`, `reflective_triangles`, `spare_fuses`, `air_pressure_gauge`, `dashboard_illumination`, `cargo_shelf`, `lift_gate`, `mud_flap`, `fuel_cap`, `battery_12v`, `battery_cover`, `cab_door`, `trim`, `side_molding`, `frame_rail`, `clearance_marker_light`).
- `defect_system` adds `air_brake` and `ev_powertrain` to V1's 13 systems.
- `defect_source` replaces V1's 4 values with 6: drops `vendor_report`/`mechanic_walkaround`, adds `maintenance_request`, `customer_report`, `shop_finding`, `other`.
- `defect_type` adds `over_pressure`, `non_approved`, `obstructed`, `paint_chip`, `not_adjustable`, `odor`.

---

## 4. Operational tables

### 4.1 `defects.vehicles`

```sql
CREATE TABLE defects.vehicles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,
  vehicle_class defects.vehicle_class NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

One row per vehicle. `label` is human-friendly (van number / VIN tail). `vehicle_class` controls catalog applicability — it's the lookup key that triggers use to find the right `defect_applicability` row.

### 4.2 `defects.inspections`

```sql
CREATE TABLE defects.inspections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   uuid NOT NULL REFERENCES defects.vehicles(id),
  performed_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

One row per DVIC walkthrough. Inspection templates and per-step state live in a separate spec.

### 4.3 `defects.defects`

The main fact table. One row = one defect on one vehicle. Optionally tied to a parent inspection.

```sql
CREATE TABLE defects.defects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      uuid NOT NULL REFERENCES defects.vehicles(id),
  inspection_id   uuid REFERENCES defects.inspections(id),
  source          defects.defect_source NOT NULL DEFAULT 'inspection',
  part            defects.defect_part NOT NULL,
  position        defects.defect_position,
  defect_type     defects.defect_type NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes           text,
  reported_by     uuid NOT NULL,
  reported_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- inspection_id required when source='inspection'
  CONSTRAINT defects_source_inspection_consistency CHECK (
    (source = 'inspection' AND inspection_id IS NOT NULL)
    OR (source <> 'inspection')
  )
);

CREATE INDEX defects_vehicle_id_idx     ON defects.defects (vehicle_id);
CREATE INDEX defects_inspection_id_idx  ON defects.defects (inspection_id) WHERE inspection_id IS NOT NULL;
CREATE INDEX defects_part_type_idx      ON defects.defects (part, defect_type);
CREATE INDEX defects_details_gin        ON defects.defects USING gin (details);
CREATE INDEX defects_vehicle_open_idx   ON defects.defects (vehicle_id) WHERE inspection_id IS NULL;

-- Dedup within an inspection: same vehicle can't repeat (part, position, defect_type)
CREATE UNIQUE INDEX defects_inspection_uniq
  ON defects.defects (vehicle_id, inspection_id, part, position, defect_type)
  NULLS NOT DISTINCT
  WHERE inspection_id IS NOT NULL;

-- Dedup off-inspection rows on the same vehicle
CREATE UNIQUE INDEX defects_open_uniq
  ON defects.defects (vehicle_id, part, position, defect_type)
  NULLS NOT DISTINCT
  WHERE inspection_id IS NULL;
```

**Triggers (defined in §6)**

```sql
CREATE TRIGGER defects_position_valid BEFORE INSERT OR UPDATE ON defects.defects
  FOR EACH ROW EXECUTE FUNCTION defects.assert_position_valid();
CREATE TRIGGER defects_details_valid  BEFORE INSERT OR UPDATE ON defects.defects
  FOR EACH ROW EXECUTE FUNCTION defects.assert_details_valid();
CREATE TRIGGER defects_set_updated_at BEFORE UPDATE          ON defects.defects
  FOR EACH ROW EXECUTE FUNCTION defects.set_updated_at();
```

Both validity triggers look up `defect_applicability` keyed by `(part, defect_type, vehicle_class)` — if no applicability row exists, the write is rejected. Applicability is the allow-list.

**Excluded fields**

| Field | Lives on |
| --- | --- |
| Vehicle class | Derived via `vehicle.vehicle_class` |
| Severity | Default from `defect_applicability.classification`. Per-row overrides go in a future severity-overrides table. |
| Photos | `defect_photos` (separate spec) |
| Workflow state | `defect_status` (separate spec) |
| Repair-order link | Junction table, populated when work orders exist |

---

## 5. Reference / catalog tables

### 5.1 `defects.defect_rule`

Canonical (part × defect_type) rule. One row per logical defect identity, regardless of vehicle class.

```sql
CREATE TABLE defects.defect_rule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part          defects.defect_part NOT NULL,
  defect_type   defects.defect_type NOT NULL,
  "group"       defects.defect_group NOT NULL,
  notes_default text,                              -- applies to every class; per-class overrides go in defect_applicability.notes
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (part, defect_type)
);
```

The `group` column is auto-filled from `part_group_default` on INSERT if NULL — see §6.2.

### 5.2 `defects.defect_applicability`

A `defect_rule` applied to a specific vehicle class, with per-class details.

```sql
CREATE TABLE defects.defect_applicability (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id             uuid NOT NULL REFERENCES defects.defect_rule(id) ON DELETE CASCADE,
  vehicle_class       defects.vehicle_class NOT NULL,
  valid_positions     defects.defect_position[] NOT NULL DEFAULT '{}'::defects.defect_position[],
  position_required   boolean NOT NULL DEFAULT false,
  allow_null_position boolean NOT NULL DEFAULT true,
  threshold           jsonb NOT NULL DEFAULT '{}'::jsonb,        -- e.g. {"min_tread_32nds": 4} for steer tires
  classification      defects.defect_classification,             -- nullable until severity research lands
  details_schema      jsonb NOT NULL DEFAULT '{}'::jsonb,        -- JSON Schema validated by trigger via pg_jsonschema
  notes               text,                                       -- per-class override; falls back to defect_rule.notes_default
  is_active           boolean NOT NULL DEFAULT true,
  needs_review        boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, vehicle_class)
);

CREATE INDEX defect_applicability_rule_id_idx       ON defects.defect_applicability (rule_id);
CREATE INDEX defect_applicability_vehicle_class_idx ON defects.defect_applicability (vehicle_class);
```

**Why the split.** A flat (part × defect_type × vehicle_class) catalog with embedded per-class details duplicates the `(part, defect_type, group)` triple across 5 vehicle classes — 5× write amplification and drift risk when the rule applies identically to all classes. Splitting `defect_rule` from `defect_applicability` lets common notes/group live once and per-class differences (DOT-only positions, EV-only `lamp_type` enum subset, vehicle-specific thresholds) live where they belong.

### 5.3 `defects.defect_part_system`

Part membership in one or more systems for inspector UI navigation. Not stored on defect rows — only used by the inspector app to render tiles.

```sql
CREATE TABLE defects.defect_part_system (
  part          defects.defect_part NOT NULL,
  system        defects.defect_system NOT NULL,
  is_primary    boolean NOT NULL,
  display_group text,                                  -- optional sub-grouping inside a system tile
  PRIMARY KEY (part, system)
);

-- Each part has exactly one is_primary = true row.
CREATE UNIQUE INDEX defect_part_system_one_primary
  ON defects.defect_part_system (part) WHERE is_primary;
```

100 rows: 92 distinct parts, 8 reachable from a secondary system. Per-system primary-part counts (current DB):

| System | Primary parts |
| --- | --- |
| cameras_electronics | 16 |
| lights | 11 |
| body_steps | 10 |
| compliance | 10 |
| interior | 9 |
| fluids_under_hood | 7 |
| doors_windows | 7 |
| brakes_steering | 4 |
| tires_wheels | 4 |
| hvac | 4 |
| windshield_wipers | 3 |
| under_vehicle | 3 |
| ev_powertrain | 2 |
| air_brake | 1 |
| mirrors | 1 |

### 5.4 `defects.part_group_default`

Default operational `defect_group` per part. `defect_rule.group` is filled from here at insert time when the caller leaves it NULL — edits here don't propagate to existing rules (re-sync is manual).

```sql
CREATE TABLE defects.part_group_default (
  part       defects.defect_part PRIMARY KEY,
  "group"    defects.defect_group NOT NULL,
  rationale  text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

92 rows.

### 5.5 `defects.inspection_rules` and `defects.inspection_rule_targets`

Source rules (Amazon DVIC + DSP additions) and their precise mapping to catalog tuples. The walkaround back-tracks reported defects to the originating rule by joining `defects.defects × inspection_rule_targets × inspection_rules` on `(part, defect_type)`.

```sql
CREATE TABLE defects.inspection_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_text   text NOT NULL,                                              -- as written by Amazon / DSP
  source        text NOT NULL DEFAULT 'Amazon' CHECK (source IN ('Amazon','DSP')),
  section       text CHECK (section IN ('1. General','2. Front Side','3. Back Side',
                                        '4. Driver Side','5. Passenger Side','6. In Cab')),
  parts         text[] NOT NULL DEFAULT '{}',                               -- free-form; trigger validates against defect_part enum
  class         text CHECK (class IN ('Sev1','Sev2','Sev3','ULC','Advisory')),
  grp           text CHECK (grp IN ('AMR','Body','CMR','CNMR','PM','Tires','Detailing','Netradyne')),
  line          text CHECK (line IN ('Mechanical','Electrical','Body','Tires',
                                     'Fluids','Documentation','Cleanliness','Safety')),
  rsi           boolean NOT NULL DEFAULT false,
  vsa           boolean NOT NULL DEFAULT false,
  notion_id     text UNIQUE,                                                -- back-link to source Notion row
  is_active     boolean NOT NULL DEFAULT true,
  vehicle_class defects.vehicle_class[] NOT NULL DEFAULT
    ARRAY['cargo_van','cdv','ev_rivian','step_van_dot','box_truck']::defects.vehicle_class[],
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE defects.inspection_rule_targets (
  rule_id      uuid NOT NULL REFERENCES defects.inspection_rules(id) ON DELETE CASCADE,
  part         defects.defect_part NOT NULL,
  defect_type  defects.defect_type NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, part, defect_type)
);
CREATE INDEX inspection_rule_targets_part_defect_idx
  ON defects.inspection_rule_targets (part, defect_type);
```

75 source rules, 235 targets. Cargo DVIC items default to all 5 vehicle classes; DOT-only items: `{step_van_dot, box_truck}`.

### 5.6 `defects.rwg_rules`

Amazon Roadworthy Guidelines, vehicle-class-scoped. Reference list — not the live walkaround flow. Imported from Notion RWG pages.

```sql
CREATE TABLE defects.rwg_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_text   text NOT NULL,
  category      text,
  parts         text[] NOT NULL DEFAULT '{}',
  vehicle_class defects.vehicle_class[] NOT NULL,
  source        text NOT NULL DEFAULT 'Amazon' CHECK (source IN ('Amazon','DSP')),
  notion_id     text UNIQUE,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

54 rows. Each vehicle has its own RWG document, so unlike DVIC it's legitimate for an RWG rule to apply to only one class (e.g. `ev_rivian`-only or `box_truck`-only).

---

## 6. Triggers and validation functions

### 6.1 `defects.set_updated_at`

```sql
CREATE OR REPLACE FUNCTION defects.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
```

Bound BEFORE UPDATE on `defect_applicability`, `defect_rule`, `defects`, `rwg_rules`.

### 6.2 `defects.defect_rule_fill_group`

Auto-fills `defect_rule.group` from `part_group_default.group` on INSERT when the caller didn't provide one.

```sql
CREATE OR REPLACE FUNCTION defects.defect_rule_fill_group() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."group" IS NULL THEN
    SELECT pgd."group" INTO NEW."group"
      FROM defects.part_group_default pgd
     WHERE pgd.part = NEW.part;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER defect_rule_fill_group BEFORE INSERT ON defects.defect_rule
  FOR EACH ROW EXECUTE FUNCTION defects.defect_rule_fill_group();
```

### 6.3 `defects.assert_position_valid`

Validates that `position` is allowed for `(part, defect_type, vehicle_class)`. Also acts as the allow-list — if no `defect_applicability` row exists for the tuple, the write is rejected.

```sql
CREATE OR REPLACE FUNCTION defects.assert_position_valid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_class               defects.vehicle_class;
  v_valid_positions     defects.defect_position[];
  v_allow_null_position boolean;
  v_found               boolean := false;
BEGIN
  SELECT vehicle_class INTO v_class FROM defects.vehicles WHERE id = NEW.vehicle_id;
  SELECT a.valid_positions, a.allow_null_position, true
    INTO v_valid_positions, v_allow_null_position, v_found
    FROM defects.defect_applicability a
    JOIN defects.defect_rule r ON r.id = a.rule_id
   WHERE r.part = NEW.part
     AND r.defect_type = NEW.defect_type
     AND a.vehicle_class = v_class;

  IF NOT v_found THEN
    RAISE EXCEPTION '(part=%, defect_type=%, vehicle_class=%) not in defect_applicability',
      NEW.part, NEW.defect_type, v_class;
  END IF;

  IF NEW.position IS NULL THEN
    IF NOT v_allow_null_position THEN
      RAISE EXCEPTION 'position required for part % on vehicle_class %', NEW.part, v_class;
    END IF;
  ELSIF NOT NEW.position = ANY(v_valid_positions) THEN
    RAISE EXCEPTION 'position % invalid for part % on vehicle_class %', NEW.position, NEW.part, v_class;
  END IF;
  RETURN NEW;
END;
$$;
```

### 6.4 `defects.assert_details_valid`

Validates `details` against the applicability row's `details_schema` using `pg_jsonschema`. An empty schema (`{}`) means any object is accepted.

```sql
CREATE OR REPLACE FUNCTION defects.assert_details_valid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_class  defects.vehicle_class;
  v_schema jsonb;
BEGIN
  SELECT vehicle_class INTO v_class FROM defects.vehicles WHERE id = NEW.vehicle_id;
  SELECT a.details_schema INTO v_schema
    FROM defects.defect_applicability a
    JOIN defects.defect_rule r ON r.id = a.rule_id
   WHERE r.part = NEW.part
     AND r.defect_type = NEW.defect_type
     AND a.vehicle_class = v_class;
  IF v_schema IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_schema <> '{}'::jsonb AND NOT public.jsonb_matches_schema(v_schema::json, NEW.details) THEN
    RAISE EXCEPTION 'details failed schema validation for (part=%, defect_type=%)', NEW.part, NEW.defect_type;
  END IF;
  RETURN NEW;
END;
$$;
```

### 6.5 `defects.assert_inspection_rule_parts_valid`

`inspection_rules.parts` and `rwg_rules.parts` are `text[]` (free-form for ergonomics during import), but a trigger casts each value to `defects.defect_part` on INSERT/UPDATE so typos can't slip in.

```sql
CREATE OR REPLACE FUNCTION defects.assert_inspection_rule_parts_valid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p text;
BEGIN
  IF NEW.parts IS NULL THEN RETURN NEW; END IF;
  FOREACH p IN ARRAY NEW.parts LOOP
    BEGIN
      PERFORM p::defects.defect_part;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'parts contains invalid part name: %', p
        USING HINT = 'Part must be one of the defects.defect_part enum values.';
    END;
  END LOOP;
  RETURN NEW;
END;
$$;
```

---

## 7. Position rules per part (from current DB)

Generated from `defect_applicability.valid_positions`. Parts not listed allow only NULL position.

| Part(s) | Valid positions | Required? |
| --- | --- | --- |
| `tire`, `rim`, `wheel_nut`, `mounting_equipment` | driver_front, passenger_front, driver_rear, passenger_rear | yes |
| `headlight`, `tail_light`, `turn_signal`, `wiper_blade`, `marker_light`, `stepwell_light`, `mirror_light`, `side_mirror`, `side_camera`, `fender`, `side_step`, `side_panel`, `sliding_side_door`, `window` | driver_side, passenger_side | yes |
| `license_plate_light`, `license_plate`, `cabin_fan`, `mud_flap`, `charging_port_cap` | driver_side, passenger_side, null | no |
| `exterior_door` | driver_side, passenger_side, rear | yes |
| `door_hardware` | driver_side, passenger_side, rear, null | no |
| `seatbelt`, `seatbelt_buckle` | driver, passenger | yes |
| `sun_visor`, `u_bolt` | driver, passenger, null | no |
| `bumper` | front, rear | yes |
| `undercarriage_object`, `clearance_marker_light` | front, rear, null | no |
| All other parts | null only | no |

---

## 8. `details_schema` patterns

Most applicability rows have `details_schema = '{}'`. Five families of structured schemas exist. All are draft-07 JSON Schema validated through `pg_jsonschema`.

### 8.1 Tire tread depth — `tire` + `low_tread`

```json
{
  "type": "object",
  "required": ["tread_depth_32nds"],
  "properties": {
    "tread_depth_32nds": { "type": "integer", "minimum": 0, "maximum": 10 }
  },
  "additionalProperties": false
}
```

DOT-threshold check happens server-side from vehicle class. The `threshold` column on `defect_applicability` carries the per-class minimum (e.g. `{"min_tread_32nds": 4}` for steer tires on `step_van_dot`).

### 8.2 Warning lamp — `warning_lamp` + `on_or_flashing`

```json
{
  "type": "object",
  "required": ["lamp_type", "state"],
  "properties": {
    "lamp_type": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "enum": ["check_engine","oil","tire_pressure","brake","abs","airbag",
                 "battery","coolant","def","glow_plug","service_due","other"]
      }
    },
    "state": { "enum": ["on", "flashing"] }
  },
  "additionalProperties": false
}
```

**`ev_rivian` variant** drops `oil`, `coolant`, `def`, `glow_plug` from the `lamp_type` enum (no ICE warning lamps). All other classes use the full list.

### 8.3 Windshield crack — `windshield` + `cracked`

```json
{
  "type": "object",
  "required": ["in_drivers_line_of_sight"],
  "properties": {
    "in_drivers_line_of_sight": { "type": "boolean" }
  },
  "additionalProperties": false
}
```

`true` grounds the vehicle (Sev1 path); `false` is scheduled.

### 8.4 Compliance expirations

Two date shapes — both with the field optional in the schema:

```json
// YYYY-MM — inspection_sticker, registration_sticker, periodic_inspection_sticker
{ "expiration_month": "2026-05" }

// YYYY-MM-DD — license_plate (temp tags), fire_extinguisher
{ "expiration_date":  "2026-05-31" }
```

Schema for the YYYY-MM-DD variant:

```json
{
  "type": "object",
  "properties": {
    "expiration_date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" }
  },
  "additionalProperties": false
}
```

### 8.5 Everything else

`details_schema = '{}'` and writers send `details = '{}'`. The `(part, position, defect_type)` key is sufficient.

---

## 9. Public-schema views (read-side API)

PostgREST anonymous reads go through these. They cast enums to text so consumers don't need USAGE on `defects`.

```sql
-- v_defect_catalog: rule × applicability with system overlay (the canonical "catalog" the inspector app reads)
CREATE VIEW public.v_defect_catalog AS
SELECT a.id,
  r.part::text                         AS part,
  r.defect_type::text                  AS defect_type,
  a.vehicle_class::text                AS vehicle_class,
  ARRAY(SELECT unnest(a.valid_positions)::text)  AS valid_positions,
  a.position_required, a.allow_null_position,
  a.threshold,
  r."group"::text                      AS "group",
  a.classification::text               AS classification,
  a.details_schema,
  COALESCE(a.notes, r.notes_default)   AS notes,
  a.is_active, a.needs_review,
  ps.system::text                      AS system,
  ps.display_group
FROM defects.defect_applicability a
  JOIN defects.defect_rule r       ON r.id   = a.rule_id
  LEFT JOIN defects.defect_part_system ps ON ps.part = r.part AND ps.is_primary
WHERE a.is_active AND r.is_active;

-- v_defect_rows: reported defects with vehicle context
CREATE VIEW public.v_defect_rows AS
SELECT d.id, d.vehicle_id, v.label AS vehicle_label,
       v.vehicle_class::text AS vehicle_class,
       d.inspection_id, d.source::text AS source,
       d.part::text AS part, d.position::text AS position,
       d.defect_type::text AS defect_type,
       d.details, d.notes, d.reported_at, d.created_at
FROM defects.defects d
  JOIN defects.vehicles v ON v.id = d.vehicle_id;

-- v_catalog_by_vehicle: pre-aggregated tiles for the inspector home screen
CREATE VIEW public.v_catalog_by_vehicle AS
SELECT a.vehicle_class, ps.system, ps.display_group, r.part,
       array_agg(r.defect_type ORDER BY r.defect_type) AS defect_types,
       count(*)::int AS defect_type_count
FROM defects.defect_applicability a
  JOIN defects.defect_rule r       ON r.id = a.rule_id
  LEFT JOIN defects.defect_part_system ps ON ps.part = r.part AND ps.is_primary
WHERE a.is_active AND r.is_active
GROUP BY a.vehicle_class, ps.system, ps.display_group, r.part
ORDER BY a.vehicle_class, ps.system, r.part;

-- v_inspection_rules / v_inspection_rule_targets / v_rwg_rules / v_part_group_default:
-- pass-through projections of the source-rule tables with enums cast to text and is_active filter applied
```

---

## 10. Example writes

```sql
-- Setup
INSERT INTO defects.vehicles (id, label, vehicle_class) VALUES
  ('00000000-0000-0000-0000-000000000001', 'VAN-101', 'cargo_van'),
  ('00000000-0000-0000-0000-000000000002', 'BOX-201', 'box_truck');

INSERT INTO defects.inspections (id, vehicle_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001');

-- 1. Object embedded in passenger-rear tire (DVIC)
INSERT INTO defects.defects (vehicle_id, inspection_id, source, part, position, defect_type, details, notes, reported_by, reported_at)
VALUES ('00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        'inspection', 'tire', 'passenger_rear', 'object_embedded',
        '{}', 'Nail in tread', '<user_uuid>', now());

-- 2. Low tread on passenger front (DVIC) — uses details_schema
INSERT INTO defects.defects (vehicle_id, inspection_id, source, part, position, defect_type, details, reported_by, reported_at)
VALUES ('00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        'inspection', 'tire', 'passenger_front', 'low_tread',
        '{"tread_depth_32nds": 3}', '<user_uuid>', now());

-- 3. Check-engine + ABS lights on (DVIC)
INSERT INTO defects.defects (vehicle_id, inspection_id, source, part, defect_type, details, reported_by, reported_at)
VALUES ('00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        'inspection', 'warning_lamp', 'on_or_flashing',
        '{"lamp_type":["check_engine","abs"],"state":"on"}', '<user_uuid>', now());

-- 4. Cracked windshield in driver's line of sight (DVIC)
INSERT INTO defects.defects (vehicle_id, inspection_id, source, part, defect_type, details, reported_by, reported_at)
VALUES ('00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        'inspection', 'windshield', 'cracked',
        '{"in_drivers_line_of_sight": true}', '<user_uuid>', now());

-- 5. Driver-reported headlight outage (off-inspection — inspection_id NULL)
INSERT INTO defects.defects (vehicle_id, source, part, position, defect_type, reported_by, reported_at)
VALUES ('00000000-0000-0000-0000-000000000001',
        'driver_report', 'headlight', 'driver_side', 'not_working',
        '<user_uuid>', now());

-- 6. Shop finds expired registration sticker
INSERT INTO defects.defects (vehicle_id, source, part, defect_type, details, reported_by, reported_at)
VALUES ('00000000-0000-0000-0000-000000000001',
        'shop_finding', 'registration_sticker', 'expired',
        '{"expiration_month": "2026-03"}', '<user_uuid>', now());
```

Each write traverses both validity triggers: `assert_position_valid` (rejects unknown applicability or wrong position) and `assert_details_valid` (validates `details` against the applicability row's JSON Schema).

---

## 11. Replication checklist

To rebuild this schema on an empty Postgres database:

1. `CREATE EXTENSION IF NOT EXISTS pg_jsonschema;` — provides `jsonb_matches_schema`.
2. `CREATE SCHEMA defects;`
3. Create the 7 enums in §3 (order doesn't matter — none reference each other).
4. Create tables in dependency order:

    a. `defects.vehicles` → `defects.inspections` → `defects.defects`

    b. `defects.defect_rule` → `defects.defect_applicability`

    c. `defects.defect_part_system`

    d. `defects.part_group_default`

    e. `defects.inspection_rules` → `defects.inspection_rule_targets`

    f. `defects.rwg_rules`

5. Create all indexes (§4.3, §5.2, §5.5) and the source/inspection CHECK constraint on `defects.defects` (§4.3).
6. Define the 5 trigger functions in §6 and bind their triggers.
7. Create the public-schema views from §9.
8. Seed reference data (this order matters — the `defect_rule_fill_group` trigger reads `part_group_default`):

    a. `part_group_default` (92 rows)

    b. `defect_part_system` (100 rows)

    c. `defect_rule` (258 rows)

    d. `defect_applicability` (1,094 rows)

    e. `inspection_rules` (75 rows) + `inspection_rule_targets` (235 rows)

    f. `rwg_rules` (54 rows)

9. (Optional) Seed `vehicles`, `inspections`, `defects` for fixtures.

The live source of truth is the `defects` schema in the DFS-Sales Supabase project (`toghrndwcyjbjcqhvjpi`). For an exact byte-perfect replica, run `pg_dump --schema=defects --schema=public` against that project — that single artifact will produce a runnable SQL file with every DDL statement and seed row.

---

## Appendix A — Nova Fora vehicle_class mapping (Path B, 2026-05-05)

Nova Fora deviates from the V2.2 enum values to use descriptive labels aligned with Amazon fleet shorthand the user already uses. Mapping:

| Amazon shorthand | Nova Fora `vehicle_class` value | DFS Portal V2.2 equivalent |
| --- | --- | --- |
| CDV | `custom_delivery_van` | `cdv` |
| Cargo | `regular_cargo_van` | `cargo_van` |
| SV | `step_van_dot` | `step_van_dot` |
| EV | `electric_vehicle` | `ev_rivian` |
| AMXL | `box_truck_dot` | `box_truck` |

When sharing data with DFS Portal in the future (Fase 2 or post-launch), translate via this mapping.
