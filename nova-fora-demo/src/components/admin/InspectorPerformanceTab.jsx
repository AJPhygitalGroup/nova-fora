/**
 * Inspector Performance — admin/DSP-side view of inspector grading.
 *
 * Consumes /dashboards/inspector-performance which rolls up the
 * /defect-reviews/inspector-kpi math per user across the chosen
 * window. Inspectors whose defects get flagged 'illegitimate_defect'
 * by SWs rank up the list (worst first) so an admin sees red flags
 * at a glance.
 *
 * Window selector: 7 / 30 / 90 days (default 30). DSP filter is
 * site_admin only — DSP roles are auto-scoped to their own org by
 * the backend.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, Loader2, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { dashboards as dashboardsApi } from '../../api/client';

const WINDOWS = [
  { id: 7, label: 'Last 7 days' },
  { id: 30, label: 'Last 30 days' },
  { id: 90, label: 'Last 90 days' },
];

export default function InspectorPerformanceTab() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    dashboardsApi
      .inspectorPerformance({ days })
      .then((r) => setRows(Array.isArray(r) ? r : (r?.items || [])))
      .catch((e) => setErr(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-text-strong flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-accent-blue" />
            Inspector Performance
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Defects an inspector reports that vendors mark as
            "illegitimate" count against their reliability score.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-1.5 rounded-md bg-navy-900 border border-navy-700 text-sm text-text-strong"
          >
            {WINDOWS.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            className="text-xs text-text-muted hover:text-text-strong flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-3 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {err}
        </div>
      )}

      <div className="rounded-lg border border-navy-700 overflow-hidden bg-navy-900">
        <div className="grid grid-cols-12 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-text-muted border-b border-navy-700">
          <div className="col-span-4">Inspector</div>
          <div className="col-span-3">Organization</div>
          <div className="col-span-2 text-right">Reported</div>
          <div className="col-span-1 text-right">Illegit.</div>
          <div className="col-span-2 text-right">% Illegit</div>
        </div>
        {loading && rows.length === 0 && (
          <div className="px-4 py-8 flex items-center justify-center gap-2 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        )}
        {!loading && rows.length === 0 && !err && (
          <div className="px-4 py-8 text-sm text-text-muted text-center">
            No inspector activity in the selected window.
          </div>
        )}
        {rows.map((r) => {
          const pct = r.illegitimatePct ?? 0;
          const bad = pct >= 20;
          const warn = pct >= 10 && pct < 20;
          const pctCls = bad
            ? 'text-accent-red font-bold'
            : warn
            ? 'text-accent-gold font-semibold'
            : 'text-accent-green';
          return (
            <div
              key={r.inspectorId}
              className="grid grid-cols-12 px-4 py-3 items-center border-b border-navy-800 hover:bg-navy-800/40 text-sm"
            >
              <div className="col-span-4">
                <div className="font-medium text-text-strong">{r.inspectorName}</div>
                <div className="text-xs text-text-muted truncate">{r.inspectorEmail}</div>
              </div>
              <div className="col-span-3 text-xs text-text-muted">
                {r.organizationName || '—'}
              </div>
              <div className="col-span-2 text-right text-text-strong">{r.totalReported}</div>
              <div className="col-span-1 text-right text-text-strong">{r.illegitimateCount}</div>
              <div className={`col-span-2 text-right ${pctCls}`}>
                {pct.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-text-muted mt-3 italic">
        Worst performers ranked first. Vendor flags an inspector defect
        as "Illegitimate" via the reject dropdown in the defect-review
        queue.
      </p>
    </div>
  );
}
