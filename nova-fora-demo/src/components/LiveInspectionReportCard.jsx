/**
 * LiveInspectionReportCard
 *
 * Renders a real inspection's full detail when Tamika clicks a van row in
 * the "Vans Inspected in Recent QC DVIC" modal. Fetches:
 *   - GET /inspections/{id}            → defects array + odometer + meta
 *   - GET /inspections/{id}/photos     → odometer / overview photos
 *   - GET /defects/{id}/photos         → per-defect damage photos
 *
 * Per defect, the DSP owner can:
 *   - Reject  → PATCH /defects/{id} status='dismissed'
 *   - Approve → PATCH /defects/{id} status='acknowledged' + open CreateWO
 *               modal pre-filled with this defect (legacy create flow).
 */
import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, X, Camera, Check, AlertCircle, Loader2, ChevronLeft, ChevronRight,
  Wrench, ThumbsUp, ThumbsDown, KeyRound, Gauge, ClipboardList,
} from 'lucide-react';
import {
  inspections as inspectionsApi,
  defects as defectsApi,
  APIError,
} from '../api/client';
import { canApproveDefects } from '../lib/permissions';

export default function LiveInspectionReportCard({ inspection, user, onClose, onCreateWO }) {
  const { t } = useTranslation('wizard');
  const [detail, setDetail] = useState(null);
  const [inspectionPhotos, setInspectionPhotos] = useState([]);
  // photosByDefect: { defectId: [PhotoResponse] }
  const [photosByDefect, setPhotosByDefect] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Per-defect optimistic action state — overrides the server status until reload
  const [actions, setActions] = useState({}); // {defectId: 'approved' | 'rejected'}

  // Photo carousel index for the inspection-level photos
  const [photoIdx, setPhotoIdx] = useState(0);

  // Approve / dismiss requires DSP-side admin authority. DSP managers fill
  // in for owners; inspectors + viewers can only read.
  const canTakeActions = canApproveDefects(user);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [det, insPhotos] = await Promise.all([
          inspectionsApi.get(inspection.inspectionId || inspection.id),
          inspectionsApi.listInspectionPhotos(inspection.inspectionId || inspection.id),
        ]);
        if (cancel) return;
        setDetail(det);
        setInspectionPhotos(insPhotos.items || []);
        // For each defect, fetch its photos in parallel
        const defectIds = (det.defects || []).map((d) => d.id);
        const photosResults = await Promise.all(
          defectIds.map((id) => defectsApi.listPhotos(id).catch(() => ({ items: [] })))
        );
        if (cancel) return;
        const map = {};
        defectIds.forEach((id, i) => { map[id] = photosResults[i].items || []; });
        setPhotosByDefect(map);
      } catch (err) {
        if (!cancel) setError(err instanceof APIError ? err.detail : 'Failed to load inspection');
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    load();
    return () => { cancel = true; };
  }, [inspection]);

  const defects = detail?.defects || [];
  const defectsBySection = useMemo(() => {
    const groups = {};
    for (const d of defects) {
      if (!groups[d.section]) groups[d.section] = [];
      groups[d.section].push(d);
    }
    return groups;
  }, [defects]);

  const handleReject = async (defect) => {
    setActions((a) => ({ ...a, [defect.id]: 'rejected' }));
    try {
      await defectsApi.updateStatus(defect.id, 'dismissed');
    } catch (err) {
      setActions((a) => {
        const c = { ...a };
        delete c[defect.id];
        return c;
      });
      alert(`Reject failed: ${err?.detail || err?.message || 'unknown'}`);
    }
  };

  const handleApprove = async (defect) => {
    setActions((a) => ({ ...a, [defect.id]: 'approved' }));
    try {
      // Mark acknowledged in the backend so the defect status persists
      await defectsApi.updateStatus(defect.id, 'acknowledged');
    } catch (err) {
      // Non-fatal — still open the WO modal so the DSP makes progress
      console.warn('ACK failed:', err);
    }
    // Open Create Work Order modal pre-filled
    onCreateWO?.({
      van: {
        id: detail.vehicleId,
        fleetId: detail.fleetId,
        plate: detail.plate || '',
        mileage: detail.odometerMiles || 0,
        model: '',
        year: 0,
        make: '',
      },
      defect: {
        section: defect.section,
        part: defect.part,
        description: defect.description,
      },
      defectId: defect.id,
    });
  };

  // ─── Photo carousel for inspection-level photos ────
  const currentPhoto = inspectionPhotos[photoIdx];

  // ─── Render ────────────────────────────────────────
  if (loading) {
    return (
      <Shell onClose={onClose} title={t('liveReport.loading', 'Loading inspection…')}>
        <div className="flex items-center justify-center py-16">
          <Loader2 size={32} className="text-accent-blue animate-spin" />
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell onClose={onClose} title={t('common:status.error', 'Error')}>
        <div className="flex flex-col items-center gap-3 py-16">
          <AlertCircle size={32} className="text-accent-red" />
          <p className="text-sm text-navy-300 max-w-md text-center">{error}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      onClose={onClose}
      title={`${detail.fleetId} — ${detail.id}`}
      subtitle={`${detail.dsp} · ${detail.vendor || '—'} · Tech: ${detail.inspector || '—'}`}
    >
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {/* Top stats */}
        <div className="grid grid-cols-3 gap-2">
          <StatPill icon={Gauge} label={t('liveReport.odometer', 'Odometer')} value={detail.odometerMiles ? `${detail.odometerMiles.toLocaleString()} mi` : '—'} />
          <StatPill icon={KeyRound} label={t('liveReport.keys', 'Keys')} value={detail.keysReceived ?? '—'} />
          <StatPill icon={ClipboardList} label={t('liveReport.result', 'Result')} value={detail.result} resultValue={detail.result} />
        </div>

        {/* Inspection-level photos (odometer, overview) */}
        {inspectionPhotos.length > 0 ? (
          <div className="rounded-xl border border-navy-700 bg-navy-900/60 overflow-hidden">
            <div className="aspect-video bg-navy-950 relative">
              <img
                src={currentPhoto.url}
                alt={currentPhoto.category}
                className="w-full h-full object-contain"
              />
              {inspectionPhotos.length > 1 && (
                <>
                  <button
                    onClick={() => setPhotoIdx((i) => (i - 1 + inspectionPhotos.length) % inspectionPhotos.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 text-white hover:bg-black/80 flex items-center justify-center cursor-pointer"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={() => setPhotoIdx((i) => (i + 1) % inspectionPhotos.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 text-white hover:bg-black/80 flex items-center justify-center cursor-pointer"
                  >
                    <ChevronRight size={18} />
                  </button>
                </>
              )}
            </div>
            <div className="px-3 py-2 flex items-center justify-between text-[11px]">
              <span className="text-navy-400">
                <span className="uppercase tracking-wide font-semibold text-navy-300">{currentPhoto.category}</span>
                {currentPhoto.uploadedBy && <> · by {currentPhoto.uploadedBy}</>}
              </span>
              <span className="text-navy-500">
                {photoIdx + 1} / {inspectionPhotos.length}
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-navy-700/40 bg-navy-900/30 p-5 text-center">
            <Camera size={20} className="text-navy-500 mx-auto mb-2" />
            <p className="text-xs text-navy-400">{t('liveReport.noInspectionPhotos', 'No inspection-level photos (odometer / overview)')}</p>
          </div>
        )}

        {/* Defects */}
        {defects.length === 0 ? (
          <div className="rounded-xl border border-accent-green/30 bg-accent-green/5 p-5 text-center">
            <Check size={24} className="text-accent-green mx-auto mb-2" />
            <p className="text-sm text-white font-semibold">{t('liveReport.allPassed', 'All sections passed')}</p>
            <p className="text-xs text-navy-400 mt-0.5">{t('liveReport.noDefects', 'No defects reported in this inspection.')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h4 className="text-xs uppercase tracking-wide font-semibold text-accent-orange">
              Defects ({defects.length})
            </h4>
            {Object.entries(defectsBySection).map(([section, items]) => (
              <div key={section} className="space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-navy-400 px-1 font-semibold">
                  {section}
                </div>
                {items.map((d) => {
                  const action = actions[d.id]
                    || (d.status === 'dismissed' ? 'rejected'
                        : d.status === 'acknowledged' || d.status === 'sent_to_vendor' || d.status === 'scheduled' || d.status === 'converted_to_wo' ? 'approved'
                        : null);
                  const photos = photosByDefect[d.id] || [];
                  return (
                    <DefectRow
                      key={d.id}
                      defect={d}
                      photos={photos}
                      action={action}
                      canAct={canTakeActions && !action}
                      onApprove={() => handleApprove(d)}
                      onReject={() => handleReject(d)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {detail.notes && (
          <div className="rounded-lg border border-navy-700 bg-navy-900/40 p-3">
            <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1">{t('liveReport.inspectorNotes', 'Inspector notes')}</div>
            <p className="text-sm text-navy-200 whitespace-pre-wrap">{detail.notes}</p>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────
// Defect row with photos + action buttons
// ─────────────────────────────────────────────────────
// Format the structured details object into a 1-line legible string.
function formatDetailsSummary(details) {
  if (!details) return '';
  const parts = [];
  if (details.tread_depth_32nds !== undefined) parts.push(`${details.tread_depth_32nds}/32`);
  if (details.in_drivers_line_of_sight === true) parts.push("in driver's line of sight");
  if (details.in_drivers_line_of_sight === false) parts.push("outside driver's line of sight");
  if (details.lamp_type?.length) parts.push(details.lamp_type.join(', '));
  if (details.state) parts.push(details.state);
  if (details.expiration_month) parts.push(`expired ${details.expiration_month}`);
  if (details.expiration_date) parts.push(`expired ${details.expiration_date}`);
  return parts.join(' · ');
}

function DefectRow({ defect, photos, action, canAct, onApprove, onReject }) {
  const isV2 = !!defect.isV2;
  const partHeader = isV2
    ? `${defect.partIcon || ''} ${defect.partLabel || defect.part}${defect.positionLabel ? ` (${defect.positionLabel})` : ''}`.trim()
    : defect.part;
  const issueLine = isV2
    ? (() => {
        const t = `${defect.defectTypeIcon || ''} ${defect.defectTypeLabel || ''}`.trim();
        const det = formatDetailsSummary(defect.details);
        return det ? `${t} — ${det}` : t;
      })()
    : defect.description;

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        action === 'rejected'
          ? 'border-navy-700/60 bg-navy-900/30 opacity-60'
          : action === 'approved'
          ? 'border-accent-green/40 bg-accent-green/5'
          : 'border-navy-700 bg-navy-900/60'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-semibold text-white">{partHeader}</span>
            <span className="text-[10px] text-navy-500 font-mono">{defect.id}</span>
          </div>
          <p className={`text-xs ${action === 'rejected' ? 'line-through text-navy-500' : 'text-navy-200'}`}>
            {issueLine}
          </p>
          {isV2 && defect.description && defect.description !== issueLine && (
            <p className="text-[11px] text-navy-400 mt-1 italic">{defect.description}</p>
          )}
        </div>
      </div>

      {/* Damage photos */}
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          {photos.slice(0, 8).map((p) => (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="aspect-square rounded-md overflow-hidden border border-navy-700 hover:border-accent-blue cursor-pointer group relative"
              title="Open full-size in new tab"
            >
              <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}

      {/* Actions */}
      {action === 'rejected' ? (
        <div className="flex items-center gap-1.5 text-[11px] text-navy-400">
          <ThumbsDown size={12} /> Rejected
        </div>
      ) : action === 'approved' ? (
        <div className="flex items-center gap-1.5 text-[11px] text-accent-green font-semibold">
          <ThumbsUp size={12} /> Approved — work order created
        </div>
      ) : canAct ? (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onReject}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-red/10 border border-accent-red/40 text-accent-red text-xs font-semibold hover:bg-accent-red/20 cursor-pointer"
          >
            <ThumbsDown size={12} /> Reject
          </button>
          <button
            onClick={onApprove}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-green text-white text-xs font-semibold hover:opacity-90 cursor-pointer"
          >
            <Wrench size={12} /> Approve &amp; Create WO
          </button>
        </div>
      ) : (
        <div className="text-[11px] text-navy-500 italic">
          Status: {defect.status}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Full-screen shell
// ─────────────────────────────────────────────────────
function Shell({ title, subtitle, onClose, children }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-navy-950 overflow-y-auto"
    >
      <div className="sticky top-0 z-20 px-4 sm:px-6 py-4 border-b border-navy-800 bg-navy-900/95 backdrop-blur">
        <div className="max-w-3xl mx-auto flex items-start justify-between gap-3">
          <button
            onClick={onClose}
            className="text-navy-300 hover:text-white p-2 -ml-2 rounded-md hover:bg-navy-800 cursor-pointer shrink-0"
            title="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg sm:text-xl font-semibold text-white truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-navy-400 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-navy-400 hover:text-white p-2 -mr-2 rounded-md hover:bg-navy-800 shrink-0"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────
// Stat pill
// ─────────────────────────────────────────────────────
function StatPill({ icon: Icon, label, value, resultValue }) {
  const tint =
    resultValue === 'passed' ? 'text-accent-green'
    : resultValue === 'flagged' ? 'text-accent-red'
    : resultValue === 'conditional' ? 'text-accent-gold'
    : 'text-white';
  return (
    <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-navy-400 mb-1">
        <Icon size={11} />
        <span>{label}</span>
      </div>
      <div className={`text-sm font-bold ${tint} truncate`}>
        {value || '—'}
      </div>
    </div>
  );
}
