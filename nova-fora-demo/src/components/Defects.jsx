import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw, X, Camera } from 'lucide-react';
import { TodaysDefectsTable } from './RealDVIC';
import { CreateWorkOrderModal } from './FleetSnapshot';
import PhotoUploader from './ui/PhotoUploader';
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
    photoCount: d.photoCount || 0,
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
  // Photos modal state: { defect, initialPhotos }
  const [photosModal, setPhotosModal] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch both in parallel — the modal needs the full vehicle list.
      // Keep per_page <= 100 (API cap for /vehicles; /defects allows 200
      // but we use the same value for consistency).
      const [defectsRes, vehiclesRes] = await Promise.all([
        defectsApi.list({ perPage: 100 }),
        vehiclesApi.list({ perPage: 100 }),
      ]);
      setRawDefects(defectsRes.items);
      setModalVans(vehiclesRes.items.map(fromApiVehicleForModal));
    } catch (err) {
      // err.detail may be a string (our 401/403/404 responses) OR an array
      // (FastAPI validation errors: [{loc, msg, type}, ...]). Normalize to string.
      const msg = err instanceof APIError
        ? (typeof err.detail === 'string' ? err.detail : (err.message || 'Load failed'))
        : 'Network error';
      setError(msg);
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

  const handleViewPhotos = async (d) => {
    // Open modal + fetch existing photos on demand
    try {
      const res = await defectsApi.listPhotos(d.id);
      setPhotosModal({ defect: d, initialPhotos: res.items });
    } catch (err) {
      alert(`Load photos failed: ${err?.detail || err?.message || 'unknown'}`);
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
        onViewPhotos={handleViewPhotos}
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

      <AnimatePresence>
        {photosModal && (
          <PhotosDialog
            defect={photosModal.defect}
            initialPhotos={photosModal.initialPhotos}
            onClose={() => {
              setPhotosModal(null);
              reload();  // refresh photo_count in the table
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Photos dialog — centered modal (not full-screen like CreateWO)
// so the user can still see the underlying defects table faded behind.
// ─────────────────────────────────────────────────────
function PhotosDialog({ defect, initialPhotos, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-navy-950/70 backdrop-blur-sm z-[55] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-3xl bg-navy-900 border border-navy-700/60 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-navy-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <Camera size={14} className="text-accent-blue" />
              <h3 className="text-base font-semibold text-white">Photos</h3>
              <span className="text-xs text-navy-400 font-mono">
                {defect.id} · {defect.van}
              </span>
            </div>
            <p className="text-xs text-navy-400 truncate">{defect.desc}</p>
          </div>
          <button
            onClick={onClose}
            className="text-navy-400 hover:text-white p-1 -mr-1 rounded-md hover:bg-navy-800 shrink-0"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 max-h-[70vh] overflow-y-auto">
          <PhotoUploader
            parentKind="defect"
            parentId={defect.id}
            initialPhotos={initialPhotos}
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-navy-800 bg-navy-950/40 flex items-center justify-between text-[11px] text-navy-400">
          <span>
            Photos upload directly to encrypted storage &mdash; bypass our API for speed.
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-accent-blue text-white text-xs font-semibold hover:opacity-90 cursor-pointer"
          >
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
