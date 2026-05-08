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
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, X, Check, AlertCircle, Loader2,
  ChevronRight, ClipboardList, Trash2, Send, Camera,
} from 'lucide-react';
import {
  dvicTemplate as dvicTemplateApi,
  defects as defectsApi,
  APIError,
} from '../api/client';
import PhotoUploader from './ui/PhotoUploader';


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
  const handleCloseAction = onClose || onCancel;

  // Step 1..6
  const [step, setStep] = useState(1);

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
      <Shell title="Loading checklist…" onCancel={handleCloseAction}>
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="text-accent-blue animate-spin" />
        </div>
      </Shell>
    );
  }

  if (tplError) {
    return (
      <Shell title="Couldn't load checklist" onCancel={handleCloseAction}>
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
      <Shell title={`No checklist for ${tpl?.vehicleClassLabel || vehicleClass}`} onCancel={handleCloseAction}>
        <div className="px-4 py-12 max-w-md mx-auto text-center">
          <ClipboardList size={32} className="text-navy-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-white mb-2">
            DVIC checklist not configured yet
          </h3>
          <p className="text-sm text-navy-300 mb-4">
            The Amazon DVIC PDF for <span className="text-white font-mono">{tpl?.vehicleClassLabel || vehicleClass}</span> hasn't
            been transcribed into the catalog yet. Contact your admin or
            inspect another vehicle in the meantime.
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
        if (window.confirm("Discard this defect and close? You haven't uploaded a photo yet.")) {
          await handleRollbackDefect(1);
          handleCloseAction?.();
        }
      }
    : handleCloseAction;

  return (
    <Shell
      title={step === 1
        ? `Add defects — ${tpl.vehicleClassLabel}`
        : step === 6
          ? `Photo required — ${tpl.vehicleClassLabel}`
          : `Add defect — ${tpl.vehicleClassLabel}`}
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
                sections={tpl.sections}
                value={section}
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
                onPhotoChanged={(action) => {
                  if (action === 'added') setPhotoCount((c) => c + 1);
                  else if (action === 'deleted') setPhotoCount((c) => Math.max(0, c - 1));
                }}
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
                <ArrowLeft size={14} /> Back
              </button>
            ) : (
              <span className="w-[80px]" aria-hidden />
            )
          ) : step === 6 ? (
            <button
              onClick={() => {
                if (window.confirm("Discard this defect? You haven't uploaded a photo yet.")) {
                  handleRollbackDefect(5);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/20 cursor-pointer text-sm font-semibold"
            >
              <X size={14} /> Discard
            </button>
          ) : (
            <button
              onClick={goBack}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-navy-700 text-navy-300 hover:text-white hover:border-navy-600 cursor-pointer text-sm"
            >
              <ArrowLeft size={14} /> Back
            </button>
          )}

          {step === 1 && onComplete && (
            <button
              onClick={onComplete}
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-accent-green text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm shadow-lg shadow-accent-green/20"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {submitting
                ? 'Submitting…'
                : `Complete Inspection${defects.length > 0 ? ` (${defects.length})` : ''}`}
            </button>
          )}
          {step > 1 && step < 5 && (
            <button
              onClick={goNext}
              disabled={!canGoNext(step)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
            >
              Next <ArrowRight size={14} />
            </button>
          )}
          {step === 5 && (
            <button
              onClick={handleCommitDefect}
              disabled={defectSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer text-sm"
            >
              {defectSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              {defectSubmitting ? 'Saving…' : 'Continue → photo'}
            </button>
          )}
          {step === 6 && (
            <button
              onClick={handleFinalizeDefectWithPhoto}
              disabled={photoCount < 1}
              title={photoCount < 1 ? 'Upload at least one photo to continue' : ''}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-green text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
            >
              <Check size={14} />
              {photoCount < 1
                ? 'Upload a photo to save'
                : `Save defect${photoCount > 1 ? ` (${photoCount} photos)` : ''}`}
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
              ? `Photo${photoCount === 1 ? '' : 's'} attached — ready to save`
              : 'Photo required'}
          </div>
          <p className="text-navy-300">
            {photoCount >= 1
              ? 'Tap "Save defect" below to commit. You can add more photos before saving.'
              : 'Take or upload at least one photo of the defect. Without a photo this defect can\'t be saved.'}
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
        Tip: take a wide shot first so the location of the defect is obvious,
        then a close-up. Compression happens locally — uploads stay fast on 4G.
      </p>
    </div>
  );
}


// ═════════════════════════════════════════════════════
// Committed defects list (step 1 inline)
// ═════════════════════════════════════════════════════
function CommittedDefectsList({ defects, onRemove }) {
  if (!defects || defects.length === 0) {
    return (
      <div className="mt-6 px-3 py-4 rounded-lg border border-dashed border-navy-700 bg-navy-900/30 text-center">
        <p className="text-[11px] text-navy-400">
          No defects added yet. Tap a section above to start, or hit{' '}
          <span className="text-accent-green font-semibold">Complete Inspection</span>{' '}
          if everything checks out.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2">
        <ClipboardList size={14} className="text-accent-blue" />
        <h4 className="text-xs font-semibold text-white">
          Defects added <span className="text-navy-400 font-normal">({defects.length})</span>
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
                title="Remove defect"
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
// Step 1 — Section picker (6 tiles, hide empty sections)
// ═════════════════════════════════════════════════════
function SectionPicker({ sections, value, onChange }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-1">Where on the vehicle?</h3>
      <p className="text-xs text-navy-400 mb-4">
        Pick the section the inspector is currently looking at.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {sections.map((s) => {
          const selected = value?.id === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onChange(s)}
              className={`rounded-xl border-2 p-3 text-left transition-all cursor-pointer ${
                selected
                  ? 'border-accent-blue bg-accent-blue/10'
                  : 'border-navy-700 bg-navy-900/60 hover:border-navy-600'
              }`}
            >
              <div className="flex items-start gap-2 mb-1">
                <span className="text-2xl shrink-0">{s.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{s.label}</div>
                  <div className="text-[10px] text-navy-400">{s.itemCount} checks</div>
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
                            · {it.validPositions.length} positions
                          </span>
                        )}
                        {it.requiresDetails && <span className="text-[10px] text-navy-500">· details required</span>}
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
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-1">Which position?</h3>
      <p className="text-xs text-navy-400 mb-4">
        Pick where on the vehicle the defect is.
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
      <h3 className="text-sm font-semibold text-white mb-1">Extra details</h3>
      <p className="text-xs text-navy-400 mb-3">
        Required to fully describe this defect.
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
            Range: {def.minimum ?? '—'} to {def.maximum ?? '—'}
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
              {v ? 'Yes' : 'No'}
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
        <p className="text-[10px] text-navy-500 mb-1.5">Pick one or more.</p>
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
  const datePresets = [
    {
      match: /^\^\(0\[1-9\]\|1\[0-2\]\)\\\/\(0\[1-9\]\|\[12\]\\d\|3\[01\]\)\\\/\\d\{4\}\$$/,
      placeholder: 'MM/DD/YYYY', helper: 'US date format — month/day/year, e.g. 04/19/2026',
      maxLength: 10, autoFormat: 'date',
    },
    {
      match: /^\^\(0\[1-9\]\|1\[0-2\]\)\\\/\\d\{4\}\$$/,
      placeholder: 'MM/YYYY', helper: 'Month/year on the sticker, e.g. 04/2026',
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
          Pattern: <span className="font-mono">{def.pattern}</span>
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
                  · Severity pending review
                </span>
              )}
            </div>

            {Object.keys(details).length > 0 && (
              <div className="mt-2 pt-2 border-t border-navy-800">
                <div className="text-[10px] uppercase tracking-wide text-navy-500 mb-1">
                  Details
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
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Anything the structured fields don't cover…"
          rows={2}
          className="w-full rounded-md px-3 py-2 bg-navy-900 border border-navy-700 text-white text-sm outline-none focus:border-accent-blue resize-none"
        />
        <p className="text-[10px] text-navy-500 mt-1">
          Target usage: under 5% of defects.
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
