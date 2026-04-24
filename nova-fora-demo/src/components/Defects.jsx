import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { TodaysDefectsTable } from './RealDVIC';
import { CreateWorkOrderModal } from './FleetSnapshot';
import { defects as defectsApi, vehicles as vehiclesApi, APIError } from '../api/client';

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
    id: d.id,                              // FD-008 (defect's own id)
    // Display: show the fleet_id (e.g. "PR013") — what the driver sees on
    // the van. The internal "VAN-0001" is kept separately for lookups.
    van: d.fleetId || d.van || '—',
    vanInternalId: d.van,                  // "VAN-0001" — for vehicle lookup
    plate: d.plate || null,
    desc: d.description,
    category: d.category || d.section || '—',
    severity: SEVERITY_TO_LABEL[d.severity] || d.severity,
    status: STATUS_TO_LABEL[d.status] || d.status,
    da: d.reportedBy || '—',
    photo: (d.photoCount || 0) > 0,
    // Raw fields for any debug / advanced UI
    _rawStatus: d.status,
    _rawSeverity: d.severity,
    _fleetId: d.fleetId,
  };
}

// Transform API vehicle -> shape CreateWorkOrderModal expects
function fromApiVehicleForModal(v) {
  return {
    id: v.id,                  // VAN-0001
    fleetId: v.fleetId,        // PR013 (useful in display)
    dspId: v.dspId,
    dsp: v.dsp,
    model: `${v.year} ${v.make} ${v.model}`,
    plate: v.plate,
    vin: v.vin,
    year: v.year,
    make: v.make,
    mileage: v.mileage || 0,
    defectCount: v.defectCount ?? 0,
    severity: v.severity || 'clean',
    grounded: !!v.grounded,
  };
}

// ─────────────────────────────────────────────────────
export default function Defects({ user }) {
  const [rawDefects, setRawDefects] = useState([]);
  const [modalVans, setModalVans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [createWOContext, setCreateWOContext] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch both in parallel — the modal needs the full vehicle list.
      const [defectsRes, vehiclesRes] = await Promise.all([
        defectsApi.list({ perPage: 200 }),
        vehiclesApi.list({ perPage: 200 }),
      ]);
      setRawDefects(defectsRes.items);
      setModalVans(vehiclesRes.items.map(fromApiVehicleForModal));
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

  // Synthetic DA list so the existing `daList.find(x => x.id === d.da)` works.
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
    // Pre-fill the modal with the vehicle the defect belongs to — no search needed.
    const matchingVan = modalVans.find((v) => v.id === d.vanInternalId);
    setCreateWOContext({
      van: matchingVan || null,
      defect: {
        section: d.category || '',
        part: d.category || '',
        description: d.desc,
        severity: d.severity,
      },
      defectId: d.id,
    });
    // ACK the defect in the backend so the persistent status shows 'Repair Ordered'
    try {
      await defectsApi.updateStatus(d.id, 'acknowledged');
      // Reload so the row shows the new status when the modal closes
      reload();
    } catch (err) {
      console.warn('ACK failed, modal still open:', err);
    }
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
        <p className="text-navy-400 text-sm">
          All reported defects &mdash; filter by vendor, reject or convert to work orders
        </p>
      </div>

      <TodaysDefectsTable
        title="All Reported Defects"
        defects={displayDefects}
        daList={daList}
        scheduledCount={scheduledCount}
        rushOrderCount={rushOrderCount}
        onReject={handleReject}
        onCreateWO={handleCreateWO}
        onOpenCreateDefect={() => { /* hook when Create Defect flow is wired */ }}
      />

      <AnimatePresence>
        {createWOContext && (
          <CreateWorkOrderModal
            initialVan={createWOContext.van}
            initialDefect={createWOContext.defect}
            vans={modalVans}
            user={user}
            onClose={() => setCreateWOContext(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
