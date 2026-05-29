/**
 * Service Writer work-order modal (lightweight).
 *
 * Iter-1 surface: fetches full WO detail, shows the contact + status
 * + RO + tech metadata, the defects list, and a "Send pickup request"
 * action (the most common SW-side step after accept). The heavy bits
 * — defer-with-clone, mid-find form, internal notes thread, technician
 * assignment dropdown — are scheduled in task #29 and will be appended
 * here rather than splitting modals further.
 *
 * Activity panel reuses the same /activity endpoint as the customer
 * VanDetailModal (lazy-loaded on disclosure).
 */
import { useState, useEffect } from 'react';
import {
  X, Loader2, AlertTriangle, ChevronUp, ChevronDown, Truck, ClipboardList,
  Phone, Mail, User as UserIcon, Send, Calendar, CheckCircle2, Check,
} from 'lucide-react';
import { workOrders as woApi } from '../../api/client';

const PICKUP_TYPES = [
  { value: 'overnight_rush', label: 'Overnight (return before AM shift)' },
  { value: 'in_shop',        label: 'In shop (multi-day hold)' },
];

export default function SwWoModal({ woId, onClose, onAction }) {
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load full detail. We use the cached row's id; the list call doesn't
  // include ros/notes/defect_resolutions so we fetch /work-orders/{id}.
  useEffect(() => {
    setLoading(true);
    woApi
      .get(woId)
      .then(setWo)
      .catch((e) => setError(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [woId]);

  if (loading) {
    return (
      <ModalShell onClose={onClose}>
        <div className="px-6 py-12 flex items-center justify-center gap-2 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading work order…
        </div>
      </ModalShell>
    );
  }
  if (error) {
    return (
      <ModalShell onClose={onClose}>
        <div className="px-6 py-8 text-accent-red flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      </ModalShell>
    );
  }
  if (!wo) return null;

  const ro = primaryRo(wo);

  return (
    <ModalShell
      onClose={onClose}
      title={wo.id}
      subtitle={`Van ${wo.vehicleFleetId || wo.vehicleIdStr || wo.vehicleId} · ${wo.dspName || ''}`}
    >
      <div className="px-5 py-4 space-y-5">
        <ContactBlock wo={wo} />
        <StatusBlock wo={wo} ro={ro} />
        <PickupRequestBlock wo={wo} ro={ro} onAction={onAction} />
        <DefectsBlock wo={wo} />
        <ActivityPanel woId={wo.id} />
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────
// Modal shell
// ─────────────────────────────────────────────────────
function ModalShell({ children, onClose, title, subtitle }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-12 px-4">
      <div className="bg-navy-900 border border-navy-700 rounded-xl w-full max-w-2xl shadow-2xl">
        <div className="flex items-start justify-between px-5 py-4 border-b border-navy-700">
          <div>
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-text-muted" />
              <h2 className="text-lg font-bold text-text-strong">
                {title || 'Work Order'}
              </h2>
            </div>
            {subtitle && (
              <p className="text-xs text-text-muted mt-1">{subtitle}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-strong">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Sub-blocks
// ─────────────────────────────────────────────────────
function ContactBlock({ wo }) {
  // Per-DSP contact info lives in dsp_settings (a separate endpoint).
  // For iter-1 we just identify the DSP; the full contact card lands
  // alongside the heavy SW modal in task #29.
  return (
    <section className="rounded-lg border border-navy-700 bg-navy-800/40 px-4 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
        Customer
      </h3>
      <div className="text-sm text-text-strong">
        {wo.dspName || (wo.dspId ? `DSP ${wo.dspId}` : '—')}
      </div>
      {(wo.vehicleFleetId || wo.vehicleIdStr) && (
        <div className="text-xs text-text-muted mt-1">
          Van {wo.vehicleFleetId || wo.vehicleIdStr}
          {wo.vehicleIdStr && wo.vehicleFleetId && wo.vehicleFleetId !== wo.vehicleIdStr
            ? ` (${wo.vehicleIdStr})` : ''}
          {wo.vehicleYear ? ` · ${wo.vehicleYear} ${wo.vehicleMake || ''} ${wo.vehicleModel || ''}`.trim() : ''}
        </div>
      )}
    </section>
  );
}

function StatusBlock({ wo, ro }) {
  return (
    <section className="grid grid-cols-2 gap-3 text-sm">
      <Field label="Status" value={wo.status} />
      <Field label="RO" value={ro?.roNumber || '—'} />
      <Field label="Technician" value={wo.assignedTechnicianName || 'Unassigned'} />
      <Field label="Scheduled" value={ro?.scheduledStartAt ? new Date(ro.scheduledStartAt).toLocaleString() : '—'} />
    </section>
  );
}

function Field({ label, value }) {
  return (
    <div className="rounded-md border border-navy-700 bg-navy-800/40 px-3 py-2">
      <div className="text-xs text-text-muted uppercase tracking-wider">{label}</div>
      <div className="text-text-strong">{value}</div>
    </div>
  );
}

function PickupRequestBlock({ wo, ro, onAction }) {
  const [pickupType, setPickupType] = useState('overnight_rush');
  const [durationText, setDurationText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Only render when WO is in the right state — accepted, no pickup yet.
  if (wo.status !== 'accepted') return null;
  if (ro && ro.pickupType) {
    return (
      <section className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-accent-blue flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5" />
          {ro.scheduledStartAt
            ? 'Customer confirmed pickup'
            : 'Pickup request sent — awaiting customer'}
        </div>
        <div className="mt-1 text-sm text-text-strong">
          {PICKUP_TYPES.find((t) => t.value === ro.pickupType)?.label || ro.pickupType}
        </div>
        {ro.scheduledStartAt && (
          <div className="text-xs text-text-muted mt-0.5">
            Vehicle available {new Date(ro.scheduledStartAt).toLocaleString()}
          </div>
        )}
        {ro.pickupLocation && (
          <div className="text-xs text-text-muted">📍 {ro.pickupLocation}</div>
        )}
      </section>
    );
  }

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await woApi.pickupRequest(wo.id, {
        pickupType,
        pickupDurationText: durationText.trim() || undefined,
      });
      onAction && onAction();
    } catch (e) {
      setError(e.detail || e.message || 'Failed to send pickup request');
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-accent-gold/40 bg-accent-gold/5 px-4 py-4 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-accent-gold flex items-center gap-2">
        <Send className="w-3.5 h-3.5" />
        Request pickup from customer
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-text-muted uppercase tracking-wider mb-1 block">
            Pickup type
          </label>
          <select
            value={pickupType}
            onChange={(e) => setPickupType(e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm bg-navy-900 border border-navy-700 text-text-strong"
          >
            {PICKUP_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-muted uppercase tracking-wider mb-1 block">
            ETA text (optional)
          </label>
          <input
            type="text"
            value={durationText}
            onChange={(e) => setDurationText(e.target.value)}
            placeholder="e.g. ~4 hours"
            className="w-full rounded-md px-3 py-2 text-sm bg-navy-900 border border-navy-700 text-text-strong"
          />
        </div>
      </div>
      {error && (
        <div className="text-xs text-accent-red flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="w-full px-4 py-2.5 rounded-md bg-accent-blue text-white font-semibold text-sm hover:bg-accent-blue/90 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Send pickup request
      </button>
      <p className="text-xs text-text-muted text-center">
        Applies to every Pending RO on this van.
      </p>
    </section>
  );
}

function DefectsBlock({ wo }) {
  const resolutions = wo.defectResolutions || wo.defect_resolutions || [];
  if (!resolutions.length) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
        Defects ({resolutions.length})
      </h3>
      <div className="rounded-lg border border-navy-700 divide-y divide-navy-800">
        {resolutions.map((r) => (
          <div key={r.id} className="px-3 py-2 flex items-center justify-between text-sm">
            <div>
              <div className="text-text-strong">
                {[r.defectPart, r.defectType].filter(Boolean).join(' — ') || `Defect #${r.defectId}`}
              </div>
              <div className="text-xs text-text-muted">{r.status || 'pending'}</div>
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

function ActivityPanel({ woId }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!open || items !== null) return;
    setLoading(true);
    woApi
      .activity(woId, { limit: 50 })
      .then((res) => {
        setItems(res.items || []);
        setTotal(res.total || 0);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, items, woId]);

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
            <ul className="divide-y divide-navy-800 max-h-72 overflow-y-auto">
              {items.map((e) => (
                <li key={e.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text-strong">{e.action}</span>
                    <span className="text-text-muted">{e.entityType.replace('_', ' ')}</span>
                    {e.actorName && <span className="text-text-muted">· {e.actorName}</span>}
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

// ─────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────
function primaryRo(wo) {
  if (Array.isArray(wo?.ros) && wo.ros.length > 0) {
    return wo.ros.find((r) => r.isPrimary) || wo.ros[0];
  }
  if (wo?.primaryRo) return wo.primaryRo;
  return null;
}
