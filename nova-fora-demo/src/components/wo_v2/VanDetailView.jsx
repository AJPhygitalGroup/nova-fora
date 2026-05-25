/**
 * VanDetailView — full-page view of a single van's WO history.
 *
 * Replaces the old per-WO SwWoModal. The mental model shifted from
 * "open this WO" to "open this van, see all ROs on it". Matches the
 * Van 1268 demo screenshot:
 *
 *   ← Back to SW dashboard
 *   ┌─────────────────────────────────────────────────────┐
 *   │ Van {fleet_id} {plate-badge}                        │
 *   │ Year/Make/Model  VIN  Customer/DSP  Class  FMC  Mi  │
 *   └─────────────────────────────────────────────────────┘
 *   [Total ROs] [Active ROs] [Open Defects] [Active Est] [Last service]
 *   SERVICE WRITER NOTES — list + add-note textarea
 *   ACTIVE WORK — RO rows w/ nested defects + badges
 *   SERVICE HISTORY — completed/cancelled ROs
 *   DEFECT TIMELINE — all defects, newest first
 *
 * Single fetch: GET /vehicles/{id}/wo-summary returns everything except
 * notes (which is its own endpoint so add-note can refresh just that
 * panel without re-pulling the whole van payload).
 */
import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Loader2, AlertTriangle, ClipboardList, PlayCircle,
  CheckCircle2, AlertCircle, Activity, FileText, Clock, ChevronRight,
  Trash2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { vehicles as vehiclesApi } from '../../api/client';
import RoModal from './RoModal';

export default function VanDetailView({ vehicleId, onBack }) {
  const [summary, setSummary] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Jorge#5: per-row "Manage RO" button opens the focused RO modal.
  const [openRoWoId, setOpenRoWoId] = useState(null);

  const loadSummary = useCallback(() => {
    setLoading(true);
    setError(null);
    return Promise.all([
      vehiclesApi.woSummary(vehicleId),
      vehiclesApi.listNotes(vehicleId).catch(() => []),
    ])
      .then(([s, n]) => {
        setSummary(s);
        setNotes(Array.isArray(n) ? n : (n.items || []));
      })
      .catch((e) => setError(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [vehicleId]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading van details…
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 mb-4 text-sm text-text-muted hover:text-text-strong"
        >
          <ArrowLeft className="w-4 h-4" /> Back to SW dashboard
        </button>
        <div className="px-4 py-3 rounded-md bg-accent-red/10 border border-accent-red/40 text-accent-red flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }
  if (!summary) return null;

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 mb-4 text-sm text-text-muted hover:text-text-strong"
      >
        <ArrowLeft className="w-4 h-4" /> Back to SW dashboard
      </button>

      <VanHeader v={summary} />
      <KpiStrip kpis={summary.kpis} />
      <NotesPanel
        vehicleId={vehicleId}
        notes={notes}
        onRefresh={(n) => setNotes(n)}
      />
      <ActiveWorkSection
        rows={summary.activeWork || []}
        vehicleClass={summary.vehicleClass}
        onChanged={loadSummary}
        onOpenRo={(woIdStr) => setOpenRoWoId(woIdStr)}
      />
      <ServiceHistorySection rows={summary.serviceHistory || []} />
      <DefectTimelineSection timeline={summary.defectTimeline || []} />

      {/* Per-row "Manage RO" opens the focused RO modal (Jorge#4/#5). */}
      {openRoWoId && (
        <RoModal
          woId={openRoWoId}
          onClose={() => setOpenRoWoId(null)}
          onAfterChange={loadSummary}
          onOpenVan={() => setOpenRoWoId(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Van header (year/make/model · VIN · DSP · class · FMC · mileage)
// ─────────────────────────────────────────────────────
function VanHeader({ v }) {
  return (
    <section className="rounded-lg border border-navy-700 bg-navy-900 p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h1 className="text-2xl font-bold text-text-strong">
          Van {v.fleetId || v.vehicleIdStr}
        </h1>
        <span className="px-2 py-0.5 rounded bg-accent-gold/15 border border-accent-gold/40 text-accent-gold text-xs font-mono font-semibold">
          {v.plate}
        </span>
        {v.vehicleIdStr && v.vehicleIdStr !== `VAN-${v.vehicleId}` && (
          <span className="text-xs text-text-muted">{v.vehicleIdStr}</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
        <FactCell label="Year / Make / Model" value={`${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim()} />
        <FactCell label="VIN" value={v.vin} mono />
        <FactCell label="Customer / DSP" value={v.dspName || `DSP ${v.dspId}`} />
        <FactCell label="Vehicle class" value={prettyClass(v.vehicleClass)} />
        <FactCell label="FMC managed" value={v.fmc ? v.fmc : 'No'} />
        <FactCell label="Last odometer" value={v.mileage != null ? `${v.mileage.toLocaleString()} mi` : '—'} />
      </div>
    </section>
  );
}

function FactCell({ label, value, mono }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className={`text-sm text-text-strong ${mono ? 'font-mono' : ''} break-all`}>
        {value || '—'}
      </div>
    </div>
  );
}

function prettyClass(cls) {
  if (!cls) return '—';
  return String(cls).replace(/_/g, ' ');
}

// ─────────────────────────────────────────────────────
// 5 KPI tiles — Total ROs · Active ROs · Open Defects · Active Est · Last Service
// ─────────────────────────────────────────────────────
function KpiStrip({ kpis }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
      <KpiTile label="Total ROs" value={kpis.totalRos} sub={`${kpis.completedRos} completed`} />
      <KpiTile label="Active ROs" value={kpis.activeRos} />
      <KpiTile label="Open Defects" value={kpis.openDefects} />
      <KpiTile
        label="Active Est."
        value={kpis.activeEstimate != null ? `$${Number(kpis.activeEstimate).toLocaleString()}` : '—'}
        big
      />
      <KpiTile label="Last Service" value={kpis.lastServiceAt ? new Date(kpis.lastServiceAt).toLocaleDateString() : '—'} />
    </div>
  );
}

function KpiTile({ label, value, sub, big }) {
  return (
    <div className="rounded-lg border border-navy-700 bg-navy-900 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
        {label}
      </div>
      <div className={`${big ? 'text-2xl' : 'text-2xl'} font-bold text-text-strong`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-text-muted mt-1">{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// SERVICE WRITER NOTES (persistent, vehicle-scoped)
// ─────────────────────────────────────────────────────
function NotesPanel({ vehicleId, notes, onRefresh }) {
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setErr(null);
    try {
      await vehiclesApi.addNote(vehicleId, { body });
      setDraft('');
      const fresh = await vehiclesApi.listNotes(vehicleId);
      onRefresh(Array.isArray(fresh) ? fresh : (fresh.items || []));
    } catch (e) {
      setErr(e.detail || e.message || 'Could not save note');
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="rounded-lg border border-navy-700 bg-navy-900 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Service Writer Notes
        </span>
        <span className="text-xs text-text-muted">· {notes.length}</span>
      </div>
      {notes.length === 0 && (
        <p className="text-xs text-text-muted mb-3">
          No notes yet on this van. Add one below — it'll show every time this vehicle comes in.
        </p>
      )}
      {notes.length > 0 && (
        <ul className="mb-3 space-y-2">
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} vehicleId={vehicleId} onDeleted={() => {
              vehiclesApi.listNotes(vehicleId).then((fresh) => {
                onRefresh(Array.isArray(fresh) ? fresh : (fresh.items || []));
              }).catch(() => {});
            }} />
          ))}
        </ul>
      )}
      <div className="flex items-stretch gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Note for next visit — e.g. 'DSP usually drops keys at side door'…"
          className="flex-1 rounded-md px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-text-strong placeholder-text-muted outline-none focus:border-accent-blue resize-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={posting || !draft.trim()}
          className="px-4 py-2 rounded-md bg-white text-navy-950 font-semibold text-sm hover:bg-white/90 disabled:opacity-40 self-end"
        >
          {posting ? '…' : 'Add note'}
        </button>
      </div>
      {err && (
        <div className="mt-2 text-xs text-accent-red flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {err}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────
// NoteRow — single SW note with delete (Jorge#1)
// Owner-or-admin delete is enforced server-side; the trash icon
// is rendered for every row and the API returns 403 otherwise.
// ─────────────────────────────────────────────────────
function NoteRow({ note, vehicleId, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const remove = async () => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    setBusy(true);
    setErr(null);
    try {
      await vehiclesApi.deleteNote(vehicleId, note.id);
      onDeleted && onDeleted();
    } catch (e) {
      setErr(e.detail || e.message || 'Failed');
      setBusy(false);
    }
  };
  return (
    <li className="rounded-md border border-navy-800 bg-navy-800/40 px-3 py-2 group">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-text-strong whitespace-pre-wrap flex-1">{note.body}</div>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-red p-1 -mr-1 transition-opacity disabled:opacity-40"
          title="Delete note (you can only delete your own)"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
        </button>
      </div>
      <div className="text-[10px] text-text-muted mt-1 flex items-center gap-2">
        <span>{note.authorName || 'system'}</span>
        <span>·</span>
        <span>{new Date(note.createdAt).toLocaleString()}</span>
      </div>
      {err && <div className="mt-1 text-[10px] text-accent-red">{err}</div>}
    </li>
  );
}

// ─────────────────────────────────────────────────────
// ACTIVE WORK section — non-terminal WOs grouped by RO
// ─────────────────────────────────────────────────────
function ActiveWorkSection({ rows, vehicleClass, onChanged, onOpenRo }) {
  return (
    <section className="rounded-lg border border-navy-700 bg-navy-900 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Active Work
        </span>
        <span className="text-xs text-text-muted">· {rows.length}</span>
      </div>
      {rows.length === 0 && (
        <p className="text-xs text-text-muted">No active work orders on this van.</p>
      )}
      <div className="space-y-3">
        {rows.map((r) => (
          <RoCard key={r.workOrderId} row={r} vehicleClass={vehicleClass} onChanged={onChanged} onOpenRo={onOpenRo} />
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────
// SERVICE HISTORY section — terminal WOs (completed/cancelled/declined)
// ─────────────────────────────────────────────────────
function ServiceHistorySection({ rows }) {
  // Jorge#9: completed/cancelled ROs are collapsed by default so the
  // van view stays focused on ACTIVE work. SW can expand to see history.
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="rounded-lg border border-navy-700 bg-navy-900 p-4 mb-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 mb-3 cursor-pointer text-left"
      >
        <Clock className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Service History
        </span>
        <span className="text-xs text-text-muted">· {rows.length}</span>
        <span className="ml-auto text-text-muted">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {expanded && (
        rows.length === 0 ? (
          <p className="text-xs text-text-muted">No completed or cancelled ROs yet.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => <RoCard key={r.workOrderId} row={r} terminal />)}
          </div>
        )
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────
// RO card (used in both Active Work and Service History)
// ─────────────────────────────────────────────────────
function RoCard({ row, terminal, vehicleClass, onChanged, onOpenRo }) {
  return (
    <div className={`rounded-md border-l-4 ${roBorder(row.woStatus)} bg-navy-800/30 px-3 py-2`}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-semibold text-accent-blue">
          {row.roNumber || row.workOrderIdStr}
        </span>
        <span className={`px-1.5 py-0.5 text-[10px] rounded ${statusPillClass(row.woStatus)} uppercase font-semibold`}>
          {prettyStatus(row.woStatus)}
        </span>
        {row.workshopName && (
          <span className="text-xs text-text-muted">· {row.workshopName}</span>
        )}
        {row.repairType && (
          <span className="text-xs text-text-muted">· {row.repairType}</span>
        )}
        <span className="text-xs text-text-muted">
          · Tech: {row.assignedTechnicianName || 'unassigned'}
        </span>
        {row.estimatedTotal != null && (
          <span className="ml-auto text-sm font-semibold text-text-strong">
            est ${Number(row.estimatedTotal).toLocaleString()}
          </span>
        )}
      </div>
      {row.defects && row.defects.length > 0 && (
        <div className="space-y-1 mt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Defects · {row.defects.length}
          </div>
          {row.defects.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm">
              <span className="text-text-strong">
                {d.part || '—'} {d.type ? `— ${d.type}` : ''}
              </span>
              {d.position && <span className="text-xs text-text-muted">({d.position})</span>}
              <span className="ml-auto flex items-center gap-1">
                {d.source && (
                  <span className="px-1.5 py-0.5 text-[9px] rounded bg-navy-700/60 text-text-muted uppercase font-mono">
                    {prettySource(d.source)}
                  </span>
                )}
                {d.reviewDecision && (
                  <span className={`px-1.5 py-0.5 text-[9px] rounded ${reviewPill(d.reviewDecision)} uppercase font-semibold`}>
                    {d.reviewDecision}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* Jorge#5: RO-specific actions live in the RoModal now.
          Van view just exposes a "Manage RO" button per active row. */}
      {!terminal && onOpenRo && (
        <div className="mt-3 pt-3 border-t border-navy-800 flex justify-end">
          <button
            type="button"
            onClick={() => onOpenRo(row.workOrderIdStr || row.workOrderId)}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center gap-1"
          >
            Manage RO →
          </button>
        </div>
      )}
    </div>
  );
}

function roBorder(status) {
  switch (status) {
    case 'pending_acceptance': return 'border-accent-gold';
    case 'accepted':           return 'border-accent-blue';
    case 'in_progress':        return 'border-accent-blue';
    case 'completed':          return 'border-accent-green';
    case 'declined':           return 'border-accent-red';
    case 'cancelled':          return 'border-navy-700';
    default:                   return 'border-navy-700';
  }
}

function statusPillClass(status) {
  switch (status) {
    case 'pending_acceptance': return 'bg-accent-gold/15 text-accent-gold';
    case 'accepted':           return 'bg-accent-blue/15 text-accent-blue';
    case 'in_progress':        return 'bg-accent-blue/15 text-accent-blue';
    case 'completed':          return 'bg-accent-green/15 text-accent-green';
    case 'declined':           return 'bg-accent-red/15 text-accent-red';
    case 'cancelled':          return 'bg-navy-800 text-text-muted';
    default:                   return 'bg-navy-800 text-text-muted';
  }
}

function reviewPill(decision) {
  switch (decision) {
    case 'approved': return 'bg-accent-green/15 text-accent-green';
    case 'rejected': return 'bg-accent-red/15 text-accent-red';
    default:         return 'bg-navy-800 text-text-muted';
  }
}

function prettyStatus(s) {
  return String(s || '').replace(/_/g, ' ');
}

function prettySource(s) {
  if (!s) return '';
  if (s === 'dvic_inspection') return 'driver report';
  if (s === 'dsp_request') return 'customer request';
  if (s === 'shop_finding') return 'shop finding';
  return s.replace(/_/g, ' ');
}

// ─────────────────────────────────────────────────────
// DEFECT TIMELINE — all defects on the vehicle, newest first
// ─────────────────────────────────────────────────────
function DefectTimelineSection({ timeline }) {
  return (
    <section className="rounded-lg border border-navy-700 bg-navy-900 p-4">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Defect Timeline
        </span>
        <span className="text-xs text-text-muted">· {timeline.length}</span>
      </div>
      {timeline.length === 0 && (
        <p className="text-xs text-text-muted">No defects recorded yet on this van.</p>
      )}
      {timeline.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-muted">
                <th className="text-left px-2 py-1 font-semibold">Reported</th>
                <th className="text-left px-2 py-1 font-semibold">Part / Type</th>
                <th className="text-left px-2 py-1 font-semibold">Position</th>
                <th className="text-left px-2 py-1 font-semibold">Source</th>
                <th className="text-left px-2 py-1 font-semibold">Decision</th>
                <th className="text-left px-2 py-1 font-semibold">Resolution</th>
                <th className="text-left px-2 py-1 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((d) => (
                <tr key={d.id} className="border-t border-navy-800 hover:bg-navy-800/30">
                  <td className="px-2 py-1.5 text-text-muted text-xs whitespace-nowrap">
                    {new Date(d.reportedAt).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })}
                  </td>
                  <td className="px-2 py-1.5 text-text-strong">
                    <div>{d.part || '—'}</div>
                    {d.type && <div className="text-xs text-text-muted">{d.type}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-text-muted text-xs">{d.position || '—'}</td>
                  <td className="px-2 py-1.5">
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-navy-700/60 text-text-muted uppercase">
                      {prettySource(d.source)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {d.reviewDecision ? (
                      <span className={`px-1.5 py-0.5 text-[10px] rounded ${reviewPill(d.reviewDecision)} uppercase font-semibold`}>
                        {d.reviewDecision}
                      </span>
                    ) : (
                      <span className="text-text-muted text-xs">pending</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-text-muted text-xs">
                    {d.resolutionStatus || '—'}
                  </td>
                  <td className="px-2 py-1.5 text-text-muted text-xs truncate max-w-[200px]">
                    {d.notes || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
