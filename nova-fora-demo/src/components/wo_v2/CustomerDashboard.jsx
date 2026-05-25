/**
 * Customer (DSP) dashboard — five KPI tiles + table of vans awaiting action.
 *
 * Rendered inside <WoV2Dashboard>. Reads:
 *   - GET /dashboards/dsp/{dspId}/counters  → header tiles
 *   - GET /work-orders?dspId=... limit=200   → table rows (DSP scope is
 *     server-side anyway; passing dspId is optional for site_admin only)
 *
 * The per-row action buttons are computed from the WO + its primary RO
 * state. The three demo buttons are:
 *   - $ Approve cost      → any defect on this WO needs DSP cost decision
 *   - Approve defects     → any defect on this WO needs DSP scope review
 *   - Confirm pickup      → ro.pickup_type set AND scheduled_start_at null
 *
 * Clicking the row opens <VanDetailModal>, which surfaces the same actions
 * inline (so the user has both quick-row and full-context paths).
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Truck, Loader2, AlertTriangle, RefreshCw, DollarSign,
  CalendarCheck, Check, Wrench, ChevronRight,
} from 'lucide-react';
import {
  workOrders as woApi,
  dashboards as dashboardsApi,
} from '../../api/client';
import VanDetailModal from './VanDetailModal';
import ApproveCostModal from './ApproveCostModal';
import ApproveDefectsModal from './ApproveDefectsModal';
import { StatusPill, STATUS_OPTIONS, deriveStatusKey } from './StatusChanger';

// ─────────────────────────────────────────────────────
// Status filter — same 8 chip statuses the SW sees, plus an "All"
// catch-all so the DSP can browse the whole queue. Reusing
// deriveStatusKey from StatusChanger guarantees the DSP and SW
// classify each WO IDENTICALLY (single source of truth).
// ─────────────────────────────────────────────────────
const STATUS_FILTERS = [
  { id: 'all',  label: 'All vans',          test: () => true },
  // Jorge#C3: the two cost-/review-tile filters match WOs that have
  // pending DSP action (counters surfaced inline by the backend in
  // pendingCostCount / pendingReviewCount).
  { id: 'approve_cost',    label: 'Awaiting cost approval',    test: (wo) => (wo.pendingCostCount ?? 0) > 0 },
  { id: 'approve_defects', label: 'Awaiting defect approval',  test: (wo) => (wo.pendingReviewCount ?? 0) > 0 },
  ...STATUS_OPTIONS.map((o) => ({
    id: o.key,
    label: o.label,
    test: (wo) => deriveStatusKey(wo) === o.key,
  })),
];

const ALL_TERMINAL = new Set(['completed', 'cancelled', 'declined']);

function primaryRo(wo) {
  // List endpoint exposes a compact `primary_ro` snapshot inline; detail
  // exposes the full `ros` array. Prefer inline so the table renders
  // without an extra fetch per row.
  if (wo?.primaryRo) return wo.primaryRo;
  if (Array.isArray(wo?.ros) && wo.ros.length > 0) {
    return wo.ros.find((r) => r.isPrimary) || wo.ros[0];
  }
  return null;
}

// ─────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────
export default function CustomerDashboard({ user }) {
  const dspId = parseOrgInt(user?.organizationId ?? user?.orgId);

  const [counters, setCounters] = useState(null);
  const [counterError, setCounterError] = useState(null);
  const [wos, setWos] = useState([]);
  const [woLoading, setWoLoading] = useState(true);
  const [woError, setWoError] = useState(null);
  // Default to "All vans" so the DSP sees the full fleet at a glance —
  // matches the SW dashboard which shows everything until you pick a chip.
  const [statusFilter, setStatusFilter] = useState('all');
  // Modal state for the customer-side approval flows. Each carries a
  // wo id; null = closed. The detail modal already has its own state.
  const [costModalWoId, setCostModalWoId] = useState(null);
  const [defectsModalWoId, setDefectsModalWoId] = useState(null);
  const [openWoId, setOpenWoId] = useState(null);

  // Counters load — single fetch, ~5 fields back
  const loadCounters = useCallback(() => {
    if (!dspId) return;
    setCounterError(null);
    dashboardsApi
      .dspCounters(dspId)
      .then(setCounters)
      .catch((err) => {
        console.warn('dspCounters failed', err);
        setCounterError(err.message || 'Failed to load counters');
      });
  }, [dspId]);

  // WO list — needs `?dspId=` only for site_admin; for DSP roles the
  // server already scopes to the caller's org.
  const loadWos = useCallback(() => {
    setWoLoading(true);
    setWoError(null);
    const params = { limit: 200 };
    if (user?.role === 'site_admin' && dspId) params.dspId = dspId;
    woApi
      .list(params)
      .then((res) => {
        setWos(res.items || []);
      })
      .catch((err) => {
        console.error('list_work_orders failed', err);
        setWoError(err.message || 'Failed to load work orders');
      })
      .finally(() => setWoLoading(false));
  }, [dspId, user?.role]);

  useEffect(() => {
    loadCounters();
    loadWos();
  }, [loadCounters, loadWos]);

  // Refresh both when an action inside the modal succeeds
  const refreshAll = useCallback(() => {
    loadCounters();
    loadWos();
  }, [loadCounters, loadWos]);

  const filteredWos = useMemo(() => {
    const filter = STATUS_FILTERS.find((f) => f.id === statusFilter);
    if (!filter) return wos;
    return wos.filter(filter.test);
  }, [wos, statusFilter]);

  const openWo = openWoId
    ? wos.find((w) => w.id === openWoId || w.workOrderId === openWoId)
    : null;

  return (
    <>
      {/* ── KPI tiles (Jorge#C3: also act as filters) ─────────
          Click a tile to set the table filter to the matching bucket.
          Click again (or "All vans") to clear. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <KpiTile
          label="Vans in service"
          value={counters?.vansInService}
          icon={Truck}
          color="text-navy-300"
          bg="bg-navy-800"
          border="border-navy-700"
          loading={!counters && !counterError}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <KpiTile
          label="$ Approve cost"
          value={counters?.approveCost}
          icon={DollarSign}
          color="text-accent-red"
          bg="bg-accent-red/10"
          border="border-accent-red/40"
          loading={!counters && !counterError}
          active={statusFilter === 'approve_cost'}
          onClick={() => setStatusFilter(statusFilter === 'approve_cost' ? 'all' : 'approve_cost')}
        />
        <KpiTile
          label="Approve defects"
          value={counters?.approveDefects}
          icon={AlertTriangle}
          color="text-accent-gold"
          bg="bg-accent-gold/10"
          border="border-accent-gold/40"
          loading={!counters && !counterError}
          active={statusFilter === 'approve_defects'}
          onClick={() => setStatusFilter(statusFilter === 'approve_defects' ? 'all' : 'approve_defects')}
        />
        <KpiTile
          label="Confirm pickup"
          value={counters?.confirmPickup}
          icon={CalendarCheck}
          color="text-accent-blue"
          bg="bg-accent-blue/10"
          border="border-accent-blue/40"
          loading={!counters && !counterError}
          active={statusFilter === 'awaitingCustomer'}
          onClick={() => setStatusFilter(statusFilter === 'awaitingCustomer' ? 'all' : 'awaitingCustomer')}
        />
        <KpiTile
          label="In progress"
          value={counters?.inProgress}
          icon={Wrench}
          color="text-accent-green"
          bg="bg-accent-green/10"
          border="border-accent-green/40"
          loading={!counters && !counterError}
          active={statusFilter === 'inProgress'}
          onClick={() => setStatusFilter(statusFilter === 'inProgress' ? 'all' : 'inProgress')}
        />
      </div>

      {counterError && (
        <div className="mb-4 text-xs text-accent-red flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Counters: {counterError}
        </div>
      )}

      {/* ── Status filter + refresh ────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-md bg-navy-900 border border-navy-700 text-sm text-text-strong"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="text-xs text-text-muted hover:text-text-strong flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* ── WO table ───────────────────────────────── */}
      <div className="rounded-lg border border-navy-700 overflow-hidden bg-navy-900">
        <div className="grid grid-cols-12 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-text-muted border-b border-navy-700">
          <div className="col-span-3">Van</div>
          <div className="col-span-2">Vendor</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-4 text-right">Actions</div>
          <div className="col-span-1 text-right" />
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
        {!woLoading && !woError && filteredWos.length === 0 && (
          <div className="px-4 py-8 text-sm text-text-muted text-center">
            No work orders match this filter.
          </div>
        )}
        {!woLoading && !woError && filteredWos.map((wo) => (
          <WoRow
            key={wo.id}
            wo={wo}
            onOpen={() => setOpenWoId(wo.id)}
            onApproveCost={() => setCostModalWoId(wo.id)}
            onApproveDefects={() => setDefectsModalWoId(wo.id)}
          />
        ))}
      </div>

      {/* ── Detail modal ───────────────────────────── */}
      {openWo && (
        <VanDetailModal
          wo={openWo}
          user={user}
          mode="customer"
          onClose={() => setOpenWoId(null)}
          onAction={refreshAll}
        />
      )}

      {/* ── DSP approval modals ────────────────────── */}
      {costModalWoId && (
        <ApproveCostModal
          woId={costModalWoId}
          onClose={() => setCostModalWoId(null)}
          onAfter={refreshAll}
        />
      )}
      {defectsModalWoId && (
        <ApproveDefectsModal
          woId={defectsModalWoId}
          onClose={() => setDefectsModalWoId(null)}
          onAfter={refreshAll}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────
// Sub-views
// ─────────────────────────────────────────────────────
function KpiTile({ label, value, icon: Icon, color, bg, border, loading, active, onClick }) {
  // Tiles act as one-click filters (Jorge#C3). Active tile gets a
  // ring so the DSP can see which one is currently filtering.
  const interactive = !!onClick;
  return (
    <button
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-lg border ${border} ${bg} px-4 py-3 flex flex-col text-left transition-all ${
        interactive ? 'cursor-pointer hover:brightness-110' : ''
      } ${active ? 'ring-2 ring-offset-2 ring-offset-navy-950 ring-current' : ''}`}
    >
      <div className="flex items-center justify-between w-full">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </span>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className={`text-3xl font-bold mt-1 ${color}`}>
        {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : (value ?? 0)}
      </div>
    </button>
  );
}

function WoRow({ wo, onOpen, onApproveCost, onApproveDefects }) {
  const ro = primaryRo(wo);
  const showConfirm = ro && ro.pickupType && !ro.scheduledStartAt;
  const isActive = !ALL_TERMINAL.has(wo.status);
  const pendingCost = wo.pendingCostCount || 0;
  const pendingReview = wo.pendingReviewCount || 0;
  // The row needs a visible cue when ANY decision is waiting on the DSP
  // so they don't have to open each WO to know. Red left-border = cost
  // shortfall (most urgent — affects what they'll pay), gold = scope
  // review only. The button counts mirror the same data.
  const borderClass = pendingCost > 0
    ? 'border-l-4 border-l-accent-red'
    : pendingReview > 0
    ? 'border-l-4 border-l-accent-gold'
    : '';

  // Wrap click handlers so clicking a button doesn't open the detail.
  const stop = (fn) => (e) => { e.stopPropagation(); e.preventDefault(); fn && fn(); };

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full grid grid-cols-12 px-4 py-3 items-center border-b border-navy-800 hover:bg-navy-800/40 transition-colors text-left ${borderClass}`}
    >
      <div className="col-span-3">
        <div className="text-sm font-medium text-text-strong">
          Van {wo.vehicleFleetId || wo.vehicleIdStr || wo.vehicleId}
        </div>
        <div className="text-xs text-text-muted">
          {[wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(' ')}
        </div>
        {wo.vehiclePlate && (
          <div className="text-xs text-text-muted">Plate {wo.vehiclePlate}</div>
        )}
      </div>
      <div className="col-span-2 text-sm text-text-strong">
        {wo.workshopName || '—'}
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <StatusPill wo={wo} />
      </div>
      <div className="col-span-4 flex items-center justify-end gap-1.5 flex-wrap">
        {isActive && pendingCost > 0 && (
          <span
            onClick={stop(onApproveCost)}
            className="px-2 py-1 text-xs rounded-md bg-accent-red text-white font-medium hover:opacity-90 cursor-pointer flex items-center gap-1 animate-pulse-once"
            title="A cost estimate exceeds the FMC cap — your approval needed"
          >
            $ Approve cost ({pendingCost})
          </span>
        )}
        {isActive && pendingReview > 0 && (
          <span
            onClick={stop(onApproveDefects)}
            className="px-2 py-1 text-xs rounded-md border border-accent-gold text-accent-gold hover:bg-accent-gold/10 font-medium cursor-pointer flex items-center gap-1"
            title="Defects waiting for your scope approval"
          >
            Approve defects ({pendingReview})
          </span>
        )}
        {showConfirm && (
          <span
            onClick={stop(onOpen)}
            className="px-2 py-1 text-xs rounded-md bg-accent-blue text-white font-medium cursor-pointer"
          >
            Confirm pickup
          </span>
        )}
        {wo.status === 'pending_acceptance' && (
          <span className="text-xs text-text-muted">Waiting for vendor</span>
        )}
        {isActive && pendingCost === 0 && pendingReview === 0 && !showConfirm && wo.status !== 'pending_acceptance' && (
          <span className="text-xs text-text-muted">No action needed</span>
        )}
      </div>
      <div className="col-span-1 flex items-center justify-end text-text-muted">
        <ChevronRight className="w-4 h-4" />
      </div>
    </button>
  );
}

// "DSP-9" / "DSP-0009" / 9 / "9" → 9
function parseOrgInt(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}
