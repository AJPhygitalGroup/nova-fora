/**
 * VendorCheckoutModal — vendor-side mirror of CheckoutVehiclesModal.
 *
 * Opens from the "Vehicles to Check Out" KPI tile on VendorHome. Lists
 * every accepted WO for the workshop deduped by vehicle (because the
 * /checkout fan-out hits all sibling WOs on the same van anyway —
 * showing the same van 3 times if it has 3 ROs would be confusing).
 *
 * Sectioned by schedule state — same affordance as the inline
 * CheckoutPanel in SwWoActions:
 *   • "Scheduled" — DSP confirmed pickup window. Happy path.
 *     Green "Check out" CTA per row.
 *   • "No schedule yet" — accepted but no scheduled_start_at. Lets the
 *     tech check out an ad-hoc / drop-in pickup. Outlined blue CTA.
 *   • "Already picked up" — picked_up_at set. Read-only row with the
 *     stamp + photo grid mirrored from the DSP view.
 *
 * Clicking a CTA opens the existing CheckoutModal — same capture flow
 * the inline panel uses. After success: re-fetch the list so the row
 * moves into "Already picked up".
 *
 * Per Jorge 2026-06-03: this is the canonical entry point. The inline
 * panel in VanDetailView still works for the case where the tech is
 * already deep in a van's detail page.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  X, Truck, Wrench, Clock, Camera, MapPin, Loader2, AlertCircle, Check,
} from 'lucide-react';
import { workOrders as woApi } from '../../api/client';
import { primaryRoLabel } from '../../lib/wo';
import CheckoutModal from './CheckoutModal';

// ─────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 0) {
    // Future — usually a scheduled_start_at not yet reached.
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fleetLabel(wo) {
  return wo.vehicleFleetId || wo.vehicleIdStr || `Van ${wo.vehicleId || '—'}`;
}

// ─────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────
export default function VendorCheckoutModal({ workshopId, onClose, onChanged }) {
  const [acceptedRows, setAcceptedRows] = useState([]);
  const [inProgressRows, setInProgressRows] = useState([]);
  const [returnedRows, setReturnedRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  // Active capture modal — { wo, mode: 'checkout'|'checkin' } or null.
  const [openCapture, setOpenCapture] = useState(null);

  const load = useCallback(() => {
    if (!workshopId) return;
    setLoading(true);
    setErr(null);
    // Three list calls — the API doesn't have a single "all custody-
    // adjacent WOs" filter, and each role/status combination has its
    // own backend predicate. Run in parallel so the modal opens fast.
    //
    //   accepted     → not yet picked up + unscheduled/scheduled buckets
    //   in_progress  → at the shop (catches both legacy in_progress and
    //                  accepted+pickedUp via at_shop_custody=true)
    //   returned     → checked back in within last 24h
    Promise.all([
      woApi.list({ status: 'accepted', vendorWorkshopId: workshopId, limit: 200 }),
      woApi.list({ atShopCustody: true, vendorWorkshopId: workshopId, limit: 200 }),
      woApi.list({ returnedWithinHours: 24, vendorWorkshopId: workshopId, limit: 200 }),
    ])
      .then(([accRes, progRes, retRes]) => {
        setAcceptedRows(Array.isArray(accRes) ? accRes : (accRes?.items || []));
        setInProgressRows(Array.isArray(progRes) ? progRes : (progRes?.items || []));
        setReturnedRows(Array.isArray(retRes) ? retRes : (retRes?.items || []));
      })
      .catch((e) => setErr(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [workshopId]);

  useEffect(() => { load(); }, [load]);

  // Dedupe each section by vehicle — fan-outs across siblings mean the
  // same van shows up N times. Pick the WO most useful to render
  // (photos > most defects). See CheckoutVehiclesModal for the same
  // pattern on the DSP side.
  const dedupe = (list) => {
    const byVehicle = new Map();
    for (const wo of (list || [])) {
      const key = wo.vehicleId || wo.vehicleIdStr || wo.id;
      const cur = byVehicle.get(key);
      if (!cur) { byVehicle.set(key, wo); continue; }
      const score = (w) => (
        ((Array.isArray(w?.vehicleArrivalPhotos) && w.vehicleArrivalPhotos.length) ? 1000 : 0)
        + (w?.defectCount ?? w?.defects?.length ?? 0)
      );
      if (score(wo) > score(cur)) byVehicle.set(key, wo);
    }
    return Array.from(byVehicle.values());
  };

  const { scheduled, unscheduled, atShop, returned } = useMemo(() => {
    // accepted WOs split by whether DSP confirmed schedule. Exclude
    // any already picked up (those slid into the in_progress bucket).
    const acceptedDeduped = dedupe(acceptedRows.filter((w) => !w.pickedUpAt));
    const sortAsc = (a, b) => (
      new Date(a?.primaryRo?.scheduledStartAt || a?.scheduledStartAt || 0).getTime()
      - new Date(b?.primaryRo?.scheduledStartAt || b?.scheduledStartAt || 0).getTime()
    );
    const sortDesc = (a, b) => (
      new Date(b?.pickedUpAt || b?.updatedAt || 0).getTime()
      - new Date(a?.pickedUpAt || a?.updatedAt || 0).getTime()
    );
    // atShop = picked up + not returned. The at_shop_custody filter
    // already excludes returned ones, but belt-and-suspenders here.
    const atShopDeduped = dedupe(inProgressRows.filter((w) => w.pickedUpAt && !w.returnedAt));
    const returnedDeduped = dedupe(returnedRows);
    return {
      scheduled: acceptedDeduped.filter((w) => w?.primaryRo?.scheduledStartAt).sort(sortAsc),
      unscheduled: acceptedDeduped.filter((w) => !w?.primaryRo?.scheduledStartAt).sort(sortDesc),
      atShop: atShopDeduped.sort(sortDesc),
      returned: returnedDeduped.sort((a, b) => (
        new Date(b?.returnedAt || 0).getTime() - new Date(a?.returnedAt || 0).getTime()
      )),
    };
  }, [acceptedRows, inProgressRows, returnedRows]);

  const totalActionable = scheduled.length + unscheduled.length + atShop.length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-12 px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-navy-900 border border-navy-700 rounded-xl w-full max-w-3xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-navy-700">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-accent-blue/15 border border-accent-blue/40 flex items-center justify-center">
              <Truck size={16} className="text-accent-blue" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-strong">Vehicle Check-Out</h3>
              <p className="text-xs text-text-muted">
                {totalActionable > 0
                  ? `${totalActionable} van${totalActionable === 1 ? '' : 's'} ready to pick up.`
                  : 'No vans awaiting checkout right now.'}
                {' '}Snap handoff photos so the DSP sees their vehicle's condition.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-strong p-2 -mr-2"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-[68vh] overflow-y-auto space-y-4">
          {err && (
            <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-xs text-accent-red flex items-center gap-2">
              <AlertCircle size={14} />
              {err}
            </div>
          )}

          {loading && acceptedRows.length === 0 && inProgressRows.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="text-accent-blue animate-spin" />
            </div>
          ) : (
            <>
              <Section
                title="Scheduled · DSP confirmed pickup"
                accent="accent-green"
                items={scheduled}
                ctaLabel="Check out"
                ctaStyle="solid-green"
                ctaMode="checkout"
                emptyHint="No DSP-confirmed pickups waiting."
                onCta={(wo) => setOpenCapture({ wo, mode: 'checkout' })}
              />
              <Section
                title="No schedule yet · ad-hoc / drop-in"
                accent="accent-blue"
                items={unscheduled}
                ctaLabel="Check out anyway"
                ctaStyle="outline-blue"
                ctaMode="checkout"
                emptyHint="No accepted WOs without a schedule."
                onCta={(wo) => setOpenCapture({ wo, mode: 'checkout' })}
              />
              <Section
                title="At your shop · ready to return"
                accent="accent-orange"
                items={atShop}
                ctaLabel="Check in"
                ctaStyle="solid-purple"
                ctaMode="checkin"
                emptyHint="No vans currently in your custody."
                showPhotos
                onCta={(wo) => setOpenCapture({ wo, mode: 'checkin' })}
              />
              <Section
                title="Returned today · drop-off log"
                accent="text-muted"
                items={returned}
                ctaLabel={null}
                emptyHint="No vans returned today."
                showPhotos
                showReturnPhotos
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-navy-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-navy-800 hover:bg-navy-700 text-text-strong border border-navy-700 cursor-pointer"
          >
            Close
          </button>
        </div>
      </motion.div>

      {/* Capture modal — opens on top of this one. On success: reload
          the list so the row jumps section. Mode-aware:
            checkout → tech took the van (writes picked_up_at)
            checkin  → tech returned the van (writes returned_at) */}
      {openCapture && (
        <CheckoutModal
          wo={openCapture.wo}
          mode={openCapture.mode}
          onClose={() => setOpenCapture(null)}
          onSuccess={() => {
            setOpenCapture(null);
            load();
            onChanged?.();
          }}
        />
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────
// Section — one bucket of rows with a header + per-row CTA.
// ─────────────────────────────────────────────────────
function Section({
  title, accent, items, ctaLabel, ctaStyle = 'solid-green', emptyHint,
  ctaMode = 'checkout', onCta, showPhotos = false, showReturnPhotos = false,
}) {
  const CTA_STYLES = {
    'solid-green':   'bg-accent-green text-white hover:bg-accent-green/90',
    'outline-blue':  'border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10',
    'solid-purple':  'bg-accent-purple text-white hover:bg-accent-purple/90',
  };
  const ctaClasses = CTA_STYLES[ctaStyle] || CTA_STYLES['solid-green'];
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full bg-${accent}`}></span>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </h4>
        <span className="text-[11px] text-text-muted/70">· {items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-[11px] text-text-muted italic px-2 py-1.5">{emptyHint}</div>
      ) : (
        <ul className="space-y-2">
          {items.map((wo) => (
            <li
              key={wo.id}
              className="rounded-lg border border-navy-700 bg-navy-800/40 p-3"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Truck size={14} className="text-accent-blue shrink-0" />
                  <span className="font-semibold text-text-strong truncate">
                    Van {fleetLabel(wo)}
                  </span>
                  <span className="text-[10px] text-text-muted/70 font-mono shrink-0">
                    {primaryRoLabel(wo)}
                  </span>
                </div>
                {ctaLabel && (
                  <button
                    type="button"
                    onClick={() => onCta?.(wo)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer shrink-0 ${ctaClasses}`}
                  >
                    <Camera size={12} />
                    {ctaLabel}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-text-muted">
                <div className="flex items-center gap-1.5 min-w-0">
                  <MapPin size={11} className="text-text-muted/70 shrink-0" />
                  <span className="text-text-muted/70">Customer:</span>
                  <span className="text-text-strong truncate">{wo.dspName || '—'}</span>
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <Wrench size={11} className="text-text-muted/70 shrink-0" />
                  <span className="text-text-muted/70">Tech:</span>
                  <span className="text-text-strong truncate">
                    {wo.pickedUpByName || wo.assignedTechnicianName || '— unassigned —'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 sm:col-span-2 min-w-0">
                  <Clock size={11} className="text-text-muted/70 shrink-0" />
                  {wo.returnedAt ? (
                    <>
                      <span className="text-text-muted/70">Returned:</span>
                      <span className="text-text-strong">{relativeTime(wo.returnedAt)}</span>
                      <span className="text-text-muted/70 ml-1">
                        ({new Date(wo.returnedAt).toLocaleString(undefined, {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })})
                      </span>
                    </>
                  ) : wo.pickedUpAt ? (
                    <>
                      <span className="text-text-muted/70">Picked up:</span>
                      <span className="text-text-strong">{relativeTime(wo.pickedUpAt)}</span>
                      <span className="text-text-muted/70 ml-1">
                        ({new Date(wo.pickedUpAt).toLocaleString(undefined, {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })})
                      </span>
                    </>
                  ) : wo?.primaryRo?.scheduledStartAt ? (
                    <>
                      <span className="text-text-muted/70">Scheduled:</span>
                      <span className="text-text-strong">
                        {relativeTime(wo.primaryRo.scheduledStartAt)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-text-muted/70">Schedule:</span>
                      <span className="text-text-strong italic">not yet confirmed by DSP</span>
                    </>
                  )}
                </div>
              </div>

              {/* Pickup photos — visible on "at shop" + "returned" rows */}
              {showPhotos && Array.isArray(wo.vehicleArrivalPhotos) && wo.vehicleArrivalPhotos.length > 0 && (
                <div className="mt-2 pt-2 border-t border-navy-700/40">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Camera size={11} className="text-accent-blue" />
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-text-muted">
                      Pickup photos · {wo.vehicleArrivalPhotos.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                    {wo.vehicleArrivalPhotos.map((ph) => (
                      <a
                        key={ph.id}
                        href={ph.url}
                        target="_blank"
                        rel="noreferrer"
                        className="aspect-square rounded-md overflow-hidden border border-navy-700 hover:border-accent-blue/60 transition-colors"
                        title={ph.caption || 'Pickup photo'}
                      >
                        <img
                          src={ph.url}
                          alt={ph.caption || 'Pickup'}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Return photos — only on rows that have been checked
                  back in. Different accent (purple) so the eye separates
                  the two galleries when both render under the same row. */}
              {showReturnPhotos && Array.isArray(wo.vehicleReturnPhotos) && wo.vehicleReturnPhotos.length > 0 && (
                <div className="mt-2 pt-2 border-t border-navy-700/40">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Camera size={11} className="text-accent-purple" />
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-text-muted">
                      Return photos · {wo.vehicleReturnPhotos.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                    {wo.vehicleReturnPhotos.map((ph) => (
                      <a
                        key={ph.id}
                        href={ph.url}
                        target="_blank"
                        rel="noreferrer"
                        className="aspect-square rounded-md overflow-hidden border border-navy-700 hover:border-accent-purple/60 transition-colors"
                        title={ph.caption || 'Return photo'}
                      >
                        <img
                          src={ph.url}
                          alt={ph.caption || 'Return'}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Status badge — color depends on current custody state */}
              {(showPhotos || showReturnPhotos) && (
                wo.returnedAt ? (
                  <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent-purple/15 border border-accent-purple/40 text-accent-purple text-[10px] font-semibold">
                    <Check size={10} /> Returned · {wo.returnedByName || 'Tech'}
                  </div>
                ) : wo.pickedUpAt ? (
                  <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent-orange/15 border border-accent-orange/40 text-accent-orange text-[10px] font-semibold">
                    <Check size={10} /> At your shop · {wo.pickedUpByName || 'Tech'}
                  </div>
                ) : null
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
