"""Seed data for the defect catalog reference tables.

Driven by the Notion 'Defect Data Schema' spec. Run via:
    python -m app.cli seed-defect-catalog

Idempotent: re-running upserts existing rows (no duplicates).
"""
from app.models.defect_catalog import DefectPart as P
from app.models.defect_catalog import DefectPosition as Pos
from app.models.defect_catalog import DefectSystem as S
from app.models.defect_catalog import DefectType as T

# ─────────────────────────────────────────────────────
# defect_part_system seed
# Each tuple: (part, system, is_primary, display_group)
# Primary marker drives dashboard rollups; display_group drives UI grouping
# inside a system tile when count >= 6.
# ─────────────────────────────────────────────────────
PART_SYSTEM_ROWS = [
    # tires_wheels — flat
    (P.TIRE, S.TIRES_WHEELS, True, None),
    (P.RIM, S.TIRES_WHEELS, True, None),
    (P.WHEEL_NUT, S.TIRES_WHEELS, True, None),
    (P.MOUNTING_EQUIPMENT, S.TIRES_WHEELS, True, None),

    # lights — 3 groups (exterior / cabin_cargo / attached)
    (P.HEADLIGHT, S.LIGHTS, True, "exterior"),
    (P.TAIL_LIGHT, S.LIGHTS, True, "exterior"),
    (P.TURN_SIGNAL, S.LIGHTS, True, "exterior"),
    (P.HAZARD_LIGHT, S.LIGHTS, True, "exterior"),
    (P.MARKER_LIGHT, S.LIGHTS, True, "exterior"),
    (P.LICENSE_PLATE_LIGHT, S.LIGHTS, True, "exterior"),
    (P.CABIN_LIGHT, S.LIGHTS, True, "cabin_cargo"),
    (P.CARGO_LIGHT, S.LIGHTS, True, "cabin_cargo"),
    (P.STEPWELL_LIGHT, S.LIGHTS, True, "attached"),
    (P.MIRROR_LIGHT, S.LIGHTS, True, "attached"),
    # secondary appearances
    (P.MIRROR_LIGHT, S.MIRRORS, False, None),
    (P.STEPWELL_LIGHT, S.BODY_STEPS, False, None),
    (P.CABIN_LIGHT, S.INTERIOR, False, "cab"),
    (P.CARGO_LIGHT, S.INTERIOR, False, "cab"),

    # windshield_wipers
    (P.WINDSHIELD, S.WINDSHIELD_WIPERS, True, None),
    (P.WIPER_BLADE, S.WINDSHIELD_WIPERS, True, None),
    (P.WASHER_SYSTEM, S.WINDSHIELD_WIPERS, True, None),
    (P.WASHER_SYSTEM, S.FLUIDS_UNDER_HOOD, False, None),

    # mirrors
    (P.SIDE_MIRROR, S.MIRRORS, True, None),

    # body_steps
    (P.BUMPER, S.BODY_STEPS, True, "panels"),
    (P.FENDER, S.BODY_STEPS, True, "panels"),
    (P.HOOD, S.BODY_STEPS, True, "panels"),
    (P.SIDE_PANEL, S.BODY_STEPS, True, "panels"),
    (P.FLOOR_PANEL, S.BODY_STEPS, True, "panels"),
    (P.SIDE_STEP, S.BODY_STEPS, True, "steps"),
    (P.REAR_STEP, S.BODY_STEPS, True, "steps"),

    # doors_windows
    (P.EXTERIOR_DOOR, S.DOORS_WINDOWS, True, "doors"),
    (P.SLIDING_SIDE_DOOR, S.DOORS_WINDOWS, True, "doors"),
    (P.BULKHEAD_DOOR, S.DOORS_WINDOWS, True, "doors"),
    (P.REAR_CARGO_DOOR, S.DOORS_WINDOWS, True, "doors"),
    (P.ROLL_UP_DOOR, S.DOORS_WINDOWS, True, "doors"),
    (P.WINDOW, S.DOORS_WINDOWS, True, "windows"),
    (P.DOOR_HARDWARE, S.DOORS_WINDOWS, True, "hardware"),

    # interior — 5 display groups
    (P.DRIVER_SEAT, S.INTERIOR, True, "seating"),
    (P.PASSENGER_SEAT, S.INTERIOR, True, "seating"),
    (P.SEATBELT, S.INTERIOR, True, "restraints"),
    (P.SEATBELT_BUCKLE, S.INTERIOR, True, "restraints"),
    (P.SEATBELT, S.COMPLIANCE, False, "safety"),
    (P.SEATBELT_BUCKLE, S.COMPLIANCE, False, "safety"),
    (P.SUN_VISOR, S.INTERIOR, True, "cab"),
    (P.INTERIOR_CLEANLINESS, S.INTERIOR, True, "cleanliness"),
    (P.INTERIOR_LOOSE_OBJECTS, S.INTERIOR, True, "cleanliness"),
    (P.FIRE_EXTINGUISHER, S.INTERIOR, True, "safety_gear"),
    (P.FIRE_EXTINGUISHER, S.COMPLIANCE, False, "safety"),

    # brakes_steering
    (P.PARKING_BRAKE, S.BRAKES_STEERING, True, None),
    (P.SERVICE_BRAKE, S.BRAKES_STEERING, True, None),
    (P.STEERING_WHEEL, S.BRAKES_STEERING, True, None),
    (P.ALIGNMENT, S.BRAKES_STEERING, True, None),

    # hvac
    (P.AC, S.HVAC, True, None),
    (P.HEATER, S.HVAC, True, None),
    (P.DEFROSTER, S.HVAC, True, None),
    (P.CABIN_FAN, S.HVAC, True, None),
    (P.AC, S.INTERIOR, False, "cab"),
    (P.HEATER, S.INTERIOR, False, "cab"),
    (P.DEFROSTER, S.INTERIOR, False, "cab"),

    # cameras_electronics — 4 display groups
    (P.NETRADYNE_CAMERA, S.CAMERAS_ELECTRONICS, True, "cameras"),
    (P.REAR_CAMERA, S.CAMERAS_ELECTRONICS, True, "cameras"),
    (P.SIDE_CAMERA, S.CAMERAS_ELECTRONICS, True, "cameras"),
    (P.CAMERA_MONITOR, S.CAMERAS_ELECTRONICS, True, "cameras"),
    (P.WARNING_LAMP, S.CAMERAS_ELECTRONICS, True, "alerts"),
    (P.BACKUP_ALARM, S.CAMERAS_ELECTRONICS, True, "alerts"),
    (P.SEATBELT_ALARM, S.CAMERAS_ELECTRONICS, True, "alerts"),
    (P.HORN, S.CAMERAS_ELECTRONICS, True, "alerts"),
    (P.USB_PORT, S.CAMERAS_ELECTRONICS, True, "charging"),
    (P.PHONE_CHARGER, S.CAMERAS_ELECTRONICS, True, "charging"),
    (P.DELIVERY_DEVICE_CRADLE, S.CAMERAS_ELECTRONICS, True, "mounts"),
    (P.PHONE_CRADLE, S.CAMERAS_ELECTRONICS, True, "mounts"),

    # fluids_under_hood
    (P.COOLANT, S.FLUIDS_UNDER_HOOD, True, None),
    (P.BRAKE_FLUID, S.FLUIDS_UNDER_HOOD, True, None),
    (P.POWER_STEERING_FLUID, S.FLUIDS_UNDER_HOOD, True, None),
    (P.DEF_FLUID, S.FLUIDS_UNDER_HOOD, True, None),
    (P.ENGINE_OIL, S.FLUIDS_UNDER_HOOD, True, None),
    (P.GEAR_OIL, S.FLUIDS_UNDER_HOOD, True, None),

    # compliance
    (P.LICENSE_PLATE, S.COMPLIANCE, True, "plates"),
    (P.INSPECTION_STICKER, S.COMPLIANCE, True, "stickers"),
    (P.REGISTRATION_STICKER, S.COMPLIANCE, True, "stickers"),

    # under_vehicle
    (P.UNDERCARRIAGE_OBJECT, S.UNDER_VEHICLE, True, None),

    # ── DVIC-specific parts (Cargo + DOT PDFs, Apr 2026) ──
    # These mirror the additions in DefectPart enum and the DVIC template seed.
    (P.SUSPENSION, S.UNDER_VEHICLE, True, None),
    (P.UNDERBODY_OBJECT, S.UNDER_VEHICLE, True, None),
    (P.FLUID_LEAK, S.UNDER_VEHICLE, True, None),
    (P.FLUID_LEAK, S.FLUIDS_UNDER_HOOD, False, None),
    (P.HOOD_LATCH, S.BODY_STEPS, True, "panels"),
    (P.LIFT_GATE, S.BODY_STEPS, True, "panels"),
    (P.BACKUP_CAMERA, S.CAMERAS_ELECTRONICS, True, "cameras"),
    (P.SIDE_VIEW_CAMERA, S.CAMERAS_ELECTRONICS, True, "cameras"),
    (P.CARGO_STEP, S.BODY_STEPS, True, "steps"),
    (P.FUEL_CAP, S.FLUIDS_UNDER_HOOD, True, None),
    (P.MUD_FLAP, S.BODY_STEPS, True, "panels"),
    (P.BATTERY_COVER, S.BODY_STEPS, True, "panels"),
    (P.AMAZON_DOT_DECAL, S.COMPLIANCE, True, "stickers"),
    (P.PRIME_DECAL, S.COMPLIANCE, True, "stickers"),
    (P.INSURANCE_DOC, S.COMPLIANCE, True, "docs"),
    (P.REGISTRATION_DOC, S.COMPLIANCE, True, "docs"),
    (P.SHELF, S.INTERIOR, True, "cab"),
    (P.SPARE_FUSE, S.INTERIOR, True, "safety_gear"),
    (P.SPARE_FUSE, S.COMPLIANCE, False, "safety"),
    (P.REFLECTIVE_TRIANGLE, S.INTERIOR, True, "safety_gear"),
    (P.REFLECTIVE_TRIANGLE, S.COMPLIANCE, False, "safety"),
    (P.AIR_PRESSURE_GAUGE, S.BRAKES_STEERING, True, None),
    (P.VEHICLE_INTERIOR, S.INTERIOR, True, "cleanliness"),
    (P.DEVICE_ON_WINDSHIELD, S.WINDSHIELD_WIPERS, True, None),
]


# ─────────────────────────────────────────────────────
# defect_part_validity seed
# Each tuple: (part, [valid_positions], position_required, allow_null_position)
# ─────────────────────────────────────────────────────
FOUR_CORNER = [Pos.DRIVER_FRONT, Pos.PASSENGER_FRONT, Pos.DRIVER_REAR, Pos.PASSENGER_REAR]
LEFT_RIGHT = [Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE]
LEFT_RIGHT_OPTIONAL = [Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE]
DRIVER_PASSENGER = [Pos.DRIVER, Pos.PASSENGER]
FRONT_REAR = [Pos.FRONT, Pos.REAR]

PART_VALIDITY_ROWS = [
    # 4-corner parts
    (P.TIRE, FOUR_CORNER, True, False),
    (P.RIM, FOUR_CORNER, True, False),
    (P.WHEEL_NUT, FOUR_CORNER, True, False),
    (P.MOUNTING_EQUIPMENT, FOUR_CORNER, True, False),

    # left/right required
    (P.HEADLIGHT, LEFT_RIGHT, True, False),
    (P.TAIL_LIGHT, LEFT_RIGHT, True, False),
    # turn signal: DVIC wizard picker allows L/R + front/rear (cab dashboard usage)
    (P.TURN_SIGNAL, [Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE, Pos.FRONT, Pos.REAR], True, False),
    # hazard light: front-side + back-side rows pin position; in-cab row has none
    (P.HAZARD_LIGHT, [Pos.FRONT, Pos.REAR], False, True),
    (P.WIPER_BLADE, LEFT_RIGHT, True, False),
    (P.MARKER_LIGHT, LEFT_RIGHT, True, False),
    (P.STEPWELL_LIGHT, LEFT_RIGHT, True, False),
    (P.MIRROR_LIGHT, LEFT_RIGHT, True, False),
    (P.SIDE_MIRROR, LEFT_RIGHT, True, False),
    (P.SIDE_CAMERA, LEFT_RIGHT, True, False),
    (P.SLIDING_SIDE_DOOR, LEFT_RIGHT, True, False),
    (P.WINDOW, LEFT_RIGHT, True, False),
    (P.FENDER, LEFT_RIGHT, True, False),
    (P.SIDE_STEP, LEFT_RIGHT, True, False),
    (P.SIDE_PANEL, LEFT_RIGHT, True, False),

    # left/right optional (single-instance possible)
    (P.LICENSE_PLATE_LIGHT, LEFT_RIGHT_OPTIONAL, False, True),
    (P.LICENSE_PLATE, LEFT_RIGHT_OPTIONAL, False, True),
    (P.CABIN_FAN, LEFT_RIGHT_OPTIONAL, False, True),

    # driver/passenger interior
    (P.SEATBELT, DRIVER_PASSENGER, True, False),
    (P.SEATBELT_BUCKLE, DRIVER_PASSENGER, True, False),
    (P.SUN_VISOR, DRIVER_PASSENGER, False, True),

    # front/rear
    (P.BUMPER, FRONT_REAR, True, False),
    (P.UNDERCARRIAGE_OBJECT, FRONT_REAR, False, True),

    # exterior_door (driver_side / passenger_side / rear)
    (P.EXTERIOR_DOOR, [Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE, Pos.REAR], True, False),
    (P.DOOR_HARDWARE, [Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE, Pos.REAR], False, True),

    # ── DVIC-specific parts (Apr 2026 PDFs) ──
    # under-vehicle objects can be reported per side or front/rear
    (P.UNDERBODY_OBJECT, [Pos.FRONT, Pos.REAR, Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE], False, True),
    # fluid leaks happen on the ground under driver/passenger side
    (P.FLUID_LEAK, [Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE], False, True),
    # rear-only parts (lift gate, backup camera)
    (P.LIFT_GATE, [Pos.REAR], False, True),
    (P.BACKUP_CAMERA, [Pos.REAR], False, True),
    # left/right body parts
    (P.SIDE_VIEW_CAMERA, LEFT_RIGHT, True, False),
    (P.AMAZON_DOT_DECAL, LEFT_RIGHT, True, False),
    (P.PRIME_DECAL, LEFT_RIGHT, True, False),
    # cargo step can appear on either side or rear
    (P.CARGO_STEP, [Pos.DRIVER_SIDE, Pos.PASSENGER_SIDE, Pos.REAR], False, True),
    # mud flap pinned to rear-corner per Amazon DVIC spec
    (P.MUD_FLAP, [Pos.DRIVER_REAR, Pos.PASSENGER_REAR], True, False),
    # battery cover: DOT box trucks only — driver-side panel
    (P.BATTERY_COVER, [Pos.DRIVER_SIDE], False, True),
]

# All other parts: no position
NO_POSITION_PARTS = [
    # NB: HAZARD_LIGHT was here historically — moved above to a positioned-row
    # so the front/rear DVIC entries pass validation.
    P.CABIN_LIGHT, P.CARGO_LIGHT,
    P.WINDSHIELD, P.WASHER_SYSTEM,
    P.HOOD, P.FLOOR_PANEL, P.REAR_STEP,
    P.BULKHEAD_DOOR, P.REAR_CARGO_DOOR, P.ROLL_UP_DOOR,
    P.DRIVER_SEAT, P.PASSENGER_SEAT,
    P.INTERIOR_CLEANLINESS, P.INTERIOR_LOOSE_OBJECTS, P.FIRE_EXTINGUISHER,
    P.PARKING_BRAKE, P.SERVICE_BRAKE, P.STEERING_WHEEL, P.ALIGNMENT,
    P.AC, P.HEATER, P.DEFROSTER,
    P.NETRADYNE_CAMERA, P.REAR_CAMERA, P.CAMERA_MONITOR,
    P.WARNING_LAMP, P.BACKUP_ALARM, P.SEATBELT_ALARM, P.HORN,
    P.USB_PORT, P.PHONE_CHARGER, P.DELIVERY_DEVICE_CRADLE, P.PHONE_CRADLE,
    P.COOLANT, P.BRAKE_FLUID, P.POWER_STEERING_FLUID,
    P.DEF_FLUID, P.ENGINE_OIL, P.GEAR_OIL,
    P.INSPECTION_STICKER, P.REGISTRATION_STICKER,
    # ── DVIC-specific NO_POSITION additions ──
    P.SUSPENSION,           # whole-vehicle leaning check
    P.HOOD_LATCH,           # singular front part
    P.FUEL_CAP,             # singular front/side part
    P.INSURANCE_DOC,        # paper documentation
    P.REGISTRATION_DOC,     # paper documentation
    P.SHELF,                # interior cargo area
    P.SPARE_FUSE,           # in-cab safety gear
    P.REFLECTIVE_TRIANGLE,  # in-cab safety gear
    P.AIR_PRESSURE_GAUGE,   # dashboard gauge
    P.VEHICLE_INTERIOR,     # whole-cabin cleanliness
    P.DEVICE_ON_WINDSHIELD, # accessory mounted on windshield
]
PART_VALIDITY_ROWS.extend((p, [], False, True) for p in NO_POSITION_PARTS)


# ─────────────────────────────────────────────────────
# defect_details_schema seed (truncated subset — full set in DB)
# Each tuple: (part, defect_type, json_schema_dict)
# ─────────────────────────────────────────────────────
EMPTY_SCHEMA: dict = {}

# Compact helper: expand a part + list of types → rows.
# Severity-related arguments are accepted but ignored (kept for backward compat
# with the existing call sites until they're rewritten).
def _flat(part, types, default_sev=None, schema=None):
    out = []
    s = schema if schema is not None else EMPTY_SCHEMA
    for t in types:
        out.append((part, t, s))
    return out


DETAILS_SCHEMA_ROWS = []

# tire — most common defect types + structured low_tread
DETAILS_SCHEMA_ROWS.extend(_flat(P.TIRE, [
    T.FLAT, T.SIDEWALL_DAMAGE, T.OBJECT_EMBEDDED, T.EXPOSED_WIRE, T.BULGE,
    T.LEAKING, T.MISSING,
]))
DETAILS_SCHEMA_ROWS.append((
    P.TIRE, T.LOW_TREAD,
    {
        "type": "object",
        "required": ["tread_depth_32nds"],
        "properties": {"tread_depth_32nds": {"type": "integer", "minimum": 0, "maximum": 10}},
        "additionalProperties": False,
    },
))

# rim, wheel_nut, mounting_equipment
DETAILS_SCHEMA_ROWS.extend(_flat(P.RIM, [T.DAMAGED, T.CRACKED, T.BENT, T.RUSTED]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.WHEEL_NUT, [T.MISSING, T.LOOSE, T.DAMAGED, T.RUSTED]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.MOUNTING_EQUIPMENT, [
    T.STUD_BROKEN, T.HUB_CAP_MISSING, T.LOOSE, T.DAMAGED, T.OTHER_DAMAGE,
]))

# Lights — most accept not_working, missing, damaged
LIGHT_PARTS = [
    P.HEADLIGHT, P.TAIL_LIGHT, P.TURN_SIGNAL, P.HAZARD_LIGHT,
    P.MARKER_LIGHT, P.LICENSE_PLATE_LIGHT,
    P.CABIN_LIGHT, P.CARGO_LIGHT, P.STEPWELL_LIGHT, P.MIRROR_LIGHT,
]
for part in LIGHT_PARTS:
    DETAILS_SCHEMA_ROWS.extend(_flat(
        part, [T.NOT_WORKING, T.INTERMITTENT, T.FLICKERING, T.MISSING, T.DAMAGED, T.CRACKED, T.COVER_CRACKED, T.COVER_MISSING]
    ))

# Windshield + wipers
DETAILS_SCHEMA_ROWS.append((
    P.WINDSHIELD, T.CRACKED,
    {
        "type": "object",
        "required": ["in_drivers_line_of_sight"],
        "properties": {"in_drivers_line_of_sight": {"type": "boolean"}},
        "additionalProperties": False,
    },
))
DETAILS_SCHEMA_ROWS.extend(_flat(P.WINDSHIELD, [T.ZIP_TIED_OR_TAPED, T.OTHER_DAMAGE]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.WIPER_BLADE, [T.NOT_WORKING, T.TORN, T.MISSING, T.DAMAGED]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.WASHER_SYSTEM, [T.NOT_WORKING, T.LEAKING, T.EMPTY]))

# Mirrors
DETAILS_SCHEMA_ROWS.extend(_flat(P.SIDE_MIRROR, [
    T.CRACKED, T.BROKEN, T.MISSING, T.DAMAGED, T.LOOSE, T.MISALIGNED,
]))

# Body & steps
BODY_PARTS = [P.BUMPER, P.FENDER, P.HOOD, P.SIDE_PANEL, P.FLOOR_PANEL, P.SIDE_STEP, P.REAR_STEP]
for part in BODY_PARTS:
    DETAILS_SCHEMA_ROWS.extend(_flat(part, [
        T.DAMAGED, T.CRACKED, T.BROKEN, T.BENT, T.MISSING, T.LOOSE, T.HANGING, T.RUSTED,
    ]))

# Doors & windows
DOOR_PARTS = [P.EXTERIOR_DOOR, P.SLIDING_SIDE_DOOR, P.BULKHEAD_DOOR, P.REAR_CARGO_DOOR, P.ROLL_UP_DOOR]
for part in DOOR_PARTS:
    DETAILS_SCHEMA_ROWS.extend(_flat(part, [
        T.WONT_OPEN, T.WONT_CLOSE, T.WONT_LOCK, T.WONT_UNLOCK, T.WONT_LATCH,
        T.STUCK, T.OFF_TRACK, T.DAMAGED, T.MISALIGNED,
    ]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.WINDOW, [
    T.CRACKED, T.BROKEN, T.WONT_OPEN, T.WONT_CLOSE, T.STUCK,
]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.DOOR_HARDWARE, [T.DAMAGED, T.MISSING, T.LOOSE, T.NEEDS_GREASE]))

# Interior
DETAILS_SCHEMA_ROWS.extend(_flat(P.DRIVER_SEAT, [T.DAMAGED, T.TORN, T.LOOSE, T.STUCK, T.MOUNT_DAMAGED]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.PASSENGER_SEAT, [T.DAMAGED, T.TORN, T.LOOSE, T.STUCK, T.MOUNT_DAMAGED]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.SEATBELT, [T.NOT_WORKING, T.WONT_RETRACT, T.FRAYED, T.DAMAGED, T.MISSING]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.SEATBELT_BUCKLE, [T.NOT_WORKING, T.WONT_LATCH, T.DAMAGED, T.MISSING]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.SUN_VISOR, [T.DAMAGED, T.MISSING, T.LOOSE, T.BROKEN]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.INTERIOR_CLEANLINESS, [T.DIRTY]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.INTERIOR_LOOSE_OBJECTS, [T.HAS_LOOSE_OBJECTS]))

# Fire extinguisher (compliance dual-listed)
DETAILS_SCHEMA_ROWS.append((
    P.FIRE_EXTINGUISHER, T.EXPIRED,
    {
        "type": "object",
        "properties": {"expiration_date": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}},
        "additionalProperties": False,
    },
))
DETAILS_SCHEMA_ROWS.extend(_flat(P.FIRE_EXTINGUISHER, [T.MISSING, T.DAMAGED, T.UNSECURED]))

# Brakes & steering
DETAILS_SCHEMA_ROWS.extend(_flat(P.PARKING_BRAKE, [T.NOT_WORKING, T.NEEDS_ADJUSTMENT, T.STUCK]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.SERVICE_BRAKE, [T.NOT_WORKING, T.NEEDS_DIAGNOSTIC, T.NOISE, T.PULLS_LEFT, T.PULLS_RIGHT]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.STEERING_WHEEL, [T.VIBRATION, T.PULLS_LEFT, T.PULLS_RIGHT, T.NOISE, T.OFF_CENTER]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.ALIGNMENT, [T.PULLS_LEFT, T.PULLS_RIGHT, T.OFF_CENTER, T.NEEDS_ADJUSTMENT]))

# HVAC
DETAILS_SCHEMA_ROWS.extend(_flat(P.AC, [T.NO_COLD_AIR, T.NOT_WORKING, T.INTERMITTENT, T.NOISE]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.HEATER, [T.NO_HEAT, T.NOT_WORKING, T.INTERMITTENT]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.DEFROSTER, [T.NOT_WORKING, T.INTERMITTENT]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.CABIN_FAN, [T.NOT_WORKING, T.NOISE, T.INTERMITTENT]))

# Cameras & electronics
CAMERA_PARTS = [P.NETRADYNE_CAMERA, P.REAR_CAMERA, P.SIDE_CAMERA]
for part in CAMERA_PARTS:
    DETAILS_SCHEMA_ROWS.extend(_flat(part, [
        T.NOT_WORKING, T.HANGING, T.DISCONNECTED, T.LOOSE, T.DAMAGED, T.MISSING,
    ]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.CAMERA_MONITOR, [
    T.NOT_WORKING, T.MISSING, T.BROKEN, T.UNSECURED, T.DAMAGED,
]))

# Warning lamp — structured details
DETAILS_SCHEMA_ROWS.append((
    P.WARNING_LAMP, T.ON_OR_FLASHING,
    {
        "type": "object",
        "required": ["lamp_type", "state"],
        "properties": {
            "lamp_type": {
                "type": "array",
                "minItems": 1,
                "uniqueItems": True,
                "items": {"enum": [
                    "check_engine", "oil", "tire_pressure", "brake", "abs", "airbag",
                    "battery", "coolant", "def", "glow_plug", "service_due", "other",
                ]},
            },
            "state": {"enum": ["on", "flashing"]},
        },
        "additionalProperties": False,
    },
))

DETAILS_SCHEMA_ROWS.extend(_flat(P.HORN, [T.NOT_WORKING, T.INTERMITTENT]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.BACKUP_ALARM, [T.NOT_WORKING, T.INTERMITTENT]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.SEATBELT_ALARM, [T.NOT_WORKING, T.INTERMITTENT]))

DETAILS_SCHEMA_ROWS.extend(_flat(P.USB_PORT, [T.NOT_WORKING, T.LOOSE, T.DAMAGED]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.PHONE_CHARGER, [T.NOT_WORKING, T.LOOSE, T.DAMAGED, T.MISSING]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.DELIVERY_DEVICE_CRADLE, [T.MISSING, T.DAMAGED, T.LOOSE, T.MOUNT_DAMAGED]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.PHONE_CRADLE, [T.MISSING, T.DAMAGED, T.LOOSE, T.MOUNT_DAMAGED]))

# Fluids
FLUID_PARTS = [P.COOLANT, P.BRAKE_FLUID, P.POWER_STEERING_FLUID, P.DEF_FLUID, P.ENGINE_OIL, P.GEAR_OIL]
for part in FLUID_PARTS:
    DETAILS_SCHEMA_ROWS.extend(_flat(part, [T.LOW_FLUID, T.EMPTY, T.LEAKING]))

# Compliance — expirations have structured details
DETAILS_SCHEMA_ROWS.append((
    P.INSPECTION_STICKER, T.EXPIRED,
    {
        "type": "object",
        "properties": {"expiration_month": {"type": "string", "pattern": r"^\d{4}-\d{2}$"}},
        "additionalProperties": False,
    },
))
DETAILS_SCHEMA_ROWS.append((
    P.REGISTRATION_STICKER, T.EXPIRED,
    {
        "type": "object",
        "properties": {"expiration_month": {"type": "string", "pattern": r"^\d{4}-\d{2}$"}},
        "additionalProperties": False,
    },
))
DETAILS_SCHEMA_ROWS.append((
    P.LICENSE_PLATE, T.EXPIRED,
    {
        "type": "object",
        "properties": {"expiration_date": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}},
        "additionalProperties": False,
    },
))
DETAILS_SCHEMA_ROWS.extend(_flat(P.LICENSE_PLATE, [T.MISSING, T.ILLEGIBLE, T.WRONG_VEHICLE]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.INSPECTION_STICKER, [T.MISSING, T.ILLEGIBLE]))
DETAILS_SCHEMA_ROWS.extend(_flat(P.REGISTRATION_STICKER, [T.MISSING, T.ILLEGIBLE]))

# Under vehicle
DETAILS_SCHEMA_ROWS.extend(_flat(P.UNDERCARRIAGE_OBJECT, [T.OTHER_DAMAGE]))


# ─────────────────────────────────────────────────────
# DVIC template auto-coverage
#
# Every (part, defect_type) combo declared in seed_dvic_template.py MUST be in
# the catalog allow-list — otherwise the wizard can record a defect that the
# server then rejects with "defect_type X is not allowed on part Y" (the bug
# this block was added to prevent). Curated rows above take precedence; the
# loop only fills gaps. Re-run `python -m app.cli seed-defect-catalog` after
# editing either seed.
# ─────────────────────────────────────────────────────
def _ensure_dvic_coverage():
    from app.seed_dvic_template import DVIC_ROWS

    seen = {(part, dt) for part, dt, _ in DETAILS_SCHEMA_ROWS}
    added: list[tuple] = []
    for r in DVIC_ROWS:
        key = (r["part_enum"], r["defect_type_enum"])
        if key in seen:
            continue
        seen.add(key)
        # Use the DVIC template's details_schema if present so the validator's
        # required-fields check matches what the wizard collected.
        schema = r.get("details_schema") or EMPTY_SCHEMA
        added.append((r["part_enum"], r["defect_type_enum"], schema))
    return added


DETAILS_SCHEMA_ROWS.extend(_ensure_dvic_coverage())


def get_seed_data():
    """Convenience accessor used by the CLI seed command."""
    return {
        "part_system": PART_SYSTEM_ROWS,
        "part_validity": PART_VALIDITY_ROWS,
        "details_schema": DETAILS_SCHEMA_ROWS,
    }
