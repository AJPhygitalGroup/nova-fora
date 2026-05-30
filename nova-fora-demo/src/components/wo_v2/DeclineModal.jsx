/**
 * Decline WO modal — radio of reason codes + optional notes.
 *
 * Mirrors the old WorkOrders.jsx pattern (codes 1-4 from
 * WO_DECLINE_REASONS) and the same int→string mapping the backend
 * expects (declineReasonCode like 'specialty_required'). Reroute is
 * always true: the spec wants the bundler to immediately push the
 * declined RR to the next eligible vendor.
 */
import { useState } from 'react';
import { X, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { workOrders as woApi } from '../../api/client';
import { WO_DECLINE_REASONS } from '../../data/mockData';
import { primaryRoLabel } from '../../lib/wo';

// int code → backend string code (decline_reason_codes table).
// Same mapping the legacy WorkOrders.jsx uses so DSPs see the same
// labels in their declined-reason readouts across both UIs.
const CODE_MAP = {
  1: 'parts_unavailable',
  2: 'specialty_required',
  3: 'out_of_warranty',
  4: 'cost_too_high',
};

export default function DeclineModal({ wo, onClose, onSuccess }) {
  const [reason, setReason] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await woApi.decline(wo.id, {
        reason: notes.trim() || reason.label,
        declineReasonCode: CODE_MAP[reason.code] || 'other',
        reroute: true,
      });
      onSuccess && onSuccess();
    } catch (e) {
      setError(e.detail || e.message || 'Decline failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-navy-900 border border-navy-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-navy-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-red/15 border border-accent-red/40 flex items-center justify-center">
              <XCircle className="w-4 h-4 text-accent-red" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-strong">
                Decline {primaryRoLabel(wo)}
              </h3>
              <p className="text-xs text-text-muted">
                The repair request will be auto-routed to the next eligible vendor.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-strong">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-text-muted mb-2 block uppercase tracking-wider">
              Reason code *
            </label>
            <div className="space-y-2">
              {WO_DECLINE_REASONS.map((r) => {
                const selected = reason?.code === r.code;
                return (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => setReason(r)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                      selected
                        ? 'border-accent-red/60 bg-accent-red/10'
                        : 'border-navy-700 bg-navy-800/40 hover:border-navy-600'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selected ? 'border-accent-red bg-accent-red text-white' : 'border-navy-600'
                    }`}>
                      {selected && <span className="text-xs">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                        Code {r.code}
                      </div>
                      <div className="text-sm text-text-strong">{r.label}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-text-muted mb-1 block uppercase tracking-wider">
              Additional notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-text-strong placeholder-text-muted resize-none"
              placeholder="Anything the next vendor needs to know"
            />
          </div>
          {error && (
            <div className="text-xs text-accent-red flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-navy-700 bg-navy-900/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium text-text-muted hover:text-text-strong hover:bg-navy-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!reason || submitting}
            className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-semibold bg-accent-red text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            {submitting ? 'Declining…' : 'Decline'}
          </button>
        </div>
      </div>
    </div>
  );
}
