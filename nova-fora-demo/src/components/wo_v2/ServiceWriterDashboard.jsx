/**
 * Service Writer dashboard — full table + per-row vendor-lifecycle actions.
 *
 * Layout matches the spec demo:
 *   1. Workshop selector (for vendors with multiple shops / site_admin)
 *   2. 8 status chips (counter-driven, single fetch)
 *   3. CUSTOMER CONFIRMED PICKUP — horizontal card strip
 *   4. INCOMING REQUESTS — pending_acceptance WOs waiting for vendor decision
 *   5. Main WO table with status filter + per-row contextual actions
 *   6. Click a row → SwWoModal (defer/mid-find/notes/assign-tech etc.,
 *      built incrementally — task #29 expands it)
 *
 * Per-row actions are computed from wo.status:
 *   - pending_acceptance: Accept · Decline
 *   - accepted:           Send pickup (or Start if pickup already confirmed) · Cancel
 *   - in_progress:        Complete · Cancel
 *   - terminal:           none
 *
 * Tenancy is enforced server-side — vendor users only see their own
 * workshops' WOs regardless of params. We pass vendorWorkshopId for
 * site_admin (who otherwise sees all) so the table matches the active chip set.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ClipboardList, Loader2, AlertTriangle, RefreshCw, Hourglass, Briefcase,
  PackageCheck, Truck, PlayCircle, CheckCircle2, XCircle, Check, X,
  Flame, ChevronRight, ChevronDown, MapPin, KeyRound, User as UserIcon, Calendar,
  ArrowRight, MoreVertical,
} from 'lucide-react';
import {
  workOrders as woApi,
  repairRequests as rrApi,
  vendorWorkshops as workshopsApi,
  dashboards as dashboardsApi,
} from '../../api/client';
import VanDetailView from './VanDetailView';
import DeclineModal from './DeclineModal';
import CompleteModal from './CompleteModal';
import ScheduleModal from './ScheduleModal';
import ReviewRequestModal from './ReviewRequestModal';
import CreateWoWizard from './CreateWoWizard';
import RoModal from './RoModal';
import StatusChanger from './StatusChanger';

// ─────────────────────────────────────────────────────
// Chip catalog (8 buckets, derived from wo.status + primary RO state)
// ─────────────────────────────────────────────────────
const CHIPS = [
  { id: 'pending',           label: 'Pending',           icon: Hourglass,    color: 'text-accent-gold',   bg: 'bg-accent-gold/10',   border: 'border-accent-gold/40',   filter: (wo) => wo.status === 'pending_acceptance' },
  { id: 'pendingParts',      label: 'Pending Parts',     icon: PackageCheck, color: 'text-accent-orange', bg: 'bg-accent-orange/10', border: 'border-accent-orange/40', filter: (wo) => { const r = primaryRo(wo); return wo.status === 'accepted' && r && r.partsOrderedAt && !r.partsReceivedAt; } },
  { id: 'pendingFmc',        label: 'Pending FMC',       icon: Briefcase,    color: 'text-accent-purple', bg: 'bg-accent-purple/10', border: 'border-accent-purple/40', filter: (wo) => { const r = primaryRo(wo); return wo.status === 'accepted' && r && r.submittedToFmcAt && !r.fmcApprovedAt; } },
  { id: 'readyToSchedule',   label: 'Ready to Schedule', icon: ClipboardList,color: 'text-accent-green',  bg: 'bg-accent-green/10',  border: 'border-accent-green/40',  filter: (wo) => { const r = primaryRo(wo); return wo.status === 'accepted' && (!r || (!r.partsOrderedAt && !r.submittedToFmcAt && !r.pickupType && !r.scheduledStartAt)); } },
  { id: 'awaitingCustomer',  label: 'Awaiting Customer', icon: Truck,        color: 'text-accent-blue',   bg: 'bg-accent-blue/10',   border: 'border-accent-blue/40',   filter: (wo) => { const r = primaryRo(wo); return wo.status === 'accepted' && r && r.pickupType && !r.scheduledStartAt; } },
  { id: 'inProgress',        label: 'In Progress',       icon: PlayCircle,   color: 'text-accent-blue',   bg: 'bg-accent-blue/10',   border: 'border-accent-blue/40',   filter: (wo) => wo.status === 'in_progress' },
  { id: 'completed',         label: 'Completed',         icon: CheckCircle2, color: 'text-accent-green',  bg: 'bg-accent-green/10',  border: 'border-accent-green/40',  filter: (wo) => wo.status === 'completed' },
  { id: 'declined',          label: 'Declined',          icon: XCircle,      color: 'text-accent-red',    bg: 'bg-accent-red/10',    border: 'border-accent-red/40',    filter: (wo) => wo.status === 'declined' },
];

const ALL_TERMINAL = new Set(['completed', 'cancelled', 'declined']);

function primaryRo(wo) {
  // List endpoint surfaces a compact `primary_ro` snapshot inline; the
  // detail endpoint exposes the full `ros` array. Prefer the inline
  // snapshot if present so SwWoRow doesn't need to fetch detail.
  if (wo?.primaryRo) return wo.primaryRo;
  if (Array.isArray(wo?.ros) && wo.ros.length > 0) {
    return wo.ros.find((r) => r.isPrimary) || wo.ros[0];
  }
  return null;
}

// ─────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────
export default function ServiceWriterDashboard({ user }) {
  const [workshops, setWorkshops] = useState([]);
  const [workshopId, setWorkshopId] = useState(null);
  const [counters, setCounters] = useState(null);
  const [wos, setWos] = useState([]);
  const [woLoading, setWoLoading] = useState(true);
  const [woError, setWoError] = useState(null);
  const [rrs, setRrs] = useState([]);
  const [chipFilter, setChipFilter] = useState(null);  // null = show all
  // Clicking a row opens the VAN detail (not the WO detail). The mental
  // model is "I want to see what's going on with this truck" — the SW
  // navigates by vehicle, not by RO. The lifecycle action buttons (accept /
  // decline / start / complete) still live on the row itself.
  const [openVehicleId, setOpenVehicleId] = useState(null);
  // Jorge#4: a separate state for the RO modal — opening an RO via
  // the RO# link doesn't navigate away from the dashboard.
  const [openRoWoId, setOpenRoWoId] = useState(null);
  const [actionModal, setActionModal] = useState(null);   // { kind: 'decline'|'complete', wo }
  const [error, setError] = useState(null);

  // ── Demo-parity filters (search / customer / priority / sort) ──
  // These layer on top of the chip filter — chips set the status bucket,
  // these refine within. Stored locally; no server round-trip per change.
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');     // '' = all
  const [priorityFilter, setPriorityFilter] = useState('all');  // 'all' | 'rush'
  const [sortBy, setSortBy] = useState('needs_action');         // see SORTS

  // ── Workshop bootstrap ─────────────────────────────
  useEffect(() => {
    workshopsApi
      .list({ includeInactive: false })
      .then((res) => {
        const items = res.items || [];
        const myOrgInt = parseOrgInt(user?.organizationId ?? user?.orgId);
        const mine = user?.role === 'site_admin'
          ? items
          : items.filter((w) => Number(w.organizationId) === myOrgInt);
        setWorkshops(mine);
        if (mine.length > 0) {
          setWorkshopId((cur) => cur ?? parseOrgInt(mine[0].id));
        }
      })
      .catch((err) => {
        console.warn('vendor-workshops failed', err);
        setError(err.message || 'Failed to load workshops');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Counter fetch ──────────────────────────────────
  const loadCounters = useCallback(() => {
    if (!workshopId) return;
    dashboardsApi
      .swCounters(workshopId)
      .then(setCounters)
      .catch((err) => {
        console.warn('swCounters failed', err);
      });
  }, [workshopId]);

  // ── WO list fetch ──────────────────────────────────
  const loadWos = useCallback(() => {
    setWoLoading(true);
    setWoError(null);
    const params = { limit: 250 };
    if (workshopId) params.vendorWorkshopId = workshopId;
    woApi
      .list(params)
      .then((res) => setWos(res.items || []))
      .catch((err) => {
        console.error('list_work_orders failed', err);
        setWoError(err.message || 'Failed to load work orders');
      })
      .finally(() => setWoLoading(false));
  }, [workshopId]);

  // ── Incoming RR fetch (status=open) ────────────────
  const loadRrs = useCallback(() => {
    // RR list isn't workshop-scoped server-side; we filter client-side
    // to only the ones routed to this workshop's repair_types.
    rrApi
      .list({ status: 'open', limit: 50 })
      .then((res) => setRrs(res.items || []))
      .catch((err) => {
        // Non-fatal — the panel just stays empty.
        console.warn('repair-requests list failed', err);
        setRrs([]);
      });
  }, []);

  useEffect(() => {
    loadCounters();
    loadWos();
    loadRrs();
  }, [loadCounters, loadWos, loadRrs]);

  const refreshAll = useCallback(() => {
    loadCounters();
    loadWos();
    loadRrs();
  }, [loadCounters, loadWos, loadRrs]);

  // ── Derived: confirmed-pickup cards (top section) ──
  const confirmedPickups = useMemo(() => {
    return wos.filter((wo) => {
      if (wo.status !== 'accepted') return false;
      const r = primaryRo(wo);
      return r && r.pickupRequestedAt && r.scheduledStartAt;
    });
  }, [wos]);

  // ── Derived: Incoming Requests = WOs in pending_acceptance
  // (these are the rows that surface a "review →" button so the SW
  // can pull up the new ReviewRequestModal). RR-based feed is noisy
  // (open RRs include ones already routed) — WOs in pending give us
  // exactly what the SW needs to act on right now.
  const incomingPendingWos = useMemo(
    () => wos.filter((w) => w.status === 'pending_acceptance'),
    [wos],
  );

  // ── Derived: list of unique customers (DSPs) for the dropdown ──
  // Sorted alphabetically; "All customers" is rendered as the empty value.
  const customerOptions = useMemo(() => {
    const seen = new Map();
    wos.forEach((w) => {
      const name = w.dspName || (w.dspId ? `DSP ${w.dspId}` : null);
      if (name && !seen.has(name)) seen.set(name, name);
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [wos]);

  // ── Derived: table rows after chip + filters + sort ────────────
  // Combined into one useMemo so the table only re-renders once per
  // filter change, not three times.
  const tableRows = useMemo(() => {
    let rows = wos;

    // Chip status filter (one of the 8 top chips, or null = no filter)
    if (chipFilter) {
      const chip = CHIPS.find((c) => c.id === chipFilter);
      if (chip) rows = rows.filter(chip.filter);
    }

    // Customer filter
    if (customerFilter) {
      rows = rows.filter((w) => (w.dspName || `DSP ${w.dspId}`) === customerFilter);
    }

    // Priority filter
    if (priorityFilter === 'rush') {
      rows = rows.filter((w) => w.isRush);
    }

    // Search — matches RO#, VIN, fleet id, van id, customer name (case-insensitive)
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((w) => {
        const ro = primaryRo(w);
        const hay = [
          w.id,
          ro?.roNumber,
          w.vehicleIdStr,
          w.vehicleFleetId,
          w.vehiclePlate,
          w.vehicleVin,
          w.dspName,
          w.workshopName,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }

    // Sort — operates on the filtered slice
    rows = [...rows];  // copy before sort
    switch (sortBy) {
      case 'van_number':
        rows.sort((a, b) => String(a.vehicleFleetId || a.vehicleIdStr || '').localeCompare(
          String(b.vehicleFleetId || b.vehicleIdStr || ''),
          undefined, { numeric: true },
        ));
        break;
      case 'customer_az':
        rows.sort((a, b) => String(a.dspName || '').localeCompare(String(b.dspName || '')));
        break;
      case 'captured_newest':
        rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'captured_oldest':
        rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case 'needs_action':
      default: {
        // Needs-action heuristic: RUSH first, then pending_acceptance,
        // then in_progress, then accepted (any sub-state), then terminal.
        const rank = (w) => {
          if (w.isRush && !['completed', 'cancelled', 'declined'].includes(w.status)) return 0;
          if (w.status === 'pending_acceptance') return 1;
          if (w.status === 'in_progress') return 2;
          if (w.status === 'accepted') return 3;
          return 9;
        };
        rows.sort((a, b) => {
          const d = rank(a) - rank(b);
          if (d !== 0) return d;
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
      }
    }

    return rows;
  }, [wos, chipFilter, customerFilter, priorityFilter, search, sortBy]);

  // ── Action handlers ────────────────────────────────
  const onAccept = useCallback(async (wo) => {
    setError(null);
    try {
      await woApi.accept(wo.id);
      refreshAll();
    } catch (e) {
      setError(`Accept failed: ${e.detail || e.message || 'unknown'}`);
    }
  }, [refreshAll]);

  const onStart = useCallback(async (wo) => {
    if (!window.confirm(`Start work on ${wo.id}? This flips status to in_progress.`)) return;
    setError(null);
    try {
      await woApi.start(wo.id);
      refreshAll();
    } catch (e) {
      setError(`Start failed: ${e.detail || e.message || 'unknown'}`);
    }
  }, [refreshAll]);

  const onCancel = useCallback(async (wo) => {
    const reason = window.prompt(`Cancel ${wo.id}? Reason (optional):`, '');
    if (reason === null) return;  // cancelled
    setError(null);
    try {
      await woApi.cancel(wo.id, { reason: reason.trim() || undefined });
      refreshAll();
    } catch (e) {
      setError(`Cancel failed: ${e.detail || e.message || 'unknown'}`);
    }
  }, [refreshAll]);

  // Drill-down: when a vehicle is selected, render its detail page.
  if (openVehicleId != null) {
    return (
      <VanDetailView
        vehicleId={openVehicleId}
        onBack={() => { setOpenVehicleId(null); refreshAll(); }}
      />
    );
  }

  return (
    <div>
      {/* Workshop selector + Create WO button */}
      <div className="flex items-center gap-3 mb-4">
        {workshops.length > 1 && (
          <>
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Workshop
            </label>
            <select
              value={workshopId || ''}
              onChange={(e) => setWorkshopId(Number(e.target.value))}
              className="px-3 py-1.5 rounded-md bg-navy-900 border border-navy-700 text-sm text-text-strong"
            >
              {workshops.map((w) => (
                <option key={w.id} value={parseOrgInt(w.id)}>
                  {w.name}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="button"
          onClick={() => setActionModal({ kind: 'create_wo' })}
          className="ml-auto px-3 py-1.5 rounded-md text-sm font-semibold bg-accent-green text-navy-950 hover:opacity-90 flex items-center gap-1"
          title="Create a new Work Order from scratch"
        >
          + Create WO
        </button>
      </div>

      {/* Chip row — clickable filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-6">
        {CHIPS.map((c) => {
          const active = chipFilter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setChipFilter(active ? null : c.id)}
              className={`rounded-lg border ${c.border} ${c.bg} px-3 py-3 flex flex-col text-left transition-all ${
                active ? 'ring-2 ring-offset-2 ring-offset-navy-950 ring-current' : 'hover:brightness-110'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted truncate">
                  {c.label}
                </span>
                <c.icon className={`w-3.5 h-3.5 ${c.color}`} />
              </div>
              <div className={`text-2xl font-bold mt-1 ${c.color}`}>
                {counters ? (counters[c.id] ?? 0) : (
                  <Loader2 className="w-5 h-5 animate-spin" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-text-muted">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Customer Confirmed Pickup section */}
      {confirmedPickups.length > 0 && (
        <ConfirmedPickupStrip pickups={confirmedPickups} onOpen={setOpenVehicleId} />
      )}

      {/* Incoming requests panel — WOs in pending_acceptance grouped by van */}
      {incomingPendingWos.length > 0 && (
        <IncomingRequestsPanel
          wos={incomingPendingWos}
          onReview={(wo) => setActionModal({ kind: 'review', wo })}
        />
      )}

      {/* ── Filter bar: search + customer + priority + sort ── */}
      <div className="rounded-lg border border-navy-700 bg-navy-900 p-3 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search RO# / VIN / van # / customer…"
          className="w-full px-3 py-2 mb-3 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong placeholder-text-muted outline-none focus:border-accent-blue"
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Status — mirrors the chip filter so the SW has both
              affordances (click chip or pick from dropdown). */}
          <label className="block">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
              Status
            </div>
            <select
              value={chipFilter || ''}
              onChange={(e) => setChipFilter(e.target.value || null)}
              className="w-full px-2 py-1.5 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none"
            >
              <option value="">All statuses</option>
              {CHIPS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>

          {/* Customer (DSP) */}
          <label className="block">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
              Customer
            </div>
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="w-full px-2 py-1.5 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none"
            >
              <option value="">All customers</option>
              {customerOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>

          {/* Priority */}
          <label className="block">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
              Priority
            </div>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="w-full px-2 py-1.5 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none"
            >
              <option value="all">All vans</option>
              <option value="rush">RUSH only</option>
            </select>
          </label>

          {/* Sort */}
          <label className="block">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
              Sort
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-2 py-1.5 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none"
            >
              <option value="needs_action">Needs action</option>
              <option value="van_number">Van #</option>
              <option value="customer_az">Customer (A→Z)</option>
              <option value="captured_newest">Captured (newest)</option>
              <option value="captured_oldest">Captured (oldest)</option>
            </select>
          </label>
        </div>
      </div>

      {/* Active filter banner */}
      {chipFilter && (
        <div className="flex items-center gap-2 mb-3 text-xs text-text-muted">
          <span>Filtered to:</span>
          <span className="px-2 py-0.5 rounded-md bg-navy-800 border border-navy-700 text-text-strong font-medium">
            {CHIPS.find((c) => c.id === chipFilter)?.label}
          </span>
          <button
            type="button"
            onClick={() => setChipFilter(null)}
            className="text-accent-blue hover:underline"
          >
            Clear
          </button>
          <span className="ml-auto text-text-muted">
            {tableRows.length} of {wos.length} WOs
          </span>
          <button
            type="button"
            onClick={refreshAll}
            className="text-text-muted hover:text-text-strong flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      )}

      {/* Main WO table */}
      <div className="rounded-lg border border-navy-700 overflow-hidden bg-navy-900">
        <div className="grid grid-cols-12 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-text-muted border-b border-navy-700">
          <div className="col-span-2">Van</div>
          <div className="col-span-2">Customer</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">RO</div>
          <div className="col-span-2">Tech</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>
        {woLoading && (
          <div className="px-4 py-8 flex items-center justify-center gap-2 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        )}
        {!woLoading && woError && (
          <div className="px-4 py-8 text-accent-red flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {woError}
          </div>
        )}
        {!woLoading && !woError && tableRows.length === 0 && (
          <div className="px-4 py-8 text-sm text-text-muted text-center">
            {chipFilter
              ? `No work orders match "${CHIPS.find((c) => c.id === chipFilter)?.label}".`
              : 'No work orders for this workshop yet.'}
          </div>
        )}
        {!woLoading && !woError && tableRows.map((wo) => (
          <SwWoRow
            key={wo.id}
            wo={wo}
            onOpen={() => setOpenVehicleId(wo.vehicleId)}
            onOpenRo={(w) => setOpenRoWoId((w || wo).id)}
            onDecline={(w) => setActionModal({ kind: 'decline', wo: w || wo })}
            onComplete={(w) => setActionModal({ kind: 'complete', wo: w || wo })}
            onSchedule={(w) => setActionModal({ kind: 'schedule', wo: w || wo })}
            onAfter={refreshAll}
          />
        ))}
      </div>

      {/* RO Modal — opened from the RO# link in any row (Jorge#4) */}
      {openRoWoId && (
        <RoModal
          woId={openRoWoId}
          onClose={() => setOpenRoWoId(null)}
          onAfterChange={refreshAll}
          onOpenSchedule={(w) => { setOpenRoWoId(null); setActionModal({ kind: 'schedule', wo: w }); }}
          onOpenComplete={(w) => { setOpenRoWoId(null); setActionModal({ kind: 'complete', wo: w }); }}
          onOpenDecline={(w) => { setOpenRoWoId(null); setActionModal({ kind: 'decline', wo: w }); }}
          onOpenVan={(vehicleId) => { setOpenRoWoId(null); setOpenVehicleId(vehicleId); }}
        />
      )}

      {/* Modals */}
      {actionModal?.kind === 'decline' && (
        <DeclineModal
          wo={actionModal.wo}
          onClose={() => setActionModal(null)}
          onSuccess={() => { setActionModal(null); refreshAll(); }}
        />
      )}
      {actionModal?.kind === 'create_wo' && (
        <CreateWoWizard
          user={user}
          workshopId={workshopId}
          onClose={() => setActionModal(null)}
          onCreated={() => { setActionModal(null); refreshAll(); }}
        />
      )}
      {actionModal?.kind === 'review' && (
        <ReviewRequestModal
          woId={actionModal.wo.id}
          workshopOrgId={
            // Pass the vendor org id so the tech dropdown filters down.
            // organizationId is exposed on workshops via vendorWorkshops.list().
            (workshops.find((w) => parseOrgInt(w.id) === workshopId) || {}).organizationId
              ? parseOrgInt(
                  (workshops.find((w) => parseOrgInt(w.id) === workshopId) || {}).organizationId
                )
              : null
          }
          onClose={() => setActionModal(null)}
          onAfter={() => { setActionModal(null); refreshAll(); }}
          onDecline={(wo) => setActionModal({ kind: 'decline', wo })}
        />
      )}
      {actionModal?.kind === 'schedule' && (
        <ScheduleModal
          wo={actionModal.wo}
          onClose={() => setActionModal(null)}
          onSuccess={() => { setActionModal(null); refreshAll(); }}
        />
      )}
      {actionModal?.kind === 'complete' && (
        <CompleteModal
          wo={actionModal.wo}
          onClose={() => setActionModal(null)}
          onSuccess={() => { setActionModal(null); refreshAll(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Confirmed Pickup horizontal strip
// ─────────────────────────────────────────────────────
function ConfirmedPickupStrip({ pickups, onOpen }) {
  return (
    <section className="mb-6 rounded-lg border border-accent-green/40 bg-accent-green/5 p-3">
      <div className="flex items-center gap-2 mb-3 text-accent-green font-semibold uppercase text-xs tracking-wider">
        <CheckCircle2 className="w-4 h-4" />
        Customer confirmed pickup
        <span className="text-text-muted">· {pickups.length}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {pickups.map((wo) => {
          const r = primaryRo(wo);
          return (
            <button
              key={wo.id}
              type="button"
              onClick={() => onOpen(wo.vehicleId)}
              className="text-left rounded-md border border-navy-700 bg-navy-900 hover:bg-navy-800/60 p-3 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-text-strong">
                  Van {vanLabel(wo)}
                </span>
                <span className="text-xs text-text-muted truncate" title={wo.id}>{primaryRoLabel(wo)}</span>
              </div>
              <div className="text-xs text-text-muted mb-1">
                {vehicleShortLabel(wo)}
              </div>
              {r?.scheduledStartAt && (
                <div className="text-sm font-medium text-accent-green">
                  Ready {formatPickupDate(r.scheduledStartAt)}
                </div>
              )}
              {r?.pickupLocation && (
                <div className="text-xs text-text-muted flex items-start gap-1 mt-1">
                  <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{r.pickupLocation}</span>
                </div>
              )}
              {r?.keyLocation && (
                <div className="text-xs text-text-muted flex items-start gap-1">
                  <KeyRound className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{r.keyLocation}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────
// Incoming Requests panel — WOs in pending_acceptance that the SW
// hasn't accepted/declined yet. The "review →" link opens the
// ReviewRequestModal where the SW types the real RO# + picks a tech
// before flipping the WO to accepted.
// ─────────────────────────────────────────────────────
function IncomingRequestsPanel({ wos, onReview }) {
  return (
    <section className="mb-6 rounded-lg border border-accent-blue/30 bg-accent-blue/5 p-3">
      <div className="flex items-center gap-2 mb-2 text-accent-blue font-semibold uppercase text-xs tracking-wider">
        <ArrowRight className="w-4 h-4" />
        Incoming Requests
        <span className="text-text-muted">· {wos.length}</span>
      </div>
      <div className="space-y-1">
        {wos.map((wo) => (
          <div
            key={wo.id}
            className="flex items-center justify-between px-3 py-2 rounded-md bg-navy-900 border border-navy-800"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm font-semibold text-text-strong shrink-0">
                Van {wo.vehicleFleetId || wo.vehicleIdStr || wo.vehicleId}
              </span>
              {wo.isRush && (
                <span className="px-1.5 py-0.5 text-xs rounded bg-accent-red text-white font-semibold flex items-center gap-1 shrink-0">
                  <Flame className="w-3 h-3" />
                  RUSH
                </span>
              )}
              <span className="text-xs text-text-muted truncate">
                {wo.dspName || (wo.dspId ? `DSP ${wo.dspId}` : '')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onReview(wo)}
              className="text-xs font-semibold text-accent-blue hover:underline ml-3 shrink-0"
            >
              review →
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────
// Main table row
// ─────────────────────────────────────────────────────
function SwWoRow({ wo, onOpen, onOpenRo, onDecline, onComplete, onSchedule, onAfter }) {
  const r = primaryRo(wo);
  // Jorge#3: expandable defects per row. Lazy-fetch the WO detail
  // the first time the row is expanded, then cache it in state so
  // re-expansion is instant.
  const [expanded, setExpanded] = useState(false);
  const [defects, setDefects] = useState(null);
  const [loadingDefects, setLoadingDefects] = useState(false);
  const toggleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && defects == null) {
      setLoadingDefects(true);
      try {
        const detail = await woApi.get(wo.id);
        setDefects(detail.defects || []);
      } catch {
        setDefects([]);
      } finally {
        setLoadingDefects(false);
      }
    }
  };

  return (
    <>
    <div className="grid grid-cols-12 px-4 py-3 items-center border-b border-navy-800 hover:bg-navy-800/40 transition-colors text-sm">
      <button
        type="button"
        onClick={onOpen}
        className="col-span-2 text-left flex items-start gap-2"
      >
        {/* Jorge#3: chevron toggles inline defect peek. stopPropagation
            so it doesn't also trigger the row-click (Van detail). */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleExpand(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggleExpand(); } }}
          className="mt-0.5 text-text-muted hover:text-text-strong shrink-0 cursor-pointer"
          title={expanded ? 'Hide defects' : 'Show defects'}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <span className="flex-1 min-w-0 block">
          <span className="font-medium text-text-strong flex items-center gap-2">
            Van {vanLabel(wo)}
            {wo.isRush && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-accent-red text-white font-semibold">
                RUSH
              </span>
            )}
          </span>
          {/* Jorge#8: drop the full model name. Show just year + make. */}
          <span
            className="text-xs text-text-muted truncate block"
            title={[wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(' ')}
          >
            {vehicleShortLabel(wo) || (wo.vehiclePlate ? `Plate ${wo.vehiclePlate}` : '')}
          </span>
        </span>
      </button>
      <div className="col-span-2 text-text-strong truncate">
        {wo.dspName || (wo.dspId ? `DSP ${wo.dspId}` : '—')}
      </div>
      <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
        <StatusChanger
          wo={wo}
          onAfter={onAfter}
          onOpenDeclineModal={onDecline}
          onOpenCompleteModal={onComplete}
          onOpenScheduleModal={onSchedule}
        />
      </div>
      <div className="col-span-2 text-xs truncate">
        {/* Jorge#4: clicking the RO# opens the RO modal where ALL the
            RO-specific actions live (status / sync / cost / notes / etc). */}
        {r?.roNumber ? (
          <button
            type="button"
            onClick={() => onOpenRo && onOpenRo(wo)}
            className="text-accent-blue hover:underline font-medium"
            title="Open RO actions"
          >
            {r.roNumber}
          </button>
        ) : (
          <span className="text-text-muted">
            {wo.status === 'pending_acceptance' ? 'awaiting' : '—'}
          </span>
        )}
      </div>
      <div className="col-span-2 text-text-muted text-xs truncate flex items-center gap-1">
        {wo.assignedTechnicianName ? (
          <>
            <UserIcon className="w-3 h-3" />
            {wo.assignedTechnicianName}
          </>
        ) : (
          'Unassigned'
        )}
      </div>
      <div className="col-span-2 flex items-center justify-end gap-1">
        {/* Jorge#10: when status is Ready to Schedule, SW gets a
            discrete button to open the ScheduleModal. Setting the
            status no longer auto-opens it. */}
        {wo.status === 'accepted' && r && !r.scheduledStartAt
          && !r.pickupType
          && !(r.partsOrderedAt && !r.partsReceivedAt)
          && !(r.submittedToFmcAt && !r.fmcApprovedAt) && (
          <button
            type="button"
            onClick={() => onSchedule(wo)}
            title="Schedule pickup — pick date / time / bucket"
            className="px-2 py-1 rounded-md text-[10px] font-semibold bg-accent-green/15 text-accent-green hover:bg-accent-green/25 flex items-center gap-1"
          >
            Schedule
          </button>
        )}
        <button
          type="button"
          onClick={onOpen}
          title="Open van detail"
          className="p-1.5 rounded-md text-text-muted hover:text-text-strong hover:bg-navy-800"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    {/* Jorge#3: inline defect peek when the chevron is toggled. */}
    {expanded && (
      <div className="px-4 py-3 border-b border-navy-800 bg-navy-900/30">
        {loadingDefects ? (
          <div className="text-xs text-text-muted flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading defects…
          </div>
        ) : !defects || defects.length === 0 ? (
          <div className="text-xs text-text-muted">No defects on this WO.</div>
        ) : (
          <ul className="space-y-1">
            {defects.map((d) => (
              <li key={d.id} className="text-xs flex items-center gap-2 flex-wrap">
                <span className="text-text-strong font-medium">
                  {(d.part || '').replace(/_/g, ' ')}
                  {d.defectType ? ` — ${d.defectType.replace(/_/g, ' ')}` : ''}
                </span>
                {d.position && <span className="text-text-muted">({d.position.replace(/_/g, ' ')})</span>}
                {d.source && (
                  <span className="px-1.5 py-0.5 rounded bg-navy-700/60 text-text-muted text-[9px] uppercase">
                    {String(d.source).replace(/_/g, ' ')}
                  </span>
                )}
                {d.billingType && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold ${
                    d.billingType === 'amr'
                      ? 'bg-accent-purple/15 text-accent-purple'
                      : 'bg-accent-blue/15 text-accent-blue'
                  }`}>
                    {d.billingType}
                  </span>
                )}
                {d.costDecision === 'approved' && (
                  <span className="px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green text-[9px] uppercase font-semibold">
                    ✓ approved
                  </span>
                )}
                {d.costDecision === 'rejected' && (
                  <span className="px-1.5 py-0.5 rounded bg-accent-red/15 text-accent-red text-[9px] uppercase font-semibold">
                    rejected
                  </span>
                )}
                {d.estimatedCost != null && !d.costDecision && (
                  <span className="px-1.5 py-0.5 rounded bg-accent-gold/15 text-accent-gold text-[9px] uppercase font-semibold">
                    pending customer
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    )}
    </>
  );
}

function IconAction({ icon: Icon, color, title, onClick }) {
  const colorClass = {
    green: 'bg-accent-green/15 text-accent-green hover:bg-accent-green/25',
    red:   'bg-accent-red/15 text-accent-red hover:bg-accent-red/25',
    blue:  'bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25',
    gray:  'text-text-muted hover:text-text-strong hover:bg-navy-800',
  }[color] || '';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md ${colorClass}`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

// ─────────────────────────────────────────────────────
// Status chip text + colour for the table cell
// ─────────────────────────────────────────────────────
function statusChipLabel(wo) {
  const r = primaryRo(wo);
  if (wo.status === 'pending_acceptance') return 'Pending';
  if (wo.status === 'in_progress') return 'In Progress';
  if (wo.status === 'completed') return 'Completed';
  if (wo.status === 'declined') return 'Declined';
  if (wo.status === 'cancelled') return 'Cancelled';
  // accepted — split by sub-state
  if (r && r.pickupType && !r.scheduledStartAt) return 'Awaiting Customer';
  if (r && r.partsOrderedAt && !r.partsReceivedAt) return 'Pending Parts';
  if (r && r.submittedToFmcAt && !r.fmcApprovedAt) return 'Pending FMC';
  if (r && r.scheduledStartAt) return 'Ready to Start';
  return 'Ready to Schedule';
}

function statusChipClass(label) {
  switch (label) {
    case 'Pending':            return 'bg-accent-gold/10 text-accent-gold border-accent-gold/40';
    case 'Pending Parts':      return 'bg-accent-orange/10 text-accent-orange border-accent-orange/40';
    case 'Pending FMC':        return 'bg-accent-purple/10 text-accent-purple border-accent-purple/40';
    case 'Ready to Schedule':  return 'bg-accent-green/10 text-accent-green border-accent-green/40';
    case 'Ready to Start':     return 'bg-accent-green/10 text-accent-green border-accent-green/40';
    case 'Awaiting Customer':  return 'bg-accent-blue/10 text-accent-blue border-accent-blue/40';
    case 'In Progress':        return 'bg-accent-blue/10 text-accent-blue border-accent-blue/40';
    case 'Completed':          return 'bg-accent-green/10 text-accent-green border-accent-green/40';
    case 'Declined':           return 'bg-accent-red/10 text-accent-red border-accent-red/40';
    case 'Cancelled':          return 'bg-navy-800 text-navy-300 border-navy-700';
    default:                   return 'bg-navy-800 text-navy-300 border-navy-700';
  }
}

function formatPickupDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function parseOrgInt(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// What the DSP calls this van. Prefer the customer-facing `fleet_id`
// the DSP entered in their fleet roster; fall back to the internal
// prefixed id_str (VAN-NNNN) so we never render "Van undefined".
function vanLabel(wo) {
  return wo?.vehicleFleetId || wo?.vehicleIdStr || wo?.vehicleId || '—';
}

// Jorge#8: "2019 Mercedes-Benz Sprinter 4x2 2500 3dr 170 in. WB High
// Roof Cargo Van (3.0L V6)" → just the make. Keep year if compact.
function vehicleShortLabel(wo) {
  // Make alone is short enough and still useful (Ford / Sprinter / Ram).
  return [wo?.vehicleYear, wo?.vehicleMake].filter(Boolean).join(' ');
}

// Jorge#2: WO list/cards primary label is the vendor RO# (RO-44936)
// not the Nova Fora WO# (WO-00026). Falls back to WO# when no RO
// is attached yet (e.g., before /accept generates the placeholder).
function primaryRoLabel(wo) {
  const r = wo?.primaryRo
    || (Array.isArray(wo?.ros) ? wo.ros.find((x) => x.isPrimary) : null);
  return r?.roNumber || wo?.id || '—';
}
