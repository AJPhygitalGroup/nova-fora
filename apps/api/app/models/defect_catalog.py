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
    """[LEGACY] 13 abstract groupings retained for the existing v2 catalog
    (DefectPartSystem cross-references). Phased out in favor of DvicSection
    once the DvicTemplate-driven wizard rolls out — but kept active so v2
    defects from before that migration keep rendering correctly."""

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


class DvicSection(str, Enum):
    """6 physical sections matching the Amazon DVIC PDF structure.

    The new wizard groups parts FIRST by section (where on the vehicle the
    inspector is currently standing) instead of by abstract category. Each
    DvicTemplateItem belongs to exactly one section.
    """

    GENERAL = "general"                # documentation, cleanliness, safety accessories
    FRONT_SIDE = "front_side"          # front lights, front suspension, hood latch
    BACK_SIDE = "back_side"            # tail/license/hazard lights, back body, lift gate
    DRIVER_SIDE = "driver_side"        # driver tires, mirrors, side decals, mud flap
    PASSENGER_SIDE = "passenger_side"  # mirror image of driver side
    IN_CAB = "in_cab"                  # wipers, brakes, HVAC, steering, dash, doors, windshield


class AssetType(str, Enum):
    """Vehicle classifications that drive which DVIC template is loaded.

    DOT-regulated step vans (STEP_VAN_*) get extra checks: documentation,
    fire extinguisher, fuel cap, mud flaps, Amazon DOT decals, air pressure
    gauge, etc. Non-DOT cargo vans skip those.

    Mapped 1:1 with Amazon's `Asset type` field on the DVIR header.
    """

    EXTRA_LARGE_CARGO_VAN = "extra_large_cargo_van"  # Ford Transit 350, Sprinter 3500
    LARGE_CARGO_VAN = "large_cargo_van"              # Transit 250, ProMaster 1500
    STEP_VAN_MEDIUM = "step_van_medium"              # box truck — DOT
    STEP_VAN_LARGE = "step_van_large"                # large box truck — DOT
    ELECTRIC_DELIVERY_VEHICLE = "electric_delivery_vehicle"  # Rivian EDV — non-DOT, cargo-van checklist


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
    # ── DVIC-specific additions (Cargo + DOT PDFs, Apr 2026) ──
    SUSPENSION = "suspension"               # noticeable leaning of vehicle
    UNDERBODY_OBJECT = "underbody_object"   # loose/hanging objects underneath
    FLUID_LEAK = "fluid_leak"               # active non-clear fluid leaking on ground
    HOOD_LATCH = "hood_latch"               # DOT — front body
    LIFT_GATE = "lift_gate"                 # DOT — back body
    BACKUP_CAMERA = "backup_camera"         # back body
    SIDE_VIEW_CAMERA = "side_view_camera"   # driver/passenger side body
    CARGO_STEP = "cargo_step"               # driver/passenger side body
    FUEL_CAP = "fuel_cap"                   # DOT — driver side charging port
    MUD_FLAP = "mud_flap"                   # DOT — driver/passenger back tire
    BATTERY_COVER = "battery_cover"         # DOT box trucks only
    AMAZON_DOT_DECAL = "amazon_dot_decal"   # DOT — driver/passenger side body
    PRIME_DECAL = "prime_decal"             # DOT — driver/passenger side body
    INSURANCE_DOC = "insurance_doc"         # DOT general — paper documentation
    REGISTRATION_DOC = "registration_doc"   # DOT general
    SHELF = "shelf"                         # interior shelves
    SPARE_FUSE = "spare_fuse"               # DOT general safety
    REFLECTIVE_TRIANGLE = "reflective_triangle"  # DOT general safety
    AIR_PRESSURE_GAUGE = "air_pressure_gauge"    # DOT in-cab brakes
    VEHICLE_INTERIOR = "vehicle_interior"   # generic — cleanliness/loose/odor
    DEVICE_ON_WINDSHIELD = "device_on_windshield"  # for windshield-mounted accessory check


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
    # ── DVIC-specific additions (Apr 2026 PDFs) ──
    LEANING = "leaning"                     # suspension — vehicle visibly leaning
    HAS_OBJECTS_UNDERNEATH = "has_objects_underneath"  # underbody — loose/hanging
    ACTIVE_LEAK_ON_GROUND = "active_leak_on_ground"    # fluid_leak
    ITEMS_LOOSE_OR_HELD_WITH_TAPE = "items_loose_or_held_with_tape"  # body items zip-tied/taped
    EXCESSIVELY_DIRTY = "excessively_dirty"  # decals — not visible due to dirt
    NOT_VISIBLE = "not_visible"              # decals — covered or otherwise not visible
    HAS_ODOR = "has_odor"                    # vehicle interior
    HAS_TRASH_OR_GRIME = "has_trash_or_grime"  # vehicle interior
    HAS_SPILLED_LIQUID = "has_spilled_liquid"  # vehicle interior — could compromise safety
    SQUEAKING = "squeaking"                  # foot brake
    GRINDING = "grinding"                    # foot brake
    LEAKING_AIR = "leaking_air"              # foot brake
    WEAK = "weak"                            # foot/parking brake
    STIFF = "stiff"                          # foot/parking brake / steering
    NEEDS_ALIGNMENT = "needs_alignment"      # steering
    READS_OVER_120_PSI = "reads_over_120_psi"  # DOT air pressure gauge
    DEVICE_MOUNTED = "device_mounted"        # windshield — accessory mounted
    OBSTRUCTED = "obstructed"                # camera/monitor — view blocked
    NOT_IN_GREEN_ZONE = "not_in_green_zone"  # fire extinguisher pressure dial
    NOT_MOUNTED = "not_mounted"              # fire extinguisher / cradle
    BATTERY_COVER_MISSING = "battery_cover_missing"  # DOT box truck battery
    BOLTS_MISSING = "bolts_missing"          # battery / mounting
    CRACKED_OR_HOLE = "cracked_or_hole"      # lights/covers — cracked leaving hole/void
    CANNOT_BE_ADJUSTED = "cannot_be_adjusted"  # side mirrors / driver seat
    EXPOSED_INTERIOR = "exposed_interior"    # driver seat — exposed metal/wire/spring/spring/torn cushion
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


# ─────────────────────────────────────────────────────
# DvicTemplateItem — 1 row per checklist line in the Amazon DVIC PDFs
# ─────────────────────────────────────────────────────
class DvicTemplateItem(SQLModel, table=True):
    """One line item from the Amazon DVIC checklist.

    Together these rows form a "template" for a given asset_type. The
    inspection wizard pulls them filtered by `asset_types` (which contains
    the vehicle's asset_type), groups by `section` then `part_category`,
    and renders each as a tile.

    When the inspector marks an item unsatisfactory, the wizard creates a
    ReportedDefect with:
      part_enum         = this row's `part_enum`
      defect_type_enum  = this row's `defect_type_enum`
      position          = inspector's pick from `position_options` (or
                          this row's pre-set `position` if not user-picked)
      details           = inspector's input for `sub_positions` /
                          `details_schema` (e.g. tread_depth_32nds, beam_type)
      severity          = `default_severity` unless overridden

    The same conceptual check (e.g. "headlight is not working") gets ONE row
    here even though the inspector picks driver/passenger + low/high beam at
    runtime — the sub-position dimensions are encoded in `sub_positions` JSON
    and resolved into `details` on the defect.

    Asset_types is TEXT[] so rows shared by Cargo + DOT (most of them) only
    need 1 row tagged with both asset types.
    """

    __tablename__ = "dvic_template_item"

    id: int | None = Field(default=None, primary_key=True)

    # Which asset types this check applies to. Postgres TEXT[].
    # Stored as comma-separated string for cross-DB friendliness — service
    # layer parses on read. Migration uses ARRAY(VARCHAR) on PG.
    asset_types_csv: str = Field(
        max_length=300, nullable=False, index=True,
        description="Comma-separated AssetType values: 'extra_large_cargo_van,large_cargo_van'",
    )

    # Section + sub-grouping (matches PDF column 1 + 2)
    section: DvicSection = Field(
        sa_column=_enum_col("section", DvicSection, 25, nullable=False, index=True)
    )
    part_category: str = Field(
        max_length=60, nullable=False,
        description="PDF row group: 'Lights and light covers', 'Side mirrors', etc.",
    )

    # The defect to record
    part_enum: DefectPart = Field(
        sa_column=_enum_col("part_enum", DefectPart, 40, nullable=False, index=True)
    )
    defect_type_enum: DefectType = Field(
        sa_column=_enum_col("defect_type_enum", DefectType, 40, nullable=False)
    )

    # Pre-set position (e.g. always front/rear/etc) OR the inspector picks
    # from `position_options`. If both null → no position dimension.
    position: DefectPosition | None = Field(
        default=None,
        sa_column=_enum_col("position", DefectPosition, 30, nullable=True),
    )
    # Comma-separated DefectPosition values inspector may pick from. Empty = no choice.
    position_options_csv: str = Field(default="", max_length=200, nullable=False)

    # Sub-position dimensions (e.g. headlight low_beam vs high_beam).
    # JSON: [{"key": "low_beam", "label": "Low beam"},
    #        {"key": "high_beam", "label": "High beam"}]
    # Inspector picks ONE; stored in defect.details under the key shape's name.
    sub_positions: dict | None = Field(
        default=None,
        sa_column=Column("sub_positions", sa.JSON, nullable=True),
        description="Inline picker dimensions beyond physical position (beam type, "
                    "tread location, seatbelt component, brake symptom, etc.). Null if none.",
    )

    # Exact PDF text — shown in the wizard UI
    description: str = Field(max_length=500, nullable=False)

    # JSON Schema (draft-07) for any extra `details` input beyond sub_positions
    # E.g. tire low_tread → {tread_depth_32nds: {type: "integer", minimum: 0, maximum: 32}}
    details_schema: dict | None = Field(
        default=None,
        sa_column=Column("details_schema", sa.JSON, nullable=True),
    )

    # Display order within (section, part_category)
    ordering: int = Field(default=0, nullable=False)

    is_active: bool = Field(default=True, nullable=False, index=True)

    created_at: __import__("datetime").datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )

    @property
    def asset_types(self) -> list[str]:
        """Parsed asset_types from the CSV column."""
        return [s.strip() for s in self.asset_types_csv.split(",") if s.strip()]

    @property
    def position_options(self) -> list[str]:
        """Parsed position_options from the CSV column."""
        return [s.strip() for s in self.position_options_csv.split(",") if s.strip()]
