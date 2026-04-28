"""Human-readable labels + emoji per enum value.

Drives the inspector wizard tile rendering. Treated as reference data
(versioned alongside the enums per the spec §13).

Labels are English by default. i18n hook (post-launch): replace with a
function that takes a locale and returns the right string. Spanish
support is on the post-Jun 15 backlog.
"""
from app.models.defect_catalog import DefectPart as P
from app.models.defect_catalog import DefectPosition as Pos
from app.models.defect_catalog import DefectSystem as S
from app.models.defect_catalog import DefectType as T
from app.models.defect_catalog import DvicSection as DS
from app.models.defect_catalog import AssetType as AT


# ─────────────────────────────────────────────────────
# Systems (13)
# ─────────────────────────────────────────────────────
SYSTEM_LABELS: dict[S, dict[str, str]] = {
    S.TIRES_WHEELS: {"label": "Tires & Wheels", "icon": "🛞"},
    S.LIGHTS: {"label": "Lights", "icon": "💡"},
    S.WINDSHIELD_WIPERS: {"label": "Windshield & Wipers", "icon": "🌧️"},
    S.MIRRORS: {"label": "Mirrors", "icon": "🪞"},
    S.BODY_STEPS: {"label": "Body & Steps", "icon": "🚐"},
    S.DOORS_WINDOWS: {"label": "Doors & Windows", "icon": "🚪"},
    S.INTERIOR: {"label": "Interior", "icon": "💺"},
    S.BRAKES_STEERING: {"label": "Brakes & Steering", "icon": "🛑"},
    S.HVAC: {"label": "HVAC", "icon": "❄️"},
    S.CAMERAS_ELECTRONICS: {"label": "Cameras & Electronics", "icon": "📷"},
    S.FLUIDS_UNDER_HOOD: {"label": "Fluids Under the Hood", "icon": "🛢️"},
    S.COMPLIANCE: {"label": "Compliance", "icon": "📋"},
    S.UNDER_VEHICLE: {"label": "Under Vehicle", "icon": "🔍"},
}


# ─────────────────────────────────────────────────────
# Parts (70)
# ─────────────────────────────────────────────────────
PART_LABELS: dict[P, dict[str, str]] = {
    # tires_wheels
    P.TIRE: {"label": "Tire", "icon": "🛞"},
    P.RIM: {"label": "Rim", "icon": "⚙️"},
    P.WHEEL_NUT: {"label": "Wheel nut", "icon": "🔩"},
    P.MOUNTING_EQUIPMENT: {"label": "Wheel stud / Mounting", "icon": "🔧"},
    # lights
    P.HEADLIGHT: {"label": "Headlight", "icon": "🔦"},
    P.TAIL_LIGHT: {"label": "Tail light", "icon": "🔴"},
    P.TURN_SIGNAL: {"label": "Turn signal", "icon": "↪️"},
    P.HAZARD_LIGHT: {"label": "Hazard light", "icon": "⚠️"},
    P.MARKER_LIGHT: {"label": "Marker light", "icon": "🟠"},
    P.LICENSE_PLATE_LIGHT: {"label": "License plate light", "icon": "🪪"},
    P.CABIN_LIGHT: {"label": "Cabin light", "icon": "💡"},
    P.CARGO_LIGHT: {"label": "Cargo light", "icon": "📦"},
    P.STEPWELL_LIGHT: {"label": "Stepwell light", "icon": "🪜"},
    P.MIRROR_LIGHT: {"label": "Mirror light", "icon": "🔅"},
    # windshield_wipers
    P.WINDSHIELD: {"label": "Windshield", "icon": "🪟"},
    P.WIPER_BLADE: {"label": "Wiper blade", "icon": "🧹"},
    P.WASHER_SYSTEM: {"label": "Washer system", "icon": "💦"},
    # mirrors
    P.SIDE_MIRROR: {"label": "Side mirror", "icon": "🪞"},
    # body_steps
    P.BUMPER: {"label": "Bumper", "icon": "🚐"},
    P.FENDER: {"label": "Fender", "icon": "🛡️"},
    P.HOOD: {"label": "Hood", "icon": "📐"},
    P.SIDE_PANEL: {"label": "Side panel", "icon": "🟦"},
    P.FLOOR_PANEL: {"label": "Floor panel", "icon": "▭"},
    P.SIDE_STEP: {"label": "Side step", "icon": "🪜"},
    P.REAR_STEP: {"label": "Rear step", "icon": "🪜"},
    # doors_windows
    P.EXTERIOR_DOOR: {"label": "Exterior door", "icon": "🚪"},
    P.SLIDING_SIDE_DOOR: {"label": "Sliding side door", "icon": "🚪"},
    P.BULKHEAD_DOOR: {"label": "Bulkhead door", "icon": "🚪"},
    P.REAR_CARGO_DOOR: {"label": "Rear cargo door", "icon": "🚪"},
    P.ROLL_UP_DOOR: {"label": "Roll-up door", "icon": "🚪"},
    P.WINDOW: {"label": "Window", "icon": "🪟"},
    P.DOOR_HARDWARE: {"label": "Door hardware", "icon": "🔓"},
    # interior
    P.DRIVER_SEAT: {"label": "Driver seat", "icon": "💺"},
    P.PASSENGER_SEAT: {"label": "Passenger seat", "icon": "💺"},
    P.SEATBELT: {"label": "Seatbelt", "icon": "🪢"},
    P.SEATBELT_BUCKLE: {"label": "Seatbelt buckle", "icon": "🔗"},
    P.SUN_VISOR: {"label": "Sun visor", "icon": "🕶️"},
    P.INTERIOR_CLEANLINESS: {"label": "Interior cleanliness", "icon": "🧽"},
    P.INTERIOR_LOOSE_OBJECTS: {"label": "Loose objects", "icon": "📋"},
    P.FIRE_EXTINGUISHER: {"label": "Fire extinguisher", "icon": "🧯"},
    # brakes_steering
    P.PARKING_BRAKE: {"label": "Parking brake", "icon": "🅿️"},
    P.SERVICE_BRAKE: {"label": "Service brake", "icon": "🛑"},
    P.STEERING_WHEEL: {"label": "Steering wheel", "icon": "🎯"},
    P.ALIGNMENT: {"label": "Alignment", "icon": "↔️"},
    # hvac
    P.AC: {"label": "A/C", "icon": "❄️"},
    P.HEATER: {"label": "Heater", "icon": "🔥"},
    P.DEFROSTER: {"label": "Defroster", "icon": "🌫️"},
    P.CABIN_FAN: {"label": "Cabin fan", "icon": "🌀"},
    # cameras_electronics
    P.NETRADYNE_CAMERA: {"label": "Netradyne camera", "icon": "📷"},
    P.REAR_CAMERA: {"label": "Rear camera", "icon": "📹"},
    P.SIDE_CAMERA: {"label": "Side camera", "icon": "📹"},
    P.CAMERA_MONITOR: {"label": "Camera monitor", "icon": "🖥️"},
    P.WARNING_LAMP: {"label": "Warning lamp", "icon": "🚨"},
    P.BACKUP_ALARM: {"label": "Backup alarm", "icon": "🔔"},
    P.SEATBELT_ALARM: {"label": "Seatbelt alarm", "icon": "🔔"},
    P.HORN: {"label": "Horn", "icon": "📢"},
    P.USB_PORT: {"label": "USB port", "icon": "🔌"},
    P.PHONE_CHARGER: {"label": "Phone charger", "icon": "🔋"},
    P.DELIVERY_DEVICE_CRADLE: {"label": "Delivery device cradle", "icon": "📱"},
    P.PHONE_CRADLE: {"label": "Phone cradle", "icon": "📱"},
    # fluids_under_hood
    P.COOLANT: {"label": "Coolant", "icon": "💧"},
    P.BRAKE_FLUID: {"label": "Brake fluid", "icon": "🛑"},
    P.POWER_STEERING_FLUID: {"label": "Power steering fluid", "icon": "🎯"},
    P.DEF_FLUID: {"label": "DEF fluid", "icon": "🧪"},
    P.ENGINE_OIL: {"label": "Engine oil", "icon": "🛢️"},
    P.GEAR_OIL: {"label": "Gear oil", "icon": "⚙️"},
    # compliance
    P.LICENSE_PLATE: {"label": "License plate", "icon": "🪪"},
    P.INSPECTION_STICKER: {"label": "Inspection sticker", "icon": "🏷️"},
    P.REGISTRATION_STICKER: {"label": "Registration sticker", "icon": "🏷️"},
    # under_vehicle
    P.UNDERCARRIAGE_OBJECT: {"label": "Undercarriage object", "icon": "🔍"},
    # ── DVIC additions (Apr 2026 PDFs) ──
    P.SUSPENSION: {"label": "Suspension", "icon": "🔧"},
    P.UNDERBODY_OBJECT: {"label": "Underbody object", "icon": "🪝"},
    P.FLUID_LEAK: {"label": "Fluid leak", "icon": "💦"},
    P.HOOD_LATCH: {"label": "Hood latch", "icon": "🔒"},
    P.LIFT_GATE: {"label": "Lift gate", "icon": "🚪"},
    P.BACKUP_CAMERA: {"label": "Backup camera", "icon": "📹"},
    P.SIDE_VIEW_CAMERA: {"label": "Side view camera", "icon": "📹"},
    P.CARGO_STEP: {"label": "Cargo step", "icon": "🪜"},
    P.FUEL_CAP: {"label": "Fuel cap", "icon": "⛽"},
    P.MUD_FLAP: {"label": "Mud flap", "icon": "🟫"},
    P.BATTERY_COVER: {"label": "Battery cover", "icon": "🔋"},
    P.AMAZON_DOT_DECAL: {"label": "Amazon DOT decal", "icon": "📋"},
    P.PRIME_DECAL: {"label": "Prime decal", "icon": "📦"},
    P.INSURANCE_DOC: {"label": "Insurance document", "icon": "📄"},
    P.REGISTRATION_DOC: {"label": "Registration document", "icon": "📄"},
    P.SHELF: {"label": "Shelf", "icon": "📚"},
    P.SPARE_FUSE: {"label": "Spare fuses", "icon": "🔌"},
    P.REFLECTIVE_TRIANGLE: {"label": "Reflective triangle", "icon": "🔺"},
    P.AIR_PRESSURE_GAUGE: {"label": "Air pressure gauge", "icon": "💨"},
    P.VEHICLE_INTERIOR: {"label": "Vehicle interior", "icon": "🚐"},
    P.DEVICE_ON_WINDSHIELD: {"label": "Device on windshield", "icon": "📱"},
}


# ─────────────────────────────────────────────────────
# Defect types (~50)
# ─────────────────────────────────────────────────────
TYPE_LABELS: dict[T, dict[str, str]] = {
    # function
    T.NOT_WORKING: {"label": "Not working", "icon": "❌"},
    T.INTERMITTENT: {"label": "Intermittent", "icon": "🔄"},
    T.FLICKERING: {"label": "Flickering", "icon": "✨"},
    T.ON_OR_FLASHING: {"label": "On / flashing", "icon": "🔆"},
    T.NO_COLD_AIR: {"label": "No cold air", "icon": "🥵"},
    T.NO_HEAT: {"label": "No heat", "icon": "🥶"},
    # physical state
    T.MISSING: {"label": "Missing", "icon": "🚫"},
    T.DAMAGED: {"label": "Damaged", "icon": "💢"},
    T.CRACKED: {"label": "Cracked", "icon": "💥"},
    T.BROKEN: {"label": "Broken", "icon": "🧨"},
    T.BENT: {"label": "Bent", "icon": "↩️"},
    T.FRAYED: {"label": "Frayed", "icon": "🧵"},
    T.TORN: {"label": "Torn", "icon": "🪡"},
    T.RUSTED: {"label": "Rusted", "icon": "🟫"},
    T.LEAKING: {"label": "Leaking", "icon": "💧"},
    T.COVER_CRACKED: {"label": "Cover cracked", "icon": "💥"},
    T.COVER_MISSING: {"label": "Cover missing", "icon": "🚫"},
    # attachment
    T.LOOSE: {"label": "Loose", "icon": "🔓"},
    T.HANGING: {"label": "Hanging", "icon": "🪝"},
    T.UNSECURED: {"label": "Unsecured", "icon": "⚠️"},
    T.ZIP_TIED_OR_TAPED: {"label": "Zip-tied / taped", "icon": "🧷"},
    T.OFF_TRACK: {"label": "Off track", "icon": "↗️"},
    T.OFF_CENTER: {"label": "Off center", "icon": "↔️"},
    T.MISALIGNED: {"label": "Misaligned", "icon": "📐"},
    T.DISCONNECTED: {"label": "Disconnected", "icon": "🔌"},
    # movement
    T.STUCK: {"label": "Stuck", "icon": "🚧"},
    T.WONT_OPEN: {"label": "Won't open", "icon": "🔒"},
    T.WONT_CLOSE: {"label": "Won't close", "icon": "🔓"},
    T.WONT_LOCK: {"label": "Won't lock", "icon": "🔓"},
    T.WONT_UNLOCK: {"label": "Won't unlock", "icon": "🔒"},
    T.WONT_LATCH: {"label": "Won't latch", "icon": "🔗"},
    T.WONT_RETRACT: {"label": "Won't retract", "icon": "↩️"},
    # tire-specific
    T.FLAT: {"label": "Flat", "icon": "🪫"},
    T.LOW_TREAD: {"label": "Low tread", "icon": "📉"},
    T.SIDEWALL_DAMAGE: {"label": "Sidewall damage", "icon": "💢"},
    T.OBJECT_EMBEDDED: {"label": "Object embedded", "icon": "📌"},
    T.EXPOSED_WIRE: {"label": "Exposed wire", "icon": "🪡"},
    T.BULGE: {"label": "Bulge", "icon": "🫧"},
    # wheel-specific
    T.STUD_BROKEN: {"label": "Stud broken", "icon": "🧨"},
    T.HUB_CAP_MISSING: {"label": "Hub cap missing", "icon": "🚫"},
    # fluid-specific
    T.LOW_FLUID: {"label": "Low fluid", "icon": "📉"},
    T.EMPTY: {"label": "Empty", "icon": "🪫"},
    # documentation
    T.EXPIRED: {"label": "Expired", "icon": "📅"},
    T.ILLEGIBLE: {"label": "Illegible", "icon": "🔍"},
    T.WRONG_VEHICLE: {"label": "Wrong vehicle", "icon": "❓"},
    # work needed
    T.NEEDS_ADJUSTMENT: {"label": "Needs adjustment", "icon": "🔧"},
    T.NEEDS_GREASE: {"label": "Needs grease", "icon": "🛢️"},
    T.NEEDS_DIAGNOSTIC: {"label": "Needs diagnostic", "icon": "🩺"},
    T.NEEDS_REPLACEMENT: {"label": "Needs replacement", "icon": "🔁"},
    # feel
    T.PULLS_LEFT: {"label": "Pulls left", "icon": "⬅️"},
    T.PULLS_RIGHT: {"label": "Pulls right", "icon": "➡️"},
    T.VIBRATION: {"label": "Vibration", "icon": "📳"},
    T.NOISE: {"label": "Noise", "icon": "🔊"},
    # cleanliness
    T.DIRTY: {"label": "Dirty", "icon": "🧽"},
    T.HAS_LOOSE_OBJECTS: {"label": "Has loose objects", "icon": "📦"},
    # mount / bracket
    T.MOUNT_DAMAGED: {"label": "Mount damaged", "icon": "🔩"},
    # ── DVIC additions (Apr 2026 PDFs) ──
    T.LEANING: {"label": "Leaning", "icon": "🪜"},
    T.HAS_OBJECTS_UNDERNEATH: {"label": "Has objects underneath", "icon": "🪝"},
    T.ACTIVE_LEAK_ON_GROUND: {"label": "Active leak on ground", "icon": "💦"},
    T.ITEMS_LOOSE_OR_HELD_WITH_TAPE: {"label": "Loose / held with tape", "icon": "🧷"},
    T.EXCESSIVELY_DIRTY: {"label": "Excessively dirty", "icon": "🟫"},
    T.NOT_VISIBLE: {"label": "Not visible", "icon": "👁️‍🗨️"},
    T.HAS_ODOR: {"label": "Has odor", "icon": "👃"},
    T.HAS_TRASH_OR_GRIME: {"label": "Trash or grime", "icon": "🗑️"},
    T.HAS_SPILLED_LIQUID: {"label": "Spilled liquid", "icon": "💦"},
    T.SQUEAKING: {"label": "Squeaking", "icon": "🔊"},
    T.GRINDING: {"label": "Grinding", "icon": "⚙️"},
    T.LEAKING_AIR: {"label": "Leaking air", "icon": "💨"},
    T.WEAK: {"label": "Weak", "icon": "📉"},
    T.STIFF: {"label": "Stiff", "icon": "🪨"},
    T.NEEDS_ALIGNMENT: {"label": "Needs alignment", "icon": "📐"},
    T.READS_OVER_120_PSI: {"label": "Reads over 120 PSI", "icon": "🔥"},
    T.DEVICE_MOUNTED: {"label": "Device mounted", "icon": "📱"},
    T.OBSTRUCTED: {"label": "Obstructed", "icon": "🚫"},
    T.NOT_IN_GREEN_ZONE: {"label": "Not in green zone", "icon": "🔴"},
    T.NOT_MOUNTED: {"label": "Not mounted", "icon": "🚫"},
    T.BATTERY_COVER_MISSING: {"label": "Battery cover missing", "icon": "🔋"},
    T.BOLTS_MISSING: {"label": "Bolts missing", "icon": "🔩"},
    T.CRACKED_OR_HOLE: {"label": "Cracked / hole", "icon": "💥"},
    T.CANNOT_BE_ADJUSTED: {"label": "Cannot be adjusted", "icon": "🔧"},
    T.EXPOSED_INTERIOR: {"label": "Exposed interior (metal/spring/cushion)", "icon": "🪡"},
    # catchall
    T.OTHER_DAMAGE: {"label": "Other damage", "icon": "❓"},
}


# ─────────────────────────────────────────────────────
# Positions (12)
# ─────────────────────────────────────────────────────
POSITION_LABELS: dict[Pos, dict[str, str]] = {
    Pos.DRIVER_FRONT: {"label": "Driver front", "icon": "↖️"},
    Pos.PASSENGER_FRONT: {"label": "Passenger front", "icon": "↗️"},
    Pos.DRIVER_REAR: {"label": "Driver rear", "icon": "↙️"},
    Pos.PASSENGER_REAR: {"label": "Passenger rear", "icon": "↘️"},
    Pos.DRIVER_SIDE: {"label": "Driver side", "icon": "⬅️"},
    Pos.PASSENGER_SIDE: {"label": "Passenger side", "icon": "➡️"},
    Pos.FRONT: {"label": "Front", "icon": "⬆️"},
    Pos.REAR: {"label": "Rear", "icon": "⬇️"},
    Pos.DRIVER: {"label": "Driver", "icon": "🚹"},
    Pos.PASSENGER: {"label": "Passenger", "icon": "🚺"},
    Pos.UPPER: {"label": "Upper", "icon": "⬆️"},
    Pos.LOWER: {"label": "Lower", "icon": "⬇️"},
}


# ─────────────────────────────────────────────────────
# DVIC physical sections (6) — drives the new wizard's first tile picker
# ─────────────────────────────────────────────────────
DVIC_SECTION_LABELS: dict[DS, dict[str, str]] = {
    DS.GENERAL: {
        "label": "General",
        "icon": "📋",
        "description": "Documentation, cleanliness, safety accessories",
    },
    DS.FRONT_SIDE: {
        "label": "Front Side",
        "icon": "🔦",
        "description": "Headlights, hazard light, front suspension, hood",
    },
    DS.BACK_SIDE: {
        "label": "Back Side",
        "icon": "🔴",
        "description": "Tail lights, license plate light, lift gate, rear body",
    },
    DS.DRIVER_SIDE: {
        "label": "Driver Side",
        "icon": "⬅️",
        "description": "Driver-side tires, mirror, body, decals, mud flap",
    },
    DS.PASSENGER_SIDE: {
        "label": "Passenger Side",
        "icon": "➡️",
        "description": "Passenger-side tires, mirror, body, decals, mud flap",
    },
    DS.IN_CAB: {
        "label": "In Cab",
        "icon": "💺",
        "description": "Wipers, brakes, HVAC, steering, dash, interior doors, windshield",
    },
}


# ─────────────────────────────────────────────────────
# Asset types — vehicle classifications driving template selection
# ─────────────────────────────────────────────────────
ASSET_TYPE_LABELS: dict[AT, dict[str, str]] = {
    AT.EXTRA_LARGE_CARGO_VAN: {
        "label": "Extra Large Cargo Van",
        "icon": "🚐",
        "description": "Ford Transit 350, Mercedes Sprinter 3500 — non-DOT",
    },
    AT.LARGE_CARGO_VAN: {
        "label": "Large Cargo Van",
        "icon": "🚐",
        "description": "Ford Transit 250, Ram ProMaster 1500 — non-DOT",
    },
    AT.STEP_VAN_MEDIUM: {
        "label": "Step Van (Medium)",
        "icon": "🚚",
        "description": "Box truck — DOT regulated, 4/32 front tread, fuel cap, decals",
    },
    AT.STEP_VAN_LARGE: {
        "label": "Step Van (Large)",
        "icon": "🚛",
        "description": "Large box truck — DOT regulated + battery cover check",
    },
}
