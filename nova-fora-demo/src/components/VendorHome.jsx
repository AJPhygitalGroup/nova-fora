/**
 * VendorHome — landing dashboard for vendor roles (vendor_admin /
 * service_writer / technician / vendor_viewer). Replaces the default
 * "Home" tab (which still routes to the DVIC inspector for DSP roles).
 *
 * Layout (matches Vendor View Mockup page 2):
 *   1. Upcoming DVIC banner — confirm tonight's inspections per DSP,
 *      chips like CEIB / REJE Confirmed turn green when confirmed.
 *   2. KPI tiles row (5):
 *        - Ad hoc Defects (last 24h)  +  Rush Orders count chip
 *        - Vans Inspected (M of N) + "X new defects discovered"
 *        - Defects Pending FMC Approval (M of N)
 *        - Scheduled Repairs (next 48h)
 *        - Defects Repaired Current Week  +  ±% vs prev week
 *   3. Daily Approved vs Repaired Defects chart (placeholder)
 *   4. Open Defects donut (placeholder)
 *   5. Source + Defect Age sidebar filters (placeholder)
 *
 * DSP filter dropdown at top scopes everything to one customer so the
 * SW sees what the customer sees (Jorge's note on the mockup).
 *
 * Iter-1 ships the layout + KPI tiles wired to real backend. Charts +
 * Upcoming DVIC + filters land in Phase 1b — placeholder shells with
 * TODO markers so the visual structure is in place from day one.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ClipboardList, AlertTriangle, Truck, Briefcase, CheckCircle2,
  CalendarCheck, Plus, RefreshCw, Loader2, Flame, PlayCircle,
} from 'lucide-react';
import {
  vendorWorkshops as workshopsApi,
  dashboards as dashboardsApi,
} from '../api/client';
import AdHocDefectsModal from './wo_v2/AdHocDefectsModal';

export default function VendorHome({ user }) {
  const [workshops, setWorkshops] = useState([]);
  const [workshopId, setWorkshopId] = useState(null);
  const [dspFilter, setDspFilter] = useState('');           // '' = all DSPs
  const [counters, setCounters] = useState(null);
  const [counterErr, setCounterErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adHocOpen, setAdHocOpen] = useState(false);

  // Workshop bootstrap (mirrors ServiceWriterDashboard).
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
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadCounters = useCallback(() => {
    if (!workshopId) return;
    setLoading(true);
    setCounterErr(null);
    dashboardsApi
      .vendorHomeCounters(workshopId, { dspId: dspFilter || undefined })
      .then(setCounters)
      .catch((e) => setCounterErr(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [workshopId, dspFilter]);

  useEffect(() => { loadCounters(); }, [loadCounters]);

  // Available DSPs derived from the workshop's WOs is server-driven —
  // for iter-1 we hand-pull the list from the workshop's served set
  // via a quick GET (cheap; ~5 DSPs typical). Lives client-side for
  // simplicity. TODO: dedicated /vendor-home/{ws}/dsps endpoint.
  const [availableDsps, setAvailableDsps] = useState([]);
  useEffect(() => {
    if (!workshopId) return;
    // Best-effort: read /work-orders?limit=200 and extract distinct dsp pairs.
    import('../api/client').then(({ workOrders }) => {
      workOrders.list({ limit: 200 }).then((res) => {
        const seen = new Map();
        (res.items || []).forEach((w) => {
          if (w.dspId && !seen.has(w.dspId)) {
            seen.set(w.dspId, { id: w.dspId, name: w.dspName || `DSP ${w.dspId}` });
          }
        });
        setAvailableDsps(Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)));
      }).catch(() => setAvailableDsps([]));
    });
  }, [workshopId]);

  // Workshop name for header subtitle ("Dulles Midas").
  const workshopName = workshops.find((w) => parseOrgInt(w.id) === workshopId)?.name || '';

  return (
    <div>
      {/* ── Header: workshop + DSP filter + refresh ───────── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {workshops.length > 1 && (
          <label className="flex items-center gap-2 text-xs">
            <span className="font-semibold uppercase tracking-wider text-text-muted">Workshop</span>
            <select
              value={workshopId || ''}
              onChange={(e) => setWorkshopId(Number(e.target.value))}
              className="px-2 py-1.5 rounded-md bg-navy-900 border border-navy-700 text-sm text-text-strong"
            >
              {workshops.map((w) => (
                <option key={w.id} value={parseOrgInt(w.id)}>{w.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-text-muted">Customer</span>
          <select
            value={dspFilter}
            onChange={(e) => setDspFilter(e.target.value)}
            className="px-2 py-1.5 rounded-md bg-navy-900 border border-navy-700 text-sm text-text-strong"
            title="Filter to one DSP — matches the figures that customer sees in their dashboard"
          >
            <option value="">All customers (cumulative)</option>
            {availableDsps.map((d) => (
              <option key={d.id} value={parseOrgInt(d.id)}>{d.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={loadCounters}
          className="ml-auto text-xs text-text-muted hover:text-text-strong flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {/* ── Upcoming DVIC banner (Phase 1b will wire chips) ── */}
      <UpcomingDvicBanner workshopId={workshopId} />

      {counterErr && (
        <div className="mb-3 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {counterErr}
        </div>
      )}

      {/* ── 5 KPI tiles ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <KpiTileAdHoc
          loading={loading}
          count={counters?.adHocDefects24h ?? 0}
          rushCount={counters?.rushOrders ?? 0}
          onClick={() => setAdHocOpen(true)}
        />
        <KpiTileVansInspected
          loading={loading}
          inspected={counters?.vansInspectedToday ?? 0}
          total={counters?.vansTotal ?? 0}
          newDefects={counters?.newDefectsToday ?? 0}
        />
        <KpiTilePendingFmc
          loading={loading}
          pending={counters?.defectsPendingFmc ?? 0}
          total={counters?.defectsPendingFmcTotal ?? 0}
        />
        <KpiTileScheduled
          loading={loading}
          count={counters?.scheduledRepairsCount ?? 0}
        />
        <KpiTileRepaired
          loading={loading}
          count={counters?.defectsRepairedWeek ?? 0}
          pctChange={counters?.defectsRepairedPctChange ?? 0}
          pendingFeedback={counters?.pendingFeedback ?? 0}
        />
      </div>

      {/* ── Two-column: chart + donut + filters (Phase 1b placeholders) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">
        <div className="lg:col-span-2 rounded-lg border border-navy-700 bg-navy-900 p-4">
          <div className="text-sm font-semibold text-text-strong mb-2">
            Daily Approved vs Repaired Defects
          </div>
          <div className="h-48 flex items-center justify-center text-xs text-text-muted">
            Chart will land in Phase 1b — backend endpoint pending.
          </div>
        </div>
        <div className="rounded-lg border border-navy-700 bg-navy-900 p-4">
          <div className="text-sm font-semibold text-text-strong mb-2">
            Open Defects breakdown
          </div>
          <div className="h-48 flex flex-col items-center justify-center text-xs text-text-muted gap-1">
            <div>Donut chart (VSA / RSI / Other)</div>
            <div>Source + Defect Age filters — Phase 1b</div>
          </div>
        </div>
      </div>

      {/* ── Ad-hoc Defects modal ─────────────────────── */}
      {adHocOpen && workshopId && (
        <AdHocDefectsModal
          workshopId={workshopId}
          dspId={dspFilter ? Number(dspFilter) : null}
          onClose={() => setAdHocOpen(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Upcoming DVIC banner — confirm tonight's inspections
// Wired to /dashboards/vendor-home/{ws}/upcoming-dvic; chips
// flip from red ("Tap to confirm") to green ("Confirmed") on
// successful POST. Each chip is one DSP the workshop services.
// ─────────────────────────────────────────────────────
function UpcomingDvicBanner({ workshopId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    if (!workshopId) return;
    setLoading(true);
    setErr(null);
    dashboardsApi
      .upcomingDvic(workshopId)
      .then((r) => setRows(Array.isArray(r) ? r : (r?.items || [])))
      .catch((e) => setErr(e.detail || e.message || 'Failed'))
      .finally(() => setLoading(false));
  }, [workshopId]);

  useEffect(() => { load(); }, [load]);

  const confirm = async (dspId) => {
    setErr(null);
    setBusyId(dspId);
    try {
      const updated = await dashboardsApi.confirmUpcomingDvic(workshopId, dspId);
      setRows((cur) => cur.map((r) => r.dspId === dspId ? { ...r, ...updated } : r));
    } catch (e) {
      setErr(e.detail || e.message || 'Failed to confirm');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-lg border border-accent-green/40 bg-accent-green/5 px-4 py-3 mb-4 flex items-center gap-3 flex-wrap">
      <PlayCircle className="w-5 h-5 text-accent-green shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-accent-green flex items-center gap-2">
          Upcoming DVIC
          <span className="px-1.5 py-0.5 rounded-md bg-accent-green/20 text-[10px] font-mono uppercase">
            Inspector workflow
          </span>
        </div>
        <div className="text-[11px] text-text-muted mt-0.5">
          Confirm QC DVIC scheduled tonight for each customer — unconfirmed inspections will not be completed.
        </div>
        {err && (
          <div className="text-[10px] text-accent-red mt-1">{err}</div>
        )}
      </div>
      {/* Per-DSP chips wired to upcoming_dvic endpoint */}
      <div className="flex gap-2 flex-wrap">
        {loading && (
          <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
        )}
        {!loading && rows.length === 0 && (
          <span className="text-[11px] text-text-muted italic">
            No DSPs serviced yet.
          </span>
        )}
        {!loading && rows.map((r) => {
          const isBusy = busyId === r.dspId;
          if (r.confirmed) {
            return (
              <span
                key={r.dspId}
                className="px-3 py-1.5 rounded-md bg-accent-green/20 border border-accent-green/50 text-accent-green text-xs font-semibold cursor-default"
                title={`Confirmed ${r.confirmedAt ? new Date(r.confirmedAt).toLocaleTimeString() : ''}`}
              >
                {dspShort(r.dspName)} ✓ Confirmed
              </span>
            );
          }
          return (
            <button
              key={r.dspId}
              type="button"
              onClick={() => confirm(r.dspId)}
              disabled={isBusy}
              className="px-3 py-1.5 rounded-md bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs font-semibold hover:bg-accent-red/25 disabled:opacity-40 flex items-center gap-1"
              title="Tap to confirm tonight"
            >
              {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
              {dspShort(r.dspName)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Short pillable label — first word of the DSP name or 4-char abbrev.
function dspShort(name) {
  if (!name) return 'DSP';
  const first = name.split(/\s+/)[0];
  // Use uppercase abbreviation of vowel-stripped first word so it fits
  // in a chip (Safety First LLC → SAFETY → SFTY).
  return first.length <= 6 ? first.toUpperCase() : first.slice(0, 4).toUpperCase();
}

// ─────────────────────────────────────────────────────
// KPI tile components — one per shape so the markup stays readable
// ─────────────────────────────────────────────────────
function KpiTileShell({ children, accentColor, border, bg, onClick }) {
  const interactive = !!onClick;
  return (
    <div
      onClick={onClick}
      className={`rounded-lg border ${border} ${bg} p-4 flex flex-col ${interactive ? 'cursor-pointer hover:brightness-110' : ''}`}
    >
      {children}
    </div>
  );
}

function KpiTileAdHoc({ loading, count, rushCount, onClick }) {
  return (
    <KpiTileShell
      border="border-navy-700"
      bg="bg-navy-900"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Ad hoc Defects (last 24h)
        </span>
        <Plus className="w-3.5 h-3.5 text-accent-blue" />
      </div>
      <div className="text-3xl font-bold text-text-strong">
        {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : count}
      </div>
      {rushCount > 0 && (
        <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent-red text-white text-[10px] font-bold uppercase w-fit">
          <Flame className="w-3 h-3" />
          {rushCount} Rush Order{rushCount === 1 ? '' : 's'}
        </div>
      )}
    </KpiTileShell>
  );
}

function KpiTileVansInspected({ loading, inspected, total, newDefects }) {
  const pct = total > 0 ? Math.round((inspected / total) * 100) : 0;
  return (
    <KpiTileShell border="border-navy-700" bg="bg-navy-900">
      <div className="flex items-start justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Vans Inspected
        </span>
        <span className="text-[10px] font-bold text-text-muted">{pct}%</span>
      </div>
      <div className="text-2xl font-bold text-text-strong">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
          <>
            {inspected} <span className="text-text-muted text-base font-normal">of {total}</span>
          </>
        )}
      </div>
      <div className="text-[10px] text-text-muted mt-1">
        {newDefects} new defects discovered
      </div>
    </KpiTileShell>
  );
}

function KpiTilePendingFmc({ loading, pending, total }) {
  return (
    <KpiTileShell border="border-accent-purple/40" bg="bg-accent-purple/5">
      <div className="flex items-start justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Pending FMC Approval
        </span>
        <Briefcase className="w-3.5 h-3.5 text-accent-purple" />
      </div>
      <div className="text-2xl font-bold text-accent-purple">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
          <>
            {pending} <span className="text-text-muted text-base font-normal">of {total}</span>
          </>
        )}
      </div>
      <div className="text-[10px] text-text-muted mt-1">
        Defects Pending FMC Approval
      </div>
    </KpiTileShell>
  );
}

function KpiTileScheduled({ loading, count }) {
  return (
    <KpiTileShell border="border-navy-700" bg="bg-navy-900">
      <div className="flex items-start justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Scheduled Repairs
        </span>
        <CalendarCheck className={`w-3.5 h-3.5 ${count > 0 ? 'text-accent-blue' : 'text-text-muted'}`} />
      </div>
      <div className="text-3xl font-bold text-text-strong">
        {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : count}
      </div>
      <div className="text-[10px] text-text-muted mt-1">Next 48 hours</div>
    </KpiTileShell>
  );
}

function KpiTileRepaired({ loading, count, pctChange, pendingFeedback }) {
  const isUp = pctChange > 0;
  const isDown = pctChange < 0;
  const pctColor = isUp ? 'text-accent-green' : isDown ? 'text-accent-red' : 'text-text-muted';
  const pctSign = isUp ? '+' : '';
  return (
    <KpiTileShell border="border-accent-green/40" bg="bg-accent-green/5">
      <div className="flex items-start justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Defects Repaired
        </span>
        <span className={`text-[10px] font-bold ${pctColor}`}>
          {pctSign}{pctChange}%
        </span>
      </div>
      <div className="text-3xl font-bold text-accent-green">
        {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : count}
      </div>
      <div className="text-[10px] text-text-muted mt-1">Current week</div>
      {pendingFeedback > 0 && (
        <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent-gold/15 border border-accent-gold/40 text-accent-gold text-[10px] font-semibold w-fit">
          <AlertTriangle className="w-3 h-3" />
          {pendingFeedback} pending feedback
        </div>
      )}
    </KpiTileShell>
  );
}

// "DSP-9" / "DSP-0009" / 9 / "9" → 9
function parseOrgInt(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}
