/**
 * ApproveCostModal — DSP-side cost-decision flow.
 *
 * Opens for a specific WO. Pulls the WO detail to find defects whose SW
 * set estimated_cost AND cost_decision is still NULL (i.e. above the
 * customer's auto-approve threshold OR AMR shortfall). Each defect gets
 * Approve / Reject buttons. The DSP can also leave a reason on reject.
 *
 * Endpoint: POST /defects/{id}/cost-decision  body={ decision, reason? }
 *
 * After every action we re-pull the detail so the modal reflects the
 * server state — once all rows decide, the modal shows "all decided"
 * and the parent dashboard can close it on its own refetch.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  X, DollarSign, Check, AlertTriangle, Loader2, AlertCircle,
} from 'lucide-react';
import {
  workOrders as woApi,
  defects as defectsApi,
} from '../../api/client';
import { primaryRoLabel } from '../../lib/wo';

export default function ApproveCostModal({ woId, onClose, onAfter }) {
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionErr, setActionErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadErr(null);
    woApi
      .get(woId)
      .then(setWo)
      .catch((e) => setLoadErr(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [woId]);

  useEffect(() => { load(); }, [load]);

  // Defects that need a customer cost decision RIGHT NOW: SW set the
  // estimated_cost (so it's not auto-approved) and cost_decision hasn't
  // been recorded yet.
  const pendingCostDefects = (wo?.defects || []).filter(
    (d) => d.estimatedCost != null && !d.costDecision
  );

  const decide = async (defectId, decision) => {
    let reason;
    if (decision === 'rejected') {
      reason = window.prompt(
        'Rejecting this cost — reason (optional):',
        'Out of budget for this period.',
      );
      if (reason === null) return;  // cancelled
    }
    setBusyId(defectId);
    setActionErr(null);
    try {
      await defectsApi.costDecision(defectId, {
        decision,
        reason: reason ? reason.trim() || undefined : undefined,
      });
      load();              // refresh modal
      onAfter && onAfter(); // refresh parent counters
    } catch (e) {
      setActionErr(e.detail || e.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

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
            <div className="w-9 h-9 rounded-lg bg-accent-red/15 border border-accent-red/40 flex items-center justify-center">
              <DollarSign size={16} className="text-accent-red" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-strong">
                Approve cost
                {wo ? ` · Van ${wo.vehicleFleetId || wo.vehicleIdStr || wo.vehicleId}` : ''}
              </h3>
              <p className="text-[11px] text-text-muted">
                {wo ? primaryRoLabel(wo) : ''}{wo?.workshopName ? ` · ${wo.workshopName}` : ''}
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
          {loadErr && (
            <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {loadErr}
            </div>
          )}
          {!loading && !loadErr && pendingCostDefects.length === 0 && (
            <div className="text-sm text-text-muted text-center py-6">
              Nothing pending your cost approval on this WO.
            </div>
          )}
          {pendingCostDefects.map((d) => {
            // Cost breakdown: for AMR with a cap below estimate, the
            // DSP picks up the shortfall (estimated - capped). Surface
            // that math explicitly so the DSP isn't doing arithmetic in
            // their head before approving.
            const est = Number(d.estimatedCost || 0);
            const cap = d.fmcCappedAt != null ? Number(d.fmcCappedAt) : null;
            const isAmr = d.billingType === 'amr';
            const shortfall = isAmr && cap != null && est > cap ? est - cap : 0;
            const fmcPays = isAmr ? (cap != null ? Math.min(est, cap) : est) : 0;
            const dspPays = isAmr ? Math.max(est - fmcPays, 0) : est;

            return (
              <div
                key={d.id}
                className="rounded-md border border-navy-700 bg-navy-800/40 p-3"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-strong flex items-center gap-2">
                      {(d.part || '').replace(/_/g, ' ')}
                      {d.defectType ? ` — ${d.defectType.replace(/_/g, ' ')}` : ''}
                      {d.billingType && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold ${
                          isAmr ? 'bg-accent-purple/15 text-accent-purple' : 'bg-accent-blue/15 text-accent-blue'
                        }`}>
                          {d.billingType}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-text-muted">
                      {d.position ? `${d.position.replace(/_/g, ' ')} · ` : ''}
                      {prettySource(d.source)}
                      {d.reportedBy ? ` · reported by ${d.reportedBy}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-text-muted uppercase tracking-wider">
                      Vendor estimate
                    </div>
                    <div className="text-lg font-bold text-text-strong">
                      ${est.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* AMR shortfall breakdown */}
                {isAmr && cap != null && (
                  <div className={`rounded-md px-3 py-2 mb-2 border ${
                    shortfall > 0
                      ? 'border-accent-red/50 bg-accent-red/10'
                      : 'border-accent-green/40 bg-accent-green/5'
                  }`}>
                    {shortfall > 0 ? (
                      <>
                        <div className="text-[11px] font-semibold text-accent-red flex items-center gap-1 mb-1">
                          <AlertTriangle size={12} />
                          Estimate exceeds Amazon FMC cap
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <div className="text-[10px] text-text-muted uppercase">Amazon pays</div>
                            <div className="text-text-strong font-semibold">
                              ${fmcPays.toLocaleString()}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-text-muted uppercase">You cover</div>
                            <div className="text-accent-red font-bold">
                              ${dspPays.toLocaleString()}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-text-muted uppercase">FMC cap</div>
                            <div className="text-text-muted">${cap.toLocaleString()}</div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-accent-green">
                        Under FMC cap (${cap.toLocaleString()}) — Amazon covers in full.
                      </div>
                    )}
                  </div>
                )}

                {/* CMR — customer pays everything */}
                {!isAmr && (
                  <div className="rounded-md px-3 py-2 mb-2 border border-accent-blue/30 bg-accent-blue/5">
                    <div className="text-[11px] text-text-muted">
                      <span className="font-semibold text-text-strong">CMR</span> — DSP pays
                      ${est.toLocaleString()} in full (no Amazon contribution).
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1 border-t border-navy-800">
                  <button
                    type="button"
                    onClick={() => decide(parseIntId(d.id), 'rejected')}
                    disabled={busyId === parseIntId(d.id)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold border border-accent-red/50 text-accent-red hover:bg-accent-red/10 disabled:opacity-40 flex items-center gap-1"
                  >
                    <X size={12} />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(parseIntId(d.id), 'approved')}
                    disabled={busyId === parseIntId(d.id)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent-green text-navy-950 hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
                  >
                    {busyId === parseIntId(d.id) ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Check size={12} />
                    )}
                    Approve
                  </button>
                </div>
              </div>
            );
          })}
          {actionErr && (
            <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-xs text-accent-red flex items-center gap-2">
              <AlertCircle className="w-3 h-3" />
              {actionErr}
            </div>
          )}
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

function prettySource(s) {
  if (!s) return '';
  if (s === 'dvic_inspection') return 'driver report';
  if (s === 'dsp_request') return 'customer request';
  if (s === 'shop_finding') return 'shop finding';
  return s.replace(/_/g, ' ');
}

function parseIntId(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}
