/**
 * SwWoActions — the inline action panel the Service Writer gets per
 * active RO inside VanDetailView. Bundles the iter-1 SW-side ops the
 * vendor needs to drive a WO without leaving the van detail page:
 *
 *   • Assigned technician — dropdown of vendor's techs (re-assign or clear)
 *   • Internal notes — vendor-only thread (channel='internal')
 *   • Per-defect "Defer" — re-route an in-flight defect to another vendor
 *   • Mid-find — add a defect the technician found mid-repair
 *
 * The pickup-request action lives on the StatusChanger flow (going to
 * READY TO SCHEDULE opens ScheduleModal which writes scheduled_at). The
 * per-defect cost approval is the DSP's side and lives in their dashboard.
 *
 * Endpoint wiring:
 *   GET   /work-orders/{id}/notes?channel=internal
 *   POST  /work-orders/{id}/notes  body={ body, channel: 'internal' }
 *   POST  /work-orders/{id}/assign-technician  body={ technicianId|null }
 *   POST  /repair-requests/{rr_id}/defer-defect  body={ defectId, reason }
 *   POST  /repair-requests/{rr_id}/add-defect    body={ part, defectType, ... }
 *   GET   /users?role=technician&organizationId=V-{orgId}     (for tech list)
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, AlertCircle, FileText, Wrench, Plus, X, ChevronDown, ChevronUp,
  UserPlus, AlertTriangle, DollarSign, Check, MessageSquare, Megaphone,
} from 'lucide-react';
import {
  workOrders as woApi,
  repairRequests as rrApi,
  directory as directoryApi,
  defects as defectsApi,
  catalog as catalogApi,
} from '../../api/client';

export default function SwWoActions({
  row,                  // WoSummaryRo from wo-summary endpoint
  workshopOrgId,        // vendor org id (for tech list scoping)
  vehicleClass,         // vehicle.vehicle_class (drives mid-find catalog)
  onChanged,            // refetch hook for the parent (VanDetailView reload)
}) {
  const woId = row.workOrderIdStr || row.workOrderId;
  return (
    <div className="mt-3 pt-3 border-t border-navy-800 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <AssignTechPanel woId={woId} currentTechName={row.assignedTechnicianName} workshopOrgId={workshopOrgId} onChanged={onChanged} />
        <MidFindPanel rrIdHint={row.repairRequestId} woId={woId} vehicleClass={vehicleClass} onChanged={onChanged} />
      </div>
      <SetCostPanel row={row} onChanged={onChanged} />
      <InternalNotesPanel woId={woId} />
      <CustomerNotesPanel woId={woId} />
      <DeferDefectsPanel row={row} onChanged={onChanged} />
    </div>
  );
}

// ─────────────────────────────────────────────────────
// CustomerNotesPanel — channel='customer' thread + Escalate button.
// Per mockup p.7: the SW can flag any customer note as escalated
// with reason 'cmr' (customer maintenance request) or
// 'exceeded_price_cap'. Escalated notes render with a red Megaphone
// chip so the DSP-side notes view can prioritise them visually.
// ─────────────────────────────────────────────────────
function CustomerNotesPanel({ woId }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  // Escalation state — null = regular send; 'cmr'/'exceeded_price_cap' = escalate.
  const [escalation, setEscalation] = useState(null);
  const [escalationOpen, setEscalationOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    woApi
      .listNotes(woId, { channel: 'customer' })
      .then((rows) => setNotes(Array.isArray(rows) ? rows : (rows?.items || [])))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false));
  }, [woId]);

  useEffect(() => { load(); }, [load]);

  const submit = async (reason = null) => {
    const body = draft.trim();
    if (!body) return;
    setErr(null);
    setSaving(true);
    try {
      await woApi.addNote(woId, {
        body,
        channel: 'customer',
        authorRole: 'vendor_service_writer',
        escalationReason: reason || undefined,
      });
      setDraft('');
      setEscalation(null);
      setEscalationOpen(false);
      load();
    } catch (e) {
      setErr(e.detail || e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-navy-800 bg-navy-900/40 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1">
        <MessageSquare className="w-3 h-3" />
        Customer notes
        <span className="text-text-muted/70">· visible to DSP · {notes.length}</span>
      </div>

      {loading ? (
        <div className="text-xs text-text-muted flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {notes.length > 0 && (
            <ul className="space-y-1 mb-2 max-h-40 overflow-y-auto">
              {notes.map((n) => {
                const isEscalated = !!n.escalationReason;
                return (
                  <li
                    key={n.id}
                    className={`rounded px-2 py-1 ${
                      isEscalated
                        ? 'bg-accent-red/10 border border-accent-red/40'
                        : 'bg-navy-800/60'
                    }`}
                  >
                    {isEscalated && (
                      <div className="text-[9px] font-bold uppercase text-accent-red flex items-center gap-1 mb-0.5">
                        <Megaphone className="w-3 h-3" />
                        Escalated · {prettyEscalation(n.escalationReason)}
                      </div>
                    )}
                    <div className="text-xs text-text-strong whitespace-pre-wrap">{n.body}</div>
                    <div className="text-[9px] text-text-muted mt-0.5">
                      {n.authorRole || ''} · {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="Message visible to the DSP…"
              className="flex-1 rounded-md px-2 py-1 text-xs bg-navy-800 border border-navy-700 text-text-strong placeholder-text-muted outline-none focus:border-accent-blue resize-none"
            />
            <div className="flex flex-col gap-1 relative">
              <button
                type="button"
                onClick={() => submit()}
                disabled={saving || !draft.trim()}
                className="px-2 py-1 rounded-md bg-text-strong text-navy-950 text-xs font-semibold disabled:opacity-40"
              >
                {saving ? '…' : 'Send'}
              </button>
              <button
                type="button"
                onClick={() => setEscalationOpen(!escalationOpen)}
                disabled={saving || !draft.trim()}
                className="px-2 py-1 rounded-md border border-accent-red/50 text-accent-red text-xs font-semibold hover:bg-accent-red/10 disabled:opacity-40 flex items-center gap-1"
                title="Mark this note as escalated with a reason code"
              >
                <Megaphone className="w-3 h-3" />
                Escalate
              </button>
              {escalationOpen && (
                <div className="absolute right-0 top-full mt-1 z-10 w-44 rounded-md border border-navy-700 bg-navy-900 shadow-xl py-1">
                  <button
                    type="button"
                    onClick={() => submit('cmr')}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-navy-800 text-text-strong"
                  >
                    <div className="font-semibold">CMR</div>
                    <div className="text-[10px] text-text-muted">Customer Maintenance Request</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => submit('exceeded_price_cap')}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-navy-800 text-text-strong"
                  >
                    <div className="font-semibold">Exceeded Price Cap</div>
                    <div className="text-[10px] text-text-muted">Estimate over FMC cap</div>
                  </button>
                </div>
              )}
            </div>
          </div>
          {err && <div className="mt-1 text-[10px] text-accent-red">{err}</div>}
        </>
      )}
    </div>
  );
}

function prettyEscalation(r) {
  if (r === 'cmr') return 'CMR';
  if (r === 'exceeded_price_cap') return 'Exceeded Price Cap';
  return r;
}

// ─────────────────────────────────────────────────────
// SetCostPanel — per-defect cost input. SW types
// estimated_cost (+ optional FMC cap for AMR) and POSTs to
// /defects/{id}/cost. Backend auto-approves CMR under the DSP's
// threshold and AMR with no shortfall; otherwise pings the customer
// (DSP sees it in their "$ Approve cost" tile).
// ─────────────────────────────────────────────────────
function SetCostPanel({ row, onChanged }) {
  // Local edit buffer per defect id; lets the SW tweak without losing
  // state when the parent re-renders.
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);

  const onEdit = (defectId, key, value) => {
    setDrafts((d) => ({
      ...d,
      [defectId]: { ...(d[defectId] || {}), [key]: value },
    }));
  };

  const save = async (defect) => {
    const draft = drafts[defect.id] || {};
    const estimated = parseFloat(draft.estimated ?? defect.estimatedCost ?? '');
    if (!Number.isFinite(estimated) || estimated < 0) {
      setErr('Estimated cost must be a positive number.');
      return;
    }
    const fmcRaw = draft.fmc ?? defect.fmcCappedAt;
    const fmcCapped = fmcRaw === '' || fmcRaw == null ? null : parseFloat(fmcRaw);
    if (fmcCapped != null && !Number.isFinite(fmcCapped)) {
      setErr('FMC cap must be a number or empty.');
      return;
    }
    setErr(null);
    setBusyId(defect.id);
    try {
      const intId = parseIntId(defect.id);
      await defectsApi.setCost(intId, {
        estimatedCost: estimated,
        fmcCappedAt: fmcCapped,
      });
      // Clear the draft and let the parent reload so the badge updates.
      setDrafts((d) => {
        const next = { ...d };
        delete next[defect.id];
        return next;
      });
      onChanged && onChanged();
    } catch (e) {
      setErr(e.detail || e.message || 'Failed to set cost');
    } finally {
      setBusyId(null);
    }
  };

  if (!row.defects || row.defects.length === 0) return null;

  return (
    <div className="rounded-md border border-navy-800 bg-navy-900/40 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1">
        <DollarSign className="w-3 h-3" />
        Defect costs
        <span className="text-text-muted/70">· customer approves above threshold</span>
      </div>
      <div className="space-y-2">
        {row.defects.map((d) => {
          const draft = drafts[d.id] || {};
          const estimated = draft.estimated ?? (d.estimatedCost != null ? String(d.estimatedCost) : '');
          const fmcCap = draft.fmc ?? (d.fmcCappedAt != null ? String(d.fmcCappedAt) : '');
          const isAmr = d.billingType === 'amr';
          const dirty = (
            draft.estimated != null && Number(draft.estimated) !== Number(d.estimatedCost)
          ) || (
            draft.fmc != null && (draft.fmc === '' ? d.fmcCappedAt != null : Number(draft.fmc) !== Number(d.fmcCappedAt))
          );

          return (
            <div key={d.id} className="rounded bg-navy-800/40 px-2 py-1.5">
              <div className="flex items-center gap-2 flex-wrap text-xs mb-1">
                <span className="text-text-strong font-medium truncate flex-1">
                  {(d.part || '').replace(/_/g, ' ')}
                  {d.type ? ` — ${d.type.replace(/_/g, ' ')}` : ''}
                </span>
                {d.billingType && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold ${
                    isAmr
                      ? 'bg-accent-purple/15 text-accent-purple'
                      : 'bg-accent-blue/15 text-accent-blue'
                  }`}>
                    {d.billingType}
                  </span>
                )}
                <CostStatusBadge defect={d} />
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 flex-1">
                  <span className="text-[9px] text-text-muted uppercase tracking-wider w-12">Est $</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={estimated}
                    onChange={(e) => onEdit(d.id, 'estimated', e.target.value)}
                    placeholder="0.00"
                    className="w-full px-2 py-1 rounded bg-navy-800 border border-navy-700 text-xs text-text-strong placeholder-text-muted outline-none focus:border-accent-blue"
                  />
                </label>
                {isAmr && (
                  <label className="flex items-center gap-1 flex-1">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider w-14">FMC cap</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={fmcCap}
                      onChange={(e) => onEdit(d.id, 'fmc', e.target.value)}
                      placeholder="optional"
                      className="w-full px-2 py-1 rounded bg-navy-800 border border-navy-700 text-xs text-text-strong placeholder-text-muted outline-none focus:border-accent-blue"
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => save(d)}
                  disabled={busyId === d.id || !estimated || !dirty}
                  className="px-2 py-1 rounded bg-text-strong text-navy-950 text-xs font-semibold disabled:opacity-40"
                  title={dirty ? 'Save cost' : 'No changes to save'}
                >
                  {busyId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {err && (
        <div className="mt-1 text-[10px] text-accent-red flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {err}
        </div>
      )}
    </div>
  );
}

function CostStatusBadge({ defect }) {
  if (defect.costDecision === 'approved') {
    return (
      <span className="px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green text-[9px] uppercase font-semibold flex items-center gap-1">
        <Check className="w-2.5 h-2.5" />
        approved
      </span>
    );
  }
  if (defect.costDecision === 'rejected') {
    return (
      <span className="px-1.5 py-0.5 rounded bg-accent-red/15 text-accent-red text-[9px] uppercase font-semibold">
        rejected
      </span>
    );
  }
  if (defect.estimatedCost != null) {
    return (
      <span className="px-1.5 py-0.5 rounded bg-accent-gold/15 text-accent-gold text-[9px] uppercase font-semibold">
        pending customer
      </span>
    );
  }
  return (
    <span className="px-1.5 py-0.5 rounded bg-navy-700/60 text-text-muted text-[9px] uppercase font-semibold">
      no cost set
    </span>
  );
}

// ─────────────────────────────────────────────────────
// Assign technician (per-WO)
// ─────────────────────────────────────────────────────
function AssignTechPanel({ woId, currentTechName, workshopOrgId, onChanged }) {
  const [techs, setTechs] = useState([]);
  const [pickedId, setPickedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!workshopOrgId) return;
    directoryApi
      .users({ role: 'technician', organizationId: `V-${workshopOrgId}` })
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : (rows?.items || []);
        setTechs(list);
        // Pre-select the current tech if present in the list.
        const cur = list.find(
          (t) => (t.fullName || t.full_name) === currentTechName
        );
        if (cur) setPickedId(String(cur.id));
      })
      .catch(() => setTechs([]));
  }, [workshopOrgId, currentTechName]);

  const save = async () => {
    setErr(null);
    setSaving(true);
    try {
      // technicianId=null clears the assignment.
      const intId = pickedId ? Number(parseIntId(pickedId)) : null;
      await woApi.assignTechnician(woId, { technicianId: intId });
      onChanged && onChanged();
    } catch (e) {
      setErr(e.detail || e.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-navy-800 bg-navy-900/40 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1 flex items-center gap-1">
        <UserPlus className="w-3 h-3" />
        Assigned technician
      </div>
      <div className="flex items-center gap-2">
        <select
          value={pickedId}
          onChange={(e) => setPickedId(e.target.value)}
          className="flex-1 px-2 py-1 rounded-md bg-navy-800 border border-navy-700 text-xs text-text-strong outline-none"
        >
          <option value="">— Unassigned —</option>
          {techs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.fullName || t.full_name || t.email}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-2 py-1 rounded-md bg-text-strong text-navy-950 text-xs font-semibold disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
        </button>
      </div>
      {err && <div className="mt-1 text-[10px] text-accent-red">{err}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Internal notes (channel='internal', vendor-only)
// ─────────────────────────────────────────────────────
function InternalNotesPanel({ woId }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    woApi
      .listNotes(woId, { channel: 'internal' })
      .then((rows) => setNotes(Array.isArray(rows) ? rows : (rows?.items || [])))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false));
  }, [woId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const body = draft.trim();
    if (!body) return;
    setErr(null);
    setSaving(true);
    try {
      await woApi.addNote(woId, {
        body,
        channel: 'internal',
        authorRole: 'vendor_service_writer',
      });
      setDraft('');
      load();
    } catch (e) {
      setErr(e.detail || e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-navy-800 bg-navy-900/40 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1">
        <FileText className="w-3 h-3" />
        Internal notes
        <span className="text-text-muted/70">· vendor-only thread · {notes.length}</span>
      </div>
      {loading ? (
        <div className="text-xs text-text-muted flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {notes.length > 0 && (
            <ul className="space-y-1 mb-2 max-h-40 overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id} className="rounded bg-navy-800/60 px-2 py-1">
                  <div className="text-xs text-text-strong whitespace-pre-wrap">{n.body}</div>
                  <div className="text-[9px] text-text-muted mt-0.5">
                    {n.authorRole || ''} · {new Date(n.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="Add internal note (not visible to DSP)…"
              className="flex-1 rounded-md px-2 py-1 text-xs bg-navy-800 border border-navy-700 text-text-strong placeholder-text-muted outline-none focus:border-accent-blue resize-none"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving || !draft.trim()}
              className="self-end px-2 py-1 rounded-md bg-text-strong text-navy-950 text-xs font-semibold disabled:opacity-40"
            >
              {saving ? '…' : 'Save'}
            </button>
          </div>
          {err && <div className="mt-1 text-[10px] text-accent-red">{err}</div>}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Defer specific defects out of this WO
// ─────────────────────────────────────────────────────
function DeferDefectsPanel({ row, onChanged }) {
  // Use deferredIds state per-row to give immediate feedback before
  // the parent refetch lands.
  const [deferredIds, setDeferredIds] = useState(new Set());
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);

  const defer = async (defect) => {
    if (!row.repairRequestId) {
      setErr('No RR linked to this WO — cannot defer.');
      return;
    }
    const reason = window.prompt(
      `Cannot finish "${(defect.part || '').replace(/_/g, ' ')}" — reason:`,
      'parts unavailable / out of scope',
    );
    if (reason === null) return;
    setErr(null);
    setBusyId(defect.id);
    try {
      const intId = parseIntId(defect.id);
      await rrApi.deferDefect(row.repairRequestId, {
        defectId: intId,
        reason: reason.trim() || 'parts unavailable',
      });
      setDeferredIds((prev) => new Set(prev).add(defect.id));
      onChanged && onChanged();
    } catch (e) {
      setErr(e.detail || e.message || 'Defer failed');
    } finally {
      setBusyId(null);
    }
  };

  if (!row.defects || row.defects.length === 0) return null;

  return (
    <div className="rounded-md border border-navy-800 bg-navy-900/40 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        Defer a defect mid-repair
        <span className="text-text-muted/70">· re-routes to another vendor</span>
      </div>
      <div className="space-y-1">
        {row.defects.map((d) => {
          const isDeferred = deferredIds.has(d.id);
          const isBusy = busyId === d.id;
          return (
            <div
              key={d.id}
              className={`flex items-center gap-2 text-xs ${
                isDeferred ? 'opacity-50 line-through' : ''
              }`}
            >
              <span className="text-text-strong truncate flex-1">
                {(d.part || '').replace(/_/g, ' ')}
                {d.type ? ` — ${d.type.replace(/_/g, ' ')}` : ''}
              </span>
              {!isDeferred && (
                <button
                  type="button"
                  onClick={() => defer(d)}
                  disabled={isBusy}
                  className="text-[10px] px-2 py-0.5 rounded border border-accent-orange/40 text-accent-orange hover:bg-accent-orange/10 disabled:opacity-40"
                >
                  {isBusy ? '…' : 'Defer'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {err && <div className="mt-1 text-[10px] text-accent-red">{err}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Mid-find — add a defect the tech found mid-repair.
// Drives 3 dropdowns off the V2.2 defect catalog filtered for this
// vehicle's class, so SW can only pick valid (part, type, position)
// triples and the backend's enum check always passes.
// ─────────────────────────────────────────────────────
function MidFindPanel({ rrIdHint, woId, vehicleClass, onChanged }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(null);
  const [catErr, setCatErr] = useState(null);
  const [part, setPart] = useState('');
  const [defectType, setDefectType] = useState('');
  const [position, setPosition] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open || !vehicleClass || cat) return;
    catalogApi
      .load(vehicleClass)
      .then(setCat)
      .catch((e) => setCatErr(e.detail || e.message || 'Failed to load catalog'));
  }, [open, vehicleClass, cat]);

  // Catalog shape: { parts: [{ id, label, defectTypes: [{ id, label, validPositions: [{id, label}] }] }] }
  const parts = (() => {
    if (!Array.isArray(cat?.parts)) return [];
    return cat.parts.map((p) => ({ id: p.id, label: p.label || p.id }));
  })();
  const partInfo = part ? (cat?.parts?.find((p) => p.id === part) || null) : null;
  const typesForPart = (() => {
    if (!partInfo?.defectTypes) return [];
    return partInfo.defectTypes.map((t) => ({ id: t.id, label: t.label || t.id }));
  })();
  const typeInfo = defectType ? (partInfo?.defectTypes?.find((t) => t.id === defectType) || null) : null;
  const positionsForPair = (() => {
    if (!typeInfo?.validPositions) return [];
    return typeInfo.validPositions.map((p) => ({ id: p.id, label: p.label || p.id }));
  })();

  const reset = () => {
    setPart(''); setDefectType(''); setPosition(''); setNotes('');
    setErr(null);
  };

  const save = async () => {
    if (!part || !defectType) {
      setErr('Part and defect type are required.');
      return;
    }
    let rrId = rrIdHint;
    if (!rrId) {
      try {
        const detail = await woApi.get(woId);
        rrId = detail.repairRequestId;
      } catch (e) {
        setErr('Could not resolve RR for this WO.');
        return;
      }
    }
    setErr(null);
    setSaving(true);
    try {
      await rrApi.addDefect(rrId, {
        part,
        defectType,
        position: position || undefined,
        notes: notes.trim() || undefined,
      });
      reset();
      setOpen(false);
      onChanged && onChanged();
    } catch (e) {
      setErr(e.detail || e.message || 'Failed to add');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-navy-800 bg-navy-900/40 p-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <Plus className="w-3 h-3" />
        Defect found mid-repair
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {catErr && (
            <div className="text-[10px] text-accent-red">{catErr}</div>
          )}
          {!cat && !catErr && (
            <div className="text-[10px] text-text-muted flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading catalog…
            </div>
          )}
          {cat && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={part}
                  onChange={(e) => { setPart(e.target.value); setDefectType(''); setPosition(''); }}
                  className="px-2 py-1 rounded-md bg-navy-800 border border-navy-700 text-xs text-text-strong outline-none"
                >
                  <option value="">— Part —</option>
                  {parts.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <select
                  value={defectType}
                  onChange={(e) => { setDefectType(e.target.value); setPosition(''); }}
                  disabled={!part || typesForPart.length === 0}
                  className="px-2 py-1 rounded-md bg-navy-800 border border-navy-700 text-xs text-text-strong outline-none disabled:opacity-40"
                >
                  <option value="">— Defect type —</option>
                  {typesForPart.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                disabled={!defectType || positionsForPair.length === 0}
                className="w-full px-2 py-1 rounded-md bg-navy-800 border border-navy-700 text-xs text-text-strong outline-none disabled:opacity-40"
              >
                <option value="">
                  {positionsForPair.length === 0 ? '— No position needed —' : '— Position (optional) —'}
                </option>
                {positionsForPair.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Notes (optional — e.g. found while inspecting brake job)"
                className="w-full px-2 py-1 rounded-md bg-navy-800 border border-navy-700 text-xs text-text-strong placeholder-text-muted outline-none resize-none"
              />
            </>
          )}
          {err && (
            <div className="text-[10px] text-accent-red flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {err}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="px-2 py-1 rounded text-xs text-text-muted hover:text-text-strong"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !part || !defectType}
              className="px-2 py-1 rounded bg-accent-orange text-navy-950 text-xs font-semibold disabled:opacity-40"
            >
              {saving ? '…' : 'Report defect'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseIntId(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}
