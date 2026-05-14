/**
 * V2.0 → V1-shape adapter for WorkOrders.jsx.
 *
 * Why this exists: PR 7 of the WO V2.0 rebuild swaps the backend shape
 * underneath an already-i18n'd, polished UI. Rather than rewrite the
 * component, we adapt the V2.0 response down to the V1-compatible shape
 * the existing render code already knows, plus translate V1 action
 * intents back up to V2.0 endpoint calls.
 *
 * What's preserved:
 *   - Visual layout, status badges (mapped), filters, modal flows.
 *   - i18n (translations are keyed on V1 statuses; we feed them V1 keys).
 *   - The component's pubsub / live-update behaviour.
 *
 * What's lost / N/A in v2.0:
 *   - `scheduledAt` (V2.0 has no schedule slot at the WO level).
 *   - `partsCost` / `laborCost` (V2.0 carries cost on line_items).
 *   - `fmc` field (V2.0 doesn't track FMC on the WO).
 *   - The 'pending_fmc' status (collapsed into pending_acceptance).
 *   - Photos count (V2.0 work_order_photos isn't wired yet on this branch).
 *
 * These come back when their UI is built in subsequent PRs (line items
 * editor, ROs manager, review queue). See docs/wo-v2-rebuild.md.
 */

// ─────────────────────────────────────────────────────
// Status mapping (V2.0 → the V1 enum the UI is built around)
// ─────────────────────────────────────────────────────
export const STATUS_V2_TO_V1 = {
  pending_acceptance: 'pending',
  accepted:           'acknowledged',
  in_progress:        'in_progress',
  completed:          'completed',
  cancelled:          'canceled',  // sic — V1 spelled it 'canceled'
  declined:           'declined',
};

// And the reverse, for any rare place that needs it
export const STATUS_V1_TO_V2 = Object.fromEntries(
  Object.entries(STATUS_V2_TO_V1).map(([k, v]) => [v, k])
);

// ─────────────────────────────────────────────────────
// Vehicle prefix helpers (frontend ID convention)
// ─────────────────────────────────────────────────────
function vehiclePrefixedId(v) {
  if (!v) return null;
  if (typeof v.idStr === 'string') return v.idStr;
  if (typeof v.id_str === 'string') return v.id_str;
  if (v.fleetId) return v.fleetId;
  if (typeof v.id === 'number') return `VAN-${String(v.id).padStart(4, '0')}`;
  return String(v.id ?? '?');
}

function dspPrefixedId(dspId) {
  if (!dspId && dspId !== 0) return null;
  return `DSP-${String(dspId).padStart(4, '0')}`;
}

// ─────────────────────────────────────────────────────
// Core adapter
// ─────────────────────────────────────────────────────
/**
 * Produce a V1-compatible WO object from a V2.0 WO response.
 *
 * @param {object} wo         — V2.0 WorkOrder (list or detail shape)
 * @param {object} [ctx]      — optional caches resolved by the component
 * @param {object} [ctx.vehiclesById]   — { [v2Id]: vehicleObj }
 * @param {object} [ctx.workshopsById]  — { [v2Id]: workshopObj }
 * @param {object} [ctx.usersById]      — { [v2Id]: userObj }
 */
export function adaptWO(wo, ctx = {}) {
  const vehicle  = ctx.vehiclesById?.[wo.vehicleId]  || null;
  const workshop = ctx.workshopsById?.[wo.vendorWorkshopId] || null;
  const tech     = wo.assignedTechnicianId
    ? ctx.usersById?.[wo.assignedTechnicianId] || null
    : null;

  // Build flags from V2.0 booleans
  const flags = [];
  if (wo.isRush)  flags.push('rush_order');
  if (wo.isStale) flags.push('stale');

  // Derive section + part + description from the first line item if any.
  // Line items are only present on the detail endpoint; in list mode we
  // fall back to a soft placeholder.
  const lineItems = wo.lineItems || [];
  const firstLi   = lineItems[0] || null;
  let section = '';
  let part    = lineItems.length > 1 ? 'Multiple items' : '';
  let description = '';
  if (firstLi) {
    description = firstLi.description || '';
    // generate_line_items_on_accept formats descriptions as "part — defect_type"
    const dashSplit = description.split(' — ');
    if (dashSplit.length >= 1) part = dashSplit[0].replace(/_/g, ' ');
    // We don't have section in the model — leave blank rather than fake
  }
  if (lineItems.length > 1) {
    description = `${lineItems.length} items · ${description || 'multi-line WO'}`;
  }

  // Primary RO (or first attached, or N/A)
  const ros = wo.ros || [];
  const primaryRo = ros.find((r) => r.isPrimary) || ros[0] || null;

  // Notes — V2.0 has author_role + body; V1 was string array.
  // Stringify so the existing renderer still works without churn.
  const notes = (wo.notes || []).map((n) =>
    typeof n === 'string' ? n : (n.body || '')
  );

  return {
    // Identity
    id: wo.id,
    status: STATUS_V2_TO_V1[wo.status] || wo.status,
    flags,

    // Parties / vehicle.
    // V2.0 backend now returns denormalized labels on the WO row (dspName,
    // vehicleFleetId, vehiclePlate, vehicleIdStr, workshopName, etc.) so
    // vendor / tech scopes don't need access to the full vehicles + dsp
    // lists. Fall back to the cache lookups (admin views), then to ID
    // prefixes so a never-resolved value still renders something.
    dspId:     vehicle ? dspPrefixedId(vehicle.dspId) : dspPrefixedId(wo.dspId),
    dspName:   wo.dspName || vehicle?.dspName || 'Customer DSP',
    vehicleId: wo.vehicleIdStr
      || (vehicle ? vehiclePrefixedId(vehicle) : `VAN-${wo.vehicleId}`),
    plate:     wo.vehiclePlate || vehicle?.plate || '—',
    fleetId:   wo.vehicleFleetId || vehicle?.fleetId || null,
    // Prefer the denorm fields the detail endpoint now ships (vehicleYear,
    // vehicleMake, etc.) so the vendor-side WO card renders the right
    // year/make/model/VIN/FMC/mileage without a second /vehicles call.
    year:      wo.vehicleYear  ?? vehicle?.year  ?? '',
    make:      wo.vehicleMake  ||  vehicle?.make  || '',
    model:     wo.vehicleModel ||  vehicle?.model || '',
    vin:       wo.vehicleVin   ||  vehicle?.vin   || '',

    // Vendor / workshop
    vendorId:   workshop?.organizationId
      ? `V-${String(workshop.organizationId).padStart(3, '0')}`
      : null,
    vendorName: wo.workshopName || workshop?.name || null,
    statusTrackingMode: wo.statusTrackingMode || null,

    // Work description (from line items)
    section,
    part,
    description: description || (firstLi?.description || ''),

    // People
    assignedTechnician: wo.assignedTechnicianName
      || tech?.fullName
      || tech?.name
      || null,
    // Pulled from the first defect's reported_by on the detail response —
    // good enough for the "who reported this" slot on the vendor card.
    // For multi-defect WOs we surface the FULL list in `defects` below.
    reportedBy: wo.defects?.[0]?.reportedBy || null,

    // Mileage + commercial
    // On a freshly-created WO, lastMileage is null (no tech reading yet).
    // Fall back to the vehicle's last-known odometer so the vendor sees
    // something reasonable in the "Last Mileage" slot before they Start.
    lastMileage: wo.lastMileage ?? wo.vehicleMileage ?? null,
    partsCost:   null,   // moved to line_items in V2.0
    laborCost:   null,   // moved to line_items in V2.0

    // RO + FMC
    roNumber: primaryRo?.roNumber || 'N/A',
    // FMC denormed onto the WO detail response from the vehicle row.
    fmc:      wo.vehicleFmc || null,

    // Timestamps
    createdAt:    wo.createdAt,
    updatedAt:    wo.updatedAt,
    acceptedAt:   wo.acceptedAt,
    inProgressAt: wo.inProgressAt,
    completedAt:  wo.completedAt,
    cancelledAt:  wo.cancelledAt,
    declinedAt:   wo.declinedAt,
    // scheduledAt is populated below from the new V2.0 column.

    // Reasons
    declinedReason:    wo.declinedReason,
    declineReason:     wo.declinedReason,    // legacy alias used by V1 code
    declineReasonCode: wo.declineReasonCode,
    canceledReason:    wo.cancelledReason,
    cancelReason:      wo.cancelledReason,
    cancelledReason:   wo.cancelledReason,

    // Notes + photos
    notes,
    photos: 0,  // V2.0 work_order_photos integration is future work

    // V2.0 extras the new UI can use
    repairRequestId: wo.repairRequestId,
    vendorWorkshopId: wo.vendorWorkshopId,
    lineItems,
    defectResolutions: wo.defectResolutions || [],
    // Each row: { id, part, defectType, position, source, reportedAt,
    //             reportedBy, notes, photos: [{ id, url, ... }] }
    // Surfaced as-is so the vendor card can render the defect grid + photos.
    defects: wo.defects || [],
    ros,

    // Scheduling + DSP response (PR: scheduled repairs)
    scheduledAt:   wo.scheduledAt   || null,
    repairBucket:  wo.repairBucket  || null,    // 'overnight' | 'shop'
    dspResponse:   wo.dspResponse   || null,    // 'confirmed' | 'not_available'
    dspResponseAt: wo.dspResponseAt || null,
    keyLocation:   wo.keyLocation   || null,
    // Surfaced by the backend so the vendor card can render a "Cancelled
    // by customer" badge and the tech queue can hide the row. True when
    // the DSP was the actor on POST /cancel; vendor cancels stay false.
    cancelledByCustomer: !!wo.cancelledByCustomer,

    // Escape hatch: full raw V2.0 row for any caller that needs it
    _v2: wo,
  };
}

// ─────────────────────────────────────────────────────
// Action remapping — V1 status PATCH → V2.0 endpoint call.
//
// Returns { method, body } where `method` is a workOrders.* method name
// and `body` is the V2.0 request payload.
// ─────────────────────────────────────────────────────
export function mapStatusUpdate(targetStatus, body = {}) {
  switch (targetStatus) {
    case 'acknowledged':
    case 'scheduled':
      // V2.0 collapses these into 'accepted'. Schedule is gone in v2.0.
      return { method: 'accept', body: {} };
    case 'in_progress':
      return { method: 'start', body: {} };
    case 'completed':
      return {
        method: 'complete',
        body: { lastMileage: body.lastMileage ?? body.mileage ?? undefined },
      };
    case 'declined':
      return {
        method: 'decline',
        body: {
          reason: body.declineReason || body.reason,
          // Map V1 numeric code → V2.0 decline_reason_code string.
          declineReasonCode: V1_DECLINE_CODE_TO_V2[body.declineReasonCode]
            || body.declineReasonCode
            || 'other',
          reroute: body.reroute !== false,
        },
      };
    case 'canceled':
    case 'cancelled':
      return { method: 'cancel', body: { reason: body.cancelReason || body.reason } };
    default:
      throw new Error(`Unsupported status transition target: ${targetStatus}`);
  }
}

// V1 had numeric codes 1-4 (WO_DECLINE_REASONS in mockData.js).
// Map to the V2.0 decline_reason_codes lookup table from PR 1.
export const V1_DECLINE_CODE_TO_V2 = {
  1: 'parts_unavailable',     // "Lacking required parts or tools"
  2: 'specialty_required',    // "Work is outside the scope of contract"
  3: 'out_of_warranty',       // "Work was already completed or defect is not present"
  4: 'cost_too_high',         // "Work is declined by the customer"
};
