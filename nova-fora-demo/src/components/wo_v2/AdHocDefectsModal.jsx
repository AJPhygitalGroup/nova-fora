/**
 * AdHocDefectsModal — opens from the Ad hoc Defects KPI on VendorHome.
 * Lists today's non-inspection defects (DSP-reported or shop-found)
 * with a source badge so the SW can scan "what walked in the door
 * today" without leaving the home page. Matches mockup page 3.
 */
import { useState, useEffect, useCallback } from 'react';
import { X, AlertTriangle, Loader2, Shield } from 'lucide-react';
import { dashboards as dashboardsApi } from '../../api/client';

export default function AdHocDefectsModal({ workshopId, dspId, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    dashboardsApi
      .adHocDefects(workshopId, { hours: 24, dspId: dspId || undefined })
      .then((res) => setRows(Array.isArray(res) ? res : (res?.items || [])))
      .catch((e) => setErr(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [workshopId, dspId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-green/15 border border-accent-green/40 flex items-center justify-center">
              <Shield size={16} className="text-accent-green" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-strong">
                DSP-reported Defects Today
              </h3>
              <p className="text-[11px] text-text-muted">
                {rows.length} defect{rows.length === 1 ? '' : 's'} reported across fleet today
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-strong p-2 -mr-2"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-5 space-y-3 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-6 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Loading…
            </div>
          )}
          {err && (
            <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {err}
            </div>
          )}
          {!loading && !err && rows.length === 0 && (
            <div className="text-sm text-text-muted text-center py-6">
              No ad-hoc defects in the last 24 hours.
            </div>
          )}
          {rows.map((d) => (
            <DefectRow key={d.id} d={d} />
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium border border-navy-700 text-text-strong hover:bg-navy-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DefectRow({ d }) {
  return (
    <div className="rounded-md border border-navy-700 bg-navy-800/40 p-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-strong mb-0.5">
          {d.idStr || `FD-${d.id}`}
        </div>
        <div className="text-sm text-text-strong">
          {(d.part || '').replace(/_/g, ' ')}
          {d.position ? ` (${d.position.replace(/_/g, ' ')})` : ''}
          {d.defectType ? ` — ${d.defectType.replace(/_/g, ' ')}` : ''}
        </div>
        <div className="text-[11px] text-text-muted mt-1 flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase ${sourceClass(d.source)}`}>
            {sourceLabel(d.source)}
          </span>
          {d.dspName && <span>· {d.dspName}</span>}
          <span>· {formatTime(d.reportedAt)}</span>
        </div>
      </div>
      <span className="px-2 py-0.5 rounded-md bg-accent-blue/15 text-accent-blue text-[10px] font-semibold uppercase shrink-0">
        Reported
      </span>
    </div>
  );
}

function sourceLabel(s) {
  if (!s) return '';
  if (s === 'maintenance_request' || s === 'driver_report' || s === 'customer_report') return 'Customer';
  if (s === 'shop_finding') return 'Shop';
  if (s === 'other') return 'Other';
  return s.replace(/_/g, ' ');
}

function sourceClass(s) {
  if (s === 'shop_finding') return 'bg-accent-orange/15 text-accent-orange';
  // customer/maintenance/driver report → blue
  return 'bg-accent-blue/15 text-accent-blue';
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}
