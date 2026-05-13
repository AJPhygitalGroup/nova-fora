"""Internal CLI commands. Run with: python -m app.cli <command>

Available commands:
  seed                       Seed orgs + users (idempotent).
  seed-vehicles              Seed 8 Safety First LLC vehicles.
  seed-defect-catalog        Seed V2.2 catalog: part_group_default,
                              defect_part_system, defect_rule, defect_applicability
                              (idempotent UPSERT).
  seed-dvic-template         Seed dvic_template_item rows from the Amazon DVIC
                              PDFs. Idempotent UPSERT.
  seed-inspection-rules      Seed inspection_rule + inspection_rule_line.

  seed-demo-vendors          WO V2.0 — UPSERT 4 vendor orgs + 8 users (one
                              admin + one tech per shop). Run before
                              seed-vendor-workshops so workshops link.
  seed-vendor-workshops      WO V2.0 — UPSERT 5 demo workshops (one per
                              repair_type).
  seed-dsp-settings          WO V2.0 — UPSERT DSP settings (AMR/PM preauth).
  seed-wo-demo               WO V2.0 — approve N defects, bundle, route, accept
                              one. Bootstraps the WO surface with live data.
  bundle-route-cron          WO V2.0 — cron driver: scan ready RRs and route
                              them. Designed for a 1-min schedule.

  create-service-user <email> <full_name> <org_id> <role>
                             Create a new user with a generated password.
  reset-password <email> <new_password>
                             Admin override for lost passwords.
"""
import asyncio
import sys

from sqlmodel import select

from app.auth.hashing import hash_password
from app.db import AsyncSessionLocal
from app.models.organization import OrgType, Organization
from app.models.user import User, UserRole, UserStatus
from app.models.vehicle import Vehicle


# ─────────────────────────────────────────────────────
# Demo seed data — matches nova-fora-demo/src/data/mockData.js
# ─────────────────────────────────────────────────────

DEMO_PASSWORD = "nova2026!"  # All 4 demo users share this. Tell them on first login.

ORG_SEED = [
    # DSPs (5) — Safety First is the primary one with all 8 demo vans.
    # The other 4 are placeholders so vendor/tech/admin users can see a
    # populated "My DSPs" list. They start empty (no vans) and DSP owners
    # would seed their own fleets in real onboarding.
    {"key": "safety_first", "name": "Safety First LLC", "org_type": OrgType.DSP},
    {"key": "ceiba_routes", "name": "Ceiba Routes", "org_type": OrgType.DSP},
    {"key": "totl_logistics", "name": "TOTL Logistics", "org_type": OrgType.DSP},
    {"key": "summit_express", "name": "Summit Express", "org_type": OrgType.DSP},
    {"key": "redmond_routes", "name": "Redmond Routes", "org_type": OrgType.DSP},
    # Vendor + platform
    {"key": "dulles_midas", "name": "Dulles Midas", "org_type": OrgType.VENDOR},
    {"key": "nova_fora", "name": "Nova Fora", "org_type": OrgType.PLATFORM},
]


USER_SEED = [
    {
        "email": "jon@safetyfirst.com",
        "full_name": "Jon Doe",
        "org_key": "safety_first",
        "role": UserRole.DSP_OWNER,
        "avatar": "JD",
        "station": "DSE4",
    },
    {
        "email": "olger@dullesmidas.com",
        "full_name": "Olger Joya",
        "org_key": "dulles_midas",
        "role": UserRole.VENDOR_ADMIN,
        "avatar": "OJ",
        "station": None,
    },
    {
        "email": "david@dullesmidas.com",
        "full_name": "David Torres",
        "org_key": "dulles_midas",
        "role": UserRole.TECHNICIAN,
        "avatar": "DT",
        "station": None,
    },
    {
        "email": "maria@novafora.com",
        "full_name": "Maria Chen",
        "org_key": "nova_fora",
        "role": UserRole.SITE_ADMIN,
        "avatar": "MC",
        "station": None,
    },
]


async def cmd_seed() -> None:
    """Insert demo orgs + users if not already present. Idempotent."""
    async with AsyncSessionLocal() as session:
        org_by_key: dict[str, Organization] = {}
        for spec in ORG_SEED:
            existing = (
                await session.execute(
                    select(Organization).where(Organization.name == spec["name"])
                )
            ).scalar_one_or_none()
            if existing:
                print(f"[seed] org exists: {spec['name']} (id={existing.id})")
                org_by_key[spec["key"]] = existing
                continue
            new_org = Organization(
                name=spec["name"],
                org_type=spec["org_type"],
                phone=None,
                address=None,
            )
            session.add(new_org)
            await session.flush()
            org_by_key[spec["key"]] = new_org
            print(f"[seed] org created: {spec['name']} (id={new_org.id}, {new_org.id_str})")

        hashed_default = hash_password(DEMO_PASSWORD)
        for spec in USER_SEED:
            existing_user = (
                await session.execute(
                    select(User).where(User.email == spec["email"])
                )
            ).scalar_one_or_none()
            if existing_user:
                print(f"[seed] user exists: {spec['email']}")
                continue
            org = org_by_key[spec["org_key"]]
            new_user = User(
                email=spec["email"],
                full_name=spec["full_name"],
                password_hash=hashed_default,
                organization_id=org.id,
                role=spec["role"],
                avatar=spec["avatar"],
                station=spec["station"],
                status=UserStatus.ACTIVE,
                language="en",
            )
            session.add(new_user)
            print(f"[seed] user created: {spec['email']} ({spec['role'].value})")

        await session.commit()
    print(f"\n✅ Seed complete. Demo password: {DEMO_PASSWORD}")


# ─────────────────────────────────────────────────────
# Vehicle seed — Safety First LLC (8 cargo vans, all regular_cargo_van class)
# ─────────────────────────────────────────────────────

VEHICLE_SEED_SAFETY_FIRST = [
    # (fleet_id, vin, plate, year, make, model, mileage, vehicle_class, ownership)
    # Branded Cargo Vans (the bulk of the fleet)
    ("SF013", "1FMCU9GD5MUA00013", "WA-3K13-AZ", 2021, "Mercedes", "Sprinter 2500", 86209,
     "regular_cargo_van",   "amazon_owned"),
    ("SF021", "1FMCU9GD5MUA00021", "WA-3K21-AZ", 2021, "Mercedes", "Sprinter 2500", 91248,
     "regular_cargo_van",   "amazon_owned"),
    ("SF016", "1FMCU9GD5MUA00016", "WA-3K16-AZ", 2021, "Mercedes", "Sprinter 2500", 95073,
     "regular_cargo_van",   "amazon_owned"),
    ("SF005", "1FMCU9GD5MUA00005", "WA-3K05-AZ", 2020, "Ford",     "Transit 250",  83646,
     "regular_cargo_van",   "amazon_owned"),
    # CDV — physically distinct (purpose-built), shares Cargo DVIC, branded
    ("SF025", "1FMCU9GD5MUA00025", "WA-3K25-AZ", 2022, "Ram",      "ProMaster 2500", 84267,
     "custom_delivery_van", "amazon_owned"),
    # Owner-financed cargo van (no DOT/Prime decals)
    ("SF026", "1FMCU9GD5MUA00026", "WA-3K26-AZ", 2022, "Ram",      "ProMaster 2500", 0,
     "regular_cargo_van",   "dsp_owned"),
    # Rented cargo van (no DOT/Prime decals)
    ("SF004", "1FMCU9GD5MUA00004", "WA-3K04-AZ", 2020, "Ford",     "Transit 250",  90708,
     "regular_cargo_van",   "rental"),
    # Step Van DOT — DOT-regulated, branded
    ("SF006", "1FMCU9GD5MUA00006", "WA-3K06-AZ", 2020, "Ford",     "Transit 250",  99597,
     "step_van_dot",        "amazon_owned"),
    # Box Truck (AMXL) — DOT-regulated, branded
    ("SF030", "1FMCU9GD5MUA00030", "WA-3K30-AZ", 2023, "Isuzu",    "NPR HD",       42150,
     "box_truck_dot",       "amazon_owned"),
]


async def cmd_seed_vehicles() -> None:
    """Create 8 vehicles for Safety First LLC (idempotent)."""
    async with AsyncSessionLocal() as session:
        dsp = (
            await session.execute(
                select(Organization).where(Organization.name == "Safety First LLC")
            )
        ).scalar_one_or_none()
        if dsp is None:
            print("ERROR: Organization 'Safety First LLC' not found. Run 'seed' first.")
            sys.exit(1)

        created = 0
        skipped = 0
        for row in VEHICLE_SEED_SAFETY_FIRST:
            (fleet_id, vin, plate, year, make, model, mileage,
             vehicle_class, ownership) = row
            existing = (
                await session.execute(select(Vehicle).where(Vehicle.vin == vin))
            ).scalar_one_or_none()
            if existing:
                # UPDATE existing rows so re-runs pick up new vehicle_class /
                # ownership values without needing a wipe.
                existing.vehicle_class = vehicle_class
                existing.ownership = ownership
                session.add(existing)
                print(f"[seed-vehicles] updated: {fleet_id} → "
                      f"{vehicle_class} / {ownership}")
                skipped += 1
                continue
            v = Vehicle(
                dsp_id=dsp.id,
                fleet_id=fleet_id,
                vin=vin,
                plate=plate,
                year=year,
                make=make,
                model=model,
                mileage=mileage,
                vehicle_class=vehicle_class,
                ownership=ownership,
            )
            session.add(v)
            await session.flush()
            print(f"[seed-vehicles] created: {fleet_id} ({v.id_str}) "
                  f"{vehicle_class} / {ownership}")
            created += 1

        await session.commit()
        print(f"\n✅ Vehicles seed complete. {created} created, {skipped} already existed.")


# ─────────────────────────────────────────────────────
# Defect catalog seed (V2.2 — junction split)
#
# UPSERT keyed by natural keys:
#   part_group_default       (PK part)
#   defect_part_system       (composite PK part+system)
#   defect_rule              (UNIQUE part+defect_type)
#   defect_applicability     (UNIQUE rule_id+vehicle_class)
#
# Orphan handling: rows in DB whose key is no longer in the seed get
# is_active=False (preserves audit; doesn't hard-delete since defects may
# reference them historically).
# ─────────────────────────────────────────────────────
async def cmd_seed_dvic_template() -> None:
    """Idempotent UPSERT of dvic_template_item rows from the Amazon DVIC PDFs.

    Reads `seed_dvic_template.TEMPLATES_BY_CLASS` and for each
    (vehicle_class, row), looks up the corresponding `defect_rule.id` by
    (part, defect_type), then UPSERTs the row keyed by
    (vehicle_class, section, part_category, rule_id, position).

    Prerequisite: `seed-defect-catalog` must run first so the rules exist.
    """
    from app.models.defect_catalog import DefectRule, DvicTemplateItem
    from app.models.base import utc_now
    from app.seed_dvic_template import get_templates

    templates = get_templates()

    async with AsyncSessionLocal() as session:
        # Build a (part, defect_type) → rule_id lookup table once.
        rules = (
            await session.execute(select(DefectRule).where(DefectRule.is_active == True))  # noqa: E712
        ).scalars().all()
        rule_id_by_key: dict[tuple[str, str], int] = {
            (r.part if isinstance(r.part, str) else r.part.value,
             r.defect_type if isinstance(r.defect_type, str) else r.defect_type.value): r.id
            for r in rules
        }

        new_count, upd_count, skip_count = 0, 0, 0
        seen_keys: set[tuple[str, str, str, int, str | None]] = set()

        for vc, rows in templates.items():
            for row in rows:
                # Tuple shapes:
                #   7 — legacy (no photo_required, no requires_branding)
                #   8 — photo_required set, requires_branding defaults False
                #   9 — both flags explicit
                if len(row) == 9:
                    (section, part_cat, part, defect_type,
                     position, description, ordering,
                     photo_required, requires_branding) = row
                elif len(row) == 8:
                    (section, part_cat, part, defect_type,
                     position, description, ordering, photo_required) = row
                    requires_branding = False
                else:
                    (section, part_cat, part, defect_type,
                     position, description, ordering) = row
                    photo_required = True
                    requires_branding = False
                rule_id = rule_id_by_key.get((part.value, defect_type.value))
                if rule_id is None:
                    print(
                        f"[seed-dvic-template] SKIP {vc.value}/{section.value}: "
                        f"no rule for ({part.value}, {defect_type.value}) — "
                        f"add to seed_defect_catalog.RULES first."
                    )
                    skip_count += 1
                    continue

                pos_val = position.value if position is not None else None
                key = (vc.value, section.value, part_cat, rule_id, pos_val)
                seen_keys.add(key)

                # UPSERT by natural key (use COALESCE on position for NULL match)
                existing_q = (
                    select(DvicTemplateItem)
                    .where(DvicTemplateItem.vehicle_class == vc.value)
                    .where(DvicTemplateItem.section == section.value)
                    .where(DvicTemplateItem.part_category == part_cat)
                    .where(DvicTemplateItem.rule_id == rule_id)
                )
                if pos_val is None:
                    existing_q = existing_q.where(DvicTemplateItem.position.is_(None))
                else:
                    existing_q = existing_q.where(DvicTemplateItem.position == pos_val)

                existing = (await session.execute(existing_q)).scalar_one_or_none()
                if existing is None:
                    session.add(DvicTemplateItem(
                        vehicle_class=vc,
                        section=section,
                        part_category=part_cat,
                        rule_id=rule_id,
                        position=position,
                        description=description,
                        ordering=ordering,
                        photo_required=photo_required,
                        requires_branding=requires_branding,
                        is_active=True,
                    ))
                    # Per-row flush so any duplicate spec further down in the
                    # CARGO_ROWS / DOT_ROWS / BOX_TRUCK_ROWS lists takes the
                    # UPDATE branch on the SELECT above instead of queueing a
                    # second INSERT that collides on
                    # uq_dvic_template_class_sec_cat_rule_pos.
                    await session.flush()
                    new_count += 1
                else:
                    existing.description = description
                    existing.ordering = ordering
                    existing.photo_required = photo_required
                    existing.requires_branding = requires_branding
                    existing.is_active = True
                    existing.updated_at = utc_now()
                    session.add(existing)
                    upd_count += 1

        # Deactivate orphans (rows in DB whose key is not in the seed)
        all_existing = (
            await session.execute(select(DvicTemplateItem))
        ).scalars().all()
        deact_count = 0
        for r in all_existing:
            vc_v = r.vehicle_class if isinstance(r.vehicle_class, str) else r.vehicle_class.value
            sec_v = r.section if isinstance(r.section, str) else r.section.value
            pos_v = r.position if (r.position is None or isinstance(r.position, str)) else r.position.value
            key = (vc_v, sec_v, r.part_category, r.rule_id, pos_v)
            if key not in seen_keys and r.is_active:
                r.is_active = False
                r.updated_at = utc_now()
                session.add(r)
                deact_count += 1

        await session.commit()

        print("✅ DVIC template seed:")
        print(f"   {new_count} new, {upd_count} updated, {skip_count} skipped, {deact_count} deactivated")


async def cmd_seed_defect_catalog() -> None:
    """Idempotent UPSERT of the V2.2 catalog tables."""
    from app.models.defect_catalog import (
        DefectApplicability,
        DefectPartSystem,
        DefectRule,
        PartGroupDefault,
    )
    from app.models.base import utc_now
    from app.seed_defect_catalog import (
        expand_applicability,
        get_part_group_defaults,
        get_part_systems,
        get_rules,
    )

    async with AsyncSessionLocal() as session:
        # ── 1. part_group_default ──
        pgd_new, pgd_upd = 0, 0
        for part, group, rationale in get_part_group_defaults():
            row = (
                await session.execute(
                    select(PartGroupDefault).where(PartGroupDefault.part == part)
                )
            ).scalar_one_or_none()
            if row is None:
                session.add(
                    PartGroupDefault(part=part, group=group, rationale=rationale)
                )
                # Per-row flush so a duplicate entry in PART_GROUP_DEFAULTS
                # doesn't trip the primary-key UNIQUE constraint at the
                # batched INSERT (the second iteration's SELECT-before-add
                # would otherwise see an empty table and queue a second
                # insert for the same `part` value).
                await session.flush()
                pgd_new += 1
            else:
                row.group = group
                row.rationale = rationale
                row.updated_at = utc_now()
                session.add(row)
                pgd_upd += 1

        # ── 2. defect_part_system ──
        ps_new, ps_upd = 0, 0
        seed_part_systems = get_part_systems()
        for part, system, is_primary, display_group in seed_part_systems:
            row = (
                await session.execute(
                    select(DefectPartSystem)
                    .where(DefectPartSystem.part == part)
                    .where(DefectPartSystem.system == system)
                )
            ).scalar_one_or_none()
            if row is None:
                session.add(
                    DefectPartSystem(
                        part=part, system=system,
                        is_primary=is_primary, display_group=display_group,
                    )
                )
                # Same per-row flush rationale as in part_group_default —
                # any future duplicate (part, system) pair in the seed list
                # would otherwise collide on the table's PK at batch time.
                await session.flush()
                ps_new += 1
            else:
                row.is_primary = is_primary
                row.display_group = display_group
                session.add(row)
                ps_upd += 1

        # ── 3. defect_rule ──
        rules = get_rules()
        rule_new, rule_upd = 0, 0
        # Map natural key → DefectRule.id for applicability seeding below.
        rule_id_by_key: dict[tuple[str, str], int] = {}
        # Build lookup for group_override / inheritance.
        pgd_by_part = {p: g for p, g, _ in get_part_group_defaults()}

        for spec in rules:
            (
                part, defect_type, _classes, _classification, _vp, _pr, _anp,
                _ds, _th, notes_default, group_override,
            ) = spec
            group = group_override or pgd_by_part.get(part)
            if group is None:
                print(
                    f"[seed-defect-catalog] WARN: no default group for {part.value!r}; "
                    f"add to PART_GROUP_DEFAULTS or pass group_override."
                )
                continue

            existing = (
                await session.execute(
                    select(DefectRule)
                    .where(DefectRule.part == part)
                    .where(DefectRule.defect_type == defect_type)
                )
            ).scalar_one_or_none()
            if existing is None:
                rule = DefectRule(
                    part=part,
                    defect_type=defect_type,
                    group=group,
                    notes_default=notes_default,
                    is_active=True,
                )
                session.add(rule)
                await session.flush()
                rule_id_by_key[(part.value, defect_type.value)] = rule.id
                rule_new += 1
            else:
                existing.group = group
                existing.notes_default = notes_default
                existing.is_active = True
                existing.updated_at = utc_now()
                session.add(existing)
                rule_id_by_key[(part.value, defect_type.value)] = existing.id
                rule_upd += 1

        # ── 4. defect_applicability ──
        app_new, app_upd = 0, 0
        for spec in rules:
            part, defect_type = spec[0], spec[1]
            rule_id = rule_id_by_key.get((part.value, defect_type.value))
            if rule_id is None:
                continue  # rule was skipped above (missing group)
            for app_dict in expand_applicability(spec):
                vc = app_dict["vehicle_class"]
                existing = (
                    await session.execute(
                        select(DefectApplicability)
                        .where(DefectApplicability.rule_id == rule_id)
                        .where(DefectApplicability.vehicle_class == vc.value)
                    )
                ).scalar_one_or_none()
                if existing is None:
                    session.add(
                        DefectApplicability(
                            rule_id=rule_id,
                            vehicle_class=vc,
                            valid_positions=app_dict["valid_positions"],
                            position_required=app_dict["position_required"],
                            allow_null_position=app_dict["allow_null_position"],
                            threshold=app_dict["threshold"],
                            classification=app_dict["classification"],
                            details_schema=app_dict["details_schema"],
                            notes=app_dict["notes"],
                            is_active=True,
                            needs_review=app_dict["needs_review"],
                        )
                    )
                    # Flush per row so a downstream duplicate spec in the
                    # RULES list (e.g. two specs sharing (part, defect_type)
                    # but written separately for ICE vs EV schemas) finds
                    # the just-inserted applicability row on its SELECT and
                    # takes the UPDATE branch instead of queueing a second
                    # INSERT that collides on defect_applicability_rule_class_uq.
                    await session.flush()
                    app_new += 1
                else:
                    existing.valid_positions = app_dict["valid_positions"]
                    existing.position_required = app_dict["position_required"]
                    existing.allow_null_position = app_dict["allow_null_position"]
                    existing.threshold = app_dict["threshold"]
                    existing.classification = app_dict["classification"]
                    existing.details_schema = app_dict["details_schema"]
                    existing.notes = app_dict["notes"]
                    existing.is_active = True
                    existing.needs_review = app_dict["needs_review"]
                    existing.updated_at = utc_now()
                    session.add(existing)
                    app_upd += 1

        # ── 5. Deactivate orphans ──
        # Rules not in seed → is_active=False.
        seed_keys = {(s[0].value, s[1].value) for s in rules}
        all_rules = (
            await session.execute(select(DefectRule))
        ).scalars().all()
        rule_deact = 0
        for r in all_rules:
            if (r.part if isinstance(r.part, str) else r.part.value,
                r.defect_type if isinstance(r.defect_type, str) else r.defect_type.value) not in seed_keys:
                if r.is_active:
                    r.is_active = False
                    r.updated_at = utc_now()
                    session.add(r)
                    rule_deact += 1

        await session.commit()

        print("✅ V2.2 defect catalog seed:")
        print(f"   part_group_default      — {pgd_new} new, {pgd_upd} updated")
        print(f"   defect_part_system      — {ps_new} new, {ps_upd} updated")
        print(f"   defect_rule             — {rule_new} new, {rule_upd} updated, {rule_deact} deactivated")
        print(f"   defect_applicability    — {app_new} new, {app_upd} updated")


# ─────────────────────────────────────────────────────
# Service user + password reset (unchanged from V1)
# ─────────────────────────────────────────────────────
def _parse_org_id(raw: str) -> int:
    s = raw.strip().upper()
    for prefix in ("DSP-", "NF-", "V-"):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    return int(s)


async def cmd_create_service_user(
    email: str, full_name: str, org_id_raw: str, role_str: str
) -> None:
    import secrets

    try:
        role = UserRole(role_str)
    except ValueError:
        print(
            f"ERROR: invalid role {role_str!r}. "
            f"Allowed: {[r.value for r in UserRole]}"
        )
        sys.exit(1)

    try:
        org_pk = _parse_org_id(org_id_raw)
    except ValueError:
        print(f"ERROR: invalid org id {org_id_raw!r}.")
        sys.exit(1)

    async with AsyncSessionLocal() as session:
        org = (
            await session.execute(select(Organization).where(Organization.id == org_pk))
        ).scalar_one_or_none()
        if org is None:
            print(f"ERROR: no organization with id {org_id_raw!r} (parsed as {org_pk}).")
            sys.exit(1)

        email_lc = email.strip().lower()
        existing = (
            await session.execute(select(User).where(User.email == email_lc))
        ).scalar_one_or_none()
        if existing is not None:
            print(
                f"ERROR: user {email_lc!r} already exists (id={existing.id}, "
                f"org_id={existing.organization_id}, role={existing.role.value})."
            )
            sys.exit(1)

        password = secrets.token_urlsafe(32)
        parts = [p for p in full_name.split() if p]
        avatar = "".join(p[0].upper() for p in parts[:2]) or "??"

        user = User(
            email=email_lc,
            full_name=full_name,
            password_hash=hash_password(password),
            organization_id=org_pk,
            role=role,
            avatar=avatar,
            language="en",
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        sep = "─" * 72
        print()
        print(sep)
        print("✅ Service user created. The password below is shown ONCE — copy it now.")
        print(sep)
        print(f"  user_id     : {user.id}")
        print(f"  email       : {user.email}")
        print(f"  full_name   : {user.full_name}")
        print(f"  organization: {org.name} ({org.id_str})")
        print(f"  role        : {user.role.value}")
        print(f"  password    : {password}")
        print(sep)


async def cmd_reset_password(email: str, new_password: str) -> None:
    async with AsyncSessionLocal() as session:
        user = (
            await session.execute(select(User).where(User.email == email.lower()))
        ).scalar_one_or_none()
        if user is None:
            print(f"ERROR: no user with email {email}")
            sys.exit(1)
        user.password_hash = hash_password(new_password)
        session.add(user)
        await session.commit()
        print(f"✅ Password reset for {email}")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "seed":
        asyncio.run(cmd_seed())
    elif cmd == "seed-vehicles":
        asyncio.run(cmd_seed_vehicles())
    elif cmd == "seed-defect-catalog":
        asyncio.run(cmd_seed_defect_catalog())
    elif cmd == "seed-dvic-template":
        asyncio.run(cmd_seed_dvic_template())
    elif cmd == "seed-inspection-rules":
        from app.seed_inspection_rules import cmd_seed_inspection_rules
        asyncio.run(cmd_seed_inspection_rules())
    elif cmd == "seed-demo-vendors":
        from app.seed_wo_v2 import cmd_seed_demo_vendors
        asyncio.run(cmd_seed_demo_vendors())
    elif cmd == "seed-vendor-workshops":
        from app.seed_wo_v2 import cmd_seed_vendor_workshops
        asyncio.run(cmd_seed_vendor_workshops())
    elif cmd == "seed-dsp-settings":
        from app.seed_wo_v2 import cmd_seed_dsp_settings
        asyncio.run(cmd_seed_dsp_settings())
    elif cmd == "seed-wo-demo":
        from app.seed_wo_v2 import cmd_seed_wo_demo
        max_n = int(sys.argv[2]) if len(sys.argv) >= 3 else 3
        asyncio.run(cmd_seed_wo_demo(max_defects=max_n))
    elif cmd == "bundle-route-cron":
        from app.seed_wo_v2 import cmd_bundle_route_cron
        asyncio.run(cmd_bundle_route_cron())
    elif cmd == "create-service-user":
        if len(sys.argv) != 6:
            print(
                "Usage: python -m app.cli create-service-user "
                "<email> <full_name> <org_id> <role>"
            )
            sys.exit(1)
        asyncio.run(
            cmd_create_service_user(
                sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
            )
        )
    elif cmd == "reset-password":
        if len(sys.argv) != 4:
            print("Usage: python -m app.cli reset-password <email> <new_password>")
            sys.exit(1)
        asyncio.run(cmd_reset_password(sys.argv[2], sys.argv[3]))
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
