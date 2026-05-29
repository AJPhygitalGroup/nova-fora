/**
 * PendingFeedbackListModal — DSP-side list of completed WOs waiting
 * for a review. Opens from the "X pending feedback" badge on the
 * Defects Repaired tile (RealDVIC home). Each row launches the
 * standalone FeedbackModal; submitting refreshes this list.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, AlertTriangle, MessageSquare, Star } from 'lucide-react';
import { vendorScorecard as scorecardApi } from '../../api/client';
import FeedbackModal from './FeedbackModal';

export default function PendingFeedbackListModal({ dspId, onClose, onChanged }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [activeRepair, setActiveRepair] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    // No days filter — every unrated completed WO regardless of age,
    // matches the home tile counter exactly.
    scorecardApi
      .pending({ dspId })
      .then((r) => setRows(Array.isArray(r) ? r : (r?.items || [])))
      .catch((e) => setErr(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [dspId]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-navy-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent-gold/15 border border-accent-gold/40 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-accent-gold" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-strong">Pending Feedback</h3>
                <p className="text-[11px] text-text-muted">
                  Rate the vendor's work — feeds their scorecard.
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-strong p-2 -mr-2">
              <X size={20} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-2 overflow-y-auto flex-1">
            {loading && (
              <div className="flex items-center justify-center py-6 text-text-muted">
                <Loader2 className="w-4 h-4 animate-spin mr-1" /> Loading…
              </div>
            )}
            {err && (
              <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {err}
              </div>
            )}
            {!loading && !err && rows && rows.length === 0 && (
              <p className="text-sm text-text-muted text-center py-6">
                All caught up — no completed repairs awaiting your review.
              </p>
            )}
            {rows && rows.map((r) => (
              <div
                key={r.workOrderId}
                className="rounded-lg border border-navy-700 bg-navy-800/40 px-3 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text-strong">
                    Van {r.vehicleFleetId || r.vehicleIdStr || r.workOrderId}
                    <span className="text-text-muted text-xs font-normal ml-2">
                      · {r.workOrderIdStr}
                    </span>
                  </div>
                  <div className="text-[11px] text-text-muted">
                    {r.workshopName || '—'}
                    {r.completedAt && ` · Completed ${new Date(r.completedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveRepair({
                    id: r.workOrderIdStr,
                    workOrderIdStr: r.workOrderIdStr,
                    desc: `Van ${r.vehicleFleetId || r.vehicleIdStr}`,
                    workshopName: r.workshopName,
                  })}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/80"
                >
                  <Star className="w-3 h-3" />
                  Rate
                </button>
              </div>
            ))}
          </div>

          <div className="px-5 py-3 border-t border-navy-800 bg-navy-900/80 text-right">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-md text-xs font-semibold border border-navy-700 text-text-strong hover:bg-navy-800"
            >
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>

      {activeRepair && (
        <FeedbackModal
          repair={activeRepair}
          onClose={() => setActiveRepair(null)}
          onSubmitted={() => {
            setActiveRepair(null);
            load();
            onChanged && onChanged();
          }}
        />
      )}
    </>
  );
}
