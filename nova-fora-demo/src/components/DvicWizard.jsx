/**
 * DvicWizard — section-first DVIC checklist (matches Amazon DVIC PDFs).
 *
 * Steps:
 *   1. Section          — 6 tiles (General / Front / Back / Driver / Passenger / In Cab)
 *   2. Item             — verbatim PDF descriptions grouped by part_category
 *   3. Position         — only if the item's rule has multiple valid_positions
 *                          AND the template item didn't pre-set a position
 *   4. Details form     — only if the item.requires_details
 *   5. Review           — preview classification + group + commit
 *   6. Photo gate       — mandatory photo before save
 *
 * Backend wiring:
 *   - GET /dvic-template?vehicle_class=X — verbatim PDF flow per class
 *   - POST /defects                       — with vehicleId + inspectionId + source
 *   - DELETE /defects/{id}                — rollback when no photo uploaded
 *   - POST /defects/{id}/photos via PhotoUploader
 *
 * Each (rule, applicability) → display data joined server-side, so the
 * wizard receives one flat tree per vehicle_class with all the labels,
 * thresholds, and JSON Schemas it needs to render.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation, Trans } from 'react-i18next';
import {
  ArrowLeft, ArrowRight, X, Check, AlertCircle, Loader2,
  ChevronRight, ClipboardList, Trash2, Send, Camera, Lock,
} from 'lucide-react';
import {
  dvicTemplate as dvicTemplateApi,
  defects as defectsApi,
  APIError,
} from '../api/client';
import PhotoUploader from './ui/PhotoUploader';

// ─────────────────────────────────────────────────────
// Inspection route — enforced section order across every vehicle class.
//
// The inspector must walk the vehicle in a predictable path so no zone
// gets skipped: paperwork first (general), then climb into the cab,
// then circle the truck starting from the front and ending on the
// passenger side. Each section unlocks the next; backwards revisits
// stay open so the inspector can correct a missed item.
// ─────────────────────────────────────────────────────
const SECTION_ROUTE = [
  'general',
  'in_cab',
  'front_side',
  'driver_side',
  'back_side',
  'passenger_side',
];
const SECTION_ROUTE_INDEX = Object.fromEntries(
  SECTION_ROUTE.map((id, i) => [id, i]),
);

/**
 * Sort the template's sections into the canonical inspection route.
 * Anything not in the route (e.g. a future class-specific section like
 * `ev_powertrain` or `air_brake`) appears AFTER the routed six in the
 * order the backend returned, since gating doesn't apply to it.
 */
function orderSectionsByRoute(sections) {
  const known = [];
  const extras = [];
  for (const s of sections || []) {
    if (s.id in SECTION_ROUTE_INDEX) known.push(s);
    else extras.push(s);
  }
  known.sort(
    (a, b) => SECTION_ROUTE_INDEX[a.id] - SECTION_ROUTE_INDEX[b.id],
  );
  return [...known, ...extras];
}


/**
 * Props:
 *   inspectionId, vehicleId, vehicleClass (required)
 *   ownership              — 'branded' | 'owner' | 'rented' (default 'branded').
 *                            Owner/Rented vans hide DOT decal + Prime decal items.
 *   onCommitted(defect)    — fires after each successful POST + photo
 *   defects                — running list of committed defects
 *   onRemoveDefect(defect) — delete handler for the inline list
 *   onComplete()           — submit the entire inspection
 *   submitting, submitError — bubbled from the parent
 *   onClose() / onCancel() — close the entire wizard
 *   onBack()               — go back to the parent's previous step
 */
export default function DvicWizard({
  inspectionId,
  vehicleId,
  vehicleClass,
  ownership = 'amazon_owned',
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
  const handleCloseAction = onClose || onCancel;

  // Step 1..6
  const [step, setStep] = useState(1);

  // Sections the inspector has opened during this session. Drives the
  // route-gating in step 1: a section is unlocked iff every section that
  // precedes it in SECTION_ROUTE has been visited. The set is intentionally
  // local to one inspection — restarting the wizard resets the route.
  const [visitedSections, setVisitedSections] = useState(() => new Set());

  // Selections
  const [section, setSection] = useState(null);   // section node from template
  const [item, setItem] = useState(null);         // template item (rule × position)
  const [position, setPosition] = useState(null); // PositionInfo when picker needed
  const [details, setDetails] = useState({});
  const [notes, setNotes] = useState('');

  // Template
  const [tpl, setTpl] = useState(null);
  const [tplLoading, setTplLoading] = useState(true);
  const [tplError, setTplError] = useState(null);

  // Per-defect commit state
  const [defectSubmitting, setDefectSubmitting] = useState(false);
  const [defectSubmitError, setDefectSubmitError] = useState(null);

  // Photo-gate state
  const [committedDefect, setCommittedDefect] = useState(null);
  const [photoCount, setPhotoCount] = useState(0);

  // Stable handler for PhotoGateStep → PhotoUploader.
  //
  // STABLE-CALLBACK FIX (2026-05-12): a previous inline lambda re-created the
  // callback every render, which (in combination with the array-default-prop
  // pattern inside PhotoUploader) historically caused photo upload to bounce
  // the inspector back to the DSP picker. PhotoUploader's effect on
  // `initialPhotosKey` already neutralizes the prop-identity churn, but
  // keeping the callback stable is the cheap insurance.
  const handlePhotoChanged = useCallback((action) => {
    if (action === 'added') setPhotoCount((c) => c + 1);
    else if (action === 'deleted') setPhotoCount((c) => Math.max(0, c - 1));
  }, []);

  // Load template — ownership filters branded-only items (DOT/Prime decal)
  useEffect(() => {
    let alive = true;
    setTplLoading(true);
    dvicTemplateApi.load(vehicleClass, ownership)
      .then((res) => alive && setTpl(res))
      .catch((err) => alive && setTplError(
        err instanceof APIError ? err.detail : (err.message || 'Failed to load template')
      ))
      .finally(() => alive && setTplLoading(false));
    return () => { alive = false; };
  }, [vehicleClass, ownership]);

  // ─── Derived ────────────────────────────────────────
  // Position picker is needed when:
  //   - template item didn't pre-set a position (item.position is null), AND
  //   - the rule's applicability has at least one valid position AND > 1 option
  const needsPositionPicker = !!item
    && !item.position
    && (item.validPositions?.length || 0) > 1;
  const requiresDetails = !!item?.requiresDetails;

  // Step nav helpers — auto-skip steps the current pick doesn't need.
  const canGoNext = (s) => {
    switch (s) {
      case 1: return !!section;
      case 2: return !!item;
      case 3: return !needsPositionPicker || !!position;
      case 4: return validateDetails(
        item, details, vehicleClass, item?.position || position?.id || null,
      );
      case 5: return true;
      default: return false;
    }
  };

  const goNext = () => {
    let next = step + 1;
    if (next === 3 && !needsPositionPicker) next = 4;
    if (next === 4 && !requiresDetails) next = 5;
    setStep(next);
  };

  const goBack = () => {
    let prev = step - 1;
    if (prev === 4 && !requiresDetails) prev = 3;
    if (prev === 3 && !needsPositionPicker) prev = 2;
    if (prev < 1) prev = 1;
    // Reset only when leaving the item entirely. handleItemPick resets
    // details/position when a new item is chosen.
    if (prev <= 1) { setItem(null); setPosition(null); setDetails({}); }
    setStep(prev);
  };

  // ─── Tile-pick handlers ─────────────────────────────
  const handleSectionPick = (s) => {
    setSection(s);
    setItem(null);
    setPosition(null);
    setDetails({});
    setStep(2);
    // Mark as visited so the next section in SECTION_ROUTE unlocks when
    // the inspector returns to step 1. Sections outside the route are
    // still tracked so the visual "visited" tick shows up on them too.
    setVisitedSections((prev) => {
      if (prev.has(s.id)) return prev;
      const next = new Set(prev);
      next.add(s.id);
      return next;
    });
  };

  const handleItemPick = (it) => {
    setItem(it);
    // Pre-populate details with JSON Schema defaults so single-field forms
    // (e.g., warning_lamp.state="on") can advance without user input.
    setDetails(initialDetailsFromSchema(it));
    // If rule has exactly one valid position and template didn't pre-set,
    // auto-pick it.
    const positions = it.validPositions || [];
    if (!it.position && positions.length === 1) {
      // fabricate a {id, label} from the only valid position string
      setPosition({ id: positions[0], label: positions[0].replace(/_/g, ' ') });
    } else {
      setPosition(null);
    }
    // Walk skip-chain
    const itNeedsPositionPicker = !it.position && positions.length > 1;
    let next = 3;
    if (next === 3 && !itNeedsPositionPicker) next = 4;
    if (next === 4 && !it.requiresDetails) next = 5;
    setStep(next);
  };

  const handlePositionPick = (p) => {
    setPosition(p);
    let next = 4;
    if (next === 4 && !requiresDetails) next = 5;
    setStep(next);
  };

  const resetForNextDefect = () => {
    setSection(null);
    setItem(null);
    setPosition(null);
    setDetails({});
    setNotes('');
    setDefectSubmitError(null);
    setCommittedDefect(null);
    setPhotoCount(0);
    setStep(1);
  };

  // ─── Commit ──────────────────────────────────────────
  const handleCommitDefect = async () => {
    if (!item) return;
    setDefectSubmitting(true);
    setDefectSubmitError(null);
    try {
      // Resolve final position: pre-set by template > picker pick
      const finalPosition = item.position || position?.id || null;

      const body = {
        vehicleId,
        inspectionId,
        source: 'inspection',
        part: item.part,
        defectType: item.defectType,
        details: details || {},
      };
      if (finalPosition) body.position = finalPosition;
      if (notes.trim()) body.notes = notes.trim();

      const created = await defectsApi.create(body);
      const enriched = {
        ...created,
        partLabel: item.partLabel,
        partIcon: item.partIcon,
        positionLabel: position?.label || item.positionLabel || null,
        defectTypeLabel: item.defectTypeLabel,
        defectTypeIcon: item.defectTypeIcon,
        classification: item.classification,
        group: item.group,
        description: item.description,
        details: details || {},
      };

      // Sensory/audio defects (odor, brake noise, no AC, etc.) skip the
      // photo gate — commit straight to the parent and reset for next.
      if (item.photoRequired === false) {
        onCommitted?.({ ...enriched, photoCount: 0 });
        resetForNextDefect();
        return;
      }

      setCommittedDefect(enriched);
      setPhotoCount(0);
      setStep(6);
    } catch (err) {
      setDefectSubmitError(err instanceof APIError ? err.detail : 'Submit failed');
    } finally {
      setDefectSubmitting(false);
    }
  };

  const handleFinalizeDefectWithPhoto = () => {
    if (!committedDefect || photoCount < 1) return;
    onCommitted?.({ ...committedDefect, photoCount });
    resetForNextDefect();
  };

  const handleRollbackDefect = async (nextStep) => {
    const id = committedDefect?.id;
    if (id) {
      try {
        await defectsApi.delete(id);
      } catch (err) {
        console.warn('rollback defect failed', err);
      }
    }
    setCommittedDefect(null);
    setPhotoCount(0);
    setDefectSubmitError(null);
    setStep(nextStep);
  };

  // ─── Render guards ──────────────────────────────────
  if (tplLoading) {
    return (
      <Shell title={t('dvic.shellLoading')} onCancel={handleCloseAction}>
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="text-accent-blue animate-spin" />
        </div>
      </Shell>
    );
  }

  if (tplError) {
    return (
      <Shell title={t('dvic.shellLoadError')} onCancel={handleCloseAction}>
        <div className="px-4 py-12 text-center text-sm text-navy-300">
          <AlertCircle size={28} className="text-accent-red mx-auto mb-3" />
          <p>{tplError}</p>
        </div>
      </Shell>
    );
  }

  // Empty template (e.g. EV / Box Truck pending PDFs) — friendly empty state.
  if (!tpl?.sections?.length) {
    return (
      <Shell title={t('dvic.shellNoTemplateTitle', { label: tpl?.vehicleClassLabel || vehicleClass })} onCancel={handleCloseAction}>
        <div className="px-4 py-12 max-w-md mx-auto text-center">
          <ClipboardList size={32} className="text-navy-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-white mb-2">
            {t('dvic.shellNoTemplateHeading')}
          </h3>
          <p className="text-sm text-navy-300 mb-4">
            {t('dvic.shellNoTemplateBodyPart1')}{' '}
            <span className="text-white font-mono">{tpl?.vehicleClassLabel || vehicleClass}</span>
            {t('dvic.shellNoTemplateBodyPart2')}
          </p>
          <CommittedDefectsList defects={defects} onRemove={onRemoveDefect} />
        </div>
      </Shell>
    );
  }

  const topBackHandler = step === 1
    ? (onBack || null)
    : step === 6
      ? null
      : goBack;

  const topCloseHandler = (step === 6 && committedDefect)
    ? async () => {
        if (window.confirm(t('dvic.discardWithoutPhotoAndClose'))) {
          await handleRollbackDefect(1);
          handleCloseAction?.();
        }
      }
    : handleCloseAction;

  return (
    <Shell
      title={step === 1
        ? t('dvic.shellTitleStep1', { label: tpl.vehicleClassLabel })
        : step === 6
          ? t('dvic.shellTitlePhoto', { label: tpl.vehicleClassLabel })
          : t('dvic.shellTitleAddDefect', { label: tpl.vehicleClassLabel })}
      step={step}
      totalSteps={6}
      onCancel={topCloseHandler}
      onBack={topBackHandler}
    >
      <div className="px-4 sm:px-6 pt-3 pb-24 max-w-2xl mx-auto">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <Pane key="1">
              <SectionPicker
                sections={orderSectionsByRoute(tpl.sections)}
                value={section}
                visited={visitedSections}
                onChange={handleSectionPick}
              />
              <CommittedDefectsList
                defects={defects}
                onRemove={onRemoveDefect}
              />
              {submitError && (
                <div className="mt-4 rounded-md bg-accent-red/10 border border-accent-red/30 px-3 py-2 text-xs text-accent-red flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}
            </Pane>
          )}
          {step === 2 && section && (
            <Pane key="2">
              <ItemPicker
                section={section}
                value={item}
                onChange={handleItemPick}
              />
            </Pane>
          )}
          {step === 3 && item && needsPositionPicker && (
            <Pane key="3">
              <PositionPicker
                positions={item.validPositions || []}
                value={position}
                onChange={handlePositionPick}
              />
            </Pane>
          )}
          {step === 4 && item && requiresDetails && (
            <Pane key="4">
              <DetailsForm
                item={item}
                details={details}
                vehicleClass={vehicleClass}
                positionId={item.position || position?.id || null}
                onChange={setDetails}
              />
            </Pane>
          )}
          {step === 5 && item && (
            <Pane key="5">
              <ReviewStep
                item={item}
                position={position}
                details={details}
                notes={notes}
                onNotesChange={setNotes}
                submitError={defectSubmitError}
              />
            </Pane>
          )}
          {step === 6 && committedDefect && (
            <Pane key="6">
              <PhotoGateStep
                defect={committedDefect}
                photoCount={photoCount}
                onPhotoChanged={handlePhotoChanged}
              />
            </Pane>
          )}
        </AnimatePresence>
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-navy-800 bg-navy-950/95 backdrop-blur px-4 py-3 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          {step === 1 ? (
            onBack ? (
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-navy-700 text-navy-300 hover:text-white hover:border-navy-600 cursor-pointer text-sm"
              >
                <ArrowLeft size={14} /> {t('dvic.footer.back')}
              </button>
            ) : (
              <span className="w-[80px]" aria-hidden />
            )
          ) : step === 6 ? (
            <button
              onClick={() => {
                if (window.confirm(t('dvic.discardWithoutPhoto'))) {
                  handleRollbackDefect(5);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/20 cursor-pointer text-sm font-semibold"
            >
              <X size={14} /> {t('dvic.footer.discard')}
            </button>
          ) : (
            <button
              onClick={goBack}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-navy-700 text-navy-300 hover:text-white hover:border-navy-600 cursor-pointer text-sm"
            >
              <ArrowLeft size={14} /> {t('dvic.footer.back')}
            </button>
          )}

          {step === 1 && onComplete && (() => {
            // The inspector must have walked all six SECTION_ROUTE sections
            // before they can submit. Computed inline so it reuses the
            // same visited Set the picker locks on — the two views can't
            // get out of sync. Sections outside the route (e.g.
            // class-specific add-ons) are NOT required.
            const missingRoute = SECTION_ROUTE.filter(
              (id) => !visitedSections.has(id),
            );
            const routeIncomplete = missingRoute.length > 0;
            const routeBlocked = routeIncomplete;
            const nextMissingLabel = (() => {
              if (!routeIncomplete || !tpl) return null;
              const nextId = missingRoute[0];
              const sec = (tpl.sections || []).find((s) => s.id === nextId);
              return sec?.label || nextId;
            })();
            return (
              <button
                onClick={onComplete}
                disabled={submitting || routeBlocked}
                title={routeBlocked
                  ? t('dvic.footer.completeBlockedTooltipFmt', {
                      count: missingRoute.length,
                      next: nextMissingLabel,
                      defaultValue: `${missingRoute.length} section${missingRoute.length === 1 ? '' : 's'} still pending — start with ${nextMissingLabel}`,
                    })
                  : undefined}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-accent-green text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm shadow-lg shadow-accent-green/20"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {submitting
                  ? t('dvic.footer.submitting')
                  : routeBlocked
                    ? t('dvic.footer.completeBlockedFmt', {
                        count: missingRoute.length,
                        defaultValue: `${missingRoute.length} section${missingRoute.length === 1 ? '' : 's'} left`,
                      })
                    : (defects.length > 0
                        ? t('dvic.footer.completeInspectionWithCount', { count: defects.length })
                        : t('dvic.footer.completeInspection'))}
              </button>
            );
          })()}
          {step > 1 && step < 5 && (
            <button
              onClick={goNext}
              disabled={!canGoNext(step)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
            >
              {t('dvic.footer.next')} <ArrowRight size={14} />
            </button>
          )}
          {step === 5 && (
            <button
              onClick={handleCommitDefect}
              disabled={defectSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer text-sm"
            >
              {defectSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              {defectSubmitting ? t('dvic.footer.saving') : t('dvic.footer.continueToPhoto')}
            </button>
          )}
          {step === 6 && (
            <button
              onClick={handleFinalizeDefectWithPhoto}
              disabled={photoCount < 1}
              title={photoCount < 1 ? t('dvic.footer.uploadAtLeastOneTip') : ''}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-green text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
            >
              <Check size={14} />
              {photoCount < 1
                ? t('dvic.footer.uploadAPhotoToSave')
                : (photoCount > 1
                    ? t('dvic.footer.saveDefectWithCount', { count: photoCount })
                    : t('dvic.footer.saveDefect'))}
            </button>
          )}
        </div>
      </div>
    </Shell>
  );
}


// ═════════════════════════════════════════════════════
// Step 6 — Photo gate (mandatory)
// ═════════════════════════════════════════════════════
function PhotoGateStep({ defect, photoCount, onPhotoChanged }) {
  const { t } = useTranslation('wizard');
  const positionLabel = defect.positionLabel || '';
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-navy-700 bg-navy-900/60 p-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl shrink-0">{defect.partIcon || '🔧'}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white">
              {defect.partLabel}
              {positionLabel && (
                <span className="text-navy-400 font-normal"> ({positionLabel})</span>
              )}
            </div>
            <div className="text-xs text-navy-300">
              {defect.defectTypeIcon} {defect.defectTypeLabel}
            </div>
            {defect.description && (
              <p className="text-[11px] text-navy-400 italic mt-1 line-clamp-2">"{defect.description}"</p>
            )}
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-navy-500 font-mono">{defect.id}</span>
              {defect.classification && (
                <SeverityBadge classification={defect.classification} />
              )}
              {defect.group && (
                <span className="text-[9px] uppercase tracking-wide font-bold text-accent-blue/80">
                  {defect.group}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={`rounded-lg border-2 px-3 py-2.5 flex items-start gap-2 ${
        photoCount >= 1
          ? 'border-accent-green/40 bg-accent-green/10'
          : 'border-accent-orange/40 bg-accent-orange/10'
      }`}>
        {photoCount >= 1 ? (
          <Check size={16} className="text-accent-green shrink-0 mt-0.5" />
        ) : (
          <AlertCircle size={16} className="text-accent-orange shrink-0 mt-0.5" />
        )}
        <div className="text-xs">
          <div className="font-semibold text-white mb-0.5">
            {photoCount >= 1
              ? t('dvic.photoGate.ready', { count: photoCount })
              : t('dvic.photoGate.required')}
          </div>
          <p className="text-navy-300">
            {photoCount >= 1
              ? t('dvic.photoGate.readyHint')
              : t('dvic.photoGate.requiredHint')}
          </p>
        </div>
      </div>

      <PhotoUploader
        parentKind="defect"
        parentId={defect.id}
        category="damage"
        onChanged={onPhotoChanged}
      />

      <p className="text-[11px] text-navy-500 italic">
        {t('dvic.photoGate.tip')}
      </p>
    </div>
  );
}


// ═════════════════════════════════════════════════════
// Committed defects list (step 1 inline)
// ═════════════════════════════════════════════════════
function CommittedDefectsList({ defects, onRemove }) {
  const { t } = useTranslation('wizard');
  if (!defects || defects.length === 0) {
    return (
      <div className="mt-6 px-3 py-4 rounded-lg border border-dashed border-navy-700 bg-navy-900/30 text-center">
        <p className="text-[11px] text-navy-400">
          {t('dvic.committedList.emptyPart1')}{' '}
          <span className="text-accent-green font-semibold">{t('dvic.footer.completeInspection')}</span>{' '}
          {t('dvic.committedList.emptyPart2')}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2">
        <ClipboardList size={14} className="text-accent-blue" />
        <h4 className="text-xs font-semibold text-white">
          {t('dvic.committedList.headingFmt', { count: defects.length })}
        </h4>
      </div>
      <ul className="space-y-1.5">
        {defects.map((d) => (
          <li
            key={d.id}
            className="flex items-start gap-2 px-2.5 py-2 rounded-md border border-navy-700/60 bg-navy-900/40"
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
                {d.defectTypeIcon} {d.defectTypeLabel || ''}
              </div>
              {(d.classification || d.group) && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  {d.classification && <SeverityBadge classification={d.classification} />}
                  {d.group && (
                    <span className="text-[9px] uppercase tracking-wide font-bold text-accent-blue/80">
                      {d.group}
                    </span>
                  )}
                </div>
              )}
            </div>
            {onRemove && (
              <button
                onClick={() => onRemove(d)}
                className="text-navy-400 hover:text-accent-red p-1 -mr-1 rounded shrink-0"
                title={t('dvic.committedList.removeTitle')}
              >
                <Trash2 size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}


// ═════════════════════════════════════════════════════
// Severity badge
// ═════════════════════════════════════════════════════
function SeverityBadge({ classification }) {
  const styles = {
    Sev1: 'bg-accent-red/15 text-accent-red border-accent-red/40',
    Sev2: 'bg-accent-orange/15 text-accent-orange border-accent-orange/40',
    Sev3: 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/40',
    ULC: 'bg-accent-red/30 text-white border-accent-red font-bold',
    Advisory: 'bg-navy-700/40 text-navy-200 border-navy-600',
  };
  const cls = styles[classification] || 'bg-navy-700/40 text-navy-300 border-navy-600';
  return (
    <span className={`inline-block px-1.5 py-[1px] rounded text-[9px] uppercase tracking-wide font-semibold border ${cls}`}>
      {classification}
    </span>
  );
}


// ═════════════════════════════════════════════════════
// Shell + Pane
// ═════════════════════════════════════════════════════
function Shell({ title, children, onCancel, onBack, step, totalSteps }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-navy-950 flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-navy-800 bg-navy-900/80 backdrop-blur">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <button onClick={onBack} className="text-navy-300 hover:text-white p-1 -ml-1 rounded">
              <ArrowLeft size={18} />
            </button>
          )}
          <ClipboardList size={16} className="text-accent-blue shrink-0" />
          <h2 className="text-sm sm:text-base font-semibold text-white truncate">{title}</h2>
          {step && totalSteps && (
            <span className="text-[10px] text-navy-400 font-mono shrink-0">
              {step}/{totalSteps}
            </span>
          )}
        </div>
        <button onClick={onCancel} className="text-navy-300 hover:text-white p-1.5 -mr-1 rounded">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </motion.div>
  );
}

function Pane({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.15 }}
    >
      {children}
    </motion.div>
  );
}


// ═════════════════════════════════════════════════════
// Step 1 — Section picker (6 tiles in canonical inspection route)
// ═════════════════════════════════════════════════════
function SectionPicker({ sections, value, visited, onChange }) {
  const { t } = useTranslation('wizard');
  // The next route-section the inspector should open. Anything to its
  // right in SECTION_ROUTE is locked until this one is visited. Computed
  // from the visited set so revisits stay unlocked too.
  const unlockedNextId = (() => {
    for (const id of SECTION_ROUTE) {
      if (!visited?.has(id)) return id;
    }
    return null;  // all six visited → nothing more to unlock
  })();
  const totalRouteCount = SECTION_ROUTE.length;
  const visitedRouteCount = SECTION_ROUTE.filter((id) => visited?.has(id)).length;

  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-1">{t('dvic.section.heading')}</h3>
      <p className="text-xs text-navy-400 mb-2">
        {t('dvic.section.hint')}
      </p>
      {/* Progress strip — surfaces the route + how far the inspector has
          walked. Reads from the same visited Set the lock gate uses, so
          the two can't disagree. */}
      <div className="mb-4 flex items-center gap-2 text-[11px] text-navy-300">
        <span className="font-semibold text-white">
          {t('dvic.section.routeProgressFmt', {
            visited: visitedRouteCount,
            total: totalRouteCount,
            defaultValue: `${visitedRouteCount} of ${totalRouteCount} sections inspected`,
          })}
        </span>
        <div className="flex-1 h-1 rounded-full bg-navy-800 overflow-hidden">
          <div
            className="h-full bg-accent-blue transition-all"
            style={{ width: `${(visitedRouteCount / totalRouteCount) * 100}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {sections.map((s) => {
          const selected = value?.id === s.id;
          const isInRoute = s.id in SECTION_ROUTE_INDEX;
          const isVisited = visited?.has(s.id);
          // Lock only sections that participate in the route AND haven't
          // been opened yet AND aren't the next-to-open. Extras outside
          // the route stay free — they're class-specific add-ons, not
          // part of the mandatory walk.
          const locked = isInRoute && !isVisited && s.id !== unlockedNextId;
          const stepNumber = isInRoute ? SECTION_ROUTE_INDEX[s.id] + 1 : null;
          return (
            <button
              key={s.id}
              onClick={() => { if (!locked) onChange(s); }}
              disabled={locked}
              aria-disabled={locked}
              title={locked
                ? t('dvic.section.lockedTooltip', 'Inspect the previous sections first')
                : undefined}
              className={`relative rounded-xl border-2 p-3 text-left transition-all ${
                locked
                  ? 'border-navy-800 bg-navy-900/40 opacity-50 cursor-not-allowed'
                  : selected
                    ? 'border-accent-blue bg-accent-blue/10 cursor-pointer'
                    : 'border-navy-700 bg-navy-900/60 hover:border-navy-600 cursor-pointer'
              }`}
            >
              {/* Status badge top-right: step number while locked, check when visited */}
              {isInRoute && (
                <span className={`absolute top-2 right-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                  isVisited
                    ? 'bg-accent-green text-white'
                    : locked
                      ? 'bg-navy-800 text-navy-500'
                      : 'bg-accent-blue text-white ring-2 ring-accent-blue/30'
                }`}>
                  {isVisited ? <Check size={10} /> : stepNumber}
                </span>
              )}
              <div className="flex items-start gap-2 mb-1">
                <span className="text-2xl shrink-0">
                  {locked ? <Lock size={20} className="text-navy-600" /> : s.icon}
                </span>
                <div className="min-w-0 pr-5">
                  <div className="text-sm font-semibold text-white truncate">{s.label}</div>
                  <div className="text-[10px] text-navy-400">{t('dvic.section.checksCount', { count: s.itemCount })}</div>
                </div>
              </div>
              <div className="text-[11px] text-navy-300 line-clamp-2">{s.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ═════════════════════════════════════════════════════
// Step 2 — Item picker (rows grouped by part_category)
// ═════════════════════════════════════════════════════
function ItemPicker({ section, value, onChange }) {
  const { t } = useTranslation('wizard');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{section.icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white">{section.label}</h3>
          <p className="text-xs text-navy-400">{section.description}</p>
        </div>
      </div>

      {(section.categories || []).map((cat) => (
        <div key={cat.name}>
          <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1.5 font-semibold">
            {cat.name}
          </div>
          <div className="space-y-1">
            {(cat.items || []).map((it) => {
              const selected = value?.id === it.id;
              return (
                <button
                  key={it.id}
                  onClick={() => onChange(it)}
                  className={`w-full rounded-lg border-2 px-3 py-2.5 text-left transition-all cursor-pointer ${
                    selected
                      ? 'border-accent-blue bg-accent-blue/10'
                      : 'border-navy-700 bg-navy-900/60 hover:border-navy-600'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg shrink-0 mt-0.5">{it.partIcon || '🔧'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white">{it.description}</div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {it.classification && <SeverityBadge classification={it.classification} />}
                        <span className="text-[10px] text-accent-blue/80 font-bold uppercase tracking-wide">
                          {it.group}
                        </span>
                        {it.position && (
                          <span className="text-[10px] text-navy-500">
                            · {it.positionLabel || it.position.replace(/_/g, ' ')}
                          </span>
                        )}
                        {!it.position && (it.validPositions?.length || 0) > 1 && (
                          <span className="text-[10px] text-navy-500">
                            · {t('dvic.item.positionsCount', { count: it.validPositions.length })}
                          </span>
                        )}
                        {it.requiresDetails && <span className="text-[10px] text-navy-500">· {t('dvic.item.detailsRequired')}</span>}
                      </div>
                    </div>
                    {selected && <ChevronRight size={14} className="text-accent-blue shrink-0 mt-1" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


// ═════════════════════════════════════════════════════
// Step 3 — Position picker
// ═════════════════════════════════════════════════════
function PositionPicker({ positions, value, onChange }) {
  const { t } = useTranslation('wizard');
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-1">{t('dvic.position.heading')}</h3>
      <p className="text-xs text-navy-400 mb-4">
        {t('dvic.position.hint')}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {positions.map((id) => {
          const label = id.replace(/_/g, ' ');
          const selected = value?.id === id;
          return (
            <button
              key={id}
              onClick={() => onChange({ id, label })}
              className={`rounded-xl border-2 px-4 py-6 text-center transition-all cursor-pointer capitalize ${
                selected
                  ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                  : 'border-navy-700 bg-navy-900/60 text-white hover:border-navy-600'
              }`}
            >
              <div className="text-base font-semibold">{label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ═════════════════════════════════════════════════════
// Step 4 — Details form (JSON Schema-driven)
// ═════════════════════════════════════════════════════
function DetailsForm({ item, details, vehicleClass, positionId, onChange }) {
  const { t } = useTranslation('wizard');
  const schema = item.detailsSchema || {};
  const props = schema.properties || {};
  const baseRequired = new Set(schema.required || []);

  // Filter to currently-visible fields (x_show_when may hide some) and
  // compute required flag per field, including conditional requirements.
  const visibleEntries = Object.entries(props).filter(
    ([, def]) => isFieldVisible(def, vehicleClass, positionId),
  );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-white mb-1">{t('dvic.details.heading')}</h3>
      <p className="text-xs text-navy-400 mb-3">
        {t('dvic.details.hint')}
      </p>
      {visibleEntries.map(([key, def]) => {
        const isRequired = baseRequired.has(key)
          || (def.x_required_when_shown && isFieldVisible(def, vehicleClass, positionId));
        return (
          <FieldInput
            key={key}
            name={key}
            def={def}
            required={isRequired}
            value={details[key]}
            onChange={(v) => onChange({ ...details, [key]: v })}
          />
        );
      })}
    </div>
  );
}

function FieldInput({ name, def, required, value, onChange }) {
  const { t } = useTranslation('wizard');
  const label = def.title || name.replace(/_/g, ' ');

  // Number input
  if (def.type === 'integer' || def.type === 'number') {
    return (
      <div>
        <label className="text-xs font-semibold text-navy-300 mb-1 block capitalize">
          {label}{required && <span className="text-accent-red">*</span>}
        </label>
        <input
          type="number"
          inputMode="numeric"
          min={def.minimum}
          max={def.maximum}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="w-full rounded-md px-3 py-2 bg-navy-900 border border-navy-700 text-white outline-none focus:border-accent-blue text-sm"
        />
        {(def.minimum !== undefined || def.maximum !== undefined) && (
          <p className="text-[10px] text-navy-500 mt-0.5">
            {t('dvic.details.rangeFmt', { min: def.minimum ?? '—', max: def.maximum ?? '—' })}
          </p>
        )}
      </div>
    );
  }

  if (def.type === 'boolean') {
    return (
      <div>
        <label className="text-xs font-semibold text-navy-300 mb-1 block capitalize">
          {label}{required && <span className="text-accent-red">*</span>}
        </label>
        <div className="flex gap-2">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              onClick={() => onChange(v)}
              className={`flex-1 px-3 py-2 rounded-md border-2 text-sm font-semibold cursor-pointer transition-all ${
                value === v
                  ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                  : 'border-navy-700 bg-navy-900 text-navy-300 hover:text-white'
              }`}
            >
              {v ? t('dvic.details.yes') : t('dvic.details.no')}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (def.type === 'array' && def.items?.enum) {
    const arr = Array.isArray(value) ? value : [];
    const toggle = (opt) => {
      if (arr.includes(opt)) onChange(arr.filter((x) => x !== opt));
      else onChange([...arr, opt]);
    };
    return (
      <div>
        <label className="text-xs font-semibold text-navy-300 mb-1 block capitalize">
          {label}{required && <span className="text-accent-red">*</span>}
        </label>
        <p className="text-[10px] text-navy-500 mb-1.5">{t('dvic.details.pickOneOrMore')}</p>
        <div className="flex flex-wrap gap-1.5">
          {def.items.enum.map((opt) => {
            const selected = arr.includes(opt);
            return (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className={`px-3 py-1.5 rounded-md border-2 text-xs font-semibold cursor-pointer capitalize ${
                  selected
                    ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                    : 'border-navy-700 bg-navy-900 text-navy-300 hover:text-white'
                }`}
              >
                {opt.replace(/_/g, ' ')}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (def.enum) {
    return (
      <div>
        <label className="text-xs font-semibold text-navy-300 mb-1 block capitalize">
          {label}{required && <span className="text-accent-red">*</span>}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {def.enum.map((opt) => (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className={`px-3 py-1.5 rounded-md border-2 text-xs font-semibold cursor-pointer capitalize ${
                value === opt
                  ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                  : 'border-navy-700 bg-navy-900 text-navy-300 hover:text-white'
              }`}
            >
              {opt.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // String fallback — date format presets (MM/DD/YYYY, MM/YYYY) auto-format.
  // NOTE: the backend stores patterns with a literal `/` (no backslash escape),
  // e.g. `^(0[1-9]|1[0-2])/\d{4}$`. Each `\/?` below accepts both an escaped
  // (`\/`) and unescaped (`/`) separator so the preset matches either form.
  const datePresets = [
    {
      match: /^\^\(0\[1-9\]\|1\[0-2\]\)\\?\/\(0\[1-9\]\|\[12\]\\d\|3\[01\]\)\\?\/\\d\{4\}\$$/,
      placeholder: 'MM/DD/YYYY', helper: t('dvic.details.datePresetUS'),
      maxLength: 10, autoFormat: 'date',
    },
    {
      match: /^\^\(0\[1-9\]\|1\[0-2\]\)\\?\/\\d\{4\}\$$/,
      placeholder: 'MM/YYYY', helper: t('dvic.details.datePresetMonth'),
      maxLength: 7, autoFormat: 'month',
    },
  ];
  const preset = def.pattern ? datePresets.find((p) => p.match.test(def.pattern)) : null;

  const handleDateChange = (raw) => {
    if (!preset) return onChange(raw);
    const digits = raw.replace(/\D/g, '').slice(0, preset.autoFormat === 'date' ? 8 : 6);
    let out = digits;
    if (preset.autoFormat === 'date') {
      if (digits.length >= 5) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
      else if (digits.length >= 3) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    } else if (preset.autoFormat === 'month') {
      if (digits.length >= 3) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    onChange(out);
  };

  return (
    <div>
      <label className="text-xs font-semibold text-navy-300 mb-1 block capitalize">
        {label}{required && <span className="text-accent-red">*</span>}
      </label>
      <input
        type="text"
        inputMode={preset ? 'numeric' : 'text'}
        value={value ?? ''}
        onChange={(e) => preset ? handleDateChange(e.target.value) : onChange(e.target.value)}
        pattern={def.pattern}
        maxLength={preset?.maxLength}
        placeholder={preset?.placeholder || (def.pattern ? def.pattern.replace(/[\\^$]/g, '') : undefined)}
        className="w-full rounded-md px-3 py-2 bg-navy-900 border border-navy-700 text-white outline-none focus:border-accent-blue text-sm font-mono"
      />
      {preset ? (
        <p className="text-[10px] text-navy-500 mt-0.5">{preset.helper}</p>
      ) : def.pattern ? (
        <p className="text-[10px] text-navy-500 mt-0.5">
          {t('dvic.details.patternHint', { pattern: def.pattern })}
        </p>
      ) : null}
    </div>
  );
}


// Nova Fora extension to JSON Schema. A property may carry x_show_when:
// {position_in?: string[], vehicle_class_in?: string[]} — the form renders
// it only when ALL listed conditions match. If x_required_when_shown is true,
// validation treats the field as required whenever it's visible.
function isFieldVisible(def, vehicleClass, positionId) {
  const showWhen = def?.x_show_when;
  if (!showWhen) return true;  // no condition → always visible
  if (showWhen.position_in && !showWhen.position_in.includes(positionId)) return false;
  if (showWhen.vehicle_class_in && !showWhen.vehicle_class_in.includes(vehicleClass)) return false;
  return true;
}

function validateDetails(item, details, vehicleClass = null, positionId = null) {
  if (!item) return false;
  const schema = item.detailsSchema || {};
  const props = schema.properties || {};
  const required = new Set(schema.required || []);

  // Add conditionally-required fields when their x_show_when matches.
  for (const [key, def] of Object.entries(props)) {
    if (def?.x_required_when_shown && isFieldVisible(def, vehicleClass, positionId)) {
      required.add(key);
    }
  }

  for (const key of required) {
    // Skip required fields that are currently hidden — user can't fill them
    const def = props[key];
    if (def && !isFieldVisible(def, vehicleClass, positionId)) continue;
    const v = details[key];
    if (v === undefined || v === '' || v === null) return false;
    if (Array.isArray(v) && v.length === 0) return false;
  }
  return true;
}

// Pre-populate details from JSON Schema property defaults so the user can
// advance immediately when every required field has a default (e.g.
// warning_lamp.state defaults to "on").
function initialDetailsFromSchema(item) {
  const props = item?.detailsSchema?.properties || {};
  const out = {};
  for (const [key, def] of Object.entries(props)) {
    if (def && def.default !== undefined) out[key] = def.default;
  }
  return out;
}


// ═════════════════════════════════════════════════════
// Step 5 — Review + commit
// ═════════════════════════════════════════════════════
function ReviewStep({ item, position, details, notes, onNotesChange, submitError }) {
  const { t } = useTranslation('wizard');
  const positionLabel = position?.label
    || item.positionLabel
    || (item.position ? item.position.replace(/_/g, ' ') : null);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-navy-700 bg-navy-900/60 p-4">
        <div className="flex items-start gap-3">
          <span className="text-3xl shrink-0">{item.partIcon || '🔧'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white mb-0.5">
              {item.partLabel}
              {positionLabel && <span className="text-navy-400 font-normal capitalize"> ({positionLabel})</span>}
            </div>
            <div className="text-sm text-navy-200 mb-1.5">
              {item.defectTypeIcon} {item.defectTypeLabel}
            </div>

            {item.description && (
              <p className="text-[11px] text-navy-400 italic mb-2">"{item.description}"</p>
            )}

            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {item.classification && <SeverityBadge classification={item.classification} />}
              {item.group && (
                <span className="text-[10px] uppercase tracking-wide font-bold text-accent-blue/80">
                  {item.group}
                </span>
              )}
              {item.needsReview && (
                <span className="text-[10px] text-accent-orange/80 italic">
                  · {t('dvic.review.severityPending')}
                </span>
              )}
            </div>

            {Object.keys(details).length > 0 && (
              <div className="mt-2 pt-2 border-t border-navy-800">
                <div className="text-[10px] uppercase tracking-wide text-navy-500 mb-1">
                  {t('dvic.review.detailsHeading')}
                </div>
                <div className="space-y-0.5 text-[11px]">
                  {Object.entries(details).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-navy-400 capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="text-white font-mono">
                        {Array.isArray(v) ? v.join(', ') : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wide text-navy-400 block mb-1.5">
          {t('dvic.review.notesLabel')}
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder={t('dvic.review.notesPlaceholder')}
          rows={2}
          className="w-full rounded-md px-3 py-2 bg-navy-900 border border-navy-700 text-white text-sm outline-none focus:border-accent-blue resize-none"
        />
        <p className="text-[10px] text-navy-500 mt-1">
          {t('dvic.review.notesUsageHint')}
        </p>
      </div>

      {submitError && (
        <div className="rounded-md bg-accent-red/10 border border-accent-red/30 px-3 py-2 text-xs text-accent-red flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}
    </div>
  );
}
