"""DVIC template seed — adapts the V2.2 catalog to Amazon DVIC PDF layout.

Each row maps to one verbatim PDF check, mapped to a defect_rule. The
wizard reads these rows to render the section-first flow.

Photo-required policy:
  - Visual / structural / leak defects: photo required (default).
  - Sensory defects (odor, brake noise, no AC, horn, alarm, steering feel):
    photo NOT required — description alone is enough.

Branding policy:
  - Most items apply to every van regardless of ownership (Branded / Owner / Rented).
  - Items keyed off Amazon-only fixtures (DOT decal USDOT2881058, Prime decal)
    set requires_branding=True. The wizard hides them when the inspected
    vehicle has ownership=owner or ownership=rented.

Tuple shape (8-tuple, default requires_branding=False):
  (section, part_category, part, defect_type, position_or_None,
   description, ordering, photo_required)

Tuple shape (9-tuple, when requires_branding matters):
  (section, part_category, part, defect_type, position_or_None,
   description, ordering, photo_required, requires_branding)
"""
from __future__ import annotations

from app.models.defect_catalog import (
    DefectPart as P,
    DefectPosition as Pos,
    DefectType as T,
    DvicSection as S,
    VehicleClass as VC,
)


# Tuple shape for each PDF row — 8-tuple OR 9-tuple (requires_branding optional)
DvicRow = tuple[S, str, P, T, Pos | None, str, int, bool] | \
          tuple[S, str, P, T, Pos | None, str, int, bool, bool]


# ─────────────────────────────────────────────────────
# Cargo DVIC — applies to regular_cargo_van + custom_delivery_van
# ─────────────────────────────────────────────────────
CARGO_ROWS: list[DvicRow] = [
    # ═══════ § 1. General ═══════
    # Vehicle Cleanliness — sensory defects, no photo needed for odor
    (S.GENERAL, "Vehicle Cleanliness", P.INTERIOR_LOOSE_OBJECTS, T.HAS_LOOSE_OBJECTS, None,
     "Interior of vehicle has loose objects/spilled liquid that could compromise safely driving the vehicle", 10, True),
    (S.GENERAL, "Vehicle Cleanliness", P.INTERIOR_CLEANLINESS, T.DIRTY, None,
     "Interior has trash or excessive grime/dust present", 20, True),
    (S.GENERAL, "Vehicle Cleanliness", P.INTERIOR_CLEANLINESS, T.ODOR, None,
     "Interior has odor", 30, False),
    # License plate (moved from Back Side per user request — front/back picker)
    (S.GENERAL, "License plates/tags", P.LICENSE_PLATE, T.MISSING, None,
     "License plates/temp tags are damaged, missing, illegible, or expired", 40, True),
    (S.GENERAL, "License plates/tags", P.LICENSE_PLATE, T.DAMAGED, None,
     "License plate physically damaged or bent", 50, True),
    # State Inspection sticker (added per user request)
    (S.GENERAL, "State Inspection", P.INSPECTION_STICKER, T.MISSING, None,
     "State Inspection sticker is missing", 60, True),
    (S.GENERAL, "State Inspection", P.INSPECTION_STICKER, T.EXPIRED, None,
     "State Inspection sticker is expired", 70, True),
    (S.GENERAL, "State Inspection", P.INSPECTION_STICKER, T.DAMAGED, None,
     "State Inspection sticker is damaged or illegible", 80, True),

    # ═══════ § 2. Front Side ═══════
    (S.FRONT_SIDE, "Suspension & underbody shield", P.SUSPENSION, T.MISALIGNED, None,
     "Noticeable leaning of vehicle (when parked)", 10, True),
    (S.FRONT_SIDE, "Suspension & underbody shield", P.UNDERCARRIAGE_OBJECT, T.HANGING, Pos.FRONT,
     "Loose or hanging objects underneath", 20, True),
    # Headlights split into low/high beam variants per side (4 items total)
    (S.FRONT_SIDE, "Lights and light covers", P.HEADLIGHT, T.NOT_WORKING, Pos.DRIVER_SIDE,
     "Headlight LOW BEAM is not working — driver side", 30, True),
    (S.FRONT_SIDE, "Lights and light covers", P.HEADLIGHT, T.NOT_WORKING, Pos.PASSENGER_SIDE,
     "Headlight LOW BEAM is not working — passenger side", 40, True),
    # The HIGH BEAM row was originally written with T.COVER_CRACKED — clearly a
    # copy-paste from the row below. The defect_type is NOT_WORKING per the
    # description; without this fix the row collides with the COVER_CRACKED
    # row a few lines down on (vehicle_class, section, part_category, rule_id,
    # position).
    (S.FRONT_SIDE, "Lights and light covers", P.HEADLIGHT, T.NOT_WORKING, None,
     "Headlight HIGH BEAM is not working", 50, True),
    (S.FRONT_SIDE, "Lights and light covers", P.HAZARD_LIGHT, T.NOT_WORKING, None,
     "Hazard light is not working", 60, True),
    (S.FRONT_SIDE, "Lights and light covers", P.HEADLIGHT, T.COVER_CRACKED, None,
     "Any lights or light covers are cracked (leaving hole or void), missing, or not working properly", 70, True),
    # Body & doors at front (per user — add to Front side too)
    (S.FRONT_SIDE, "Body and doors", P.BUMPER, T.DAMAGED, Pos.FRONT,
     "Front bumper or attached items damaged, loose, or hanging", 80, True),
    (S.FRONT_SIDE, "Body and doors", P.HOOD, T.DAMAGED, None,
     "Hood damaged or won't latch", 90, True),

    # ═══════ § 3. Back Side ═══════
    (S.BACK_SIDE, "Suspension & underbody shield", P.UNDERCARRIAGE_OBJECT, T.HANGING, Pos.REAR,
     "Loose or hanging objects underneath", 10, True),
    (S.BACK_SIDE, "Lights and light covers", P.LICENSE_PLATE_LIGHT, T.NOT_WORKING, None,
     "License plate light is not working", 20, True),
    (S.BACK_SIDE, "Lights and light covers", P.TAIL_LIGHT, T.NOT_WORKING, Pos.DRIVER_SIDE,
     "Tail light is not working — driver side", 30, True),
    (S.BACK_SIDE, "Lights and light covers", P.TAIL_LIGHT, T.NOT_WORKING, Pos.PASSENGER_SIDE,
     "Tail light is not working — passenger side", 40, True),
    (S.BACK_SIDE, "Lights and light covers", P.HAZARD_LIGHT, T.NOT_WORKING, None,
     "Hazard light is not working", 50, True),
    # Tail light cover cracked NOW with driver/passenger position picker
    (S.BACK_SIDE, "Lights and light covers", P.TAIL_LIGHT, T.CRACKED, Pos.DRIVER_SIDE,
     "Tail light cover cracked, missing, or hole — driver side", 60, True),
    (S.BACK_SIDE, "Lights and light covers", P.TAIL_LIGHT, T.CRACKED, Pos.PASSENGER_SIDE,
     "Tail light cover cracked, missing, or hole — passenger side", 70, True),
    (S.BACK_SIDE, "Body and doors", P.BUMPER, T.DAMAGED, Pos.REAR,
     "Items attached to the body of the vehicle (for example: bumper, backup camera, or rear step) are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar", 80, True),
    (S.BACK_SIDE, "Body and doors", P.REAR_CARGO_DOOR, T.WONT_CLOSE, None,
     "Rear cargo door won't close, latch, or lock", 90, True),

    # ═══════ § 4. Driver Side ═══════
    # Front tire / wheel
    (S.DRIVER_SIDE, "Front tire, wheel and rim", P.WHEEL_NUT, T.DAMAGED, Pos.DRIVER_FRONT,
     "Wheel, wheel nuts, rim, or mounting equipment is damaged, cracked, loose, missing, or broken", 10, True),
    (S.DRIVER_SIDE, "Front tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.DRIVER_FRONT,
     "Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner most, middle, or outer most tread", 20, True),
    (S.DRIVER_SIDE, "Front tire, wheel and rim", P.TIRE, T.SIDEWALL_DAMAGE, Pos.DRIVER_FRONT,
     "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface", 30, True),
    (S.DRIVER_SIDE, "Suspension & underbody shield", P.BRAKE_FLUID, T.LEAKING, None,
     "Active non-clear fluid leaking on the ground", 40, True),
    (S.DRIVER_SIDE, "Suspension & underbody shield", P.UNDERCARRIAGE_OBJECT, T.HANGING, Pos.DRIVER_SIDE,
     "Loose or hanging objects underneath", 50, True),
    # Side mirrors with NEW turn light items
    (S.DRIVER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.NOT_ADJUSTABLE, Pos.DRIVER_SIDE,
     "Side mirror cannot be adjusted", 60, True),
    (S.DRIVER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.CRACKED, Pos.DRIVER_SIDE,
     "Side mirror glass or window glass is cracked, damaged, or missing", 70, True),
    (S.DRIVER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.LOOSE, Pos.DRIVER_SIDE,
     "Side mirror is loose, hanging, unsecured, or held up with a zip-tie, tape, or similar", 80, True),
    (S.DRIVER_SIDE, "Side mirrors", P.MIRROR_LIGHT, T.NOT_WORKING, Pos.DRIVER_SIDE,
     "Mirror turn signal light is not working", 90, True),
    (S.DRIVER_SIDE, "Side mirrors", P.MIRROR_LIGHT, T.COVER_CRACKED, Pos.DRIVER_SIDE,
     "Mirror turn signal light cover broken or missing", 100, True),
    # NEW: Body & doors on driver side (per user)
    (S.DRIVER_SIDE, "Body and doors", P.SIDE_PANEL, T.DAMAGED, Pos.DRIVER_SIDE,
     "Items attached to the body (side view camera, cargo steps) are missing, damaged, loose, hanging", 110, True),
    (S.DRIVER_SIDE, "Body and doors", P.EXTERIOR_DOOR, T.DAMAGED, Pos.DRIVER_SIDE,
     "Door dent, scratch, or paint damage", 120, True),
    (S.DRIVER_SIDE, "Body and doors", P.EXTERIOR_DOOR, T.MISALIGNED, Pos.DRIVER_SIDE,
     "Door misaligned or won't close properly", 130, True),
    (S.DRIVER_SIDE, "Body and doors", P.SIDE_PANEL, T.MISSING, Pos.DRIVER_SIDE,
     "Door panel missing", 140, True),
    # Back tire / wheel
    (S.DRIVER_SIDE, "Back tire, wheel and rim", P.WHEEL_NUT, T.DAMAGED, Pos.DRIVER_REAR,
     "Wheel, wheel nuts, rim, or mounting equipment is damaged, cracked, loose, missing, or broken", 150, True),
    (S.DRIVER_SIDE, "Back tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.DRIVER_REAR,
     "Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner most, middle, or outer most tread", 160, True),
    (S.DRIVER_SIDE, "Back tire, wheel and rim", P.TIRE, T.SIDEWALL_DAMAGE, Pos.DRIVER_REAR,
     "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface", 170, True),

    # ═══════ § 5. Passenger Side ═══════
    (S.PASSENGER_SIDE, "Front tire, wheel and rim", P.WHEEL_NUT, T.DAMAGED, Pos.PASSENGER_FRONT,
     "Wheel, wheel nuts, rim, or mounting equipment is damaged, cracked, loose, missing, or broken", 10, True),
    (S.PASSENGER_SIDE, "Front tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.PASSENGER_FRONT,
     "Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner most, middle, or outer most tread", 20, True),
    (S.PASSENGER_SIDE, "Front tire, wheel and rim", P.TIRE, T.SIDEWALL_DAMAGE, Pos.PASSENGER_FRONT,
     "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface", 30, True),
    (S.PASSENGER_SIDE, "Suspension & underbody shield", P.UNDERCARRIAGE_OBJECT, T.HANGING, Pos.PASSENGER_SIDE,
     "Loose or hanging objects underneath", 40, True),
    (S.PASSENGER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.NOT_ADJUSTABLE, Pos.PASSENGER_SIDE,
     "Side mirror cannot be adjusted", 50, True),
    (S.PASSENGER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.CRACKED, Pos.PASSENGER_SIDE,
     "Side mirror glass or window glass is cracked, damaged, or missing", 60, True),
    (S.PASSENGER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.LOOSE, Pos.PASSENGER_SIDE,
     "Side mirror is loose, hanging, unsecured", 70, True),
    (S.PASSENGER_SIDE, "Side mirrors", P.MIRROR_LIGHT, T.NOT_WORKING, Pos.PASSENGER_SIDE,
     "Mirror turn signal light is not working", 80, True),
    (S.PASSENGER_SIDE, "Side mirrors", P.MIRROR_LIGHT, T.COVER_CRACKED, Pos.PASSENGER_SIDE,
     "Mirror turn signal light cover broken or missing", 90, True),
    # NEW: Body & doors on passenger side (per user)
    (S.PASSENGER_SIDE, "Body and doors", P.SIDE_PANEL, T.DAMAGED, Pos.PASSENGER_SIDE,
     "Items attached to the body (side view camera, cargo steps) are missing, damaged, loose, hanging", 100, True),
    (S.PASSENGER_SIDE, "Body and doors", P.EXTERIOR_DOOR, T.DAMAGED, Pos.PASSENGER_SIDE,
     "Door dent, scratch, or paint damage", 110, True),
    (S.PASSENGER_SIDE, "Body and doors", P.EXTERIOR_DOOR, T.MISALIGNED, Pos.PASSENGER_SIDE,
     "Door misaligned or won't close properly", 120, True),
    (S.PASSENGER_SIDE, "Body and doors", P.SIDE_PANEL, T.MISSING, Pos.PASSENGER_SIDE,
     "Door panel missing", 130, True),
    # NEW: Back tire / wheel on passenger side (per user — was missing)
    (S.PASSENGER_SIDE, "Back tire, wheel and rim", P.WHEEL_NUT, T.DAMAGED, Pos.PASSENGER_REAR,
     "Wheel, wheel nuts, rim, or mounting equipment is damaged, cracked, loose, missing, or broken", 140, True),
    (S.PASSENGER_SIDE, "Back tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.PASSENGER_REAR,
     "Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner most, middle, or outer most tread", 150, True),
    (S.PASSENGER_SIDE, "Back tire, wheel and rim", P.TIRE, T.SIDEWALL_DAMAGE, Pos.PASSENGER_REAR,
     "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface", 160, True),

    # ═══════ § 6. In Cab ═══════
    # Wipers — no driver/passenger picker (rule applies generically)
    (S.IN_CAB, "Wipers", P.WIPER_BLADE, T.NOT_WORKING, None,
     "Wiper blades are missing, damaged, or not working", 10, True),
    (S.IN_CAB, "Wipers", P.WASHER_SYSTEM, T.NOT_WORKING, None,
     "Windshield washer system is not working and/or wiper fluid reservoir is empty", 20, True),
    # Driver Seat
    (S.IN_CAB, "Driver Seat", P.DRIVER_SEAT, T.DAMAGED, None,
     "Seat integrity is compromised (for example: cannot be adjusted, has exposed metal, wire, spring, or missing, torn, loose cushioning)", 30, True),
    # Brakes — sensory, no photo required
    (S.IN_CAB, "Brakes", P.SERVICE_BRAKE, T.NOISE, None,
     "Foot brake is squeaking, loose, weak, or stiff", 40, False),
    (S.IN_CAB, "Brakes", P.SERVICE_BRAKE, T.NOT_WORKING, None,
     "Foot brake is grinding, vibrates, leaking air, or not working", 50, False),
    (S.IN_CAB, "Brakes", P.PARKING_BRAKE, T.NOT_WORKING, None,
     "Parking brake is loose, weak, stiff, or not working", 60, False),
    # HVAC — sensory, no photo required
    (S.IN_CAB, "HVAC systems", P.HEATER, T.NO_HEAT, None,
     "Defroster/heater is not working", 70, False),
    (S.IN_CAB, "HVAC systems", P.AC, T.NO_COLD_AIR, None,
     "AC is not blowing cold air", 80, False),
    # Steering, seatbelt, horn, alarm — horn/alarm/steering NO photo
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.HORN, T.NOT_WORKING, None,
     "Horn is not working", 90, False),
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.BACKUP_ALARM, T.NOT_WORKING, None,
     "Backup alarm is not working", 100, False),
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.SEATBELT_ALARM, T.NOT_WORKING, None,
     "Seatbelt alarm is not working", 110, False),
    # Seatbelt split: BUCKLE first, then BELT — each with driver/passenger picker
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.SEATBELT_BUCKLE, T.BROKEN, Pos.DRIVER,
     "Seatbelt BUCKLE is missing, broken, or not latching — driver side", 120, True),
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.SEATBELT_BUCKLE, T.BROKEN, Pos.PASSENGER,
     "Seatbelt BUCKLE is missing, broken, or not latching — passenger side", 130, True),
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.SEATBELT, T.FRAYED, Pos.DRIVER,
     "Seatbelt anchor, casing, or BELT is missing, torn, or frayed — driver side", 140, True),
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.SEATBELT, T.FRAYED, Pos.PASSENGER,
     "Seatbelt anchor, casing, or BELT is missing, torn, or frayed — passenger side", 150, True),
    # Steering — sensory
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.STEERING_WHEEL, T.VIBRATION, None,
     "Steering wheel has excessive vibration, stiff, loose, or needs alignment", 160, False),
    # Lights / dashboard
    (S.IN_CAB, "Lights and light covers", P.TURN_SIGNAL, T.NOT_WORKING, None,
     "Turn signal is not working", 170, True),
    (S.IN_CAB, "Lights and light covers", P.WARNING_LAMP, T.ON_OR_FLASHING, None,
     "Any red warning lights/lamps are on or flashing", 180, True),
    (S.IN_CAB, "Lights and light covers", P.DASHBOARD_ILLUMINATION, T.NOT_WORKING, None,
     "Dashboard light is not working", 190, True),
    # Body and doors (in cab)
    (S.IN_CAB, "Body and doors", P.BULKHEAD_DOOR, T.WONT_OPEN, None,
     "Interior sliding door (bulkhead doors) cannot open or close", 200, True),
    (S.IN_CAB, "Body and doors", P.EXTERIOR_DOOR, T.WONT_OPEN, None,
     "One or more exterior doors cannot open, close, lock, or unlock from inside", 210, True),
    # Safety / camera / windshield
    (S.IN_CAB, "Safety accessories", P.DELIVERY_DEVICE_CRADLE, T.DAMAGED, None,
     "Delivery device cradle is damaged, missing, or zip-tied", 220, True),
    # Netradyne split into 2 items per user request
    (S.IN_CAB, "Camera/monitor", P.NETRADYNE_CAMERA, T.HANGING, None,
     "Netradyne camera is hanging or disconnected from bracket", 230, True),
    (S.IN_CAB, "Camera/monitor", P.NETRADYNE_CAMERA, T.NOT_WORKING, None,
     "Netradyne camera is not working", 240, True),
    (S.IN_CAB, "Camera/monitor", P.CAMERA_MONITOR, T.NOT_WORKING, None,
     "Rear or side camera monitor is missing, broken, unsecure, obstructed, or not working", 250, True),
    (S.IN_CAB, "Windshield", P.WINDSHIELD, T.CRACKED, None,
     "Any crack, chip, stars on the windshield >1/2 inch (excluding 1 inch border)", 260, True),
    (S.IN_CAB, "Windshield", P.WINDSHIELD, T.NON_APPROVED, None,
     "Device/Accessory is mounted on the windshield", 270, True),
]


# ─────────────────────────────────────────────────────
# DOT DVIC — applies to step_van_dot only
# (mostly Cargo + DOT-specific items)
# ─────────────────────────────────────────────────────
DOT_ROWS: list[DvicRow] = [
    # ═══════ § 1. General — DOT extras ═══════
    (S.GENERAL, "Vehicle Documentation", P.PAPER_DOCUMENT, T.MISSING, None,
     "Insurance information, registration, short haul exemption, or certification of lease is missing, damaged, illegible, or expired", 10, True),
    (S.GENERAL, "Vehicle Documentation", P.PERIODIC_INSPECTION_STICKER, T.EXPIRED, None,
     "DOT/CA BIT/State Inspection sticker is missing, damaged, illegible, or expired", 20, True),
    (S.GENERAL, "Vehicle Cleanliness", P.INTERIOR_LOOSE_OBJECTS, T.HAS_LOOSE_OBJECTS, None,
     "Interior of vehicle has loose objects/spilled liquid that could compromise safely driving the vehicle", 30, True),
    (S.GENERAL, "Vehicle Cleanliness", P.INTERIOR_CLEANLINESS, T.DIRTY, None,
     "Interior has trash or excessive grime/dust present", 40, True),
    (S.GENERAL, "Vehicle Cleanliness", P.INTERIOR_CLEANLINESS, T.ODOR, None,
     "Interior has odor", 50, False),
    (S.GENERAL, "License plates/tags", P.LICENSE_PLATE, T.MISSING, None,
     "License plates/temp tags are damaged, missing, illegible, or expired", 60, True),
    (S.GENERAL, "Safety accessories", P.SPARE_FUSES, T.MISSING, None,
     "Spare fuses or reflective triangles are missing", 70, True),
    (S.GENERAL, "Safety accessories", P.FIRE_EXTINGUISHER, T.MISSING, None,
     "Fire extinguisher is missing, not mounted, mounted with a tape, zip-tie or similar, or the dial/needle is not in the green zone", 80, True),

    # ═══════ § 2. Front Side ═══════
    (S.FRONT_SIDE, "Suspension & underbody shield", P.SUSPENSION, T.MISALIGNED, None,
     "Noticeable leaning of vehicle (when parked)", 10, True),
    (S.FRONT_SIDE, "Suspension & underbody shield", P.UNDERCARRIAGE_OBJECT, T.HANGING, Pos.FRONT,
     "Loose or hanging objects underneath", 20, True),
    (S.FRONT_SIDE, "Lights and light covers", P.HEADLIGHT, T.NOT_WORKING, Pos.DRIVER_SIDE,
     "Headlight LOW BEAM is not working — driver side", 30, True),
    (S.FRONT_SIDE, "Lights and light covers", P.HEADLIGHT, T.NOT_WORKING, Pos.PASSENGER_SIDE,
     "Headlight LOW BEAM is not working — passenger side", 40, True),
    (S.FRONT_SIDE, "Lights and light covers", P.HAZARD_LIGHT, T.NOT_WORKING, None,
     "Hazard light is not working", 50, True),
    (S.FRONT_SIDE, "Lights and light covers", P.HEADLIGHT, T.COVER_CRACKED, None,
     "Any lights or light covers are cracked (leaving hole or void), missing, or not working properly", 60, True),
    (S.FRONT_SIDE, "Body and doors", P.BUMPER, T.DAMAGED, Pos.FRONT,
     "Items attached to the body (bumpers, hood latches) are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar", 70, True),

    # ═══════ § 4. Driver Side — DOT adds fuel cap, decals, mud flap ═══════
    (S.DRIVER_SIDE, "Front tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.DRIVER_FRONT,
     "Tire has insufficient tread (Less than 4/32 or 3.2mm) on inner most, middle, or outer most tread", 10, True),
    (S.DRIVER_SIDE, "Front tire, wheel and rim", P.TIRE, T.SIDEWALL_DAMAGE, Pos.DRIVER_FRONT,
     "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface", 20, True),
    (S.DRIVER_SIDE, "Suspension & underbody shield", P.BRAKE_FLUID, T.LEAKING, None,
     "Active non-clear fluid leaking on the ground", 30, True),
    (S.DRIVER_SIDE, "Charging port and fluids", P.FUEL_CAP, T.MISSING, Pos.DRIVER_SIDE,
     "Fuel cap is missing or broken", 40, True),
    (S.DRIVER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.CRACKED, Pos.DRIVER_SIDE,
     "Side mirror glass or window glass is cracked, damaged, or missing", 50, True),
    (S.DRIVER_SIDE, "Side mirrors", P.MIRROR_LIGHT, T.NOT_WORKING, Pos.DRIVER_SIDE,
     "Mirror turn signal light is not working", 60, True),
    (S.DRIVER_SIDE, "Body and doors", P.DOT_DECAL, T.DAMAGED, Pos.DRIVER_SIDE,
     "Amazon DOT decal (USDOT2881058) is damaged, missing, excessively dirty, or not visible", 70, True, True),
    (S.DRIVER_SIDE, "Body and doors", P.PRIME_DECAL, T.DAMAGED, Pos.DRIVER_SIDE,
     "Prime decal is damaged, missing, excessively dirty, or not visible", 80, True, True),
    (S.DRIVER_SIDE, "Body and doors", P.EXTERIOR_DOOR, T.DAMAGED, Pos.DRIVER_SIDE,
     "Door dent, scratch, or paint damage", 90, True),
    (S.DRIVER_SIDE, "Back tire, wheel and rim", P.MUD_FLAP, T.MISSING, Pos.DRIVER_SIDE,
     "Mud Flap is damaged, missing, unsecured or held up with a zip-tie, tape or similar", 100, True),
    (S.DRIVER_SIDE, "Back tire, wheel and rim", P.WHEEL_NUT, T.DAMAGED, Pos.DRIVER_REAR,
     "Wheel, wheel nuts, rim, or mounting equipment damaged, cracked, loose, missing, or broken", 110, True),
    (S.DRIVER_SIDE, "Back tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.DRIVER_REAR,
     "Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner most, middle, or outer most tread", 120, True),

    # ═══════ § 5. Passenger Side ═══════
    (S.PASSENGER_SIDE, "Front tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.PASSENGER_FRONT,
     "Tire has insufficient tread (Less than 4/32 or 3.2mm) on inner most, middle, or outer most tread", 10, True),
    (S.PASSENGER_SIDE, "Front tire, wheel and rim", P.TIRE, T.SIDEWALL_DAMAGE, Pos.PASSENGER_FRONT,
     "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface", 20, True),
    (S.PASSENGER_SIDE, "Side mirrors", P.MIRROR_LIGHT, T.NOT_WORKING, Pos.PASSENGER_SIDE,
     "Mirror turn signal light is not working", 30, True),
    (S.PASSENGER_SIDE, "Body and doors", P.DOT_DECAL, T.DAMAGED, Pos.PASSENGER_SIDE,
     "Amazon DOT decal damaged, missing, excessively dirty, or not visible", 40, True, True),
    (S.PASSENGER_SIDE, "Body and doors", P.PRIME_DECAL, T.DAMAGED, Pos.PASSENGER_SIDE,
     "Prime decal damaged, missing, excessively dirty, or not visible", 50, True, True),
    (S.PASSENGER_SIDE, "Body and doors", P.EXTERIOR_DOOR, T.DAMAGED, Pos.PASSENGER_SIDE,
     "Door dent, scratch, or paint damage", 60, True),
    (S.PASSENGER_SIDE, "Back tire, wheel and rim", P.MUD_FLAP, T.MISSING, Pos.PASSENGER_SIDE,
     "Mud Flap is damaged, missing, unsecured or held up with a zip-tie, tape or similar", 70, True),
    (S.PASSENGER_SIDE, "Back tire, wheel and rim", P.WHEEL_NUT, T.DAMAGED, Pos.PASSENGER_REAR,
     "Wheel, wheel nuts, rim, or mounting equipment damaged, cracked, loose, missing, or broken", 80, True),
    (S.PASSENGER_SIDE, "Back tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.PASSENGER_REAR,
     "Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner most, middle, or outer most tread", 90, True),

    # ═══════ § 6. In Cab — DOT adds Air pressure gauge ═══════
    (S.IN_CAB, "Wipers", P.WIPER_BLADE, T.NOT_WORKING, None,
     "Wiper blades are missing, damaged, or not working", 10, True),
    (S.IN_CAB, "Brakes", P.AIR_PRESSURE_GAUGE, T.OVER_PRESSURE, None,
     "Air pressure gauge reads more than 120 PSI", 20, False),
    (S.IN_CAB, "Brakes", P.SERVICE_BRAKE, T.NOT_WORKING, None,
     "Foot brake is grinding, vibrates, leaking air, or not working", 30, False),
    (S.IN_CAB, "Brakes", P.PARKING_BRAKE, T.NOT_WORKING, None,
     "Parking brake is loose, weak, stiff, or not working", 40, False),
    (S.IN_CAB, "HVAC systems", P.HEATER, T.NO_HEAT, None,
     "Defroster/heater is not working", 50, False),
    (S.IN_CAB, "HVAC systems", P.AC, T.NO_COLD_AIR, None,
     "AC is not blowing cold air", 60, False),
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.HORN, T.NOT_WORKING, None,
     "Horn, backup alarm, or seatbelt alarm is not working", 70, False),
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.SEATBELT_BUCKLE, T.BROKEN, Pos.DRIVER,
     "Seatbelt BUCKLE is missing, broken, or not latching — driver side", 80, True),
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.SEATBELT, T.FRAYED, Pos.DRIVER,
     "Seatbelt anchor, casing, or BELT is missing, torn, or frayed — driver side", 90, True),
    (S.IN_CAB, "Steering, seatbelt, horn, and alarm", P.STEERING_WHEEL, T.VIBRATION, None,
     "Steering wheel has excessive vibration, stiff, loose, or needs alignment", 100, False),
    (S.IN_CAB, "Lights and light covers", P.WARNING_LAMP, T.ON_OR_FLASHING, None,
     "Any red warning lights/lamps are on or flashing", 110, True),
    (S.IN_CAB, "Camera/monitor", P.NETRADYNE_CAMERA, T.HANGING, None,
     "Netradyne camera is hanging or disconnected from bracket", 120, True),
    (S.IN_CAB, "Camera/monitor", P.NETRADYNE_CAMERA, T.NOT_WORKING, None,
     "Netradyne camera is not working", 130, True),
    (S.IN_CAB, "Windshield", P.WINDSHIELD, T.CRACKED, None,
     "Any crack, chip, stars on the windshield >1/2 inch (excluding 1 inch border)", 140, True),
]


# ─────────────────────────────────────────────────────
# Box Truck (AMXL) DVIC — transcribed from NOVABODY/core
# (insert_box_truck_dvic_template.py) and adapted to NF V2.2.
# ─────────────────────────────────────────────────────
BOX_TRUCK_ROWS: list[DvicRow] = [
    # ═══════ § 1. General ═══════
    # Vehicle Documentation
    (S.GENERAL, "Vehicle Documentation", P.PAPER_DOCUMENT, T.MISSING, None,
     "Insurance information, registration, short haul exemption, or "
     "certification of lease is missing, damaged, illegible, or expired", 10, True),
    (S.GENERAL, "Vehicle Documentation", P.INSPECTION_STICKER, T.MISSING, None,
     "DOT/CA BIT/State Inspection sticker is missing, damaged, illegible, or expired", 20, True),
    # Vehicle Cleanliness — sensory: odor has no photo
    (S.GENERAL, "Vehicle Cleanliness", P.INTERIOR_LOOSE_OBJECTS, T.HAS_LOOSE_OBJECTS, None,
     "Interior of vehicle has loose objects/spilled liquid that could compromise safely driving the vehicle", 30, True),
    (S.GENERAL, "Vehicle Cleanliness", P.INTERIOR_CLEANLINESS, T.DIRTY, None,
     "Interior has trash or excessive grime/dust present", 40, True),
    (S.GENERAL, "Vehicle Cleanliness", P.INTERIOR_CLEANLINESS, T.ODOR, None,
     "Interior has odor", 50, False),
    # Safety accessories
    (S.GENERAL, "Safety accessories", P.SPARE_FUSES, T.MISSING, None,
     "Spare fuses are missing", 60, True),
    (S.GENERAL, "Safety accessories", P.REFLECTIVE_TRIANGLES, T.MISSING, None,
     "Reflective triangles are missing", 70, True),
    (S.GENERAL, "Safety accessories", P.FIRE_EXTINGUISHER, T.MISSING, None,
     "Fire extinguisher is missing, not mounted, mounted with tape/zip-tie, or dial/needle is not in the green zone", 80, True),
    # License plate (kept in General for consistency with Cargo wizard)
    (S.GENERAL, "License plates/tags", P.LICENSE_PLATE, T.MISSING, None,
     "License plates/temp tags are damaged, missing, illegible, or expired", 90, True),

    # ═══════ § 2. Front Side ═══════
    (S.FRONT_SIDE, "Suspension & underbody shield", P.SUSPENSION, T.MISALIGNED, None,
     "Noticeable leaning of vehicle (when parked)", 10, True),
    (S.FRONT_SIDE, "Suspension & underbody shield", P.UNDERCARRIAGE_OBJECT, T.HANGING, Pos.FRONT,
     "Loose or hanging objects underneath", 20, True),
    (S.FRONT_SIDE, "Lights and light covers", P.HEADLIGHT, T.NOT_WORKING, None,
     "Headlight is not working", 30, True),
    (S.FRONT_SIDE, "Lights and light covers", P.HAZARD_LIGHT, T.NOT_WORKING, None,
     "Hazard light is not working", 40, True),
    (S.FRONT_SIDE, "Lights and light covers", P.HEADLIGHT, T.COVER_CRACKED, None,
     "Any lights are cracked (leaving hole or void), missing, or not working properly", 50, True),
    (S.FRONT_SIDE, "Body and doors", P.BUMPER, T.DAMAGED, Pos.FRONT,
     "Items attached to the body of the vehicle (for example: bumpers and hood latches) "
     "are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar", 60, True),

    # ═══════ § 3. Back Side ═══════
    (S.BACK_SIDE, "Suspension & underbody shield", P.UNDERCARRIAGE_OBJECT, T.HANGING, Pos.REAR,
     "Loose or hanging objects underneath", 10, True),
    (S.BACK_SIDE, "Lights and light covers", P.LICENSE_PLATE_LIGHT, T.NOT_WORKING, None,
     "License plate light is not working", 20, True),
    (S.BACK_SIDE, "Lights and light covers", P.TAIL_LIGHT, T.NOT_WORKING, None,
     "Tail light is not working", 30, True),
    (S.BACK_SIDE, "Lights and light covers", P.HAZARD_LIGHT, T.NOT_WORKING, None,
     "Hazard light is not working (back)", 40, True),
    (S.BACK_SIDE, "Lights and light covers", P.TAIL_LIGHT, T.COVER_CRACKED, None,
     "Any lights are cracked (leaving hole or void), missing, or not working properly", 50, True),
    (S.BACK_SIDE, "Body and doors", P.BUMPER, T.DAMAGED, Pos.REAR,
     "Items attached to the body of the vehicle (for example: bumper, back-up camera, lift gate, or rear step) "
     "are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar", 60, True),

    # ═══════ § 4. Driver Side ═══════
    # Front tire/wheel/rim
    (S.DRIVER_SIDE, "Front tire, wheel and rim", P.WHEEL_NUT, T.DAMAGED, Pos.DRIVER_FRONT,
     "Wheel, wheel nut, rim, or mounting equipment is damaged, cracked, loose, missing, or broken", 10, True),
    (S.DRIVER_SIDE, "Front tire, wheel and rim", P.TIRE, T.SIDEWALL_DAMAGE, Pos.DRIVER_FRONT,
     "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface", 20, True),
    (S.DRIVER_SIDE, "Front tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.DRIVER_FRONT,
     "Tire has insufficient tread (Less than 4/32 or 3.2mm) on inner most, middle, or outer most tread [DOT Only]", 30, True),
    # Suspension & underbody
    (S.DRIVER_SIDE, "Suspension & underbody shield", P.ENGINE_OIL, T.LEAKING, None,
     "Active non-clear fluid leaking on the ground", 40, True),
    (S.DRIVER_SIDE, "Suspension & underbody shield", P.UNDERCARRIAGE_OBJECT, T.HANGING, Pos.DRIVER_SIDE,
     "Loose or hanging objects underneath", 50, True),
    # Charging port and fluids (Box Truck has fuel cap)
    (S.DRIVER_SIDE, "Charging port and fluids", P.FUEL_CAP, T.MISSING, None,
     "Fuel cap is missing or broken", 60, True),
    # Lights catch-all
    (S.DRIVER_SIDE, "Lights and light covers", P.MIRROR_LIGHT, T.COVER_CRACKED, Pos.DRIVER_SIDE,
     "Any lights are cracked (leaving hole or void), missing, or not working properly", 70, True),
    # Side mirrors
    (S.DRIVER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.NOT_ADJUSTABLE, Pos.DRIVER_SIDE,
     "Side mirrors cannot be adjusted", 80, True),
    (S.DRIVER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.LOOSE, Pos.DRIVER_SIDE,
     "Side mirrors are loose, hanging, unsecured, or held up with a zip-tie, tape, or similar", 90, True),
    (S.DRIVER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.CRACKED, Pos.DRIVER_SIDE,
     "Side mirror or window glass is cracked, damaged, or missing", 100, True),
    # Body and doors
    (S.DRIVER_SIDE, "Body and doors", P.SIDE_PANEL, T.DAMAGED, Pos.DRIVER_SIDE,
     "Items attached to the body of the vehicle (for example: side view camera, or cargo steps) "
     "are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar", 110, True),
    (S.DRIVER_SIDE, "Body and doors", P.DOT_DECAL, T.DAMAGED, None,
     "Amazon DOT decal (USDOT2881058) is damaged, missing, excessively dirty, or not visible, or any existing "
     "DOT decals on rental vehicles are not covered and visible", 120, True, True),
    (S.DRIVER_SIDE, "Body and doors", P.BATTERY_COVER, T.MISSING, None,
     "Battery cover not present, not securely latched/fastened, or bolts missing (Box Trucks only)", 130, True),
    (S.DRIVER_SIDE, "Body and doors", P.PRIME_DECAL, T.DAMAGED, None,
     "Prime decal is damaged, missing, excessively dirty, or not visible", 140, True, True),
    # Back tire/wheel/rim
    (S.DRIVER_SIDE, "Back tire, wheel and rim", P.WHEEL_NUT, T.DAMAGED, Pos.DRIVER_REAR,
     "Wheel, wheel nuts, rim, or mounting equipment is damaged, cracked, loose, missing, or broken", 150, True),
    (S.DRIVER_SIDE, "Back tire, wheel and rim", P.MUD_FLAP, T.DAMAGED, Pos.DRIVER_REAR,
     "Mud flap is damaged, missing, unsecured or held up with a zip-tie, tape or similar [DOT Only]", 160, True),
    (S.DRIVER_SIDE, "Back tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.DRIVER_REAR,
     "Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner most, middle, or outer most tread", 170, True),
    (S.DRIVER_SIDE, "Back tire, wheel and rim", P.TIRE, T.SIDEWALL_DAMAGE, Pos.DRIVER_REAR,
     "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface", 180, True),

    # ═══════ § 5. Passenger Side ═══════
    (S.PASSENGER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.CRACKED, Pos.PASSENGER_SIDE,
     "Side mirror glass or window glass is cracked, damaged, or missing", 10, True),
    (S.PASSENGER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.LOOSE, Pos.PASSENGER_SIDE,
     "Side mirrors are loose, hanging, unsecured, or held up with a zip-tie, tape, or similar", 20, True),
    (S.PASSENGER_SIDE, "Side mirrors", P.SIDE_MIRROR, T.NOT_ADJUSTABLE, Pos.PASSENGER_SIDE,
     "Side mirrors cannot be adjusted", 30, True),
    # Front tire
    (S.PASSENGER_SIDE, "Front tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.PASSENGER_FRONT,
     "Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner most, middle, or outer most tread", 40, True),
    (S.PASSENGER_SIDE, "Front tire, wheel and rim", P.TIRE, T.SIDEWALL_DAMAGE, Pos.PASSENGER_FRONT,
     "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface", 50, True),
    (S.PASSENGER_SIDE, "Front tire, wheel and rim", P.WHEEL_NUT, T.DAMAGED, Pos.PASSENGER_FRONT,
     "Wheel, wheel nut, rim, or mounting equipment is damaged, cracked, loose, missing, or broken", 60, True),
    # Lights catch-all
    (S.PASSENGER_SIDE, "Lights and light covers", P.MIRROR_LIGHT, T.COVER_CRACKED, Pos.PASSENGER_SIDE,
     "Any lights are cracked (leaving hole or void), missing, or not working properly", 70, True),
    # Body and doors
    (S.PASSENGER_SIDE, "Body and doors", P.SIDE_PANEL, T.DAMAGED, Pos.PASSENGER_SIDE,
     "Items attached to the body of the vehicle (for example: side view camera, or cargo steps) "
     "are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar", 80, True),
    (S.PASSENGER_SIDE, "Body and doors", P.DOT_DECAL, T.DAMAGED, None,
     "DOT Requirement – Amazon DOT decal (USDOT2881058) is damaged, missing, excessively dirty, or not visible "
     "[DOT Only]", 90, True, True),
    (S.PASSENGER_SIDE, "Body and doors", P.PRIME_DECAL, T.DAMAGED, None,
     "Prime decal is damaged, missing, excessively dirty, or not visible", 100, True, True),
    # Suspension & exhaust
    (S.PASSENGER_SIDE, "Suspension & exhaust system", P.UNDERCARRIAGE_OBJECT, T.HANGING, Pos.PASSENGER_SIDE,
     "Loose or hanging objects underneath", 110, True),
    # Back tire
    (S.PASSENGER_SIDE, "Back tire, wheel and rim", P.TIRE, T.LOW_TREAD, Pos.PASSENGER_REAR,
     "Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner most, middle, or outer most tread", 120, True),
    (S.PASSENGER_SIDE, "Back tire, wheel and rim", P.TIRE, T.SIDEWALL_DAMAGE, Pos.PASSENGER_REAR,
     "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface", 130, True),
    (S.PASSENGER_SIDE, "Back tire, wheel and rim", P.WHEEL_NUT, T.DAMAGED, Pos.PASSENGER_REAR,
     "Wheel, wheel nuts, rim, or mounting equipment is damaged, cracked, loose, missing, or broken", 140, True),
    (S.PASSENGER_SIDE, "Back tire, wheel and rim", P.MUD_FLAP, T.DAMAGED, Pos.PASSENGER_REAR,
     "Mud flap is damaged, missing, unsecured or held up with a zip-tie, tape or similar [DOT Only]", 150, True),

    # ═══════ § 6. In-Cab ═══════
    # Wipers
    (S.IN_CAB, "Wipers", P.WIPER_BLADE, T.NOT_WORKING, None,
     "Wiper blades are missing, damaged, or not working", 10, True),
    (S.IN_CAB, "Wipers", P.WASHER_SYSTEM, T.NOT_WORKING, None,
     "Windshield washer system / wiper fluid reservoir is not working", 20, True),
    # Brakes — sensory, no photo gate
    (S.IN_CAB, "Brakes", P.LOW_AIR_WARNING, T.ON_OR_FLASHING, None,
     "Air pressure gauge reads less than 79 lb./in² (5.5 kg/cm²) [DOT Only]", 30, False),
    (S.IN_CAB, "Brakes", P.SERVICE_BRAKE, T.NOISE, None,
     "Foot brake is squeaking, loose, weak, or stiff", 40, False),
    (S.IN_CAB, "Brakes", P.SERVICE_BRAKE, T.NOT_WORKING, None,
     "Foot brake is grinding, vibrates, leaking air, or not working", 50, False),
    (S.IN_CAB, "Brakes", P.PARKING_BRAKE, T.NOT_WORKING, None,
     "Parking brake is loose, weak, stiff, or not working", 60, False),
    # HVAC — sensory
    (S.IN_CAB, "HVAC System", P.AC, T.NO_COLD_AIR, None,
     "AC is not blowing cold air", 70, False),
    # Steering / horn / alarm — sensory
    (S.IN_CAB, "Steering, seatbelt, horn, alarm", P.HORN, T.NOT_WORKING, None,
     "Horn, backup alarm, or seatbelt alarm is not working", 80, False),
    (S.IN_CAB, "Steering, seatbelt, horn, alarm", P.SEATBELT, T.MISSING, Pos.DRIVER,
     "Seatbelt is missing, torn, frayed, or not working", 90, True),
    (S.IN_CAB, "Steering, seatbelt, horn, alarm", P.STEERING_WHEEL, T.VIBRATION, None,
     "Steering wheel has excessive vibration, stiff, loose, or needs alignment", 100, False),
    # Lights
    (S.IN_CAB, "Dashboard / In-cab lights", P.TURN_SIGNAL, T.NOT_WORKING, None,
     "Turn signal is not working", 110, True),
    (S.IN_CAB, "Dashboard / In-cab lights", P.DASHBOARD_ILLUMINATION, T.NOT_WORKING, None,
     "Dashboard light is not working", 120, True),
    (S.IN_CAB, "Dashboard / In-cab lights", P.WARNING_LAMP, T.ON_OR_FLASHING, None,
     "Any red warning lights/lamps are on or flashing", 130, True),
    (S.IN_CAB, "Dashboard / In-cab lights", P.HAZARD_LIGHT, T.NOT_WORKING, None,
     "Hazard light is not working (in cab)", 140, True),
    # Body and Doors
    (S.IN_CAB, "Body and Doors", P.BULKHEAD_DOOR, T.WONT_OPEN, None,
     "Interior sliding door (bulkhead doors) cannot open or close", 150, True),
    (S.IN_CAB, "Body and Doors", P.FLOOR_PANEL, T.DAMAGED, None,
     "Items attached to the body of the vehicle (for example: shelves, floor panels) "
     "are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar", 160, True),
    (S.IN_CAB, "Body and Doors", P.EXTERIOR_DOOR, T.WONT_LOCK, None,
     "One or more exterior doors (driver, passenger, cargo, or back door) cannot open, close, "
     "lock, or unlock properly from the inside of the vehicle", 170, True),
    # Safety accessories
    (S.IN_CAB, "Safety accessories", P.DELIVERY_DEVICE_CRADLE, T.DAMAGED, None,
     "Delivery device cradle is damaged, missing, or mounted with tape, zip-tie, or similar", 180, True),
    # Camera/monitor
    (S.IN_CAB, "Camera/monitor", P.NETRADYNE_CAMERA, T.HANGING, None,
     "Netradyne camera is hanging/disconnected from bracket", 190, True),
    (S.IN_CAB, "Camera/monitor", P.CAMERA_MONITOR, T.NOT_WORKING, None,
     "Rear or side camera monitor is missing, broken, unsecure, obstructed, or not working", 200, True),
    # Windshield
    (S.IN_CAB, "Windshield", P.WINDSHIELD, T.CRACKED, None,
     "Any crack, chip, stars on the windshield >1/2 inch (excluding 1-inch border)", 210, True),
    (S.IN_CAB, "Windshield", P.WINDSHIELD, T.OBSTRUCTED, None,
     "Device/Accessory is mounted on the windshield", 220, True),
]


# ─────────────────────────────────────────────────────
# Vehicle class → row source mapping
# ─────────────────────────────────────────────────────
TEMPLATES_BY_CLASS: dict[VC, list[DvicRow]] = {
    VC.REGULAR_CARGO_VAN: CARGO_ROWS,
    VC.CUSTOM_DELIVERY_VAN: CARGO_ROWS,
    VC.STEP_VAN_DOT: DOT_ROWS,
    VC.BOX_TRUCK_DOT: BOX_TRUCK_ROWS,
    # Pending PDFs:
    VC.ELECTRIC_VEHICLE: [],
}


def get_templates() -> dict[VC, list[DvicRow]]:
    return TEMPLATES_BY_CLASS
