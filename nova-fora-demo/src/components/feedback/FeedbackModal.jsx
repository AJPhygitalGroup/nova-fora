/**
 * FeedbackModal — DSP rates a completed work order.
 *
 * Shared by RealDVIC (customer-side pending list opens this per WO)
 * and the legacy VendorScorecard inline rate button. POSTs to
 * /vendor-scorecard/feedback on submit.
 *
 * Body sent:
 *   { workOrderId, vote, reason?, escalate?,
 *     impressiveAttribute? (only when vote='up'),
 *     negativeAttribute?   (only when vote='down') }
 *
 * The attribute picker mirrors the 5 categories Mohammed's demo
 * uses: turnaround_time / communication / professionalism /
 * work_quality / price.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ThumbsUp, ThumbsDown, AlertTriangle, Loader2, X } from 'lucide-react';
import { vendorScorecard as scorecardApi } from '../../api/client';

const ATTRIBUTES = [
  { key: 'turnaround_time', label: 'Turnaround Time' },
  { key: 'communication', label: 'Communication' },
  { key: 'professionalism', label: 'Professionalism' },
  { key: 'work_quality', label: 'Work Quality' },
  { key: 'price', label: 'Price' },
];

export default function FeedbackModal({ repair, onClose, onSubmitted }) {
  const [vote, setVote] = useState(null);
  const [reason, setReason] = useState('');
  const [escalate, setEscalate] = useState(false);
  const [attribute, setAttribute] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (!vote || !repair) return;
    setBusy(true);
    setErr(null);
    try {
      const body = {
        workOrderId: repair.id || repair.workOrderIdStr || repair.workOrderId,
        vote,
        reason: reason.trim() || undefined,
        escalate: vote === 'down' && escalate,
      };
      if (vote === 'up' && attribute) body.impressiveAttribute = attribute;
      if (vote === 'down' && attribute) body.negativeAttribute = attribute;
      const result = await scorecardApi.submit(body);
      onSubmitted && onSubmitted(result);
      onClose && onClose();
    } catch (e) {
      setErr(e.detail || e.message || 'Failed to submit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-navy-900 border border-navy-700 rounded-2xl p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Rate This Repair</h3>
            <p className="text-xs text-text-muted">
              {repair?.id || repair?.workOrderIdStr || '—'}
              {repair?.desc ? ` — ${repair.desc}` : ''}
              {repair?.workshopName ? ` · ${repair.workshopName}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-strong p-1 -mt-1 -mr-1">
            <X size={18} />
          </button>
        </div>

        {/* Vote selector */}
        <div className="flex gap-4 mb-4">
          <button
            type="button"
            onClick={() => { setVote('up'); setAttribute(null); }}
            className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all cursor-pointer ${
              vote === 'up'
                ? 'border-accent-green bg-accent-green/10'
                : 'border-navy-700 hover:border-navy-500'
            }`}
          >
            <ThumbsUp size={28} className={vote === 'up' ? 'text-accent-green' : 'text-text-muted'} />
            <span className={`text-sm font-medium ${vote === 'up' ? 'text-accent-green' : 'text-text-strong'}`}>
              Good Job
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setVote('down'); setAttribute(null); }}
            className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all cursor-pointer ${
              vote === 'down'
                ? 'border-accent-red bg-accent-red/10'
                : 'border-navy-700 hover:border-navy-500'
            }`}
          >
            <ThumbsDown size={28} className={vote === 'down' ? 'text-accent-red' : 'text-text-muted'} />
            <span className={`text-sm font-medium ${vote === 'down' ? 'text-accent-red' : 'text-text-strong'}`}>
              Needs Work
            </span>
          </button>
        </div>

        {/* Attribute picker — shown once a vote is selected. */}
        {vote && (
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
              {vote === 'up' ? 'What stood out?' : 'What needs work?'} (optional)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ATTRIBUTES.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAttribute(attribute === a.key ? null : a.key)}
                  className={`px-2.5 py-1 rounded-md border text-xs font-medium ${
                    attribute === a.key
                      ? vote === 'up'
                        ? 'border-accent-green bg-accent-green/15 text-accent-green'
                        : 'border-accent-red bg-accent-red/15 text-accent-red'
                      : 'border-navy-700 text-text-muted hover:border-navy-600 hover:text-text-strong'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Reason text */}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Tell us why (optional)…"
          className="w-full bg-navy-800 border border-navy-700 rounded-lg p-3 text-sm text-text-strong placeholder-text-muted resize-none h-20 focus:outline-none focus:border-accent-blue"
        />

        {vote === 'down' && (
          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={escalate}
              onChange={(e) => setEscalate(e.target.checked)}
              className="accent-accent-red"
            />
            <span className="text-sm text-accent-red flex items-center gap-1">
              <AlertTriangle size={14} /> Escalate — egregious quality issue
            </span>
          </label>
        )}

        {err && (
          <div className="mt-3 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-xs text-accent-red flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            {err}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg border border-navy-600 text-text-muted text-sm font-medium hover:bg-navy-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!vote || busy}
            className="flex-1 px-4 py-2.5 rounded-lg bg-accent-blue text-white text-sm font-semibold disabled:opacity-40 hover:bg-accent-blue/80 flex items-center justify-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Submit Feedback
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
