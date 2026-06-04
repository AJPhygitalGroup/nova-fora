/**
 * CheckoutVehiclesModal — DSP-side view of "vans currently at shops".
 *
 * Opens from the "Checkout Vehicles" KPI tile on the DSP customer home
 * (RealDVIC.jsx). Shows every WO whose `status === 'in_progress'` for
 * the caller's DSP — those are the vans physically with a vendor right
 * now.
 *
 * Phase A (this commit, 2026-06-02): renders metadata-only — fleet id,
 * vendor workshop, assigned tech name, scheduled pickup time, current
 * status. No photos yet.
 *
 * Phase B (next session): tech-side capture flow stamps the actual
 * pickup time + photos at handoff. A new
 * `POST /work-orders/{id}/checkout` will mint `WorkOrderPhoto` rows
 * with stage `pickup_handoff`. Once that ships, swap the placeholder
 * here for the photo grid.
 *
 * Lives in its own file (vs inlined in RealDVIC.jsx) to keep that file
 * from growing further — RealDVIC.jsx is already the tester critique's
 * #1 example of a god module.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  X, Truck, Wrench, Clock, Camera, MapPin, Loader2, AlertCircle,
} from 'lucide-react';
import { primaryRoLabel } from '../../lib/wo';

// ─────────────────────────────────────────────────────
// Status pill — maps the WO's compound state to a friendly customer
// label. The internal WO status is `in_progress` for every row in
// this modal; the variation surfaces from the primary RO sync flags.
// ─────────────────────────────────────────────────────
function deriveCustomerStatus(wo) {
  const ro = wo?.primaryRo || (Array.isArray(wo?.ros) ? wo.ros.find((r) => r.isPrimary) : null);
  if (!ro) return { label: 'In repair', color: 'accent-blue' };
  if (ro.partsOrderedAt && !ro.partsReceivedAt) return { label: 'Waiting on parts', color: 'accent-orange' };
  if (ro.submittedToFmcAt && !ro.fmcApprovedAt) return { label: 'Awaiting FMC approval', color: 'accent-purple' };
  return { label: 'In repair', color: 'accent-blue' };
}

function relativeTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 0) return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────
export default function CheckoutVehiclesModal({ open, items, loading, onClose }) {
  const sorted = useMemo(() => {
    // Jorge 2026-06-03: dedupe by vehicle. The /checkout endpoint
    // fan-outs picked_up_at to every accepted sibling WO on the
    // vehicle, so a van with 3 WOs would otherwise render 3 times.
    // From the customer's perspective the unit is "the van" — they
    // want one row that summarises "Dulles Midas has my Van 12 since
    // 6m ago", not three rows of the same van.
    //
    // Pick a canonical WO per vehicle: prefer one with photos (so
    // the gallery renders for at least one of them), then highest
    // defectCount (richer row), then oldest pickup (sticks around).
    const byVehicle = new Map();
    for (const wo of (items || [])) {
      const key = wo?.vehicleId || wo?.vehicleIdStr || wo?.id;
      const cur = byVehicle.get(key);
      if (!cur) { byVehicle.set(key, wo); continue; }
      const score = (w) => (
        ((Array.isArray(w?.vehicleArrivalPhotos) && w.vehicleArrivalPhotos.length) ? 1000 : 0)
        + (w?.defectCount ?? w?.defects?.length ?? 0)
      );
      if (score(wo) > score(cur)) byVehicle.set(key, wo);
    }
    // Most-recently picked up first.
    return Array.from(byVehicle.values()).sort((a, b) => {
      const ta = new Date(a?.pickedUpAt || a?.primaryRo?.scheduledStartAt || a?.scheduledStartAt || a?.updatedAt || 0).getTime();
      const tb = new Date(b?.pickedUpAt || b?.primaryRo?.scheduledStartAt || b?.scheduledStartAt || b?.updatedAt || 0).getTime();
      return tb - ta;
    });
  }, [items]);

  if (!open) return null;

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
              <h3 className="text-base font-semibold text-white">Vans currently at shops</h3>
              <p className="text-xs text-navy-400">
                Every vehicle from your fleet that a vendor has picked up for repair, with the assigned tech + pickup time.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-navy-400 hover:text-white p-2 -mr-2"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Phase B note (2026-06-02): photos now flow from the
            vendor/tech checkout workflow. The placeholder banner shipped
            in Phase A is gone — rows that have photos render the grid
            inline; rows without (older WOs that pre-date the checkout
            feature) just don't show the section. */}

        {/* List */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-2">
          {loading && sorted.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="text-accent-blue animate-spin" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle size={20} className="text-navy-500 mb-2" />
              <p className="text-sm text-navy-300">No vans currently at shops.</p>
              <p className="text-[11px] text-navy-500 mt-1">
                When a vendor's tech picks up one of your vehicles for repair, it will appear here.
              </p>
            </div>
          ) : (
            sorted.map((wo) => {
              const ro = wo?.primaryRo || (Array.isArray(wo?.ros) ? wo.ros.find((r) => r.isPrimary) : null);
              const pickedUpAt = ro?.scheduledStartAt || wo?.scheduledStartAt || wo?.inProgressAt;
              const status = deriveCustomerStatus(wo);
              return (
                <div
                  key={wo.id}
                  className="rounded-lg border border-navy-700 bg-navy-800/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Truck size={14} className="text-accent-blue shrink-0" />
                      <span className="font-semibold text-white truncate">
                        Van {wo.vehicleFleetId || wo.vehicleIdStr || wo.vehicleId || '—'}
                      </span>
                      <span className="text-[10px] text-navy-500 font-mono shrink-0">
                        {primaryRoLabel(wo)}
                      </span>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-${status.color}/15 text-${status.color} border border-${status.color}/40 shrink-0`}>
                      {status.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-navy-300">
                    <div className="flex items-center gap-1.5">
                      <MapPin size={11} className="text-navy-500 shrink-0" />
                      <span className="text-navy-500">Shop:</span>
                      <span className="text-white truncate">{wo.workshopName || '—'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Wrench size={11} className="text-navy-500 shrink-0" />
                      <span className="text-navy-500">Tech:</span>
                      <span className="text-white truncate">
                        {wo.pickedUpByName || wo.assignedTechnicianName || '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 sm:col-span-2">
                      <Clock size={11} className="text-navy-500 shrink-0" />
                      <span className="text-navy-500">Picked up:</span>
                      <span className="text-white">{relativeTime(wo.pickedUpAt || pickedUpAt)}</span>
                      {(wo.pickedUpAt || pickedUpAt) && (
                        <span className="text-navy-500 ml-1">
                          ({new Date(wo.pickedUpAt || pickedUpAt).toLocaleString(undefined, {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Vehicle arrival photos — present only if the
                      vendor/tech captured them at checkout (Phase B,
                      commit 2026-06-02). Clicking a thumb opens the
                      full-size in a new tab. */}
                  {Array.isArray(wo.vehicleArrivalPhotos) && wo.vehicleArrivalPhotos.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-navy-700/40">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Camera size={11} className="text-accent-blue" />
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-navy-400">
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
                            <img src={ph.url} alt={ph.caption || 'Pickup'} className="w-full h-full object-cover" loading="lazy" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-navy-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-navy-800 hover:bg-navy-700 text-white border border-navy-700 cursor-pointer"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
