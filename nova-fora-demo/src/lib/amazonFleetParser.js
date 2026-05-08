/**
 * amazonFleetParser — converts Amazon Logistics "Fleet Data" XLSX/CSV rows
 * into Nova Fora vehicle shapes (matches schemas/BulkVehicleRow on the API).
 *
 * Source spreadsheet schema (28 columns; canonical name in `expectedHeaders`):
 *   vin, serviceType, vehicleName, licensePlateNumber, make, model, subModel,
 *   status, statusPriority, statusReasonCode, statusReasonMessage,
 *   operationalStatus, statusSearchValue, subcontractorName, vehicleProvider,
 *   vehicleRegistrationType, year, type, ownershipType, ownershipStartDate,
 *   ownershipEndDate, pmStats, registrationExpiryDate, registeredState,
 *   serviceTier, stationCode, payload, cubicCapacity
 *
 * Three values matter for our schema:
 *   - serviceTier      → vehicle_class (5 NF values)
 *   - ownershipType    → ownership (branded / owner / rented)
 *   - vehicleProvider  → fmc (passthrough metadata)
 *
 * The rest is descriptive only or repeats info already captured.
 */

// Header detection — accept exact matches and a few common variants. We
// lowercase/trim before comparing so capitalization differences don't break
// the upload.
const HEADER_ALIASES = {
  vin:                    ['vin'],
  fleetId:                ['vehiclename', 'fleet id', 'fleet_id', 'fleetid'],
  plate:                  ['licenseplatenumber', 'license plate', 'license plate number', 'plate'],
  make:                   ['make'],
  model:                  ['model'],
  subModel:               ['submodel', 'sub model'],
  year:                   ['year'],
  serviceTier:            ['servicetier', 'service tier'],
  ownershipType:          ['ownershiptype', 'ownership type', 'ownership'],
  vehicleProvider:        ['vehicleprovider', 'vehicle provider', 'fmc', 'provider'],
  status:                 ['status'],
};

const norm = (s) => String(s ?? '').trim().toLowerCase();


/**
 * Map Amazon's serviceTier strings to Nova Fora vehicle_class enum values.
 *
 * This mapping drives which DVIC checklist the inspector loads, so it MUST
 * be deterministic and exhaustive for every value Amazon's Cortex portal
 * exports. The implementation uses an explicit lookup table for known
 * tiers, then falls back to substring matching for new variants until
 * they're added to the table.
 *
 * Known Cortex `serviceTier` values (May 2026 export):
 *   STANDARD_CARGO_VAN              → regular_cargo_van
 *   LARGE_CARGO_VAN                 → regular_cargo_van
 *   EXTRA_LARGE_CARGO_VAN           → regular_cargo_van     (Sprinter / Transit XL)
 *   STEP_VAN_SMALL                  → step_van_dot
 *   STEP_VAN_MEDIUM                 → step_van_dot
 *   STEP_VAN_LARGE                  → step_van_dot
 *   CUSTOM_DELIVERY_VAN_FOURTEEN_FT → custom_delivery_van
 *   CUSTOM_DELIVERY_VAN_SIXTEEN_FT  → custom_delivery_van
 *   BOX_TRUCK / AMXL                → box_truck_dot
 *   RIVIAN / ELECTRIC               → electric_vehicle
 */
const SERVICE_TIER_EXPLICIT = {
  // Cargo vans (all sizes share the Cargo DVIC)
  STANDARD_CARGO_VAN:    'regular_cargo_van',
  LARGE_CARGO_VAN:       'regular_cargo_van',
  EXTRA_LARGE_CARGO_VAN: 'regular_cargo_van',
  // Step vans (DOT-regulated)
  STEP_VAN_SMALL:        'step_van_dot',
  STEP_VAN_MEDIUM:       'step_van_dot',
  STEP_VAN_LARGE:        'step_van_dot',
  // Custom delivery vans (purpose-built — Rivian-style)
  CUSTOM_DELIVERY_VAN_FOURTEEN_FT: 'custom_delivery_van',
  CUSTOM_DELIVERY_VAN_SIXTEEN_FT:  'custom_delivery_van',
  CUSTOM_DELIVERY_VAN:             'custom_delivery_van',
  CDV:                             'custom_delivery_van',
  // Box trucks (AMXL — Amazon Extra-Large)
  BOX_TRUCK:             'box_truck_dot',
  AMXL:                  'box_truck_dot',
  EXTRA_LARGE_BOX_TRUCK: 'box_truck_dot',
  // EV (Rivian)
  RIVIAN_EDV:            'electric_vehicle',
  RIVIAN:                'electric_vehicle',
  ELECTRIC_VEHICLE:      'electric_vehicle',
};

export function mapVehicleClass(serviceTier) {
  if (!serviceTier) {
    return { value: 'regular_cargo_van', source: 'default-empty' };
  }
  const upper = String(serviceTier).toUpperCase().trim();

  // 1. Exact match against the explicit table (preferred — auditable).
  if (SERVICE_TIER_EXPLICIT[upper] !== undefined) {
    return { value: SERVICE_TIER_EXPLICIT[upper], source: 'exact' };
  }

  // 2. Substring fallback for new variants Amazon hasn't told us about.
  //    Order matters: BOX_TRUCK first (could otherwise match CARGO_VAN
  //    if Amazon ever invents BOX_TRUCK_CARGO_VAN), then specific tokens.
  if (upper.includes('BOX_TRUCK') || upper.includes('BOXTRUCK') || upper.includes('AMXL')) {
    return { value: 'box_truck_dot', source: 'substring' };
  }
  if (upper.includes('STEP_VAN') || upper.includes('STEPVAN')) {
    return { value: 'step_van_dot', source: 'substring' };
  }
  if (upper.includes('CUSTOM_DELIVERY') || upper.includes('CDV')) {
    return { value: 'custom_delivery_van', source: 'substring' };
  }
  if (upper.includes('RIVIAN') || upper.includes('ELECTRIC') || upper.includes('EV_') || upper.startsWith('EV')) {
    return { value: 'electric_vehicle', source: 'substring' };
  }
  if (upper.includes('CARGO_VAN') || upper.includes('CARGOVAN')) {
    return { value: 'regular_cargo_van', source: 'substring' };
  }

  // 3. Unknown — flag it so the UI can warn the user before applying.
  return { value: 'regular_cargo_van', source: 'fallback-unknown' };
}

/**
 * Map Amazon's ownershipType strings to Nova Fora ownership enum values.
 * Values mirror Amazon Cortex verbatim so the form shows the same label
 * the DSP saw in their portal.
 *
 *   AMAZON_OWNED  → amazon_owned   (Amazon owns; carries DOT + Prime decals)
 *   AMAZON_LEASED → amazon_leased  (Amazon leases from FMC; same decals)
 *   DSP_OWNED     → dsp_owned      (DSP owns outright; no Amazon decals)
 *   RENTAL        → rental         (DSP rents from third party; no decals)
 */
const OWNERSHIP_TYPE_EXPLICIT = {
  AMAZON_OWNED:   'amazon_owned',
  AMAZON_LEASED:  'amazon_leased',
  DSP_OWNED:      'dsp_owned',
  DSP_LEASED:     'rental',         // some Cortex variants
  RENTAL:         'rental',
};

export function mapOwnership(ownershipType) {
  if (!ownershipType) {
    return { value: 'amazon_owned', source: 'default-empty' };
  }
  const upper = String(ownershipType).toUpperCase().trim();
  if (OWNERSHIP_TYPE_EXPLICIT[upper] !== undefined) {
    return { value: OWNERSHIP_TYPE_EXPLICIT[upper], source: 'exact' };
  }
  // Substring fallback for new variants
  if (upper.includes('DSP_OWNED'))                        return { value: 'dsp_owned', source: 'substring' };
  if (upper.includes('RENTAL') || upper.includes('LEASE') && upper.includes('DSP')) {
    return { value: 'rental', source: 'substring' };
  }
  if (upper.includes('AMAZON') && upper.includes('LEASE')) return { value: 'amazon_leased', source: 'substring' };
  if (upper.includes('AMAZON'))                           return { value: 'amazon_owned', source: 'substring' };
  return { value: 'amazon_owned', source: 'fallback-unknown' };
}


/**
 * Map Amazon's `vehicleProvider` to a clean FMC label. Amazon mostly uses
 * uppercase short codes ('LP', 'ELEMENT'); we render them in a friendlier
 * form so the vehicle form shows 'Element', 'LP', 'Budget', 'Penske'.
 * Anything we don't recognize passes through with leading-cap formatting.
 */
const FMC_DISPLAY_OVERRIDES = {
  LP: 'LP',                        // keep all-caps acronym
  WHEELS: 'Wheels',
  ELEMENT: 'Element',
  HOLMAN: 'Holman',
  BUDGET: 'Budget',
  PENSKE: 'Penske',
  ENTERPRISE: 'Enterprise',
  ARI: 'ARI',                      // Holman ARI
  MERCHANTS: 'Merchants',
};

export function mapFmc(vehicleProvider) {
  if (vehicleProvider == null || vehicleProvider === '') return null;
  const s = String(vehicleProvider).trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (FMC_DISPLAY_OVERRIDES[upper]) return FMC_DISPLAY_OVERRIDES[upper];
  // Title-case fallback: "PENSKE" → "Penske", "rented/owned" → "Rented/Owned"
  return s
    .split(/(\s|\/|-)/)
    .map((part) => (
      /[\s/\-]/.test(part)
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    ))
    .join('');
}


/**
 * Locate each canonical NF field in an Amazon header row. Returns a map
 * { canonicalName: columnIndex } and a list of missing required columns.
 */
export function detectColumns(headerRow) {
  const indices = {};
  const lowered = headerRow.map(norm);

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (let i = 0; i < lowered.length; i++) {
      if (aliases.includes(lowered[i])) {
        indices[field] = i;
        break;
      }
    }
  }

  const required = ['vin', 'fleetId', 'plate', 'make', 'model', 'year'];
  const missing = required.filter((f) => indices[f] === undefined);
  return { indices, missing };
}


/**
 * Parse one data row into a (mappedRow, error) pair. mappedRow matches
 * the BulkVehicleRow schema on the API. error is a string when the row
 * can't be salvaged (caller renders it next to the row in the delta UI).
 */
export function parseRow(rawRow, indices) {
  const get = (field) => {
    const i = indices[field];
    return i === undefined ? undefined : rawRow[i];
  };
  const trim = (v) => (v == null ? '' : String(v).trim());

  const vin = trim(get('vin')).toUpperCase();
  const fleetId = trim(get('fleetId'));
  const plate = trim(get('plate'));
  const make = trim(get('make'));
  const model = trim(get('model'));
  const subModel = trim(get('subModel'));
  const yearRaw = get('year');
  const status = trim(get('status'));

  // Skip rows that look like blank padding
  if (!vin && !fleetId && !plate) return { skip: true };

  // Validate required fields
  const errors = [];
  if (!vin)              errors.push('vin missing');
  if (!fleetId)          errors.push('vehicleName missing');
  if (!plate)            errors.push('licensePlateNumber missing');
  if (!make)             errors.push('make missing');
  if (!model)            errors.push('model missing');

  // VIN format check (no I/O/Q, exactly 17 chars, A-Z 0-9)
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    errors.push(`VIN ${vin!=null?vin:''} invalid (17 chars, no I/O/Q)`);
  }

  // Year: int between 1980 and 2100. Excel sometimes hands us strings.
  let year = null;
  if (yearRaw !== undefined && yearRaw !== null && yearRaw !== '') {
    const n = typeof yearRaw === 'number' ? yearRaw : parseInt(String(yearRaw), 10);
    if (Number.isFinite(n) && n >= 1980 && n <= 2100) year = n;
    else errors.push(`year ${yearRaw!=null?yearRaw:''} invalid`);
  } else {
    errors.push('year missing');
  }

  // Skip rows whose status says they're decommissioned — Amazon usually
  // omits them but be safe.
  if (status && !['active', 'in_service', ''].includes(status.toLowerCase())) {
    errors.push(`status ${status!=null?status:''} not active — skip`);
    return { skip: true, error: errors.join('; ') };
  }

  if (errors.length) {
    return {
      error: errors.join('; '),
      // partial info for UI display
      raw: { vin, fleetId, plate, make, model },
    };
  }

  // Combine model + subModel into one display string when subModel is short
  const fullModel = subModel && subModel.length <= 60 && !model.includes(subModel)
    ? `${model} ${subModel}`.slice(0, 100)
    : model.slice(0, 100);

  const serviceTierRaw = trim(get('serviceTier'));
  const ownershipTypeRaw = trim(get('ownershipType'));
  const vcMapping = mapVehicleClass(serviceTierRaw);
  const ownMapping = mapOwnership(ownershipTypeRaw);

  return {
    row: {
      fleetId,
      vin,
      plate: plate.toUpperCase(),
      year,
      make,
      model: fullModel,
      mileage: 0,
      vehicleClass: vcMapping.value,
      ownership: ownMapping.value,
      fmc: mapFmc(get('vehicleProvider')),
    },
    // Display-only metadata that the delta UI uses to show the user
    // exactly which Cortex value drove each NF assignment, plus a
    // confidence flag (`exact` / `substring` / `fallback-unknown`)
    // so they can spot mis-mapped rows before applying.
    meta: {
      serviceTier: serviceTierRaw,
      vehicleClassSource: vcMapping.source,
      ownershipType: ownershipTypeRaw,
      ownershipSource: ownMapping.source,
      vehicleProvider: trim(get('vehicleProvider')),
    },
  };
}


/**
 * High-level: parse a 2D array of cell values (header + data rows) and
 * return { mapped: [...], errors: [...], skipped: int, missingColumns: [...] }.
 */
export function parseFleetSheet(rows) {
  if (!rows || rows.length < 2) {
    return {
      mapped: [],
      errors: [],
      skipped: 0,
      missingColumns: ['(no rows)'],
    };
  }
  const [header, ...data] = rows;
  const { indices, missing } = detectColumns(header);
  if (missing.length) {
    return { mapped: [], errors: [], skipped: 0, missingColumns: missing };
  }

  const mapped = [];
  const errors = [];
  let skipped = 0;
  data.forEach((r, i) => {
    const result = parseRow(r, indices);
    if (result.skip) {
      skipped += 1;
      if (result.error) errors.push({ rowIndex: i + 2, error: result.error });
      return;
    }
    if (result.error) {
      errors.push({ rowIndex: i + 2, error: result.error, raw: result.raw });
      return;
    }
    mapped.push({ ...result.row, _meta: result.meta, _rowIndex: i + 2 });
  });

  return { mapped, errors, skipped, missingColumns: [] };
}
