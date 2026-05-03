/**
 * DvicWizard — full-screen section-first picker for adding ONE defect.
 *
 * Drives the v3 schema flow that mirrors the Amazon DVIC PDF structure:
 *   1. Section          (6 tiles: General / Front / Back / Driver / Passenger / In Cab)
 *   2. Item             (rows grouped by part_category — verbatim PDF text)
 *   3. Position         (only if item has position_options)            ← auto-skip
 *   4. Sub-position     (only if item has sub_positions array)         ← auto-skip
 *   5. Details form     (only if item has requires_details)            ← auto-skip
 *   6. Review + commit
 *
 * Replaces DefectWizard (system-first abstraction). Used inside
 * CreateInspectionWizard step 5: when the inspector taps '+ Add defect',
 * this opens on top.
 *
 * Template is loaded per asset_type via dvicTemplate.load(assetType) and
 * cached. Each asset_type sees a different filtered set (cargo vs DOT step
 * van — DOT has ~20% more checks like fuel cap, mud flap, decals, etc).
 *
 * On commit: POST /inspections/{id}/defects with v2 schema fields
 * (part_v2, defect_type_v2, position, details). The backend's catalog
 * validation is the source of truth.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, X, Check, AlertCircle, Loader2,
  ChevronRight, ClipboardList, Trash2, Send,
} from 'lucide-react';
import {
  dvicTemplate as dvicTemplateApi,
  inspections as inspectionsApi,
  APIError,
} from '../api/client';


/**
 * Props:
 *   inspectionId, assetType (required) — what we're adding defects to
 *   onCommitted(defect) — fires after each successful POST /defects
 *   defects — running list of defects already committed (for the step-1 list)
 *   onRemoveDefect(defect) — delete handler for the inline list
 *   onComplete() — submit the entire inspection (POST /inspections/{id}/submit)
 *   submitting, submitError — bubbled from the parent's submit state
 *   onClose() — close the entire inspection wizard (top-right X)
 *   onBack() — go back to the previous parent step (top-left arrow on step 1)
 *   onCancel() — legacy alias for onClose, kept for backward-compat
 */
export default function DvicWizard({
  inspectionId,
  assetType,
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
  // Resolve close action: prefer onClose (new), fall back to onCancel (legacy).
  const handleCloseAction = onClose || onCancel;
  // Step 1..6
  const [step, setStep] = useState(1);

  // Selections built up across steps
  const [section, setSection] = useState(null);     // section group from template
  const [item, setItem] = useState(null);           // chosen line item
  const [position, setPosition] = useState(null);   // {key, label} from item.position_options
  const [subPosition, setSubPosition] = useState(null);  // {key, label} from item.sub_positions
  const [details, setDetails] = useState({});       // structured details (tread depth, lamp_type, etc)
  const [notes, setNotes] = useState('');

  // Template
  const [tpl, setTpl] = useState(null);
  const [tplLoading, setTplLoading] = useState(true);
  const [tplError, setTplError] = useState(null);

  // Per-defect commit state (separate from the parent's per-inspection submit
  // state which is bubbled in via the `submitting` prop).
  const [defectSubmitting, setDefectSubmitting] = useState(false);
  const [defectSubmitError, setDefectSubmitError] = useState(null);

  // Load template
  useEffect(() => {
    let alive = true;
    setTplLoading(true);
    dvicTemplateApi.load(assetType)
      .then((res) => alive && setTpl(res))
      .catch((err) => alive && setTplError(
        err instanceof APIError ? err.detail : (err.message || 'Failed to load template')
      ))
      .finally(() => alive && setTplLoading(false));
    return () => { alive = false; };
  }, [assetType]);

  // ─── Derived ────────────────────────────────────────
  const hasPositionOptions = (item?.positionOptions?.length || 0) > 0;
  const hasSubPositions = (item?.subPositions?.length || 0) > 0;
  const requiresDetails = !!item?.requiresDetails;

  const canGoNext = (s) => {
    switch (s) {
      case 1: return !!section;
      case 2: return !!item;
      case 3: return !hasPositionOptions || !!position;
      case 4: return !hasSubPositions || !!subPosition;
      case 5: return validateDetails(item, details, subPosition);
      case 6: return true;
      default: return false;
    }
  };

  const goNext = () => {
    let next = step + 1;
    if (next === 3 && !hasPositionOptions) next = 4;
    if (next === 4 && !hasSubPositions) next = 5;
    if (next === 5 && !requiresDetails) next = 6;
    setStep(next);
  };

  const goBack = () => {
    let prev = step - 1;
    if (prev === 5 && !requiresDetails) prev = 4;
    if (prev === 4 && !hasSubPositions) prev = 3;
    if (prev === 3 && !hasPositionOptions) prev = 2;
    if (prev < 1) prev = 1;
    // Reset downstream
    if (prev <= 1) { setItem(null); setPosition(null); setSubPosition(null); setDetails({}); }
    if (prev <= 2) { setPosition(null); setSubPosition(null); setDetails({}); }
    if (prev <= 3) { setSubPosition(null); setDetails({}); }
    if (prev <= 4) { setDetails({}); }
    setStep(prev);
  };

  // Reset all per-defect picker state — used after a successful commit so
  // the user lands on a fresh step 1 ready for the next defect.
  const resetForNextDefect = () => {
    setSection(null);
    setItem(null);
    setPosition(null);
    setSubPosition(null);
    setDetails({});
    setNotes('');
    setDefectSubmitError(null);
    setStep(1);
  };

  // ─── Commit one defect ──────────────────────────────
  const handleCommitDefect = async () => {
    if (!item) return;
    setDefectSubmitting(true);
    setDefectSubmitError(null);
    try {
      // Server-side, position is the DefectPosition enum value. Two cases:
      //  a) item.position is pre-set → use it as-is
      //  b) item.positionOptions non-empty → use the picked position.key
      const finalPosition = position?.key || item.position || null;

      // Compose the details JSON. Sub_position picks go into a key matching
      // the picker shape:
      //   - headlight beam     → details.beam_type    = "low_beam" | "high_beam"
      //   - tire tread location → details.tread_position = "inner" | ...
      //   - seatbelt component  → details.component   = "anchor" | ...
      //   - exterior_door       → details.door        = "driver" | ...
      const finalDetails = { ...details };
      if (subPosition) {
        const key = subPositionKeyForPart(item.part);
        finalDetails[key] = subPosition.key;
      }

      const body = {
        partV2: item.part,
        defectTypeV2: item.defectType,
        details: finalDetails,
      };
      if (finalPosition) body.position = finalPosition;
      if (notes.trim()) body.notes = notes.trim();

      const created = await inspectionsApi.addDefect(inspectionId, body);
      onCommitted?.({
        ...created,
        // Augment with template labels for nice rendering upstream
        partLabel: item.partLabel,
        partIcon: item.partIcon,
        positionLabel: position?.label || item.positionLabel,
        defectTypeLabel: item.defectTypeLabel,
        defectTypeIcon: item.defectTypeIcon,
        details: finalDetails,
      });
      // Auto-return to the section picker so the inspector can immediately
      // log the next defect — this is the explicit UX request from the
      // tech-flow review (no manual "Back" tap needed).
      resetForNextDefect();
    } catch (err) {
      setDefectSubmitError(err instanceof APIError ? err.detail : 'Submit failed');
    } finally {
      setDefectSubmitting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────
  if (tplLoading) {
    return (
      <Shell title="Loading checklist…" onCancel={handleCloseAction}>
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="text-accent-blue animate-spin" />
        </div>
      </Shell>
    );
  }

  if (tplError || !tpl) {
    return (
      <Shell title="Couldn't load checklist" onCancel={handleCloseAction}>
        <div className="px-4 py-12 text-center text-sm text-navy-300">
          <AlertCircle size={28} className="text-accent-red mx-auto mb-3" />
          <p>{tplError || 'Unknown error'}</p>
        </div>
      </Shell>
    );
  }

  // Top-left back button:
  //   - on step 1 (the hub): if onBack is provided (parent wants us to go back
  //     to the previous wizard step), use it. Otherwise no back button.
  //   - on steps 2-6: standard intra-DvicWizard back navigation.
  const topBackHandler = step === 1
    ? (onBack || null)
    : goBack;

  return (
    <Shell
      title={step === 1
        ? `Add defects — ${tpl.assetTypeLabel}`
        : `Add defect — ${tpl.assetTypeLabel}`}
      step={step}
      totalSteps={6}
      onCancel={handleCloseAction}
      onBack={topBackHandler}
    >
      <div className="px-4 sm:px-6 pt-3 pb-24 max-w-2xl mx-auto">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <Pane key="1">
              <SectionPicker
                sections={tpl.sections}
                value={section}
                onChange={(s) => {
                  // Tile tap selects + auto-advances to the item picker so
                  // the tech doesn't have to also reach for the Next button.
                  setSection(s);
                  setItem(null);
                  setStep(2);
                }}
              />
              {/* Running defect list — gives the tech confidence the additions
                  are saved without requiring them to leave this view. */}
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
                onChange={(it) => {
                  setItem(it);
                  // Auto-pick position if exactly one option (rare)
                  if (it.positionOptions?.length === 1) {
                    setPosition(it.positionOptions[0]);
                  } else {
                    setPosition(null);
                  }
                  setSubPosition(null);
                  setDetails({});
                }}
              />
            </Pane>
          )}
          {step === 3 && item && hasPositionOptions && (
            <Pane key="3">
              <PositionPicker
                options={item.positionOptions}
                value={position}
                onChange={setPosition}
              />
            </Pane>
          )}
          {step === 4 && item && hasSubPositions && (
            <Pane key="4">
              <SubPositionPicker
                part={item.part}
                options={item.subPositions}
                value={subPosition}
                onChange={setSubPosition}
              />
            </Pane>
          )}
          {step === 5 && item && requiresDetails && (
            <Pane key="5">
              <DetailsForm
                item={item}
                details={details}
                onChange={setDetails}
              />
            </Pane>
          )}
          {step === 6 && item && (
            <Pane key="6">
              <ReviewStep
                item={item}
                position={position}
                subPosition={subPosition}
                details={details}
                notes={notes}
                onNotesChange={setNotes}
                submitError={defectSubmitError}
              />
            </Pane>
          )}
        </AnimatePresence>
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-navy-800 bg-navy-950/95 backdrop-blur px-4 py-3 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          {/* Left button:
              - step 1: "Back" returns to the previous parent step (odometer)
                if onBack is given; otherwise hidden (top-X handles full close)
              - steps 2-6: in-wizard Back navigation */}
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
          ) : (
            <button
              onClick={goBack}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-navy-700 text-navy-300 hover:text-white hover:border-navy-600 cursor-pointer text-sm"
            >
              <ArrowLeft size={14} /> Back
            </button>
          )}

          {/* Right button:
              - step 1: "Complete Inspection" — submits the WHOLE inspection
                via onComplete (parent's handleSubmit). Always enabled even
                with 0 defects (a clean walkthrough = passed inspection).
              - steps 2-5: "Next" — advances internally
              - step 6: "Add defect" — POSTs the defect, resets, returns to step 1 */}
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
          {step > 1 && step < 6 && (
            <button
              onClick={goNext}
              disabled={!canGoNext(step)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
            >
              Next <ArrowRight size={14} />
            </button>
          )}
          {step === 6 && (
            <button
              onClick={handleCommitDefect}
              disabled={defectSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer text-sm"
            >
              {defectSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {defectSubmitting ? 'Adding…' : 'Add defect'}
            </button>
          )}
        </div>
      </div>
    </Shell>
  );
}


// ─────────────────────────────────────────────────────
// Committed defects list — rendered inline on step 1 so the tech can see
// what they've added so far + delete a wrongly-tapped one without leaving
// the section picker.
// ─────────────────────────────────────────────────────
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
                {d.defectTypeIcon} {d.defectTypeLabel || d.description || ''}
              </div>
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
// Sub-components
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


// ─────────────────────────────────────────────────────
// Step 1 — Section picker (6 tiles)
// ─────────────────────────────────────────────────────
function SectionPicker({ sections, value, onChange }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-1">Where on the vehicle?</h3>
      <p className="text-xs text-navy-400 mb-4">
        Pick the section the inspector is currently looking at.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {sections.map((s) => {
          const itemCount = (s.categories || []).reduce(
            (a, c) => a + (c.items?.length || 0), 0
          );
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
                  <div className="text-[10px] text-navy-400">{itemCount} checks</div>
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


// ─────────────────────────────────────────────────────
// Step 2 — Item picker (rows grouped by part_category)
// ─────────────────────────────────────────────────────
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

      {section.categories.map((cat) => (
        <div key={cat.name}>
          <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1.5 font-semibold">
            {cat.name}
          </div>
          <div className="space-y-1">
            {cat.items.map((it) => {
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
                    <span className="text-lg shrink-0 mt-0.5">{it.partIcon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white">
                        {it.partLabel}
                        {it.position && (
                          <span className="text-navy-400 font-normal">
                            {' '}({it.positionLabel})
                          </span>
                        )}
                        {' — '}
                        <span className="text-navy-200">
                          {it.defectTypeIcon} {it.defectTypeLabel}
                        </span>
                      </div>
                      <div className="text-[11px] text-navy-400 mt-0.5">
                        {it.description}
                      </div>
                      {/* Hint icons for follow-up steps */}
                      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-navy-500">
                        {(it.positionOptions?.length || 0) > 0 && (
                          <span>📍 {it.positionOptions.length} positions</span>
                        )}
                        {(it.subPositions?.length || 0) > 0 && (
                          <span>· {it.subPositions.length} sub-options</span>
                        )}
                        {it.requiresDetails && <span>· details required</span>}
                      </div>
                    </div>
                    {selected && (
                      <ChevronRight size={14} className="text-accent-blue shrink-0 mt-1" />
                    )}
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


// ─────────────────────────────────────────────────────
// Step 3 — Position picker
// ─────────────────────────────────────────────────────
function PositionPicker({ options, value, onChange }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-1">Which side?</h3>
      <p className="text-xs text-navy-400 mb-4">
        Pick the position the defect is on.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const selected = value?.key === o.key;
          return (
            <button
              key={o.key}
              onClick={() => onChange(o)}
              className={`rounded-xl border-2 px-4 py-6 text-center transition-all cursor-pointer ${
                selected
                  ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                  : 'border-navy-700 bg-navy-900/60 text-white hover:border-navy-600'
              }`}
            >
              <div className="text-base font-semibold">{o.label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────
// Step 4 — Sub-position picker (beam type, seatbelt component, etc.)
// ─────────────────────────────────────────────────────
function SubPositionPicker({ part, options, value, onChange }) {
  const promptByPart = {
    headlight: 'Which beam?',
    seatbelt: 'Which seatbelt component?',
    exterior_door: 'Which door?',
    tire: 'Which tread location?',
    warning_lamp: 'Which lamp?',
  };
  const prompt = promptByPart[part] || 'Pick one';

  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-1">{prompt}</h3>
      <p className="text-xs text-navy-400 mb-4">
        Used to pinpoint the defect — stored as structured details.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const selected = value?.key === o.key;
          return (
            <button
              key={o.key}
              onClick={() => onChange(o)}
              className={`rounded-xl border-2 px-4 py-5 text-left transition-all cursor-pointer ${
                selected
                  ? 'border-accent-blue bg-accent-blue/10'
                  : 'border-navy-700 bg-navy-900/60 hover:border-navy-600'
              }`}
            >
              <div className="text-sm font-semibold text-white">{o.label}</div>
              {selected && <Check size={12} className="inline mt-1 text-accent-blue" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}


// Map a part to the JSON key used to store its sub_position in defect.details
function subPositionKeyForPart(part) {
  switch (part) {
    case 'headlight': return 'beam_type';
    case 'tire': return 'tread_position';
    case 'seatbelt': return 'component';
    case 'exterior_door': return 'door';
    case 'warning_lamp': return 'lamp_type';
    default: return 'sub_position';
  }
}


// ─────────────────────────────────────────────────────
// Step 5 — Details form (JSON Schema-driven)
// ─────────────────────────────────────────────────────
function DetailsForm({ item, details, onChange }) {
  const schema = item.detailsSchema || {};
  const props = schema.properties || {};
  const required = schema.required || [];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-white mb-1">Extra details</h3>
      <p className="text-xs text-navy-400 mb-3">
        {schema.ui_helper || 'Required to fully describe this defect.'}
      </p>

      {Object.entries(props).map(([key, def]) => {
        // Skip keys covered by sub_positions (we capture those separately)
        if (['tread_position', 'beam_type', 'component', 'door', 'lamp_type'].includes(key)) {
          return null;
        }
        return (
          <FieldInput
            key={key}
            name={key}
            def={def}
            required={required.includes(key)}
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

  // Boolean toggle
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

  // Enum (single select)
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

  // String fallback
  return (
    <div>
      <label className="text-xs font-semibold text-navy-300 mb-1 block capitalize">
        {label}{required && <span className="text-accent-red">*</span>}
      </label>
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        pattern={def.pattern}
        className="w-full rounded-md px-3 py-2 bg-navy-900 border border-navy-700 text-white outline-none focus:border-accent-blue text-sm"
      />
    </div>
  );
}


// Validate that all required fields in the details schema are populated
function validateDetails(item, details, subPosition) {
  if (!item) return false;
  const schema = item.detailsSchema || {};
  const required = schema.required || [];
  for (const key of required) {
    // sub_position-covered keys: validated separately
    if (['tread_position', 'beam_type', 'component', 'door', 'lamp_type'].includes(key)) {
      // OK if a sub_position was picked OR details has the key
      if (subPosition || details[key] !== undefined) continue;
      return false;
    }
    if (details[key] === undefined || details[key] === '' || details[key] === null) {
      return false;
    }
  }
  return true;
}


// ─────────────────────────────────────────────────────
// Step 6 — Review + commit
// ─────────────────────────────────────────────────────
function ReviewStep({ item, position, subPosition, details, notes, onNotesChange, submitError }) {
  const positionLabel = position?.label || item.positionLabel;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-navy-700 bg-navy-900/60 p-4">
        <div className="flex items-start gap-3">
          <span className="text-3xl shrink-0">{item.partIcon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white mb-0.5">
              {item.partLabel}
              {positionLabel && <span className="text-navy-400 font-normal"> ({positionLabel})</span>}
            </div>
            <div className="text-sm text-navy-200 mb-1.5">
              {item.defectTypeIcon} {item.defectTypeLabel}
              {subPosition && <span className="text-navy-400"> — {subPosition.label}</span>}
            </div>
            <p className="text-[11px] text-navy-400 italic">"{item.description}"</p>

            {Object.keys(details).length > 0 && (
              <div className="mt-2 pt-2 border-t border-navy-800">
                <div className="text-[10px] uppercase tracking-wide text-navy-500 mb-1">
                  Details
                </div>
                <div className="space-y-0.5 text-[11px]">
                  {Object.entries(details).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-navy-400 capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="text-white font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes (escape hatch — kept compact since most info should be structured) */}
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
