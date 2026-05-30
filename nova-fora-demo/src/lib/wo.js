/**
 * Work-order display helpers — single source of truth for "what does
 * the user see when we refer to a WO".
 *
 * Per Jorge 2026-05-29: the internal WO id (WO-XXXXX) is being
 * deprecated as a user-facing handle. The canonical handle is the
 * vendor's RO# (the Repair Order number the Service Writer enters at
 * accept time). UI should show RO# everywhere; `wo.id` stays only as
 * a last-resort fallback when no RO has been attached yet (e.g. before
 * /accept runs or generates the TBD-{id} placeholder).
 *
 * Backend side: `GET /work-orders/by-ro/{ro_number}` is the matching
 * canonical lookup. The internal `/work-orders/{wo_id}` route is still
 * supported for API-internal use (lifecycle endpoints take wo.id) but
 * is no longer what users see.
 *
 * Replaces the four near-identical local copies of `primaryRo()` that
 * used to live in CustomerDashboard / ServiceWriterDashboard /
 * SwWoModal / VanDetailModal, plus the local `primaryRoLabel()` in
 * ServiceWriterDashboard.
 */

/**
 * Return the primary `WorkOrderRo` row for a WO, or null.
 *
 * List endpoints surface a compact `primary_ro` snapshot inline; detail
 * endpoints expose the full `ros` array. We prefer the inline snapshot
 * so list rows don't need a detail fetch. If neither is present (no RO
 * attached yet), returns null and callers fall back to `wo.id`.
 */
export function primaryRo(wo) {
  if (wo?.primaryRo) return wo.primaryRo;
  if (Array.isArray(wo?.ros) && wo.ros.length > 0) {
    return wo.ros.find((r) => r.isPrimary) || wo.ros[0];
  }
  return null;
}

/**
 * Canonical user-facing label for a WO. Use this anywhere you'd
 * otherwise show `wo.id`.
 *
 * Fallback chain: `primaryRo.roNumber → wo.id → '—'`.
 */
export function primaryRoLabel(wo) {
  return primaryRo(wo)?.roNumber || wo?.id || '—';
}
