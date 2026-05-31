/**
 * Van detail modal — full-context view for a single WO.
 *
 * Two render modes:
 *   - 'customer' (default for DSP-side tabs): Confirm Pickup form +
 *      $ Approve cost + Approve defects sections + read-only defect list
 *      + collapsible Activity panel.
 *   - 'sw' (vendor-side): pickup-request form, defect defer/mid-find,
 *      internal notes, assigned-technician dropdown. (Wired in
 *      ServiceWriterDashboard's call site.)
 *
 * The modal owns the per-action fetch state so the parent dashboard
 * stays simple — it only handles the list refresh after `onAction()`.
 *
 * Important UX rule from the spec (§7.D): pickup confirmation is
 * VEHICLE-scoped. The endpoint fan-outs to every primary RO on the same
 * vehicle. The button copy reflects that ("Confirm pickup for this van"
 * — not "...for this WO") so the user doesn't mis-model the action.
 */
import { useState, useEffect } from 'react';
import {
  X, Loader2, AlertTriangle, Check, MapPin, Key, MessageSquare,
  CalendarCheck, Truck, DollarSign, ClipboardList, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  workOrders as woApi,
  defects as defectsApi,
} from '../../api/client';
import { primaryRo } from '../../lib/wo';

export default function VanDetailModal({ wo, user, mode = 'customer', onClose, onAction }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-12 px-4">
      <div className="bg-navy-900 border border-navy-700 rounded-xl w-full max-w-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-navy-700">
          <div>
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-text-muted" />
              <h2 className="text-lg font-bold text-text-strong">
                Van {wo.vehicleFleetId || wo.vehicleIdStr || wo.vehicleId}
              </h2>
              {wo.isRush && (
                <span className="px-1.5 py-0.5 text-xs rounded bg-accent-red text-white font-semibold">
                  RUSH
                </span>
              )}
            </div>
            {/* Customer-facing subtitle — only year/make/model + plate.
                Internal VAN-XXXX + WO-NNNNN ids are noise here (the
                customer recognizes the van by fleet number, already in
                the header, and by RO# which lives on the RO card). */}
            <p className="text-xs text-text-muted mt-1">
              {[wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(' ')}
              {wo.vehiclePlate ? ` · Plate ${wo.vehiclePlate}` : ''}
            </p>
            <p className="text-xs text-text-muted">
              {wo.workshopName ? `at ${wo.workshopName}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-strong"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5">
          {mode === 'customer'
            ? <CustomerActions wo={wo} onAction={onAction} />
            : <SwActions wo={wo} onAction={onAction} />}

          <DefectsList wo={wo} />
          <ActivityPanel wo={wo} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Customer (DSP) action card — Confirm pickup form
// ─────────────────────────────────────────────────────
function CustomerActions({ wo, onAction }) {
  const ro = primaryRo(wo);
  const showPickup = ro && ro.pickupType && !ro.scheduledStartAt;
  if (!showPickup) {
    return (
      <div className="rounded-lg border border-navy-700 bg-navy-800/40 px-4 py-3 text-sm text-text-muted">
        No customer actions pending on this work order.
      </div>
    );
  }
  return <ConfirmPickupCard wo={wo} ro={ro} onAction={onAction} />;
}

// ─────────────────────────────────────────────────────
// Confirm Pickup card — the 3-field form from the demo
// ─────────────────────────────────────────────────────
function ConfirmPickupCard({ wo, ro, onAction }) {
  // Default to the SW's proposed slot if they set one via the ScheduleModal
  // (chained schedule + pickup-request). Otherwise fall back to tomorrow
  // 9 AM local — the most common pickup slot per the demo.
  const initialScheduledAt = (() => {
    if (wo?.scheduledAt) {
      // Convert the wire ISO ("...Z") back to a local-tz datetime-local
      // string so the input pre-fills with the SW's proposal in the DSP's
      // own timezone (datetime-local has no tz suffix).
      const d = new Date(wo.scheduledAt);
      if (!Number.isNaN(d.getTime())) {
        const tzOffset = d.getTimezoneOffset() * 60_000;
        return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
      }
    }
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    const tzOffset = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  })();

  const [pickupLocation, setPickupLocation] = useState('');
  const [keyLocation, setKeyLocation] = useState('');
  const [pickupNotes, setPickupNotes] = useState('');
  const [scheduledStartAt, setScheduledStartAt] = useState(initialScheduledAt);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!pickupLocation.trim()) {
      setError('Pickup location is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // datetime-local input gives 'YYYY-MM-DDTHH:mm' in LOCAL time;
      // turn it into a real ISO string so the server interprets the
      // intended local moment, not UTC.
      const isoStart = new Date(scheduledStartAt).toISOString();
      await woApi.confirmPickup(wo.id, {
        scheduledStartAt: isoStart,
        pickupLocation: pickupLocation.trim(),
        keyLocation: keyLocation.trim() || undefined,
        pickupNotes: pickupNotes.trim() || undefined,
      });
      onAction && onAction();
    } catch (err) {
      console.error('confirmPickup failed', err);
      setError(err.message || 'Failed to confirm pickup');
    } finally {
      setSubmitting(false);
    }
  };

  const pickupHeadline = ro.pickupType === 'overnight_rush'
    ? 'Vendor wants to take your van TONIGHT'
    : 'Vendor needs your van in shop';
  const pickupBody = ro.pickupType === 'overnight_rush'
    ? 'Pick it up tonight, returned before your AM shift.'
    : 'Vendor will keep the van for multi-day work.';

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-accent-gold/40 bg-accent-gold/5 px-4 py-4 space-y-3"
    >
      <div className="flex items-center gap-2 text-accent-gold font-semibold uppercase text-xs tracking-wider">
        <CalendarCheck className="w-4 h-4" />
        Awaiting your pickup confirmation
      </div>
      <div className="text-sm text-text-strong font-medium">
        {pickupHeadline}
      </div>
      <div className="text-sm text-text-muted">
        {pickupBody}
        {ro.pickupDurationText ? ` Estimated repair: ${ro.pickupDurationText}.` : ''}
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
          <MapPin className="inline w-3.5 h-3.5 mr-1" />
          Pickup location *
        </label>
        <input
          type="text"
          value={pickupLocation}
          onChange={(e) => setPickupLocation(e.target.value)}
          placeholder="e.g. Saba DSP yard, Bay 4"
          required
          className="w-full px-3 py-2 rounded-md bg-navy-900 border border-navy-700 text-sm text-text-strong"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
          <Key className="inline w-3.5 h-3.5 mr-1" />
          Where the keys will be
        </label>
        <input
          type="text"
          value={keyLocation}
          onChange={(e) => setKeyLocation(e.target.value)}
          placeholder="e.g. Lockbox 7741 · code 4421"
          className="w-full px-3 py-2 rounded-md bg-navy-900 border border-navy-700 text-sm text-text-strong"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
          <CalendarCheck className="inline w-3.5 h-3.5 mr-1" />
          Vehicle available from
        </label>
        <input
          type="datetime-local"
          value={scheduledStartAt}
          onChange={(e) => setScheduledStartAt(e.target.value)}
          required
          className="w-full px-3 py-2 rounded-md bg-navy-900 border border-navy-700 text-sm text-text-strong"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
          <MessageSquare className="inline w-3.5 h-3.5 mr-1" />
          Notes (optional)
        </label>
        <input
          type="text"
          value={pickupNotes}
          onChange={(e) => setPickupNotes(e.target.value)}
          placeholder="e.g. Call John at 555-0142 before pickup"
          className="w-full px-3 py-2 rounded-md bg-navy-900 border border-navy-700 text-sm text-text-strong"
        />
      </div>

      {error && (
        <div className="text-xs text-accent-red flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full px-4 py-2.5 rounded-md bg-accent-blue text-white font-semibold text-sm hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        Confirm pickup for this van
      </button>
      <p className="text-xs text-text-muted text-center">
        This confirms pickup for every open repair on this vehicle, not just this work order.
      </p>
    </form>
  );
}

// ─────────────────────────────────────────────────────
// SW (Vendor) action card — stub for now, full impl in task #27
// ─────────────────────────────────────────────────────
function SwActions({ wo }) {
  return (
    <div className="rounded-lg border border-navy-700 bg-navy-800/40 px-4 py-3 text-sm text-text-muted">
      <ClipboardList className="inline w-4 h-4 mr-2" />
      Service Writer actions (pickup request / defer / mid-find / notes / tech assign) — coming in next iteration.
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Defects in repair order — read-only list
// ─────────────────────────────────────────────────────
function DefectsList({ wo }) {
  const resolutions = wo.defectResolutions || wo.defect_resolutions || [];
  if (!resolutions.length) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
        Defects in repair order ({resolutions.length})
      </h3>
      <div className="rounded-lg border border-navy-700 divide-y divide-navy-800">
        {resolutions.map((r) => (
          <div key={r.id} className="px-3 py-2 flex items-center justify-between">
            <div>
              <div className="text-sm text-text-strong">
                {[r.defectPart, r.defectType].filter(Boolean).join(' — ') || `Defect #${r.defectId}`}
              </div>
              <div className="text-xs text-text-muted">
                {r.status || 'pending'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {r.billingType && (
                <span className={`px-1.5 py-0.5 text-xs rounded font-semibold ${
                  r.billingType === 'amr'
                    ? 'bg-accent-green/15 text-accent-green border border-accent-green/40'
                    : 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40'
                }`}>
                  {r.billingType.toUpperCase()}
                </span>
              )}
              {r.costDecision === 'approved' && (
                <span className="px-1.5 py-0.5 text-xs rounded bg-accent-green/15 text-accent-green border border-accent-green/40 font-semibold flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Approved
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────
// Activity panel — collapsible, lazy-loaded from /activity
// ─────────────────────────────────────────────────────
function ActivityPanel({ wo }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!open || items !== null) return;
    setLoading(true);
    woApi
      .activity(wo.id, { limit: 50 })
      .then((res) => {
        setItems(res.items || []);
        setTotal(res.total || 0);
      })
      .catch((err) => {
        console.warn('activity load failed', err);
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [open, items, wo.id]);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-muted hover:text-text-strong"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Activity {items && `(${total})`}
        </span>
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-navy-700 bg-navy-800/40">
          {loading && (
            <div className="px-3 py-3 flex items-center gap-2 text-text-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          )}
          {!loading && items && items.length === 0 && (
            <div className="px-3 py-3 text-text-muted text-sm">No activity yet.</div>
          )}
          {!loading && items && items.length > 0 && (
            <ul className="divide-y divide-navy-800">
              {items.map((e) => (
                <li key={e.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text-strong">{e.action}</span>
                    <span className="text-text-muted">
                      {e.entityType.replace('_', ' ')}
                    </span>
                    {e.actorName && (
                      <span className="text-text-muted">· by {e.actorName}</span>
                    )}
                  </div>
                  <div className="text-text-muted">
                    {new Date(e.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// `primaryRo(wo)` now imported from src/lib/wo.js (single source of
// truth). Note: this file's old local copy preferred `wo.ros` over
// `wo.primaryRo` — the shared helper inverts that. Both fields point
// at the same record when both are populated, so behaviour is unchanged.
