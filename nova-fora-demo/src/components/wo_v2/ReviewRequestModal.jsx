/**
 * ReviewRequestModal — what the SW sees when they click "review →" on an
 * incoming request (WO in pending_acceptance). Matches the demo's
 * "New request · Van X" modal.
 *
 * The modal lets the SW review the vehicle + reported defects, then
 * either:
 *   - Accept the WO. Optional fields:
 *       • RO NUMBER  — real vendor RO# (RO Writer / Mitchell / Auto
 *                      Integrate). If omitted, the placeholder TBD-{wo.id}
 *                      created by /accept stays in place; the SW can
 *                      replace it later via the row's modal.
 *       • Assign technician  — vendor user with role=technician scoped
 *                      to this workshop's org.
 *   - Decline — delegates to the existing DeclineModal (reason code
 *               + reroute toggle).
 *
 * Endpoint sequence on Accept:
 *   1. POST /work-orders/{id}/accept         (creates placeholder RO)
 *   2. PATCH /work-orders/{id}/ros/{ro_id}    (if RO# given)
 *   3. POST /work-orders/{id}/assign-technician  (if tech_id given)
 *   4. parent calls refresh
 */
import { useState, useEffect } from 'react';
import {
  X, Check, AlertTriangle, Loader2, ClipboardCheck, Wrench,
} from 'lucide-react';
import {
  workOrders as woApi,
  directory as directoryApi,
  repairRequests as rrApi,
} from '../../api/client';

const PART_ICON_LABELS = {
  // Friendly labels for the defect-card icon column. The schema's
  // `part` is already enum-value string; we just title-case it.
};

export default function ReviewRequestModal({
  woId,
  workshopOrgId,         // organization id of the vendor (for tech list scoping)
  onClose,
  onDecline,             // function — opens DeclineModal with the same wo
  onAfter,               // refetch hook for the parent table
}) {
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  const [roNumber, setRoNumber] = useState('');
  const [techId, setTechId] = useState('');
  const [techs, setTechs] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

  // Track which defect IDs the SW has already deferred in this session
  // so the row visually crosses out + the deferred-toast appears. Server
  // is the source of truth — refetch refreshes from there if needed.
  const [deferredIds, setDeferredIds] = useState(new Set());
  const [deferringId, setDeferringId] = useState(null);
  const [deferErr, setDeferErr] = useState(null);

  // Load WO detail (defects + vehicle).
  useEffect(() => {
    setLoading(true);
    setLoadErr(null);
    woApi
      .get(woId)
      .then(setWo)
      .catch((e) => setLoadErr(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [woId]);

  // Load technicians for the workshop's org (used in the assign dropdown).
  useEffect(() => {
    if (!workshopOrgId) return;
    directoryApi
      .users({ role: 'technician', organizationId: `V-${workshopOrgId}` })
      .then((rows) => setTechs(Array.isArray(rows) ? rows : (rows?.items || [])))
      .catch(() => setTechs([]));
  }, [workshopOrgId]);

  const accept = async () => {
    setSubmitErr(null);
    setSubmitting(true);
    try {
      // ALWAYS refetch — the table can lag if a sibling tab already
      // accepted this WO. Without this the SW gets a confusing 409 when
      // they click "Accept" on a stale row.
      let live = await woApi.get(woId);
      if (live.status === 'pending_acceptance') {
        await woApi.accept(live.id);
        live = await woApi.get(live.id);
      }
      // Overwrite the placeholder RO# if SW typed a real one.
      const trimmed = roNumber.trim();
      if (trimmed) {
        const primary = (live.ros || []).find((r) => r.isPrimary);
        if (primary) {
          await woApi.patchRo(live.id, primary.id, { roNumber: trimmed });
        }
      }
      // Assign the technician.
      if (techId) {
        await woApi.assignTechnician(live.id, {
          technicianId: Number(parseIntId(techId)),
        });
      }
      onAfter && onAfter();
      onClose && onClose();
    } catch (e) {
      setSubmitErr(e.detail || e.message || 'Accept failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = () => {
    onClose && onClose();
    onDecline && onDecline(wo || { id: woId });
  };

  // Per-defect "can't repair this one" — deferDefect routes the defect
  // to a follow-up RR. Source DR flips to DEFERRED so the SW's WO is
  // left with only the defects they CAN handle.
  const deferOneDefect = async (defect) => {
    if (!wo || !wo.repairRequestId) {
      setDeferErr('Missing repair_request_id on this WO — cannot defer.');
      return;
    }
    const reason = window.prompt(
      `Cannot repair "${(defect.part || '').replace(/_/g, ' ')}" — reason:`,
      'out of scope for this vendor',
    );
    if (reason === null) return;  // cancelled
    setDeferErr(null);
    setDeferringId(defect.id);
    try {
      const intId = parseIntId(defect.id);
      if (intId == null) throw new Error(`bad defect id ${defect.id}`);
      await rrApi.deferDefect(wo.repairRequestId, {
        defectId: intId,
        reason: reason.trim() || 'out of scope for this vendor',
      });
      setDeferredIds((prev) => {
        const next = new Set(prev);
        next.add(defect.id);
        return next;
      });
    } catch (e) {
      setDeferErr(e.detail || e.message || 'Defer failed');
    } finally {
      setDeferringId(null);
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
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div>
            <h3 className="text-base font-semibold text-text-strong">
              New request{wo ? ` · Van ${wo.vehicleFleetId || wo.vehicleIdStr || wo.vehicleId}` : ''}
            </h3>
            <p className="text-[11px] text-text-muted">
              {wo?.dspName || ''} {wo ? `· ${wo.id}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-strong p-2 -mr-2"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-6 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Loading…
            </div>
          )}
          {!loading && loadErr && (
            <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {loadErr}
            </div>
          )}
          {!loading && wo && (
            <>
              {/* Vehicle fact card */}
              <div className="rounded-lg border border-navy-700 bg-navy-800/40 p-3 grid grid-cols-2 gap-3 text-sm">
                <Fact label="Vehicle" value={[wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(' ')} />
                <Fact label="VIN" value={wo.vehicleVin} mono />
                <Fact label="Reported by" value={(wo.defects && wo.defects[0]?.reportedBy) || '—'} />
                <Fact label="Defects" value={wo.defects ? wo.defects.length : 0} />
              </div>

              {/* Defects list — each row has a per-defect "Cannot repair"
                  button that fires defer-defect (routes that single defect
                  to a follow-up RR on another vendor) so the SW can
                  selectively accept only what their shop handles. */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">
                  Reported defects ({wo.defects ? wo.defects.length : 0})
                </div>
                <div className="space-y-2">
                  {(wo.defects || []).map((d) => {
                    const isDeferred = deferredIds.has(d.id);
                    const isDeferring = deferringId === d.id;
                    return (
                      <div
                        key={d.id}
                        className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                          isDeferred
                            ? 'border-navy-800 bg-navy-800/10 opacity-60'
                            : 'border-navy-800 bg-navy-800/30'
                        }`}
                      >
                        <div className="w-12 h-12 rounded-md bg-navy-700 flex items-center justify-center text-[9px] font-semibold text-text-muted uppercase text-center px-1 leading-tight">
                          {(d.part || '').replace(/_/g, ' ').slice(0, 12)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium ${isDeferred ? 'line-through text-text-muted' : 'text-text-strong'}`}>
                            {(d.part || '').replace(/_/g, ' ')}
                            {d.defectType ? ` — ${d.defectType.replace(/_/g, ' ')}` : ''}
                          </div>
                          <div className="text-xs text-text-muted">
                            {prettySource(d.source)}
                            {d.position ? ` · ${d.position}` : ''}
                            {isDeferred && (
                              <span className="ml-2 text-accent-orange font-semibold">
                                · re-routed to another vendor
                              </span>
                            )}
                          </div>
                        </div>
                        {!isDeferred && (
                          <button
                            type="button"
                            onClick={() => deferOneDefect(d)}
                            disabled={isDeferring || submitting}
                            className="text-[11px] px-2 py-1 rounded-md border border-accent-orange/50 text-accent-orange hover:bg-accent-orange/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            title="This vendor can't repair this defect — route it to another shop"
                          >
                            {isDeferring ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <X className="w-3 h-3" />
                            )}
                            Cannot repair
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {(!wo.defects || wo.defects.length === 0) && (
                    <p className="text-xs text-text-muted">No defects attached to this WO yet.</p>
                  )}
                </div>
                {deferErr && (
                  <div className="mt-2 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-xs text-accent-red flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3" />
                    {deferErr}
                  </div>
                )}
              </div>

              {/* Accept form */}
              <div className="border-t border-navy-800 pt-4 space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Accept request
                </div>
                <label className="block">
                  <span className="text-xs font-semibold text-text-muted block mb-1">
                    RO number
                    <span className="font-normal text-text-muted/70 ml-2">
                      (optional — set later if not ready yet)
                    </span>
                  </span>
                  <input
                    type="text"
                    value={roNumber}
                    onChange={(e) => setRoNumber(e.target.value)}
                    placeholder="e.g. RO-12345 — leave blank for now"
                    className="w-full rounded-md px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-text-strong placeholder-text-muted outline-none focus:border-accent-blue"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-text-muted block mb-1">
                    Assign technician
                    <span className="font-normal text-text-muted/70 ml-2">(optional)</span>
                  </span>
                  <select
                    value={techId}
                    onChange={(e) => setTechId(e.target.value)}
                    className="w-full rounded-md px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-text-strong outline-none focus:border-accent-blue"
                  >
                    <option value="">— Assign later —</option>
                    {techs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.fullName || t.full_name || t.email}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {submitErr && (
                <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  {submitErr}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button
            type="button"
            onClick={handleDecline}
            disabled={!wo || submitting}
            className="px-4 py-2 rounded-md text-sm font-medium border border-navy-700 text-text-strong hover:bg-navy-800 disabled:opacity-40 flex items-center gap-1"
          >
            <X size={14} />
            Decline
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={!wo || submitting}
            className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-semibold bg-white text-black hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed shadow"
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Accepting…
              </>
            ) : (
              <>
                <ClipboardCheck size={14} />
                Accept
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, mono }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className={`text-sm text-text-strong ${mono ? 'font-mono break-all' : ''}`}>
        {value || '—'}
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
