"""V2.2 defect catalog seed — minimum viable Fase 1 set.

Implements ~50 core defect rules covering:
  - Every DefectSystem (tires, lights, body, brakes, etc.)
  - All 5 vehicle_class values with appropriate scoping (DOT-only items
    skipped on non-DOT classes; ICE-only items skipped on EV)
  - The 4 details_schema patterns from V2.2 §8 (tread depth, warning lamp
    ICE/EV variants, windshield line-of-sight, compliance expiration dates)

Idempotent UPSERT keyed by natural keys:
  part_group_default       → PK (part)
  defect_part_system       → composite PK (part, system)
  defect_rule              → UNIQUE (part, defect_type)
  defect_applicability     → UNIQUE (rule_id, vehicle_class)

Re-running after edits to this file UPDATEs existing rows in place. Rules
no longer in the seed get `is_active=False` so the wizard stops surfacing
them (preserves audit; doesn't hard-delete since defects may reference).

This is a Fase 1 starter — full V2.2 spec is 258 rules + 1094 applicability
rows; scaling there happens in Fase 2 post-Jun 15.
"""
from __future__ import annotations

from app.models.defect_catalog import (
    DefectClassification as C,
    DefectGroup as G,
    DefectPart as P,
    DefectPosition as Pos,
    DefectSystem as S,
    DefectType as T,
    VehicleClass as VC,
)


# ─────────────────────────────────────────────────────
# Vehicle-class groupings — used as `applicable` in the rule list
# ─────────────────────────────────────────────────────
ALL_CLASSES = (
    VC.CUSTOM_DELIVERY_VAN,
    VC.REGULAR_CARGO_VAN,
    VC.STEP_VAN_DOT,
    VC.ELECTRIC_VEHICLE,
    VC.BOX_TRUCK_DOT,
)
ICE_ONLY = (
    VC.CUSTOM_DELIVERY_VAN,
    VC.REGULAR_CARGO_VAN,
    VC.STEP_VAN_DOT,
    VC.BOX_TRUCK_DOT,
)
DOT_ONLY = (VC.STEP_VAN_DOT, VC.BOX_TRUCK_DOT)
EV_ONLY = (VC.ELECTRIC_VEHICLE,)


# ─────────────────────────────────────────────────────
# Position groupings
# ─────────────────────────────────────────────────────
FOUR_CORNER = [
    Pos.DRIVER_FRONT.value, Pos.PASSENGER_FRONT.value,
    Pos.DRIVER_REAR.value, Pos.PASSENGER_REAR.value,
]
LEFT_RIGHT = [Pos.DRIVER_SIDE.value, Pos.PASSENGER_SIDE.value]
FRONT_REAR = [Pos.FRONT.value, Pos.REAR.value]
DRIVER_PASSENGER = [Pos.DRIVER.value, Pos.PASSENGER.value]
DOOR_POSITIONS = [
    Pos.DRIVER_SIDE.value, Pos.PASSENGER_SIDE.value, Pos.REAR.value,
]


# ─────────────────────────────────────────────────────
# JSON Schemas (V2.2 §8)
# ─────────────────────────────────────────────────────
TREAD_DEPTH_SCHEMA = {
    "type": "object",
    "required": ["tread_depth_32nds"],
    "properties": {
        "tread_depth_32nds": {
            "type": "integer", "minimum": 0, "maximum": 10,
            "title": "Tread depth (X/32 inches — type just X)",
        },
        # Dual rear wheels: CDV / Step Van / Box Truck have inner+outer rear
        # tires per side. The frontend renders this picker only when the
        # selected position is rear AND the vehicle_class has duals — Cargo
        # vans and Rivian EVs have single rears so this stays hidden.
        "wheel_position": {
            "type": "string",
            "enum": ["inner", "outer"],
            "title": "Inner or outer rear wheel?",
            "description": "Dual-wheel rear axle (CDV / Step Van / Box Truck).",
            # Nova Fora extension — read by DvicWizard.DetailsForm
            "x_show_when": {
                "position_in": ["driver_rear", "passenger_rear"],
                "vehicle_class_in": [
                    "custom_delivery_van",
                    "step_van_dot",
                    "box_truck_dot",
                ],
            },
            "x_required_when_shown": True,
        },
    },
    "additionalProperties": False,
}

WARNING_LAMP_SCHEMA_ICE = {
    "type": "object",
    "required": ["lamp_type", "state"],
    "properties": {
        "lamp_type": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": True,
            "items": {
                "enum": [
                    "check_engine", "oil", "tire_pressure", "brake", "abs",
                    "airbag", "battery", "coolant", "def", "glow_plug",
                    "service_due", "other",
                ]
            },
            "title": "Which lamp(s)?",
        },
        "state": {"enum": ["on", "flashing"], "default": "on", "title": "Lamp state"},
    },
    "additionalProperties": False,
}

WARNING_LAMP_SCHEMA_EV = {
    "type": "object",
    "required": ["lamp_type", "state"],
    "properties": {
        "lamp_type": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": True,
            "items": {
                "enum": [
                    "check_engine", "tire_pressure", "brake", "abs",
                    "airbag", "battery", "service_due", "other",
                ]
            },
            "title": "Which lamp(s)?",
        },
        "state": {"enum": ["on", "flashing"], "default": "on", "title": "Lamp state"},
    },
    "additionalProperties": False,
}

WINDSHIELD_LOS_SCHEMA = {
    "type": "object",
    "required": ["in_drivers_line_of_sight"],
    "properties": {"in_drivers_line_of_sight": {"type": "boolean"}},
    "additionalProperties": False,
}

# Date formats use US convention (MM/DD/YYYY and MM/YYYY) to match the
# inspector workflow — drivers + vendors in the US read dates this way on
# the physical stickers/decals being inspected.
EXP_MONTH_SCHEMA = {
    "type": "object",
    "properties": {
        "expiration_month": {
            "type": "string",
            "pattern": r"^(0[1-9]|1[0-2])/\d{4}$",
            "title": "Expiration month",
        }
    },
    "additionalProperties": False,
}

EXP_DATE_SCHEMA = {
    "type": "object",
    "properties": {
        "expiration_date": {
            "type": "string",
            "pattern": r"^(0[1-9]|1[0-2])/(0[1-9]|[12]\d|3[01])/\d{4}$",
            "title": "Expiration date",
        }
    },
    "additionalProperties": False,
}


# ─────────────────────────────────────────────────────
# part_group_default — default routing group per part
# (Used by the seed to populate DefectRule.group when omitted in the rule
# list. Direct edits here only affect new rules; existing rules keep their
# previously-set group until manually re-synced.)
# ─────────────────────────────────────────────────────
PART_GROUP_DEFAULTS: list[tuple[P, G, str | None]] = [
    # tires_wheels
    (P.TIRE, G.TIRES, None),
    (P.RIM, G.TIRES, None),
    (P.WHEEL_NUT, G.TIRES, None),
    (P.MOUNTING_EQUIPMENT, G.TIRES, None),
    # additional parts referenced by the Amazon DVIC PDFs (Cargo + DOT)
    (P.WASHER_SYSTEM, G.AMR, None),
    (P.HORN, G.AMR, None),
    (P.SEATBELT_ALARM, G.AMR, None),
    (P.BACKUP_ALARM, G.AMR, None),
    (P.DELIVERY_DEVICE_CRADLE, G.AMR, None),
    (P.DASHBOARD_ILLUMINATION, G.AMR, None),
    (P.INTERIOR_CLEANLINESS, G.DETAILING, None),
    (P.INTERIOR_LOOSE_OBJECTS, G.DETAILING, None),
    (P.SUSPENSION, G.AMR, None),
    (P.UNDERCARRIAGE_OBJECT, G.AMR, None),
    (P.BULKHEAD_DOOR, G.BODY, None),
    (P.PERIODIC_INSPECTION_STICKER, G.CNMR, None),
    (P.FUEL_CAP, G.AMR, None),
    (P.BATTERY_COVER, G.AMR, None),
    # lights
    (P.HEADLIGHT, G.AMR, None),
    (P.TAIL_LIGHT, G.AMR, None),
    (P.TURN_SIGNAL, G.AMR, None),
    (P.HAZARD_LIGHT, G.AMR, None),
    (P.MARKER_LIGHT, G.AMR, None),
    (P.LICENSE_PLATE_LIGHT, G.AMR, None),
    # windshield_wipers
    (P.WINDSHIELD, G.BODY, None),
    (P.WIPER_BLADE, G.AMR, None),
    # NOTE: P.WASHER_SYSTEM is intentionally NOT listed here — it already
    # appears earlier in this list (under the AMR header at line ~197).
    # Re-adding it triggered a PK collision in seed-defect-catalog because
    # the idempotency check (SELECT-before-add) runs before SQLAlchemy
    # flushes the prior iteration's INSERT, so both passes thought the row
    # was missing and both queued an INSERT for (part='washer_system').
    # mirrors
    (P.SIDE_MIRROR, G.BODY, None),
    (P.MIRROR_LIGHT, G.AMR, "Turn signal embedded in side mirror — AMR like other lights."),
    # body_steps
    (P.BUMPER, G.BODY, None),
    (P.FENDER, G.BODY, None),
    (P.HOOD, G.BODY, None),
    (P.SIDE_PANEL, G.BODY, None),
    (P.FLOOR_PANEL, G.BODY, None),
    (P.SIDE_STEP, G.BODY, None),
    (P.REAR_STEP, G.BODY, None),
    # doors_windows
    (P.EXTERIOR_DOOR, G.BODY, None),
    (P.SLIDING_SIDE_DOOR, G.BODY, None),
    (P.REAR_CARGO_DOOR, G.BODY, None),
    (P.WINDOW, G.BODY, None),
    # interior
    (P.DRIVER_SEAT, G.CNMR, None),
    (P.SEATBELT, G.CMR, "Safety-critical; Sev1 escalation."),
    (P.SEATBELT_BUCKLE, G.CMR, None),
    # brakes_steering
    (P.SERVICE_BRAKE, G.CMR, "Brake issues are always commercial motor repair (CMR)."),
    (P.PARKING_BRAKE, G.CMR, None),
    (P.STEERING_WHEEL, G.CMR, None),
    (P.ALIGNMENT, G.AMR, None),
    # cameras_electronics
    (P.NETRADYNE_CAMERA, G.NETRADYNE, "All Netradyne issues route to the Netradyne queue."),
    (P.REAR_CAMERA, G.AMR, None),
    (P.SIDE_CAMERA, G.AMR, None),
    (P.CAMERA_MONITOR, G.AMR, None),
    (P.WARNING_LAMP, G.AMR, None),
    # hvac
    (P.AC, G.AMR, None),
    (P.HEATER, G.AMR, None),
    # fluids_under_hood
    (P.ENGINE_OIL, G.PM, None),
    (P.COOLANT, G.PM, None),
    (P.BRAKE_FLUID, G.PM, None),
    (P.POWER_STEERING_FLUID, G.PM, None),
    (P.WASHER_FLUID, G.PM, None),
    (P.GEAR_GREASE, G.PM, None),
    # compliance
    (P.LICENSE_PLATE, G.CNMR, None),
    (P.INSPECTION_STICKER, G.CNMR, None),
    (P.REGISTRATION_STICKER, G.CNMR, None),
    (P.DOT_DECAL, G.CNMR, None),
    (P.PRIME_DECAL, G.CNMR, None),
    (P.PAPER_DOCUMENT, G.CNMR, None),
    (P.FIRE_EXTINGUISHER, G.CNMR, None),
    (P.REFLECTIVE_TRIANGLES, G.CNMR, None),
    (P.SPARE_FUSES, G.CNMR, None),
    (P.AIR_PRESSURE_GAUGE, G.CMR, None),
    (P.LOW_AIR_WARNING, G.CMR, "Air-brake low-pressure warning indicator (DOT)."),
    # ev_powertrain
    (P.CHARGING_PORT_CAP, G.BODY, None),
    (P.EV_CENTER_DISPLAY, G.AMR, None),
    (P.HIGH_VOLTAGE_CABLE, G.CMR, "EV high-voltage — Sev1 if exposed."),
    (P.AVAS_SPEAKER, G.AMR, None),
    # attached
    (P.MUD_FLAP, G.BODY, None),
    (P.LIFT_GATE, G.CMR, None),
    # PM service umbrella — defaults defects on this part to group=PM so
    # the bundler maps them to RepairType.PM and the router places them
    # at workshops that include 'pm' in their `repair_types[]`.
    (P.PM_SERVICE, G.PM, "PM service umbrella — DSP Schedule-PM flow only."),
]


# ─────────────────────────────────────────────────────
# defect_part_system — UI navigation (primary system per part)
# ─────────────────────────────────────────────────────
PART_SYSTEMS: list[tuple[P, S, bool, str | None]] = [
    # tires_wheels
    (P.TIRE, S.TIRES_WHEELS, True, None),
    (P.RIM, S.TIRES_WHEELS, True, None),
    (P.WHEEL_NUT, S.TIRES_WHEELS, True, None),
    (P.MOUNTING_EQUIPMENT, S.TIRES_WHEELS, True, None),
    # lights
    (P.HEADLIGHT, S.LIGHTS, True, "exterior"),
    (P.TAIL_LIGHT, S.LIGHTS, True, "exterior"),
    (P.TURN_SIGNAL, S.LIGHTS, True, "exterior"),
    (P.HAZARD_LIGHT, S.LIGHTS, True, "exterior"),
    (P.MARKER_LIGHT, S.LIGHTS, True, "exterior"),
    (P.LICENSE_PLATE_LIGHT, S.LIGHTS, True, "exterior"),
    # windshield_wipers
    (P.WINDSHIELD, S.WINDSHIELD_WIPERS, True, None),
    (P.WIPER_BLADE, S.WINDSHIELD_WIPERS, True, None),
    (P.WASHER_SYSTEM, S.WINDSHIELD_WIPERS, True, None),
    # mirrors
    (P.SIDE_MIRROR, S.MIRRORS, True, None),
    # body_steps
    (P.BUMPER, S.BODY_STEPS, True, "exterior"),
    (P.FENDER, S.BODY_STEPS, True, "exterior"),
    (P.HOOD, S.BODY_STEPS, True, "exterior"),
    (P.SIDE_PANEL, S.BODY_STEPS, True, "exterior"),
    (P.SIDE_STEP, S.BODY_STEPS, True, "steps"),
    (P.REAR_STEP, S.BODY_STEPS, True, "steps"),
    # doors_windows
    (P.EXTERIOR_DOOR, S.DOORS_WINDOWS, True, None),
    (P.SLIDING_SIDE_DOOR, S.DOORS_WINDOWS, True, None),
    (P.REAR_CARGO_DOOR, S.DOORS_WINDOWS, True, None),
    (P.WINDOW, S.DOORS_WINDOWS, True, None),
    # interior
    (P.DRIVER_SEAT, S.INTERIOR, True, None),
    (P.SEATBELT, S.INTERIOR, True, None),
    (P.SEATBELT_BUCKLE, S.INTERIOR, True, None),
    # brakes_steering
    (P.SERVICE_BRAKE, S.BRAKES_STEERING, True, None),
    (P.PARKING_BRAKE, S.BRAKES_STEERING, True, None),
    (P.STEERING_WHEEL, S.BRAKES_STEERING, True, None),
    (P.ALIGNMENT, S.BRAKES_STEERING, True, None),
    # cameras_electronics
    (P.NETRADYNE_CAMERA, S.CAMERAS_ELECTRONICS, True, None),
    (P.REAR_CAMERA, S.CAMERAS_ELECTRONICS, True, None),
    (P.SIDE_CAMERA, S.CAMERAS_ELECTRONICS, True, None),
    (P.CAMERA_MONITOR, S.CAMERAS_ELECTRONICS, True, None),
    (P.WARNING_LAMP, S.CAMERAS_ELECTRONICS, True, None),
    # hvac
    (P.AC, S.HVAC, True, None),
    (P.HEATER, S.HVAC, True, None),
    # fluids_under_hood
    (P.ENGINE_OIL, S.FLUIDS_UNDER_HOOD, True, None),
    (P.COOLANT, S.FLUIDS_UNDER_HOOD, True, None),
    (P.BRAKE_FLUID, S.FLUIDS_UNDER_HOOD, True, None),
    (P.POWER_STEERING_FLUID, S.FLUIDS_UNDER_HOOD, True, None),
    (P.WASHER_FLUID, S.FLUIDS_UNDER_HOOD, True, None),
    (P.GEAR_GREASE, S.FLUIDS_UNDER_HOOD, True, None),
    # compliance
    (P.LICENSE_PLATE, S.COMPLIANCE, True, None),
    (P.INSPECTION_STICKER, S.COMPLIANCE, True, None),
    (P.REGISTRATION_STICKER, S.COMPLIANCE, True, None),
    (P.DOT_DECAL, S.COMPLIANCE, True, None),
    (P.PRIME_DECAL, S.COMPLIANCE, True, None),
    (P.PAPER_DOCUMENT, S.COMPLIANCE, True, None),
    (P.FIRE_EXTINGUISHER, S.COMPLIANCE, True, None),
    (P.REFLECTIVE_TRIANGLES, S.COMPLIANCE, True, None),
    (P.SPARE_FUSES, S.COMPLIANCE, True, None),
    (P.AIR_PRESSURE_GAUGE, S.AIR_BRAKE, True, None),
    # ev_powertrain
    (P.CHARGING_PORT_CAP, S.EV_POWERTRAIN, True, None),
    (P.EV_CENTER_DISPLAY, S.EV_POWERTRAIN, True, None),
    (P.HIGH_VOLTAGE_CABLE, S.EV_POWERTRAIN, True, None),
    (P.AVAS_SPEAKER, S.EV_POWERTRAIN, True, None),
    # attached
    (P.MUD_FLAP, S.BODY_STEPS, True, "attached"),
    (P.LIFT_GATE, S.BODY_STEPS, True, "attached"),
    # mirror light shows under both Lights and Mirrors (secondary appearance)
    # Skipping for the Fase 1 starter — single-system mapping only.
]


# ─────────────────────────────────────────────────────
# RULES — (part × defect_type) catalog with per-class applicability.
#
# Tuple form:
#   (part, defect_type, applicable_classes, classification, valid_positions,
#    position_required, allow_null_position, details_schema, threshold,
#    notes_default, group_override)
#
# `group_override` lets a rule deviate from `part_group_default[part]`.
# Most rules pass `None` and inherit.
# ─────────────────────────────────────────────────────

RuleSpec = tuple[
    P,                       # part
    T,                       # defect_type
    tuple[VC, ...],          # applicable classes
    C | None,                # classification (None = needs_review)
    list[str],               # valid_positions
    bool,                    # position_required
    bool,                    # allow_null_position
    dict,                    # details_schema (empty dict = none)
    dict,                    # threshold (empty dict = none)
    str | None,              # notes_default
    G | None,                # group_override (None inherits from part default)
]

RULES: list[RuleSpec] = [
    # ── Tires ─────────────────────────────────────────
    (P.TIRE, T.LOW_TREAD, ALL_CLASSES, C.SEV2,
     FOUR_CORNER, True, False, TREAD_DEPTH_SCHEMA, {}, None, None),
    (P.TIRE, T.FLAT, ALL_CLASSES, C.ULC,
     FOUR_CORNER, True, False, {}, {}, "Vehicle is unable to leave compound.", None),
    (P.TIRE, T.SIDEWALL_DAMAGE, ALL_CLASSES, C.SEV1,
     FOUR_CORNER, True, False, {}, {}, None, None),
    (P.TIRE, T.OBJECT_EMBEDDED, ALL_CLASSES, C.SEV2,
     FOUR_CORNER, True, False, {}, {}, None, None),

    # ── Lights ────────────────────────────────────────
    (P.HEADLIGHT, T.NOT_WORKING, ALL_CLASSES, C.SEV1,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.HEADLIGHT, T.CRACKED, ALL_CLASSES, C.SEV3,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.TAIL_LIGHT, T.NOT_WORKING, ALL_CLASSES, C.SEV1,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.TAIL_LIGHT, T.CRACKED, ALL_CLASSES, C.SEV3,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.TURN_SIGNAL, T.NOT_WORKING, ALL_CLASSES, C.SEV1,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.HAZARD_LIGHT, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.LICENSE_PLATE_LIGHT, T.NOT_WORKING, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.MARKER_LIGHT, T.NOT_WORKING, DOT_ONLY, C.SEV2,
     LEFT_RIGHT, True, False, {}, {},
     "DOT-only check; required on step vans + box trucks.", None),

    # ── Windshield + Wipers ───────────────────────────
    (P.WINDSHIELD, T.CRACKED, ALL_CLASSES, None,  # severity depends on LOS
     [], False, True, WINDSHIELD_LOS_SCHEMA, {},
     "If `in_drivers_line_of_sight=true`, vehicle is grounded (Sev1).", None),
    (P.WIPER_BLADE, T.DAMAGED, ALL_CLASSES, C.SEV3,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.WIPER_BLADE, T.MISSING, ALL_CLASSES, C.SEV2,
     LEFT_RIGHT, True, False, {}, {}, None, None),

    # ── Mirrors ───────────────────────────────────────
    (P.SIDE_MIRROR, T.CRACKED, ALL_CLASSES, C.SEV2,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.SIDE_MIRROR, T.BROKEN, ALL_CLASSES, C.SEV1,
     LEFT_RIGHT, True, False, {}, {}, None, None),

    # ── Body ──────────────────────────────────────────
    (P.BUMPER, T.DAMAGED, ALL_CLASSES, C.ADVISORY,
     FRONT_REAR, True, False, {}, {}, None, None),
    (P.FENDER, T.DAMAGED, ALL_CLASSES, C.ADVISORY,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.HOOD, T.DAMAGED, ICE_ONLY, C.SEV3,
     [], False, True, {}, {}, None, None),

    # ── Doors ─────────────────────────────────────────
    (P.EXTERIOR_DOOR, T.WONT_CLOSE, ALL_CLASSES, C.SEV1,
     DOOR_POSITIONS, True, False, {}, {}, None, None),
    (P.SLIDING_SIDE_DOOR, T.WONT_OPEN, ALL_CLASSES, C.SEV2,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.REAR_CARGO_DOOR, T.WONT_CLOSE, ALL_CLASSES, C.SEV1,
     [], False, True, {}, {}, None, None),

    # ── Interior ──────────────────────────────────────
    (P.SEATBELT, T.FRAYED, ALL_CLASSES, C.SEV1,
     DRIVER_PASSENGER, True, False, {}, {}, None, None),
    (P.SEATBELT, T.WONT_RETRACT, ALL_CLASSES, C.SEV2,
     DRIVER_PASSENGER, True, False, {}, {}, None, None),
    (P.SEATBELT_BUCKLE, T.BROKEN, ALL_CLASSES, C.SEV1,
     DRIVER_PASSENGER, True, False, {}, {}, None, None),
    (P.DRIVER_SEAT, T.DAMAGED, ALL_CLASSES, C.ADVISORY,
     [], False, True, {}, {}, None, None),

    # ── Brakes + Steering ─────────────────────────────
    (P.SERVICE_BRAKE, T.NOT_WORKING, ALL_CLASSES, C.ULC,
     [], False, True, {}, {}, "Vehicle unable to leave compound.", None),
    (P.SERVICE_BRAKE, T.NOISE, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.PARKING_BRAKE, T.NOT_WORKING, ALL_CLASSES, C.SEV1,
     [], False, True, {}, {}, None, None),
    (P.STEERING_WHEEL, T.VIBRATION, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.ALIGNMENT, T.PULLS_LEFT, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.ALIGNMENT, T.PULLS_RIGHT, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),

    # ── Cameras + Warning lamp (ICE variant) ──────────
    (P.WARNING_LAMP, T.ON_OR_FLASHING, ICE_ONLY, None,
     [], False, True, WARNING_LAMP_SCHEMA_ICE, {},
     "Severity depends on lamp_type — service_due is Advisory; brake/airbag are Sev1.", None),
    # ── Warning lamp (EV variant — no oil/coolant/def/glow_plug) ─
    (P.WARNING_LAMP, T.ON_OR_FLASHING, EV_ONLY, None,
     [], False, True, WARNING_LAMP_SCHEMA_EV, {},
     "EV warning lamps — no ICE-specific lamp types.", G.AMR),
    (P.REAR_CAMERA, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.SIDE_CAMERA, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.CAMERA_MONITOR, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.NETRADYNE_CAMERA, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),

    # ── HVAC ──────────────────────────────────────────
    (P.AC, T.NO_COLD_AIR, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.HEATER, T.NO_HEAT, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),

    # ── Fluids (ICE only) ─────────────────────────────
    (P.ENGINE_OIL, T.LEAKING, ICE_ONLY, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.ENGINE_OIL, T.LOW_FLUID, ICE_ONLY, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.COOLANT, T.LEAKING, ICE_ONLY, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.BRAKE_FLUID, T.LEAKING, ALL_CLASSES, C.SEV1,
     [], False, True, {}, {}, "Brake fluid leak grounds the vehicle.", None),

    # ── Fluids: full 5-type matrix for the inspector wizard's Fluids card ─
    # Added 2026-05-26. Each universal fluid (brake / washer / coolant /
    # power steering) gets the canonical 5 defect types so the wizard's
    # chip strip stays consistent across fluids. Severity tiers reflect
    # operational risk: a broken tank or full leak grounds the truck (SEV1);
    # missing cap or low level slows next-day ops (SEV2/SEV3); "Other" is
    # a SEV3 catchall that the SW can re-classify when they triage.
    # Brake fluid LEAKING is already SEV1 above and is intentionally left
    # in place — we don't redeclare it here so the seed doesn't UPSERT a
    # duplicate row on the (part, defect_type) unique constraint.
    (P.BRAKE_FLUID, T.LOW_FLUID, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.BRAKE_FLUID, T.TANK_BROKEN, ALL_CLASSES, C.SEV1,
     [], False, True, {}, {}, "Cracked brake fluid reservoir = imminent loss of pressure.", None),
    (P.BRAKE_FLUID, T.MISSING_CAP, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.BRAKE_FLUID, T.OTHER, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),

    (P.WASHER_FLUID, T.LEAKING, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.WASHER_FLUID, T.LOW_FLUID, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.WASHER_FLUID, T.TANK_BROKEN, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.WASHER_FLUID, T.MISSING_CAP, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.WASHER_FLUID, T.OTHER, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),

    # Coolant LEAKING is already SEV2 above; add the remaining 4 types.
    (P.COOLANT, T.LOW_FLUID, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.COOLANT, T.TANK_BROKEN, ALL_CLASSES, C.SEV1,
     [], False, True, {}, {}, "Coolant tank crack risks overheating mid-route.", None),
    (P.COOLANT, T.MISSING_CAP, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.COOLANT, T.OTHER, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),

    (P.POWER_STEERING_FLUID, T.LEAKING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.POWER_STEERING_FLUID, T.LOW_FLUID, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.POWER_STEERING_FLUID, T.TANK_BROKEN, ALL_CLASSES, C.SEV1,
     [], False, True, {}, {}, "Power steering tank crack — loss of assist while driving.", None),
    (P.POWER_STEERING_FLUID, T.MISSING_CAP, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.POWER_STEERING_FLUID, T.OTHER, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),

    # Gear grease — Step Van DOT only (drivetrain differential lube).
    (P.GEAR_GREASE, T.LEAKING, (VC.STEP_VAN_DOT,), C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.GEAR_GREASE, T.LOW_FLUID, (VC.STEP_VAN_DOT,), C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.GEAR_GREASE, T.TANK_BROKEN, (VC.STEP_VAN_DOT,), C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.GEAR_GREASE, T.MISSING_CAP, (VC.STEP_VAN_DOT,), C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.GEAR_GREASE, T.OTHER, (VC.STEP_VAN_DOT,), C.SEV3,
     [], False, True, {}, {}, None, None),

    # ── Compliance ────────────────────────────────────
    (P.INSPECTION_STICKER, T.EXPIRED, ALL_CLASSES, C.SEV2,
     [], False, True, EXP_MONTH_SCHEMA, {}, None, None),
    (P.REGISTRATION_STICKER, T.EXPIRED, ALL_CLASSES, C.SEV2,
     [], False, True, EXP_MONTH_SCHEMA, {}, None, None),
    (P.LICENSE_PLATE, T.MISSING, ALL_CLASSES, C.SEV1,
     [Pos.FRONT.value, Pos.REAR.value], False, True,
     {}, {}, None, None),
    (P.FIRE_EXTINGUISHER, T.MISSING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.FIRE_EXTINGUISHER, T.EXPIRED, ALL_CLASSES, C.SEV3,
     [], False, True, EXP_DATE_SCHEMA, {}, None, None),

    # ── DOT-only ──────────────────────────────────────
    (P.MUD_FLAP, T.MISSING, DOT_ONLY, C.SEV2,
     [Pos.DRIVER_SIDE.value, Pos.PASSENGER_SIDE.value], False, True,
     {}, {}, None, None),
    (P.DOT_DECAL, T.MISSING, DOT_ONLY, C.SEV2,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.PRIME_DECAL, T.MISSING, DOT_ONLY, C.ADVISORY,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.AIR_PRESSURE_GAUGE, T.NOT_WORKING, DOT_ONLY, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.PAPER_DOCUMENT, T.MISSING, DOT_ONLY, C.SEV2,
     [], False, True, {}, {},
     "DOT trucks must carry insurance + registration paper docs.", None),
    (P.REFLECTIVE_TRIANGLES, T.MISSING, DOT_ONLY, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.SPARE_FUSES, T.MISSING, DOT_ONLY, C.SEV3,
     [], False, True, {}, {}, None, None),

    # ── EV-only ───────────────────────────────────────
    (P.CHARGING_PORT_CAP, T.DAMAGED, EV_ONLY, C.SEV3,
     [Pos.DRIVER_SIDE.value, Pos.PASSENGER_SIDE.value], False, True,
     {}, {}, None, None),
    (P.EV_CENTER_DISPLAY, T.NOT_WORKING, EV_ONLY, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.HIGH_VOLTAGE_CABLE, T.DAMAGED, EV_ONLY, C.SEV1,
     [], False, True, {}, {},
     "Exposed/damaged high-voltage cable grounds the EV immediately.", None),
    (P.AVAS_SPEAKER, T.NOT_WORKING, EV_ONLY, C.SEV2,
     [], False, True, {}, {}, None, None),

    # ── PDF-driven backfills ──────────────────────────
    # (additional rules referenced by Cargo + DOT DVIC seed below)
    (P.INTERIOR_CLEANLINESS, T.DIRTY, ALL_CLASSES, C.ADVISORY,
     [], False, True, {}, {},
     "Trash, dust, or grime accumulating in the cab/cargo area.", None),
    (P.INTERIOR_CLEANLINESS, T.ODOR, ALL_CLASSES, C.ADVISORY,
     [], False, True, {}, {}, None, None),
    (P.INTERIOR_LOOSE_OBJECTS, T.HAS_LOOSE_OBJECTS, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {},
     "Loose objects or spilled liquid that compromise safe driving.", None),
    (P.SUSPENSION, T.MISALIGNED, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {},
     "Noticeable leaning when parked — suspension misalignment.", None),
    (P.UNDERCARRIAGE_OBJECT, T.HANGING, ALL_CLASSES, C.SEV1,
     [Pos.FRONT.value, Pos.REAR.value, Pos.DRIVER_SIDE.value, Pos.PASSENGER_SIDE.value],
     False, True, {}, {}, None, None),
    (P.LICENSE_PLATE, T.DAMAGED, ALL_CLASSES, C.SEV3,
     [Pos.FRONT.value, Pos.REAR.value], False, True, {}, {}, None, None),
    (P.LICENSE_PLATE, T.EXPIRED, ALL_CLASSES, C.SEV2,
     [Pos.FRONT.value, Pos.REAR.value], False, True, EXP_DATE_SCHEMA, {},
     "Temporary tag past expiration date.", None),
    (P.WIPER_BLADE, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.WASHER_SYSTEM, T.NOT_WORKING, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.WASHER_SYSTEM, T.EMPTY, ALL_CLASSES, C.ADVISORY,
     [], False, True, {}, {},
     "Wiper fluid reservoir empty.", None),
    (P.HORN, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.SEATBELT_ALARM, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.BACKUP_ALARM, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.DELIVERY_DEVICE_CRADLE, T.DAMAGED, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.DELIVERY_DEVICE_CRADLE, T.MISSING, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.DASHBOARD_ILLUMINATION, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),
    (P.WINDSHIELD, T.NON_APPROVED, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {},
     "Device or accessory mounted on windshield (non-approved).", None),
    # Doors that aren't part of the V2.2 §10.3 examples but appear in the PDF
    (P.BULKHEAD_DOOR, T.WONT_OPEN, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {},
     "Interior sliding/bulkhead door cannot open or close.", None),
    (P.EXTERIOR_DOOR, T.WONT_OPEN, ALL_CLASSES, C.SEV2,
     [Pos.DRIVER_SIDE.value, Pos.PASSENGER_SIDE.value, Pos.REAR.value],
     False, True, {}, {},
     "Door cannot open, close, lock, or unlock from inside the vehicle.", None),
    # Body and step items (PDF "Items attached to the body of the vehicle")
    (P.SIDE_STEP, T.DAMAGED, ALL_CLASSES, C.SEV3,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.REAR_STEP, T.DAMAGED, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {}, None, None),
    (P.LIFT_GATE, T.DAMAGED, DOT_ONLY, C.SEV2,
     [], False, True, {}, {}, None, None),
    # DOT-specific PDF items
    (P.PERIODIC_INSPECTION_STICKER, T.EXPIRED, DOT_ONLY, C.SEV2,
     [], False, True, EXP_MONTH_SCHEMA, {},
     "DOT/CA BIT/State inspection sticker expired or illegible.", None),
    (P.FUEL_CAP, T.MISSING, DOT_ONLY, C.SEV2,
     [Pos.DRIVER_SIDE.value, Pos.PASSENGER_SIDE.value], False, True,
     {}, {}, None, None),
    (P.MUD_FLAP, T.DAMAGED, DOT_ONLY, C.SEV3,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.DOT_DECAL, T.DAMAGED, DOT_ONLY, C.SEV3,
     LEFT_RIGHT, True, False, {}, {},
     "Amazon DOT decal damaged, dirty, or not visible.", None),
    (P.PRIME_DECAL, T.DAMAGED, DOT_ONLY, C.ADVISORY,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.BATTERY_COVER, T.MISSING, (VC.BOX_TRUCK_DOT,), C.SEV2,
     [], False, True, {}, {},
     "Battery cover missing or bolts not present (Box Trucks only).", None),
    (P.AIR_PRESSURE_GAUGE, T.OVER_PRESSURE, DOT_ONLY, C.SEV2,
     [], False, True, {}, {},
     "Air pressure gauge reads over 120 PSI.", None),

    # Generic "any lights/covers cracked" — referenced by every section's
    # catch-all check ("Any lights or light covers are cracked..."). One rule
    # per anchor part used as the section's stand-in.
    (P.HEADLIGHT, T.COVER_CRACKED, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {},
     "Generic catch-all for any front-side light cover cracked / missing.", None),
    (P.TAIL_LIGHT, T.COVER_CRACKED, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {},
     "Generic catch-all for any back-side light cover cracked / missing.", None),
    # Wheel-nut/rim/mounting damage — appears front + back, driver + passenger.
    (P.WHEEL_NUT, T.DAMAGED, ALL_CLASSES, C.SEV1,
     FOUR_CORNER, True, False, {}, {}, None, None),
    # Side mirror — extra defect types beyond CRACKED/BROKEN
    (P.SIDE_MIRROR, T.NOT_ADJUSTABLE, ALL_CLASSES, C.SEV3,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.SIDE_MIRROR, T.LOOSE, ALL_CLASSES, C.SEV3,
     LEFT_RIGHT, True, False, {}, {}, None, None),

    # Mirror light (turn signal mounted on side mirror) — additional defects
    (P.MIRROR_LIGHT, T.NOT_WORKING, ALL_CLASSES, C.SEV2,
     LEFT_RIGHT, True, False, {}, {}, None, None),
    (P.MIRROR_LIGHT, T.COVER_CRACKED, ALL_CLASSES, C.SEV3,
     LEFT_RIGHT, True, False, {}, {}, None, None),

    # Exterior door damage variants (PDF "Doors: dent, scratch, misaligned, missing panel")
    (P.EXTERIOR_DOOR, T.DAMAGED, ALL_CLASSES, C.SEV3,
     [Pos.DRIVER_SIDE.value, Pos.PASSENGER_SIDE.value, Pos.REAR.value],
     False, True, {}, {},
     "Door dent, scratch, paint damage.", None),
    (P.EXTERIOR_DOOR, T.MISALIGNED, ALL_CLASSES, C.SEV2,
     [Pos.DRIVER_SIDE.value, Pos.PASSENGER_SIDE.value, Pos.REAR.value],
     False, True, {}, {}, None, None),
    (P.SIDE_PANEL, T.MISSING, ALL_CLASSES, C.SEV1,
     LEFT_RIGHT, True, False, {}, {},
     "Door or side panel missing.", None),
    (P.SIDE_PANEL, T.DAMAGED, ALL_CLASSES, C.SEV3,
     LEFT_RIGHT, True, False, {}, {},
     "Side panel dent, scratch, paint damage.", None),

    # State Inspection sticker — separate from periodic_inspection (DOT-only)
    # Use inspection_sticker (already in catalog) for state inspection — extend
    # with damaged variant.
    (P.INSPECTION_STICKER, T.DAMAGED, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {},
     "State inspection sticker damaged or illegible.", None),
    (P.INSPECTION_STICKER, T.MISSING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {}, None, None),

    # Netradyne hanging — separate defect from "not_working"
    (P.NETRADYNE_CAMERA, T.HANGING, ALL_CLASSES, C.SEV2,
     [], False, True, {}, {},
     "Netradyne camera hanging or disconnected from bracket.", G.NETRADYNE),

    # NOTE: (P.TAIL_LIGHT, T.CRACKED, ALL_CLASSES, …) was duplicated here —
    # the earlier "lights" block already lists this exact spec. The second
    # entry caused a UniqueViolationError on defect_applicability_rule_class_uq
    # when seeding a fresh DB (both passes queued INSERTs for the same
    # (rule_id, vehicle_class) pairs without a flush between them).

    # Box Truck additions (NOVABODY/core insert_box_truck_dvic_template.py)
    (P.LOW_AIR_WARNING, T.ON_OR_FLASHING, DOT_ONLY, C.SEV2,
     [], False, True, {}, {},
     "Air pressure gauge reads below DOT minimum (79 psi / 5.5 kg cm²).", None),
    (P.SEATBELT, T.MISSING, ALL_CLASSES, C.SEV1,
     [Pos.DRIVER.value, Pos.PASSENGER.value], False, True, {}, {},
     "Seatbelt missing, torn, frayed, or not retracting.", None),
    (P.FLOOR_PANEL, T.DAMAGED, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {},
     "Cargo floor panel or shelving missing/damaged/loose/zip-tied.", None),
    (P.EXTERIOR_DOOR, T.WONT_LOCK, ALL_CLASSES, C.SEV2,
     [Pos.DRIVER_SIDE.value, Pos.PASSENGER_SIDE.value, Pos.REAR.value], False, True, {}, {},
     "Exterior door cannot lock/unlock from inside the cab.", None),
    (P.WINDSHIELD, T.OBSTRUCTED, ALL_CLASSES, C.SEV3,
     [], False, True, {}, {},
     "Device or accessory mounted on the windshield obstructing view.", None),

    # ── PM service umbrella (DSP-only, all vehicle classes) ───────────
    # These are not "defects" in the inspection sense — they're scheduled
    # preventive maintenance items the DSP launches from the home "Create
    # Work Order → Schedule PM" flow. Classification stays None so the
    # backend treats them as routine work (not safety-critical). The
    # frontend never exposes them via the inspector wizard because
    # P.PM_SERVICE has no PART_SYSTEMS row.
    (P.PM_SERVICE, T.OIL_CHANGE, ALL_CLASSES, None,
     [], False, True, {}, {},
     "Scheduled oil + filter change.", None),
    (P.PM_SERVICE, T.TIRE_ROTATION, ALL_CLASSES, None,
     [], False, True, {}, {},
     "Scheduled tire rotation (corner positions swap).", None),
    (P.PM_SERVICE, T.BRAKE_PM_INSPECTION, ALL_CLASSES, None,
     [], False, True, {}, {},
     "Scheduled brake-pad / disc inspection (no defect required).", None),
    (P.PM_SERVICE, T.FULL_PM_SERVICE, ALL_CLASSES, None,
     [], False, True, {}, {},
     "Scheduled full PM (oil + tires + brakes + fluids).", None),
    (P.PM_SERVICE, T.WHEEL_ALIGNMENT, ALL_CLASSES, None,
     [], False, True, {}, {},
     "Scheduled 4-wheel alignment.", None),
    (P.PM_SERVICE, T.COOLANT_FLUSH, ALL_CLASSES, None,
     [], False, True, {}, {},
     "Scheduled coolant drain + refill.", None),
    (P.PM_SERVICE, T.TRANSMISSION_SERVICE, ALL_CLASSES, None,
     [], False, True, {}, {},
     "Scheduled transmission fluid service.", None),
    (P.PM_SERVICE, T.CABIN_AIR_FILTER, ALL_CLASSES, None,
     [], False, True, {}, {},
     "Scheduled cabin air filter replacement.", None),
    (P.PM_SERVICE, T.OTHER_PM, ALL_CLASSES, None,
     [], False, True, {}, {},
     "Other preventive maintenance — describe in notes.", None),
]


# ─────────────────────────────────────────────────────
# Helpers exposed for the CLI seed command
# ─────────────────────────────────────────────────────
def get_part_group_defaults() -> list[tuple[P, G, str | None]]:
    return PART_GROUP_DEFAULTS


def get_part_systems() -> list[tuple[P, S, bool, str | None]]:
    return PART_SYSTEMS


def get_rules() -> list[RuleSpec]:
    return RULES


def expand_applicability(rule: RuleSpec) -> list[dict]:
    """Expand one RuleSpec into one applicability dict per applicable class."""
    (
        _part, _defect_type, classes, classification, valid_positions,
        position_required, allow_null_position, details_schema, threshold,
        notes_default, _group_override,
    ) = rule
    out: list[dict] = []
    for vc in classes:
        out.append({
            "vehicle_class": vc,
            "valid_positions": list(valid_positions),
            "position_required": position_required,
            "allow_null_position": allow_null_position,
            "threshold": dict(threshold),
            "classification": classification,
            "details_schema": dict(details_schema),
            "notes": notes_default,  # for Fase 1 we don't override per-class
            "needs_review": classification is None,
        })
    return out
