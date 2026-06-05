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
  RefreshCw, Trash2,
} from 'lucide-react';
import {
  bodyRepair as bodyRepairApi,
  vehicles as vehiclesApi,
  uploads as uploadsApi,
  getAccessToken,
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
  const [deleteBusy, setDeleteBusy] = useState(false);
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

  // Delete is allowed only while pending_quotes (backend enforces it
  // too — this just hides the button so the user doesn't see a dead
  // action). DSP owners delete their own drafts; site_admin can delete
  // anyone's (operator cleanup). Body repair vendors can never delete.
  const canDelete = (
    (user?.role === 'dsp_owner' || user?.role === 'site_admin')
    && req.status === 'pending_quotes'
    && !isBodyRepairVendor
  );
  const onDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete draft request ${req.id} for Van ${req.vehicleFleetId || req.vehicleId}? This cannot be undone.`)) {
      return;
    }
    setDeleteBusy(true);
    try {
      await bodyRepairApi.remove(req.id);
      onReload?.();
    } catch (err) {
      const msg = err instanceof APIError ? (err.detail || err.message) : (err?.message || 'delete failed');
      alert(`Could not delete: ${msg}`);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-navy-700 bg-navy-900/60 overflow-hidden">
      {/* Header is a clickable row to toggle expansion. The delete
          button is a SIBLING (not nested) — putting a <button> inside
          another <button> is invalid HTML and Chrome was eating the
          click target. */}
      <div className="flex items-center gap-2 px-4 py-3 hover:bg-navy-800/40 transition-colors">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center justify-between gap-3 text-left min-w-0"
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
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleteBusy}
            className="shrink-0 p-1.5 rounded-md text-navy-500 hover:text-accent-red hover:bg-accent-red/10 transition-colors disabled:opacity-40 cursor-pointer"
            title="Delete this draft request"
          >
            {deleteBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-4 py-3 border-t border-navy-700/60 bg-navy-900/40 text-sm space-y-3">
          {/* Submission mode pill — Notes / Parts / Grade. */}
          <div className="flex items-center gap-2 flex-wrap">
            {req.submissionMode === 'text' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-accent-blue/15 text-accent-blue border border-accent-blue/40">
                <FileText size={10} /> Free-form notes
              </span>
            )}
            {req.submissionMode === 'parts' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-accent-purple/15 text-accent-purple border border-accent-purple/40">
                <FileBadge size={10} /> Picked parts
              </span>
            )}
            {req.submissionMode === 'grade' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-accent-gold/15 text-accent-gold border border-accent-gold/40">
                <CheckCircle2 size={10} /> Target grade: {req.targetGrade || '—'}
              </span>
            )}
          </div>

          {/* Repeating Notes issues — shown when the customer used the
              "A · Notes" list (text or alongside parts/grade). */}
          {Array.isArray(req.scopeBlob?.issues) && req.scopeBlob.issues.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-navy-500 font-semibold mb-1 flex items-center gap-1">
                <FileText size={10} /> Customer notes ({req.scopeBlob.issues.length})
              </div>
              <div className="space-y-1">
                {req.scopeBlob.issues.map((it, i) => (
                  <div key={i} className="text-text-strong text-xs px-2 py-1 rounded-md bg-navy-800/40 border border-navy-700/40">
                    <span className="text-navy-500 mr-1">{i + 1}.</span>
                    <span className="whitespace-pre-wrap">{it.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Picked parts — shown for parts mode. */}
          {Array.isArray(req.scopeBlob?.pickedComponents) && req.scopeBlob.pickedComponents.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-navy-500 font-semibold mb-1 flex items-center gap-1">
                <FileBadge size={10} /> Picked damages ({req.scopeBlob.pickedComponents.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {req.scopeBlob.pickedComponents.map((p, i) => (
                  <span
                    key={`${p.itemNo}-${i}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-accent-purple/10 text-accent-purple border border-accent-purple/40"
                  >
                    <span className="font-mono text-[9px] opacity-70">#{p.itemNo}</span>
                    <span>{p.componentName || 'Component'}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Free-text description — supplemental "notes for vendor"
              for any mode, or the main payload for legacy text mode. */}
          {req.textDescription && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-navy-500 font-semibold mb-1 flex items-center gap-1">
                <FileText size={10} /> Notes for the vendor
              </div>
              <p className="text-text-strong whitespace-pre-wrap text-xs">{req.textDescription}</p>
            </div>
          )}
          {!req.textDescription
            && !(req.scopeBlob?.issues?.length)
            && !(req.scopeBlob?.pickedComponents?.length)
            && req.submissionMode !== 'grade' && (
            <p className="text-navy-400 italic text-xs">No description provided.</p>
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
// ─────────────────────────────────────────────────────
// CreateRequestModal — PAVE-first 2-step flow (Jorge 2026-06-05).
// Mirrors NOVABODY/web@mbk/body-repair-demo's BodyRepair.tsx step
// architecture (line 386 onward in the demo):
//
//   Step 1  PAVE report
//     - Upload PDF (or skip)
//     - Parsed inline; preview shown with VIN / scores / damage count
//   Step 2  Scope & notes
//     - Vehicle picker (with ✓/⚠ VIN-match indicator from Step 1)
//     - Free-text description (parts picker + grade mode = Phase 2c)
//     - Submit → create request → attach the already-parsed PAVE
//
// Key behaviour vs the previous text-first flow:
//   - Parse happens BEFORE create — if it fails, nothing is orphaned.
//   - The parsed VIN drives the vehicle-match indicator; the customer
//     can spot a mis-uploaded PAVE before submitting.
//   - The same storage_key from the preview upload gets attached to
//     the new request, so we don't re-upload to MinIO.
// ─────────────────────────────────────────────────────
function CreateRequestModal({ user, onClose, onCreated }) {
  const isSiteAdmin = user?.role === 'site_admin';

  // Step 1 — PAVE state
  const [paveFile, setPaveFile] = useState(null);
  // paveData = { storageKey, vin, year, make, model, totalScore,
  //              damageCount, parseStatus, parseWarnings }
  const [paveData, setPaveData] = useState(null);
  // 'idle' | 'uploading_pave' | 'parsing_pave' | 'creating' | 'attaching_pave'
  const [stage, setStage] = useState('idle');
  // Skip state — customer chose "no PAVE", proceed directly to Step 2.
  const [paveSkipped, setPaveSkipped] = useState(false);

  // Step 2 — request state
  const [vehicleOptions, setVehicleOptions] = useState([]);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  // Submission mode: 'text' | 'parts' | 'grade'. The form changes
  // shape based on this — text shows repeating issues, parts shows
  // the picker button, grade shows the target-grade selector.
  const [mode, setMode] = useState('text');
  // Repeating issues (text mode + parts mode). Each entry is
  // { description, photoFile?, photoStorageKey? } — photos upload
  // later when the user submits (Phase 2c-2 will inline them).
  const [issues, setIssues] = useState([{ description: '' }]);
  const [text, setText] = useState('');                     // single-shot fallback
  // Parts mode: list of selected item_nos from the parsed PAVE.
  const [pickedItemNos, setPickedItemNos] = useState([]);
  const [pickOpen, setPickOpen] = useState(false);
  // Grade mode: target FCG (3-5 per the demo's MIN/MAX).
  const [targetGrade, setTargetGrade] = useState(4);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileInputRef = useRef(null);
  // URL-paste flow: paveapi.com URL or any HTTPS PDF link.
  const [paveUrl, setPaveUrl] = useState('');

  // Step 2 is unlocked once PAVE is parsed OR the customer skips.
  const onStep2 = paveData !== null || paveSkipped;

  useEffect(() => {
    vehiclesApi
      .list({ perPage: 100, search: vehicleSearch || undefined })
      .then((res) => setVehicleOptions(res?.items || []))
      .catch(() => setVehicleOptions([]));
  }, [vehicleSearch]);

  // ── Step 1 — upload + parse PAVE (no DB row created) ───
  // The file picker fires this directly. We upload to MinIO via the
  // preview kind (no request parent yet), then call /pave/parse-preview
  // which returns the summary. If anything fails, paveData stays null
  // and the user can retry.
  const onPickFile = async (e) => {
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
    setBusy(true);
    setStage('uploading_pave');
    try {
      const { uploadUrl, storageKey } = await uploadsApi.presigned({
        kind: 'body_repair_pave_preview',
        // parent_id is required by the schema but ignored for the
        // preview kind on the backend — pass a placeholder.
        parentId: 'preview',
        filename: f.name,
        contentType: f.type || 'application/pdf',
        sizeBytes: f.size,
      });
      await uploadsApi.putToPresigned(uploadUrl, f, 'application/pdf');
      setStage('parsing_pave');
      const parsed = await bodyRepairApi.parsePavePreview({ storageKey });
      setPaveData(parsed);
    } catch (err2) {
      const msg = err2 instanceof APIError ? (err2.detail || err2.message) : (err2?.message || 'PAVE upload failed');
      setErr(msg);
      setPaveFile(null);
    } finally {
      setBusy(false);
      setStage('idle');
    }
  };

  const onChangePave = () => {
    setPaveFile(null);
    setPaveData(null);
    setPaveSkipped(false);
    setPaveUrl('');
    setErr(null);
  };

  // ── Step 1 alt — fetch PAVE from URL (paveapi.com etc.) ───
  const onSyncUrl = async () => {
    const url = paveUrl.trim();
    if (!url) return;
    setErr(null);
    setBusy(true);
    setStage('uploading_pave');
    try {
      const parsed = await bodyRepairApi.ingestPaveUrl({ url });
      setPaveData(parsed);
    } catch (err2) {
      const msg = err2 instanceof APIError ? (err2.detail || err2.message) : (err2?.message || 'PAVE fetch failed');
      setErr(msg);
    } finally {
      setBusy(false);
      setStage('idle');
    }
  };

  // VIN-match indicator for Step 2 — green if the selected vehicle's
  // VIN matches the PAVE's VIN, amber otherwise, hidden if either side
  // doesn't have a VIN to compare.
  const selectedVehicle = vehicleOptions.find((v) => String(v.id) === String(vehicleId)) || null;
  const vinMatch = (() => {
    if (!paveData?.vin || !selectedVehicle?.vin) return null;
    return paveData.vin.trim().toUpperCase() === selectedVehicle.vin.trim().toUpperCase();
  })();

  // ── Step 2 — Submit: create request + attach PAVE if present ───
  const submit = async () => {
    setErr(null);
    if (!vehicleId) {
      setErr('Pick the vehicle this request is for.');
      return;
    }
    // Mode-specific validation, mirrors the backend.
    const cleanedIssues = issues
      .map((it) => ({ description: (it.description || '').trim() }))
      .filter((it) => it.description.length > 0);
    if (mode === 'text') {
      if (cleanedIssues.length === 0 && !text.trim()) {
        setErr('Add at least one issue or describe the damage in text.');
        return;
      }
    } else if (mode === 'parts') {
      if (pickedItemNos.length === 0) {
        setErr('Pick at least one part to repair.');
        return;
      }
    } else if (mode === 'grade') {
      if (!Number.isInteger(targetGrade) || targetGrade < 2 || targetGrade > 5) {
        setErr('Choose a target grade.');
        return;
      }
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
      // 1. Create the request — mode-specific payload.
      const createBody = {
        vehicleId: intId,
        mode,
        textDescription: text.trim() || undefined,
      };
      if (cleanedIssues.length > 0) {
        createBody.issues = cleanedIssues;
      }
      if (mode === 'parts') {
        // Map picked item_nos back to {item_no, component_name} pairs.
        const compMap = new Map();
        (paveData?.components || []).forEach((c) => {
          (c.damages || []).forEach((d) => {
            if (d.itemNo != null) compMap.set(d.itemNo, c.name);
          });
        });
        createBody.pickedComponents = pickedItemNos.map((n) => ({
          itemNo: n,
          componentName: compMap.get(n) || null,
        }));
      }
      if (mode === 'grade') {
        createBody.targetGrade = targetGrade;
      }
      createdRequest = await bodyRepairApi.create(createBody);

      // 2. If we have a parsed PAVE, attach it. The PDF is already in
      //    MinIO from Step 1 — we just re-reference the storage_key.
      //    Re-parse on the backend (~sub-second; cheaper than threading
      //    the parsed dict through a body).
      if (paveData?.storageKey && createdRequest?.id) {
        setStage('attaching_pave');
        await bodyRepairApi.attachPave(createdRequest.id, {
          storageKey: paveData.storageKey,
          fileSizeBytes: paveFile?.size,
          phase: 'pre',
          source: 'upload',
        });
      }

      setStage('done');
      onCreated?.();
    } catch (e) {
      const baseMsg = e instanceof APIError ? (e.detail || e.message) : (e?.message || 'Failed to submit');
      // If attach failed AFTER create, roll the request back.
      if (stage === 'attaching_pave' && createdRequest?.id) {
        try { await bodyRepairApi.remove(createdRequest.id); } catch { /* noop */ }
        setErr(`PAVE attach failed: ${baseMsg}. Your draft request was rolled back — try again.`);
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
    if (stage === 'attaching_pave') return 'Attaching PAVE…';
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
          {/* Step pills — Step 1 done as soon as PAVE is parsed OR
              skipped; Step 2 is the create form. */}
          <div className="flex items-center gap-3 text-xs">
            <StepPill n={1} label="PAVE report" state={onStep2 ? 'done' : 'current'} />
            <span className="h-px w-8 bg-navy-700" />
            <StepPill n={2} label="Scope & vehicle" state={onStep2 ? 'current' : 'idle'} />
          </div>

          {!onStep2 ? (
            // ── Step 1 — PAVE upload or skip ─────────────────
            <div className="rounded-lg border border-navy-800 bg-navy-950/40 p-4 space-y-3">
              <div className="text-sm font-semibold text-white">Step 1 · PAVE report</div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={onPickFile}
                className="hidden"
              />
              {!paveFile ? (
                <>
                  {/* URL paste — mirrors the demo's "PAVE report URL" input + Sync button. */}
                  <div>
                    <label className="block text-[11px] text-navy-300 mb-1 font-semibold">
                      PAVE report URL
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={paveUrl}
                        onChange={(e) => setPaveUrl(e.target.value)}
                        placeholder="https://reports.paveapi.com/api/report/…"
                        disabled={busy}
                        className="flex-1 rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder:text-navy-500 outline-none focus:border-accent-purple disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={onSyncUrl}
                        disabled={busy || !paveUrl.trim()}
                        className="px-3 py-2 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:bg-accent-blue/85 disabled:opacity-40 cursor-pointer"
                      >
                        Sync
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-navy-500 text-center">— or —</div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed border-navy-700 hover:border-accent-purple/50 hover:bg-navy-800/40 transition-all text-sm text-navy-300 cursor-pointer disabled:opacity-50"
                  >
                    <Upload size={16} className="text-navy-400" />
                    Upload PAVE PDF
                  </button>
                  <div className="text-[11px] text-navy-500 text-center">— or —</div>
                  <button
                    type="button"
                    onClick={() => setPaveSkipped(true)}
                    disabled={busy}
                    className="w-full text-center text-xs text-accent-blue hover:underline cursor-pointer disabled:opacity-50"
                  >
                    Skip — I'll describe the damage in text
                  </button>
                  <div className="text-[10px] text-navy-500 mt-2 text-center">
                    PDF only · max 25 MB · parsed automatically (VIN, scores, damage list)
                  </div>
                </>
              ) : busy ? (
                <div className="flex items-center gap-2 px-3 py-3 rounded-lg bg-accent-purple/10 border border-accent-purple/40">
                  <Loader2 size={14} className="text-accent-purple animate-spin" />
                  <div className="text-sm text-white">
                    {stage === 'uploading_pave' ? 'Uploading PDF…' : 'Parsing PAVE…'}
                  </div>
                </div>
              ) : null}
              {err && (
                <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-xs text-accent-red flex items-center gap-2">
                  <AlertTriangle size={12} />
                  {err}
                </div>
              )}
            </div>
          ) : (
            // ── Step 2 — form ────────────────────────────────
            <>
              {paveData ? (
                <PaveSummaryCard pave={paveData} onChange={onChangePave} />
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-navy-800 bg-navy-950/40 px-3 py-2 text-sm">
                  <span className="text-navy-300">No PAVE attached.</span>
                  <button
                    type="button"
                    className="text-accent-blue hover:underline text-xs cursor-pointer"
                    onClick={onChangePave}
                  >
                    Attach PAVE
                  </button>
                </div>
              )}

              <div className="rounded-lg border border-navy-800 bg-navy-950/40 p-4 space-y-4">
                <div className="text-sm font-semibold text-white">Step 2 · Scope & vehicle</div>

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
                  {/* VIN match indicator — only when both sides have a VIN. */}
                  {paveData?.vin && selectedVehicle?.vin && (
                    vinMatch ? (
                      <div className="text-[11px] text-accent-green mt-1.5 flex items-center gap-1">
                        <CheckCircle2 size={11} /> Vehicle VIN matches PAVE.
                      </div>
                    ) : (
                      <div className="text-[11px] text-accent-orange mt-1.5 flex items-center gap-1">
                        <AlertTriangle size={11} /> VIN mismatch — PAVE has {paveData.vin}.
                      </div>
                    )
                  )}
                </div>

                {/* Mode tabs — text / parts / grade. Parts + grade
                    require a parsed PAVE (otherwise there's nothing to
                    pick from); we hide those tabs if pave was skipped. */}
                <div>
                  <div className="text-xs font-semibold text-text-strong block mb-1.5">
                    How do you want to scope the work?
                  </div>
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-navy-800/60 border border-navy-700 mb-3">
                    {['text', 'parts', 'grade'].map((m) => {
                      const disabled = (m === 'parts' || m === 'grade') && !paveData;
                      const labels = { text: 'Notes', parts: 'Pick parts', grade: 'Target grade' };
                      const sub = { text: 'free-form', parts: 'from PAVE', grade: 'reach FCG' };
                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={disabled}
                          onClick={() => setMode(m)}
                          title={disabled ? 'Attach a PAVE to enable this mode' : undefined}
                          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                            mode === m
                              ? 'bg-accent-purple text-white'
                              : 'text-navy-300 hover:text-white hover:bg-navy-800'
                          }`}
                        >
                          <div>{labels[m]}</div>
                          <div className="text-[9px] opacity-70">{sub[m]}</div>
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Mode: text ─────────────────────────────── */}
                  {mode === 'text' && (
                    <div className="space-y-2">
                      {issues.map((it, i) => (
                        <div key={i} className="rounded-lg bg-navy-900/40 border border-navy-800 p-2.5">
                          <div className="flex gap-2 items-start">
                            <textarea
                              value={it.description}
                              maxLength={2000}
                              rows={2}
                              onChange={(e) => {
                                const v = e.target.value;
                                setIssues((cur) => cur.map((x, j) => (j === i ? { ...x, description: v } : x)));
                              }}
                              placeholder={`Issue ${i + 1}: e.g. dent on driver-side rear panel`}
                              className="flex-1 rounded-md px-2 py-1.5 text-sm bg-navy-800 border border-navy-700 text-white placeholder:text-navy-500 outline-none focus:border-accent-purple resize-none"
                            />
                            {issues.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setIssues((cur) => cur.filter((_, j) => j !== i))}
                                className="text-navy-400 hover:text-accent-red p-1 cursor-pointer"
                                title="Remove"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setIssues((cur) => [...cur, { description: '' }])}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-navy-700 text-xs text-accent-blue hover:border-accent-blue hover:bg-navy-800/50 cursor-pointer"
                      >
                        <Plus size={11} /> Add another issue
                      </button>
                    </div>
                  )}

                  {/* ── Mode: parts ────────────────────────────── */}
                  {mode === 'parts' && (
                    <div className="rounded-lg border border-navy-800 bg-navy-900/40 p-3 flex items-center justify-between">
                      <div className="text-sm">
                        {pickedItemNos.length > 0 ? (
                          <>
                            <span className="font-semibold text-white">{pickedItemNos.length} damage{pickedItemNos.length === 1 ? '' : 's'} selected</span>
                            <span className="text-navy-400 text-xs"> from the parsed PAVE.</span>
                          </>
                        ) : (
                          <span className="text-navy-400">No parts selected yet.</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setPickOpen(true)}
                        className="px-3 py-1.5 rounded-md border border-navy-700 text-xs hover:border-accent-purple hover:bg-navy-800/60 cursor-pointer"
                      >
                        {pickedItemNos.length > 0 ? 'Edit selection' : 'Open picker'}
                      </button>
                    </div>
                  )}

                  {/* ── Mode: grade ────────────────────────────── */}
                  {mode === 'grade' && (
                    <div className="rounded-lg border border-navy-800 bg-navy-900/40 p-3 space-y-2">
                      <div className="text-xs text-navy-300 mb-1">
                        Pick the Fleet Condition Grade you want this van to reach. The vendor will scope the repairs that get you there.
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { g: 5, label: 'Great', desc: 'Like new' },
                          { g: 4, label: 'Good', desc: 'Light wear' },
                          { g: 3, label: 'Fair', desc: 'Compliance bar' },
                        ].map(({ g, label, desc }) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => setTargetGrade(g)}
                            className={`px-3 py-2 rounded-lg border-2 transition-colors text-center cursor-pointer ${
                              targetGrade === g
                                ? 'border-accent-purple bg-accent-purple/10'
                                : 'border-navy-700 hover:border-navy-500'
                            }`}
                          >
                            <div className="text-lg font-bold text-white">{g}</div>
                            <div className="text-[10px] font-semibold text-navy-300">{label}</div>
                            <div className="text-[9px] text-navy-500">{desc}</div>
                          </button>
                        ))}
                      </div>
                      {paveData?.currentGrade != null && (
                        <div className="text-[10px] text-navy-400 mt-2">
                          Current grade: <span className="font-semibold text-white">{paveData.currentGrade} ({paveData.gradeLabel})</span>
                          {targetGrade > paveData.currentGrade && (
                            <span className="text-accent-green"> · improvement</span>
                          )}
                          {targetGrade < paveData.currentGrade && (
                            <span className="text-accent-orange"> · downgrade?</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Free-text supplement — always visible regardless of mode. */}
                <div>
                  <label htmlFor="body-text" className="text-xs font-semibold text-text-strong block mb-1.5">
                    {mode === 'text' ? 'Additional notes' : 'Notes for the vendor'}
                    <span className="text-navy-500 text-[10px] ml-1">(optional)</span>
                  </label>
                  <textarea
                    id="body-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={mode === 'text' ? 'Any extra context…' : 'Anything else the vendor should know…'}
                    rows={3}
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
              </div>

              {/* Pick parts modal — opens from the parts-mode panel */}
              {pickOpen && paveData && (
                <PickPartsModal
                  components={paveData.components || []}
                  selected={pickedItemNos}
                  setSelected={setPickedItemNos}
                  storageKey={paveData.storageKey}
                  damageImageCount={paveData.damageImageCount || 0}
                  onClose={() => setPickOpen(false)}
                />
              )}
            </>
          )}
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
            disabled={!onStep2 || busy || !vehicleId || !text.trim()}
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
// PickPartsModal — interactive parts picker on parsed PAVE damages.
// Mirrors the demo's PickPartsModal at BodyRepair.tsx line 1729.
// Customer ticks individual damages; selected list is item_no based
// so the backend can re-resolve which components they picked.
// ─────────────────────────────────────────────────────
function PickPartsModal({ components, selected, setSelected, onClose, storageKey, damageImageCount }) {
  const toggleDamage = (itemNo) => {
    setSelected((cur) => {
      const has = cur.includes(itemNo);
      return has ? cur.filter((x) => x !== itemNo) : [...cur, itemNo];
    });
  };
  const toggleComponent = (comp) => {
    const itemNos = (comp.damages || []).map((d) => d.itemNo).filter((n) => n != null);
    const allSelected = itemNos.every((n) => selected.includes(n));
    setSelected((cur) => {
      if (allSelected) return cur.filter((n) => !itemNos.includes(n));
      // Add any missing.
      const next = new Set(cur);
      itemNos.forEach((n) => next.add(n));
      return Array.from(next);
    });
  };
  const totalSelected = selected.length;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-8 px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-navy-900 border border-navy-700 rounded-xl w-full max-w-3xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-navy-700">
          <div>
            <h3 className="text-base font-semibold text-white">Pick parts to repair</h3>
            <p className="text-[11px] text-navy-400">
              {totalSelected} damage{totalSelected === 1 ? '' : 's'} selected · choose specific items from the parsed PAVE.
            </p>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-2">
          {(components || []).length === 0 ? (
            <div className="text-sm text-navy-400 italic text-center py-8">
              No current damages on this PAVE report.
            </div>
          ) : (
            (components || []).map((c) => {
              const itemNos = (c.damages || []).map((d) => d.itemNo).filter((n) => n != null);
              const compAllSelected = itemNos.length > 0 && itemNos.every((n) => selected.includes(n));
              const compSomeSelected = itemNos.some((n) => selected.includes(n));
              return (
                <div
                  key={c.name + (c.itemNos || []).join(',')}
                  className={`rounded-lg border ${
                    c.priority ? 'border-accent-red/40 bg-accent-red/5' : 'border-navy-700 bg-navy-800/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleComponent(c)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-navy-800/70 transition-colors"
                  >
                    <span
                      className={`inline-flex w-4 h-4 rounded border-2 items-center justify-center shrink-0 ${
                        compAllSelected
                          ? 'bg-accent-blue border-accent-blue'
                          : compSomeSelected
                          ? 'bg-accent-blue/30 border-accent-blue'
                          : 'border-navy-600 bg-transparent'
                      }`}
                    >
                      {compAllSelected && <CheckCircle2 size={10} className="text-white" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-sm">{c.name}</span>
                        {c.priority && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-red/20 text-accent-red font-semibold">
                            Priority
                          </span>
                        )}
                        {c.worstScore != null && (
                          <span className="text-[10px] text-navy-400">worst: {c.worstScore}</span>
                        )}
                        <span className="text-[10px] text-navy-500">{(c.damages || []).length} damage{(c.damages || []).length === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  </button>
                  <div className="pl-9 pr-3 pb-2 space-y-1">
                    {(c.damages || []).map((d) => {
                      const isSel = selected.includes(d.itemNo);
                      const showThumb = storageKey
                        && damageImageCount
                        && typeof d.photoIndex === 'number'
                        && d.photoIndex < damageImageCount;
                      return (
                        <button
                          key={d.itemNo}
                          type="button"
                          onClick={() => toggleDamage(d.itemNo)}
                          className={`w-full grid grid-cols-[18px_30px_44px_1fr_60px_50px] gap-2 items-center px-2 py-1 rounded-md text-left text-xs hover:bg-navy-800 transition-colors ${
                            isSel ? 'bg-accent-blue/10' : ''
                          }`}
                        >
                          <span
                            className={`inline-flex w-3.5 h-3.5 rounded border items-center justify-center shrink-0 ${
                              isSel
                                ? 'bg-accent-blue border-accent-blue'
                                : 'border-navy-600 bg-transparent'
                            }`}
                          >
                            {isSel && <CheckCircle2 size={8} className="text-white" />}
                          </span>
                          <span className="text-navy-500 font-mono text-[10px]">#{d.itemNo}</span>
                          {showThumb ? (
                            <AuthImg
                              src={paveImageUrl(storageKey, 'damage', d.photoIndex)}
                              alt={`Damage ${d.itemNo}`}
                              className="w-10 h-10 rounded border border-navy-700 object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded border border-navy-800 bg-navy-900" />
                          )}
                          <span className="text-navy-300 truncate">
                            {d.damageType ? d.damageType.replace(/_/g, ' ') : '—'}
                            {d.severity ? <span className="text-navy-500"> · {d.severity}</span> : null}
                          </span>
                          <span className="text-navy-400 text-[10px]">
                            {d.side || '—'}
                          </span>
                          <span className="text-right">
                            {d.fleetScore != null ? (
                              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                                d.isPriority ? 'bg-accent-red text-white' : 'bg-navy-700 text-white'
                              }`}>
                                {d.fleetScore}
                              </span>
                            ) : (
                              <span className="text-navy-500">—</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="px-5 py-3 border-t border-navy-700 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setSelected([])}
            disabled={totalSelected === 0}
            className="px-3 py-2 rounded-lg text-xs text-navy-400 hover:text-white disabled:opacity-40 cursor-pointer"
          >
            Clear all
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent-purple text-white hover:bg-accent-purple/85 cursor-pointer"
          >
            Done · {totalSelected} selected
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────
// StepPill — the "1 PAVE / 2 Scope" indicator in the create modal.
// State drives the visual: idle (gray), current (purple), done (green).
// Mirrors the demo's StepPill in BodyRepair.tsx (line 405).
// ─────────────────────────────────────────────────────
function StepPill({ n, label, state }) {
  const cls = {
    idle:    'bg-navy-800 text-navy-400 border-navy-700',
    current: 'bg-accent-purple/15 text-accent-purple border-accent-purple/40',
    done:    'bg-accent-green/15 text-accent-green border-accent-green/40',
  }[state] || 'bg-navy-800 text-navy-400 border-navy-700';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${cls}`}>
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-current/10 text-[10px]">
        {state === 'done' ? '✓' : n}
      </span>
      {label}
    </span>
  );
}

// Build a backend URL for a categorized PAVE thumbnail. The endpoint
// proxies the JPEG bytes (kept private — no presigned link leaked).
// The Authorization header is required, so we hit the apiFetch path
// via a blob URL would normally be needed; for now we rely on the
// browser sending the cookie/header for our same-origin requests in
// dev + the `Authorization` set via the fetch wrapper for prod.
// In <img src=...> we use the apiFetch token bridge: the URL points
// at /api which the Vite proxy + prod LB handle with the bearer.
function paveImageUrl(storageKey, category, idx) {
  // The backend mounts /body-repair under the API root; we use the
  // env-driven base url so dev / prod / preview all work.
  const base = (import.meta?.env?.VITE_API_BASE_URL) || '';
  const params = new URLSearchParams({
    storage_key: storageKey,
    category,
    idx: String(idx),
  });
  return `${base}/body-repair/pave/image?${params.toString()}`;
}

// Authenticated <img> — img tags don't carry the bearer token
// automatically. This component fetches the image via apiFetch (which
// adds the JWT) and renders the result as a blob URL. Cleans up the
// URL on unmount.
function AuthImg({ src, alt, className, onError }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setBlobUrl(null);
    const token = getAccessToken();
    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        setBlobUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onError?.();
      });
    return () => {
      cancelled = true;
    };
  }, [src, onError]);
  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);
  if (failed) {
    return <div className={`${className} bg-navy-900 flex items-center justify-center text-[9px] text-navy-500`}>no img</div>;
  }
  if (!blobUrl) {
    return <div className={`${className} bg-navy-900 flex items-center justify-center`}>
      <Loader2 size={12} className="text-navy-600 animate-spin" />
    </div>;
  }
  return <img src={blobUrl} alt={alt} className={className} />;
}

// ─────────────────────────────────────────────────────
// PaveSummaryCard — rich preview matching the demo's Step 2 card
// (NOVABODY/web BodyRepair.tsx line 1204). Renders:
//   - vehicle header (year/make/model + VIN + inspection date)
//   - grade badge (A/B/C/D from grade 5..2) with FCS label
//   - priority + at-risk pills
//   - "Score by side" 5-cell grid (Front / Back / Left / Right / Total)
//   - parse warnings
//
// The panel/damage thumbnail row + "Top priority damages" table from
// the demo land with Phase 2c (parts picker — also needs the
// per-component grouping from pave_parser's damage list).
// ─────────────────────────────────────────────────────
const GRADE_COLOR_CLS = {
  5: 'border-accent-green/60 text-accent-green',
  4: 'border-accent-blue/60 text-accent-blue',
  3: 'border-accent-gold/60 text-accent-gold',
  2: 'border-accent-orange/60 text-accent-orange',
  1: 'border-accent-red/60 text-accent-red',
  0: 'border-accent-red/80 text-accent-red',
};

function PaveSummaryCard({ pave, onChange }) {
  const failed = pave.parseStatus === 'failed';
  const grade = pave.grade;
  const gradeCls = grade != null ? (GRADE_COLOR_CLS[grade] || 'border-navy-700 text-navy-200') : 'border-navy-700 text-navy-400';
  const sides = [
    ['Front', pave.sideCounts?.front],
    ['Back',  pave.sideCounts?.back],
    ['Left',  pave.sideCounts?.left],
    ['Right', pave.sideCounts?.right],
  ];
  const totalDamages = pave.allDamagesCount ?? pave.sideCountsTotal ?? pave.damageCount ?? null;

  return (
    <div className={`rounded-lg border p-4 ${
      failed
        ? 'bg-accent-red/5 border-accent-red/40'
        : 'bg-navy-950/40 border-navy-800'
    }`}>
      <div className="flex items-start gap-4">
        {/* Panel thumbnail — first wide-aspect image extracted by
            pdfimages. Shown only when at least one panel made it
            through extraction. */}
        {pave.storageKey && pave.panelImageCount > 0 && (
          <AuthImg
            src={paveImageUrl(pave.storageKey, 'panel', 0)}
            alt="PAVE panel shot"
            className="w-28 h-20 rounded-lg border border-navy-700 object-cover shrink-0"
          />
        )}
        {/* Grade badge */}
        <div
          className={`flex flex-col items-center justify-center w-16 h-16 rounded-xl border-2 ${gradeCls} shrink-0`}
          title={pave.gradeDefinition || undefined}
        >
          <span className="text-2xl font-bold leading-none">{grade != null ? grade : '?'}</span>
          <span className="text-[10px] mt-0.5 uppercase">{pave.gradeLabel || '—'}</span>
        </div>
        {/* Vehicle header */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold text-white truncate">
              {pave.year ? `${pave.year} ${pave.make || ''} ${pave.model || ''}`.trim() : 'Vehicle'}
            </h4>
            <button
              type="button"
              onClick={onChange}
              className="text-[11px] text-navy-400 hover:text-white shrink-0 cursor-pointer"
            >
              ← Change PAVE
            </button>
          </div>
          {pave.vin && (
            <div className="text-[11px] text-navy-400 font-mono">VIN {pave.vin}</div>
          )}
          {pave.inspectionDateUtc && (
            <div className="text-[10px] text-navy-500">
              Inspected {String(pave.inspectionDateUtc).slice(0, 10)}
            </div>
          )}
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {failed && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent-red/20 text-accent-red font-semibold">
                <AlertTriangle size={9} /> Parse failed
              </span>
            )}
            {pave.priorityDetected && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-red/20 text-accent-red font-semibold">
                Priority damages
              </span>
            )}
            {pave.atRiskOfGrounding && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-red/20 text-accent-red font-semibold">
                At risk of grounding
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Score by side — only shown when parsing succeeded */}
      {!failed && (
        <>
          <div className="text-[10px] uppercase tracking-wider text-navy-500 mt-4 mb-1">
            Damages by side
          </div>
          <div className="grid grid-cols-5 gap-2">
            {sides.map(([label, n]) => (
              <div key={label} className="rounded-lg bg-navy-900/60 border border-navy-800 py-2 text-center">
                <div className="text-lg font-semibold text-white">{n ?? '—'}</div>
                <div className="text-[10px] text-navy-400 uppercase">{label}</div>
              </div>
            ))}
            <div className="rounded-lg bg-navy-900/60 border border-accent-blue/40 py-2 text-center">
              <div className="text-lg font-semibold text-accent-blue">
                {totalDamages ?? '—'}
              </div>
              <div className="text-[10px] text-navy-400 uppercase">Total</div>
            </div>
          </div>
        </>
      )}

      {/* Top priority damages — "must repair to exit Poor" table.
          Mirrors the demo's table at BodyRepair.tsx line 1285 with
          damage photo crops per row. */}
      {!failed && Array.isArray(pave.priorityComponentsTop) && pave.priorityComponentsTop.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-navy-500 mb-1.5">
            Top priority damages
          </div>
          <div className="rounded-lg border border-navy-800 overflow-hidden">
            <div className="grid grid-cols-[1.4fr_44px_60px_50px_1fr] gap-2 px-2 py-1 text-[10px] uppercase tracking-wider text-navy-500 border-b border-navy-800 bg-navy-900/40">
              <span>Component</span>
              <span className="text-center">Photo</span>
              <span className="text-center">Worst</span>
              <span className="text-center">Count</span>
              <span>Top damage</span>
            </div>
            {pave.priorityComponentsTop.map((c, i) => {
              const topDamage = (c.damages || []).find((d) => d.isPriority) || (c.damages || [])[0];
              const dmgScore = topDamage?.fleetScore ?? c.worstScore;
              const showThumb = pave.storageKey
                && pave.damageImageCount
                && typeof topDamage?.photoIndex === 'number'
                && topDamage.photoIndex < pave.damageImageCount;
              return (
                <div
                  key={`${c.name}-${i}`}
                  className="grid grid-cols-[1.4fr_44px_60px_50px_1fr] gap-2 px-2 py-1.5 text-xs items-center border-b border-navy-800/50 last:border-0 bg-accent-red/[0.05]"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-tight truncate">{c.name}</div>
                    <span className="inline-block mt-0.5 text-[9px] px-1 py-0.5 rounded bg-accent-red/20 text-accent-red font-semibold">
                      Priority
                    </span>
                  </div>
                  <div className="flex items-center justify-center">
                    {showThumb ? (
                      <AuthImg
                        src={paveImageUrl(pave.storageKey, 'damage', topDamage.photoIndex)}
                        alt={`Damage ${topDamage.itemNo}`}
                        className="w-10 h-10 rounded border border-navy-700 object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded border border-navy-800 bg-navy-900" />
                    )}
                  </div>
                  <div className="text-center">
                    {dmgScore != null ? (
                      <span className="inline-flex items-center justify-center rounded-full w-6 h-6 text-[10px] font-bold bg-accent-red text-white">
                        {dmgScore}
                      </span>
                    ) : (
                      <span className="text-navy-500">—</span>
                    )}
                  </div>
                  <div className="text-center text-navy-300 font-semibold">{c.damageCount}</div>
                  <div className="min-w-0 text-[11px] text-navy-300 truncate">
                    {topDamage?.damageType ? topDamage.damageType.replace(/_/g, ' ') : '—'}
                    {topDamage?.severity ? <span className="text-navy-500"> · {topDamage.severity}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {Array.isArray(pave.parseWarnings) && pave.parseWarnings.length > 0 && (
        <div className="text-[10px] text-accent-orange mt-3">
          {pave.parseWarnings[0]}
          {pave.parseWarnings.length > 1 && ` (+${pave.parseWarnings.length - 1} more)`}
        </div>
      )}
    </div>
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
