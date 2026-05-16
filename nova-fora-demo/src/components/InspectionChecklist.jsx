/**
 * InspectionChecklist — checklist-style replacement for DvicWizard's
 * walkaround steps. Mounted by CreateInspectionWizard at its step 6
 * (right after the inspector confirms the odometer + photo).
 *
 * Design source: NOVABODY/web mbk/wo-v2-claude-demo branch
 * (`app/static/templates/inspection_v2_demo.html` + supporting
 * fragments). Adapted to React + our V2.2 catalog + our SECTION_ROUTE
 * order (General → In Cab → Front → Driver → Back → Passenger).
 *
 * Layout, top to bottom:
 *
 *   ┌────────────────────────────────────────────────┐
 *   │ [General 0/8]  [In Cab 0/27]  [Front 0/9] ...  │  ← section tabs
 *   ├────────────────────────────────────────────────┤
 *   │ ╔══════════════════════════════════════════╗   │
 *   │ ║ 🔥 fire_extinguisher       ✓ Pass  N/A   ║   │  ← part row 1
 *   │ ║   ┌──────────┐ ┌──────────┐ ┌──────┐     ║   │
 *   │ ║   │ missing  │ │ expired  │ │ ...  │     ║   │  ← chip strip
 *   │ ║   └──────────┘ └──────────┘ └──────┘     ║   │
 *   │ ╠══════════════════════════════════════════╣   │
 *   │ ║ 📋 reflective_triangles    ✓ Pass  N/A   ║   │  ← part row 2
 *   │ ║   ...                                     ║   │
 *   │ ╚══════════════════════════════════════════╝   │
 *   │   [✓ Pass remaining 6]                          │  ← bulk action
 *   │   Page 1 of 2                                   │
 *   ├────────────────────────────────────────────────┤
 *   │ [✓ Complete inspection · 22/30] (sticky)       │  ← appears when
 *   └────────────────────────────────────────────────┘    all marked
 *
 * Tap chip → DefectDetailSheet slides up with position pills + schema
 * details + mandatory photo (when defect_type.requires_photo) + notes.
 *
 * State model:
 *   - `partStatus(part)` → 'unmarked' | 'pass' | 'na' | 'defect'
 *     - 'defect' wins if there's a defect for (inspection, part)
 *     - else look up local part_marks
 *     - else 'unmarked'
 *   - SECTION_ROUTE drives both tab order and progress counters
 *   - PARTS_PER_PAGE caps each section's pane at 5 rows for phone-fit
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, ArrowRight, X, Check, AlertCircle, Loader2,
  ChevronLeft, ChevronRight, Send, Camera, Trash2,
} from 'lucide-react';
import {
  catalog as catalogApi,
  inspections as inspectionsApi,
  defects as defectsApi,
  APIError,
} from '../api/client';
import { orderPartsByWalkaround } from '../lib/walkaroundOrder';
import PhotoUploader from './ui/PhotoUploader';

// Inspection route — same order as DvicWizard's enforcement (the user
// explicitly kept this on 2026-05-15: General → In Cab → Front → Driver
// → Back → Passenger). Tabs render in this order; non-route systems
// (ev_powertrain on EV, air_brake on DOT) appear at the END.
const SECTION_ROUTE = [
  'general',
  'in_cab',
  'front_side',
  'driver_side',
  'back_side',
  'passenger_side',
];
const PARTS_PER_PAGE = 5;

// V2.2 system IDs that aren't in SECTION_ROUTE but exist in the catalog
// for some classes. We render a tab for each that has parts on the
// active vehicle class, after the route ones.
const SECTION_ROUTE_SET = new Set(SECTION_ROUTE);


// ═════════════════════════════════════════════════════
// Main checklist component
// ═════════════════════════════════════════════════════
export default function InspectionChecklist({
  inspectionId,
  vehicleId,
  vehicleClass,
  onCommitted,
  defects = [],
  onRemoveDefect,
  onComplete,
  submitting = false,
  submitError = null,
  onClose,
  onBack,
  onCancel,
}) {
  const { t } = useTranslation('wizard');
  const closeHandler = onClose || onCancel;

  const [cat, setCat] = useState(null);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState(null);

  // Active section tab + active page within that section.
  const [activeSection, setActiveSection] = useState(SECTION_ROUTE[0]);
  const [pageBySection, setPageBySection] = useState({});  // {sectionId: pageIdx}

  // Local copy of part marks. Seeded from the inspection detail on mount;
  // updated optimistically on mark/pass-remaining writes; rolled back on
  // server error.
  const [partMarks, setPartMarks] = useState({});  // {partValue: 'pass'|'na'}

  // Slide-up sheet state — null = closed; otherwise { part, defectType }
  const [sheetState, setSheetState] = useState(null);

  // Inline error band at the top of the active pane (pass/N/A failures).
  const [inlineError, setInlineError] = useState(null);

  // ─── Load catalog + initial part marks ─────────────────────────
  useEffect(() => {
    if (!vehicleClass) return undefined;
    let alive = true;
    setCatLoading(true);
    setCatError(null);
    catalogApi.load(vehicleClass)
      .then((res) => { if (alive) setCat(res); })
      .catch((err) => {
        if (!alive) return;
        setCatError(err?.detail || err?.message || 'Failed to load catalog');
      })
      .finally(() => { if (alive) setCatLoading(false); });
    return () => { alive = false; };
  }, [vehicleClass]);

  useEffect(() => {
    if (!inspectionId) return undefined;
    let alive = true;
    inspectionsApi.get(inspectionId)
      .then((res) => {
        if (!alive) return;
        setPartMarks(res?.partMarks || {});
      })
      .catch((err) => console.warn('inspection part_marks fetch failed', err));
    return () => { alive = false; };
  }, [inspectionId]);

  // ─── Derived: parts per section ───────────────────────────────
  // Build the visible-tabs list (route order first, then any non-route
  // system that has parts on this class).
  const tabs = useMemo(() => {
    if (!cat) return [];
    const inRoute = SECTION_ROUTE
      .map((id) => cat.systems.find((s) => s.id === id))
      .filter(Boolean);
    const extras = cat.systems
      .filter((s) => !SECTION_ROUTE_SET.has(s.id))
      .filter((s) => (cat.partsBySystem?.[s.id] || []).length > 0);
    return [...inRoute, ...extras];
  }, [cat]);

  // Map section_id → ordered list of part objects (curated walkaround
  // order, fallback alphabetical).
  const partsBySection = useMemo(() => {
    if (!cat) return {};
    const out = {};
    for (const sys of cat.systems) {
      const partIds = cat.partsBySystem?.[sys.id] || [];
      const partObjs = partIds.map((pid) => cat.parts.find((p) => p.id === pid)).filter(Boolean);
      out[sys.id] = orderPartsByWalkaround(partObjs, vehicleClass, sys.id);
    }
    return out;
  }, [cat, vehicleClass]);

  // Map: part value → 'unmarked' | 'pass' | 'na' | 'defect'
  const partStatus = useMemo(() => {
    const out = {};
    // First pass: defects
    for (const d of defects || []) {
      if (d?.part) out[d.part] = 'defect';
    }
    // Second pass: pass / na (defect wins, so guard)
    for (const [part, status] of Object.entries(partMarks)) {
      if (out[part] === 'defect') continue;
      out[part] = status;
    }
    return out;
  }, [defects, partMarks]);

  // Per-section counts (used in tab badges + complete bar).
  const sectionCounts = useMemo(() => {
    const out = {};
    for (const sys of tabs) {
      const parts = partsBySection[sys.id] || [];
      const total = parts.length;
      let marked = 0;
      for (const p of parts) {
        if (partStatus[p.id] && partStatus[p.id] !== 'unmarked') marked += 1;
      }
      out[sys.id] = { total, marked };
    }
    return out;
  }, [tabs, partsBySection, partStatus]);

  // Total across all tabs (route + extras) for the sticky complete bar.
  const totalCount = useMemo(() => {
    let total = 0; let marked = 0;
    for (const sys of tabs) {
      total += sectionCounts[sys.id]?.total || 0;
      marked += sectionCounts[sys.id]?.marked || 0;
    }
    return { total, marked };
  }, [tabs, sectionCounts]);
  const allMarked = totalCount.total > 0 && totalCount.marked >= totalCount.total;

  // Pagination for the active section.
  const activeParts = partsBySection[activeSection] || [];
  const pageTotal = Math.max(1, Math.ceil(activeParts.length / PARTS_PER_PAGE));
  const activePage = Math.min(pageBySection[activeSection] || 0, pageTotal - 1);
  const pageStart = activePage * PARTS_PER_PAGE;
  const pageParts = activeParts.slice(pageStart, pageStart + PARTS_PER_PAGE);
  const remainingOnPage = pageParts.filter((p) => !partStatus[p.id] || partStatus[p.id] === 'unmarked').length;

  // ─── Mark / pass-remaining handlers ────────────────────────────
  const markPart = async (part, status) => {
    setInlineError(null);
    const prev = partMarks[part];
    setPartMarks((m) => ({ ...m, [part]: status }));
    try {
      await inspectionsApi.markPart(inspectionId, { part, status });
    } catch (err) {
      // Roll back the optimistic write
      setPartMarks((m) => {
        const next = { ...m };
        if (prev) next[part] = prev; else delete next[part];
        return next;
      });
      setInlineError(err?.detail || err?.message || `Could not mark ${part}`);
    }
  };

  const passRemainingOnPage = async () => {
    if (!pageParts.length) return;
    const candidates = pageParts
      .filter((p) => !partStatus[p.id] || partStatus[p.id] === 'unmarked')
      .map((p) => p.id);
    if (candidates.length === 0) return;
    setInlineError(null);
    // Optimistic
    setPartMarks((m) => {
      const next = { ...m };
      for (const part of candidates) next[part] = 'pass';
      return next;
    });
    try {
      const res = await inspectionsApi.passRemainingParts(inspectionId, candidates);
      // Reconcile against server's authoritative response — it may have
      // skipped parts that gained defects in a parallel browser tab.
      const inserted = new Set(res?.insertedParts || []);
      setPartMarks((m) => {
        const next = { ...m };
        for (const part of candidates) {
          if (!inserted.has(part)) {
            // Server skipped — likely got a defect; drop optimistic mark.
            delete next[part];
          }
        }
        return next;
      });
    } catch (err) {
      // Full rollback
      setPartMarks((m) => {
        const next = { ...m };
        for (const part of candidates) delete next[part];
        return next;
      });
      setInlineError(err?.detail || err?.message || 'Bulk pass failed');
    }
  };

  // ─── Sheet open/close + defect commit/remove ──────────────────
  const openDefectSheet = (part, defectType) => {
    setSheetState({ part, defectType });
  };
  const closeDefectSheet = () => setSheetState(null);

  const handleDefectCommitted = (createdDefect) => {
    // The created defect implicitly flips the part to 'defect' state.
    // Drop any prior pass/N/A mark from local state so the row updates.
    if (createdDefect?.part && partMarks[createdDefect.part]) {
      setPartMarks((m) => {
        const next = { ...m };
        delete next[createdDefect.part];
        return next;
      });
    }
    onCommitted?.(createdDefect);
    closeDefectSheet();
  };

  const handleDefectRemoved = (defectId, part) => {
    onRemoveDefect?.(defectId, part);
    closeDefectSheet();
  };

  // ─── Render guards ────────────────────────────────────────────
  if (catLoading) {
    return (
      <Shell title={t('checklist.loading', 'Loading inspection catalog…')} onClose={closeHandler} onBack={onBack}>
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="text-accent-blue animate-spin" />
        </div>
      </Shell>
    );
  }
  if (catError) {
    return (
      <Shell title={t('checklist.loadError', 'Failed to load')} onClose={closeHandler} onBack={onBack}>
        <div className="px-4 py-12 text-center text-sm text-navy-300">
          <AlertCircle size={28} className="text-accent-red mx-auto mb-3" />
          <p>{catError}</p>
        </div>
      </Shell>
    );
  }

  // ─── Render ───────────────────────────────────────────────────
  return (
    <Shell title={cat.vehicleClassLabel} onClose={closeHandler} onBack={onBack}>
      {/* Section tabs — horizontal scroll on small screens */}
      <div className="sticky top-0 z-20 bg-navy-950/95 backdrop-blur border-b border-navy-800 px-2 py-2 -mx-4 sm:-mx-6 mb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto px-2 pb-1 scrollbar-thin">
          {tabs.map((sys) => {
            const counts = sectionCounts[sys.id] || { total: 0, marked: 0 };
            const isActive = activeSection === sys.id;
            const isDone = counts.total > 0 && counts.marked >= counts.total;
            return (
              <button
                key={sys.id}
                onClick={() => setActiveSection(sys.id)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-accent-blue/20 border-accent-blue text-accent-blue'
                    : isDone
                      ? 'bg-accent-green/15 border-accent-green/40 text-accent-green'
                      : 'bg-navy-800/60 border-navy-700 text-navy-300 hover:text-white'
                }`}
              >
                <span>{sys.label}</span>
                {counts.total > 0 && (
                  <span className="px-1.5 rounded bg-navy-700/60 text-navy-100">
                    {counts.marked}/{counts.total}
                  </span>
                )}
                {isDone && <Check size={11} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active section pane */}
      <div className="px-1 pb-32">
        {inlineError && (
          <div className="mb-3 rounded-md bg-accent-red/10 border border-accent-red/40 px-3 py-2 text-xs text-accent-red flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{inlineError}</span>
            <button onClick={() => setInlineError(null)} className="text-accent-red hover:underline">
              <X size={12} />
            </button>
          </div>
        )}

        {pageParts.length === 0 ? (
          <div className="py-16 text-center text-sm text-navy-400">
            {t('checklist.emptySection', 'No parts in this section for this vehicle class.')}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {pageParts.map((p) => (
                <PartRow
                  key={p.id}
                  part={p}
                  status={partStatus[p.id] || 'unmarked'}
                  defectsForPart={(defects || []).filter((d) => d.part === p.id)}
                  onMark={markPart}
                  onOpenDefect={openDefectSheet}
                />
              ))}
            </div>

            {remainingOnPage > 0 && (
              <button
                onClick={passRemainingOnPage}
                className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent-green/15 border border-accent-green/40 text-accent-green text-xs font-semibold hover:bg-accent-green/25 cursor-pointer"
              >
                <Check size={12} />
                {t('checklist.passRemainingFmt', { count: remainingOnPage, defaultValue: `Pass remaining ${remainingOnPage}` })}
              </button>
            )}

            {pageTotal > 1 && (
              <div className="mt-3 flex items-center justify-between text-[11px] text-navy-400">
                <button
                  disabled={activePage === 0}
                  onClick={() => setPageBySection((m) => ({ ...m, [activeSection]: Math.max(0, activePage - 1) }))}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-navy-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronLeft size={12} /> {t('checklist.prev', 'Prev')}
                </button>
                <span>{t('checklist.pageFmt', { page: activePage + 1, total: pageTotal, defaultValue: `Page ${activePage + 1} of ${pageTotal}` })}</span>
                <button
                  disabled={activePage >= pageTotal - 1}
                  onClick={() => setPageBySection((m) => ({ ...m, [activeSection]: Math.min(pageTotal - 1, activePage + 1) }))}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-navy-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  {t('checklist.next', 'Next')} <ChevronRight size={12} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sticky complete bar — only visible when 100% marked */}
      <AnimatePresence>
        {allMarked && onComplete && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-0 left-0 right-0 z-40 bg-navy-950/95 backdrop-blur border-t border-navy-800 px-4 py-3"
          >
            <div className="max-w-2xl mx-auto flex items-center gap-3">
              <span className="text-[11px] text-navy-400 hidden sm:inline">
                {t('checklist.allMarkedHint', 'All parts marked. Submit when ready.')}
              </span>
              <button
                onClick={onComplete}
                disabled={submitting}
                className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-accent-green text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 cursor-pointer shadow-lg shadow-accent-green/20"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {submitting
                  ? t('checklist.submitting', 'Submitting…')
                  : t('checklist.completeFmt', { marked: totalCount.marked, total: totalCount.total, defaultValue: `Complete inspection · ${totalCount.marked}/${totalCount.total}` })}
              </button>
            </div>
            {submitError && (
              <div className="mt-2 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-[11px] text-accent-red max-w-2xl mx-auto">
                {submitError}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Defect detail sheet — slides up from the bottom on chip tap */}
      <AnimatePresence>
        {sheetState && cat && (
          <DefectDetailSheet
            cat={cat}
            inspectionId={inspectionId}
            vehicleId={vehicleId}
            vehicleClass={vehicleClass}
            partId={sheetState.part}
            defectTypeId={sheetState.defectType}
            existingDefect={(defects || []).find(
              (d) => d.part === sheetState.part && d.defectType === sheetState.defectType,
            )}
            onCommitted={handleDefectCommitted}
            onRemoved={handleDefectRemoved}
            onClose={closeDefectSheet}
          />
        )}
      </AnimatePresence>
    </Shell>
  );
}


// ═════════════════════════════════════════════════════
// Shell — top header used by InspectionChecklist + its loading states.
// ═════════════════════════════════════════════════════
function Shell({ title, children, onClose, onBack }) {
  return (
    <div className="flex flex-col min-h-screen bg-navy-950">
      <div className="sticky top-0 z-30 bg-navy-950/95 backdrop-blur border-b border-navy-800 px-4 py-3 flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="text-navy-300 hover:text-white p-1 -ml-1 cursor-pointer"
            title="Back"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <h2 className="text-sm font-semibold text-white truncate flex-1">{title}</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-navy-300 hover:text-white p-1 -mr-1 cursor-pointer"
            title="Close"
          >
            <X size={18} />
          </button>
        )}
      </div>
      <div className="flex-1 px-4 sm:px-6 max-w-2xl w-full mx-auto">
        {children}
      </div>
    </div>
  );
}


// ═════════════════════════════════════════════════════
// PartRow — one part: icon + name + Pass/N/A buttons + chip strip.
// ═════════════════════════════════════════════════════
function PartRow({ part, status, defectsForPart, onMark, onOpenDefect }) {
  const isPass = status === 'pass';
  const isNa = status === 'na';
  const isDefect = status === 'defect';

  return (
    <div className={`rounded-lg border-2 p-3 transition-all ${
      isDefect ? 'border-accent-red/50 bg-accent-red/5'
        : isPass ? 'border-accent-green/40 bg-accent-green/5'
        : isNa ? 'border-navy-600 bg-navy-800/40'
        : 'border-navy-700 bg-navy-900/40'
    }`}>
      {/* Top row: icon + name + status pill + Pass/N/A buttons */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xl shrink-0">{part.icon || '🔧'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{part.label}</div>
          {isDefect && (
            <div className="text-[10px] text-accent-red font-semibold uppercase">
              {defectsForPart.length} defect{defectsForPart.length === 1 ? '' : 's'} logged
            </div>
          )}
          {isNa && <div className="text-[10px] text-navy-400 uppercase">N/A</div>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Pass / N/A buttons hide when in defect state — clearing
              defects is the only way to flip back to pass/N/A. */}
          {!isDefect && (
            <>
              <button
                onClick={() => onMark(part.id, isPass ? null : 'pass')}
                disabled={isPass && false /* TODO: support unpass via DELETE */}
                className={`w-9 h-9 rounded-full inline-flex items-center justify-center text-sm font-bold border transition-all cursor-pointer ${
                  isPass
                    ? 'bg-accent-green text-white border-accent-green'
                    : 'bg-navy-800 text-accent-green border-accent-green/40 hover:bg-accent-green/15'
                }`}
                title={isPass ? 'Marked as Pass' : 'Mark Pass'}
              >
                ✓
              </button>
              <button
                onClick={() => onMark(part.id, isNa ? null : 'na')}
                className={`px-2 h-9 rounded-full inline-flex items-center justify-center text-[10px] font-bold border transition-all cursor-pointer ${
                  isNa
                    ? 'bg-navy-600 text-white border-navy-600'
                    : 'bg-navy-800 text-navy-300 border-navy-600 hover:bg-navy-700'
                }`}
                title={isNa ? 'Marked as N/A' : 'Mark N/A'}
              >
                N/A
              </button>
            </>
          )}
        </div>
      </div>

      {/* Chip strip — every defect_type for this part on this vehicle.
          Selected chips (already-logged defects) are red filled; tap to
          edit/remove. Unselected chips are blue outlined; tap to add. */}
      {part.defectTypes && part.defectTypes.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
          {part.defectTypes.map((dt) => {
            const isLogged = defectsForPart.some((d) => d.defectType === dt.id);
            return (
              <button
                key={dt.id}
                onClick={() => onOpenDefect(part.id, dt.id)}
                className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-semibold border transition-all cursor-pointer ${
                  isLogged
                    ? 'bg-accent-red/20 border-accent-red text-accent-red'
                    : 'bg-navy-800/60 border-navy-600 text-navy-300 hover:border-accent-blue hover:text-accent-blue'
                }`}
              >
                <span>{dt.label}</span>
                {isLogged && <Check size={10} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ═════════════════════════════════════════════════════
// DefectDetailSheet — slide-up sheet (NOVABODY-style) for ADD or EDIT.
// Position pills + schema details + photo (mandatory if requires_photo)
// + notes. Single submit creates the defect via POST /defects, then
// PhotoUploader handles the (separate) photo upload.
// ═════════════════════════════════════════════════════
function DefectDetailSheet({
  cat,
  inspectionId,
  vehicleId,
  vehicleClass,
  partId,
  defectTypeId,
  existingDefect,
  onCommitted,
  onRemoved,
  onClose,
}) {
  const { t } = useTranslation('wizard');

  const part = useMemo(() => cat.parts.find((p) => p.id === partId), [cat, partId]);
  const defectType = useMemo(
    () => part?.defectTypes?.find((d) => d.id === defectTypeId),
    [part, defectTypeId],
  );

  const validPositions = defectType?.validPositions || [];
  const positionRequired = !!defectType?.positionRequired;
  const allowNullPosition = defectType?.allowNullPosition !== false;
  const requiresPhoto = defectType?.requiresPhoto !== false;  // default true
  const detailsSchema = defectType?.detailsSchema || {};

  const [position, setPosition] = useState(existingDefect?.position || '');
  const [notes, setNotes] = useState(existingDefect?.notes || '');
  const [details, setDetails] = useState(existingDefect?.details || {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Created defect id (after submit) — drives the photo uploader visibility.
  const [createdId, setCreatedId] = useState(existingDefect?.id || null);
  const [photoCount, setPhotoCount] = useState(existingDefect?.photos?.length || 0);

  const isEdit = !!existingDefect;
  const positionValid = positionRequired ? !!position : true;
  const canSubmit = positionValid && !submitting;
  // Once defect is created, photo gate (if required) blocks "Done".
  const photoSatisfied = !requiresPhoto || photoCount > 0;
  const canFinish = !!createdId && photoSatisfied;

  const submitDefect = async () => {
    setError(null);
    if (!part || !defectType) return;
    if (positionRequired && !position) {
      setError(t('checklist.sheet.positionRequired', 'Position is required.'));
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit) {
        // We don't have a PATCH for (part, defect_type, position) — those
        // are immutable in V2.2. Notes + details ARE patchable via PATCH
        // /defects/{id}. Skip the create call; just commit edits.
        await defectsApi.update(existingDefect.id, { notes: notes.trim() || null, details });
        setCreatedId(existingDefect.id);
        // For edit mode, parent already has the defect in its list; we
        // don't fire onCommitted so the optimistic state isn't doubled.
        onClose();
        return;
      }
      const created = await defectsApi.create({
        vehicleId,
        inspectionId,
        source: 'inspection',
        part: part.id,
        defectType: defectType.id,
        position: position || null,
        notes: notes.trim() || null,
        details,
      });
      setCreatedId(created.id);
      // If photo isn't required, we're done — commit and close.
      if (!requiresPhoto) {
        onCommitted({ ...created, partLabel: part.label, defectTypeLabel: defectType.label });
        onClose();
      }
    } catch (err) {
      setError(err instanceof APIError ? err.detail : (err?.message || 'Submit failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const finalize = () => {
    // Photo-gated commit. Build the enriched defect from what we know
    // since the create response doesn't include the photo metadata yet.
    onCommitted({
      id: createdId,
      part: part.id,
      partLabel: part.label,
      defectType: defectType.id,
      defectTypeLabel: defectType.label,
      position: position || null,
      notes: notes.trim() || null,
      photoCount,
    });
    onClose();
  };

  const removeDefect = async () => {
    if (!isEdit) return;
    if (!window.confirm(t('checklist.sheet.confirmRemove', 'Remove this defect from the inspection?'))) return;
    try {
      await defectsApi.delete(existingDefect.id);
      onRemoved(existingDefect.id, part.id);
    } catch (err) {
      setError(err?.detail || err?.message || 'Remove failed');
    }
  };

  // Photo uploader callback — track count for the gate.
  const handlePhotoChanged = (action) => {
    if (action === 'added') setPhotoCount((c) => c + 1);
    else if (action === 'deleted') setPhotoCount((c) => Math.max(0, c - 1));
  };

  if (!part || !defectType) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 280 }}
        className="absolute bottom-0 left-0 right-0 max-h-[92vh] bg-navy-950 border-t border-navy-700 rounded-t-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-navy-800 flex items-start gap-3 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-2xl shrink-0">{part.icon || '🔧'}</span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{part.label}</div>
              <div className="text-[11px] text-accent-red font-semibold">{defectType.label}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-navy-300 hover:text-white p-1 -mr-1 cursor-pointer shrink-0"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {error && (
            <div className="rounded-md bg-accent-red/10 border border-accent-red/40 px-3 py-2 text-xs text-accent-red flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Position — radio pills */}
          {validPositions.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-navy-300 mb-1.5 block">
                {t('checklist.sheet.position', 'Position')}
                {positionRequired && <span className="text-accent-red ml-1">*</span>}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {allowNullPosition && (
                  <button
                    onClick={() => setPosition('')}
                    disabled={!!createdId}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer ${
                      position === ''
                        ? 'bg-accent-blue/20 border-accent-blue text-accent-blue'
                        : 'bg-navy-800/60 border-navy-700 text-navy-300 hover:text-white'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {t('checklist.sheet.positionNone', '— (none) —')}
                  </button>
                )}
                {validPositions.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPosition(p.id)}
                    disabled={!!createdId}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer ${
                      position === p.id
                        ? 'bg-accent-blue/20 border-accent-blue text-accent-blue'
                        : 'bg-navy-800/60 border-navy-700 text-navy-300 hover:text-white'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Details — schema-driven, simplified to enums for v2.0 */}
          {Object.keys(detailsSchema?.properties || {}).length > 0 && (
            <div>
              <label className="text-xs font-semibold text-navy-300 mb-1.5 block">
                {t('checklist.sheet.details', 'Details')}
              </label>
              <div className="space-y-2">
                {Object.entries(detailsSchema.properties).map(([fieldName, def]) => (
                  <DetailField
                    key={fieldName}
                    fieldName={fieldName}
                    def={def}
                    value={details[fieldName]}
                    onChange={(v) => setDetails((d) => ({ ...d, [fieldName]: v }))}
                    disabled={!!createdId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">
              {t('checklist.sheet.notes', 'Notes (optional)')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!!createdId && !isEdit}
              rows={2}
              className="w-full rounded-md px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue resize-none disabled:opacity-60"
              placeholder={t('checklist.sheet.notesPlaceholder', 'Optional context the structured fields don’t cover…')}
            />
          </div>

          {/* Photo — appears AFTER defect is created. Mandatory if
              requires_photo. The PhotoUploader writes directly to MinIO
              via presigned URL + commits metadata to /defects/{id}/photos. */}
          {createdId && (
            <div>
              <label className="text-xs font-semibold text-navy-300 mb-1.5 block flex items-center gap-1.5">
                <Camera size={12} className="text-accent-blue" />
                {requiresPhoto
                  ? t('checklist.sheet.photoRequired', 'Photo (required)')
                  : t('checklist.sheet.photoOptional', 'Photo (optional)')}
              </label>
              <PhotoUploader
                parentKind="defect"
                parentId={createdId}
                category="damage"
                onChanged={handlePhotoChanged}
              />
              {requiresPhoto && photoCount === 0 && (
                <p className="mt-2 text-[11px] text-accent-gold">
                  {t('checklist.sheet.photoGateHint', 'Add at least one photo to finish reporting this defect.')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-navy-800 flex items-center justify-between gap-2 shrink-0 bg-navy-900/60">
          {isEdit ? (
            <button
              onClick={removeDefect}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-accent-red/40 bg-accent-red/10 text-accent-red text-xs font-semibold hover:bg-accent-red/20 cursor-pointer"
            >
              <Trash2 size={12} />
              {t('checklist.sheet.remove', 'Remove')}
            </button>
          ) : (
            <span aria-hidden className="w-1" />
          )}
          {createdId ? (
            <button
              onClick={finalize}
              disabled={!canFinish}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-green text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-accent-green/20"
            >
              <Check size={14} />
              {t('checklist.sheet.done', 'Done')}
            </button>
          ) : (
            <button
              onClick={submitDefect}
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {requiresPhoto
                ? t('checklist.sheet.continueToPhoto', 'Continue to photo')
                : t('checklist.sheet.saveDefect', 'Save defect')}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}


// Render one details-schema field. Supports the shapes our V2.2 catalog
// produces today (string with enum, integer, boolean, array of enums).
// Anything else falls back to a text input.
function DetailField({ fieldName, def, value, onChange, disabled }) {
  const label = fieldName.replace(/_/g, ' ');

  if (def?.enum) {
    return (
      <div>
        <label className="text-[11px] text-navy-400 mb-1 block">{label}</label>
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer disabled:opacity-60"
        >
          <option value="">— select —</option>
          {def.enum.map((v) => (
            <option key={v} value={v}>{String(v)}</option>
          ))}
        </select>
      </div>
    );
  }
  if (def?.type === 'integer' || def?.type === 'number') {
    return (
      <div>
        <label className="text-[11px] text-navy-400 mb-1 block">{label}</label>
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          min={def.minimum}
          max={def.maximum}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue disabled:opacity-60"
        />
      </div>
    );
  }
  if (def?.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="cursor-pointer"
        />
        <span>{label}</span>
      </label>
    );
  }
  return (
    <div>
      <label className="text-[11px] text-navy-400 mb-1 block">{label}</label>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="w-full rounded-md px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue disabled:opacity-60"
      />
    </div>
  );
}
