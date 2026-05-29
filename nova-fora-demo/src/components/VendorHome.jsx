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
import { motion } from 'framer-motion';
import {
  ClipboardList, AlertTriangle, AlertCircle, Truck, Briefcase, CheckCircle2,
  CalendarCheck, Plus, RefreshCw, Loader2, Flame, PlayCircle, X,
} from 'lucide-react';
import {
  vendorWorkshops as workshopsApi,
  dashboards as dashboardsApi,
} from '../api/client';
import { canInspect } from '../lib/permissions';
import AdHocDefectsModal from './wo_v2/AdHocDefectsModal';
import CreateInspectionWizard, { hasSavedWizardState } from './CreateInspectionWizard';

export default function VendorHome({ user }) {
  const [workshops, setWorkshops] = useState([]);
  const [workshopId, setWorkshopId] = useState(null);
  const [dspFilter, setDspFilter] = useState('');           // '' = all DSPs
  const [counters, setCounters] = useState(null);
  const [counterErr, setCounterErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adHocOpen, setAdHocOpen] = useState(false);

  // ── Start Inspection banner state ──
  // Vendor techs + vendor_admins can run post-repair inspections (see
  // `canInspect` in lib/permissions.js). Auto-reopen the wizard if the
  // browser tab was killed mid-walkaround — CreateInspectionWizard
  // snapshots its state to sessionStorage on every step.
  const userCanInspect = canInspect(user);
  const [showStartInspection, setShowStartInspection] = useState(
    userCanInspect && hasSavedWizardState,
  );

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

      {/* ── Start New Inspection banner — Vendor / Technician ── */}
      {userCanInspect && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-accent-green/40 bg-gradient-to-r from-accent-green/15 via-accent-blue/10 to-accent-purple/10"
        >
          <div className="w-10 h-10 rounded-lg bg-accent-green/20 border border-accent-green/40 flex items-center justify-center shrink-0">
            <PlayCircle size={18} className="text-accent-green" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-text-strong">Start a new QC DVIC</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-blue/15 border border-accent-blue/40 text-accent-blue text-[10px] font-semibold">
                Inspector workflow
              </span>
            </div>
            <div className="text-xs text-text-muted">
              Walk through the 5-section inspection and auto-create work orders for any defects found
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowStartInspection(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-green text-white text-sm font-semibold hover:bg-accent-green/80 transition-all cursor-pointer shadow-lg shadow-accent-green/20"
          >
            <PlayCircle size={14} /> Start Inspection
          </button>
        </motion.div>
      )}

      {/* ── Upcoming DVIC banner (Phase 1b will wire chips) ── */}
      <DvicScheduleManager workshopId={workshopId} availableDsps={availableDsps} />

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

      {/* ── Two-column: bar chart + donut ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">
        <DailyDefectsChart workshopId={workshopId} dspId={dspFilter} />
        <OpenDefectsDonut workshopId={workshopId} dspId={dspFilter} />
      </div>

      {/* ── Ad-hoc Defects modal ─────────────────────── */}
      {adHocOpen && workshopId && (
        <AdHocDefectsModal
          workshopId={workshopId}
          dspId={dspFilter ? Number(dspFilter) : null}
          onClose={() => setAdHocOpen(false)}
        />
      )}

      {/* ── Create Inspection wizard (5-section walkaround) ── */}
      {showStartInspection && (
        <CreateInspectionWizard
          user={user}
          onClose={() => setShowStartInspection(false)}
          onSubmitted={() => {
            setShowStartInspection(false);
            loadCounters();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// QC DVIC Schedule Manager — vendor admin schedules a real QC DVIC
// appointment per DSP (date + time + optional notes). Replaces the old
// chip-flag flow ("Upcoming DVIC: tap to confirm tonight"), which was
// just a per-day flag with no actual time. Each row here corresponds to
// one `dvic_schedules` DB row; the DSP customer home reads its own
// /next-qc-dvic endpoint to show the readiness banner 12hrs before.
// ─────────────────────────────────────────────────────
function DvicScheduleManager({ workshopId, availableDsps }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    if (!workshopId) return;
    setLoading(true);
    setErr(null);
    dashboardsApi
      .listDvicSchedules(workshopId)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => setErr(e.detail || e.message || 'Failed'))
      .finally(() => setLoading(false));
  }, [workshopId]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (scheduleId) => {
    const reason = window.prompt('Cancellation reason (optional):', '');
    if (reason === null) return;  // user dismissed the prompt
    try {
      await dashboardsApi.cancelDvicSchedule(workshopId, scheduleId, { reason: reason.trim() || undefined });
      load();
    } catch (e) {
      alert(e.detail || e.message || 'Cancel failed');
    }
  };

  return (
    <section className="rounded-lg border border-accent-green/40 bg-accent-green/5 px-4 py-3 mb-4">
      <div className="flex items-start gap-3 flex-wrap">
        <PlayCircle className="w-5 h-5 text-accent-green shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-accent-green flex items-center gap-2">
            QC DVIC Schedule
            <span className="px-1.5 py-0.5 rounded-md bg-accent-green/20 text-[10px] font-mono uppercase">
              Inspector workflow
            </span>
          </div>
          <div className="text-[11px] text-text-muted mt-0.5">
            Schedule when your inspector visits each customer. The DSP sees a readiness banner 12 hours before each appointment.
          </div>
          {err && (
            <div className="text-[10px] text-accent-red mt-1">{err}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 rounded-md bg-accent-green text-navy-950 text-xs font-semibold hover:opacity-90 flex items-center gap-1 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          {showForm ? 'Close' : 'Schedule QC DVIC'}
        </button>
      </div>

      {showForm && (
        <ScheduleDvicForm
          workshopId={workshopId}
          availableDsps={availableDsps}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load(); }}
        />
      )}

      {/* Upcoming list — sorted asc by scheduled_at (server-side). */}
      <div className="mt-3 space-y-1.5">
        {loading && (
          <div className="text-[11px] text-text-muted flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div className="text-[11px] text-text-muted italic">
            No QC DVICs scheduled yet. Use the button above to add one.
          </div>
        )}
        {!loading && rows.map((r) => {
          // Display the scheduled instant in the vendor admin's local tz.
          const dt = new Date(r.scheduledAt);
          const niceDt = dt.toLocaleString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
          });
          return (
            <div
              key={r.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-navy-700 bg-navy-900 text-xs"
            >
              <CalendarCheck className="w-3.5 h-3.5 text-accent-blue shrink-0" />
              <span className="text-text-strong font-semibold">{dspShort(r.dspName)}</span>
              <span className="text-text-muted">·</span>
              <span className="text-text-strong">{niceDt}</span>
              {r.notes && (
                <span className="text-text-muted truncate" title={r.notes}>· {r.notes}</span>
              )}
              <button
                type="button"
                onClick={() => cancel(r.id)}
                className="ml-auto text-text-muted hover:text-accent-red px-1.5"
                title="Cancel this appointment"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Inline "Schedule QC DVIC" form — expands below the manager header.
// Local state only; on submit POSTs and notifies parent to reload.
function ScheduleDvicForm({ workshopId, availableDsps, onCancel, onCreated }) {
  // Default: tomorrow at 8:00 PM local — typical AM-DSP overnight slot.
  const tomorrow8pm = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(20, 0, 0, 0);
    const tzOffset = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  })();
  const [dspId, setDspId] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState(tomorrow8pm);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!dspId) { setErr('Pick a customer'); return; }
    if (!scheduledLocal) { setErr('Pick a date + time'); return; }
    // datetime-local has no tz suffix; toISOString takes it as local
    // time and produces the correct UTC instant.
    const iso = new Date(scheduledLocal).toISOString();
    setBusy(true); setErr(null);
    try {
      await dashboardsApi.createDvicSchedule(workshopId, {
        dspId: Number(dspId),
        scheduledAt: iso,
        notes: notes.trim() || undefined,
      });
      onCreated && onCreated();
    } catch (e) {
      setErr(e.detail || e.message || 'Schedule failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 p-3 rounded-md border border-navy-700 bg-navy-900 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-text-muted font-semibold block mb-1">Customer</span>
          <select
            value={dspId}
            onChange={(e) => setDspId(e.target.value)}
            className="w-full rounded-md px-2 py-2 text-sm bg-navy-800 border border-navy-700 text-text-strong"
          >
            <option value="">— pick a customer —</option>
            {availableDsps.map((d) => (
              <option key={d.id} value={parseOrgInt(d.id)}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-text-muted font-semibold block mb-1">Date + time (your tz)</span>
          <input
            type="datetime-local"
            value={scheduledLocal}
            onChange={(e) => setScheduledLocal(e.target.value)}
            className="w-full rounded-md px-2 py-2 text-sm bg-navy-800 border border-navy-700 text-text-strong"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-text-muted font-semibold block mb-1">Notes (optional)</span>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          placeholder="e.g. bring extra battery tester · park at back gate"
          className="w-full rounded-md px-2 py-2 text-sm bg-navy-800 border border-navy-700 text-text-strong"
        />
      </label>
      {err && (
        <div className="text-[11px] text-accent-red flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {err}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:text-text-strong">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !dspId || !scheduledLocal}
          className="px-3 py-1.5 rounded-md bg-accent-green text-navy-950 text-xs font-semibold hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          Schedule
        </button>
      </div>
    </form>
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

// ─────────────────────────────────────────────────────
// DailyDefectsChart — SVG bar pairs, 7-day series.
// Two bars per day: approved (green) on top of repaired (grey).
// Self-fetches; takes workshop + dsp filter from parent.
// ─────────────────────────────────────────────────────
function DailyDefectsChart({ workshopId, dspId }) {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workshopId) return;
    setLoading(true);
    dashboardsApi
      .dailyDefects(workshopId, { days: 7, dspId: dspId || undefined })
      .then((r) => setPoints(Array.isArray(r) ? r : (r?.items || [])))
      .catch(() => setPoints([]))
      .finally(() => setLoading(false));
  }, [workshopId, dspId]);

  // Compute scale + dimensions for the SVG bars.
  const maxVal = Math.max(1, ...points.flatMap((p) => [p.approved || 0, p.repaired || 0]));
  const barWidth = 12;
  const gap = 4;
  const groupWidth = barWidth * 2 + gap;
  const groupGap = 28;
  const chartH = 140;
  const chartPad = 24;
  const groupCount = points.length;
  const chartW = chartPad * 2 + groupCount * groupWidth + (groupCount - 1) * groupGap;

  return (
    <section className="lg:col-span-2 rounded-lg border border-navy-700 bg-navy-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-text-strong">
          Daily Approved vs Repaired Defects
        </div>
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-accent-green"></span> Approved
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-text-muted/40"></span> Repaired
          </span>
        </div>
      </div>
      {loading && points.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-xs text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin mr-1" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <svg width={chartW} height={chartH + 30} className="block">
            {/* Y-axis ticks */}
            <g className="text-[9px] fill-text-muted">
              <text x={0} y={10}>{maxVal}</text>
              <text x={0} y={chartH / 2 + 4}>{Math.round(maxVal / 2)}</text>
              <text x={0} y={chartH - 2}>0</text>
            </g>
            {/* Bars */}
            {points.map((p, i) => {
              const x = chartPad + i * (groupWidth + groupGap);
              const aH = ((p.approved || 0) / maxVal) * chartH;
              const rH = ((p.repaired || 0) / maxVal) * chartH;
              const aY = chartH - aH;
              const rY = chartH - rH;
              return (
                <g key={p.date}>
                  <rect x={x} y={aY} width={barWidth} height={aH} rx={2} className="fill-accent-green" />
                  <rect x={x + barWidth + gap} y={rY} width={barWidth} height={rH} rx={2} className="fill-text-muted/40" />
                  <text
                    x={x + groupWidth / 2}
                    y={chartH + 14}
                    textAnchor="middle"
                    className="text-[9px] fill-text-muted"
                  >
                    {new Date(p.date).toLocaleDateString(undefined, { weekday: 'short' })}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────
// OpenDefectsDonut — SVG donut of open defects grouped by source.
// Slice angles computed from totals; renders inside a single circle
// with stroke-dasharray tricks (no chart lib dependency).
// ─────────────────────────────────────────────────────
function OpenDefectsDonut({ workshopId, dspId }) {
  const [slices, setSlices] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workshopId) return;
    setLoading(true);
    dashboardsApi
      .openDefectsBreakdown(workshopId, { dspId: dspId || undefined })
      .then((r) => setSlices(Array.isArray(r) ? r : (r?.items || [])))
      .catch(() => setSlices([]))
      .finally(() => setLoading(false));
  }, [workshopId, dspId]);

  const total = slices.reduce((s, sl) => s + (sl.count || 0), 0);
  // Tailwind palette mapped to the source keys we expect.
  const PALETTE = {
    inspection: 'stroke-accent-blue',
    shop_finding: 'stroke-accent-orange',
    maintenance_request: 'stroke-accent-purple',
    customer_report: 'stroke-accent-purple',
    driver_report: 'stroke-accent-gold',
    other: 'stroke-text-muted',
  };
  const SWATCH = {
    inspection: 'bg-accent-blue',
    shop_finding: 'bg-accent-orange',
    maintenance_request: 'bg-accent-purple',
    customer_report: 'bg-accent-purple',
    driver_report: 'bg-accent-gold',
    other: 'bg-text-muted',
  };

  // Donut geometry — single SVG, each slice is a stroke arc.
  const r = 50;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <section className="rounded-lg border border-navy-700 bg-navy-900 p-4">
      <div className="text-sm font-semibold text-text-strong mb-3">
        Open Defects breakdown
      </div>
      {loading && slices.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-xs text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin mr-1" /> Loading…
        </div>
      ) : total === 0 ? (
        <div className="h-40 flex items-center justify-center text-xs text-text-muted">
          No open defects.
        </div>
      ) : (
        <div className="flex items-center gap-4">
          {/* Donut wrapper — the SVG is rotated -90deg so the first arc
              starts at 12 o'clock. The center total used to live inside
              the SVG with a counter-rotation that fought a Tailwind
              rotate-90 utility and ended up off-center. Now the SVG
              just renders the arcs; the total is an absolutely-positioned
              HTML span over the wrapper — bulletproof centering via
              flex without any rotation gymnastics. */}
          <div className="relative shrink-0" style={{ width: 130, height: 130 }}>
            <svg width={130} height={130} viewBox="0 0 130 130" className="-rotate-90">
              <circle cx={65} cy={65} r={r} className="fill-none stroke-navy-800" strokeWidth={16} />
              {slices.map((sl) => {
                const frac = sl.count / total;
                const dash = frac * circumference;
                const cls = PALETTE[sl.key] || 'stroke-text-muted';
                const el = (
                  <circle
                    key={sl.key}
                    cx={65}
                    cy={65}
                    r={r}
                    className={`fill-none ${cls}`}
                    strokeWidth={16}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += dash;
                return el;
              })}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-sm font-bold text-text-strong tabular-nums leading-none">
                {total}
              </span>
            </div>
          </div>
          <ul className="text-xs space-y-1 flex-1 min-w-0">
            {slices.map((sl) => {
              const swatchCls = SWATCH[sl.key] || 'bg-text-muted';
              const pct = total > 0 ? Math.round((sl.count / total) * 100) : 0;
              return (
                <li key={sl.key} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-sm ${swatchCls}`} />
                  <span className="text-text-strong truncate flex-1">{sl.label}</span>
                  <span className="text-text-muted">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
