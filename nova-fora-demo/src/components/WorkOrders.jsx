import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList, Search, Filter, X, Check, CheckCircle2, AlertTriangle, Clock,
  User, Wrench, Camera, FileText, Send, XCircle, PlayCircle, PauseCircle,
  ChevronDown, ChevronUp, MoreVertical, Plus, ArrowRight, Flame, RefreshCw, Hourglass,
  Truck, Building2, MessageSquare, CircleDashed, Briefcase, PackageCheck, Loader2
} from 'lucide-react';
import { WO_DECLINE_REASONS } from '../data/mockData';
import {
  workOrders as woApi,
  directory as dirApi,
  vehicles as vehiclesApi,
  vendorWorkshops as workshopsApi,
} from '../api/client';
import { adaptWO } from '../api/woAdapter';
import Badge from './ui/Badge';

// ============================================================
// Status config
// ============================================================
const STATUS_CONFIG = {
  pending:      { label: 'Pending',      variant: 'gold',   icon: Hourglass,    color: 'text-accent-gold',   bg: 'bg-accent-gold/10',   border: 'border-accent-gold/40' },
  pending_fmc:  { label: 'Pending FMC',  variant: 'purple', icon: Briefcase,    color: 'text-accent-purple', bg: 'bg-accent-purple/10', border: 'border-accent-purple/40' },
  // V2.0: WO has been accepted by the vendor (was 'acknowledged' in V1).
  acknowledged: { label: 'Accepted',     variant: 'blue',   icon: Check,        color: 'text-accent-blue',   bg: 'bg-accent-blue/10',   border: 'border-accent-blue/40' },
  in_progress:  { label: 'In Progress',  variant: 'blue',   icon: PlayCircle,   color: 'text-accent-blue',   bg: 'bg-accent-blue/10',   border: 'border-accent-blue/40' },
  completed:    { label: 'Completed',    variant: 'green',  icon: CheckCircle2, color: 'text-accent-green',  bg: 'bg-accent-green/10',  border: 'border-accent-green/40' },
  declined:     { label: 'Declined',     variant: 'red',    icon: XCircle,      color: 'text-accent-red',    bg: 'bg-accent-red/10',    border: 'border-accent-red/40' },
  canceled:     { label: 'Canceled',     variant: 'gray',   icon: CircleDashed, color: 'text-navy-400',      bg: 'bg-navy-800',         border: 'border-navy-700' },
};

// Fallback for any status not in STATUS_CONFIG — prevents WorkOrderCard from
// crashing with `Cannot read properties of undefined (reading 'icon')` when
// the V2.0 backend introduces a new status the UI hasn't been updated for.
const STATUS_CONFIG_FALLBACK = {
  label: 'Unknown', variant: 'gray', icon: CircleDashed,
  color: 'text-navy-400', bg: 'bg-navy-800', border: 'border-navy-700',
};

const FLAG_CONFIG = {
  rush_order:     { label: 'Rush Order',     variant: 'red',    icon: Flame },
  stale:          { label: 'Stale',          variant: 'gold',   icon: Clock },
  subcontracted:  { label: 'Subcontracted',  variant: 'purple', icon: RefreshCw },
};


// ============================================================
// API → UI shape adapter
// The original UI was built around a flat shape with section/part/severity at
// the WO level. The new API has those per-item (since 1 WO can bundle N defects).
// We surface the *first item* fields up to the WO level for the existing UI to
// render unchanged, plus pass through the items array for richer views.
// ============================================================
// ─────────────────────────────────────────────────────
// V2.0 → UI adapter wrappers.
//
// The heavy lifting lives in src/api/woAdapter.js — see there for the
// V2.0 → V1-shape mapping rationale. These wrappers are the tiny layer
// that injects this component's cached vehicle / workshop / users lookups.
// ─────────────────────────────────────────────────────
function buildCtx(vehiclesById, workshopsById, usersById) {
  return { vehiclesById, workshopsById, usersById };
}

function mapApiToUi(api, ctx) {
  return adaptWO(api, ctx);
}

function mapApiListToUi(apiList, ctx) {
  return (apiList || []).map((api) => adaptWO(api, ctx));
}

// ============================================================
// Accept / Assign Technician Modal (dispatcher action)
// ============================================================
function AssignTechnicianModal({ wo, onAssign, onClose }) {
  const { t } = useTranslation('dashboard');
  const [tech, setTech] = useState(null);
  const [techOpen, setTechOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [techs, setTechs] = useState([]);
  const [techsLoading, setTechsLoading] = useState(true);

  // External-mode workshops require at least one RO# before the WO can be
  // accepted (DB trigger enforces). Surface the input here so the operator
  // doesn't hit a silent 409. Internal-mode skips this entirely.
  const externalMode = wo._v2?.statusTrackingMode === 'external' || wo.statusTrackingMode === 'external';
  const hasExistingRo = (wo._v2?.ros?.length || wo.ros?.length || 0) > 0;
  const roRequired = externalMode && !hasExistingRo;
  const [roNumber, setRoNumber] = useState('');

  // Fetch real technicians of the WO's vendor
  useEffect(() => {
    let alive = true;
    setTechsLoading(true);
    dirApi
      .users({ role: 'technician', organizationId: wo.vendorId })
      .then((rows) => {
        if (!alive) return;
        // Shape: { id, name, role, ... } from backend
        setTechs(
          rows.map((u) => ({
            id: u.id,
            name: u.name,
            specialties: ['General'], // backend doesn't store specialties yet
            activeWOs: 0,
          }))
        );
      })
      .catch((err) => {
        console.error('failed to load technicians', err);
        if (alive) setTechs([]);
      })
      .finally(() => alive && setTechsLoading(false));
    return () => {
      alive = false;
    };
  }, [wo.vendorId]);

  const handleAssign = async () => {
    if (!tech) return;
    if (roRequired && !roNumber.trim()) return;
    setSubmitting(true);
    try {
      await onAssign({ technician: tech, notes, roNumber: roNumber.trim() || null });
      onClose();
    } catch (e) {
      console.error('assign failed', e);
      setSubmitting(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 280 }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-blue/15 flex items-center justify-center">
              <PlayCircle size={16} className="text-accent-blue" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{t('workOrders.assignModal.title', 'Accept & Assign')}</h3>
              <p className="text-[11px] text-navy-400">{wo.id} · {wo.plate}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div className="rounded-lg bg-navy-800/40 border border-navy-700/40 p-3">
            <div className="text-[10px] text-navy-400 uppercase tracking-wide mb-1">{t('workOrders.assignModal.workToComplete', 'Work to complete')}</div>
            <div className="text-sm text-white mb-1">{wo.description}</div>
            <div className="text-[11px] text-navy-400">{wo.section} · {wo.part}</div>
          </div>

          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.assignModal.assignTo', 'Assign to technician')}</label>
            <div className="relative">
              <button onClick={() => setTechOpen(!techOpen)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-navy-700 bg-navy-800/50 text-left hover:border-navy-600 cursor-pointer min-h-[52px]">
                {tech ? (
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate">{tech.name}</div>
                    <div className="text-[11px] text-navy-400 truncate">{(tech.specialties || []).join(', ') || t('workOrders.assignModal.techRoleFallback', 'Technician')}{tech.activeWOs ? t('workOrders.assignModal.techActiveSuffixFmt', { count: tech.activeWOs, defaultValue: ` · ${tech.activeWOs} active WOs` }) : ''}</div>
                  </div>
                ) : (
                  <span className="text-sm text-navy-400">{t('workOrders.assignModal.selectTechnician', 'Select a technician…')}</span>
                )}
                <ChevronDown size={16} className={`text-navy-400 shrink-0 ml-2 transition-transform ${techOpen ? 'rotate-180' : ''}`} />
              </button>
              {techOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setTechOpen(false)} />
                  <div className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-20">
                    {techsLoading ? (
                      <div className="px-4 py-6 text-center text-xs text-navy-400">
                        <Loader2 size={14} className="inline mr-1.5 animate-spin" />
                        {t('workOrders.assignModal.loadingTechs', 'Loading technicians…')}
                      </div>
                    ) : techs.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-navy-400">{t('workOrders.assignModal.noTechs', 'No technicians available for this vendor.')}</div>
                    ) : techs.map((techItem) => (
                      <button key={techItem.id} onClick={() => { setTech(techItem); setTechOpen(false); }}
                        className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-navy-800 transition-colors border-b border-navy-800/60 last:border-b-0 min-h-[56px] ${
                          tech?.id === techItem.id ? 'bg-navy-800' : ''
                        }`}>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{techItem.name}</div>
                          <div className="text-[11px] text-navy-400 truncate">{techItem.specialties.join(', ')}</div>
                        </div>
                        <Badge variant={techItem.activeWOs > 4 ? 'orange' : 'gray'}>{t('workOrders.assignModal.techActiveBadgeFmt', { count: techItem.activeWOs, defaultValue: `${techItem.activeWOs} active` })}</Badge>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {externalMode && (
            <div>
              <label className="text-xs font-semibold text-navy-300 mb-1.5 block">
                {t('workOrders.assignModal.roNumberLabel', 'RO Number')} {roRequired && <span className="text-accent-red">*</span>}
              </label>
              <input
                type="text"
                value={roNumber}
                onChange={(e) => setRoNumber(e.target.value)}
                placeholder={t('workOrders.assignModal.roNumberPlaceholder', 'e.g. RO-2026-8142')}
                className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
              />
              <p className="text-[10px] text-navy-500 mt-1">
                {hasExistingRo
                  ? t('workOrders.assignModal.roNumberHintExisting',
                      'External-mode WO. An RO is already attached; add another only if your POS split this visit.')
                  : t('workOrders.assignModal.roNumberHintRequired',
                      'External-mode workshop — RO# from your POS (Midas/Auto Integrate/etc.) is required to accept.')}
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.assignModal.dispatcherNotes', 'Dispatcher notes (optional)')}</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder={t('workOrders.assignModal.dispatcherNotesPlaceholder', "e.g. 'Parts already ordered — arriving 2pm'")}
              className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">{t('workOrders.assignModal.cancel', 'Cancel')}</button>
          <button onClick={handleAssign} disabled={!tech || submitting || (roRequired && !roNumber.trim())}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-blue to-accent-purple text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {submitting ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> {t('workOrders.assignModal.assigning', 'Assigning…')}</>) : (<><Check size={14} /> {t('workOrders.assignModal.acceptAndAssign', 'Accept & Assign')}</>)}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Decline Modal (with reason code)
// ============================================================
function DeclineModal({ wo, onDecline, onClose }) {
  const { t } = useTranslation('dashboard');
  const [reason, setReason] = useState(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      onDecline({ reason: reason.label, notes });
      onClose();
    }, 600);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-red/15 border border-accent-red/40 flex items-center justify-center">
              <XCircle size={16} className="text-accent-red" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{t('workOrders.declineModal.title', 'Decline Work Order')}</h3>
              <p className="text-[11px] text-navy-400">{t('workOrders.declineModal.subtitleFmt', { id: wo.id, defaultValue: `${wo.id} · Requires reason code` })}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.declineModal.reasonLabel', 'Reason code *')}</label>
            <div className="space-y-2">
              {WO_DECLINE_REASONS.map((r) => (
                <button key={r.code} onClick={() => setReason(r)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all cursor-pointer ${
                    reason?.code === r.code
                      ? 'border-accent-red/50 bg-accent-red/10'
                      : 'border-navy-700 bg-navy-800/40 hover:border-navy-600'
                  }`}>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    reason?.code === r.code ? 'border-accent-red bg-accent-red text-white' : 'border-navy-600'
                  }`}>
                    {reason?.code === r.code && <Check size={12} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-navy-400 uppercase tracking-wide">{t('workOrders.declineModal.codePrefixFmt', { code: r.code, defaultValue: `Code ${r.code}` })}</div>
                    <div className="text-sm text-white">{t(`workOrders.declineModal.reasonOption.${r.code}`, r.label)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.declineModal.notesLabel', 'Additional notes (optional)')}</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-red resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">{t('workOrders.declineModal.cancel', 'Cancel')}</button>
          <button onClick={handleSubmit} disabled={!reason || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-red text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {submitting ? t('workOrders.declineModal.declining', 'Declining…') : <>{t('workOrders.declineModal.decline', 'Decline')} <XCircle size={14} /></>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Complete Work Modal (technician action)
// ============================================================
function CompleteWorkModal({ wo, onComplete, onClose }) {
  const { t } = useTranslation('dashboard');
  const [comments, setComments] = useState('');
  // Floor: prefer the explicit inspection_mileage_floor surfaced by the
  // backend (computed from WO → RR → defects → Inspection.odometer_miles).
  // Falls back to any earlier mid-visit reading the WO already carries.
  // Backend re-validates and returns 422 if the submitted mileage drops
  // below this floor — the local check is just a friendlier pre-flight.
  const floorMileage =
    wo._v2?.inspectionMileageFloor
    ?? wo.inspectionMileageFloor
    ?? wo._v2?.lastMileage
    ?? wo.lastMileage
    ?? null;
  const [mileage, setMileage] = useState('');
  const [odometerFile, setOdometerFile] = useState(null);
  const [odometerPath, setOdometerPath] = useState(null);
  const [workFile, setWorkFile] = useState(null);
  const [workPath, setWorkPath] = useState(null);
  const [uploadingOdo, setUploadingOdo] = useState(false);
  const [uploadingWork, setUploadingWork] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mileageError, setMileageError] = useState(null);

  const mileageNum = mileage ? Number(mileage) : null;
  // Local pre-check so the inspector doesn't have to round-trip just to
  // catch the obvious case. Backend re-checks against the (possibly
  // higher) inspection.odometer_miles independently.
  const mileageBelowFloor =
    mileageNum != null
    && floorMileage != null
    && mileageNum < Number(floorMileage);

  const canSubmit =
    comments.length > 4
    && mileageNum != null
    && String(mileage).length >= 3
    && !mileageBelowFloor
    && odometerPath
    && workPath
    && !uploadingOdo
    && !uploadingWork;

  // Lazy import the uploads helper so the modal stays cheap when not open
  // (avoids pulling the compressor + presigned client on the WO list page).
  const handleFilePicked = async (file, kind) => {
    const setBusy = kind === 'odo' ? setUploadingOdo : setUploadingWork;
    const setFile = kind === 'odo' ? setOdometerFile : setWorkFile;
    const setPath = kind === 'odo' ? setOdometerPath : setWorkPath;
    setFile({ name: file.name, size: file.size });
    setBusy(true);
    try {
      const { uploads } = await import('../api/client');
      const { uploadUrl, storageKey } = await uploads.presigned({
        kind: 'work_order',
        parentId: wo._v2?.id ?? wo.id,
        filename: file.name || 'photo.jpg',
        contentType: file.type || 'image/jpeg',
      });
      await uploads.putToPresigned(uploadUrl, file, file.type || 'image/jpeg');
      setPath(storageKey);
    } catch (err) {
      console.error(`upload ${kind} failed`, err);
      alert(`Upload failed: ${err?.detail || err?.message || 'unknown'}`);
      setFile(null);
      setPath(null);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    setMileageError(null);
    setSubmitting(true);
    try {
      await onComplete({
        comments,
        mileage: mileageNum,
        odometerPhotoPath: odometerPath,
        workPhotoPath: workPath,
      });
      onClose();
    } catch (err) {
      // onComplete throws nothing today (parent swallows + alerts), but be
      // defensive in case that changes later. Surface 422 mileage errors
      // inline so the user can fix without closing the modal.
      const msg = err?.detail || err?.message || '';
      if (/mileage/i.test(msg)) setMileageError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const PhotoTile = ({ file, busy, onPick, captureLabel, hint }) => (
    <label className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed border-navy-700/60 bg-navy-800/20 active:bg-navy-800/60 hover:bg-navy-800/40 cursor-pointer transition-colors min-h-[64px]">
      <div className="w-10 h-10 rounded-lg bg-accent-blue/15 flex items-center justify-center shrink-0">
        <Camera size={16} className="text-accent-blue" />
      </div>
      <div className="flex-1 text-xs min-w-0">
        {file ? (
          <>
            <div className="text-white font-semibold truncate flex items-center gap-1.5">
              {busy && <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3 h-3 border-2 border-accent-blue/40 border-t-accent-blue rounded-full" />}
              {file.name}
            </div>
            <div className="text-navy-400">{(file.size / 1024).toFixed(0)} KB · {busy ? t('workOrders.completeModal.uploading', 'uploading…') : t('workOrders.completeModal.uploaded', '✓ uploaded')}</div>
          </>
        ) : (
          <>
            <div className="text-white">{captureLabel}</div>
            <div className="text-navy-400">{hint}</div>
          </>
        )}
      </div>
      <input
        type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      />
    </label>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800 bg-gradient-to-r from-accent-green/10 to-navy-900">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-green/15 border border-accent-green/40 flex items-center justify-center">
              <CheckCircle2 size={16} className="text-accent-green" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{t('workOrders.completeModal.title', 'Complete Work')}</h3>
              <p className="text-[11px] text-navy-400">{wo.id} · {wo.plate}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.completeModal.commentsLabel', 'Work completed comments *')}</label>
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3}
              placeholder={t('workOrders.completeModal.commentsPlaceholder', 'e.g. Replaced both brake pads and rotors on front axle. Test-driven OK.')}
              className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green resize-none" />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.completeModal.mileageLabel', 'Last mileage *')}</label>
            <input
              type="number" inputMode="numeric" value={mileage}
              onChange={(e) => { setMileage(e.target.value); setMileageError(null); }}
              min={floorMileage ?? 0}
              placeholder={floorMileage ? `≥ ${Number(floorMileage).toLocaleString()}` : t('workOrders.completeModal.mileagePlaceholder', 'e.g. 48290')}
              className={`w-full rounded-lg px-3 py-3 text-base bg-navy-800 border text-white placeholder-navy-500 outline-none ${
                mileageBelowFloor || mileageError ? 'border-accent-red focus:border-accent-red' : 'border-navy-700 focus:border-accent-green'
              }`}
            />
            <p className="text-[10px] text-navy-500 mt-1">
              {floorMileage != null
                ? t('workOrders.completeModal.floorMileageFmt', {
                    mileage: Number(floorMileage).toLocaleString(),
                    defaultValue: `Must be ≥ ${Number(floorMileage).toLocaleString()} mi (inspection reading).`,
                  })
                : t('workOrders.completeModal.previousMileageFmt', {
                    mileage: '—',
                    defaultValue: 'No prior reading on file — enter the current odometer.',
                  })}
            </p>
            {mileageBelowFloor && (
              <p className="text-[11px] text-accent-red mt-1">
                {t('workOrders.completeModal.mileageBelowFloor',
                  'Mileage cannot be lower than the previous reading.')}
              </p>
            )}
            {mileageError && (
              <p className="text-[11px] text-accent-red mt-1">{mileageError}</p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">
              {t('workOrders.completeModal.odometerPhotoLabel', 'Odometer photo')} <span className="text-accent-red">*</span>
            </label>
            <PhotoTile
              file={odometerFile} busy={uploadingOdo}
              onPick={(f) => handleFilePicked(f, 'odo')}
              captureLabel={t('workOrders.completeModal.captureOdometer', 'Capture odometer photo')}
              hint={t('workOrders.completeModal.requiredForAudit', 'Required for audit')}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">
              {t('workOrders.completeModal.workPhotoLabel', 'Completed work photo')} <span className="text-accent-red">*</span>
            </label>
            <PhotoTile
              file={workFile} busy={uploadingWork}
              onPick={(f) => handleFilePicked(f, 'work')}
              captureLabel={t('workOrders.completeModal.captureWork', 'Capture finished work')}
              hint={t('workOrders.completeModal.workHint', 'Show the repaired part or final state')}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">{t('workOrders.completeModal.cancel', 'Cancel')}</button>
          <button onClick={handleSubmit} disabled={!canSubmit || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {submitting ? t('workOrders.completeModal.completing', 'Completing…') : <>{t('workOrders.completeModal.complete', 'Complete')} <Check size={14} /></>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Release Modal (technician returns WO to dispatcher)
// ============================================================
function ReleaseModal({ wo, onRelease, onClose }) {
  const { t } = useTranslation('dashboard');
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
        className="bg-navy-900 border border-accent-orange/40 rounded-xl p-5 max-w-sm w-full text-center"
        onClick={(e) => e.stopPropagation()}>
        <div className="w-12 h-12 rounded-full bg-accent-orange/15 border border-accent-orange/40 flex items-center justify-center mx-auto mb-3">
          <PauseCircle size={22} className="text-accent-orange" />
        </div>
        <h4 className="text-base font-semibold text-white mb-1">{t('workOrders.releaseModal.title', 'Release Work Order?')}</h4>
        <p className="text-xs text-navy-400 mb-4">
          {t('workOrders.releaseModal.bodyFmt', { id: wo.id, defaultValue: `${wo.id} will be returned to the dispatcher who can re-assign it or decline with a reason code.` })}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-navy-600 text-navy-300 text-sm hover:bg-navy-800 cursor-pointer">{t('workOrders.releaseModal.cancel', 'Cancel')}</button>
          <button onClick={() => { onRelease(); onClose(); }}
            className="flex-1 px-4 py-2.5 rounded-lg bg-accent-orange text-white text-sm font-semibold hover:opacity-90 cursor-pointer">{t('workOrders.releaseModal.release', 'Release')}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Notes Modal (free-text notes via kebab)
// ============================================================
function NotesModal({ wo, onAddNote, onClose }) {
  const { t } = useTranslation('dashboard');
  const [note, setNote] = useState('');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-blue/15 flex items-center justify-center">
              <MessageSquare size={16} className="text-accent-blue" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{t('workOrders.notesModal.title', 'Work Order Notes')}</h3>
              <p className="text-[11px] text-navy-400">{wo.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-3 overflow-y-auto flex-1">
          {wo.notes && wo.notes.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-navy-400">{t('workOrders.notesModal.previousNotes', 'Previous notes')}</div>
              {wo.notes.map((n, i) => (
                <div key={i} className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2 text-xs text-white">{n}</div>
              ))}
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.notesModal.addNote', 'Add note')}</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
              placeholder={t('workOrders.notesModal.placeholder', 'Enter notes…')}
              className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue resize-none" autoFocus />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">{t('workOrders.notesModal.close', 'Close')}</button>
          <button onClick={() => { onAddNote(note); onClose(); }} disabled={!note.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-blue text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            <Check size={14} /> {t('workOrders.notesModal.save', 'Save')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Log a Job Modal (floating toolbox — technician misc jobs)
// ============================================================
function LogJobModal({ onClose, onSubmit }) {
  const { t } = useTranslation('dashboard');
  const [form, setForm] = useState({ dsp: '', vehicle: '', description: '', hours: 1 });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [jobId, setJobId] = useState('');

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      const id = `JOB-${Math.floor(10000 + Math.random() * 90000)}`;
      setJobId(id);
      onSubmit({ ...form, id });
      setSubmitting(false);
      setSuccess(true);
    }, 900);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-purple/15 flex items-center justify-center">
              <PackageCheck size={16} className="text-accent-purple" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{t('workOrders.logJobModal.title', 'Log a Job')}</h3>
              <p className="text-[11px] text-navy-400">{t('workOrders.logJobModal.subtitle', 'Record miscellaneous work not tied to a WO')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {success ? (
            <div className="text-center py-6">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}
                className="w-14 h-14 mx-auto rounded-full bg-accent-green/15 border border-accent-green/40 flex items-center justify-center mb-3">
                <CheckCircle2 size={26} className="text-accent-green" />
              </motion.div>
              <h4 className="text-base font-semibold text-white mb-1">{t('workOrders.logJobModal.successTitle', 'Job logged')}</h4>
              <div className="inline-flex flex-col gap-1 px-4 py-2.5 rounded-lg bg-navy-800/60 border border-navy-700/40 text-left mt-2">
                <div className="text-[11px] text-navy-400">{t('workOrders.logJobModal.jobIdLabel', 'Job ID')}</div>
                <div className="text-sm font-mono text-accent-purple">{jobId}</div>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-accent-purple/10 border border-accent-purple/30 p-3 text-xs text-navy-200">
                {t('workOrders.logJobModal.intro', "Use this form to record jobs completed throughout the day that weren't tied to a Work Order (e.g., quick DA-requested check, spot reinforcement).")}
              </div>
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.logJobModal.dspLabel', 'DSP *')}</label>
                <input value={form.dsp} onChange={(e) => setForm({ ...form, dsp: e.target.value })}
                  placeholder={t('workOrders.logJobModal.dspPlaceholder', 'Safety First LLC')}
                  className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-purple" />
              </div>
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.logJobModal.vehicleLabel', 'Vehicle *')}</label>
                <input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })}
                  placeholder={t('workOrders.logJobModal.vehiclePlaceholder', 'VAN-1042')}
                  className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-purple" />
              </div>
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.logJobModal.descriptionLabel', 'Description *')}</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3}
                  placeholder={t('workOrders.logJobModal.descriptionPlaceholder', 'e.g. Tire pressure check + air fill on all 4 tires')}
                  className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-purple resize-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('workOrders.logJobModal.hoursLabel', 'Time spent (hours)')}</label>
                <input type="number" step="0.25" value={form.hours} onChange={(e) => setForm({ ...form, hours: parseFloat(e.target.value) })}
                  className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-purple" />
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          {success ? (
            <>
              <span />
              <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 cursor-pointer">{t('workOrders.logJobModal.done', 'Done')}</button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">{t('workOrders.logJobModal.cancel', 'Cancel')}</button>
              <button onClick={handleSubmit} disabled={!form.dsp || !form.vehicle || !form.description || submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-purple text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                {submitting ? t('workOrders.logJobModal.logging', 'Logging…') : <>{t('workOrders.logJobModal.logJob', 'Log Job')} <Check size={14} /></>}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Work Order Card
// ============================================================
function WorkOrderCard({ wo, expanded, onToggle, userRole, currentUserId, onAction }) {
  const { t } = useTranslation('dashboard');
  const statusConf = STATUS_CONFIG[wo.status] || STATUS_CONFIG_FALLBACK;
  const StatusIcon = statusConf.icon;

  const isDispatcher = userRole === 'vendor_admin' || userRole === 'site_admin';
  const isTechnician = userRole === 'technician';
  // V2.0: match by numeric tech id (the old hardcoded "David Torres"
  // string was a V1 demo-data leftover that never matched real users).
  const woTechId = wo._v2?.assignedTechnicianId ?? wo.assignedTechnicianId;
  const isMyWO = isTechnician
    && currentUserId != null
    && woTechId != null
    && Number(woTechId) === Number(currentUserId);

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className={`bg-navy-900/60 border rounded-xl overflow-hidden transition-all ${
        expanded ? 'border-accent-blue/40' : 'border-navy-700/40 hover:border-navy-600/60'
      }`}>

      {/* Header (always visible) */}
      <button onClick={onToggle} className="w-full text-left px-4 py-3 hover:bg-navy-800/30 transition-colors">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-sm font-mono font-semibold text-accent-blue">{wo.id}</span>
              <Badge variant={statusConf.variant} size="md">
                <StatusIcon size={10} className="inline mr-0.5" /> {t(`workOrders.statusBadge.${wo.status}`, statusConf.label)}
              </Badge>
              {wo.flags?.map((f) => {
                const fConf = FLAG_CONFIG[f];
                if (!fConf) return null;
                const FIcon = fConf.icon;
                return (
                  <Badge key={f} variant={fConf.variant}>
                    <FIcon size={9} className="inline mr-0.5" /> {t(`workOrders.flagBadge.${f}`, fConf.label)}
                  </Badge>
                );
              })}
            </div>
            <div className="text-sm text-white font-medium">
              <span className="text-navy-300">{wo.dspName}</span> &nbsp;·&nbsp; {wo.vehicleId} &nbsp;·&nbsp; <span className="text-navy-400 font-mono">{wo.plate}</span>
            </div>
            <div className="text-xs text-navy-400 mt-0.5 truncate">{wo.section} &nbsp;·&nbsp; <span className="text-white">{wo.part}</span></div>
          </div>
          <ChevronDown size={16} className={`text-navy-400 shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
        <div className="flex items-center justify-between text-xs text-navy-400">
          <div className="flex items-center gap-2 flex-wrap">
            {wo.assignedTechnician && (
              <span className="flex items-center gap-1 text-navy-300">
                <User size={10} /> {wo.assignedTechnician}{isMyWO ? ` ${t('workOrders.youSuffix', '(you)')}` : ''}
              </span>
            )}
            {wo.scheduledAt && (
              <span className="flex items-center gap-1 text-accent-blue">
                <Clock size={10} /> {wo.scheduledAt}
              </span>
            )}
          </div>
          <span className="shrink-0">{new Date(wo.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
      </button>

      {/* Expanded body */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden border-t border-navy-800">
            <div className="px-4 py-4 space-y-4">
              {/* Description */}
              <div className="rounded-lg bg-navy-800/40 border border-navy-700/40 p-3">
                <div className="text-[10px] text-navy-400 uppercase tracking-wide mb-1">{t('workOrders.card.defectDescription', 'Defect description')}</div>
                <div className="text-sm text-white">{wo.description}</div>
              </div>

              {/* Defects + photos — populated by the V2.0 detail endpoint
                  (WO → RR → repair_request_defects → defect). Renders only
                  when there's at least one defect on the response; legacy
                  WOs without the new payload fall through cleanly. */}
              {Array.isArray(wo.defects) && wo.defects.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] text-navy-400 uppercase tracking-wide flex items-center gap-1.5">
                    <AlertTriangle size={10} className="text-accent-orange" />
                    {t('workOrders.card.defectsCountFmt', { count: wo.defects.length, defaultValue: `Reported defects (${wo.defects.length})` })}
                  </div>
                  {wo.defects.map((d) => (
                    <div key={d.id} className="rounded-lg bg-navy-800/40 border border-navy-700/40 p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">
                          {d.part}{d.position ? ` (${d.position})` : ''}
                        </span>
                        <span className="text-xs text-navy-400">·</span>
                        <span className="text-xs text-navy-200">
                          {(d.defectType || '').replace(/_/g, ' ')}
                        </span>
                        <span className="ml-auto text-[10px] font-mono text-navy-500">{d.id}</span>
                      </div>
                      <div className="text-[11px] text-navy-400">
                        {d.reportedBy
                          ? t('workOrders.card.defectReportedFmt', {
                              who: d.reportedBy,
                              when: new Date(d.reportedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                              defaultValue: `Reported by ${d.reportedBy} · ${new Date(d.reportedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
                            })
                          : new Date(d.reportedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {d.notes && (
                        <div className="text-[11px] text-navy-300 italic">"{d.notes}"</div>
                      )}
                      {Array.isArray(d.photos) && d.photos.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap">
                          {d.photos.map((p) => (
                            <a
                              key={p.id}
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block w-16 h-16 rounded-md overflow-hidden border border-navy-700 hover:border-accent-blue/60 transition-colors"
                              title={t('workOrders.card.openFullPhoto', 'Open full-size photo')}
                            >
                              <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* WO details grid */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                {/* RO Number: editable inline when (a) the vendor side is
                    viewing a pending WO with no RO attached yet and (b) the
                    workshop is external-mode (the case that ACTUALLY needs
                    an RO before accept). Otherwise read-only. Saves on blur
                    via the parent's onAction('add-ro', ...) hook. */}
                {wo.status === 'pending'
                  && isDispatcher
                  && (wo._v2?.statusTrackingMode === 'external' || wo.statusTrackingMode === 'external')
                  && (!wo.ros || wo.ros.length === 0)
                  ? (
                    <InlineRoField
                      onSave={(value) => onAction('add-ro', { wo, roNumber: value })}
                    />
                  )
                  : (
                    <Field label={t('workOrders.card.roNumber', 'RO Number')} value={wo.roNumber} mono />
                  )}
                <Field label={t('workOrders.card.reportedBy', 'Reported by')} value={wo.reportedBy} />
                <Field label={t('workOrders.card.lastMileage', 'Last mileage')} value={wo.lastMileage ? `${wo.lastMileage.toLocaleString()} ${t('workOrders.milesShort', 'mi')}` : '—'} />
                <Field label={t('workOrders.card.fmc', 'FMC')} value={wo.fmc} />
                <Field label={t('workOrders.card.yearMakeModel', 'Y / Make / Model')} value={`${wo.year} ${wo.make} ${wo.model}`} />
                <Field label={t('workOrders.card.vin', 'VIN')} value={wo.vin} mono small />
                {wo.declinedReason && <Field label={t('workOrders.card.declinedReason', 'Declined reason')} value={wo.declinedReason} warn />}
                {wo.canceledReason && <Field label={t('workOrders.card.canceledReason', 'Canceled reason')} value={wo.canceledReason} warn />}
                {wo.completedAt && <Field label={t('workOrders.card.completedAt', 'Completed at')} value={new Date(wo.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} />}
              </div>

              {/* Notes */}
              {wo.notes && wo.notes.length > 0 && (
                <div>
                  <div className="text-[10px] text-navy-400 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                    <MessageSquare size={10} /> {t('workOrders.card.notesCountFmt', { count: wo.notes.length, defaultValue: `Notes (${wo.notes.length})` })}
                  </div>
                  <div className="space-y-1">
                    {wo.notes.map((n, i) => (
                      <div key={i} className="rounded-md bg-navy-800/40 border border-navy-700/40 px-2.5 py-1.5 text-xs text-navy-200">{n}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-navy-800">
                <button onClick={() => onAction('notes', wo)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-xs font-medium text-navy-300 hover:text-white hover:border-navy-600 cursor-pointer">
                  <MessageSquare size={11} /> {t('workOrders.card.notes', 'Notes')}
                </button>

                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {/* Dispatcher actions on Pending */}
                  {isDispatcher && wo.status === 'pending' && (
                    <>
                      <button onClick={() => onAction('decline', wo)}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs font-semibold hover:bg-accent-red/25 cursor-pointer">
                        <XCircle size={11} /> {t('workOrders.card.decline', 'Decline')}
                      </button>
                      <button onClick={() => onAction('accept', wo)}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-accent-blue text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
                        <PlayCircle size={11} /> {t('workOrders.card.acceptAndAssign', 'Accept & Assign')}
                      </button>
                    </>
                  )}

                  {/* Dispatcher actions on Pending FMC */}
                  {isDispatcher && wo.status === 'pending_fmc' && (
                    <div className="text-[11px] text-accent-purple flex items-center gap-1">
                      <Briefcase size={11} /> {t('workOrders.card.awaitingFmcFmt', { fmc: wo.fmc, defaultValue: `Awaiting ${wo.fmc} approval` })}
                    </div>
                  )}

                  {/* Technician actions on In Progress (only if assigned to them, or dispatcher view) */}
                  {((isTechnician && isMyWO) || isDispatcher || userRole === 'site_admin') && wo.status === 'in_progress' && (
                    <>
                      <button onClick={() => onAction('release', wo)}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-accent-orange/15 border border-accent-orange/40 text-accent-orange text-xs font-semibold hover:bg-accent-orange/25 cursor-pointer">
                        <PauseCircle size={11} /> {t('workOrders.card.release', 'Release')}
                      </button>
                      <button onClick={() => onAction('complete', wo)}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-accent-green text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
                        <CheckCircle2 size={11} /> {t('workOrders.card.complete', 'Complete')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Field({ label, value, mono, small, warn }) {
  return (
    <div>
      <div className="text-[10px] text-navy-500 uppercase tracking-wide">{label}</div>
      <div className={`${small ? 'text-[11px]' : 'text-xs'} ${mono ? 'font-mono' : ''} ${warn ? 'text-accent-orange' : 'text-white'} truncate`}>{value || '—'}</div>
    </div>
  );
}

/**
 * InlineRoField — editable RO Number for vendor side of a pending external-mode
 * WO. The card normally renders Field (read-only "RO Number: N/A") but for
 * the narrow vendor + pending + external + no-RO case we let the user paste
 * the number straight from their POS without going through the Accept &
 * Assign modal.
 *
 * Commits via `onSave(value)` which the parent wires to a POST
 * /work-orders/{id}/ros call (woApi.addRo). Save fires on blur OR Enter.
 */
function InlineRoField({ onSave }) {
  const { t } = useTranslation('dashboard');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    const trimmed = value.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave(trimmed);
      // Parent reloads the WO on success — the field flips to read-only on
      // the next render because `wo.ros.length > 0`.
    } catch {
      // alert already handled by parent
    } finally {
      setSaving(false);
    }
  };
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="text-[10px] text-navy-500 uppercase tracking-wide flex items-center gap-1">
        {t('workOrders.card.roNumber', 'RO Number')}
        <span className="text-accent-red">*</span>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
        }}
        disabled={saving}
        placeholder={t('workOrders.card.roNumberPlaceholder', 'RO-2026-…')}
        className="w-full bg-navy-800/60 border border-navy-700/60 rounded px-2 py-1 text-xs font-mono text-white placeholder-navy-500 outline-none focus:border-accent-blue disabled:opacity-50"
      />
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================
export default function WorkOrders({ user }) {
  const { t } = useTranslation('dashboard');
  const [workOrders, setWorkOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState([]);
  const [dspFilter, setDspFilter] = useState('all');
  const [dspFilterOpen, setDspFilterOpen] = useState(false);
  const [expandedWO, setExpandedWO] = useState(null);
  const [modal, setModal] = useState(null); // { type, wo }
  const [showLogJob, setShowLogJob] = useState(false);
  const [actionInFlight, setActionInFlight] = useState(false);

  // Technician = the canonical "do the work" role.
  // Vendor side = anyone who manages the vendor's WO queue (admin or
  // service writer) plus site_admin acting on their behalf.
  const isTechnician = user?.role === 'technician';
  const isVendor =
    user?.role === 'vendor_admin'
    || user?.role === 'service_writer'
    || user?.role === 'site_admin';

  // Caches for adapter (vehicle/workshop lookups). Loaded once on mount —
  // the V2.0 WO list endpoint returns int FKs only, so we need these to
  // render plates, makes/models, workshop names, etc. without N+1.
  const [vehiclesById, setVehiclesById] = useState({});
  const [workshopsById, setWorkshopsById] = useState({});
  const ctx = useMemo(
    () => buildCtx(vehiclesById, workshopsById, {}),
    [vehiclesById, workshopsById]
  );

  // Parse the trailing integer from a prefixed string id ("VAN-0161" → 161,
  // "VW-003" → 3). The backend exposes prefixed strings for vehicles +
  // workshops but V2.0 WO references their numeric FKs — we key the lookup
  // caches on the numeric tail so both sides line up.
  const numericTail = (idLike) => {
    if (typeof idLike === 'number') return idLike;
    if (typeof idLike !== 'string') return null;
    const m = idLike.match(/(\d+)$/);
    return m ? Number(m[1]) : null;
  };

  // Fetch initial list — backend already role-scopes. Pulls vehicles +
  // workshops in parallel so the adapter has full context on first paint.
  const reload = useCallback(async () => {
    setError(null);
    try {
      const [res, vehiclesRes, workshopsRes] = await Promise.all([
        woApi.list({ limit: 200 }),
        vehiclesApi.list({ perPage: 500 }).catch(() => ({ items: [] })),
        workshopsApi.list({ includeInactive: true }).catch(() => ({ items: [] })),
      ]);
      const vById = Object.fromEntries(
        (vehiclesRes.items || [])
          .map((v) => [numericTail(v.id), { ...v, dspName: v.dsp, fleetId: v.fleetId }])
          .filter(([k]) => k != null)
      );
      const wById = Object.fromEntries(
        (workshopsRes.items || [])
          .map((w) => [numericTail(w.id), w])
          .filter(([k]) => k != null)
      );
      setVehiclesById(vById);
      setWorkshopsById(wById);
      const localCtx = buildCtx(vById, wById, {});
      setWorkOrders(mapApiListToUi(res.items || [], localCtx));
    } catch (e) {
      console.error('failed to load work orders', e);
      setError(e.detail || e.message || 'Failed to load work orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  // When user expands a card, hydrate with full detail (line items + notes + ROs)
  const hydrateExpanded = useCallback(async (woId) => {
    try {
      const detail = await woApi.get(woId);
      const enriched = mapApiToUi(detail, ctx);
      setWorkOrders((prev) =>
        prev.map((w) => (w.id === woId ? { ...w, ...enriched } : w))
      );
    } catch (e) {
      console.error('hydrate failed', e);
    }
  }, [ctx]);

  // For technicians, filter to only their WOs; for vendors/site admins, show all
  const visibleWOs = useMemo(() => {
    if (isTechnician) {
      return workOrders.filter((wo) => wo.assignedTechnician === user.name || (wo.status !== 'in_progress' && wo.assignedTechnician === null));
      // Technicians don't see pending WOs normally; simplification for demo: they see only their in-progress
    }
    // Actually for technicians in v1: they only see their assigned WOs
    return workOrders;
  }, [workOrders, isTechnician, user]);

  // Actually for technicians, only show WOs assigned to them
  const myWOs = useMemo(() => {
    if (isTechnician) {
      // V2.0: compare numeric tech id (preserved in the adapted shape) —
      // the user-name lookup we used in V1 only worked because the adapter
      // resolved IDs from a users cache, which the tech role doesn't have.
      const techId = user?.id != null ? Number(user.id) : null;
      return workOrders.filter((wo) => {
        const woTechId = wo._v2?.assignedTechnicianId ?? wo.assignedTechnicianId;
        return techId != null && Number(woTechId) === techId;
      });
    }
    return workOrders;
  }, [workOrders, isTechnician, user]);

  // Apply search + filters
  const filtered = useMemo(() => {
    let list = myWOs;
    if (statusFilters.length > 0) list = list.filter((wo) => statusFilters.includes(wo.status));
    if (dspFilter !== 'all') list = list.filter((wo) => wo.dspId === dspFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((wo) =>
        wo.id.toLowerCase().includes(s) ||
        wo.vehicleId.toLowerCase().includes(s) ||
        wo.plate.toLowerCase().includes(s) ||
        wo.description.toLowerCase().includes(s) ||
        wo.dspName.toLowerCase().includes(s) ||
        (wo.assignedTechnician || '').toLowerCase().includes(s)
      );
    }
    return list;
  }, [myWOs, search, statusFilters, dspFilter]);

  // Summary stats (week-to-date)
  const summary = useMemo(() => {
    const pending = myWOs.filter((wo) => wo.status === 'pending').length;
    const pendingFmc = myWOs.filter((wo) => wo.status === 'pending_fmc').length;
    const inProgress = myWOs.filter((wo) => wo.status === 'in_progress').length;
    const completed = myWOs.filter((wo) => wo.status === 'completed').length;
    const declined = myWOs.filter((wo) => wo.status === 'declined').length;
    const rushOrders = myWOs.filter((wo) => wo.flags.includes('rush_order')).length;
    const total = myWOs.length;
    return { pending, pendingFmc, inProgress, completed, declined, rushOrders, total };
  }, [myWOs]);

  const uniqueDsps = useMemo(() => {
    const map = new Map();
    myWOs.forEach((wo) => map.set(wo.dspId, wo.dspName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [myWOs]);

  const toggleStatusFilter = (status) => {
    setStatusFilters(statusFilters.includes(status) ? statusFilters.filter((s) => s !== status) : [...statusFilters, status]);
  };

  // Action dispatcher. Most actions just open a modal; a few (currently
  // just 'add-ro' from the inline RO field on the card) hit the API
  // directly and refresh.
  const handleAction = async (type, payload) => {
    if (type === 'add-ro') {
      const { wo, roNumber } = payload;
      try {
        await woApi.addRo(wo.id, { roNumber, isPrimary: true });
        await applyDetail(wo.id);
      } catch (err) {
        alert(`Couldn't add RO: ${err?.detail || err?.message || 'unknown'}`);
      }
      return;
    }
    setModal({ type, wo: payload });
  };

  // Apply a hydrated WO into the list (used after every mutation).
  // Re-fetches detail since V2.0 endpoints return the WO without the
  // embedded line_items / ros / notes that the UI needs.
  const applyDetail = async (apiOrId) => {
    const id = typeof apiOrId === 'object' && apiOrId !== null ? apiOrId.id : apiOrId;
    if (!id) return;
    try {
      const detail = await woApi.get(id);
      const ui = mapApiToUi(detail, ctx);
      setWorkOrders((prev) => prev.map((w) => (w.id === ui.id ? { ...w, ...ui } : w)));
    } catch (e) {
      console.error('applyDetail failed', e);
    }
  };

  /**
   * Accept & Assign flow (V2.0):
   *   pending_acceptance → accepted (POST /accept; also generates line items)
   *   then POST /assign-technician
   *   then accepted → in_progress (POST /start)
   * Each step has its own RBAC + state machine enforced server-side.
   */
  const handleAssign = async ({ technician, notes, roNumber }) => {
    const wo = modal.wo;
    setActionInFlight(true);
    try {
      // Step 0 (V2.0 external-mode only): attach the RO# from the modal
      // BEFORE accept — the DB trigger refuses to flip status to accepted
      // on an external-mode workshop with no RO. Internal-mode skips this.
      if (roNumber) {
        try {
          await woApi.addRo(wo.id, { roNumber, isPrimary: true });
        } catch (e) {
          // Non-fatal: maybe the RO already exists. Surface but keep going.
          console.warn('addRo failed (continuing to accept):', e?.detail || e?.message);
        }
      }
      // Step 1: vendor accepts (generates line items + DRs)
      if (wo.status === 'pending') {
        await woApi.accept(wo.id);
      }
      // Step 2: assign technician
      await woApi.assignTechnician(wo.id, technician.id);
      // Step 3: kick off work
      await woApi.start(wo.id);
      // Optional dispatcher note
      if (notes?.trim()) {
        try { await woApi.addNote(wo.id, { body: notes, authorRole: 'vendor_service_writer' }); } catch (_) {}
      }
      await applyDetail(wo.id);
    } catch (e) {
      console.error('assign failed', e);
      alert(e.detail || e.message || 'Failed to assign technician');
    } finally {
      setActionInFlight(false);
      setModal(null);
    }
  };

  const handleDecline = async ({ reason, notes }) => {
    const wo = modal.wo;
    setActionInFlight(true);
    try {
      // Map V1 numeric reason codes 1-4 → V2.0 decline_reason_codes strings.
      const codeMap = {
        1: 'parts_unavailable',
        2: 'specialty_required',
        3: 'out_of_warranty',
        4: 'cost_too_high',
      };
      await woApi.decline(wo.id, {
        reason: notes || reason?.label,
        declineReasonCode: codeMap[reason?.code] || 'other',
        reroute: true,
      });
      await applyDetail(wo.id);
    } catch (e) {
      console.error('decline failed', e);
      alert(e.detail || e.message || 'Failed to decline');
    } finally {
      setActionInFlight(false);
      setModal(null);
    }
  };

  const handleComplete = async ({ comments, mileage, odometerPhotoPath, workPhotoPath }) => {
    const wo = modal.wo;
    setActionInFlight(true);
    try {
      await woApi.complete(wo.id, {
        lastMileage: Number(mileage),
        odometerPhotoPath: odometerPhotoPath || undefined,
        workPhotoPath: workPhotoPath || undefined,
      });
      if (comments?.trim()) {
        try { await woApi.addNote(wo.id, { body: comments, authorRole: 'technician' }); } catch (_) {}
      }
      await applyDetail(wo.id);
      // Only close on success — leave the modal open on 422 (mileage floor
      // violation, missing photos, etc.) so the user can correct inline.
      setModal(null);
    } catch (e) {
      console.error('complete failed', e);
      // Re-throw so the modal's local handler can surface the message
      // inline (it has its own try/catch around onComplete).
      const inlineErr = new Error(e?.detail || e?.message || 'Failed to complete WO');
      inlineErr.detail = e?.detail;
      throw inlineErr;
    } finally {
      setActionInFlight(false);
    }
  };

  // "Release" in V1 meant un-assign tech + return to dispatcher pool.
  // V2.0 doesn't have a release verb — clear the technician and the
  // dispatcher can re-assign. Status stays in_progress.
  const handleRelease = async () => {
    const wo = modal.wo;
    setActionInFlight(true);
    try {
      await woApi.assignTechnician(wo.id, null);
      try {
        await woApi.addNote(wo.id, {
          body: `Released by ${user?.name || 'tech'} — returned to dispatcher`,
          authorRole: 'technician',
        });
      } catch (_) {}
      await applyDetail(wo.id);
    } catch (e) {
      console.error('release failed', e);
      alert(e.detail || e.message || 'Failed to release');
    } finally {
      setActionInFlight(false);
      setModal(null);
    }
  };

  // Free-text note append — V2.0 has a dedicated POST /notes endpoint.
  const addNote = async (woId, note) => {
    if (!note?.trim()) return;
    setActionInFlight(true);
    try {
      const roleByUser =
        user?.role === 'technician' ? 'technician'
        : user?.role === 'vendor_admin' || user?.role === 'service_writer' ? 'vendor_service_writer'
        : user?.role === 'site_admin' ? 'admin'
        : 'customer';
      await woApi.addNote(woId, { body: note, authorRole: roleByUser });
      await applyDetail(woId);
    } catch (e) {
      console.error('add note failed', e);
      alert(e.detail || e.message || 'Failed to add note');
    } finally {
      setActionInFlight(false);
    }
  };

  // Today's date string
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const completionRate = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 sm:mb-6 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-white mb-1">{t('workOrders.heading', 'Work Orders')}</h2>
          <p className="text-navy-400 text-sm">
            {isTechnician
              ? t('workOrders.subtitleTechFmt', { count: summary.total, defaultValue: `My assigned WOs — ${summary.total} total` })
              : t('workOrders.subtitleVendorFmt', { count: summary.total, dspCount: uniqueDsps.length, defaultValue: `Vendor hub — ${summary.total} WOs across ${uniqueDsps.length} DSPs` })}
          </p>
        </div>
        <button onClick={() => setShowLogJob(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-purple/15 border border-accent-purple/40 text-accent-purple text-sm font-semibold hover:bg-accent-purple/25 cursor-pointer">
          <PackageCheck size={14} /> {t('workOrders.logJob', 'Log a Job')}
        </button>
      </div>

      {/* Summary card — week-to-date stats */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-navy-900/80 to-navy-900/40 border border-navy-700/40 rounded-xl p-4 sm:p-5 mb-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/15 flex items-center justify-center">
              <ClipboardList size={14} className="text-accent-blue" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{t('workOrders.summary.title', 'Work Order Summary')}</div>
              <div className="text-[11px] text-navy-400">{dateStr} &middot; {t('workOrders.summary.weekToDate', 'week-to-date')}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-navy-400">{t('workOrders.summary.completionRate', 'Completion rate')}</div>
            <div className="text-lg font-bold text-accent-green">{completionRate}%</div>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <StatCard label={t('workOrders.summary.total', 'Total')} value={summary.total} color="text-white" icon={ClipboardList} />
          <StatCard label={t('workOrders.summary.pending', 'Pending')} value={summary.pending + summary.pendingFmc} color="text-accent-gold" icon={Hourglass} />
          <StatCard label={t('workOrders.summary.inProgress', 'In Progress')} value={summary.inProgress} color="text-accent-blue" icon={PlayCircle} />
          <StatCard label={t('workOrders.summary.completed', 'Completed')} value={summary.completed} color="text-accent-green" icon={CheckCircle2} />
          <StatCard label={t('workOrders.summary.declined', 'Declined')} value={summary.declined} color="text-accent-red" icon={XCircle} />
        </div>
        {summary.rushOrders > 0 && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/30 text-xs">
            <Flame size={12} className="text-accent-red" />
            <span className="text-navy-300">{t('workOrders.summary.rushOrderBannerFmt', { count: summary.rushOrders, defaultValue: `${summary.rushOrders} Rush Order${summary.rushOrders > 1 ? 's' : ''} requiring immediate attention` })}</span>
          </div>
        )}
      </motion.div>

      {/* Search + filters */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('workOrders.searchPlaceholder', 'Search WO ID, fleet ID, plate, DSP or description…')}
            className="w-full rounded-lg pl-9 pr-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" />
        </div>

        {/* DSP filter */}
        {!isTechnician && uniqueDsps.length > 1 && (
          <div className="relative">
            <button onClick={() => setDspFilterOpen(!dspFilterOpen)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm border cursor-pointer min-h-[42px] ${
                dspFilter !== 'all' ? 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue font-semibold' : 'bg-navy-800 border-navy-700 text-navy-300 hover:text-white'
              }`}>
              <Building2 size={14} />
              <span className="truncate max-w-[140px]">{dspFilter === 'all' ? t('workOrders.filter.allDsps', 'All DSPs') : uniqueDsps.find((d) => d.id === dspFilter)?.name}</span>
              <ChevronDown size={12} />
            </button>
            {dspFilterOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDspFilterOpen(false)} />
                <div className="absolute top-full right-0 mt-1 w-64 bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-20 overflow-hidden max-h-72 overflow-y-auto">
                  <button onClick={() => { setDspFilter('all'); setDspFilterOpen(false); }}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm text-white hover:bg-navy-800 border-b border-navy-800">
                    <span>{t('workOrders.filter.allDspsCountFmt', { count: myWOs.length, defaultValue: `All DSPs (${myWOs.length})` })}</span>
                    {dspFilter === 'all' && <Check size={12} className="text-accent-green" />}
                  </button>
                  {uniqueDsps.map((d) => {
                    const count = myWOs.filter((wo) => wo.dspId === d.id).length;
                    return (
                      <button key={d.id} onClick={() => { setDspFilter(d.id); setDspFilterOpen(false); }}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm text-white hover:bg-navy-800 border-b border-navy-800/60 last:border-b-0">
                        <span className="truncate">{t('workOrders.filter.perDspCountFmt', { name: d.name, count, defaultValue: `${d.name} (${count})` })}</span>
                        {dspFilter === d.id && <Check size={12} className="text-accent-green shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap overflow-x-auto">
        <span className="text-[11px] text-navy-400 font-semibold uppercase tracking-wide shrink-0 mr-1">{t('workOrders.filter.statusLabel', 'Status:')}</span>
        {Object.entries(STATUS_CONFIG).map(([key, conf]) => {
          const active = statusFilters.includes(key);
          const count = myWOs.filter((wo) => wo.status === key).length;
          if (count === 0 && !active) return null;
          const Icon = conf.icon;
          return (
            <button key={key} onClick={() => toggleStatusFilter(key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer shrink-0 ${
                active
                  ? `${conf.bg} ${conf.border} ${conf.color}`
                  : 'bg-navy-800/40 border-navy-700 text-navy-400 hover:text-white hover:border-navy-600'
              }`}>
              <Icon size={10} />
              {t(`workOrders.statusBadge.${key}`, conf.label)}
              <span className={`ml-0.5 px-1 rounded ${active ? 'bg-black/20' : 'bg-navy-700/50 text-navy-300'}`}>{count}</span>
            </button>
          );
        })}
        {statusFilters.length > 0 && (
          <button onClick={() => setStatusFilters([])} className="text-[11px] text-accent-red hover:underline ml-1 shrink-0">{t('workOrders.filter.clearFilters', 'Clear filters')}</button>
        )}
      </div>

      {/* WO list */}
      {loading ? (
        <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-10 text-center">
          <Loader2 size={28} className="animate-spin text-accent-blue mx-auto mb-3" />
          <p className="text-sm text-navy-300">{t('workOrders.loading', 'Loading work orders…')}</p>
        </div>
      ) : error ? (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-6 text-center">
          <AlertTriangle size={24} className="text-accent-red mx-auto mb-2" />
          <p className="text-sm text-white">{t('workOrders.loadError', "Couldn't load work orders")}</p>
          <p className="text-xs text-navy-300 mt-1">{error}</p>
          <button onClick={reload} className="mt-3 px-3 py-1.5 rounded-lg bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs font-semibold hover:bg-accent-red/25 cursor-pointer">
            {t('workOrders.retry', 'Retry')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((wo) => (
            <WorkOrderCard
              key={wo.id}
              wo={wo}
              expanded={expandedWO === wo.id}
              onToggle={() => {
                if (expandedWO === wo.id) {
                  setExpandedWO(null);
                } else {
                  setExpandedWO(wo.id);
                  hydrateExpanded(wo.id); // fetch full detail on expand
                }
              }}
              userRole={user?.role}
              currentUserId={user?.id}
              onAction={handleAction}
            />
          ))}
          {filtered.length === 0 && (
            <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-10 text-center">
              <ClipboardList size={40} className="text-navy-600 mx-auto mb-3" />
              <h4 className="text-sm font-semibold text-white mb-1">{t('workOrders.empty.noMatch', 'No work orders match your filters')}</h4>
              <p className="text-xs text-navy-400">{workOrders.length === 0 ? t('workOrders.empty.noWOs', 'No WOs yet — convert defects on the Defects tab.') : t('workOrders.empty.tryClearing', 'Try clearing filters or changing your search.')}</p>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {modal?.type === 'accept' && <AssignTechnicianModal wo={modal.wo} onAssign={handleAssign} onClose={() => setModal(null)} />}
        {modal?.type === 'decline' && <DeclineModal wo={modal.wo} onDecline={handleDecline} onClose={() => setModal(null)} />}
        {modal?.type === 'complete' && <CompleteWorkModal wo={modal.wo} onComplete={handleComplete} onClose={() => setModal(null)} />}
        {modal?.type === 'release' && <ReleaseModal wo={modal.wo} onRelease={handleRelease} onClose={() => setModal(null)} />}
        {modal?.type === 'notes' && <NotesModal wo={modal.wo} onAddNote={(n) => addNote(modal.wo.id, n)} onClose={() => setModal(null)} />}
        {showLogJob && <LogJobModal onClose={() => setShowLogJob(false)} onSubmit={() => { /* logged */ }} />}
      </AnimatePresence>
    </div>
  );
}

// Small metric stat card
function StatCard({ label, value, color, icon: Icon }) {
  return (
    <div className="rounded-lg bg-navy-800/40 border border-navy-700/40 p-2.5 text-center">
      {Icon && <Icon size={14} className={`mx-auto mb-1 ${color}`} />}
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-navy-400 uppercase tracking-wide">{label}</div>
    </div>
  );
}
