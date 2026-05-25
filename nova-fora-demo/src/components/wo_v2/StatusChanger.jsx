/**
 * StatusChanger — clickable status pill exposing the canonical SW
 * progression (per Jorge's spec note, 2026-05-25):
 *
 *   PENDING ─→ PENDING FMC ─→ PENDING PARTS ─→ READY TO SCHEDULE
 *                                                       │
 *                                                       ▼
 *                                                  IN PROGRESS ─→ COMPLETED
 *
 *   DECLINED   only valid from PENDING.
 *   CANCELLED  valid from any non-terminal status.
 *
 * The 8 options are always clickable; pre-flight checks below catch
 * out-of-order picks so the SW sees a useful error instead of a 409
 * from the API. Backend endpoint mapping:
 *
 *   PENDING FMC        /accept (if needed) + sync-event 'submitted_to_fmc'
 *   PENDING PARTS      sync-event 'fmc_approved' (closes FMC) + 'parts_ordered'
 *   READY TO SCHEDULE  sync-event 'parts_received' (closes parts) + opens
 *                       ScheduleModal so the SW pins scheduled_at + bucket
 *                       — that slot then drives the DSP + Tech "Scheduled
 *                       Repairs" cards via /work-orders?scheduled_within_hours
 *   IN PROGRESS        /start  (requires scheduled_at to be set)
 *   DECLINED           opens DeclineModal (reason code required)
 *   COMPLETED          opens CompleteModal (mileage + photos)
 *   CANCELLED          confirm prompt + /cancel
 *
 * The current key is highlighted with a solid-colour pill so the SW
 * sees where they are in the linear flow at a glance.
 */
import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { workOrders as woApi } from '../../api/client';

// 8 chip statuses, ordered to match the canonical SW flow (Jorge,
// 2026-05-25): forward path first, then the two branches (DECLINED
// from pending only; CANCELLED from anywhere non-terminal).
export const STATUS_OPTIONS = [
  { key: 'pending',           label: 'PENDING' },
  { key: 'pendingFmc',        label: 'PENDING FMC' },
  { key: 'pendingParts',      label: 'PENDING PARTS' },
  { key: 'readyToSchedule',   label: 'READY TO SCHEDULE' },
  { key: 'inProgress',        label: 'IN PROGRESS' },
  { key: 'completed',         label: 'COMPLETED' },
  { key: 'declined',          label: 'DECLINED' },
  { key: 'cancelled',         label: 'CANCELLED' },
];

/**
 * Read-only pill used outside the SW context (e.g., the DSP customer
 * table where the DSP can see the status but can't change it).
 *
 * `wo` is the same WO row the SW dropdown reads, so the chip the DSP
 * sees ALWAYS matches what the SW set — single source of truth.
 */
export function StatusPill({ wo, className = '' }) {
  const key = deriveStatusKey(wo);
  const label = STATUS_OPTIONS.find((o) => o.key === key)?.label || key.toUpperCase();
  return (
    <span
      className={`inline-flex items-center px-2 py-1 text-xs rounded-md border font-medium ${pillClass(key)} ${className}`}
      title={`Status: ${label}`}
    >
      {label}
    </span>
  );
}

function pillClass(key) {
  switch (key) {
    case 'pending':           return 'bg-accent-gold/15 text-accent-gold border-accent-gold/40';
    case 'pendingParts':      return 'bg-accent-orange/15 text-accent-orange border-accent-orange/40';
    case 'pendingFmc':        return 'bg-accent-purple/15 text-accent-purple border-accent-purple/40';
    case 'readyToSchedule':   return 'bg-accent-green/15 text-accent-green border-accent-green/40';
    case 'inProgress':        return 'bg-accent-blue/15 text-accent-blue border-accent-blue/40';
    case 'declined':          return 'bg-accent-red/15 text-accent-red border-accent-red/40';
    case 'completed':         return 'bg-accent-green/15 text-accent-green border-accent-green/40';
    case 'cancelled':         return 'bg-navy-800 text-navy-300 border-navy-700';
    default:                  return 'bg-navy-800 text-navy-300 border-navy-700';
  }
}

function activeChipClass(key) {
  switch (key) {
    case 'pending':           return 'bg-accent-gold text-navy-950';
    case 'pendingParts':      return 'bg-accent-orange text-navy-950';
    case 'pendingFmc':        return 'bg-accent-purple text-white';
    case 'readyToSchedule':   return 'bg-accent-green text-navy-950';
    case 'inProgress':        return 'bg-accent-blue text-white';
    case 'declined':          return 'bg-accent-red text-white';
    case 'completed':         return 'bg-accent-green text-navy-950';
    case 'cancelled':         return 'bg-navy-700 text-text-strong';
    default:                  return 'bg-navy-700 text-text-strong';
  }
}

// Derive the current chip key from a WO's raw status + primary RO state.
// Must mirror the backend `_classify_accepted` logic in dashboards.py.
export function deriveStatusKey(wo) {
  if (!wo) return 'pending';
  if (wo.status === 'pending_acceptance') return 'pending';
  if (wo.status === 'in_progress')         return 'inProgress';
  if (wo.status === 'completed')           return 'completed';
  if (wo.status === 'declined')            return 'declined';
  if (wo.status === 'cancelled')           return 'cancelled';
  // accepted — split by RO sub-state (latest stage wins)
  const r = wo.primaryRo || (Array.isArray(wo.ros) ? wo.ros.find((x) => x.isPrimary) : null);
  if (r) {
    if (r.submittedToFmcAt && !r.fmcApprovedAt) return 'pendingFmc';
    if (r.partsOrderedAt && !r.partsReceivedAt) return 'pendingParts';
  }
  return 'readyToSchedule';
}

// Linear forward order of the SW flow. The numeric index lets the
// pre-flight check tell forward jumps (allowed but auto-fills the
// intermediate steps) from backward jumps (rejected — the SW would
// have to cancel + create a new WO).
const FLOW_ORDER = [
  'pending',
  'pendingFmc',
  'pendingParts',
  'readyToSchedule',
  'inProgress',
  'completed',
];

function flowIndex(key) {
  const i = FLOW_ORDER.indexOf(key);
  return i === -1 ? -1 : i;
}

// All 8 options are clickable. Pre-flight checks catch the most common
// impossible transitions before the network call so the SW sees a
// useful error instead of a 409 from the API.
function preflightError(wo, target, r, currentKey) {
  const status = wo?.status;
  if (status === 'completed' || status === 'cancelled' || status === 'declined') {
    return `WO is already ${status.replace('_', ' ')} — terminal state, no further changes.`;
  }

  // DECLINED is only valid from PENDING (pending_acceptance). Once the
  // vendor accepts, declining isn't a thing anymore — CANCELLED is.
  if (target === 'declined' && currentKey !== 'pending') {
    return 'Decline is only available while the WO is PENDING. Cancel it instead.';
  }
  // CANCELLED is always allowed from non-terminal states (we already
  // returned above for terminal). No further check.
  if (target === 'cancelled') return null;

  // Linear-forward checks.
  if (target === 'pending') {
    return "Can't revert a WO back to PENDING — once accepted/declined, the move is one-way.";
  }

  const tIdx = flowIndex(target);
  const cIdx = flowIndex(currentKey);
  if (tIdx !== -1 && cIdx !== -1 && tIdx < cIdx) {
    return `Can't go backwards from ${currentKey} to ${target}. Cancel the WO and create a new one if you really need to.`;
  }

  // Sub-state events (pendingFmc / pendingParts / readyToSchedule)
  // need a primary RO. /accept creates one automatically on first move.
  if ((target === 'pendingFmc' || target === 'pendingParts' || target === 'readyToSchedule')
      && status === 'accepted' && !r) {
    return 'No primary RO attached yet — try again or contact support.';
  }

  // inProgress requires scheduled_at (the slot the DSP + tech see).
  // Going to inProgress directly from PENDING is fine for ad-hoc rushes,
  // but from anywhere else we want a scheduled slot first.
  if (target === 'inProgress' && currentKey === 'readyToSchedule' && !wo.scheduledAt) {
    return 'Set a schedule first — pick READY TO SCHEDULE to open the calendar.';
  }

  return null;
}

export default function StatusChanger({
  wo,
  onAfter,                   // refetch hook
  onOpenDeclineModal,        // (wo) => void
  onOpenCompleteModal,       // (wo) => void
  onOpenScheduleModal,       // (wo) => void  — opens ScheduleModal
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ref = useRef(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const currentKey = deriveStatusKey(wo);
  const currentLabel = STATUS_OPTIONS.find((o) => o.key === currentKey)?.label || currentKey.toUpperCase();

  // Re-fetch the WO before any transition so we react to the LIVE state
  // instead of whatever the parent table cached at last load. Without
  // this the SW gets "WO is accepted; only pending_acceptance can be
  // accepted" when the table is stale from a sibling change.
  const fetchFresh = async () => {
    try {
      return await woApi.get(wo.id);
    } catch {
      return wo;
    }
  };

  // Ensure a primary RO exists. If the WO is still pending_acceptance,
  // /accept generates the placeholder RO. Idempotent — safe even if a
  // sibling fired accept seconds ago.
  const ensureAcceptedWithRo = async (currentDetail) => {
    let detail = currentDetail || wo;
    if (detail.status === 'pending_acceptance') {
      await woApi.accept(detail.id);
      detail = await woApi.get(detail.id);
    } else if (!detail.primaryRo && (!detail.ros || !detail.ros.length)) {
      detail = await woApi.get(detail.id);
    }
    const ro = detail.primaryRo
      || (Array.isArray(detail.ros) ? detail.ros.find((x) => x.isPrimary) || detail.ros[0] : null);
    if (!ro) throw new Error('No primary RO attached');
    return { detail, ro };
  };

  const pick = async (target) => {
    if (target === currentKey) { setOpen(false); return; }

    setBusy(true);
    setErr(null);
    try {
      // ALWAYS work off live state — the parent table can lag if a
      // sibling change just happened or this WO was mutated via a
      // different tab.
      const live = await fetchFresh();
      const liveKey = deriveStatusKey(live);
      const liveRo = live.primaryRo
        || (Array.isArray(live.ros) ? live.ros.find((x) => x.isPrimary) : null);

      // If the WO is already in the requested target, no work — just refresh.
      if (target === liveKey) {
        setOpen(false);
        onAfter && onAfter();
        return;
      }

      const pre = preflightError(live, target, liveRo, liveKey);
      if (pre) {
        setErr(pre);
        return;  // keep dropdown open so the SW sees why
      }

      if (target === 'declined') {
        onOpenDeclineModal && onOpenDeclineModal(live);
        setOpen(false);
        return;
      }
      if (target === 'completed') {
        onOpenCompleteModal && onOpenCompleteModal(live);
        setOpen(false);
        return;
      }
      if (target === 'cancelled') {
        const reason = window.prompt(`Cancel ${live.id}? Reason (optional):`, '');
        if (reason === null) { setOpen(false); return; }
        await woApi.cancel(live.id, { reason: reason.trim() || undefined });
        setOpen(false);
        onAfter && onAfter();
        return;
      }

      // ── Linear forward transitions (all idempotent against the live RO state) ──
      if (target === 'pendingFmc') {
        const { ro } = await ensureAcceptedWithRo(live);
        if (!ro.submittedToFmcAt) {
          await woApi.roSyncEvent(live.id, ro.id, { event: 'submitted_to_fmc' });
        }
        setOpen(false);
        onAfter && onAfter();
        return;
      }

      if (target === 'pendingParts') {
        const { ro } = await ensureAcceptedWithRo(live);
        if (ro.submittedToFmcAt && !ro.fmcApprovedAt) {
          await woApi.roSyncEvent(live.id, ro.id, { event: 'fmc_approved' });
        }
        if (!ro.partsOrderedAt) {
          await woApi.roSyncEvent(live.id, ro.id, { event: 'parts_ordered' });
        }
        setOpen(false);
        onAfter && onAfter();
        return;
      }

      // READY TO SCHEDULE: close any open sub-state + open the calendar
      // modal so the SW pins scheduled_at + repair_bucket. That slot
      // feeds the DSP and technician "Scheduled Repairs" cards via
      // /work-orders?scheduled_within_hours=36.
      if (target === 'readyToSchedule') {
        const { ro } = await ensureAcceptedWithRo(live);
        if (ro.submittedToFmcAt && !ro.fmcApprovedAt) {
          await woApi.roSyncEvent(live.id, ro.id, { event: 'fmc_approved' });
        }
        if (ro.partsOrderedAt && !ro.partsReceivedAt) {
          await woApi.roSyncEvent(live.id, ro.id, { event: 'parts_received' });
        }
        setOpen(false);
        if (onOpenScheduleModal) {
          onOpenScheduleModal({ ...live, status: 'accepted' });
        } else {
          onAfter && onAfter();
        }
        return;
      }

      if (target === 'inProgress') {
        if (live.status === 'pending_acceptance') {
          await ensureAcceptedWithRo(live);
        }
        await woApi.start(live.id);
        setOpen(false);
        onAfter && onAfter();
        return;
      }
    } catch (e) {
      setErr(e.detail || e.message || 'Transition failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border font-medium hover:brightness-110 disabled:opacity-50 ${pillClass(currentKey)}`}
        title="Click to change status"
      >
        {busy && <Loader2 className="w-3 h-3 animate-spin" />}
        {currentLabel}
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>
      {open && (
        <div
          className="absolute z-30 left-0 mt-1 w-52 rounded-md border border-navy-700 bg-navy-900 shadow-xl py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {STATUS_OPTIONS.map((opt) => {
            const isActive = opt.key === currentKey;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => pick(opt.key)}
                className={[
                  'block w-full text-left px-3 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer',
                  isActive ? activeChipClass(opt.key) : 'text-text-strong hover:bg-navy-800',
                ].join(' ')}
                title={isActive ? 'Current status' : `Change to ${opt.label}`}
              >
                {opt.label}
              </button>
            );
          })}
          {err && (
            <div className="px-3 py-2 text-[10px] text-accent-red border-t border-navy-700">
              {err}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
