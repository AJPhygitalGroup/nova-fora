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
export default function CheckoutVehiclesModal({ open, items, returnedItems = [], loading, onClose }) {
  // RealDVIC already dedupes by vehicle before passing in. Just sort:
  // most-recent first for each group.
  const sortedAtShop = useMemo(() => {
    return [...(items || [])].sort((a, b) => {
      const ta = new Date(a?.pickedUpAt || a?.primaryRo?.scheduledStartAt || 0).getTime();
      const tb = new Date(b?.pickedUpAt || b?.primaryRo?.scheduledStartAt || 0).getTime();
      return tb - ta;
    });
  }, [items]);
  const sortedReturned = useMemo(() => {
    return [...(returnedItems || [])].sort((a, b) => {
      const ta = new Date(a?.returnedAt || 0).getTime();
      const tb = new Date(b?.returnedAt || 0).getTime();
      return tb - ta;
    });
  }, [returnedItems]);

  const totalCount = sortedAtShop.length + sortedReturned.length;

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
              <h3 className="text-base font-semibold text-white">Vehicle custody log</h3>
              <p className="text-xs text-navy-400">
                Every van in motion right now — currently at a vendor shop, or returned within the last 24h with handoff photos from each leg.
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

        {/* Sectioned body — "Checked out" (vendor has the van) and
            "Checked in" (returned within 24h). Both render the same row
            shape via DspCheckoutRow so the customer scans by van first,
            state second. */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-4">
          {loading && totalCount === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="text-accent-blue animate-spin" />
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle size={20} className="text-navy-500 mb-2" />
              <p className="text-sm text-navy-300">No vans in vendor custody right now.</p>
              <p className="text-[11px] text-navy-500 mt-1">
                When a vendor's tech picks up one of your vehicles for repair, it will appear here.
              </p>
            </div>
          ) : (
            <>
              {/* AT VENDOR — checked out, still at shop */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-accent-blue"></span>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-navy-400">
                    Checked out · at vendor shop
                  </h4>
                  <span className="text-[11px] text-navy-500">· {sortedAtShop.length}</span>
                </div>
                {sortedAtShop.length === 0 ? (
                  <p className="text-[11px] text-navy-500 italic px-2 py-1.5">
                    No vans currently with vendors.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sortedAtShop.map((wo) => (
                      <DspCheckoutRow key={wo.id} wo={wo} state="checkedOut" />
                    ))}
                  </div>
                )}
              </section>

              {/* RETURNED — checked in within 24h */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-accent-purple"></span>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-navy-400">
                    Checked in · returned today
                  </h4>
                  <span className="text-[11px] text-navy-500">· {sortedReturned.length}</span>
                </div>
                {sortedReturned.length === 0 ? (
                  <p className="text-[11px] text-navy-500 italic px-2 py-1.5">
                    No vans returned within the last 24 hours.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sortedReturned.map((wo) => (
                      <DspCheckoutRow key={wo.id} wo={wo} state="returned" />
                    ))}
                  </div>
                )}
              </section>
            </>
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

// ─────────────────────────────────────────────────────
// DspCheckoutRow — single row used in both sections.
// state='checkedOut'  → blue accent, "At vendor" badge, pickup photos
// state='returned'    → purple accent, "Returned" badge, both galleries
//                       (pickup so the DSP can compare condition).
// ─────────────────────────────────────────────────────
function DspCheckoutRow({ wo, state }) {
  const isReturned = state === 'returned';
  const accent = isReturned ? 'accent-purple' : 'accent-blue';
  const stamp = isReturned
    ? { label: 'Returned', at: wo.returnedAt, by: wo.returnedByName || wo.assignedTechnicianName }
    : { label: 'Picked up', at: wo.pickedUpAt, by: wo.pickedUpByName || wo.assignedTechnicianName };

  return (
    <div className="rounded-lg border border-navy-700 bg-navy-800/40 p-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Truck size={14} className={`text-${accent} shrink-0`} />
          <span className="font-semibold text-white truncate">
            Van {wo.vehicleFleetId || wo.vehicleIdStr || wo.vehicleId || '—'}
          </span>
          <span className="text-[10px] text-navy-500 font-mono shrink-0">
            {primaryRoLabel(wo)}
          </span>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-${accent}/15 text-${accent} border border-${accent}/40 shrink-0`}>
          {isReturned ? 'Returned' : 'At vendor'}
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
          <span className="text-white truncate">{stamp.by || '—'}</span>
        </div>
        <div className="flex items-center gap-1.5 sm:col-span-2">
          <Clock size={11} className="text-navy-500 shrink-0" />
          <span className="text-navy-500">{stamp.label}:</span>
          <span className="text-white">{relativeTime(stamp.at)}</span>
          {stamp.at && (
            <span className="text-navy-500 ml-1">
              ({new Date(stamp.at).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })})
            </span>
          )}
        </div>
      </div>

      {/* PICKUP photo gallery — visible on both states so the DSP can
          compare condition at handoff vs return. */}
      {Array.isArray(wo.vehicleArrivalPhotos) && wo.vehicleArrivalPhotos.length > 0 && (
        <PhotoGallery
          photos={wo.vehicleArrivalPhotos}
          label="Pickup photos"
          accent="accent-blue"
        />
      )}

      {/* RETURN photo gallery — only when checked back in. Different
          accent so the eye separates them. */}
      {isReturned && Array.isArray(wo.vehicleReturnPhotos) && wo.vehicleReturnPhotos.length > 0 && (
        <PhotoGallery
          photos={wo.vehicleReturnPhotos}
          label="Return photos"
          accent="accent-purple"
        />
      )}
    </div>
  );
}

function PhotoGallery({ photos, label, accent }) {
  return (
    <div className="mt-2 pt-2 border-t border-navy-700/40">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Camera size={11} className={`text-${accent}`} />
        <span className="text-[10px] uppercase tracking-wide font-semibold text-navy-400">
          {label} · {photos.length}
        </span>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
        {photos.map((ph) => (
          <a
            key={ph.id}
            href={ph.url}
            target="_blank"
            rel="noreferrer"
            className={`aspect-square rounded-md overflow-hidden border border-navy-700 hover:border-${accent}/60 transition-colors`}
            title={ph.caption || label}
          >
            <img src={ph.url} alt={ph.caption || label} className="w-full h-full object-cover" loading="lazy" />
          </a>
        ))}
      </div>
    </div>
  );
}
