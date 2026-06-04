/**
 * BodyRepairFlow — Phase 0 surface.
 *
 * Port of web-mbk-body-repair-demo's body repair flow. Jorge confirmed
 * a phased approach (2026-06-03):
 *
 *   0  (this commit)  customer text submit + role-scoped list
 *   1  PAVE upload + parsing + 3 modes (text / parts / grade)
 *   2  Vendor queue + quote submission + DFS markup
 *   3  Quote selection + pickup proposal + logistics
 *   4  Pickup → repair → completion + photos + damage diff
 *   5  Activity timeline + messaging + report send / release
 *
 * Notes on tech choice for Phase 0:
 *   The demo uses TanStack Router + TanStack Query + TypeScript. We
 *   agreed to bring that infra in Phase 1 when it pays for itself
 *   (PAVE upload + complex multi-mode UI). For Phase 0 — one list + one
 *   form — plain JSX + apiFetch is faster to ship with zero deploy risk.
 *   The TS module will replace this file once it lands.
 *
 * Layout:
 *   - Top: "+ New body repair request" button (DSP only).
 *   - Body: role-scoped list of requests + status pill.
 *   - Empty state: friendly hint + entry-point button.
 *   - Click row → detail panel inline (Phase 1 will swap for a real
 *     detail route with the full lifecycle UI from the demo).
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Wrench, Plus, X, Loader2, AlertTriangle, Truck, Calendar, FileText,
  CheckCircle2, ArrowRight,
} from 'lucide-react';
import { bodyRepair as bodyRepairApi, vehicles as vehiclesApi, APIError } from '../api/client';

// ─────────────────────────────────────────────────────
// Status → pill style. Per-role labels for the same status (sw vs
// customer wording) live in the demo's STATUS_PILL_LABELS dict; for
// Phase 0 we keep it role-neutral and short.
// ─────────────────────────────────────────────────────
const STATUS_STYLE = {
  pending_quotes:      { label: 'Awaiting quotes',     color: 'accent-orange' },
  quoted:              { label: 'Quote received',      color: 'accent-blue' },
  quote_selected:      { label: 'Scheduling pickup',   color: 'accent-blue' },
  pickup_proposed:     { label: 'Pickup proposed',     color: 'accent-blue' },
  pickup_confirmed:    { label: 'Pickup scheduled',    color: 'accent-purple' },
  in_repair:           { label: 'In repair',           color: 'accent-blue' },
  repair_complete:     { label: 'Ready to drop off',   color: 'accent-purple' },
  pending_signoff:     { label: 'Awaiting signoff',    color: 'accent-orange' },
  returned:            { label: 'Payment due',         color: 'accent-gold' },
  paid:                { label: 'Closed',              color: 'accent-green' },
  cancelled:           { label: 'Cancelled',           color: 'accent-gold' },
  no_eligible_vendor:  { label: 'Needs admin',         color: 'accent-red' },
  halted:              { label: 'On hold',             color: 'accent-red' },
};

export default function BodyRepairFlow({ user }) {
  const isDsp = user?.role === 'dsp_owner';
  const isSiteAdmin = user?.role === 'site_admin';
  const canCreate = isDsp || isSiteAdmin;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [openItemId, setOpenItemId] = useState(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    bodyRepairApi
      .list({ limit: 100 })
      .then((res) => {
        if (cancelled) return;
        setItems(res?.items || []);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof APIError ? (e.detail || e.message) : (e?.message || 'Failed to load'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tick]);

  const openItem = items.find((i) => i.id === openItemId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Wrench size={20} className="text-accent-purple" />
            Body Repair
          </h1>
          <p className="text-xs text-navy-400 mt-1">
            {isDsp
              ? 'Submit + track collision and body repair requests for your fleet.'
              : isSiteAdmin
              ? 'All body repair requests across DSPs (site admin view).'
              : 'Body repair queue for your shop.'}
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-purple text-white text-sm font-semibold hover:bg-accent-purple/85 transition-all cursor-pointer shadow-lg shadow-accent-purple/20"
          >
            <Plus size={14} /> New body repair request
          </button>
        )}
      </div>

      {/* Error */}
      {err && (
        <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
          <AlertTriangle size={14} />
          {err}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="text-accent-blue animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState onNew={canCreate ? () => setShowCreate(true) : null} />
      ) : (
        <div className="space-y-2">
          {items.map((req) => (
            <RequestRow
              key={req.id}
              req={req}
              expanded={openItemId === req.id}
              onToggle={() => setOpenItemId((cur) => cur === req.id ? null : req.id)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateRequestModal
          user={user}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); reload(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Row + status pill
// ─────────────────────────────────────────────────────
function RequestRow({ req, expanded, onToggle }) {
  const s = STATUS_STYLE[req.status] || { label: req.status, color: 'accent-blue' };
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-900/60 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-navy-800/40 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-accent-purple/15 border border-accent-purple/40 flex items-center justify-center shrink-0">
            <Truck size={14} className="text-accent-purple" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white">
                Van {req.vehicleFleetId || req.vehicleId}
              </span>
              <span className="text-[10px] text-navy-500 font-mono">{req.id}</span>
              {req.vendorName && (
                <span className="text-[10px] text-navy-400">· {req.vendorName}</span>
              )}
            </div>
            <div className="text-[11px] text-navy-400 truncate">
              {req.dspName}
              {req.vehicleYear ? ` · ${req.vehicleYear} ${req.vehicleMake || ''} ${req.vehicleModel || ''}`.trim() : ''}
              {' · created '}{relativeTime(req.createdAt)}
            </div>
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-${s.color}/15 text-${s.color} border border-${s.color}/40`}>
          {s.label}
        </span>
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-navy-700/60 bg-navy-900/40 text-sm space-y-2">
          {req.textDescription ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-navy-500 font-semibold mb-1 flex items-center gap-1">
                <FileText size={10} /> Customer description
              </div>
              <p className="text-text-strong whitespace-pre-wrap">{req.textDescription}</p>
            </div>
          ) : (
            <p className="text-navy-400 italic">No text description provided.</p>
          )}
          <div className="text-[11px] text-navy-400">
            Phase 1 will add the PAVE report, quotes, scheduling and the full lifecycle UI here.
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────
function EmptyState({ onNew }) {
  return (
    <div className="rounded-xl border border-dashed border-navy-700 bg-navy-900/40 px-6 py-12 text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-accent-purple/15 border border-accent-purple/40 flex items-center justify-center mb-3">
        <Wrench size={20} className="text-accent-purple" />
      </div>
      <h3 className="text-base font-semibold text-white mb-1">No body repair requests yet</h3>
      <p className="text-xs text-navy-400 mb-4 max-w-md mx-auto">
        Body repair covers collision, dents, paint, glass and any vehicle work outside the regular AMR / CMR mechanical scope. Requests stay separate from your standard work orders.
      </p>
      {onNew && (
        <button
          onClick={onNew}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-purple text-white text-sm font-semibold hover:bg-accent-purple/85 cursor-pointer"
        >
          <Plus size={14} /> Submit your first request
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Create modal — Phase 0 = text mode only
// ─────────────────────────────────────────────────────
function CreateRequestModal({ user, onClose, onCreated }) {
  const isSiteAdmin = user?.role === 'site_admin';
  const [vehicleOptions, setVehicleOptions] = useState([]);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Load my vehicles (or any if site_admin). 50 is enough for v0; the
  // search field below narrows further if the DSP has more.
  useEffect(() => {
    vehiclesApi
      .list({ perPage: 100, search: vehicleSearch || undefined })
      .then((res) => setVehicleOptions(res?.items || []))
      .catch(() => setVehicleOptions([]));
  }, [vehicleSearch]);

  const submit = async () => {
    setErr(null);
    if (!vehicleId) {
      setErr('Pick the vehicle this request is for.');
      return;
    }
    if (!text.trim()) {
      setErr('Describe what needs to be repaired.');
      return;
    }
    setBusy(true);
    try {
      // Backend expects int vehicle_id — convert from prefixed "VAN-0131".
      const intId = (() => {
        if (typeof vehicleId === 'number') return vehicleId;
        const m = String(vehicleId).match(/(\d+)/);
        return m ? Number(m[1]) : null;
      })();
      if (!intId) {
        setErr('Could not resolve vehicle id.');
        setBusy(false);
        return;
      }
      await bodyRepairApi.create({
        vehicleId: intId,
        mode: 'text',
        textDescription: text.trim(),
      });
      onCreated?.();
    } catch (e) {
      setErr(e instanceof APIError ? (e.detail || e.message) : (e?.message || 'Failed to submit'));
    } finally {
      setBusy(false);
    }
  };

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
        className="bg-navy-900 border border-navy-700 rounded-xl w-full max-w-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-navy-700">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-accent-purple/15 border border-accent-purple/40 flex items-center justify-center">
              <Wrench size={16} className="text-accent-purple" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">New body repair request</h3>
              <p className="text-[11px] text-navy-400">Describe what needs to be repaired. Quote workflow comes next.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-text-strong block mb-1.5">
              Vehicle
            </label>
            <input
              type="text"
              placeholder="Search by fleet id, VIN, or plate…"
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder:text-navy-500 outline-none focus:border-accent-purple mb-2"
            />
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-purple"
            >
              <option value="">— Pick a vehicle —</option>
              {vehicleOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  Van {v.fleetId || v.id}
                  {v.year ? ` · ${v.year} ${v.make || ''} ${v.model || ''}`.trim() : ''}
                  {isSiteAdmin && v.dsp ? ` · ${v.dsp}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="body-text" className="text-xs font-semibold text-text-strong block mb-1.5">
              What needs to be repaired?
            </label>
            <textarea
              id="body-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Driver-side rear panel — heavy dent + scratched paint after a parking lot incident."
              rows={5}
              maxLength={2000}
              className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder:text-navy-500 outline-none focus:border-accent-purple resize-none"
            />
            <div className="text-[10px] text-navy-500 mt-1 text-right">{text.length} / 2000</div>
          </div>

          {err && (
            <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-xs text-accent-red flex items-center gap-2">
              <AlertTriangle size={12} />
              {err}
            </div>
          )}

          <div className="px-3 py-2 rounded-md bg-accent-blue/5 border border-accent-blue/20 text-[11px] text-navy-300 flex items-start gap-2">
            <ArrowRight size={12} className="text-accent-blue shrink-0 mt-0.5" />
            <span>
              Phase 0 only supports a free-text description. PAVE PDF upload, parts picker, and target-grade selector ship in the next iteration along with the vendor quote queue.
            </span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-navy-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-navy-800 hover:bg-navy-700 text-white border border-navy-700 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !vehicleId || !text.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-accent-purple text-white hover:bg-accent-purple/85 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Submit request
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}
