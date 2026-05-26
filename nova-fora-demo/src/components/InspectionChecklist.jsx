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
  dvicTemplate as dvicTemplateApi,
  inspections as inspectionsApi,
  defects as defectsApi,
  APIError,
} from '../api/client';
import PhotoUploader from './ui/PhotoUploader';

// User's preferred walkaround order (2026-05-15): General → In Cab →
// Front → Driver → Back → Passenger. Sections returned by /dvic-template
// are rendered in this order; sections returned by the template that
// aren't in this list (future class-specific ones) get appended at the
// end. Sections in this list that the template doesn't return for the
// active vehicle class are hidden.
const SECTION_ROUTE_ORDER = [
  'general',
  'in_cab',
  'front_side',
  'driver_side',
  'back_side',
  'passenger_side',
];
const SECTION_ROUTE_INDEX = Object.fromEntries(
  SECTION_ROUTE_ORDER.map((id, i) => [id, i]),
);

const PARTS_PER_PAGE = 5;

// Parts where reporting a defect doesn't need a photo. These are
// audible / sensory checks (parking brake hold, A/C blows cold, horn
// honks, alarms beep, heater warms up) — there's nothing to photograph
// even when defective. Overrides the catalog's per-defect_type
// requires_photo flag so the inspector can hit Done immediately after
// filling position + notes. Confirmed by Jorge on 2026-05-16.
const NO_PHOTO_PARTS = new Set([
  'parking_brake',
  'heater',
  'ac',
  'horn',
  'backup_alarm',
  'seatbelt_alarm',
]);

// Finer-grained exemptions when an entire part is photo-required but
// one specific defect_type isn't. Keyed as `${partId}/${defectTypeId}`.
// Example: interior_cleanliness/Dirty still wants a photo (proof of the
// mess), but interior_cleanliness/Odor obviously can't be photographed.
const NO_PHOTO_DEFECT_PAIRS = new Set([
  'interior_cleanliness/odor',
]);


// ═════════════════════════════════════════════════════
// Main checklist component
// ═════════════════════════════════════════════════════
export default function InspectionChecklist({
  inspectionId,
  vehicleId,
  vehicleClass,
  ownership,
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
  const [tpl, setTpl] = useState(null);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState(null);

  // Active section tab + active page within that section.
  const [activeSection, setActiveSection] = useState(SECTION_ROUTE_ORDER[0]);
  const [pageBySection, setPageBySection] = useState({});  // {sectionId: pageIdx}

  // Local copy of part marks. Seeded from the inspection detail on mount;
  // updated optimistically on mark/pass-remaining writes; rolled back on
  // server error.
  const [partMarks, setPartMarks] = useState({});  // {partValue: 'pass'|'na'}

  // Slide-up sheet state — null = closed; otherwise { part, defectType }
  const [sheetState, setSheetState] = useState(null);

  // Inline error band at the top of the active pane (pass/N/A failures).
  const [inlineError, setInlineError] = useState(null);

  // Whether the running defect log (above the sticky progress bar) is
  // expanded. Collapsed by default so the chip strip area isn't cramped
  // on a phone; tapping the "N defects" pill flips it open.
  const [defectsExpanded, setDefectsExpanded] = useState(false);

  // ─── Load catalog + DVIC template + initial part marks ────────
  // The catalog drives chip strips + defect detail (defect_types per part,
  // photo requirements, etc.). The DVIC template drives the section→parts
  // grouping (general / in_cab / front_side / driver_side / back_side /
  // passenger_side) so the checklist matches the canonical walkaround the
  // inspector already learned from DvicWizard.
  useEffect(() => {
    if (!vehicleClass) return undefined;
    let alive = true;
    setCatLoading(true);
    setCatError(null);
    Promise.all([
      catalogApi.load(vehicleClass),
      dvicTemplateApi.load(vehicleClass, ownership || null),
    ])
      .then(([catRes, tplRes]) => {
        if (!alive) return;
        setCat(catRes);
        setTpl(tplRes);
      })
      .catch((err) => {
        if (!alive) return;
        setCatError(err?.detail || err?.message || 'Failed to load catalog');
      })
      .finally(() => { if (alive) setCatLoading(false); });
    return () => { alive = false; };
  }, [vehicleClass, ownership]);

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
  // The DVIC template lists each (section, category, item) tuple — each
  // item references a part value plus a position (e.g. "driver_front",
  // "passenger_front"). Each section shows the DISTINCT parts the
  // template lists for it — driver_side and passenger_side intentionally
  // overlap (same wheel_nut, tire, side_mirror, etc.) because the
  // inspector walks both sides physically and needs to confirm each.
  //
  // partMarks is still keyed by part value, so a Pass on tire@driver_side
  // also marks tire@passenger_side as passed; per-position marking is a
  // follow-up that would need a (part, position) composite key.
  const partsBySection = useMemo(() => {
    if (!cat || !tpl) return {};
    const out = {};
    for (const section of tpl.sections || []) {
      const seen = new Set();  // dedupe within a single section only
      const objs = [];
      for (const cat0 of section.categories || []) {
        for (const item of cat0.items || []) {
          if (!item.part || seen.has(item.part)) continue;
          seen.add(item.part);
          const partObj = cat.parts.find((p) => p.id === item.part);
          if (partObj) {
            // Stamp the DVIC item's preset position onto the partObj so the
            // PartRow rendered in *this* section knows which position to
            // scope its defectsForPart + status against. Critical for
            // multi-section parts like body_damage where the SAME part_id
            // appears on Front / Back / Driver / Passenger cards: without
            // this, a defect logged on one side bleeds the 'defect' state
            // into all four cards.
            objs.push({ ...partObj, presetPosition: item.position || null });
          }
        }
      }
      out[section.id] = objs;
    }
    return out;
  }, [cat, tpl]);

  // Build the visible-tabs list. Route-order sections first (only those
  // that the template actually returned for this vehicle class), then
  // any non-route sections the template returned, appended at the end.
  const tabs = useMemo(() => {
    if (!tpl) return [];
    const byId = Object.fromEntries((tpl.sections || []).map((s) => [s.id, s]));
    const routeTabs = SECTION_ROUTE_ORDER
      .filter((id) => byId[id] && (partsBySection[id] || []).length > 0)
      .map((id) => ({ id, label: byId[id].label }));
    const extraTabs = (tpl.sections || [])
      .filter((s) => !(s.id in SECTION_ROUTE_INDEX))
      .filter((s) => (partsBySection[s.id] || []).length > 0)
      .map((s) => ({ id: s.id, label: s.label }));
    return [...routeTabs, ...extraTabs];
  }, [tpl, partsBySection]);

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

  // Section-scoped status. For section-pinned parts (presetPosition set),
  // a 'defect' anywhere else on the same part_id must NOT bleed in — the
  // card's own state depends on whether there's a defect with the matching
  // position. Used by sectionCounts + remainingOnPage so navigation tally
  // matches what the inspector actually sees on each card.
  const scopedStatusOf = (part) => {
    if (!part) return 'unmarked';
    if (part.presetPosition) {
      const hasDefectHere = (defects || []).some(
        (d) => d.part === part.id && d.position === part.presetPosition,
      );
      if (hasDefectHere) return 'defect';
      return partMarks[part.id] || 'unmarked';
    }
    return partStatus[part.id] || 'unmarked';
  };

  // If the active section is no longer in the visible tabs (e.g. it
  // had zero parts on this vehicle class), jump to the first visible
  // tab so the pane has something to render.
  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((t) => t.id === activeSection)) {
      setActiveSection(tabs[0].id);
    }
  }, [tabs, activeSection]);

  // Per-section counts (used in tab badges + complete bar).
  const sectionCounts = useMemo(() => {
    const out = {};
    for (const sys of tabs) {
      const parts = partsBySection[sys.id] || [];
      const total = parts.length;
      let marked = 0;
      for (const p of parts) {
        const s = scopedStatusOf(p);
        if (s && s !== 'unmarked') marked += 1;
      }
      out[sys.id] = { total, marked };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, partsBySection, partStatus, defects, partMarks]);

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
  const remainingOnPage = pageParts.filter((p) => {
    const s = scopedStatusOf(p);
    return !s || s === 'unmarked';
  }).length;

  // Section-complete + next-section computed once so the "continue" CTA
  // can render at the right moment. The CTA only shows when EVERY part
  // in the section is marked (not just the current page) — so an
  // inspector on page 2 of 3 doesn't see it until they finish page 3.
  const activeSectionCounts = sectionCounts[activeSection];
  const activeSectionDone =
    activeSectionCounts &&
    activeSectionCounts.total > 0 &&
    activeSectionCounts.marked >= activeSectionCounts.total;
  const currentTabIdx = tabs.findIndex((tab) => tab.id === activeSection);
  const nextSectionTab = activeSectionDone ? tabs[currentTabIdx + 1] : null;
  const activeSectionLabel = tabs[currentTabIdx]?.label || '';

  // ─── Swipe navigation (touch screens) ──────────────────────────
  // The inspector runs the wizard on their phone — swiping left/right
  // between pages is more natural than tapping Next/Prev. When a swipe
  // crosses the last/first page, we jump to the next/prev section so
  // the whole wizard feels like one long swipeable deck.
  //
  // Filter rules so taps on Pass/N/A chips don't fire navigation:
  //   - horizontal distance ≥ 60px
  //   - vertical drift ≤ 50px (preserve vertical scroll)
  //   - gesture duration ≤ 700ms (deliberate flick, not a slow drag)
  //   - defect sheet must NOT be open (sheet handles its own gestures)
  const touchStartRef = useRef(null);
  const goToPrev = () => {
    if (activePage > 0) {
      setPageBySection((m) => ({ ...m, [activeSection]: activePage - 1 }));
      return;
    }
    // First page → jump to previous section's last page.
    const idx = tabs.findIndex((t) => t.id === activeSection);
    if (idx <= 0) return;
    const prevSec = tabs[idx - 1].id;
    const prevParts = partsBySection[prevSec] || [];
    const prevPageTotal = Math.max(1, Math.ceil(prevParts.length / PARTS_PER_PAGE));
    setActiveSection(prevSec);
    setPageBySection((m) => ({ ...m, [prevSec]: prevPageTotal - 1 }));
  };
  const goToNext = () => {
    if (activePage < pageTotal - 1) {
      setPageBySection((m) => ({ ...m, [activeSection]: activePage + 1 }));
      return;
    }
    // Last page → jump to next section's first page.
    const idx = tabs.findIndex((t) => t.id === activeSection);
    if (idx < 0 || idx >= tabs.length - 1) return;
    const nextSec = tabs[idx + 1].id;
    setActiveSection(nextSec);
    setPageBySection((m) => ({ ...m, [nextSec]: 0 }));
  };
  // Jump directly to a section's first page and scroll the user back
  // to the top of the new section. Used by the "Continue to {section}"
  // CTA that appears when the active section flips to complete.
  const jumpToSection = (sectionId) => {
    setActiveSection(sectionId);
    setPageBySection((m) => ({ ...m, [sectionId]: 0 }));
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  const handleSwipeStart = (e) => {
    if (sheetState) return;
    const t = e.touches?.[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  };
  const handleSwipeEnd = (e) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || sheetState) return;
    const t = e.changedTouches?.[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.time;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 50 || dt > 700) return;
    if (dx < 0) goToNext(); else goToPrev();
  };

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
      .filter((p) => {
        const s = scopedStatusOf(p);
        return !s || s === 'unmarked';
      })
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
  // For body_damage we look up the DVIC item for the active section to
  // grab its preset position (FRONT / REAR / DRIVER_SIDE / PASSENGER_SIDE)
  // — the chip itself doesn't carry section context. We also pass
  // forceNew=true so each tap creates a fresh damage instance (instead of
  // the default "edit the existing one") and compute the next damage_seq
  // from defects already logged on this (part, position) so the unique
  // index (uq_defects_…) doesn't collide.
  const BODY_DAMAGE_PART = 'body_damage';
  const isMultiInstancePart = (partId) => partId === BODY_DAMAGE_PART;
  const findPresetPositionFor = (partId) => {
    if (!tpl) return null;
    const sec = (tpl.sections || []).find((s) => s.id === activeSection);
    if (!sec) return null;
    for (const cat0 of sec.categories || []) {
      for (const item of cat0.items || []) {
        if (item.part === partId && item.position) return item.position;
      }
    }
    return null;
  };
  const nextDamageSeq = (partId, position) => {
    const same = (defects || []).filter(
      (d) => d.part === partId && (d.position || null) === (position || null),
    );
    let max = 0;
    for (const d of same) {
      const seq = Number(d?.details?.damage_seq);
      if (Number.isFinite(seq) && seq > max) max = seq;
    }
    return max + 1;
  };
  const openDefectSheet = (part, defectType) => {
    if (isMultiInstancePart(part)) {
      const presetPosition = findPresetPositionFor(part);
      const damageSeq = nextDamageSeq(part, presetPosition);
      setSheetState({ part, defectType, forceNew: true, presetPosition, damageSeq });
      return;
    }
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
  // No template seeded for this vehicle class yet (e.g. electric_vehicle
  // as of 2026-05-15). Render a clear "no checklist" notice so the user
  // doesn't see a blank screen and can still close the wizard.
  if (!tpl?.sections?.length) {
    return (
      <Shell title={cat?.vehicleClassLabel || vehicleClass} onClose={closeHandler} onBack={onBack}>
        <div className="px-4 py-12 text-center text-sm text-navy-300 max-w-md mx-auto">
          <AlertCircle size={28} className="text-accent-amber mx-auto mb-3" />
          <p className="font-semibold text-white mb-2">
            {t('checklist.noTemplateTitle', 'No checklist for this vehicle yet')}
          </p>
          <p>
            {t('checklist.noTemplateBody', { label: cat?.vehicleClassLabel || vehicleClass, defaultValue: `The inspection template for ${cat?.vehicleClassLabel || vehicleClass} hasn't been published yet. Contact your admin or close this inspection.` })}
          </p>
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

      {/* Active section pane — touch swipe navigates pages/sections */}
      <div
        className="px-1 pb-32"
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
      >
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
              {pageParts.map((p) => {
                // When a part is pinned to a section position (e.g.
                // body_damage on Front Side carries presetPosition='front'),
                // scope both defectsForPart AND status by that position so
                // each section's card has independent state. Without
                // presetPosition (i.e., most parts), fall back to filtering
                // by part_id alone — keeps every other card behaving
                // exactly as before.
                const myDefects = (defects || []).filter((d) =>
                  d.part === p.id
                  && (!p.presetPosition || d.position === p.presetPosition)
                );
                const myStatus = myDefects.length > 0
                  ? 'defect'
                  : (partStatus[p.id] || 'unmarked');
                return (
                  <PartRow
                    key={p.id}
                    part={p}
                    status={myStatus}
                    defectsForPart={myDefects}
                    onMark={markPart}
                    onOpenDefect={openDefectSheet}
                  />
                );
              })}
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

            {/* Section-complete CTA — only when EVERY part in this
                section (across all pages) is marked. Animates in so the
                inspector notices that the section just flipped to done.
                If there's a next section, the button takes them there;
                if this is the last section, we point them to the sticky
                Submit button at the bottom. */}
            <AnimatePresence>
              {activeSectionDone && nextSectionTab && (
                <motion.button
                  key={`next-section-${nextSectionTab.id}`}
                  type="button"
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.25 }}
                  onClick={() => jumpToSection(nextSectionTab.id)}
                  className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-gradient-to-r from-accent-green to-accent-blue text-white text-sm font-bold shadow-lg shadow-accent-green/25 hover:opacity-90 active:opacity-80 cursor-pointer"
                >
                  <Check size={16} />
                  <span className="truncate">
                    {t('checklist.sectionDoneContinueFmt', {
                      section: nextSectionTab.label,
                      defaultValue: `${activeSectionLabel} complete — continue to ${nextSectionTab.label}`,
                    })}
                  </span>
                  <ChevronRight size={16} />
                </motion.button>
              )}
              {activeSectionDone && !nextSectionTab && !allMarked && (
                <motion.div
                  key="all-but-not-marked"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-4 px-4 py-3 rounded-xl bg-accent-green/15 border border-accent-green/40 text-accent-green text-sm font-semibold flex items-center justify-center gap-2 text-center"
                >
                  <Check size={16} />
                  {t('checklist.lastSectionDone', 'Last section complete — review other tabs above before submitting.')}
                </motion.div>
              )}
              {activeSectionDone && !nextSectionTab && allMarked && (
                <motion.div
                  key="all-marked-msg"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-4 px-4 py-3 rounded-xl bg-accent-green/20 border-2 border-accent-green text-accent-green text-sm font-bold flex items-center justify-center gap-2 text-center"
                >
                  <Check size={16} />
                  {t('checklist.allSectionsDone', 'All sections complete — tap Submit below to finalize the inspection.')}
                </motion.div>
              )}
            </AnimatePresence>

            {pageTotal > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  disabled={activePage === 0}
                  onClick={() => setPageBySection((m) => ({ ...m, [activeSection]: Math.max(0, activePage - 1) }))}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-navy-800 border border-navy-600 text-white text-sm font-semibold hover:bg-navy-700 hover:border-accent-blue/50 active:bg-navy-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <ChevronLeft size={16} /> {t('checklist.prev', 'Prev')}
                </button>
                <span
                  className="text-xs font-semibold text-navy-300 bg-navy-800/60 px-3 py-1.5 rounded-full flex flex-col items-center"
                  title={t('checklist.swipeHint', 'Swipe left/right on touch screens')}
                >
                  {t('checklist.pageFmt', { page: activePage + 1, total: pageTotal, defaultValue: `Page ${activePage + 1} of ${pageTotal}` })}
                  <span className="block sm:hidden text-[9px] text-navy-400 mt-0.5 leading-none">
                    ← {t('checklist.swipeHintShort', 'swipe')} →
                  </span>
                </span>
                <button
                  disabled={activePage >= pageTotal - 1}
                  onClick={() => setPageBySection((m) => ({ ...m, [activeSection]: Math.min(pageTotal - 1, activePage + 1) }))}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:opacity-90 active:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-opacity shadow-md shadow-accent-blue/20"
                >
                  {t('checklist.next', 'Next')} <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sticky bottom bar — progress is ALWAYS visible (any Pass / N/A /
          Defect bumps it up; defects count as inspected because the
          inspector still had to look at the part to log them). Above
          the bar sits the optional defects log: a collapsible list of
          every defect committed in this session that mirrors what
          DvicWizard used to show inline. The Submit button only slides
          in once allMarked flips true so the inspector doesn't see a
          disabled grey button taunting them. */}
      {onComplete && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-navy-950/95 backdrop-blur border-t border-navy-800">
          {/* Expanded defects log — slides up when the chip is tapped */}
          <AnimatePresence initial={false}>
            {defectsExpanded && defects && defects.length > 0 && (
              <motion.div
                key="defectslog"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-b border-navy-800"
              >
                <ul className="max-w-2xl mx-auto px-4 py-3 space-y-1.5 max-h-60 overflow-y-auto">
                  {defects.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-start gap-2 px-2.5 py-2 rounded-md border border-accent-red/30 bg-accent-red/5"
                    >
                      <span className="text-base shrink-0">{d.partIcon || '🔧'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white truncate">
                          <span className="font-semibold">{d.partLabel || d.part || '—'}</span>
                          {d.positionLabel && (
                            <span className="text-navy-400 font-normal"> ({d.positionLabel})</span>
                          )}
                        </div>
                        <div className="text-[11px] text-navy-300 truncate">
                          {d.defectTypeIcon} {d.defectTypeLabel || d.defectType || ''}
                        </div>
                      </div>
                      {onRemoveDefect && (
                        <button
                          onClick={() => onRemoveDefect(d.id, d.part)}
                          className="text-navy-400 hover:text-accent-red p-1 -mr-1 rounded shrink-0 cursor-pointer"
                          title={t('checklist.removeDefect', 'Remove defect')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="px-4 py-3">
            <div className="max-w-2xl mx-auto flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[11px] text-navy-300 font-semibold uppercase tracking-wide mb-1">
                  <span>{t('checklist.progressLabel', 'Progress')}</span>
                  <span className="text-white">{totalCount.marked}/{totalCount.total}</span>
                  {defects && defects.length > 0 && (
                    <button
                      onClick={() => setDefectsExpanded((v) => !v)}
                      className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-accent-red/40 bg-accent-red/10 text-accent-red text-[10px] uppercase tracking-wide hover:bg-accent-red/20 cursor-pointer"
                    >
                      <AlertCircle size={11} />
                      {t('checklist.defectsCountFmt', { count: defects.length, defaultValue: `${defects.length} defect${defects.length === 1 ? '' : 's'}` })}
                      {defectsExpanded
                        ? <ChevronLeft size={11} className="rotate-90" />
                        : <ChevronRight size={11} className="rotate-90" />}
                    </button>
                  )}
                </div>
                <div className="h-1.5 rounded-full bg-navy-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${allMarked ? 'bg-accent-green' : 'bg-accent-blue'}`}
                    style={{ width: totalCount.total > 0 ? `${(totalCount.marked / totalCount.total) * 100}%` : '0%' }}
                  />
                </div>
              </div>
              <AnimatePresence>
                {allMarked && (
                  <motion.button
                    key="submit"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 22 }}
                    onClick={onComplete}
                    disabled={submitting}
                    className="shrink-0 inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-accent-green text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 cursor-pointer shadow-lg shadow-accent-green/30"
                  >
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    {submitting
                      ? t('checklist.submitting', 'Submitting…')
                      : t('checklist.submitReady', 'Submit inspection')}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            {submitError && (
              <div className="mt-2 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-[11px] text-accent-red max-w-2xl mx-auto">
                {submitError}
              </div>
            )}
          </div>
        </div>
      )}

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
            existingDefect={
              // forceNew suppresses the "edit existing" branch so each tap
              // creates a fresh instance (body_damage uses this).
              sheetState.forceNew ? null : (defects || []).find(
                (d) => d.part === sheetState.part && d.defectType === sheetState.defectType,
              )
            }
            presetPosition={sheetState.presetPosition || null}
            damageSeq={sheetState.damageSeq || null}
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
    <div className="fixed inset-0 z-[60] flex flex-col bg-navy-950 overflow-y-auto">
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
      isDefect ? 'border-accent-red bg-accent-red/15 shadow-md shadow-accent-red/20'
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

      {/* Multi-instance "Add another" affordance — body_damage only.
          Once at least one damage has been logged on this card, surface
          explicit "+ Add Scratch" / "+ Add Dent" buttons so the inspector
          knows they can keep stacking damages on the same panel without
          creating extra cards. (The chip strip above ALSO triggers a new
          instance on tap, but the buttons here are the discoverable
          affordance — chips look like edit-toggles to many users.) */}
      {part.id === 'body_damage' && defectsForPart.length > 0
        && part.defectTypes && part.defectTypes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-accent-red/30 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-navy-400 font-semibold mr-1">
            Add another:
          </span>
          {part.defectTypes.map((dt) => (
            <button
              key={`add-${dt.id}`}
              onClick={() => onOpenDefect(part.id, dt.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border border-dashed border-accent-blue/60 bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 cursor-pointer"
            >
              <span className="text-sm leading-none">+</span>
              <span>{dt.label}</span>
            </button>
          ))}
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
  // For section-pinned parts (body_damage), the parent passes the
  // DVIC item's preset position so we save the right position (FRONT /
  // REAR / DRIVER_SIDE / PASSENGER_SIDE) without showing a picker.
  presetPosition = null,
  // For multi-instance parts, the parent computes the next damage_seq
  // so each new instance gets a unique slot in the COALESCE-on-details
  // unique index without colliding with previously-saved rows.
  damageSeq = null,
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
  // Override: sensory/audible parts (parking brake, A/C, horn, etc.)
  // never need a photo, plus specific (part, defect_type) pairs like
  // interior_cleanliness/Odor where the part overall can be
  // photographed but this defect_type can't.
  const requiresPhoto = (
    NO_PHOTO_PARTS.has(partId)
    || NO_PHOTO_DEFECT_PAIRS.has(`${partId}/${defectTypeId}`)
  )
    ? false
    : defectType?.requiresPhoto !== false;  // default true
  const detailsSchema = defectType?.detailsSchema || {};

  const [position, setPosition] = useState(
    existingDefect?.position || presetPosition || ''
  );
  // Hide the position picker when the parent already pinned a position
  // (true for body_damage which derives position from the active section).
  const positionLockedByPreset = !!presetPosition && !existingDefect;
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
      // Inject damage_seq into details for multi-instance parts so the
      // (vehicle, insp, part, position, type, details.damage_seq) unique
      // index has a distinct slot per damage on the same panel.
      const finalDetails = damageSeq != null
        ? { ...details, damage_seq: damageSeq }
        : details;
      const created = await defectsApi.create({
        vehicleId,
        inspectionId,
        source: 'inspection',
        part: part.id,
        defectType: defectType.id,
        position: position || null,
        notes: notes.trim() || null,
        details: finalDetails,
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

          {/* Position — radio pills. Hidden when the parent pinned a
              preset position (body_damage uses this — the section IS the
              position so a picker would only add a redundant tap). */}
          {validPositions.length > 0 && !positionLockedByPreset && (
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
                // Auto-pop the camera the moment the uploader mounts so
                // the inspector goes Tap chip → fill fields → Save →
                // Camera, instead of having an extra "Add photo" tap in
                // between. Only when the photo is required AND nothing
                // is uploaded yet (edit-mode re-opens shouldn't surprise
                // an inspector who already attached photos previously).
                autoOpenOnEmpty={requiresPhoto && !existingDefect?.photos?.length}
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
