/**
 * ApproveDefectsModal — DSP-side scope-review flow.
 *
 * Opens for a specific WO. Pulls the WO detail and lists each defect.
 * The customer can Approve (will be repaired) or Reject (e.g. defect is
 * not present, work was already done, out of warranty) — each click
 * fires the matching defect-reviews endpoint and re-loads the modal.
 *
 * Endpoints:
 *   POST /defect-reviews/defect/{id}/approve  body={ reason? }
 *   POST /defect-reviews/defect/{id}/reject   body={ reason? }
 *
 * A defect is "pending scope review" if it has no DefectReview row yet.
 * Once reviewed it disappears from this modal — the SW dashboard sees
 * the review badge update on the row.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  X, AlertTriangle, Check, Loader2, AlertCircle, ShieldCheck,
} from 'lucide-react';
import {
  workOrders as woApi,
  defectReviews as defectReviewsApi,
} from '../../api/client';

export default function ApproveDefectsModal({ woId, onClose, onAfter }) {
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [reviews, setReviews] = useState({});  // defect_id (int) -> latest review row
  const [busyId, setBusyId] = useState(null);
  const [actionErr, setActionErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const detail = await woApi.get(woId);
      setWo(detail);
      // For each defect, fetch the latest review if any. We need this
      // because the WO detail doesn't expose review state inline.
      const map = {};
      await Promise.all((detail.defects || []).map(async (d) => {
        try {
          const list = await defectReviewsApi.listForDefect(parseIntId(d.id));
          const rows = Array.isArray(list) ? list : (list?.items || []);
          if (rows.length > 0) {
            // Newest first per endpoint contract; pick the top.
            const latest = rows[0];
            map[parseIntId(d.id)] = latest;
          }
        } catch {
          // ignore individual failures
        }
      }));
      setReviews(map);
    } catch (e) {
      setLoadErr(e.detail || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [woId]);

  useEffect(() => { load(); }, [load]);

  const decide = async (defectId, decision) => {
    let reason;
    if (decision === 'reject') {
      reason = window.prompt(
        'Rejecting this defect — why? (will show on the audit log)',
        '',
      );
      if (reason === null) return;
    }
    setBusyId(defectId);
    setActionErr(null);
    try {
      if (decision === 'approve') {
        await defectReviewsApi.approve(defectId, {});
      } else {
        await defectReviewsApi.reject(defectId, { reason: reason?.trim() || undefined });
      }
      load();
      onAfter && onAfter();
    } catch (e) {
      setActionErr(e.detail || e.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  const defects = wo?.defects || [];
  const pending = defects.filter((d) => !reviews[parseIntId(d.id)]);
  const reviewed = defects.filter((d) => !!reviews[parseIntId(d.id)]);

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
            <div className="w-9 h-9 rounded-lg bg-accent-gold/15 border border-accent-gold/40 flex items-center justify-center">
              <ShieldCheck size={16} className="text-accent-gold" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-strong">
                Approve defects
                {wo ? ` · Van ${wo.vehicleFleetId || wo.vehicleIdStr || wo.vehicleId}` : ''}
              </h3>
              <p className="text-[11px] text-text-muted">
                {wo ? wo.id : ''}{wo?.workshopName ? ` · ${wo.workshopName}` : ''}
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

          {/* Pending decisions */}
          {!loading && pending.length === 0 && !loadErr && (
            <div className="text-sm text-text-muted text-center py-6">
              All defects on this WO have been reviewed.
            </div>
          )}
          {pending.map((d) => {
            const intId = parseIntId(d.id);
            return (
              <div
                key={d.id}
                className="rounded-md border border-navy-700 bg-navy-800/40 p-3"
              >
                <div className="text-sm font-medium text-text-strong mb-1">
                  {(d.part || '').replace(/_/g, ' ')}
                  {d.defectType ? ` — ${d.defectType.replace(/_/g, ' ')}` : ''}
                </div>
                <div className="text-[11px] text-text-muted mb-2">
                  {d.position ? `${d.position.replace(/_/g, ' ')} · ` : ''}
                  {prettySource(d.source)}
                  {d.reportedBy ? ` · reported by ${d.reportedBy}` : ''}
                </div>
                {d.notes && (
                  <div className="text-xs text-text-muted italic mb-2">"{d.notes}"</div>
                )}
                <div className="flex justify-end gap-2 pt-1 border-t border-navy-800">
                  <button
                    type="button"
                    onClick={() => decide(intId, 'reject')}
                    disabled={busyId === intId}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold border border-accent-red/50 text-accent-red hover:bg-accent-red/10 disabled:opacity-40 flex items-center gap-1"
                  >
                    <X size={12} />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(intId, 'approve')}
                    disabled={busyId === intId}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent-green text-navy-950 hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
                  >
                    {busyId === intId ? (
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

          {/* Already reviewed — collapsed read-only list */}
          {reviewed.length > 0 && (
            <div className="pt-2 border-t border-navy-800">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">
                Already reviewed · {reviewed.length}
              </div>
              <ul className="space-y-1">
                {reviewed.map((d) => {
                  const r = reviews[parseIntId(d.id)];
                  return (
                    <li key={d.id} className="flex items-center gap-2 text-xs">
                      <span className="text-text-strong truncate flex-1">
                        {(d.part || '').replace(/_/g, ' ')}
                        {d.defectType ? ` — ${d.defectType.replace(/_/g, ' ')}` : ''}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold ${
                        r?.decision === 'approved'
                          ? 'bg-accent-green/15 text-accent-green'
                          : 'bg-accent-red/15 text-accent-red'
                      }`}>
                        {r?.decision}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

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
