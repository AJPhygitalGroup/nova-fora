import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { TodaysDefectsTable } from './RealDVIC';
import { CreateWorkOrderModal } from './FleetSnapshot';
import { fleetSnapshotVans } from '../data/mockData';
import { defects as defectsApi, APIError } from '../api/client';

// ─────────────────────────────────────────────────────
// Transform API defect -> shape expected by TodaysDefectsTable
// ─────────────────────────────────────────────────────
const SEVERITY_TO_LABEL = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// Map API workflow status to the display label the existing component renders.
// The frontend's defectStatusColors keys are 'Rush Order' | 'Scheduled' | 'Repair Ordered' | 'Logged'.
const STATUS_TO_LABEL = {
  pending: 'Logged',
  acknowledged: 'Repair Ordered',
  sent_to_vendor: 'Scheduled',
  scheduled: 'Scheduled',
  converted_to_wo: 'Scheduled',
  dismissed: 'Rejected',
};

function fromApiDefect(d) {
  return {
    id: d.id,                           // FD-008
    van: d.van || d.fleetId || '',      // "VAN-0001" (UI shows as monospaced code)
    desc: d.description,
    category: d.category || d.section || '—',
    severity: SEVERITY_TO_LABEL[d.severity] || d.severity,
    status: STATUS_TO_LABEL[d.status] || d.status,
    // Inspector reference — we stash the name as both id and name so the
    // existing `daList.find(x => x.id === d.da)` lookup works without changes.
    da: d.reportedBy || '—',
    photo: (d.photoCount || 0) > 0,
    // Keep raw for actions
    _rawStatus: d.status,
    _rawSeverity: d.severity,
    _fleetId: d.fleetId,
  };
}

// ─────────────────────────────────────────────────────
export default function Defects({ user }) {
  const [rawDefects, setRawDefects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [createWOContext, setCreateWOContext] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Server-side role scoping: dsp_owner auto-scoped, vendor/admin see all.
      const res = await defectsApi.list({ perPage: 200 });
      setRawDefects(res.items);
    } catch (err) {
      setError(err instanceof APIError ? (err.detail || 'Load failed') : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Transform for display
  const displayDefects = useMemo(
    () => rawDefects.map(fromApiDefect),
    [rawDefects]
  );

  const scheduledCount = displayDefects.filter((d) => d.status === 'Scheduled').length;
  const rushOrderCount = displayDefects.filter((d) => d.status === 'Rush Order').length;

  // Synthetic DA list: the existing table looks up `daList.find(x => x.id === d.da)`.
  // We use the inspector name as its own id so the lookup succeeds with no code changes.
  const daList = useMemo(() => {
    const names = new Set(displayDefects.map((d) => d.da).filter(Boolean));
    return Array.from(names).map((name) => ({ id: name, name }));
  }, [displayDefects]);

  const handleReject = async (d) => {
    try {
      await defectsApi.updateStatus(d.id, 'dismissed');
      await reload();
    } catch (err) {
      alert(`Reject failed: ${err?.detail || err?.message || 'unknown'}`);
    }
  };

  const handleCreateWO = async (d) => {
    // Real Work Order API comes in Semana 4. For now we open the existing
    // modal (local state only) AND mark the defect as acknowledged in the API
    // so the workflow reflects that action has been taken.
    try {
      await defectsApi.updateStatus(d.id, 'acknowledged');
    } catch (err) {
      // Non-fatal — still show the modal so user sees progress.
      console.warn('ACK failed, continuing to modal:', err);
    }
    const fleetVan = fleetSnapshotVans.find((fv) => fv.id === d.van);
    setCreateWOContext({
      van: fleetVan || null,
      defect: {
        section: d.category || '',
        part: d.category || '',
        description: d.desc,
        severity: d.severity,
      },
    });
    // Reload in background so the status shows as 'Repair Ordered' after modal closes
    reload();
  };

  // ── Loading ────────────────────────────────────────
  if (loading && rawDefects.length === 0) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 text-navy-400">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-accent-blue/40 border-t-accent-blue rounded-full"
        />
        <div className="text-sm">Loading defects…</div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────
  if (error && rawDefects.length === 0) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertTriangle size={32} className="text-accent-red" />
        <div className="text-white font-semibold">Could not load defects</div>
        <div className="text-sm text-navy-400 max-w-md">{error}</div>
        <button
          onClick={reload}
          className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue/20 border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/30 text-sm cursor-pointer"
        >
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">Defects</h2>
        <p className="text-navy-400 text-sm">All reported defects &mdash; filter by vendor, reject or convert to work orders</p>
      </div>

      <TodaysDefectsTable
        title="All Reported Defects"
        defects={displayDefects}
        daList={daList}
        scheduledCount={scheduledCount}
        rushOrderCount={rushOrderCount}
        onReject={handleReject}
        onCreateWO={handleCreateWO}
        onOpenCreateDefect={() => { /* hook to existing Create Defect flow if desired */ }}
      />

      <AnimatePresence>
        {createWOContext && (
          <CreateWorkOrderModal
            initialVan={createWOContext.van}
            initialDefect={createWOContext.defect}
            vans={fleetSnapshotVans}
            user={user}
            onClose={() => setCreateWOContext(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
