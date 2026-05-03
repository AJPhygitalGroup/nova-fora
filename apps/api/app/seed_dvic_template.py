"""Seed data for `dvic_template_item` — the line-by-line transcription of
the Amazon DVIC PDFs (Cargo + DOT Step Van, Apr 2026).

Driven by:
  - Cargo DVIC (EXTRA_LARGE_CARGO_VAN, LARGE_CARGO_VAN) — 38 line items
  - DOT DVIC (STEP_VAN_MEDIUM, STEP_VAN_LARGE)          — Cargo + 13 DOT-only

Run via:
    python -m app.cli seed-dvic-template

Idempotent: identifies a row by (asset_types_csv, section, part_enum,
defect_type_enum, position) and upserts.
"""
from app.models.defect_catalog import AssetType as AT
from app.models.defect_catalog import DefectPart as P
from app.models.defect_catalog import DefectPosition as Pos
from app.models.defect_catalog import DefectType as T
from app.models.defect_catalog import DvicSection as DS

# ─────────────────────────────────────────────────────
# Asset type tags — used to keep the rows compact
# ─────────────────────────────────────────────────────
ALL_ASSETS = ",".join(at.value for at in AT)
# CARGO covers non-DOT delivery vehicles: the two cargo van variants plus the
# Rivian EDV. From an inspection-checklist standpoint EDVs are cargo vans
# that happen to be electric — they use the same DVIR template Amazon ships
# for cargo vans (no DOT/CA BIT line, no fire extinguisher, etc.).
CARGO = (
    f"{AT.EXTRA_LARGE_CARGO_VAN.value},"
    f"{AT.LARGE_CARGO_VAN.value},"
    f"{AT.ELECTRIC_DELIVERY_VEHICLE.value}"
)
DOT = f"{AT.STEP_VAN_MEDIUM.value},{AT.STEP_VAN_LARGE.value}"
DOT_LARGE_ONLY = AT.STEP_VAN_LARGE.value  # battery cover only on box trucks


# ─────────────────────────────────────────────────────
# Sub-position helpers (encoded in JSONB)
# ─────────────────────────────────────────────────────
SUB_BEAM = [
    {"key": "low_beam", "label": "Low beam"},
    {"key": "high_beam", "label": "High beam"},
]
SUB_TREAD_LOC = [
    {"key": "inner", "label": "Inner most"},
    {"key": "middle", "label": "Middle"},
    {"key": "outer", "label": "Outer most"},
]
SUB_SEATBELT_PART = [
    {"key": "anchor", "label": "Anchor"},
    {"key": "buckle", "label": "Buckle"},
    {"key": "casing", "label": "Casing"},
    {"key": "belt", "label": "Belt"},
]
SUB_DOOR = [
    {"key": "driver", "label": "Driver door"},
    {"key": "passenger", "label": "Passenger door"},
    {"key": "cargo", "label": "Cargo door"},
    {"key": "back", "label": "Back door"},
]
SUB_WARNING_LAMPS = [
    {"key": "check_engine", "label": "Check engine"},
    {"key": "abs", "label": "ABS"},
    {"key": "battery", "label": "Battery"},
    {"key": "oil", "label": "Oil"},
    {"key": "tpms", "label": "Tire pressure"},
    {"key": "airbag", "label": "Airbag"},
    {"key": "other", "label": "Other"},
]


# ─────────────────────────────────────────────────────
# Schemas for `details` JSON validation
# ─────────────────────────────────────────────────────
SCHEMA_TREAD_DEPTH_2_32 = {
    "type": "object",
    "properties": {
        "tread_depth_32nds": {"type": "integer", "minimum": 0, "maximum": 32},
        "tread_position": {"enum": ["inner", "middle", "outer"]},
    },
    "required": ["tread_depth_32nds"],
    "additionalProperties": False,
    "ui_helper": "Inspect inner / middle / outer tread. DOT minimum 2/32 (4/32 front for steer).",
}

SCHEMA_AIR_PSI = {
    "type": "object",
    "properties": {"reading_psi": {"type": "integer", "minimum": 0, "maximum": 250}},
    "additionalProperties": False,
}

SCHEMA_EXPIRATION_DATE = {
    "type": "object",
    "properties": {
        "expiration_date": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"},
    },
    "additionalProperties": False,
}

SCHEMA_WARNING_LAMP = {
    "type": "object",
    "properties": {
        "lamp_type": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
        },
        "state": {"enum": ["on", "flashing"]},
    },
    "required": ["lamp_type", "state"],
    "additionalProperties": False,
}


# ─────────────────────────────────────────────────────
# Row builder helper
#
# Each tuple is:
#  (asset_types_csv, section, part_category, part, defect_type,
#   position | None, position_options [list], sub_positions | None,
#   default_severity, description, details_schema | None, ordering)
# ─────────────────────────────────────────────────────
def row(
    asset_types: str,
    section: DS,
    category: str,
    part: P,
    defect_type: T,
    *,
    position: Pos | None = None,
    position_options: list[Pos] | None = None,
    sub_positions: list[dict] | None = None,
    description: str,
    details_schema: dict | None = None,
    ordering: int = 0,
) -> dict:
    return {
        "asset_types_csv": asset_types,
        "section": section,
        "part_category": category,
        "part_enum": part,
        "defect_type_enum": defect_type,
        "position": position,
        "position_options_csv": ",".join(p.value for p in (position_options or [])),
        "sub_positions": sub_positions,
        "description": description,
        "details_schema": details_schema,
        "ordering": ordering,
    }


# ═══════════════════════════════════════════════════════════════
# DVIC TEMPLATE ITEMS — transcribed from Apr 2026 PDFs
# ═══════════════════════════════════════════════════════════════
DVIC_ROWS: list[dict] = []
_o = [0]


def _add(*rows):
    """Auto-orders rows in the sequence they're declared."""
    for r in rows:
        r["ordering"] = _o[0]
        DVIC_ROWS.append(r)
        _o[0] += 1


# ─────────────────────────────────────────────────────
# 1. GENERAL — applies to all asset types except where noted
# ─────────────────────────────────────────────────────
# Vehicle Documentation (DOT only)
_add(
    row(
        DOT, DS.GENERAL, "Vehicle Documentation",
        P.INSURANCE_DOC, T.MISSING,
        description="Insurance information, registration, short haul exemption, or "
                    "certification of lease is missing, damaged, illegible, or expired",
    ),
    row(
        DOT, DS.GENERAL, "Vehicle Documentation",
        P.INSPECTION_STICKER, T.EXPIRED,
        description="DOT/CA BIT/State Inspection sticker is missing, damaged, "
                    "illegible, or expired",
        details_schema=SCHEMA_EXPIRATION_DATE,
    ),
)

# State Inspection Tag (CARGO + EDV only — DOT step vans use the
# DOT/CA BIT/State Inspection sticker row above instead). Inspectors pick
# whichever sub-issue applies — same per-issue split we use for license
# plates so work-order routing has a clear cause.
_add(
    row(
        CARGO, DS.GENERAL, "Vehicle Documentation",
        P.INSPECTION_STICKER, T.MISSING,
        description="State inspection tag is missing",
    ),
    row(
        CARGO, DS.GENERAL, "Vehicle Documentation",
        P.INSPECTION_STICKER, T.EXPIRED,
        description="State inspection tag is expired",
        details_schema=SCHEMA_EXPIRATION_DATE,
    ),
)

# Vehicle Cleanliness (all assets)
_add(
    row(
        ALL_ASSETS, DS.GENERAL, "Vehicle Cleanliness",
        P.VEHICLE_INTERIOR, T.HAS_SPILLED_LIQUID,
        description="Interior of vehicle has loose objects/spilled liquid that "
                    "could compromise safely driving the vehicle",
    ),
    row(
        ALL_ASSETS, DS.GENERAL, "Vehicle Cleanliness",
        P.VEHICLE_INTERIOR, T.HAS_TRASH_OR_GRIME,
        description="Interior has trash or excessive grime/dust present",
    ),
    row(
        ALL_ASSETS, DS.GENERAL, "Vehicle Cleanliness",
        P.VEHICLE_INTERIOR, T.HAS_ODOR,
        description="Interior has odor",
    ),
)

# Safety accessories (DOT only)
_add(
    row(
        DOT, DS.GENERAL, "Safety accessories",
        P.SPARE_FUSE, T.MISSING,
        description="Spare fuses or reflective triangles are missing",
    ),
    row(
        DOT, DS.GENERAL, "Safety accessories",
        P.FIRE_EXTINGUISHER, T.NOT_IN_GREEN_ZONE,
        description="Fire extinguisher is missing, not mounted, mounted with a tape, "
                    "zip-tie or similar, or the dial/needle is not in the green zone",
    ),
)

# ─────────────────────────────────────────────────────
# 2. FRONT SIDE
# ─────────────────────────────────────────────────────
# Suspension & underbody shield
_add(
    row(
        ALL_ASSETS, DS.FRONT_SIDE, "Suspension & underbody shield",
        P.SUSPENSION, T.LEANING,
        description="Noticeable leaning of vehicle (when parked)",
    ),
    row(
        ALL_ASSETS, DS.FRONT_SIDE, "Suspension & underbody shield",
        P.UNDERBODY_OBJECT, T.HAS_OBJECTS_UNDERNEATH,
        position=Pos.FRONT,
        description="Loose or hanging objects underneath",
    ),
)

# Lights and light covers (front)
_add(
    row(
        ALL_ASSETS, DS.FRONT_SIDE, "Lights and light covers",
        P.HEADLIGHT, T.NOT_WORKING,
        position_options=[Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE],
        sub_positions=SUB_BEAM,
        description="Headlight is not working",
    ),
    row(
        ALL_ASSETS, DS.FRONT_SIDE, "Lights and light covers",
        P.HAZARD_LIGHT, T.NOT_WORKING,
        position=Pos.FRONT,
        description="Hazard light is not working",
    ),
    row(
        ALL_ASSETS, DS.FRONT_SIDE, "Lights and light covers",
        P.HEADLIGHT, T.CRACKED_OR_HOLE,
        position_options=[Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE],
        description="Any lights or light covers are cracked (leaving hole or void), "
                    "missing, or not working properly",
    ),
)

# Body and doors (DOT only — hood latches)
_add(
    row(
        DOT, DS.FRONT_SIDE, "Body and doors",
        P.HOOD_LATCH, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        description="Items attached to the body of the vehicle (for example: bumpers "
                    "and hood latches) are missing, damaged, loose, unsecure, hanging, "
                    "or held with a zip-tie, tape, or similar",
    ),
)

# ─────────────────────────────────────────────────────
# 3. BACK SIDE
# ─────────────────────────────────────────────────────
_add(
    # Per-issue rows so the inspector picks WHICH problem applies — the
    # original Amazon DVIR collapses these into one line, but breaking them
    # up makes the work-order routing + repair instructions sharper.
    row(
        ALL_ASSETS, DS.BACK_SIDE, "License plates/tags",
        P.LICENSE_PLATE, T.MISSING,
        description="License plate / temp tag is missing",
    ),
    row(
        ALL_ASSETS, DS.BACK_SIDE, "License plates/tags",
        P.LICENSE_PLATE, T.EXPIRED,
        description="License plate / temp tag is expired",
        details_schema=SCHEMA_EXPIRATION_DATE,
    ),
    row(
        ALL_ASSETS, DS.BACK_SIDE, "License plates/tags",
        P.LICENSE_PLATE, T.ILLEGIBLE,
        description="License plate / temp tag is illegible",
    ),
    row(
        ALL_ASSETS, DS.BACK_SIDE, "License plates/tags",
        P.LICENSE_PLATE, T.DAMAGED,
        description="License plate / temp tag is damaged",
    ),
    row(
        ALL_ASSETS, DS.BACK_SIDE, "Suspension & underbody shield",
        P.UNDERBODY_OBJECT, T.HAS_OBJECTS_UNDERNEATH,
        position=Pos.REAR,
        description="Loose or hanging objects underneath",
    ),
)

# Lights and light covers (back)
_add(
    row(
        ALL_ASSETS, DS.BACK_SIDE, "Lights and light covers",
        P.LICENSE_PLATE_LIGHT, T.NOT_WORKING,
        description="License plate light is not working",
    ),
    row(
        ALL_ASSETS, DS.BACK_SIDE, "Lights and light covers",
        P.TAIL_LIGHT, T.NOT_WORKING,
        position_options=[Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE],
        description="Tail light is not working",
    ),
    row(
        ALL_ASSETS, DS.BACK_SIDE, "Lights and light covers",
        P.HAZARD_LIGHT, T.NOT_WORKING,
        position=Pos.REAR,
        description="Hazard light is not working",
    ),
    row(
        ALL_ASSETS, DS.BACK_SIDE, "Lights and light covers",
        P.TAIL_LIGHT, T.CRACKED_OR_HOLE,
        position_options=[Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE],
        description="Any lights or light covers are cracked (leaving hole or void), "
                    "missing, or not working properly",
    ),
)

# Body and doors (back) — Cargo (no lift gate); DOT (with lift gate)
_add(
    row(
        CARGO, DS.BACK_SIDE, "Body and doors",
        P.BUMPER, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        position=Pos.REAR,
        description="Items attached to the body of the vehicle (for example: bumper, "
                    "back-up camera, or rear step) are missing, damaged, loose, "
                    "unsecure, hanging, or held with a zip-tie, tape, or similar",
    ),
    row(
        DOT, DS.BACK_SIDE, "Body and doors",
        P.LIFT_GATE, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        position=Pos.REAR,
        description="Items attached to the body of the vehicle (for example: bumper, "
                    "back-up camera, lift gate, or rear step) are missing, damaged, "
                    "loose, unsecure, hanging, or held with a zip-tie, tape, or similar",
    ),
)


# ─────────────────────────────────────────────────────
# 4. DRIVER SIDE
# ─────────────────────────────────────────────────────
# --- Front tire (driver) ---
# Cargo: 2/32 threshold | DOT: 4/32 (steer)
_add(
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Front tire, wheel and rim",
        P.WHEEL_NUT, T.DAMAGED,
        position=Pos.DRIVER_FRONT,
        description="Wheel, wheel nuts, rim, or mounting equipment is damaged, "
                    "cracked, loose, missing, or broken",
    ),
    row(
        CARGO, DS.DRIVER_SIDE, "Front tire, wheel and rim",
        P.TIRE, T.LOW_TREAD,
        position=Pos.DRIVER_FRONT,
        sub_positions=SUB_TREAD_LOC,
        description="Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner "
                    "most, middle, or outer most tread",
        details_schema=SCHEMA_TREAD_DEPTH_2_32,
    ),
    row(
        DOT, DS.DRIVER_SIDE, "Front tire, wheel and rim",
        P.TIRE, T.LOW_TREAD,
        position=Pos.DRIVER_FRONT,
        sub_positions=SUB_TREAD_LOC,
        description="Tire has insufficient tread (Less than 4/32 or 3.2mm) on inner "
                    "most, middle, or outer most tread",
        details_schema=SCHEMA_TREAD_DEPTH_2_32,
    ),
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Front tire, wheel and rim",
        P.TIRE, T.SIDEWALL_DAMAGE,
        position=Pos.DRIVER_FRONT,
        description="Tire has objects, cuts, dents, swells, leaks, appears flat, or "
                    "exposed wire on surface",
    ),
)

# --- Suspension & underbody shield (driver) ---
_add(
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Suspension & underbody shield",
        P.FLUID_LEAK, T.ACTIVE_LEAK_ON_GROUND,
        position=Pos.DRIVER_SIDE,
        description="Active non-clear fluid leaking on the ground",
    ),
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Suspension & underbody shield",
        P.UNDERBODY_OBJECT, T.HAS_OBJECTS_UNDERNEATH,
        position=Pos.DRIVER_SIDE,
        description="Loose or hanging objects underneath",
    ),
)

# --- Charging port and fluids (DOT only — driver side) ---
_add(
    row(
        DOT, DS.DRIVER_SIDE, "Charging port and fluids",
        P.FUEL_CAP, T.MISSING,
        description="Fuel cap is missing or broken",
    ),
)

# --- Lights and light covers (driver) ---
_add(
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Lights and light covers",
        P.MARKER_LIGHT, T.CRACKED_OR_HOLE,
        position=Pos.DRIVER_SIDE,
        description="Any lights or light covers are cracked (leaving hole or void), "
                    "missing, or not working properly",
    ),
)

# --- Side mirrors (driver) ---
_add(
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Side mirrors",
        P.SIDE_MIRROR, T.CANNOT_BE_ADJUSTED,
        position=Pos.DRIVER_SIDE,
        description="Side mirrors cannot be adjusted",
    ),
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Side mirrors",
        P.SIDE_MIRROR, T.CRACKED,
        position=Pos.DRIVER_SIDE,
        description="Side mirror glass or window glass is cracked, damaged, or missing",
    ),
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Side mirrors",
        P.SIDE_MIRROR, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        position=Pos.DRIVER_SIDE,
        description="Side mirrors are loose, hanging, unsecured, or held up with a "
                    "zip-tie, tape, or similar",
    ),
)

# --- Body and doors (driver — Cargo) ---
_add(
    row(
        CARGO, DS.DRIVER_SIDE, "Body and doors",
        P.SIDE_VIEW_CAMERA, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        position=Pos.DRIVER_SIDE,
        description="Items attached to the body of the vehicle (for example: side view "
                    "camera or cargo steps) are missing, damaged, loose, unsecure, "
                    "hanging, or held with a zip-tie, tape, or similar",
    ),
)

# --- Body and doors (driver — DOT additions) ---
_add(
    row(
        DOT, DS.DRIVER_SIDE, "Body and doors",
        P.SIDE_VIEW_CAMERA, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        position=Pos.DRIVER_SIDE,
        description="Items attached to the body of the vehicle (for example: side view "
                    "camera or cargo steps) are missing, damaged, loose, unsecure, "
                    "hanging, or held with a zip-tie, tape, or similar",
    ),
    row(
        DOT, DS.DRIVER_SIDE, "Body and doors",
        P.AMAZON_DOT_DECAL, T.NOT_VISIBLE,
        position=Pos.DRIVER_SIDE,
        description="Amazon DOT decal (USDOT2881058) is damaged, missing, excessively "
                    "dirty, or not visible, or any existing DOT decals on rental "
                    "vehicles are not covered and visible",
    ),
    row(
        DOT_LARGE_ONLY, DS.DRIVER_SIDE, "Body and doors",
        P.BATTERY_COVER, T.BATTERY_COVER_MISSING,
        position=Pos.DRIVER_SIDE,
        description="Battery is properly installed with cover present, securely "
                    "latched or fastened, and no bolts missing (Box Trucks only)",
    ),
    row(
        DOT, DS.DRIVER_SIDE, "Body and doors",
        P.PRIME_DECAL, T.NOT_VISIBLE,
        position=Pos.DRIVER_SIDE,
        description="Prime decal is damaged, missing, excessively dirty, or not visible",
    ),
)

# --- Back tire (driver) ---
_add(
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Back tire, wheel and rim",
        P.WHEEL_NUT, T.DAMAGED,
        position=Pos.DRIVER_REAR,
        description="Wheel, wheel nuts, rim, or mounting equipment is damaged, "
                    "cracked, loose, missing, or broken",
    ),
    row(
        DOT, DS.DRIVER_SIDE, "Back tire, wheel and rim",
        P.MUD_FLAP, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        position=Pos.DRIVER_REAR,
        description="Mud Flap is damaged, missing, unsecured or held up with a "
                    "zip-tie, tape or similar",
    ),
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Back tire, wheel and rim",
        P.TIRE, T.LOW_TREAD,
        position=Pos.DRIVER_REAR,
        sub_positions=SUB_TREAD_LOC,
        description="Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner "
                    "most, middle, or outer most tread",
        details_schema=SCHEMA_TREAD_DEPTH_2_32,
    ),
    row(
        ALL_ASSETS, DS.DRIVER_SIDE, "Back tire, wheel and rim",
        P.TIRE, T.SIDEWALL_DAMAGE,
        position=Pos.DRIVER_REAR,
        description="Tire has objects, cuts, dents, swells, leaks, appears flat, or "
                    "exposed wire on surface",
    ),
)


# ─────────────────────────────────────────────────────
# 5. PASSENGER SIDE — mirror of driver side (no fluid leak / fuel cap rows)
# ─────────────────────────────────────────────────────
_add(
    # Front tire
    row(
        ALL_ASSETS, DS.PASSENGER_SIDE, "Front tire, wheel and rim",
        P.WHEEL_NUT, T.DAMAGED,
        position=Pos.PASSENGER_FRONT,
        description="Wheel, wheel nuts, rim, or mounting equipment is damaged, "
                    "cracked, loose, missing, or broken",
    ),
    row(
        CARGO, DS.PASSENGER_SIDE, "Front tire, wheel and rim",
        P.TIRE, T.LOW_TREAD,
        position=Pos.PASSENGER_FRONT,
        sub_positions=SUB_TREAD_LOC,
        description="Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner "
                    "most, middle, or outer most tread",
        details_schema=SCHEMA_TREAD_DEPTH_2_32,
    ),
    row(
        DOT, DS.PASSENGER_SIDE, "Front tire, wheel and rim",
        P.TIRE, T.LOW_TREAD,
        position=Pos.PASSENGER_FRONT,
        sub_positions=SUB_TREAD_LOC,
        description="Tire has insufficient tread (Less than 4/32 or 3.2mm) on inner "
                    "most, middle, or outer most tread",
        details_schema=SCHEMA_TREAD_DEPTH_2_32,
    ),
    row(
        ALL_ASSETS, DS.PASSENGER_SIDE, "Front tire, wheel and rim",
        P.TIRE, T.SIDEWALL_DAMAGE,
        position=Pos.PASSENGER_FRONT,
        description="Tire has objects, cuts, dents, swells, leaks, appears flat, or "
                    "exposed wire on surface",
    ),
    # Suspension
    row(
        ALL_ASSETS, DS.PASSENGER_SIDE, "Suspension & underbody shield",
        P.UNDERBODY_OBJECT, T.HAS_OBJECTS_UNDERNEATH,
        position=Pos.PASSENGER_SIDE,
        description="Loose or hanging objects underneath",
    ),
    # Lights
    row(
        ALL_ASSETS, DS.PASSENGER_SIDE, "Lights and light covers",
        P.MARKER_LIGHT, T.CRACKED_OR_HOLE,
        position=Pos.PASSENGER_SIDE,
        description="Any lights or light covers are cracked (leaving hole or void), "
                    "missing, or not working properly",
    ),
    # Side mirrors
    row(
        ALL_ASSETS, DS.PASSENGER_SIDE, "Side mirrors",
        P.SIDE_MIRROR, T.CANNOT_BE_ADJUSTED,
        position=Pos.PASSENGER_SIDE,
        description="Side mirrors cannot be adjusted",
    ),
    row(
        ALL_ASSETS, DS.PASSENGER_SIDE, "Side mirrors",
        P.SIDE_MIRROR, T.CRACKED,
        position=Pos.PASSENGER_SIDE,
        description="Side mirror glass or window glass is cracked, damaged, or missing",
    ),
    row(
        ALL_ASSETS, DS.PASSENGER_SIDE, "Side mirrors",
        P.SIDE_MIRROR, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        position=Pos.PASSENGER_SIDE,
        description="Side mirrors are loose, hanging, unsecured, or held up with a "
                    "zip-tie, tape, or similar",
    ),
    # Body & doors (Cargo)
    row(
        CARGO, DS.PASSENGER_SIDE, "Body and doors",
        P.SIDE_VIEW_CAMERA, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        position=Pos.PASSENGER_SIDE,
        description="Items attached to the body of the vehicle (for example: side view "
                    "camera or cargo steps) are missing, damaged, loose, unsecure, "
                    "hanging, or held with a zip-tie, tape, or similar",
    ),
    # Body & doors (DOT additions)
    row(
        DOT, DS.PASSENGER_SIDE, "Body and doors",
        P.SIDE_VIEW_CAMERA, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        position=Pos.PASSENGER_SIDE,
        description="Items attached to the body of the vehicle (for example: side view "
                    "camera or cargo steps) are missing, damaged, loose, unsecure, "
                    "hanging, or held with a zip-tie, tape, or similar",
    ),
    row(
        DOT, DS.PASSENGER_SIDE, "Body and doors",
        P.AMAZON_DOT_DECAL, T.NOT_VISIBLE,
        position=Pos.PASSENGER_SIDE,
        description="Amazon DOT decal (USDOT2881058) is damaged, missing, excessively "
                    "dirty, or not visible, or any existing DOT decals on rental "
                    "vehicles are not covered and visible",
    ),
    row(
        DOT, DS.PASSENGER_SIDE, "Body and doors",
        P.PRIME_DECAL, T.NOT_VISIBLE,
        position=Pos.PASSENGER_SIDE,
        description="Prime decal is damaged, missing, excessively dirty, or not visible",
    ),
    # Back tire
    row(
        ALL_ASSETS, DS.PASSENGER_SIDE, "Back tire, wheel and rim",
        P.WHEEL_NUT, T.DAMAGED,
        position=Pos.PASSENGER_REAR,
        description="Wheel, wheel nuts, rim, or mounting equipment is damaged, "
                    "cracked, loose, missing, or broken",
    ),
    row(
        DOT, DS.PASSENGER_SIDE, "Back tire, wheel and rim",
        P.MUD_FLAP, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        position=Pos.PASSENGER_REAR,
        description="Mud Flap is damaged, missing, unsecured or held up with a "
                    "zip-tie, tape or similar",
    ),
    row(
        ALL_ASSETS, DS.PASSENGER_SIDE, "Back tire, wheel and rim",
        P.TIRE, T.LOW_TREAD,
        position=Pos.PASSENGER_REAR,
        sub_positions=SUB_TREAD_LOC,
        description="Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner "
                    "most, middle, or outer most tread",
        details_schema=SCHEMA_TREAD_DEPTH_2_32,
    ),
    row(
        ALL_ASSETS, DS.PASSENGER_SIDE, "Back tire, wheel and rim",
        P.TIRE, T.SIDEWALL_DAMAGE,
        position=Pos.PASSENGER_REAR,
        description="Tire has objects, cuts, dents, swells, leaks, appears flat, or "
                    "exposed wire on surface",
    ),
)


# ─────────────────────────────────────────────────────
# 6. IN CAB
# ─────────────────────────────────────────────────────
# Wipers
_add(
    row(
        ALL_ASSETS, DS.IN_CAB, "Wipers",
        P.WIPER_BLADE, T.NOT_WORKING,
        description="Wiper blades are missing, damaged, or not working",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Wipers",
        P.WASHER_SYSTEM, T.NOT_WORKING,
        description="Windshield washer system is not working and/or wiper fluid "
                    "reservoir is empty",
    ),
)

# Driver Seat
_add(
    row(
        ALL_ASSETS, DS.IN_CAB, "Driver Seat",
        P.DRIVER_SEAT, T.EXPOSED_INTERIOR,
        description="Seat integrity is compromised (for example: cannot be adjusted, "
                    "has exposed metal, wire, spring, or missing, torn, loose cushioning)",
    ),
)

# Brakes
_add(
    row(
        ALL_ASSETS, DS.IN_CAB, "Brakes",
        P.SERVICE_BRAKE, T.SQUEAKING,
        description="Foot brake is squeaking, loose, weak, or stiff",
    ),
    row(
        DOT, DS.IN_CAB, "Brakes",
        P.AIR_PRESSURE_GAUGE, T.READS_OVER_120_PSI,
        description="Air pressure gauge reads more than 120 PSI",
        details_schema=SCHEMA_AIR_PSI,
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Brakes",
        P.SERVICE_BRAKE, T.GRINDING,
        description="Foot brake is grinding, vibrates, leaking air, or not working",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Brakes",
        P.PARKING_BRAKE, T.WEAK,
        description="Parking brake is loose, weak, or stiff",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Brakes",
        P.PARKING_BRAKE, T.NOT_WORKING,
        description="Parking brake is not working",
    ),
)

# HVAC
_add(
    row(
        ALL_ASSETS, DS.IN_CAB, "HVAC systems",
        P.DEFROSTER, T.NOT_WORKING,
        description="Defroster/heater is not working",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "HVAC systems",
        P.AC, T.NO_COLD_AIR,
        description="AC is not blowing cold air",
    ),
)

# Steering, seatbelt, horn, alarm
_add(
    row(
        ALL_ASSETS, DS.IN_CAB, "Steering, seatbelt, horn, and alarm",
        P.HORN, T.NOT_WORKING,
        description="Horn, backup alarm, or seatbelt alarm is not working",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Steering, seatbelt, horn, and alarm",
        P.SEATBELT, T.MISSING,
        sub_positions=SUB_SEATBELT_PART,
        description="Seatbelt: anchor, buckle, casing, or belt is missing, torn, "
                    "frayed, or not working",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Steering, seatbelt, horn, and alarm",
        P.STEERING_WHEEL, T.VIBRATION,
        description="Steering wheel has excessive vibration",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Steering, seatbelt, horn, and alarm",
        P.STEERING_WHEEL, T.NEEDS_ALIGNMENT,
        description="Steering wheel is stiff, loose, or needs alignment",
    ),
)

# Lights and light covers (cab)
_add(
    row(
        ALL_ASSETS, DS.IN_CAB, "Lights and light covers",
        P.TURN_SIGNAL, T.NOT_WORKING,
        # Turn signals exist on all four corners of the vehicle. Inspectors
        # tell us which corner by picking on two axes:
        #   1. position (FRONT vs REAR)   — the standard DefectPosition slot
        #   2. sub_position (driver vs passenger side) — stored in details
        #      under `lateral_side` (see subPositionKeyForPart in DvicWizard).
        position_options=[Pos.FRONT, Pos.REAR],
        sub_positions=[
            {"key": "driver_side", "label": "Driver side"},
            {"key": "passenger_side", "label": "Passenger side"},
        ],
        description="Turn signal is not working",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Lights and light covers",
        P.WARNING_LAMP, T.NOT_WORKING,
        description="Dashboard light is not working",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Lights and light covers",
        P.WARNING_LAMP, T.ON_OR_FLASHING,
        sub_positions=SUB_WARNING_LAMPS,
        description="Any red warning lights/lamps are on or flashing",
        details_schema=SCHEMA_WARNING_LAMP,
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Lights and light covers",
        P.HAZARD_LIGHT, T.NOT_WORKING,
        description="Hazard light is not working",
    ),
)

# Body and doors (cab)
_add(
    row(
        ALL_ASSETS, DS.IN_CAB, "Body and doors",
        P.BULKHEAD_DOOR, T.WONT_OPEN,
        description="Interior sliding door (bulkhead doors) cannot open or close",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Body and doors",
        P.SHELF, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        description="Items attached to the body of the vehicle (for example: shelves, "
                    "floor panels) are missing, damaged, loose, unsecure, hanging, or "
                    "held with a zip-tie, tape, or similar",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Body and doors",
        P.EXTERIOR_DOOR, T.WONT_OPEN,
        sub_positions=SUB_DOOR,
        description="One or more exterior doors (driver, passenger, cargo, or back "
                    "door) cannot open, close, lock, or unlock properly from the "
                    "inside of the vehicle",
    ),
)

# Safety accessories (cab)
_add(
    row(
        ALL_ASSETS, DS.IN_CAB, "Safety accessories",
        P.DELIVERY_DEVICE_CRADLE, T.ITEMS_LOOSE_OR_HELD_WITH_TAPE,
        description="Delivery device cradle is damaged, missing, or is mounted with "
                    "a tape, zip-tie or similar",
    ),
)

# Camera/monitor
_add(
    row(
        ALL_ASSETS, DS.IN_CAB, "Camera/monitor",
        P.NETRADYNE_CAMERA, T.HANGING,
        description="Netradyne camera is hanging/disconnected from bracket",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Camera/monitor",
        P.CAMERA_MONITOR, T.OBSTRUCTED,
        description="Rear or side camera monitor is missing, broken, unsecure, "
                    "obstructed, or not working",
    ),
)

# Windshield
_add(
    row(
        ALL_ASSETS, DS.IN_CAB, "Windshield",
        P.WINDSHIELD, T.CRACKED,
        description="Any crack, chip, stars on the windshield >1/2 inch (excluding "
                    "1 inch boarder of windshield)",
    ),
    row(
        ALL_ASSETS, DS.IN_CAB, "Windshield",
        P.DEVICE_ON_WINDSHIELD, T.DEVICE_MOUNTED,
        description="Device/Accessory is mounted on the windshield",
    ),
)


# ─────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────
def get_dvic_template_seed() -> list[dict]:
    """Return the full list of DVIC template item seeds (~50 rows)."""
    return DVIC_ROWS
