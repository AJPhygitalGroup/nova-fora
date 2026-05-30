/**
 * ScheduleModal — SW proposes a pickup slot AND triggers the DSP's
 * "Confirm Pickup" prompt in one action. Two backend calls chained:
 *
 *   1. POST /work-orders/{id}/schedule
 *        → pins wo.scheduled_at + wo.repair_bucket (SW's proposal)
 *   2. POST /work-orders/{id}/pickup-request
 *        → sets ro.pickup_type + ro.pickup_requested_at on every primary
 *          RO on the vehicle, which triggers the DSP's customer-counter
 *          "Confirm Pickup" card. DSP fills location/keys/etc and confirms
 *          (POST /confirm-pickup), which sets ro.scheduled_start_at and
 *          flips the WO to in_progress.
 *
 * Why both: per John's note, the SW shouldn't unilaterally finalize a
 * pickup — the DSP has to confirm the slot before it's the real schedule.
 * Chaining keeps the SW flow one click while preserving the
 * propose → confirm handshake on the data side.
 */
import { useState } from 'react';
import { X, Calendar, Loader2, AlertCircle } from 'lucide-react';
import { workOrders as woApi } from '../../api/client';
import { primaryRoLabel } from '../../lib/wo';

export default function ScheduleModal({ wo, onSuccess, onClose }) {
  // Default to today 9 AM if no current scheduled_at; preserve otherwise.
  const initial = wo.scheduledAt ? new Date(wo.scheduledAt) : (() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  })();
  const [date, setDate] = useState(toDateInput(initial));
  const [time, setTime] = useState(toTimeInput(initial));
  const [bucket, setBucket] = useState(wo.repairBucket || 'shop');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null);
    if (!date || !time) {
      setErr('Date and time are required.');
      return;
    }
    setSubmitting(true);
    try {
      // Combine date + time into a local Date, then ISO-string it. The
      // backend stores TIMESTAMPTZ — sending the local-aware ISO keeps
      // round-trips correct without manual tz math.
      const dt = new Date(`${date}T${time}`);
      if (Number.isNaN(dt.getTime())) {
        throw new Error('Invalid date/time');
      }
      // 1. Pin SW's proposed slot + bucket
      await woApi.schedule(wo.id, {
        scheduledAt: dt.toISOString(),
        repairBucket: bucket,
      });
      // 2. Send pickup request → triggers the DSP's "Confirm Pickup"
      //    counter. pickup_type is derived from the chosen bucket:
      //    overnight → vendor sends a truck overnight (rush);
      //    shop      → DSP drops the van off at the shop in business hours.
      //    A short pickup_duration_text carries the SW's proposed slot
      //    so the DSP sees it in their confirm modal without needing a
      //    separate proposed_start_at column.
      const niceDt = dt.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
      await woApi.pickupRequest(wo.id, {
        pickupType: bucket === 'overnight' ? 'overnight_rush' : 'in_shop',
        pickupDurationText: `Proposed: ${niceDt} (${bucket === 'overnight' ? 'overnight rush' : 'in-shop'})`,
      });
      onSuccess && onSuccess();
    } catch (e) {
      setErr(e.detail || e.message || 'Could not schedule');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-green/15 border border-accent-green/40 flex items-center justify-center">
              <Calendar size={16} className="text-accent-green" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-strong">Schedule Work Order</h3>
              <p className="text-[11px] text-text-muted">{primaryRoLabel(wo)} · Picks the slot the DSP + tech will see</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-strong p-2 -mr-2">
            <X size={20} />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">
                Date
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-text-strong outline-none focus:border-accent-green"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">
                Time
              </span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-text-strong outline-none focus:border-accent-green"
              />
            </label>
          </div>

          <div>
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">
              Repair bucket
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBucket('overnight')}
                className={`px-3 py-2 rounded-lg border text-sm font-medium ${
                  bucket === 'overnight'
                    ? 'bg-accent-purple/20 border-accent-purple text-accent-purple'
                    : 'bg-navy-800 border-navy-700 text-text-strong hover:border-navy-600'
                }`}
              >
                Overnight
                <div className="text-[10px] text-text-muted font-normal">Van returns before dispatch</div>
              </button>
              <button
                type="button"
                onClick={() => setBucket('shop')}
                className={`px-3 py-2 rounded-lg border text-sm font-medium ${
                  bucket === 'shop'
                    ? 'bg-accent-blue/20 border-accent-blue text-accent-blue'
                    : 'bg-navy-800 border-navy-700 text-text-strong hover:border-navy-600'
                }`}
              >
                Shop
                <div className="text-[10px] text-text-muted font-normal">Held more than one cycle</div>
              </button>
            </div>
          </div>

          <div className="text-[11px] text-text-muted leading-relaxed">
            <strong className="text-text-strong">This is a proposal, not a final schedule.</strong>{' '}
            The DSP receives a "Confirm Pickup" prompt with your proposed
            slot and pickup type. Once they confirm with the final time +
            key/location details, the work order flips to <em>in progress</em>.
          </div>

          {err && (
            <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-text-muted hover:text-text-strong hover:bg-navy-800"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !date || !time}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-navy-950 hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Scheduling…
              </>
            ) : (
              <>
                <Calendar size={14} /> Save schedule
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function toDateInput(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toTimeInput(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
