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
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Wrench, Plus, X, Loader2, AlertTriangle, Truck, Calendar, FileText,
  CheckCircle2, ArrowRight, Upload, FileBadge, DollarSign, ThumbsUp, ThumbsDown,
  RefreshCw,
} from 'lucide-react';
import {
  bodyRepair as bodyRepairApi,
  vehicles as vehiclesApi,
  uploads as uploadsApi,
  APIError,
} from '../api/client';

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
  // Phase 2 — Body Repair Vendor branch. The backend list/quote endpoints
  // already do role-based scoping (vendors see open requests + their own
  // bids); the frontend only needs to swap copy + actions.
  const isBodyRepairVendor = user?.orgType === 'body_repair_vendor';
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
              user={user}
              isBodyRepairVendor={isBodyRepairVendor}
              expanded={openItemId === req.id}
              onToggle={() => setOpenItemId((cur) => cur === req.id ? null : req.id)}
              onReload={reload}
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
function RequestRow({ req, user, isBodyRepairVendor, expanded, onToggle, onReload }) {
  const s = STATUS_STYLE[req.status] || { label: req.status, color: 'accent-blue' };
  // PAVE rows are lazy-loaded on expand. Caches so re-collapsing +
  // re-expanding doesn't refetch every time.
  const [paveRows, setPaveRows] = useState(null);
  const [paveErr, setPaveErr] = useState(null);
  useEffect(() => {
    if (!expanded || paveRows !== null) return;
    let cancelled = false;
    bodyRepairApi
      .listPave(req.id)
      .then((rows) => { if (!cancelled) setPaveRows(Array.isArray(rows) ? rows : []); })
      .catch((e) => { if (!cancelled) setPaveErr(e?.detail || e?.message || 'failed'); });
    return () => { cancelled = true; };
  }, [expanded, req.id, paveRows]);

  const paveCount = Array.isArray(paveRows) ? paveRows.length : 0;

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
              {paveCount > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-accent-purple/15 text-accent-purple border border-accent-purple/40">
                  <FileBadge size={9} />
                  PAVE
                </span>
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
        <div className="px-4 py-3 border-t border-navy-700/60 bg-navy-900/40 text-sm space-y-3">
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

          {/* PAVE report panel — shows VIN, score, damage count, parse
              status. Renders only if reports exist. The full damage
              list (from parsed_json) will surface in Phase 2 when the
              UI gets the parts-picker + damage tree visualisation. */}
          {Array.isArray(paveRows) && paveRows.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-navy-500 font-semibold mb-1.5 flex items-center gap-1">
                <FileBadge size={10} /> PAVE reports ({paveRows.length})
              </div>
              <div className="space-y-1.5">
                {paveRows.map((p) => <PaveSummary key={p.id} pave={p} />)}
              </div>
            </div>
          )}
          {paveErr && (
            <div className="text-[10px] text-accent-red">PAVE list error: {String(paveErr)}</div>
          )}

          {/* Quotes panel — Phase 2. Lazy fetched on expand. Renders
              role-specific actions: customer sees select/decline,
              vendor sees their own quote with renew (or submit if
              none yet). */}
          <QuotesPanel
            req={req}
            user={user}
            isBodyRepairVendor={isBodyRepairVendor}
            onChanged={onReload}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// QuotesPanel — Phase 2.
// Backend returns { is_vendor, is_admin, is_customer, quotes: [...] }.
// The `quotes` array carries role-projected fields:
//   customer view: list_cents, platform_fee_cents, line items (no markup)
//   vendor view:   vendor_raw_cents + line items
//   admin view:    both sides + commission_pct + base
// ─────────────────────────────────────────────────────
function QuotesPanel({ req, user, isBodyRepairVendor, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);

  const load = useCallback(() => {
    bodyRepairApi
      .listQuotes(req.id)
      .then(setData)
      .catch((e) => setErr(e?.detail || e?.message || 'failed'));
  }, [req.id]);

  useEffect(() => { load(); }, [load]);

  if (err) {
    return (
      <div className="rounded-lg border border-accent-red/40 bg-accent-red/5 px-3 py-2 text-xs text-accent-red">
        Quotes failed to load: {String(err)}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-xs text-navy-400">
        <Loader2 size={12} className="animate-spin" /> Loading quotes…
      </div>
    );
  }

  const quotes = data.quotes || [];
  const isCustomerView = !!data.isCustomer;
  const isVendorView = !!data.isVendor;

  // Vendor: figure out if they already have an active quote here.
  const ownActive = isVendorView
    ? quotes.find((q) => q.status === 'active')
    : null;

  const onSelect = async (q) => {
    setBusy(true);
    try {
      await bodyRepairApi.selectQuote(req.id, q.id);
      onChanged?.();
      load();
    } catch (e) {
      setErr(e?.detail || e?.message || 'select failed');
    } finally {
      setBusy(false);
    }
  };
  const onDeclineAll = async () => {
    setBusy(true);
    try {
      await bodyRepairApi.declineQuotes(req.id);
      onChanged?.();
      load();
    } catch (e) {
      setErr(e?.detail || e?.message || 'decline failed');
    } finally {
      setBusy(false);
    }
  };
  const onRenew = async () => {
    setBusy(true);
    try {
      await bodyRepairApi.renewQuote(req.id);
      load();
    } catch (e) {
      setErr(e?.detail || e?.message || 'renew failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-navy-500 font-semibold mb-1.5 flex items-center gap-1">
          <DollarSign size={10} /> Quotes ({quotes.length})
        </div>
        {quotes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-navy-700 bg-navy-900/40 px-3 py-3 text-center text-xs text-navy-400">
            {isVendorView
              ? 'You have not submitted a quote on this request yet.'
              : isCustomerView
              ? 'No quotes yet — vendors will appear here as they bid.'
              : 'No quotes have been submitted yet.'}
          </div>
        ) : (
          <div className="space-y-1.5">
            {quotes.map((q) => (
              <QuoteRow
                key={q.id}
                quote={q}
                isCustomerView={isCustomerView}
                isVendorView={isVendorView}
                busy={busy}
                onSelect={() => onSelect(q)}
                onRenew={onRenew}
              />
            ))}
          </div>
        )}

        {/* Customer-side global actions */}
        {isCustomerView && quotes.some((q) => q.status === 'active') && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onDeclineAll}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-accent-red/40 text-accent-red text-xs hover:bg-accent-red/10 disabled:opacity-40 cursor-pointer"
            >
              <ThumbsDown size={11} /> Decline all
            </button>
          </div>
        )}

        {/* Vendor-side primary action */}
        {isVendorView && !ownActive && req.status !== 'paid' && req.status !== 'cancelled' && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setShowSubmit(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-purple text-white text-xs font-semibold hover:bg-accent-purple/85 cursor-pointer"
            >
              <Plus size={11} /> Submit a quote
            </button>
          </div>
        )}
      </div>

      {showSubmit && (
        <SubmitQuoteModal
          req={req}
          onClose={() => setShowSubmit(false)}
          onCreated={() => { setShowSubmit(false); onChanged?.(); load(); }}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────
// QuoteRow — one quote line in the QuotesPanel.
// Renders role-specific labels and money. The customer sees the
// list_cents headline; the vendor sees their raw + headline.
// ─────────────────────────────────────────────────────
function QuoteRow({ quote, isCustomerView, isVendorView, busy, onSelect, onRenew }) {
  const isActive = quote.status === 'active';
  const isSelected = quote.status === 'selected';
  const isExpired = quote.isExpired;

  const headlineCents = quote.listCents;
  const headlineLabel = isVendorView ? 'Headline (customer pays)' : 'Total';

  return (
    <div className={`rounded-lg border px-3 py-2 ${
      isSelected
        ? 'bg-accent-green/5 border-accent-green/40'
        : isExpired
        ? 'bg-navy-900/40 border-navy-700'
        : 'bg-navy-800/40 border-navy-700'
    }`}>
      <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm font-semibold text-white truncate">
            {quote.vendorOrgName || `Vendor ${quote.vendorOrgId}`}
          </span>
          <span className="text-[9px] text-navy-500 font-mono">{quote.id}</span>
          {isSelected && (
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green border border-accent-green/40">
              Selected
            </span>
          )}
          {!isSelected && isExpired && (
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-accent-red/15 text-accent-red border border-accent-red/40">
              Expired
            </span>
          )}
        </div>
        {headlineCents != null && (
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-wider text-navy-500">{headlineLabel}</div>
            <div className="text-sm font-semibold text-white">{formatCents(headlineCents)}</div>
          </div>
        )}
      </div>

      <div className="text-[11px] text-navy-400 flex items-center gap-2 flex-wrap">
        {quote.durationDays != null && (
          <span>{quote.durationDays} day{quote.durationDays === 1 ? '' : 's'}</span>
        )}
        {quote.expiresIn && (
          <span className={isExpired ? 'text-accent-red' : ''}>
            · valid {quote.expiresIn}
          </span>
        )}
        {quote.renewedCount > 0 && (
          <span className="text-navy-500">· renewed {quote.renewedCount}x</span>
        )}
      </div>

      {quote.notes && (
        <div className="text-[11px] text-navy-300 mt-1 italic">"{quote.notes}"</div>
      )}

      {/* Pricing breakdown — vendor sees raw + headline; customer sees
          headline + platform fee. Line items are below for both. */}
      {isVendorView && quote.vendorRawCents != null && (
        <div className="text-[11px] text-navy-400 mt-1">
          <span className="text-navy-500">Your cost:</span> {formatCents(quote.vendorRawCents)}
          {quote.listCents != null && (
            <>
              {' · '}
              <span className="text-navy-500">Customer pays:</span> {formatCents(quote.listCents)}
            </>
          )}
        </div>
      )}
      {isCustomerView && quote.platformFeeCents != null && (
        <div className="text-[11px] text-navy-400 mt-1">
          <span className="text-navy-500">Vendor cost:</span> {formatCents(quote.vendorRawCents)}
          {' · '}
          <span className="text-navy-500">Platform fee:</span> {formatCents(quote.platformFeeCents)}
        </div>
      )}

      {/* Line items */}
      {Array.isArray(quote.lineItems) && quote.lineItems.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {quote.lineItems.map((li) => (
            <div key={li.id} className="flex items-center justify-between gap-2 text-[11px] text-navy-300">
              <span className="truncate">{li.description || '(no description)'}</span>
              <span className="text-navy-400 font-mono">{formatCents(li.totalCents ?? 0)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-2 flex items-center justify-end gap-2">
        {isCustomerView && isActive && !isExpired && (
          <button
            type="button"
            onClick={onSelect}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-accent-green text-white text-xs font-semibold hover:bg-accent-green/85 disabled:opacity-40 cursor-pointer"
          >
            <ThumbsUp size={11} /> Select
          </button>
        )}
        {isVendorView && isActive && isExpired && (
          <button
            type="button"
            onClick={onRenew}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/85 disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw size={11} /> Renew
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// SubmitQuoteModal — vendor adds line items + duration + notes.
// Backend computes vendor_raw_cents from the sum of parts+labor.
// ─────────────────────────────────────────────────────
function SubmitQuoteModal({ req, onClose, onCreated }) {
  const [lineItems, setLineItems] = useState([
    { description: '', partsCents: 0, laborCents: 0 },
  ]);
  const [durationDays, setDurationDays] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const total = lineItems.reduce(
    (sum, li) => sum + (Number(li.partsCents) || 0) + (Number(li.laborCents) || 0),
    0,
  );

  const setItem = (idx, key, val) => {
    setLineItems((cur) => cur.map((li, i) => (i === idx ? { ...li, [key]: val } : li)));
  };
  const addItem = () => setLineItems((cur) => [...cur, { description: '', partsCents: 0, laborCents: 0 }]);
  const removeItem = (idx) => setLineItems((cur) => cur.filter((_, i) => i !== idx));

  const submit = async () => {
    setErr(null);
    if (total <= 0) {
      setErr('Add at least one priced line item.');
      return;
    }
    setBusy(true);
    try {
      // Keep only items with money on them; trim descriptions.
      const cleaned = lineItems
        .map((li) => ({
          description: (li.description || '').trim() || null,
          partsCents: Math.round(Number(li.partsCents) || 0),
          laborCents: Math.round(Number(li.laborCents) || 0),
        }))
        .filter((li) => li.partsCents + li.laborCents > 0);
      const body = {
        lineItems: cleaned,
        notes: notes.trim() || undefined,
      };
      const d = parseInt(durationDays, 10);
      if (Number.isFinite(d) && d >= 0) body.durationDays = d;
      await bodyRepairApi.submitQuote(req.id, body);
      onCreated?.();
    } catch (e) {
      setErr(e instanceof APIError ? (e.detail || e.message) : (e?.message || 'failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8 px-4"
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
              <DollarSign size={16} className="text-accent-purple" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Submit a quote</h3>
              <p className="text-[11px] text-navy-400">
                Van {req.vehicleFleetId || req.vehicleId} · {req.dspName || ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-text-strong">Scope items</label>
              <button
                type="button"
                onClick={addItem}
                className="text-[10px] text-accent-blue hover:underline cursor-pointer"
              >
                + Add item
              </button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                  <input
                    type="text"
                    value={li.description}
                    onChange={(e) => setItem(idx, 'description', e.target.value)}
                    placeholder="Description (e.g. Rear bumper replace)"
                    maxLength={300}
                    className="col-span-6 px-2 py-1.5 rounded-md bg-navy-800 border border-navy-700 text-sm text-white placeholder:text-navy-500 outline-none focus:border-accent-purple"
                  />
                  <CentsInput
                    label="Parts $"
                    value={li.partsCents}
                    onChange={(v) => setItem(idx, 'partsCents', v)}
                  />
                  <CentsInput
                    label="Labor $"
                    value={li.laborCents}
                    onChange={(v) => setItem(idx, 'laborCents', v)}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    disabled={lineItems.length <= 1}
                    className="col-span-1 text-navy-500 hover:text-accent-red disabled:opacity-30 p-1.5 cursor-pointer"
                    title="Remove item"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-end text-xs">
              <span className="text-navy-400">Your cost:&nbsp;</span>
              <span className="text-white font-semibold">{formatCents(total)}</span>
            </div>
          </div>

          {/* Duration + notes */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="dur" className="text-xs font-semibold text-text-strong block mb-1.5">
                Duration (days)
              </label>
              <input
                id="dur"
                type="number"
                min={0}
                max={365}
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                placeholder="3"
                className="w-full px-2 py-1.5 rounded-md bg-navy-800 border border-navy-700 text-sm text-white outline-none focus:border-accent-purple"
              />
            </div>
            <div className="col-span-2">
              <label htmlFor="qnotes" className="text-xs font-semibold text-text-strong block mb-1.5">
                Notes (optional)
              </label>
              <input
                id="qnotes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any clarifications for the customer…"
                maxLength={2000}
                className="w-full px-2 py-1.5 rounded-md bg-navy-800 border border-navy-700 text-sm text-white placeholder:text-navy-500 outline-none focus:border-accent-purple"
              />
            </div>
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
              You enter your cost; Nova adds commission server-side. The customer sees a single platform fee line, not a per-item markup. Your raw price stays vendor-side.
            </span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-navy-700 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-navy-800 hover:bg-navy-700 text-white border border-navy-700 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || total <= 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-accent-purple text-white hover:bg-accent-purple/85 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Submit quote
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Compact dollars-as-cents input. Internally we ALWAYS work in cents
// to match the backend's int columns and avoid float drift; the input
// shows dollars with up to 2 decimals.
function CentsInput({ label, value, onChange }) {
  const dollars = ((Number(value) || 0) / 100).toFixed(2);
  return (
    <label className="col-span-2 flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-navy-500">{label}</span>
      <input
        type="number"
        step="0.01"
        min={0}
        value={dollars}
        onChange={(e) => {
          const d = parseFloat(e.target.value);
          onChange(Number.isFinite(d) ? Math.round(d * 100) : 0);
        }}
        className="px-2 py-1.5 rounded-md bg-navy-800 border border-navy-700 text-sm text-white outline-none focus:border-accent-purple"
      />
    </label>
  );
}

// Cents → "$X.XX" for display.
function formatCents(cents) {
  const n = (Number(cents) || 0) / 100;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Compact PAVE summary chip. Surfaces parse status + the three most
// useful fields (VIN, score, damage count) plus phase. The full
// parsed_json (per-side damage list, scores breakdown) lives on the
// row already; this is the "at a glance" version.
function PaveSummary({ pave }) {
  const failed = pave.parseStatus === 'failed';
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${
      failed
        ? 'bg-accent-red/5 border-accent-red/40'
        : 'bg-navy-800/50 border-navy-700'
    }`}>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="text-[9px] uppercase tracking-wider font-semibold text-navy-400">
          {pave.phase}
        </span>
        {failed ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-accent-red">
            <AlertTriangle size={10} /> Parse failed — manual review
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] text-accent-green">
            <CheckCircle2 size={10} /> Parsed
          </span>
        )}
        {pave.vin && (
          <span className="text-navy-300 font-mono text-[10px]">VIN {pave.vin}</span>
        )}
      </div>
      {!failed && (
        <div className="flex items-center gap-3 text-[11px] text-navy-300 flex-wrap">
          {pave.year && (
            <span>{pave.year} {pave.make} {pave.model}</span>
          )}
          {pave.totalScore != null && (
            <span className="inline-flex items-center gap-1">
              <span className="text-navy-500">Score:</span>
              <span className="font-semibold text-white">{pave.totalScore}</span>
            </span>
          )}
          {pave.damageCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="text-navy-500">Damages:</span>
              <span className="font-semibold text-white">{pave.damageCount}</span>
            </span>
          )}
        </div>
      )}
      {Array.isArray(pave.parsedWarnings) && pave.parsedWarnings.length > 0 && (
        <div className="text-[9px] text-accent-orange mt-1">
          {pave.parsedWarnings[0]}
          {pave.parsedWarnings.length > 1 && ` (+${pave.parsedWarnings.length - 1} more)`}
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
  // PAVE PDF state — null until the user picks a file. The actual
  // upload + parse happens AFTER the request is created (the parent_id
  // for the presigned URL is the new BRR-NNNNN).
  const [paveFile, setPaveFile] = useState(null);
  // Submission stage: 'idle' | 'creating' | 'uploading_pave' | 'parsing_pave' | 'done'
  // Surfaced as inline progress text + spinner labels so the user
  // knows what's happening when they wait 2-3 seconds for parse.
  const [stage, setStage] = useState('idle');
  const fileInputRef = useRef(null);

  useEffect(() => {
    vehiclesApi
      .list({ perPage: 100, search: vehicleSearch || undefined })
      .then((res) => setVehicleOptions(res?.items || []))
      .catch(() => setVehicleOptions([]));
  }, [vehicleSearch]);

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      setErr('PAVE attachment must be a PDF.');
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setErr('PAVE PDF is too large (max 25MB).');
      return;
    }
    setErr(null);
    setPaveFile(f);
  };

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
    setStage('creating');
    let createdRequest = null;
    try {
      const intId = (() => {
        if (typeof vehicleId === 'number') return vehicleId;
        const m = String(vehicleId).match(/(\d+)/);
        return m ? Number(m[1]) : null;
      })();
      if (!intId) {
        setErr('Could not resolve vehicle id.');
        setBusy(false);
        setStage('idle');
        return;
      }
      // 1. Create the request (mode='text').
      createdRequest = await bodyRepairApi.create({
        vehicleId: intId,
        mode: 'text',
        textDescription: text.trim(),
      });

      // 2. If a PAVE PDF was picked, upload + parse it now.
      if (paveFile && createdRequest?.id) {
        setStage('uploading_pave');
        const { uploadUrl, storageKey } = await uploadsApi.presigned({
          kind: 'body_repair_pave',
          parentId: createdRequest.id,
          filename: paveFile.name,
          contentType: paveFile.type || 'application/pdf',
          sizeBytes: paveFile.size,
        });
        await uploadsApi.putToPresigned(uploadUrl, paveFile, 'application/pdf');

        setStage('parsing_pave');
        // The /pave endpoint downloads from MinIO + runs pdftotext +
        // stores the parsed dict. Typical PAVE parses in well under
        // a second; allow it to surface its own errors.
        await bodyRepairApi.attachPave(createdRequest.id, {
          storageKey,
          fileSizeBytes: paveFile.size,
          phase: 'pre',
          source: 'upload',
        });
      }

      setStage('done');
      onCreated?.();
    } catch (e) {
      // Distinguish create-failure from upload-failure for the message.
      const baseMsg = e instanceof APIError ? (e.detail || e.message) : (e?.message || 'Failed to submit');
      if (stage === 'uploading_pave' || stage === 'parsing_pave') {
        setErr(
          createdRequest
            ? `Request ${createdRequest.id} was created, but PAVE attach failed: ${baseMsg}. You can retry from the detail view.`
            : baseMsg,
        );
      } else {
        setErr(baseMsg);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitLabel = (() => {
    if (!busy) return 'Submit request';
    if (stage === 'uploading_pave') return 'Uploading PAVE…';
    if (stage === 'parsing_pave') return 'Parsing PAVE…';
    return 'Creating request…';
  })();

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

          {/* PAVE PDF — optional but recommended. Backend parses it
              right after upload with pdftotext (poppler-utils).
              Extracted: VIN, year/make/model, inspection date, scores,
              full damage list. The DSP doesn't see the parse output in
              the modal — it's surfaced in the detail row after the
              request lands. */}
          <div>
            <label className="text-xs font-semibold text-text-strong block mb-1.5 flex items-center gap-1.5">
              <FileBadge size={12} className="text-accent-purple" />
              PAVE report (optional)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={onPickFile}
              className="hidden"
            />
            {!paveFile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-navy-700 hover:border-accent-purple/50 hover:bg-navy-800/40 transition-all text-sm text-navy-300 cursor-pointer disabled:opacity-50"
              >
                <Upload size={14} className="text-navy-400" />
                Click to attach PAVE PDF
              </button>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-purple/10 border border-accent-purple/40">
                <FileText size={14} className="text-accent-purple shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-strong truncate">{paveFile.name}</div>
                  <div className="text-[10px] text-navy-400">{Math.round(paveFile.size / 1024)} KB</div>
                </div>
                {!busy && (
                  <button
                    type="button"
                    onClick={() => setPaveFile(null)}
                    className="text-navy-400 hover:text-accent-red p-1 cursor-pointer"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            <div className="text-[10px] text-navy-500 mt-1">
              PDF only · max 25 MB · parsed automatically (VIN, scores, damage list)
            </div>
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
              Phase 1 ships text-mode + PAVE PDF upload &amp; parsing. Parts picker, target-grade selector, and the vendor quote queue come in Phase 2.
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
            {submitLabel}
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
