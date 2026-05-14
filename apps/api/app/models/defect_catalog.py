"""Defect catalog enums + reference tables — V2.2 schema.

Implements the V2.2 Defect Data Schema (`docs/defect-schema-v2.2-spec.md`,
sourced from DFS Portal). The catalog drives:
  - Mobile wizard tile rendering filtered by vehicle_class
  - Server-side validation of (part, position, defect_type) per class
  - Severity (DefectClassification) + operational routing (DefectGroup)
    derivation per (part, defect_type, vehicle_class)

Storage strategy — Path B (CLAUDE.md conventions):
  - VARCHAR enums via `sa.Enum(..., native_enum=False)` so adding values
    is a code change, not an ALTER TYPE migration (CLAUDE.md rule #2).
  - Junction split: DefectRule × DefectApplicability replaces V1's flat
    DefectDetailsSchema + DefectPartValidity.
  - Position arrays stored as `ARRAY(VARCHAR)` — service layer parses
    against the DefectPosition enum on read.

Deviation from V2.2 enum literals: vehicle_class uses descriptive names
(custom_delivery_van, regular_cargo_van, step_van_dot, electric_vehicle,
box_truck_dot) instead of V2.2's short names (cdv, cargo_van, ev_rivian,
box_truck). Mapping in `docs/defect-schema-v2.2-spec.md` Appendix A.
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


# ─────────────────────────────────────────────────────
# Enums (stored as VARCHAR per CLAUDE.md rule #2)
# ─────────────────────────────────────────────────────
class VehicleClass(str, Enum):
    """5 vehicle classes that drive catalog applicability.

    Replaces V1's AssetType. Mapped from Amazon fleet shorthand:
      CDV   → custom_delivery_van
      Cargo → regular_cargo_van
      SV    → step_van_dot
      EV    → electric_vehicle
      AMXL  → box_truck_dot
    """

    CUSTOM_DELIVERY_VAN = "custom_delivery_van"
    REGULAR_CARGO_VAN = "regular_cargo_van"
    STEP_VAN_DOT = "step_van_dot"
    ELECTRIC_VEHICLE = "electric_vehicle"
    BOX_TRUCK_DOT = "box_truck_dot"


class DefectClassification(str, Enum):
    """Severity tier per (part, defect_type, vehicle_class).
    Stored on `defect_applicability.classification`. Nullable until
    severity research lands; pair with `needs_review = true` when null.
    """

    SEV1 = "Sev1"
    SEV2 = "Sev2"
    SEV3 = "Sev3"
    ULC = "ULC"            # Unable to leave compound — immediate ground
    ADVISORY = "Advisory"


class DefectGroup(str, Enum):
    """Operational routing bucket. Determines which work-order queue
    a converted defect lands in. Stored on `defect_rule.group` and
    seeded with defaults from `part_group_default`.
    """

    AMR = "AMR"             # General automotive maintenance & repair
    BODY = "Body"
    CMR = "CMR"             # Commercial Motor Repair
    CNMR = "CNMR"           # Commercial Non-Motor Repair
    PM = "PM"               # Preventive Maintenance
    TIRES = "Tires"
    DETAILING = "Detailing"
    NETRADYNE = "Netradyne"


class DvicSection(str, Enum):
    """6 physical sections from the Amazon DVIC PDF.

    Drives the section-first inspector wizard (one tile per section, then
    items grouped by part_category within). Maps the inspector's physical
    walk around the vehicle: General → Front → Back → Driver → Passenger → Cab.
    """

    GENERAL = "general"
    FRONT_SIDE = "front_side"
    BACK_SIDE = "back_side"
    DRIVER_SIDE = "driver_side"
    PASSENGER_SIDE = "passenger_side"
    IN_CAB = "in_cab"


class DefectSystem(str, Enum):
    """15 systems for inspector UI navigation. Not stored on defect rows
    — only used to render tile groupings in the wizard."""

    TIRES_WHEELS = "tires_wheels"
    LIGHTS = "lights"
    WINDSHIELD_WIPERS = "windshield_wipers"
    MIRRORS = "mirrors"
    BODY_STEPS = "body_steps"
    DOORS_WINDOWS = "doors_windows"
    INTERIOR = "interior"
    BRAKES_STEERING = "brakes_steering"
    AIR_BRAKE = "air_brake"             # DOT only (V2.2)
    HVAC = "hvac"
    CAMERAS_ELECTRONICS = "cameras_electronics"
    FLUIDS_UNDER_HOOD = "fluids_under_hood"
    COMPLIANCE = "compliance"
    UNDER_VEHICLE = "under_vehicle"
    EV_POWERTRAIN = "ev_powertrain"     # EV only (V2.2)


class DefectPart(str, Enum):
    """105 part values per V2.2 §3."""

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
    CLEARANCE_MARKER_LIGHT = "clearance_marker_light"
    # windshield_wipers
    WINDSHIELD = "windshield"
    WIPER_BLADE = "wiper_blade"
    WASHER_SYSTEM = "washer_system"
    # mirrors
    SIDE_MIRROR = "side_mirror"
    # body_steps / frame
    BUMPER = "bumper"
    FENDER = "fender"
    HOOD = "hood"
    SIDE_PANEL = "side_panel"
    FLOOR_PANEL = "floor_panel"
    SIDE_STEP = "side_step"
    REAR_STEP = "rear_step"
    TRIM = "trim"
    SIDE_MOLDING = "side_molding"
    CAB_DOOR = "cab_door"
    FRAME_RAIL = "frame_rail"
    CARGO_SHELF = "cargo_shelf"
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
    # brakes_steering
    PARKING_BRAKE = "parking_brake"
    SERVICE_BRAKE = "service_brake"
    STEERING_WHEEL = "steering_wheel"
    ALIGNMENT = "alignment"
    # air_brake (DOT only)
    SLACK_ADJUSTER = "slack_adjuster"
    BRAKE_CHAMBER = "brake_chamber"
    BRAKE_LINING = "brake_lining"
    BRAKE_DRUM = "brake_drum"
    AIR_COMPRESSOR = "air_compressor"
    AIR_TANK = "air_tank"
    AIR_LINE = "air_line"
    LOW_AIR_WARNING = "low_air_warning"
    # under_vehicle / suspension
    SUSPENSION = "suspension"
    COIL_SPRING = "coil_spring"
    LEAF_SPRING = "leaf_spring"
    AIR_BAG = "air_bag"
    SHOCK_ABSORBER = "shock_absorber"
    TORQUE_ARM = "torque_arm"
    TIE_ROD = "tie_rod"
    DRAG_LINK = "drag_link"
    BALL_JOINT = "ball_joint"
    PITMAN_ARM = "pitman_arm"
    POWER_STEERING = "power_steering"
    U_BOLT = "u_bolt"
    UNDERCARRIAGE_OBJECT = "undercarriage_object"
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
    DASHBOARD_ILLUMINATION = "dashboard_illumination"
    # ev_powertrain
    EV_CENTER_DISPLAY = "ev_center_display"
    HIGH_VOLTAGE_CABLE = "high_voltage_cable"
    CHARGING_PORT_CAP = "charging_port_cap"
    AVAS_SPEAKER = "avas_speaker"
    # fluids_under_hood
    COOLANT = "coolant"
    BRAKE_FLUID = "brake_fluid"
    POWER_STEERING_FLUID = "power_steering_fluid"
    DEF_FLUID = "def_fluid"
    ENGINE_OIL = "engine_oil"
    GEAR_OIL = "gear_oil"
    FUEL_CAP = "fuel_cap"
    BATTERY_12V = "battery_12v"
    BATTERY_COVER = "battery_cover"
    # compliance / safety
    LICENSE_PLATE = "license_plate"
    INSPECTION_STICKER = "inspection_sticker"
    REGISTRATION_STICKER = "registration_sticker"
    DOT_DECAL = "dot_decal"
    PRIME_DECAL = "prime_decal"
    PAPER_DOCUMENT = "paper_document"
    PERIODIC_INSPECTION_STICKER = "periodic_inspection_sticker"
    UNAPPROVED_STICKER = "unapproved_sticker"
    FIRE_EXTINGUISHER = "fire_extinguisher"
    REFLECTIVE_TRIANGLES = "reflective_triangles"
    SPARE_FUSES = "spare_fuses"
    AIR_PRESSURE_GAUGE = "air_pressure_gauge"
    # attached
    LIFT_GATE = "lift_gate"
    MUD_FLAP = "mud_flap"
    # PM umbrella — not surfaced in the inspector wizard (no PART_SYSTEMS
    # row). Exists solely so the DSP "Create Work Order → Schedule PM"
    # flow can mint a defect with one of the PM defect_types below and
    # let the existing create-defect → approve → router pipeline place
    # a PM WO at a PM-capable workshop.
    PM_SERVICE = "pm_service"


class DefectPosition(str, Enum):
    """12 positions per V2.2 §3."""

    DRIVER_FRONT = "driver_front"
    PASSENGER_FRONT = "passenger_front"
    DRIVER_REAR = "driver_rear"
    PASSENGER_REAR = "passenger_rear"
    DRIVER_SIDE = "driver_side"
    PASSENGER_SIDE = "passenger_side"
    FRONT = "front"
    REAR = "rear"
    DRIVER = "driver"
    PASSENGER = "passenger"
    UPPER = "upper"
    LOWER = "lower"


class DefectType(str, Enum):
    """62 defect types per V2.2 §3."""

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
    # mount / pressure / approval / catchall
    MOUNT_DAMAGED = "mount_damaged"
    OVER_PRESSURE = "over_pressure"
    NON_APPROVED = "non_approved"
    OBSTRUCTED = "obstructed"
    PAINT_CHIP = "paint_chip"
    NOT_ADJUSTABLE = "not_adjustable"
    ODOR = "odor"
    OTHER_DAMAGE = "other_damage"
    # PM service umbrella — only valid when part=pm_service. Each value
    # mirrors the PM service-type dropdown in the DSP "Create WO" modal
    # so the same string round-trips end-to-end without translation.
    OIL_CHANGE = "oil_change"
    TIRE_ROTATION = "tire_rotation"
    BRAKE_PM_INSPECTION = "brake_pm_inspection"
    FULL_PM_SERVICE = "full_pm_service"
    WHEEL_ALIGNMENT = "wheel_alignment"
    COOLANT_FLUSH = "coolant_flush"
    TRANSMISSION_SERVICE = "transmission_service"
    CABIN_AIR_FILTER = "cabin_air_filter"
    OTHER_PM = "other_pm"


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
    """Maps a part to one or more systems for inspector UI navigation.

    Composite PK (part, system). Exactly one row per part has is_primary=True
    (enforced by partial unique index in the migration). Used to render the
    same part under multiple system tiles when it logically belongs to more
    than one (mirror_light shows under both Lights and Mirrors).
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


class PartGroupDefault(SQLModel, table=True):
    """Default operational DefectGroup per part. Read by the
    `defect_rule_fill_group` semantics in the seed/CLI layer to populate
    DefectRule.group when the caller leaves it unset.
    """

    __tablename__ = "part_group_default"

    part: DefectPart = Field(
        sa_column=_enum_col("part", DefectPart, 40, primary_key=True, index=True)
    )
    group: DefectGroup = Field(
        sa_column=_enum_col("group", DefectGroup, 20, nullable=False)
    )
    rationale: str | None = Field(default=None, max_length=500)
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )


class DefectRule(SQLModel, table=True):
    """Canonical (part × defect_type) rule. One row per logical defect
    identity, regardless of vehicle class. Per-class details live in
    DefectApplicability.

    UNIQUE (part, defect_type) — adding a rule that already exists is an
    application bug; service layer should pre-check.
    """

    __tablename__ = "defect_rule"
    __table_args__ = (
        UniqueConstraint("part", "defect_type", name="defect_rule_part_type_uq"),
    )

    id: int | None = Field(default=None, primary_key=True)

    part: DefectPart = Field(
        sa_column=_enum_col("part", DefectPart, 40, nullable=False, index=True)
    )
    defect_type: DefectType = Field(
        sa_column=_enum_col("defect_type", DefectType, 40, nullable=False, index=True)
    )
    group: DefectGroup = Field(
        sa_column=_enum_col("group", DefectGroup, 20, nullable=False, index=True)
    )

    # Notes that apply to every vehicle_class for this rule. Per-class
    # overrides go on DefectApplicability.notes.
    notes_default: str | None = Field(default=None, max_length=2000)

    is_active: bool = Field(default=True, nullable=False, index=True)

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )


class DefectApplicability(SQLModel, table=True):
    """A DefectRule applied to a specific vehicle_class with per-class details.

    Together with DefectRule, replaces V1's flat DefectDetailsSchema +
    DefectPartValidity. Halves storage and removes drift risk when a rule
    applies identically to all classes.

    The presence of a row here is the allow-list — service layer rejects
    writes for `(rule.part, rule.defect_type, vehicle.vehicle_class)`
    tuples with no applicability row.
    """

    __tablename__ = "defect_applicability"
    __table_args__ = (
        UniqueConstraint("rule_id", "vehicle_class", name="defect_applicability_rule_class_uq"),
    )

    id: int | None = Field(default=None, primary_key=True)

    rule_id: int = Field(
        sa_column=Column(
            "rule_id",
            sa.Integer,
            ForeignKey("defect_rule.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    vehicle_class: VehicleClass = Field(
        sa_column=_enum_col("vehicle_class", VehicleClass, 30, nullable=False, index=True)
    )

    # Position rules. Stored as ARRAY(VARCHAR(30)) — service layer parses
    # values back into the DefectPosition enum on read.
    valid_positions: list[str] = Field(
        default_factory=list,
        sa_column=Column(
            "valid_positions",
            ARRAY(sa.String(30)),
            nullable=False,
            server_default="{}",
        ),
    )
    position_required: bool = Field(default=False, nullable=False)
    allow_null_position: bool = Field(default=True, nullable=False)

    # Per-class threshold (e.g. {"min_tread_32nds": 4} for steer tires on
    # step_van_dot). JSONB so we can index by JSON path later.
    threshold: dict = Field(
        default_factory=dict,
        sa_column=Column("threshold", JSONB, nullable=False, server_default="{}"),
    )

    # Severity tier for this (rule, class). Nullable until severity research
    # lands — pair with `needs_review = true` to flag for triage.
    classification: DefectClassification | None = Field(
        default=None,
        sa_column=_enum_col("classification", DefectClassification, 20, nullable=True),
    )

    # JSON Schema (draft-07) for the `details` JSON on Defect rows.
    # Empty `{}` means any object passes.
    details_schema: dict = Field(
        default_factory=dict,
        sa_column=Column("details_schema", JSONB, nullable=False, server_default="{}"),
    )

    # Per-class override of DefectRule.notes_default. NULL → fall through.
    notes: str | None = Field(default=None, max_length=2000)

    is_active: bool = Field(default=True, nullable=False, index=True)
    needs_review: bool = Field(default=True, nullable=False, index=True)

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )


# ─────────────────────────────────────────────────────
# Source-rule tables (V2.2 §5.5) — verbatim DVIC text + regulatory metadata
# ─────────────────────────────────────────────────────
class InspectionRuleSource(str, Enum):
    """Origin of an inspection rule. Amazon = canonical DVIC PDF item;
    DSP = local addition by a delivery service partner.
    """

    AMAZON = "Amazon"
    DSP = "DSP"


class InspectionRuleLine(str, Enum):
    """Reporting line classification — secondary axis to DefectGroup.
    Used by reports (e.g., "all Mechanical defects this week") that don't
    care about operational routing.
    """

    MECHANICAL = "Mechanical"
    ELECTRICAL = "Electrical"
    BODY = "Body"
    TIRES = "Tires"
    FLUIDS = "Fluids"
    DOCUMENTATION = "Documentation"
    CLEANLINESS = "Cleanliness"
    SAFETY = "Safety"


class DvicTemplateItem(SQLModel, table=True):
    """Verbatim PDF-shaped DVIC checklist line, mapped to a V2.2 catalog rule.

    The Amazon DVIC PDFs organize defects by physical section (General /
    Front Side / Back Side / Driver Side / Passenger Side / In Cab) and
    `part_category` (e.g. "Lights and light covers", "Side mirrors"), with
    a verbatim description per check ("Headlight is not working").

    Each PDF row becomes one DvicTemplateItem here, pointing at the
    underlying V2.2 (part, defect_type) rule. The wizard reads these rows
    to render its 6-tile section-first UX while the actual defect (when
    committed) is a normal `defects` row referencing the same rule.

    A single rule like `tire / low_tread` produces multiple DvicTemplateItem
    rows — one per (vehicle_class, position, section) combination — because
    the PDF lists tires under both Driver Side ("Front tire / Back tire")
    and Passenger Side. The `position` column captures driver_front /
    passenger_front / driver_rear / passenger_rear etc. for those cases.

    UNIQUE (vehicle_class, section, part_category, rule_id, position) —
    same combo can't appear twice. NULLS NOT DISTINCT so two NULL positions
    on the same rule still collide (used at the Postgres level via the
    migration's functional index).
    """

    __tablename__ = "dvic_template_item"

    id: int | None = Field(default=None, primary_key=True)

    vehicle_class: VehicleClass = Field(
        sa_column=_enum_col("vehicle_class", VehicleClass, 30, nullable=False, index=True)
    )
    section: DvicSection = Field(
        sa_column=_enum_col("section", DvicSection, 25, nullable=False, index=True)
    )
    part_category: str = Field(
        max_length=100, nullable=False,
        description="PDF column 1 group: 'Lights and light covers', 'Side mirrors', etc."
    )

    # FK to V2.2 rule. Cascades on rule delete (rare — rules are deactivated,
    # not deleted in practice).
    rule_id: int = Field(
        sa_column=Column(
            "rule_id",
            sa.Integer,
            ForeignKey("defect_rule.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )

    # Position when the PDF disambiguates (e.g. Driver Side > Front tire vs
    # Back tire). NULL when the inspector picks at runtime (or the rule has
    # no positional dimension).
    position: DefectPosition | None = Field(
        default=None,
        sa_column=_enum_col("position", DefectPosition, 30, nullable=True),
    )

    description: str = Field(
        max_length=500, nullable=False,
        description="Verbatim PDF text — shown to inspector. e.g. "
                    "'Tire has insufficient tread (Less than 2/32 or 1.6mm) ...'"
    )

    # Whether the photo gate is mandatory for this template item.
    #   True (default)  — visual/structural defects (cracks, leaks, dents, etc.)
    #   False           — sensory/audio defects (odor, brake noise, no AC, etc.)
    # Set per-template-item so the same rule can require photos in one flow
    # and not in another (rare; usually all items for a rule share this).
    photo_required: bool = Field(default=True, nullable=False)

    # Whether this item only applies to Amazon-branded vehicles. The wizard
    # filters out items with requires_branding=true when the vehicle's
    # ownership is OWNER or RENTED (no DOT decal USDOT2881058 nor Prime decal
    # on those vans). Default False so the flag is opt-in per item.
    requires_branding: bool = Field(default=False, nullable=False)

    # Display order within (vehicle_class, section, part_category)
    ordering: int = Field(default=0, nullable=False)

    is_active: bool = Field(default=True, nullable=False, index=True)

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )


class InspectionRule(SQLModel, table=True):
    """A single source rule from the Amazon DVIC PDF (or a DSP addition).

    Holds the verbatim PDF text + regulatory metadata (RSI, VSA, line) +
    optional Notion back-link. Bridges to (part, defect_type) tuples via
    InspectionRuleTarget — one source rule can cover several catalog tuples
    (e.g. "Headlight is dim, blinking, or not working" → 3 targets).

    Relationship to DvicTemplateItem:
      - DvicTemplateItem drives the wizard UX (per vehicle_class × section ×
        position). A single InspectionRule typically backs N DvicTemplateItem
        rows (one per vehicle_class it applies to + one per position split).
      - InspectionRule answers: "what was the source PDF text + regulatory
        flags for this finding?" — back-trackable for audits.
    """

    __tablename__ = "inspection_rule"

    id: int | None = Field(default=None, primary_key=True)

    # Verbatim PDF/DSP text — what the inspector reads on the form.
    defect_text: str = Field(max_length=2000, nullable=False)

    source: InspectionRuleSource = Field(
        sa_column=_enum_col("source", InspectionRuleSource, 10, nullable=False, index=True)
    )

    # PDF section the rule appears in. NULL when the rule is a DSP-local
    # addition that doesn't fit the Amazon section grid.
    section: DvicSection | None = Field(
        default=None,
        sa_column=_enum_col("section", DvicSection, 25, nullable=True, index=True),
    )

    # Free-form list of part hints from the source PDF. Validated server-side
    # against DefectPart on write — lets us import imperfect source text
    # without a CHECK trigger and report bad rows on validation.
    parts: list[str] = Field(
        default_factory=list,
        sa_column=Column(
            "parts", ARRAY(sa.String(40)),
            nullable=False, server_default="{}",
        ),
    )

    # Severity hint from the source rule. Authoritative severity per
    # vehicle_class still lives on DefectApplicability.classification — this
    # is the original PDF cell, kept for audit and to seed applicability.
    classification: DefectClassification | None = Field(
        default=None,
        sa_column=_enum_col("classification", DefectClassification, 20, nullable=True),
    )
    group: DefectGroup | None = Field(
        default=None,
        sa_column=_enum_col("group", DefectGroup, 20, nullable=True),
    )
    line: InspectionRuleLine | None = Field(
        default=None,
        sa_column=_enum_col("line", InspectionRuleLine, 20, nullable=True),
    )

    # Regulatory flags from V2.2 spec.
    rsi: bool = Field(default=False, nullable=False)
    vsa: bool = Field(default=False, nullable=False)

    # Back-link to source page (Notion, Confluence, internal wiki…).
    # UNIQUE so re-importing from the same source doesn't duplicate.
    notion_id: str | None = Field(
        default=None, max_length=100,
        sa_column=Column("notion_id", sa.String(100), unique=True, nullable=True, index=True),
    )

    # Vehicle classes this rule applies to. ARRAY(VARCHAR) so we don't need
    # a separate join table — cardinality is at most 5.
    vehicle_class: list[str] = Field(
        default_factory=list,
        sa_column=Column(
            "vehicle_class", ARRAY(sa.String(30)),
            nullable=False, server_default="{}",
            index=True,
        ),
    )

    is_active: bool = Field(default=True, nullable=False, index=True)

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )


class InspectionRuleTarget(SQLModel, table=True):
    """Bridge: InspectionRule → many (part, defect_type) catalog tuples.

    Lets one PDF line ("Headlight is dim, blinking, or not working") map to
    several DefectRule rows. Uses the (part, defect_type) natural key rather
    than rule_id FK — historical InspectionRule rows survive even if a
    DefectRule is deactivated and re-keyed.

    Composite PK (rule_id, part, defect_type). Cascades on rule delete.
    """

    __tablename__ = "inspection_rule_target"

    rule_id: int = Field(
        sa_column=Column(
            "rule_id",
            sa.Integer,
            ForeignKey("inspection_rule.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
    )
    part: DefectPart = Field(
        sa_column=_enum_col("part", DefectPart, 40, primary_key=True, index=True)
    )
    defect_type: DefectType = Field(
        sa_column=_enum_col("defect_type", DefectType, 40, primary_key=True, index=True)
    )

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
