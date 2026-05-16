/**
 * Per-vehicle-class walkaround order for the inspection checklist.
 *
 * The defect catalog returns parts grouped by system, but the order
 * within a system is whatever the seed picks (often alphabetical). For
 * the inspector that's noisy — `tire / rim / wheel_nut` get scattered
 * across the alphabet on each side, lights aren't grouped, in-cab
 * controls read in a random order. This map holds a curated sequence
 * that imitates the physical walk around the vehicle.
 *
 * Modelled after NOVABODY/web's `app/walkaround_order.py` (mbk/wo-v2-
 * claude-demo branch). Where their layout puts a section in a different
 * physical position, our SECTION_ROUTE wins — Nova Fora's order is
 * General → In Cab → Front → Driver → Back → Passenger, intentional.
 *
 * Parts not listed for a section/class fall back to alphabetical at the
 * end of that section (handled by `orderPartsByWalkaround`).
 *
 * Today only `regular_cargo_van` is curated. Other classes inherit the
 * cargo_van order as a starting point until each is audited; the
 * `orderPartsByWalkaround` helper falls back to alphabetical for any
 * part not in the curated list, so missing curation is safe.
 */

// System ID → ordered list of part values
const CARGO_VAN_ORDER = {
  // 1. General — paperwork + safety accessories that live in/near the cab
  general: [
    'fire_extinguisher',
    'reflective_triangles',
    'spare_fuses',
    'air_pressure_gauge',
    'paper_document',
    'license_plate',
    'inspection_sticker',
    'registration_sticker',
    'dot_decal',
    'prime_decal',
    'periodic_inspection_sticker',
    'unapproved_sticker',
  ],
  // 2. In Cab — driver's seat outwards: belt, controls, dash, then HVAC,
  //    then mirrors/cameras, then doors and cargo.
  interior: [
    'driver_seat',
    'passenger_seat',
    'seatbelt',
    'seatbelt_buckle',
    'seatbelt_alarm',
    'sun_visor',
    'interior_cleanliness',
    'interior_loose_objects',
  ],
  brakes_steering: [
    'steering_wheel',
    'service_brake',
    'parking_brake',
    'alignment',
  ],
  hvac: ['ac', 'heater', 'defroster', 'cabin_fan'],
  windshield_wipers: ['windshield', 'wiper_blade', 'washer_system'],
  cameras_electronics: [
    'dashboard_illumination',
    'warning_lamp',
    'horn',
    'backup_alarm',
    'camera_monitor',
    'rear_camera',
    'side_camera',
    'netradyne_camera',
    'delivery_device_cradle',
    'phone_cradle',
    'phone_charger',
    'usb_port',
  ],
  doors_windows: [
    'cab_door',
    'exterior_door',
    'sliding_side_door',
    'bulkhead_door',
    'rear_cargo_door',
    'roll_up_door',
    'window',
    'door_hardware',
  ],

  // 3. Front Side — looking AT the vehicle from the front
  lights: [
    'headlight',
    'turn_signal',
    'hazard_light',
    'marker_light',
    'tail_light',
    'license_plate_light',
    'cabin_light',
    'cargo_light',
    'stepwell_light',
    'mirror_light',
    'clearance_marker_light',
  ],
  fluids_under_hood: [
    'engine_oil',
    'coolant',
    'brake_fluid',
    'power_steering_fluid',
    'def_fluid',
    'gear_oil',
    'fuel_cap',
    'battery_12v',
    'battery_cover',
  ],
  body_steps: [
    'bumper',
    'fender',
    'hood',
    'side_panel',
    'floor_panel',
    'side_step',
    'rear_step',
    'trim',
    'side_molding',
    'frame_rail',
    'cargo_shelf',
  ],

  // 4. Driver Side / 5. Passenger Side — same part order, mirrored
  //    placement on the vehicle (catalog handles the position pills).
  mirrors: ['side_mirror'],
  tires_wheels: ['tire', 'rim', 'wheel_nut', 'mounting_equipment'],
  under_vehicle: [
    'suspension',
    'shock_absorber',
    'coil_spring',
    'leaf_spring',
    'air_bag',
    'torque_arm',
    'tie_rod',
    'drag_link',
    'ball_joint',
    'pitman_arm',
    'power_steering',
    'u_bolt',
    'undercarriage_object',
  ],
  air_brake: [
    'slack_adjuster',
    'brake_chamber',
    'brake_lining',
    'brake_drum',
    'air_compressor',
    'air_tank',
    'air_line',
    'low_air_warning',
  ],
  ev_powertrain: [
    'ev_center_display',
    'high_voltage_cable',
    'charging_port_cap',
    'avas_speaker',
  ],
};

// Per-vehicle-class override map. Other classes inherit cargo_van until
// audited individually.
const ORDER_BY_CLASS = {
  regular_cargo_van: CARGO_VAN_ORDER,
  custom_delivery_van: CARGO_VAN_ORDER,
  step_van_dot: CARGO_VAN_ORDER,
  box_truck_dot: CARGO_VAN_ORDER,
  electric_vehicle: CARGO_VAN_ORDER,
};

/**
 * Sort a flat array of part objects (from the catalog) by the curated
 * walkaround order for a given vehicle class + system. Parts not in the
 * curated list fall back to alphabetical at the end.
 *
 * @param {Array<{id: string, label: string}>} parts
 * @param {string} vehicleClass
 * @param {string} systemId
 * @returns {Array} same shape, reordered
 */
export function orderPartsByWalkaround(parts, vehicleClass, systemId) {
  if (!Array.isArray(parts) || parts.length === 0) return parts || [];
  const order = ORDER_BY_CLASS[vehicleClass]?.[systemId];
  if (!order || order.length === 0) {
    // No curation for this (class, system) — fall back to alphabetical.
    return [...parts].sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
  }
  const indexOf = (id) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...parts].sort((a, b) => {
    const ia = indexOf(a.id);
    const ib = indexOf(b.id);
    if (ia !== ib) return ia - ib;
    // Same priority bucket → alphabetical fallback for stability.
    return (a.label || a.id).localeCompare(b.label || b.id);
  });
}
