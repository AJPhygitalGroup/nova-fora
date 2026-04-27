"""Defect catalog enums + reference tables.

Implements the v2 Defect Data Schema (Notion spec). The catalog drives:
  - Mobile wizard tile rendering (systems → parts → positions → types → details)
  - Server-side validation of (part, position, defect_type) combos
  - Severity derivation per (part, defect_type) (override-able per row)

Storage strategy:
  Reference tables (defect_part_system, defect_part_validity,
  defect_details_schema) are seeded from app code on startup or via a
  CLI command. Updating them is a config change, not a migration.

Enum values are stored as VARCHAR in Postgres (SQLModel + sa.Enum with
native_enum=False) so adding values doesn't require ALTER TYPE downtime.
"""
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


# ─────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────
class DefectSystem(str, Enum):
    """13 top-level groupings the inspector picks first."""

    TIRES_WHEELS = "tires_wheels"
    LIGHTS = "lights"
    WINDSHIELD_WIPERS = "windshield_wipers"
    MIRRORS = "mirrors"
    BODY_STEPS = "body_steps"
    DOORS_WINDOWS = "doors_windows"
    INTERIOR = "interior"
    BRAKES_STEERING = "brakes_steering"
    HVAC = "hvac"
    CAMERAS_ELECTRONICS = "cameras_electronics"
    FLUIDS_UNDER_HOOD = "fluids_under_hood"
    COMPLIANCE = "compliance"
    UNDER_VEHICLE = "under_vehicle"


class DefectPart(str, Enum):
    """70 parts a defect can be reported on. Most belong to one primary
    system but several appear in two (lookup via defect_part_system table)."""

    # tires_wheels
    TIRE = "tire"
    RIM = "rim"
    WHEEL_NUT = "wheel_nut"
    MOUNTING_EQUIPMENT = "mounting_equipment"
    # lights
    HEADLIGHT = "headlight"
    TAIL_LIGHT = "tail_light"
    TURN_SIGNAL = "turn_signal"
    HAZARD_LIGHT = "hazard_light"
    MARKER_LIGHT = "marker_light"
    LICENSE_PLATE_LIGHT = "license_plate_light"
    CABIN_LIGHT = "cabin_light"
    CARGO_LIGHT = "cargo_light"
    STEPWELL_LIGHT = "stepwell_light"
    MIRROR_LIGHT = "mirror_light"
    # windshield_wipers
    WINDSHIELD = "windshield"
    WIPER_BLADE = "wiper_blade"
    WASHER_SYSTEM = "washer_system"
    # mirrors
    SIDE_MIRROR = "side_mirror"
    # body_steps
    BUMPER = "bumper"
    FENDER = "fender"
    HOOD = "hood"
    SIDE_PANEL = "side_panel"
    FLOOR_PANEL = "floor_panel"
    SIDE_STEP = "side_step"
    REAR_STEP = "rear_step"
    # doors_windows
    EXTERIOR_DOOR = "exterior_door"
    SLIDING_SIDE_DOOR = "sliding_side_door"
    BULKHEAD_DOOR = "bulkhead_door"
    REAR_CARGO_DOOR = "rear_cargo_door"
    ROLL_UP_DOOR = "roll_up_door"
    WINDOW = "window"
    DOOR_HARDWARE = "door_hardware"
    # interior
    DRIVER_SEAT = "driver_seat"
    PASSENGER_SEAT = "passenger_seat"
    SEATBELT = "seatbelt"
    SEATBELT_BUCKLE = "seatbelt_buckle"
    SUN_VISOR = "sun_visor"
    INTERIOR_CLEANLINESS = "interior_cleanliness"
    INTERIOR_LOOSE_OBJECTS = "interior_loose_objects"
    FIRE_EXTINGUISHER = "fire_extinguisher"
    # brakes_steering
    PARKING_BRAKE = "parking_brake"
    SERVICE_BRAKE = "service_brake"
    STEERING_WHEEL = "steering_wheel"
    ALIGNMENT = "alignment"
    # hvac
    AC = "ac"
    HEATER = "heater"
    DEFROSTER = "defroster"
    CABIN_FAN = "cabin_fan"
    # cameras_electronics
    NETRADYNE_CAMERA = "netradyne_camera"
    REAR_CAMERA = "rear_camera"
    SIDE_CAMERA = "side_camera"
    CAMERA_MONITOR = "camera_monitor"
    WARNING_LAMP = "warning_lamp"
    BACKUP_ALARM = "backup_alarm"
    SEATBELT_ALARM = "seatbelt_alarm"
    HORN = "horn"
    USB_PORT = "usb_port"
    PHONE_CHARGER = "phone_charger"
    DELIVERY_DEVICE_CRADLE = "delivery_device_cradle"
    PHONE_CRADLE = "phone_cradle"
    # fluids_under_hood
    COOLANT = "coolant"
    BRAKE_FLUID = "brake_fluid"
    POWER_STEERING_FLUID = "power_steering_fluid"
    DEF_FLUID = "def_fluid"
    ENGINE_OIL = "engine_oil"
    GEAR_OIL = "gear_oil"
    # compliance
    LICENSE_PLATE = "license_plate"
    INSPECTION_STICKER = "inspection_sticker"
    REGISTRATION_STICKER = "registration_sticker"
    # under_vehicle
    UNDERCARRIAGE_OBJECT = "undercarriage_object"


class DefectPosition(str, Enum):
    """Where on the vehicle. Not every part takes a position (e.g. windshield).
    Per-part validity stored in defect_part_validity table."""

    # 4-corner (tires/wheels)
    DRIVER_FRONT = "driver_front"
    PASSENGER_FRONT = "passenger_front"
    DRIVER_REAR = "driver_rear"
    PASSENGER_REAR = "passenger_rear"
    # left/right (lights, mirrors, fenders, etc.)
    DRIVER_SIDE = "driver_side"
    PASSENGER_SIDE = "passenger_side"
    # front/back (bumpers, undercarriage objects)
    FRONT = "front"
    REAR = "rear"
    # interior driver/passenger (seatbelts, seats, sun visors)
    DRIVER = "driver"
    PASSENGER = "passenger"
    # vertical (rare — kept for forward-compat)
    UPPER = "upper"
    LOWER = "lower"


class DefectType(str, Enum):
    """What's wrong with the part. ~50 values. Per-part validity stored in
    defect_details_schema (presence of a (part, defect_type) row = allowed)."""

    # function
    NOT_WORKING = "not_working"
    INTERMITTENT = "intermittent"
    FLICKERING = "flickering"
    ON_OR_FLASHING = "on_or_flashing"
    NO_COLD_AIR = "no_cold_air"
    NO_HEAT = "no_heat"
    # physical state
    MISSING = "missing"
    DAMAGED = "damaged"
    CRACKED = "cracked"
    BROKEN = "broken"
    BENT = "bent"
    FRAYED = "frayed"
    TORN = "torn"
    RUSTED = "rusted"
    LEAKING = "leaking"
    COVER_CRACKED = "cover_cracked"
    COVER_MISSING = "cover_missing"
    # attachment
    LOOSE = "loose"
    HANGING = "hanging"
    UNSECURED = "unsecured"
    ZIP_TIED_OR_TAPED = "zip_tied_or_taped"
    OFF_TRACK = "off_track"
    OFF_CENTER = "off_center"
    MISALIGNED = "misaligned"
    DISCONNECTED = "disconnected"
    # movement
    STUCK = "stuck"
    WONT_OPEN = "wont_open"
    WONT_CLOSE = "wont_close"
    WONT_LOCK = "wont_lock"
    WONT_UNLOCK = "wont_unlock"
    WONT_LATCH = "wont_latch"
    WONT_RETRACT = "wont_retract"
    # tire-specific
    FLAT = "flat"
    LOW_TREAD = "low_tread"
    SIDEWALL_DAMAGE = "sidewall_damage"
    OBJECT_EMBEDDED = "object_embedded"
    EXPOSED_WIRE = "exposed_wire"
    BULGE = "bulge"
    # wheel-specific
    STUD_BROKEN = "stud_broken"
    HUB_CAP_MISSING = "hub_cap_missing"
    # fluid-specific
    LOW_FLUID = "low_fluid"
    EMPTY = "empty"
    # documentation
    EXPIRED = "expired"
    ILLEGIBLE = "illegible"
    WRONG_VEHICLE = "wrong_vehicle"
    # work needed
    NEEDS_ADJUSTMENT = "needs_adjustment"
    NEEDS_GREASE = "needs_grease"
    NEEDS_DIAGNOSTIC = "needs_diagnostic"
    NEEDS_REPLACEMENT = "needs_replacement"
    # feel
    PULLS_LEFT = "pulls_left"
    PULLS_RIGHT = "pulls_right"
    VIBRATION = "vibration"
    NOISE = "noise"
    # cleanliness
    DIRTY = "dirty"
    HAS_LOOSE_OBJECTS = "has_loose_objects"
    # mount / bracket
    MOUNT_DAMAGED = "mount_damaged"
    # catchall
    OTHER_DAMAGE = "other_damage"


# ─────────────────────────────────────────────────────
# Reference tables
# ─────────────────────────────────────────────────────
def _enum_col(name: str, enum_cls, length: int, nullable: bool = False, **kw):
    return Column(
        name,
        sa.Enum(
            enum_cls,
            native_enum=False,
            length=length,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=nullable,
        **kw,
    )


class DefectPartSystem(SQLModel, table=True):
    """Maps a part to one or more systems it appears under.

    Composite PK (part, system). Exactly one row per part has is_primary=True.
    Used to:
      - render the same part under multiple system tiles (mirror_light shows
        in both Lights and Mirrors)
      - decide which system a defect rolls up to in dashboards (the primary)
      - apply UI grouping ('exterior', 'cabin_cargo', etc.) inside a system
    """

    __tablename__ = "defect_part_system"

    part: DefectPart = Field(
        sa_column=_enum_col("part", DefectPart, 40, primary_key=True, index=True)
    )
    system: DefectSystem = Field(
        sa_column=_enum_col("system", DefectSystem, 30, primary_key=True, index=True)
    )
    is_primary: bool = Field(default=False, nullable=False)
    display_group: str | None = Field(default=None, max_length=50)


class DefectPartValidity(SQLModel, table=True):
    """Position rules per part.

    valid_positions: the enum values that may be passed for this part.
    position_required: if True, position must be set (e.g. tire = 4 corners).
    allow_null_position: convenience flag for fast checks; equals
                         (not position_required) but explicit for clarity.
    """

    __tablename__ = "defect_part_validity"

    part: DefectPart = Field(
        sa_column=_enum_col("part", DefectPart, 40, primary_key=True, index=True)
    )
    # Stored as comma-separated strings for portability. Service-layer parses
    # back into the DefectPosition enum on read. (Postgres array column would
    # also work — chose simple text for cross-DB friendliness.)
    valid_positions_csv: str = Field(default="", max_length=300, nullable=False)
    position_required: bool = Field(default=False, nullable=False)
    allow_null_position: bool = Field(default=True, nullable=False)


class DefectDetailsSchema(SQLModel, table=True):
    """JSON Schema (draft-07) per (part, defect_type) pair.

    The presence of a row here is also the allow-list — a write of a
    (part, defect_type) combo that has no row gets rejected by the service
    layer. An empty dict ({}) means no follow-up needed.
    """

    __tablename__ = "defect_details_schema"

    part: DefectPart = Field(
        sa_column=_enum_col("part", DefectPart, 40, primary_key=True, index=True)
    )
    defect_type: DefectType = Field(
        sa_column=_enum_col("defect_type", DefectType, 40, primary_key=True, index=True)
    )
    json_schema: dict = Field(
        default_factory=dict,
        sa_column=Column("json_schema", sa.JSON, nullable=False, server_default="{}"),
    )
    # Default severity for this combo (low/medium/high/critical).
    # Per-defect override stored on reported_defects.severity_override.
    default_severity: str = Field(default="medium", max_length=20)


class DefectSeverityOverride(SQLModel, table=True):
    """Optional per-defect severity override.

    When set, supersedes the default_severity from defect_details_schema.
    Lets DSP admin or vendor admin upgrade/downgrade a defect's urgency
    based on context (e.g. windshield crack outside line of sight = low,
    inside = critical regardless of part-level default).
    """

    __tablename__ = "defect_severity_override"

    defect_id: int = Field(foreign_key="reported_defects.id", primary_key=True)
    severity: str = Field(max_length=20, nullable=False)
    reason: str | None = Field(default=None, max_length=500)
    set_by_id: int | None = Field(default=None, foreign_key="users.id")
    created_at: __import__("datetime").datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
