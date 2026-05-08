"""Spanish (es-MX) translations for the V2.2 defect catalog labels.

Mirrors the English structure in `app.defect_labels` so we don't have to
mutate the original module. The route layer picks the right translation
based on the request's Accept-Language header.

If a label is missing here, the English fallback wins — partial coverage
is OK during rollout.
"""
from app.models.defect_catalog import (
    DefectClassification as C,
    DefectGroup as G,
    DefectPart as P,
    DefectPosition as Pos,
    DefectSystem as S,
    DefectType as T,
    DvicSection as DS,
    VehicleClass as VC,
)


# ─────────────────────────────────────────────────────
# Vehicle classes — short codes mostly stay the same
# ─────────────────────────────────────────────────────
VEHICLE_CLASS_LABELS_ES: dict[VC, dict[str, str]] = {
    VC.CUSTOM_DELIVERY_VAN: {
        "label": "CDV",
        "description": "Custom Delivery Van — Stellantis/Ram CDV",
    },
    VC.REGULAR_CARGO_VAN: {
        "label": "Cargo",
        "description": "Van de carga — Sprinter, Transit, ProMaster (no DOT)",
    },
    VC.STEP_VAN_DOT: {
        "label": "SV",
        "description": "Step Van — regulada DOT, revisión de frenos de aire",
    },
    VC.ELECTRIC_VEHICLE: {
        "label": "EV",
        "description": "Eléctrica — Rivian EDV, revisión de tren EV",
    },
    VC.BOX_TRUCK_DOT: {
        "label": "AMXL",
        "description": "Box truck — Amazon XL, DOT + carga pesada",
    },
}


# ─────────────────────────────────────────────────────
# Classifications (severities)
# ─────────────────────────────────────────────────────
CLASSIFICATION_LABELS_ES: dict[C, dict[str, str]] = {
    C.SEV1: {"label": "Sev 1", "description": "Crítica de seguridad — fuera de operación inmediato"},
    C.SEV2: {"label": "Sev 2", "description": "Reparación prioritaria en 24h"},
    C.SEV3: {"label": "Sev 3", "description": "Programar reparación en 7 días"},
    C.ULC: {"label": "ULC", "description": "No puede salir del lote — inmediato"},
    C.ADVISORY: {"label": "Aviso", "description": "Informativo, sin acción urgente"},
}


# ─────────────────────────────────────────────────────
# Groups (operational routing)
# ─────────────────────────────────────────────────────
GROUP_LABELS_ES: dict[G, dict[str, str]] = {
    G.AMR: {"label": "AMR", "description": "Mantenimiento y reparación automotriz"},
    G.BODY: {"label": "Carrocería", "description": "Taller de carrocería"},
    G.CMR: {"label": "CMR", "description": "Reparación motor comercial"},
    G.CNMR: {"label": "CNMR", "description": "Reparación no-motor comercial"},
    G.PM: {"label": "PM", "description": "Mantenimiento preventivo"},
    G.TIRES: {"label": "Llantas", "description": "Llantera"},
    G.DETAILING: {"label": "Detalle", "description": "Limpieza y detalle"},
    G.NETRADYNE: {"label": "Netradyne", "description": "Soporte cámara Netradyne"},
}


# ─────────────────────────────────────────────────────
# Systems
# ─────────────────────────────────────────────────────
SYSTEM_LABELS_ES: dict[S, dict[str, str]] = {
    S.TIRES_WHEELS: {"label": "Llantas y rines"},
    S.LIGHTS: {"label": "Luces"},
    S.WINDSHIELD_WIPERS: {"label": "Parabrisas y limpiadores"},
    S.MIRRORS: {"label": "Espejos"},
    S.BODY_STEPS: {"label": "Carrocería y escalones"},
    S.DOORS_WINDOWS: {"label": "Puertas y ventanas"},
    S.INTERIOR: {"label": "Interior"},
    S.BRAKES_STEERING: {"label": "Frenos y dirección"},
    S.AIR_BRAKE: {"label": "Frenos de aire"},
    S.HVAC: {"label": "Clima (HVAC)"},
    S.CAMERAS_ELECTRONICS: {"label": "Cámaras y electrónica"},
    S.FLUIDS_UNDER_HOOD: {"label": "Fluidos bajo el cofre"},
    S.COMPLIANCE: {"label": "Cumplimiento"},
    S.UNDER_VEHICLE: {"label": "Bajo el vehículo"},
    S.EV_POWERTRAIN: {"label": "Tren motriz EV"},
}


# ─────────────────────────────────────────────────────
# Parts (105)
# ─────────────────────────────────────────────────────
PART_LABELS_ES: dict[P, dict[str, str]] = {
    # tires_wheels
    P.TIRE: {"label": "Llanta"},
    P.RIM: {"label": "Rin"},
    P.WHEEL_NUT: {"label": "Tuerca de rueda"},
    P.MOUNTING_EQUIPMENT: {"label": "Birlo / montaje de rueda"},
    # lights
    P.HEADLIGHT: {"label": "Faro delantero"},
    P.TAIL_LIGHT: {"label": "Calavera trasera"},
    P.TURN_SIGNAL: {"label": "Direccional"},
    P.HAZARD_LIGHT: {"label": "Intermitentes"},
    P.MARKER_LIGHT: {"label": "Luz de gálibo"},
    P.LICENSE_PLATE_LIGHT: {"label": "Luz de placa"},
    P.CABIN_LIGHT: {"label": "Luz de cabina"},
    P.CARGO_LIGHT: {"label": "Luz de carga"},
    P.STEPWELL_LIGHT: {"label": "Luz de escalón"},
    P.MIRROR_LIGHT: {"label": "Luz de espejo"},
    P.CLEARANCE_MARKER_LIGHT: {"label": "Luz de demarcación"},
    # windshield_wipers
    P.WINDSHIELD: {"label": "Parabrisas"},
    P.WIPER_BLADE: {"label": "Plumilla del limpiador"},
    P.WASHER_SYSTEM: {"label": "Sistema de lavado"},
    # mirrors
    P.SIDE_MIRROR: {"label": "Espejo lateral"},
    # body_steps / frame
    P.BUMPER: {"label": "Defensa"},
    P.FENDER: {"label": "Salpicadera"},
    P.HOOD: {"label": "Cofre"},
    P.SIDE_PANEL: {"label": "Panel lateral"},
    P.FLOOR_PANEL: {"label": "Panel de piso"},
    P.SIDE_STEP: {"label": "Estribo lateral"},
    P.REAR_STEP: {"label": "Estribo trasero"},
    P.TRIM: {"label": "Moldura"},
    P.SIDE_MOLDING: {"label": "Moldura lateral"},
    P.CAB_DOOR: {"label": "Puerta de cabina"},
    P.FRAME_RAIL: {"label": "Larguero del chasis"},
    P.CARGO_SHELF: {"label": "Repisa de carga"},
    # doors_windows
    P.EXTERIOR_DOOR: {"label": "Puerta exterior"},
    P.SLIDING_SIDE_DOOR: {"label": "Puerta lateral corrediza"},
    P.BULKHEAD_DOOR: {"label": "Puerta divisoria"},
    P.REAR_CARGO_DOOR: {"label": "Puerta trasera de carga"},
    P.ROLL_UP_DOOR: {"label": "Puerta enrollable"},
    P.WINDOW: {"label": "Ventana"},
    P.DOOR_HARDWARE: {"label": "Herrajes de puerta"},
    # interior
    P.DRIVER_SEAT: {"label": "Asiento del conductor"},
    P.PASSENGER_SEAT: {"label": "Asiento del pasajero"},
    P.SEATBELT: {"label": "Cinturón de seguridad"},
    P.SEATBELT_BUCKLE: {"label": "Hebilla del cinturón"},
    P.SUN_VISOR: {"label": "Visera"},
    P.INTERIOR_CLEANLINESS: {"label": "Limpieza interior"},
    P.INTERIOR_LOOSE_OBJECTS: {"label": "Objetos sueltos en el interior"},
    # brakes_steering
    P.PARKING_BRAKE: {"label": "Freno de mano"},
    P.SERVICE_BRAKE: {"label": "Freno de servicio"},
    P.STEERING_WHEEL: {"label": "Volante"},
    P.ALIGNMENT: {"label": "Alineación"},
    # air_brake (DOT only)
    P.SLACK_ADJUSTER: {"label": "Ajustador de freno"},
    P.BRAKE_CHAMBER: {"label": "Cámara del freno"},
    P.BRAKE_LINING: {"label": "Balata del freno"},
    P.BRAKE_DRUM: {"label": "Tambor del freno"},
    P.AIR_COMPRESSOR: {"label": "Compresor de aire"},
    P.AIR_TANK: {"label": "Tanque de aire"},
    P.AIR_LINE: {"label": "Manguera de aire"},
    P.LOW_AIR_WARNING: {"label": "Aviso de baja presión de aire"},
    # under_vehicle / suspension
    P.SUSPENSION: {"label": "Suspensión"},
    P.COIL_SPRING: {"label": "Resorte helicoidal"},
    P.LEAF_SPRING: {"label": "Muelle de hojas"},
    P.AIR_BAG: {"label": "Bolsa de aire de suspensión"},
    P.SHOCK_ABSORBER: {"label": "Amortiguador"},
    P.TORQUE_ARM: {"label": "Brazo de torque"},
    P.TIE_ROD: {"label": "Terminal de dirección"},
    P.DRAG_LINK: {"label": "Barra de arrastre"},
    P.BALL_JOINT: {"label": "Rótula"},
    P.PITMAN_ARM: {"label": "Brazo Pitman"},
    P.POWER_STEERING: {"label": "Dirección hidráulica"},
    P.U_BOLT: {"label": "Abrazadera U"},
    P.UNDERCARRIAGE_OBJECT: {"label": "Objeto bajo el vehículo"},
    # hvac
    P.AC: {"label": "A/C"},
    P.HEATER: {"label": "Calefacción"},
    P.DEFROSTER: {"label": "Desempañador"},
    P.CABIN_FAN: {"label": "Ventilador de cabina"},
    # cameras_electronics
    P.NETRADYNE_CAMERA: {"label": "Cámara Netradyne"},
    P.REAR_CAMERA: {"label": "Cámara trasera"},
    P.SIDE_CAMERA: {"label": "Cámara lateral"},
    P.CAMERA_MONITOR: {"label": "Monitor de cámara"},
    P.WARNING_LAMP: {"label": "Luz de advertencia"},
    P.BACKUP_ALARM: {"label": "Alarma de reversa"},
    P.SEATBELT_ALARM: {"label": "Alarma del cinturón"},
    P.HORN: {"label": "Claxon"},
    P.USB_PORT: {"label": "Puerto USB"},
    P.PHONE_CHARGER: {"label": "Cargador de teléfono"},
    P.DELIVERY_DEVICE_CRADLE: {"label": "Soporte del dispositivo de entrega"},
    P.PHONE_CRADLE: {"label": "Soporte del teléfono"},
    P.DASHBOARD_ILLUMINATION: {"label": "Iluminación del tablero"},
    # ev_powertrain
    P.EV_CENTER_DISPLAY: {"label": "Pantalla central EV"},
    P.HIGH_VOLTAGE_CABLE: {"label": "Cable de alto voltaje"},
    P.CHARGING_PORT_CAP: {"label": "Tapa del puerto de carga"},
    P.AVAS_SPEAKER: {"label": "Bocina AVAS"},
    # fluids_under_hood
    P.COOLANT: {"label": "Refrigerante"},
    P.BRAKE_FLUID: {"label": "Líquido de frenos"},
    P.POWER_STEERING_FLUID: {"label": "Líquido de dirección hidráulica"},
    P.DEF_FLUID: {"label": "Fluido DEF"},
    P.ENGINE_OIL: {"label": "Aceite de motor"},
    P.GEAR_OIL: {"label": "Aceite de transmisión"},
    P.FUEL_CAP: {"label": "Tapón de gasolina"},
    P.BATTERY_12V: {"label": "Batería 12V"},
    P.BATTERY_COVER: {"label": "Tapa de la batería"},
    # compliance / safety
    P.LICENSE_PLATE: {"label": "Placa"},
    P.INSPECTION_STICKER: {"label": "Calcomanía de inspección"},
    P.REGISTRATION_STICKER: {"label": "Calcomanía de registro"},
    P.DOT_DECAL: {"label": "Calcomanía DOT"},
    P.PRIME_DECAL: {"label": "Calcomanía Prime"},
    P.PAPER_DOCUMENT: {"label": "Documento en papel"},
    P.PERIODIC_INSPECTION_STICKER: {"label": "Calcomanía de inspección periódica"},
    P.UNAPPROVED_STICKER: {"label": "Calcomanía no aprobada"},
    P.FIRE_EXTINGUISHER: {"label": "Extintor"},
    P.REFLECTIVE_TRIANGLES: {"label": "Triángulos reflectantes"},
    P.SPARE_FUSES: {"label": "Fusibles de repuesto"},
    P.AIR_PRESSURE_GAUGE: {"label": "Manómetro de presión"},
    # attached
    P.LIFT_GATE: {"label": "Plataforma elevadora"},
    P.MUD_FLAP: {"label": "Loderas"},
}


# ─────────────────────────────────────────────────────
# Defect types (62)
# ─────────────────────────────────────────────────────
TYPE_LABELS_ES: dict[T, dict[str, str]] = {
    # function
    T.NOT_WORKING: {"label": "No funciona"},
    T.INTERMITTENT: {"label": "Intermitente"},
    T.FLICKERING: {"label": "Parpadea"},
    T.ON_OR_FLASHING: {"label": "Encendida / parpadeando"},
    T.NO_COLD_AIR: {"label": "Sin aire frío"},
    T.NO_HEAT: {"label": "Sin calefacción"},
    # physical state
    T.MISSING: {"label": "Falta"},
    T.DAMAGED: {"label": "Dañado"},
    T.CRACKED: {"label": "Estrellado"},
    T.BROKEN: {"label": "Roto"},
    T.BENT: {"label": "Doblado"},
    T.FRAYED: {"label": "Desgastado"},
    T.TORN: {"label": "Rasgado"},
    T.RUSTED: {"label": "Oxidado"},
    T.LEAKING: {"label": "Tiene fuga"},
    T.COVER_CRACKED: {"label": "Mica estrellada"},
    T.COVER_MISSING: {"label": "Falta la mica"},
    # attachment
    T.LOOSE: {"label": "Suelto"},
    T.HANGING: {"label": "Colgando"},
    T.UNSECURED: {"label": "Sin asegurar"},
    T.ZIP_TIED_OR_TAPED: {"label": "Con cincho o cinta"},
    T.OFF_TRACK: {"label": "Fuera de riel"},
    T.OFF_CENTER: {"label": "Descentrado"},
    T.MISALIGNED: {"label": "Desalineado"},
    T.DISCONNECTED: {"label": "Desconectado"},
    # movement
    T.STUCK: {"label": "Atorado"},
    T.WONT_OPEN: {"label": "No abre"},
    T.WONT_CLOSE: {"label": "No cierra"},
    T.WONT_LOCK: {"label": "No traba"},
    T.WONT_UNLOCK: {"label": "No destraba"},
    T.WONT_LATCH: {"label": "No engancha"},
    T.WONT_RETRACT: {"label": "No se retrae"},
    # tire-specific
    T.FLAT: {"label": "Ponchada"},
    T.LOW_TREAD: {"label": "Dibujo bajo"},
    T.SIDEWALL_DAMAGE: {"label": "Daño en costado"},
    T.OBJECT_EMBEDDED: {"label": "Objeto incrustado"},
    T.EXPOSED_WIRE: {"label": "Alambre expuesto"},
    T.BULGE: {"label": "Bulto / hernia"},
    # wheel-specific
    T.STUD_BROKEN: {"label": "Birlo roto"},
    T.HUB_CAP_MISSING: {"label": "Falta el tapón"},
    # fluid-specific
    T.LOW_FLUID: {"label": "Nivel bajo"},
    T.EMPTY: {"label": "Vacío"},
    # documentation
    T.EXPIRED: {"label": "Vencido"},
    T.ILLEGIBLE: {"label": "Ilegible"},
    T.WRONG_VEHICLE: {"label": "Vehículo equivocado"},
    # work needed
    T.NEEDS_ADJUSTMENT: {"label": "Necesita ajuste"},
    T.NEEDS_GREASE: {"label": "Necesita grasa"},
    T.NEEDS_DIAGNOSTIC: {"label": "Necesita diagnóstico"},
    T.NEEDS_REPLACEMENT: {"label": "Necesita reemplazo"},
    # feel
    T.PULLS_LEFT: {"label": "Jala a la izquierda"},
    T.PULLS_RIGHT: {"label": "Jala a la derecha"},
    T.VIBRATION: {"label": "Vibración"},
    T.NOISE: {"label": "Ruido"},
    # cleanliness
    T.DIRTY: {"label": "Sucio"},
    T.HAS_LOOSE_OBJECTS: {"label": "Tiene objetos sueltos"},
    # mount / pressure / approval / catchall
    T.MOUNT_DAMAGED: {"label": "Soporte dañado"},
    T.OVER_PRESSURE: {"label": "Presión alta"},
    T.NON_APPROVED: {"label": "No aprobado"},
    T.OBSTRUCTED: {"label": "Obstruido"},
    T.PAINT_CHIP: {"label": "Pintura desconchada"},
    T.NOT_ADJUSTABLE: {"label": "No ajustable"},
    T.ODOR: {"label": "Olor"},
    T.OTHER_DAMAGE: {"label": "Otro daño"},
}


# ─────────────────────────────────────────────────────
# Positions (12)
# ─────────────────────────────────────────────────────
POSITION_LABELS_ES: dict[Pos, dict[str, str]] = {
    Pos.DRIVER_FRONT: {"label": "Conductor delantera"},
    Pos.PASSENGER_FRONT: {"label": "Pasajero delantera"},
    Pos.DRIVER_REAR: {"label": "Conductor trasera"},
    Pos.PASSENGER_REAR: {"label": "Pasajero trasera"},
    Pos.DRIVER_SIDE: {"label": "Lado del conductor"},
    Pos.PASSENGER_SIDE: {"label": "Lado del pasajero"},
    Pos.FRONT: {"label": "Frente"},
    Pos.REAR: {"label": "Atrás"},
    Pos.DRIVER: {"label": "Conductor"},
    Pos.PASSENGER: {"label": "Pasajero"},
    Pos.UPPER: {"label": "Arriba"},
    Pos.LOWER: {"label": "Abajo"},
}


# ─────────────────────────────────────────────────────
# DVIC sections (6) — for /dvic-template route
# ─────────────────────────────────────────────────────
DVIC_SECTION_META_ES: dict[DS, dict[str, str]] = {
    DS.GENERAL: {"label": "General",
                 "description": "Documentación, limpieza y accesorios de seguridad"},
    DS.FRONT_SIDE: {"label": "Frente",
                    "description": "Faros, intermitentes, suspensión delantera"},
    DS.BACK_SIDE: {"label": "Parte trasera",
                   "description": "Calaveras, placa, carrocería trasera"},
    DS.DRIVER_SIDE: {"label": "Lado del conductor",
                     "description": "Llantas del lado del conductor, espejo, carrocería, calcomanías"},
    DS.PASSENGER_SIDE: {"label": "Lado del pasajero",
                        "description": "Llantas del lado del pasajero, espejo, carrocería"},
    DS.IN_CAB: {"label": "En cabina",
                "description": "Limpiadores, frenos, A/C, dirección, tablero, puertas"},
}


# ─────────────────────────────────────────────────────
# DVIC part_categories (24) — the small headings inside each section
# ─────────────────────────────────────────────────────
DVIC_CATEGORY_LABELS_ES: dict[str, str] = {
    "Back tire, wheel and rim": "Llanta, rueda y rin trasero",
    "Body and Doors": "Carrocería y puertas",
    "Body and doors": "Carrocería y puertas",
    "Brakes": "Frenos",
    "Camera/monitor": "Cámara / monitor",
    "Charging port and fluids": "Puerto de carga y fluidos",
    "Dashboard / In-cab lights": "Tablero / luces en cabina",
    "Driver Seat": "Asiento del conductor",
    "Front tire, wheel and rim": "Llanta, rueda y rin delantero",
    "HVAC System": "Sistema de A/C",
    "HVAC systems": "Sistemas de A/C",
    "License plates/tags": "Placas / calcomanías",
    "Lights and light covers": "Luces y micas",
    "Safety accessories": "Accesorios de seguridad",
    "Side mirrors": "Espejos laterales",
    "State Inspection": "Inspección estatal",
    "Steering, seatbelt, horn, alarm": "Dirección, cinturón, claxon, alarma",
    "Steering, seatbelt, horn, and alarm": "Dirección, cinturón, claxon y alarma",
    "Suspension & exhaust system": "Suspensión y escape",
    "Suspension & underbody shield": "Suspensión y protección inferior",
    "Vehicle Cleanliness": "Limpieza del vehículo",
    "Vehicle Documentation": "Documentación del vehículo",
    "Windshield": "Parabrisas",
    "Wipers": "Limpiadores",
}


# ─────────────────────────────────────────────────────
# DVIC item descriptions (~108) — the verbatim PDF text
# Keys are the exact English text seeded into DvicTemplateItem.description.
# ─────────────────────────────────────────────────────
DVIC_DESCRIPTION_LABELS_ES: dict[str, str] = {
    # Cargo § General — Vehicle Cleanliness / License plates / State Inspection
    "Interior of vehicle has loose objects/spilled liquid that could compromise safely driving the vehicle":
        "El interior del vehículo tiene objetos sueltos o líquido derramado que podrían comprometer la conducción segura",
    "Interior has trash or excessive grime/dust present":
        "El interior tiene basura o suciedad/polvo excesivos",
    "Interior has odor": "El interior tiene olor",
    "License plates/temp tags are damaged, missing, illegible, or expired":
        "Las placas o calcomanías temporales están dañadas, faltan, son ilegibles o están vencidas",
    "License plate physically damaged or bent":
        "Placa físicamente dañada o doblada",
    "State Inspection sticker is missing":
        "Falta la calcomanía de inspección estatal",
    "State Inspection sticker is expired":
        "La calcomanía de inspección estatal está vencida",
    "State Inspection sticker is damaged or illegible":
        "La calcomanía de inspección estatal está dañada o ilegible",

    # Front side — suspension, lights, body
    "Noticeable leaning of vehicle (when parked)":
        "El vehículo se inclina notoriamente (estacionado)",
    "Loose or hanging objects underneath":
        "Objetos sueltos o colgando debajo del vehículo",
    "Headlight LOW BEAM is not working — driver side":
        "El faro LUZ BAJA no funciona — lado del conductor",
    "Headlight LOW BEAM is not working — passenger side":
        "El faro LUZ BAJA no funciona — lado del pasajero",
    "Headlight HIGH BEAM is not working":
        "El faro LUZ ALTA no funciona",
    "Hazard light is not working":
        "Las intermitentes no funcionan",
    "Any lights or light covers are cracked (leaving hole or void), missing, or not working properly":
        "Alguna luz o mica está estrellada (con hoyo o hueco), falta o no funciona correctamente",
    "Front bumper or attached items damaged, loose, or hanging":
        "Defensa delantera o piezas adjuntas dañadas, sueltas o colgando",
    "Hood damaged or won't latch":
        "Cofre dañado o no engancha",

    # Back side
    "License plate light is not working":
        "La luz de placa no funciona",
    "Tail light is not working — driver side":
        "La calavera trasera no funciona — lado del conductor",
    "Tail light is not working — passenger side":
        "La calavera trasera no funciona — lado del pasajero",
    "Tail light cover cracked, missing, or hole — driver side":
        "Mica de calavera estrellada, falta o tiene hoyo — lado del conductor",
    "Tail light cover cracked, missing, or hole — passenger side":
        "Mica de calavera estrellada, falta o tiene hoyo — lado del pasajero",
    "Items attached to the body of the vehicle (for example: bumper, backup camera, or rear step) are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar":
        "Piezas adjuntas a la carrocería (defensa, cámara de reversa o estribo trasero) faltan, están dañadas, sueltas, sin asegurar, colgando o sujetadas con cincho/cinta",
    "Rear cargo door won't close, latch, or lock":
        "La puerta trasera de carga no cierra, no engancha o no traba",

    # Driver / passenger side — tires, suspension, fluids, body, lights
    "Wheel, wheel nuts, rim, or mounting equipment is damaged, cracked, loose, missing, or broken":
        "Rueda, tuercas, rin o componentes de montaje están dañados, estrellados, sueltos, faltan o rotos",
    "Tire has insufficient tread (Less than 2/32 or 1.6mm) on inner most, middle, or outer most tread":
        "La llanta tiene dibujo insuficiente (menos de 2/32 o 1.6mm) en banda interior, central o exterior",
    "Tire has objects, cuts, dents, swells, leaks, appears flat, or exposed wire on surface":
        "La llanta tiene objetos, cortes, abolladuras, bultos, fugas, parece ponchada o tiene alambre expuesto",
    "Active non-clear fluid leaking on the ground":
        "Fuga activa de fluido (no transparente) en el piso",
    "Side mirror cracked, missing, or unable to adjust":
        "Espejo lateral estrellado, falta o no se puede ajustar",
    "Marker light not working or missing":
        "Luz de gálibo no funciona o falta",
    "Body panel damaged, loose, or hanging":
        "Panel de carrocería dañado, suelto o colgando",
    "Side step damaged, missing, or unsecured":
        "Estribo lateral dañado, falta o sin asegurar",
    "DOT decal missing, damaged, or illegible":
        "Calcomanía DOT falta, está dañada o ilegible",
    "Prime decal missing, damaged, or illegible":
        "Calcomanía Prime falta, está dañada o ilegible",
    "Sliding side door won't open, close, latch, or lock":
        "La puerta lateral corrediza no abre, cierra, engancha o traba",
    "Cab door won't open, close, latch, or lock":
        "La puerta de cabina no abre, cierra, engancha o traba",
    "Window cracked, broken, or won't operate":
        "Ventana estrellada, rota o no funciona",
    "Fender damaged, missing, or hanging":
        "Salpicadera dañada, falta o colgando",

    # In Cab — wipers, brakes, HVAC, steering, dash, doors, mirrors
    "Windshield is cracked, chipped, or has anything obstructing the driver's line of sight":
        "Parabrisas estrellado, despostillado o con algo que obstruya la visión del conductor",
    "Wiper blade is torn, missing, or doesn't clear the windshield":
        "Plumilla rasgada, falta o no limpia el parabrisas",
    "Washer system doesn't spray fluid":
        "El sistema de lavado no rocía líquido",
    "Parking brake fails to hold the vehicle":
        "El freno de mano no detiene el vehículo",
    "Service brake feels soft, low, or makes noise":
        "El freno de servicio se siente bajo, esponjoso o hace ruido",
    "Brake pedal is loose, low, or sticks":
        "El pedal de freno está suelto, bajo o se atora",
    "A/C blows no cold air":
        "El A/C no enfría",
    "Heater blows no warm air":
        "La calefacción no calienta",
    "Defroster doesn't clear windshield":
        "El desempañador no limpia el parabrisas",
    "Cabin fan won't operate at all speeds":
        "El ventilador de cabina no funciona en todas las velocidades",
    "Steering wheel feels loose, has play, or won't return":
        "El volante se siente flojo, tiene juego o no regresa",
    "Vehicle pulls left or right while driving straight":
        "El vehículo jala a la izquierda o la derecha al manejar derecho",
    "Driver seatbelt is frayed, torn, won't latch, or won't retract":
        "El cinturón del conductor está desgastado, rasgado, no engancha o no se retrae",
    "Horn is not working":
        "El claxon no funciona",
    "Backup alarm is not working":
        "La alarma de reversa no funciona",
    "Seatbelt alarm is not working":
        "La alarma del cinturón no funciona",
    "Driver seat is damaged, won't adjust, or unsecured":
        "El asiento del conductor está dañado, no ajusta o sin asegurar",
    "Dashboard warning lamp on or flashing":
        "Luz de advertencia del tablero encendida o parpadeando",
    "Dashboard illumination not working":
        "Iluminación del tablero no funciona",
    "Sun visor missing, broken, or won't stay in position":
        "Visera falta, está rota o no se mantiene en posición",
    "Camera monitor is blank, frozen, or shows error":
        "El monitor de cámara está en blanco, congelado o muestra error",
    "Rear camera image is blurry, dark, or missing":
        "La imagen de la cámara trasera está borrosa, oscura o falta",
    "Side camera image is blurry, dark, or missing":
        "La imagen de la cámara lateral está borrosa, oscura o falta",
    "Netradyne camera missing, damaged, or unplugged":
        "Cámara Netradyne falta, está dañada o desconectada",
    "Phone cradle / device cradle damaged or missing":
        "Soporte de teléfono / dispositivo dañado o falta",
    "USB port not working":
        "Puerto USB no funciona",
    "Cabin light not working":
        "Luz de cabina no funciona",
    "Cargo light not working":
        "Luz de carga no funciona",
    "Stepwell light not working":
        "Luz de escalón no funciona",
    "Mirror light not working":
        "Luz de espejo no funciona",

    # Air brake (DOT step van + box truck)
    "Air pressure builds slowly or fails low-air warning test":
        "La presión de aire sube lento o falla la prueba de aviso de baja presión",
    "Slack adjuster out of spec or damaged":
        "Ajustador de freno fuera de especificación o dañado",
    "Brake chamber leaking or damaged":
        "Cámara de freno con fuga o dañada",
    "Air line cracked, leaking, or chafed":
        "Manguera de aire rota, con fuga o desgastada",
    "Air tank rusted, leaking, or strap loose":
        "Tanque de aire oxidado, con fuga o con abrazadera floja",
    "Brake lining worn below limit or contaminated":
        "Balata desgastada bajo el límite o contaminada",
    "Brake drum cracked or scored":
        "Tambor del freno estrellado o rayado",
    "Low air warning device fails to activate":
        "El aviso de baja presión no se activa",
    "Air compressor noisy or not maintaining pressure":
        "Compresor de aire ruidoso o no mantiene la presión",

    # EV-specific
    "Charging port cap missing or damaged":
        "Tapa del puerto de carga falta o está dañada",
    "High-voltage cable insulation cracked or damaged":
        "Aislamiento del cable de alto voltaje estrellado o dañado",
    "EV center display blank, frozen, or showing error":
        "Pantalla central EV en blanco, congelada o con error",
    "AVAS speaker not emitting low-speed warning":
        "Bocina AVAS no emite aviso de baja velocidad",
    "12V battery cover missing or damaged":
        "Tapa de batería 12V falta o está dañada",

    # Fluids under hood
    "Coolant level is below minimum":
        "Nivel de refrigerante por debajo del mínimo",
    "Brake fluid level is below minimum":
        "Nivel de líquido de frenos por debajo del mínimo",
    "Power steering fluid level is below minimum":
        "Nivel de líquido de dirección hidráulica por debajo del mínimo",
    "DEF fluid level is below minimum":
        "Nivel de fluido DEF por debajo del mínimo",
    "Engine oil level is below minimum":
        "Nivel de aceite de motor por debajo del mínimo",
    "Fuel cap missing or won't seal":
        "Tapón de gasolina falta o no sella",

    # Box truck specific
    "Lift gate damaged, won't operate, or unsecured":
        "Plataforma elevadora dañada, no funciona o sin asegurar",
    "Mud flap missing, torn, or hanging":
        "Lodera falta, rota o colgando",
    "Cargo shelf damaged, loose, or unsecured":
        "Repisa de carga dañada, suelta o sin asegurar",
    "Bulkhead door won't latch or lock":
        "La puerta divisoria no engancha o no traba",
    "Roll-up door won't open, close, or latch":
        "La puerta enrollable no abre, cierra o engancha",

    # Safety accessories (compliance)
    "Fire extinguisher missing, expired, or unsecured":
        "Extintor falta, está vencido o sin asegurar",
    "Reflective triangles missing or damaged":
        "Triángulos reflectantes faltan o están dañados",
    "Spare fuses missing":
        "Fusibles de repuesto faltan",
    "Air pressure gauge missing or damaged":
        "Manómetro de presión falta o está dañado",
    "Registration sticker missing, expired, or illegible":
        "Calcomanía de registro falta, está vencida o ilegible",
    "Periodic inspection sticker missing or expired":
        "Calcomanía de inspección periódica falta o está vencida",
    "Unapproved sticker present on vehicle":
        "Calcomanía no aprobada presente en el vehículo",
    "Paper documentation missing or incomplete":
        "Documentación en papel falta o está incompleta",

    # ─── Real DB seed wording (verbatim from DvicTemplateItem rows) ───
    # GENERAL section — extras
    "DOT/CA BIT/State Inspection sticker is missing, damaged, illegible, or expired":
        "La calcomanía de DOT / CA BIT / Inspección estatal falta, está dañada, ilegible o vencida",
    "Fire extinguisher is missing, not mounted, mounted with a tape, zip-tie or similar, or the dial/needle is not in the green zone":
        "El extintor falta, no está montado, está sujetado con cinta o cincho, o la aguja no está en la zona verde",
    "Fire extinguisher is missing, not mounted, mounted with tape/zip-tie, or dial/needle is not in the green zone":
        "El extintor falta, no está montado, está sujetado con cinta/cincho, o la aguja no está en la zona verde",
    "Insurance information, registration, short haul exemption, or certification of lease is missing, damaged, illegible, or expired":
        "La información de seguro, registro, exención de viaje corto o certificación de arrendamiento falta, está dañada, ilegible o vencida",
    "Reflective triangles are missing":
        "Faltan los triángulos reflectantes",
    "Spare fuses are missing":
        "Faltan los fusibles de repuesto",
    "Spare fuses or reflective triangles are missing":
        "Faltan los fusibles de repuesto o los triángulos reflectantes",

    # FRONT_SIDE — extras
    "Any lights are cracked (leaving hole or void), missing, or not working properly":
        "Alguna luz está estrellada (con hoyo o hueco), falta o no funciona correctamente",
    "Headlight is not working":
        "El faro no funciona",
    "Items attached to the body (bumpers, hood latches) are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar":
        "Piezas adjuntas a la carrocería (defensas, seguros del cofre) faltan, están dañadas, sueltas, sin asegurar, colgando o sujetadas con cincho/cinta",
    "Items attached to the body of the vehicle (for example: bumpers and hood latches) are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar":
        "Piezas adjuntas a la carrocería (por ejemplo: defensas y seguros del cofre) faltan, están dañadas, sueltas, sin asegurar, colgando o sujetadas con cincho/cinta",

    # BACK_SIDE — extras
    "Hazard light is not working (back)":
        "Las intermitentes traseras no funcionan",
    "Items attached to the body of the vehicle (for example: bumper, back-up camera, lift gate, or rear step) are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar":
        "Piezas adjuntas a la carrocería (por ejemplo: defensa, cámara de reversa, plataforma elevadora o estribo trasero) faltan, están dañadas, sueltas, sin asegurar, colgando o sujetadas con cincho/cinta",
    "Tail light is not working":
        "La calavera trasera no funciona",

    # DRIVER_SIDE / PASSENGER_SIDE — common
    "Amazon DOT decal (USDOT2881058) is damaged, missing, excessively dirty, or not visible":
        "La calcomanía Amazon DOT (USDOT2881058) está dañada, falta, está demasiado sucia o no es visible",
    "Amazon DOT decal (USDOT2881058) is damaged, missing, excessively dirty, or not visible, or any existing DOT decals on rental vehicles are not covered and visible":
        "La calcomanía Amazon DOT (USDOT2881058) está dañada, falta, está demasiado sucia o no es visible; o las calcomanías DOT existentes en vehículos rentados no están cubiertas y visibles",
    "Amazon DOT decal damaged, missing, excessively dirty, or not visible":
        "Calcomanía Amazon DOT dañada, falta, demasiado sucia o no visible",
    "DOT Requirement – Amazon DOT decal (USDOT2881058) is damaged, missing, excessively dirty, or not visible [DOT Only]":
        "Requisito DOT – La calcomanía Amazon DOT (USDOT2881058) está dañada, falta, demasiado sucia o no visible [solo DOT]",
    "Battery cover not present, not securely latched/fastened, or bolts missing (Box Trucks only)":
        "Tapa de batería ausente, sin asegurar correctamente o le faltan tornillos (solo Box Trucks)",
    "Door dent, scratch, or paint damage":
        "Puerta con abolladura, rayón o daño en la pintura",
    "Door misaligned or won't close properly":
        "Puerta desalineada o no cierra correctamente",
    "Door panel missing":
        "Falta el panel de la puerta",
    "Fuel cap is missing or broken":
        "Tapón de gasolina falta o está roto",
    "Items attached to the body (side view camera, cargo steps) are missing, damaged, loose, hanging":
        "Piezas adjuntas a la carrocería (cámara lateral, escalones de carga) faltan, están dañadas, sueltas o colgando",
    "Items attached to the body of the vehicle (for example: side view camera, or cargo steps) are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar":
        "Piezas adjuntas a la carrocería (por ejemplo: cámara lateral o escalones de carga) faltan, están dañadas, sueltas, sin asegurar, colgando o sujetadas con cincho/cinta",
    "Mirror turn signal light cover broken or missing":
        "La mica de la direccional del espejo está rota o falta",
    "Mirror turn signal light is not working":
        "La direccional del espejo no funciona",
    "Mud Flap is damaged, missing, unsecured or held up with a zip-tie, tape or similar":
        "La lodera está dañada, falta, sin asegurar o sujetada con cincho/cinta",
    "Mud flap is damaged, missing, unsecured or held up with a zip-tie, tape or similar [DOT Only]":
        "La lodera está dañada, falta, sin asegurar o sujetada con cincho/cinta [solo DOT]",
    "Prime decal damaged, missing, excessively dirty, or not visible":
        "Calcomanía Prime dañada, falta, demasiado sucia o no visible",
    "Prime decal is damaged, missing, excessively dirty, or not visible":
        "La calcomanía Prime está dañada, falta, demasiado sucia o no es visible",
    "Side mirror cannot be adjusted":
        "El espejo lateral no se puede ajustar",
    "Side mirror glass or window glass is cracked, damaged, or missing":
        "El cristal del espejo lateral o de la ventana está estrellado, dañado o falta",
    "Side mirror or window glass is cracked, damaged, or missing":
        "El cristal del espejo lateral o de la ventana está estrellado, dañado o falta",
    "Side mirror is loose, hanging, unsecured, or held up with a zip-tie, tape, or similar":
        "El espejo lateral está flojo, colgando, sin asegurar o sujetado con cincho/cinta",
    "Side mirror is loose, hanging, unsecured":
        "El espejo lateral está flojo, colgando o sin asegurar",
    "Side mirrors are loose, hanging, unsecured, or held up with a zip-tie, tape, or similar":
        "Los espejos laterales están flojos, colgando, sin asegurar o sujetados con cincho/cinta",
    "Side mirrors cannot be adjusted":
        "Los espejos laterales no se pueden ajustar",
    "Tire has insufficient tread (Less than 4/32 or 3.2mm) on inner most, middle, or outer most tread":
        "La llanta tiene dibujo insuficiente (menos de 4/32 o 3.2mm) en banda interior, central o exterior",
    "Tire has insufficient tread (Less than 4/32 or 3.2mm) on inner most, middle, or outer most tread [DOT Only]":
        "La llanta tiene dibujo insuficiente (menos de 4/32 o 3.2mm) en banda interior, central o exterior [solo DOT]",
    "Wheel, wheel nut, rim, or mounting equipment is damaged, cracked, loose, missing, or broken":
        "Rueda, tuerca, rin o componente de montaje está dañado, estrellado, suelto, falta o roto",
    "Wheel, wheel nuts, rim, or mounting equipment damaged, cracked, loose, missing, or broken":
        "Rueda, tuercas, rin o componentes de montaje dañados, estrellados, sueltos, faltan o rotos",

    # IN_CAB — full set
    "AC is not blowing cold air":
        "El A/C no enfría",
    "Air pressure gauge reads less than 79 lb./in² (5.5 kg/cm²) [DOT Only]":
        "El manómetro marca menos de 79 lb/in² (5.5 kg/cm²) [solo DOT]",
    "Air pressure gauge reads more than 120 PSI":
        "El manómetro marca más de 120 PSI",
    "Any crack, chip, stars on the windshield >1/2 inch (excluding 1 inch border)":
        "Estrelladura, despostillado o estrella en el parabrisas mayor a 1/2 pulgada (excluyendo el borde de 1 pulgada)",
    "Any crack, chip, stars on the windshield >1/2 inch (excluding 1-inch border)":
        "Estrelladura, despostillado o estrella en el parabrisas mayor a 1/2 pulgada (excluyendo el borde de 1 pulgada)",
    "Any red warning lights/lamps are on or flashing":
        "Alguna luz roja de advertencia está encendida o parpadeando",
    "Dashboard light is not working":
        "La luz del tablero no funciona",
    "Defroster/heater is not working":
        "El desempañador o calefacción no funciona",
    "Delivery device cradle is damaged, missing, or mounted with tape, zip-tie, or similar":
        "El soporte del dispositivo de entrega está dañado, falta o está montado con cinta o cincho",
    "Delivery device cradle is damaged, missing, or zip-tied":
        "El soporte del dispositivo de entrega está dañado, falta o sujetado con cincho",
    "Device/Accessory is mounted on the windshield":
        "Hay un dispositivo o accesorio montado sobre el parabrisas",
    "Foot brake is grinding, vibrates, leaking air, or not working":
        "El pedal del freno rechina, vibra, tiene fuga de aire o no funciona",
    "Foot brake is squeaking, loose, weak, or stiff":
        "El pedal del freno chilla, está flojo, débil o duro",
    "Hazard light is not working (in cab)":
        "Las intermitentes (en cabina) no funcionan",
    "Horn, backup alarm, or seatbelt alarm is not working":
        "El claxon, la alarma de reversa o la alarma del cinturón no funciona",
    "Interior sliding door (bulkhead doors) cannot open or close":
        "La puerta interior corrediza (puerta divisoria) no abre o no cierra",
    "Items attached to the body of the vehicle (for example: shelves, floor panels) are missing, damaged, loose, unsecure, hanging, or held with a zip-tie, tape, or similar":
        "Piezas adjuntas a la carrocería (por ejemplo: repisas, paneles de piso) faltan, están dañadas, sueltas, sin asegurar, colgando o sujetadas con cincho/cinta",
    "Netradyne camera is hanging or disconnected from bracket":
        "La cámara Netradyne está colgando o desconectada del soporte",
    "Netradyne camera is hanging/disconnected from bracket":
        "La cámara Netradyne está colgando o desconectada del soporte",
    "Netradyne camera is not working":
        "La cámara Netradyne no funciona",
    "One or more exterior doors (driver, passenger, cargo, or back door) cannot open, close, lock, or unlock properly from the inside of the vehicle":
        "Una o más puertas exteriores (conductor, pasajero, carga o trasera) no abren, cierran, traban o destraban correctamente desde el interior del vehículo",
    "One or more exterior doors cannot open, close, lock, or unlock from inside":
        "Una o más puertas exteriores no abren, cierran, traban o destraban desde el interior",
    "Parking brake is loose, weak, stiff, or not working":
        "El freno de mano está flojo, débil, duro o no funciona",
    "Rear or side camera monitor is missing, broken, unsecure, obstructed, or not working":
        "El monitor de la cámara trasera o lateral falta, está roto, sin asegurar, obstruido o no funciona",
    "Seat integrity is compromised (for example: cannot be adjusted, has exposed metal, wire, spring, or missing, torn, loose cushioning)":
        "La integridad del asiento está comprometida (por ejemplo: no se ajusta, tiene metal, alambre o resorte expuesto, o el acojinado falta, está rasgado o suelto)",
    "Seatbelt BUCKLE is missing, broken, or not latching — driver side":
        "La HEBILLA del cinturón falta, está rota o no engancha — lado del conductor",
    "Seatbelt BUCKLE is missing, broken, or not latching — passenger side":
        "La HEBILLA del cinturón falta, está rota o no engancha — lado del pasajero",
    "Seatbelt anchor, casing, or BELT is missing, torn, or frayed — driver side":
        "El anclaje, carcasa o BANDA del cinturón falta, está rasgado o desgastado — lado del conductor",
    "Seatbelt anchor, casing, or BELT is missing, torn, or frayed — passenger side":
        "El anclaje, carcasa o BANDA del cinturón falta, está rasgado o desgastado — lado del pasajero",
    "Seatbelt is missing, torn, frayed, or not working":
        "El cinturón de seguridad falta, está rasgado, desgastado o no funciona",
    "Steering wheel has excessive vibration, stiff, loose, or needs alignment":
        "El volante tiene vibración excesiva, está duro, flojo o necesita alineación",
    "Turn signal is not working":
        "La direccional no funciona",
    "Windshield washer system / wiper fluid reservoir is not working":
        "El sistema de lavado de parabrisas o el depósito del líquido no funciona",
    "Windshield washer system is not working and/or wiper fluid reservoir is empty":
        "El sistema de lavado de parabrisas no funciona y/o el depósito del líquido está vacío",
    "Wiper blades are missing, damaged, or not working":
        "Las plumillas de los limpiadores faltan, están dañadas o no funcionan",
}
