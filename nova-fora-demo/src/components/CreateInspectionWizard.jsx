/**
 * Multi-step QC DVIC wizard.
 *
 * Mobile-first design: tech is on a phone in a parking lot. Each step
 * fits on a single screen and the bottom nav is always visible.
 *
 * Backend flow (matches the DRAFT design):
 *   1. POST /inspections (empty defects)              -> DRAFT, INS-id
 *   2. (optional) odometer photo via /inspections/{id}/photos
 *   3. For each defect found in walkthrough:
 *        POST /inspections/{id}/defects               -> FD-id
 *        + PhotoUploader inline      uploads to /defects/{FD-id}/photos
 *   4. POST /inspections/{id}/submit                  -> SUBMITTED
 */
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, ArrowRight, X, Truck, Gauge, ClipboardList, Check, AlertCircle,
  Loader2, Plus, Trash2, Camera, ChevronDown, ChevronUp, AlertTriangle, Building2,
  KeyRound, PlayCircle, Ban,
} from 'lucide-react';
import {
  inspections as inspectionsApi,
  vehicles as vehiclesApi,
  defects as defectsApi,
  APIError,
} from '../api/client';
import PhotoUploader from './ui/PhotoUploader';
import InspectionChecklist from './InspectionChecklist';

// (Legacy 11-section taxonomy + free-text severity picker were deprecated
// in v2 of the defect schema — replaced by the catalog-driven DefectWizard.)

// Reasons a tech might not be able to inspect a vehicle.
// These create SUBMITTED inspections with result='incomplete' + this reason.
const INCOMPLETE_REASONS = [
  { value: 'vehicle_wont_start', label: "Vehicle won't start" },
  { value: 'not_at_lot', label: 'Vehicle not at the lot' },
  { value: 'no_keys', label: 'Vehicle keys not present' },
];

// Helper: extract numeric int from a prefixed id ("DSP-0004" → 4)
function numericIdFromPrefixed(prefixed) {
  if (!prefixed) return null;
  const parts = String(prefixed).split('-');
  const n = parseInt(parts[parts.length - 1], 10);
  return Number.isFinite(n) ? n : null;
}

// Today's date in UTC (YYYY-MM-DD) — matches the server's date_from/date_to filter
function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────
export default function CreateInspectionWizard({ user, onClose, onSubmitted }) {
  const { t } = useTranslation('wizard');
  // Phase-based state machine. Within `inspecting` phase, `step` 1-6 walks
  // through DSP/keys/vehicle/odometer/sections/review for ONE vehicle.
  // (Key recorder is step 2 — done ONCE per session and reused.)
  // After submit:
  //   - postSubmit: 3-action chooser (next van / switch DSP / complete fleet)
  //   - completeWarning: shown when user clicks Complete with vans pending
  //   - fleetDone: terminal celebration screen
  const [phase, setPhase] = useState('inspecting');
  // 1=DSP, 2=keys, 3=vehicle, 4=start-or-skip gate, 5=odometer,
  // 6=DvicWizard (section hub + Complete Inspection submits the whole thing).
  // The dedicated review step was folded into the DvicWizard hub — the tech
  // sees the running defect list right there and submits in one tap.
  const [step, setStep] = useState(1);

  // Fleet data — fetched once at mount, refetched after submit so the
  // "remaining" calculation reflects the latest server state.
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);

  // Per-inspection state (resets every time we start a new vehicle)
  const [vehicle, setVehicle] = useState(null);
  const [odometer, setOdometer] = useState('');
  const [inspectionId, setInspectionId] = useState(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [createError, setCreateError] = useState(null);
  // v2 schema: flat list of defects (no sections — they're derived from part).
  // Each item: { id, partLabel, partIcon, positionLabel, defectTypeLabel,
  //              defectTypeIcon, severity, photos: [], _v2: true }
  const [defects, setDefects] = useState([]);
  // (DvicWizard now renders inline at step 6 instead of as an on-demand
  // overlay — no separate "open" flag needed.)

  // Session-wide state (kept across multiple inspections in one shift)
  const [dsp, setDsp] = useState(null);  // {id, numericId, name, count}
  const [keysReceived, setKeysReceived] = useState('');  // string for input ergonomics
  const [keysConfirmed, setKeysConfirmed] = useState(false);  // tech tapped 'Continue' on the keys step
  const [inspectedSession, setInspectedSession] = useState([]); // {vehicleId, fleetId, defectCount, result}[]

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitError, setSubmitError] = useState(null);

  // Per-vehicle "not inspected" submit (step 4 gate). Separate from submitting
  // so the start-gate UI can show its own loader without flashing the review
  // step's spinner.
  const [incompleteSubmitting, setIncompleteSubmitting] = useState(false);
  const [incompleteError, setIncompleteError] = useState(null);

  // Odometer-photo count (step 5 gate). PhotoUploader fires onChanged with
  // 'added' / 'deleted'; we mirror that into a counter so we can block the
  // Next button until the inspector actually attached an odometer picture.
  const [odometerPhotoCount, setOdometerPhotoCount] = useState(0);

  // Server-side "today's inspections" cache for the chosen DSP (refetched after each submit)
  const [todayInspections, setTodayInspections] = useState([]);
  const [loadingToday, setLoadingToday] = useState(false);

  // Load vehicles on mount
  useEffect(() => {
    vehiclesApi.list({ perPage: 100 })
      .then((res) => setVehicles(res.items))
      .catch((err) => console.error('vehicles load failed', err))
      .finally(() => setVehiclesLoading(false));
  }, []);

  // ─── Derive list of DSPs the user has access to ────
  // For now we derive from the vehicles list (any DSP with >=1 visible van).
  // When the contract/assignment table exists in Semana 6, swap to the dedicated endpoint.
  const availableDsps = (() => {
    const seen = new Map();
    for (const v of vehicles) {
      if (!seen.has(v.dspId)) {
        seen.set(v.dspId, {
          id: v.dspId,
          numericId: numericIdFromPrefixed(v.dspId),
          name: v.dsp,
          count: 0,
        });
      }
      seen.get(v.dspId).count += 1;
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  // Vehicles filtered to the selected DSP (used in step 2 + remaining)
  const vehiclesForDsp = dsp ? vehicles.filter((v) => v.dspId === dsp.id) : [];

  // Set of vehicle IDs that ALREADY have an inspection today (server-truth)
  const inspectedTodayIds = new Set(todayInspections.map((i) => i.vehicleId));
  // Lookup of vehicleId → today's inspection summary so the picker can render
  // an inline badge ("Passed / Flagged / Not inspected · reason") on each
  // card. First-seen-wins per vehicle (a tech who flagged a van as "won't
  // start" then later inspected it for real should see the FLAGGED state,
  // not the incomplete one — but the API list orders newest first, so we
  // pick the latest by overwriting older entries).
  const inspectedTodayMap = (() => {
    const map = new Map();
    // Iterate oldest → newest so the latest wins on the final write.
    const sorted = [...todayInspections].sort((a, b) => {
      const ta = a.submittedAt || a.createdAt || '';
      const tb = b.submittedAt || b.createdAt || '';
      return ta.localeCompare(tb);
    });
    for (const i of sorted) {
      map.set(i.vehicleId, {
        id: i.id,
        result: i.result,
        incompleteReason: i.incompleteReason,
        defectCount: i.defectCount || 0,
      });
    }
    return map;
  })();
  // Remaining vans to inspect in this DSP today
  const remainingVehicles = vehiclesForDsp.filter((v) => !inspectedTodayIds.has(v.id));

  // Refetch today's inspections for the selected DSP
  const refreshTodayInspections = async () => {
    if (!dsp?.numericId) return;
    setLoadingToday(true);
    try {
      const today = todayUtcDate();
      const res = await inspectionsApi.list({
        dspId: dsp.numericId,
        dateFrom: today,
        dateTo: today,
        perPage: 100,
      });
      setTodayInspections(res.items || []);
    } catch (err) {
      console.warn('refresh today inspections failed', err);
    } finally {
      setLoadingToday(false);
    }
  };

  // When the user picks a DSP, fetch today's inspections so we can show the
  // "remaining" count anywhere downstream.
  useEffect(() => {
    if (dsp) refreshTodayInspections();
    else setTodayInspections([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dsp?.id]);

  // ─── Step transitions ───────────────────────────────
  const canGoNextStep1 = !!dsp;
  const canGoNextStep2 = keysConfirmed;  // need to confirm keys count (or skip)
  const canGoNextStep3 = !!vehicle;
  // Step 4 (start-gate) has no "Next" — its in-screen buttons drive transitions.
  // Step 5 (odometer) gates: draft created AND a positive integer mileage AND
  // an odometer photo on file. The photo can only land after the draft exists
  // (PhotoUploader needs a parentId), so the order is: enter mileage → tap
  // "Start inspection to attach the odometer photo" → take picture → Next.
  const odometerNum = odometer ? parseInt(odometer, 10) : NaN;
  const odometerValid = Number.isFinite(odometerNum) && odometerNum > 0;
  const canGoNextStep5 = inspectionId !== null && odometerValid && odometerPhotoCount >= 1;
  const canSubmit = inspectionId !== null;

  // Auto-create the DRAFT when entering the odometer step
  const ensureDraft = async () => {
    if (inspectionId) return inspectionId;
    setCreatingDraft(true);
    setCreateError(null);
    try {
      const odoNum = odometer ? parseInt(odometer, 10) : null;
      const keysNum = keysReceived ? parseInt(keysReceived, 10) : null;
      const draft = await inspectionsApi.create({
        vehicleId: vehicle.id,
        odometerMiles: odoNum && !Number.isNaN(odoNum) ? odoNum : null,
        odometerSource: odoNum ? 'manual' : null,
        keysReceived: keysNum && !Number.isNaN(keysNum) ? keysNum : null,
      });
      setInspectionId(draft.id);
      return draft.id;
    } catch (err) {
      setCreateError(err?.detail || err?.message || 'Failed to create draft');
      return null;
    } finally {
      setCreatingDraft(false);
    }
  };

  const goNext = async () => {
    if (step === 1) {
      // DSP picked → keys
      setStep(2);
    } else if (step === 2) {
      // Keys confirmed → vehicle list
      setStep(3);
    } else if (step === 3) {
      // Vehicle picked → start-or-skip gate
      setStep(4);
    } else if (step === 4) {
      // No-op: gate is driven by in-screen buttons (Start → 5, reason → reset to 3)
    } else if (step === 5) {
      // Create draft (with vehicle + odometer + keys), then hand off to the
      // DvicWizard hub at step 6. From there the tech adds defects and taps
      // "Complete Inspection" to submit.
      const id = await ensureDraft();
      if (id) setStep(6);
    }
    // step 6: no goNext — DvicWizard's "Complete Inspection" calls handleSubmit directly.
  };

  const goBack = () => {
    if (step > 1) {
      // Going back from the vehicle picker clears the picked van so the user
      // doesn't accidentally start the gate flow with a stale selection.
      if (step === 3) setVehicle(null);
      setStep(step - 1);
    }
  };

  // ─── Step 4 gate: tech said "Vehicle not inspected" + picked a reason ─
  const handleMarkNotInspected = async (reasonValue) => {
    if (!vehicle) return;
    setIncompleteSubmitting(true);
    setIncompleteError(null);
    try {
      const created = await inspectionsApi.create({
        vehicleId: vehicle.id,
        incompleteReason: reasonValue,
        resultOverride: 'incomplete',
      });
      // Add to session log so the running counters reflect the new entry.
      setInspectedSession((prev) => [
        ...prev,
        {
          inspectionId: created.id,
          vehicleId: created.vehicleId || vehicle.id,
          fleetId: created.fleetId || vehicle.fleetId,
          defectCount: 0,
          result: 'incomplete',
          incompleteReason: reasonValue,
        },
      ]);
      // Server-truth for "remaining" goes down — refetch so the picker hides
      // the van we just flagged.
      await refreshTodayInspections();
      // Streamlined fast-path: skip the post-submit chooser and drop the tech
      // straight back at the vehicle picker for the next van.
      resetForNextVehicle();
      setStep(3);
    } catch (err) {
      setIncompleteError(err?.detail || err?.message || 'Failed to record');
    } finally {
      setIncompleteSubmitting(false);
    }
  };

  // ─── Defect operations (v2 flat list) ──────────────
  // The DefectWizard handles its own POST /defects call and returns the
  // created row enriched with catalog labels. We just append to our list —
  // DvicWizard auto-resets back to its section picker so the tech can add
  // the next defect without leaving the screen.
  //
  // STABLE-CALLBACK FIX (2026-05-12): wrap in useCallback so that DvicWizard
  // (and downstream PhotoGateStep / PhotoUploader) receive a stable function
  // identity across re-renders. Without this, every render of the parent
  // produced a new function reference, which historically caused
  // PhotoUploader's effects to refire and (in some flows) bounced the
  // inspector all the way back to the DSP picker after a photo upload
  // (project_inspection_bugs.md, 2026-05-05).
  const handleDefectCommitted = useCallback((created) => {
    setDefects((prev) => [
      ...prev,
      {
        id: created.id,
        partLabel: created.partLabel,
        partIcon: created.partIcon,
        positionLabel: created.positionLabel,
        defectTypeLabel: created.defectTypeLabel,
        defectTypeIcon: created.defectTypeIcon,
        // Backend mirror columns (used by photo uploader + reviews)
        section: created.section,
        description: created.description,
      },
    ]);
  }, []);

  const handleRemoveDefect = useCallback(async (defect) => {
    if (!confirm(`Remove "${defect.partLabel || defect.part || 'defect'}"?`)) return;
    try {
      await defectsApi.delete(defect.id);
      setDefects((prev) => prev.filter((d) => d.id !== defect.id));
    } catch (err) {
      alert(`Remove failed: ${err?.detail || err?.message || 'unknown'}`);
    }
  }, []);

  // Stable handler for the step-5 odometer PhotoUploader. Same rationale as
  // handleDefectCommitted: keep the function identity stable so PhotoUploader
  // doesn't see a new `onChanged` ref on every parent render.
  const handleOdometerPhotoChanged = useCallback((action) => {
    if (action === 'added') setOdometerPhotoCount((c) => c + 1);
    else if (action === 'deleted') setOdometerPhotoCount((c) => Math.max(0, c - 1));
  }, []);

  // Guard the close-X button against an accidental tap that would discard an
  // in-progress inspection (the historical complaint pattern: "I uploaded my
  // photo and the wizard reset to the DSP picker"). If the user has anything
  // they'd lose — a chosen vehicle, a drafted inspection, or any logged
  // defects — confirm before propagating onClose.
  const hasUnsavedProgress = !!(
    vehicle || inspectionId || (defects && defects.length > 0)
  );
  const guardedClose = useCallback(() => {
    if (hasUnsavedProgress) {
      const ok = window.confirm(t(
        'createInspection.closeConfirm',
        'Close the inspection wizard? Any in-progress inspection will be discarded.',
      ));
      if (!ok) return;
    }
    onClose?.();
  }, [hasUnsavedProgress, onClose, t]);

  // ─── Submit ─────────────────────────────────────────
  const handleSubmit = async () => {
    if (!inspectionId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const final = await inspectionsApi.submit(inspectionId, {
        odometerMiles: odometer ? parseInt(odometer, 10) : null,
        odometerSource: odometer ? 'manual' : null,
      });
      setSubmitResult(final);
      // Add to session log
      setInspectedSession((prev) => [
        ...prev,
        {
          inspectionId: final.id,
          vehicleId: final.vehicleId,
          fleetId: final.fleetId,
          defectCount: final.defects?.length || 0,
          result: final.result,
        },
      ]);
      // Server now has one more inspection today → refresh the cache so
      // the "remaining" count goes down before the postSubmit screen renders.
      await refreshTodayInspections();
      setPhase('postSubmit');
      onSubmitted?.(final);
    } catch (err) {
      setSubmitError(err?.detail || err?.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Per-inspection reset (for next van in same DSP) ─
  const resetForNextVehicle = () => {
    setVehicle(null);
    setOdometer('');
    setInspectionId(null);
    setCreatingDraft(false);
    setCreateError(null);
    setDefects([]);
    // (openSection / addingDefect were legacy v1 state — removed when the
    // section-first picker moved into DvicWizard. Keeping the function lean.)
    setSubmitResult(null);
    setSubmitError(null);
    // Step-4 gate state — clear so the next van starts fresh
    setIncompleteSubmitting(false);
    setIncompleteError(null);
    // Step-5 odometer-photo gate — must reach the threshold for each van
    setOdometerPhotoCount(0);
  };

  // ─── Action: inspect another van in the SAME DSP ────
  // Skip DSP + keys (already done for this session) → straight to vehicle picker.
  const handleInspectAnother = () => {
    resetForNextVehicle();
    setPhase('inspecting');
    setStep(3);
  };

  // ─── Action: switch DSP (full reset including keys) ─
  const handleSwitchDsp = () => {
    resetForNextVehicle();
    setDsp(null);
    setKeysReceived('');
    setKeysConfirmed(false);
    setInspectedSession([]);
    setTodayInspections([]);
    setPhase('inspecting');
    setStep(1);
  };

  // ─── Action: complete fleet ────────────────────────
  const handleCompleteFleet = () => {
    if (remainingVehicles.length === 0) {
      setPhase('fleetDone');
    } else {
      setPhase('completeWarning');
    }
  };

  // ─── Action: confirm bulk-skip remaining vans ──────
  const [bulkSkipReasons, setBulkSkipReasons] = useState({}); // {vehicleId: reasonValue}
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState(null);

  const handleConfirmIncomplete = async () => {
    setBulkSubmitting(true);
    setBulkError(null);
    try {
      // For each remaining vehicle that has a reason picked, create an
      // incomplete inspection. Vehicles without a reason picked are skipped
      // (the user must explicitly choose for each).
      const targets = remainingVehicles.filter((v) => bulkSkipReasons[v.id]);
      for (const v of targets) {
        await inspectionsApi.create({
          vehicleId: v.id,
          incompleteReason: bulkSkipReasons[v.id],
          resultOverride: 'incomplete',
        });
      }
      await refreshTodayInspections();
      setPhase('fleetDone');
    } catch (err) {
      setBulkError(err?.detail || err?.message || 'Bulk submit failed');
    } finally {
      setBulkSubmitting(false);
    }
  };

  // ─── Counts derived for UI ──────────────────────────
  const totalDefects = defects.length;

  // ─── Phase: post-submit chooser ─────────────────────
  if (phase === 'postSubmit' && submitResult) {
    return (
      <PostSubmitChoice
        user={user}
        dsp={dsp}
        submitResult={submitResult}
        totalDefects={totalDefects}
        remainingVehicles={remainingVehicles}
        inspectedSession={inspectedSession}
        loadingToday={loadingToday}
        onInspectAnother={handleInspectAnother}
        onSwitchDsp={handleSwitchDsp}
        onCompleteFleet={handleCompleteFleet}
        onClose={onClose}
      />
    );
  }

  // ─── Phase: complete warning (some vans not inspected) ─
  if (phase === 'completeWarning') {
    return (
      <CompleteWarningScreen
        dsp={dsp}
        remainingVehicles={remainingVehicles}
        inspectedSession={inspectedSession}
        bulkSkipReasons={bulkSkipReasons}
        setBulkSkipReasons={setBulkSkipReasons}
        bulkSubmitting={bulkSubmitting}
        bulkError={bulkError}
        onCancel={() => setPhase('postSubmit')}
        onConfirm={handleConfirmIncomplete}
        onClose={onClose}
      />
    );
  }

  // ─── Phase: fleet done (final celebration) ──────────
  if (phase === 'fleetDone') {
    return (
      <FleetDoneScreen
        user={user}
        dsp={dsp}
        inspectedSession={inspectedSession}
        skippedCount={todayInspections.filter((i) => i.result === 'incomplete').length}
        onClose={onClose}
      />
    );
  }

  // ─── Step 6: hand off to InspectionChecklist (NOVABODY-style UI) ──
  // The checklist renders its own full-screen Shell + sticky complete
  // bar, so we early-return here and skip CreateInspectionWizard's
  // outer Shell + footer to avoid stacking two fixed overlays.
  // Replaced DvicWizard on 2026-05-15 with the checklist pattern (tabs
  // + paginated panes + chip strips + slide-up defect sheet) per the
  // NOVABODY/web mbk/wo-v2-claude-demo branch reference.
  if (step === 6 && phase === 'inspecting' && inspectionId) {
    return (
      <InspectionChecklist
        inspectionId={inspectionId}
        vehicleId={vehicle?.id}
        vehicleClass={vehicle?.vehicleClass || 'regular_cargo_van'}
        defects={defects}
        onCommitted={handleDefectCommitted}
        onRemoveDefect={handleRemoveDefect}
        onComplete={handleSubmit}
        submitting={submitting}
        submitError={submitError}
        onClose={guardedClose}
        onBack={() => setStep(5)}
      />
    );
  }

  return (
    <FullScreenShell
      title={t('createInspection.shellTitle')}
      subtitle={t('createInspection.shellSubtitleFmt', { step })}
      onClose={guardedClose}
    >
      {/* Body */}
      <div className="max-w-2xl mx-auto px-4 py-6 pb-32">
        {/* ── Step 1: DSP picker ── */}
        {step === 1 && (
          <Step1DspPicker
            dsps={availableDsps}
            loading={vehiclesLoading}
            value={dsp}
            onChange={(d) => {
              setDsp(d);
              setVehicle(null);
              // If user switches DSP, force them to re-confirm keys
              setKeysConfirmed(false);
            }}
          />
        )}

        {/* ── Step 2: key recorder (mandatory before vehicle picker) ── */}
        {step === 2 && (
          <Step2KeyRecorder
            dsp={dsp}
            keysReceived={keysReceived}
            onKeysChange={setKeysReceived}
            keysConfirmed={keysConfirmed}
            onConfirm={() => setKeysConfirmed(true)}
            onUnconfirm={() => setKeysConfirmed(false)}
          />
        )}

        {/* ── Step 3: vehicle picker (filtered to selected DSP) ── */}
        {step === 3 && (
          <Step3VehiclePicker
            dsp={dsp}
            vehicles={vehiclesForDsp}
            inspectedTodayMap={inspectedTodayMap}
            value={vehicle}
            onChange={setVehicle}
          />
        )}

        {/* ── Step 4: start-gate (Start Inspection / Vehicle not inspected) ── */}
        {step === 4 && (
          <Step4StartGate
            vehicle={vehicle}
            incompleteSubmitting={incompleteSubmitting}
            incompleteError={incompleteError}
            onStart={() => setStep(5)}
            onMarkNotInspected={handleMarkNotInspected}
          />
        )}

        {/* ── Step 5: odometer ── */}
        {step === 5 && (
          <Step4Odometer
            vehicle={vehicle}
            odometer={odometer}
            onOdometerChange={setOdometer}
            inspectionId={inspectionId}
            creatingDraft={creatingDraft}
            createError={createError}
            onEnsureDraft={ensureDraft}
            odometerPhotoCount={odometerPhotoCount}
            onOdometerPhotoChanged={handleOdometerPhotoChanged}
          />
        )}

        {/* Steps 6 (defects + Complete Inspection) is handled by the
            DvicWizard early-return above — its section picker is the hub
            and its footer button submits the whole inspection. */}
      </div>

      {/* Sticky footer nav */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-navy-800 bg-navy-950/95 backdrop-blur px-4 py-3 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button
            onClick={goBack}
            disabled={step === 1}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-navy-700 text-navy-300 hover:text-white hover:border-navy-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
          >
            <ArrowLeft size={14} /> {t('dvic.footer.back')}
          </button>

          <div className="text-[10px] text-navy-500 uppercase tracking-wide hidden sm:block">
            {step === 1 && t('createInspection.footerCaption.step1', 'Pick the DSP')}
            {step === 2 && t('createInspection.footerCaption.step2', 'Record keys')}
            {step === 3 && t('createInspection.footerCaption.step3', 'Pick a vehicle')}
            {step === 4 && t('createInspection.footerCaption.step4', 'Start or skip')}
            {step === 5 && t('createInspection.footerCaption.step5', 'Odometer')}
            {/* Step 6 short-circuits above — DvicWizard owns its own footer. */}
          </div>

          {/* Step 4 has its own in-screen buttons (Start / reason picker) — no footer Next. */}
          {step < 6 && step !== 4 && (
            <button
              onClick={goNext}
              disabled={
                (step === 1 && !canGoNextStep1) ||
                (step === 2 && !canGoNextStep2) ||
                (step === 3 && !canGoNextStep3) ||
                (step === 5 && (creatingDraft || !canGoNextStep5))
              }
              title={step === 5 && !canGoNextStep5
                ? (!odometerValid
                  ? t('createInspection.odometer.enterFirst', 'Enter the current mileage')
                  : !inspectionId
                    ? t('createInspection.odometer.startFirst', 'Tap "Start inspection" to create the draft')
                    : t('createInspection.odometer.attachPhoto', 'Attach the odometer photo to continue'))
                : ''}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
            >
              {creatingDraft ? <Loader2 size={14} className="animate-spin" /> : null}
              {step === 5 && !inspectionId
                ? t('createInspection.startInspection', 'Start')
                : t('dvic.footer.next')}
              <ArrowRight size={14} />
            </button>
          )}
          {step === 4 && (
            // Spacer keeps Back/caption left-aligned without a Next button on step 4.
            <span className="w-[80px]" aria-hidden />
          )}
        </div>
      </div>
    </FullScreenShell>
  );
}

// ─────────────────────────────────────────────────────
// Shell
// ─────────────────────────────────────────────────────
function FullScreenShell({ title, subtitle, onClose, children }) {
  const { t } = useTranslation('wizard');
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-navy-950 overflow-y-auto"
    >
      <div className="sticky top-0 z-20 px-4 sm:px-6 py-4 border-b border-navy-800 bg-navy-900/95 backdrop-blur">
        <div className="max-w-2xl mx-auto flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-blue/15 border border-accent-blue/40 flex items-center justify-center shrink-0">
              <ClipboardList size={18} className="text-accent-blue" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-semibold text-white truncate">{title}</h2>
              {subtitle && <p className="text-[11px] text-navy-400">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-navy-400 hover:text-white p-2 -mr-2 rounded-md hover:bg-navy-800 shrink-0"
            title={t('createInspection.closeTitle')}
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
// Step 1: DSP picker (mandatory first)
// ─────────────────────────────────────────────────────
function Step1DspPicker({ dsps, loading, value, onChange }) {
  const { t } = useTranslation('wizard');
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={32} className="text-accent-blue animate-spin" />
      </div>
    );
  }

  if (dsps.length === 0) {
    return (
      <div className="py-12 text-center">
        <Building2 size={32} className="text-navy-500 mx-auto mb-3" />
        <p className="text-sm text-navy-400">
          {t('createInspection.step1.empty')}
        </p>
        <p className="text-[11px] text-navy-500 mt-1">
          {t('createInspection.step1.emptyHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Building2 size={16} className="text-accent-blue" />
        <h3 className="text-sm font-semibold text-white">
          {t('createInspection.step1.heading')}
        </h3>
      </div>
      <p className="text-xs text-navy-400 -mt-1 mb-2">
        {t('createInspection.step1.hint')}
      </p>

      <div className="grid sm:grid-cols-2 gap-2">
        {dsps.map((d) => {
          const selected = value?.id === d.id;
          return (
            <button
              key={d.id}
              onClick={() => onChange(d)}
              className={`text-left rounded-lg p-4 border-2 transition-all cursor-pointer ${
                selected
                  ? 'border-accent-blue bg-accent-blue/10'
                  : 'border-navy-700 bg-navy-900/60 hover:border-navy-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    selected
                      ? 'bg-accent-blue/20 border border-accent-blue/40'
                      : 'bg-navy-800 border border-navy-700'
                  }`}
                >
                  <Building2
                    size={18}
                    className={selected ? 'text-accent-blue' : 'text-navy-400'}
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{d.name}</div>
                  <div className="text-[11px] text-navy-400">
                    {t('createInspection.step1.vansFmt', { count: d.count })}
                  </div>
                </div>
                {selected && <Check size={16} className="text-accent-blue ml-auto shrink-0" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 2: Key recorder (mandatory after DSP)
// ─────────────────────────────────────────────────────
function Step2KeyRecorder({ dsp, keysReceived, onKeysChange, keysConfirmed, onConfirm, onUnconfirm }) {
  const { t } = useTranslation('wizard');
  const num = keysReceived ? parseInt(keysReceived, 10) : null;
  const isValid = num !== null && !Number.isNaN(num) && num >= 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound size={16} className="text-accent-blue" />
        <h3 className="text-sm font-semibold text-white">
          {t('createInspection.step2.headingPart1')}{' '}
          <span className="text-accent-blue">{dsp?.name}</span>
          {t('createInspection.step2.headingPart2')}
        </h3>
      </div>
      <p className="text-xs text-navy-400 -mt-2">
        {t('createInspection.step2.hint')}
      </p>

      {/* Big numeric input */}
      <div className="rounded-xl border border-navy-700 bg-navy-900/60 p-5">
        <label className="text-[10px] uppercase tracking-wide text-navy-400 block mb-2">
          {t('createInspection.step2.keysReceivedLabel')}
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = Math.max(0, (num ?? 0) - 1);
              onKeysChange(String(next));
              onUnconfirm();
            }}
            disabled={num === null || num === 0}
            className="w-12 h-12 rounded-lg border border-navy-700 text-2xl text-white hover:bg-navy-800 disabled:opacity-30 cursor-pointer"
          >
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            value={keysReceived}
            onChange={(e) => {
              onKeysChange(e.target.value.replace(/[^0-9]/g, ''));
              onUnconfirm();
            }}
            placeholder="0"
            className="flex-1 rounded-lg px-3 py-3 bg-navy-800 border border-navy-700 text-white text-3xl font-bold font-mono text-center outline-none focus:border-accent-blue"
          />
          <button
            type="button"
            onClick={() => {
              const next = (num ?? 0) + 1;
              onKeysChange(String(next));
              onUnconfirm();
            }}
            className="w-12 h-12 rounded-lg border border-navy-700 text-2xl text-white hover:bg-navy-800 cursor-pointer"
          >
            +
          </button>
        </div>
      </div>

      {/* Confirmation toggle */}
      {!keysConfirmed ? (
        <button
          onClick={onConfirm}
          disabled={!isValid}
          className="w-full py-3 rounded-lg bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {isValid
            ? t('createInspection.step2.confirmCta', { count: num })
            : t('createInspection.step2.enterNumberCta')}
        </button>
      ) : (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-accent-green/10 border border-accent-green/40">
          <Check size={16} className="text-accent-green shrink-0" />
          <span className="text-sm text-white">
            {t('createInspection.step2.loggedLabel')}{' '}
            <span className="font-bold">{num}</span>{' '}
            {t('createInspection.step2.keysWord', { count: num })}
          </span>
          <button
            onClick={onUnconfirm}
            className="ml-auto text-[11px] text-navy-300 hover:text-white underline cursor-pointer"
          >
            {t('createInspection.step2.editBtn')}
          </button>
        </div>
      )}

      <p className="text-[11px] text-navy-500 text-center">
        {t('createInspection.step2.tipPart1')} {dsp?.name}{' '}
        {t('createInspection.step2.tipPart2')}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 3: vehicle picker (already filtered to selected DSP)
// ─────────────────────────────────────────────────────
// Reason value → human label (mirror of INCOMPLETE_REASONS, lookup-friendly)
const INCOMPLETE_REASON_LABELS = INCOMPLETE_REASONS.reduce((acc, r) => {
  acc[r.value] = r.label;
  return acc;
}, {});

function Step3VehiclePicker({ dsp, vehicles, inspectedTodayMap, value, onChange }) {
  const { t } = useTranslation('wizard');
  const [search, setSearch] = useState('');

  const filtered = vehicles.filter((v) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      v.fleetId?.toLowerCase().includes(s) ||
      v.vin?.toLowerCase().includes(s) ||
      v.plate?.toLowerCase().includes(s) ||
      v.model?.toLowerCase().includes(s)
    );
  });

  // Sort: un-inspected first (so the tech's eye lands on what's left to do),
  // then by fleet ID for stable ordering within each group.
  const sorted = [...filtered].sort((a, b) => {
    const aDone = inspectedTodayMap?.has(a.id) ? 1 : 0;
    const bDone = inspectedTodayMap?.has(b.id) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (a.fleetId || '').localeCompare(b.fleetId || '');
  });

  const inspectedCount = vehicles.filter((v) => inspectedTodayMap?.has(v.id)).length;
  const remainingCount = vehicles.length - inspectedCount;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Truck size={16} className="text-accent-blue" />
        <h3 className="text-sm font-semibold text-white">
          Pick a van from <span className="text-accent-blue">{dsp?.name}</span>
        </h3>
      </div>

      {/* Progress strip — gives the tech an at-a-glance read of where the
          DSP stands today. */}
      {vehicles.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-navy-700 bg-navy-900/40 px-3 py-2 text-[11px]">
          <span className="text-navy-300">
            <span className="text-accent-orange font-bold">{remainingCount}</span> remaining
          </span>
          <span className="text-navy-600">·</span>
          <span className="text-navy-300">
            <span className="text-accent-green font-bold">{inspectedCount}</span> done today
          </span>
          <div className="ml-auto h-1.5 flex-1 max-w-[120px] rounded-full bg-navy-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent-green to-accent-blue transition-all"
              style={{ width: `${vehicles.length ? (inspectedCount / vehicles.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('createInspection.step3.searchPlaceholder')}
        className="w-full rounded-lg px-3 py-2.5 bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue text-sm"
      />

      <div className="grid sm:grid-cols-2 gap-2">
        {sorted.map((v) => (
          <VehicleCard
            key={v.id}
            v={v}
            selected={value?.id === v.id}
            todayInspection={inspectedTodayMap?.get(v.id) || null}
            onSelect={onChange}
          />
        ))}
      </div>

      {sorted.length === 0 && (
        <div className="py-8 text-center text-sm text-navy-400">
          {vehicles.length === 0
            ? t('createInspection.step3.noVisibleFmt', { dsp: dsp?.name, defaultValue: `${dsp?.name} has no vehicles in your visibility.` })
            : t('createInspection.step3.noMatch', 'No vehicles match the search.')}
        </div>
      )}
    </div>
  );
}

// Status badge variants for the vehicle card.
//   passed       → green ✓ "Inspected"
//   flagged      → orange ⚠ "Flagged · N defects"
//   conditional  → gold ⚠ "Conditional"
//   incomplete   → red ⛔ "Not inspected · {reason}"
function VehicleStatusBadge({ status }) {
  const { t } = useTranslation('wizard');
  if (!status) return null;
  if (status.result === 'passed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-green/15 border border-accent-green/40 text-[10px] font-semibold text-accent-green shrink-0">
        <Check size={10} /> {t('createInspection.statusBadge.inspected', 'Inspected')}
      </span>
    );
  }
  if (status.result === 'flagged') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-orange/15 border border-accent-orange/40 text-[10px] font-semibold text-accent-orange shrink-0">
        <AlertTriangle size={10} /> {t('createInspection.statusBadge.flagged', 'Flagged')} · {status.defectCount}
      </span>
    );
  }
  if (status.result === 'conditional') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-gold/15 border border-accent-gold/40 text-[10px] font-semibold text-accent-gold shrink-0">
        <AlertTriangle size={10} /> {t('createInspection.statusBadge.conditional', 'Conditional')}
      </span>
    );
  }
  if (status.result === 'incomplete') {
    // Reason text comes from a translation key that mirrors the value name;
    // fall back to the static English label if no translation is found.
    const reasonKey = status.incompleteReason
      ? `createInspection.step4.reasons.${status.incompleteReason}`
      : null;
    const label = reasonKey
      ? t(reasonKey, INCOMPLETE_REASON_LABELS[status.incompleteReason] || 'Not inspected')
      : t('createInspection.statusBadge.notInspected', 'Not inspected');
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/40 text-[10px] font-semibold text-accent-red shrink-0 max-w-full"
        title={label}
      >
        <Ban size={10} /> <span className="truncate">{label}</span>
      </span>
    );
  }
  return null;
}

function VehicleCard({ v, selected, todayInspection, onSelect }) {
  const isDone = !!todayInspection;
  return (
    <button
      onClick={() => onSelect(v)}
      className={`text-left rounded-lg p-3 border-2 transition-all cursor-pointer relative ${
        selected
          ? 'border-accent-blue bg-accent-blue/10'
          : isDone
            ? 'border-navy-800 bg-navy-900/30 hover:border-navy-600'
            : 'border-navy-700 bg-navy-900/60 hover:border-navy-600'
      }`}
    >
      {/* Top row — fleet ID + status badge */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className={`text-sm font-bold font-mono ${isDone ? 'text-navy-300' : 'text-white'}`}>
          {v.fleetId}
        </div>
        <VehicleStatusBadge status={todayInspection} />
      </div>
      <div className={`text-xs truncate ${isDone ? 'text-navy-400' : 'text-navy-300'}`}>
        {v.year} {v.make} {v.model}
      </div>
      <div className="text-[10px] text-navy-500 mt-1">
        {v.plate} &middot; {v.mileage?.toLocaleString() || 0} mi
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────
// Step 4: Start gate — tech is in front of the picked vehicle and decides
//   "Start Inspection" → step 5 (odometer + the rest of the walkthrough)
//   "Vehicle not inspected" + reason → POST incomplete + jump back to picker
// Designed to be one tap away from either path so the tech moves through
// a parking lot of vans quickly.
// ─────────────────────────────────────────────────────
function Step4StartGate({
  vehicle,
  incompleteSubmitting,
  incompleteError,
  onStart,
  onMarkNotInspected,
}) {
  const { t } = useTranslation('wizard');
  return (
    <div className="space-y-5">
      {/* Vehicle context — confirm the tech's standing in front of the right van */}
      <div className="rounded-lg bg-navy-900/60 border border-navy-700 p-3">
        <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1">
          {t('createInspection.step4.vehicleReady')}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-white font-mono">{vehicle?.fleetId}</div>
            <div className="text-xs text-navy-300 truncate">
              {vehicle?.year} {vehicle?.make} {vehicle?.model}
            </div>
          </div>
          <div className="text-[11px] text-navy-400 shrink-0">
            {vehicle?.plate} · {vehicle?.mileage?.toLocaleString() || 0} mi
          </div>
        </div>
      </div>

      {/* Big primary CTA — the happy path */}
      <button
        onClick={onStart}
        disabled={incompleteSubmitting}
        className="w-full py-5 rounded-xl bg-gradient-to-r from-accent-blue to-accent-purple text-white font-bold text-base flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40 cursor-pointer shadow-lg shadow-accent-blue/20"
      >
        <PlayCircle size={20} />
        {t('createInspection.step4.startInspection')}
      </button>

      {/* Visual divider */}
      <div className="flex items-center gap-3 my-1">
        <div className="flex-1 border-t border-navy-700" />
        <span className="text-[10px] uppercase tracking-wide text-navy-500">{t('createInspection.step4.orDivider')}</span>
        <div className="flex-1 border-t border-navy-700" />
      </div>

      {/* Vehicle not inspected — 3 reasons. Tap any → POST + back to picker */}
      <div className="rounded-xl border border-navy-700 bg-navy-900/40 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Ban size={14} className="text-accent-orange" />
          <div className="text-sm font-semibold text-white">{t('createInspection.step4.notInspectedHeading')}</div>
        </div>
        <p className="text-[11px] text-navy-400 mb-3">
          {t('createInspection.step4.notInspectedHint')}
        </p>
        <div className="grid grid-cols-1 gap-2">
          {INCOMPLETE_REASONS.map((r) => (
            <button
              key={r.value}
              onClick={() => onMarkNotInspected(r.value)}
              disabled={incompleteSubmitting}
              className="flex items-center gap-2 px-3 py-3 rounded-lg border border-navy-700 bg-navy-800 hover:border-accent-orange/50 hover:bg-accent-orange/10 text-left text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <AlertTriangle size={14} className="text-accent-orange shrink-0" />
              <span className="flex-1">{t(`createInspection.step4.reasons.${r.value}`, r.label)}</span>
              <ArrowRight size={14} className="text-navy-400" />
            </button>
          ))}
        </div>
        {incompleteSubmitting && (
          <div className="mt-3 flex items-center gap-2 text-xs text-navy-300">
            <Loader2 size={12} className="animate-spin" /> {t('createInspection.step4.recording')}
          </div>
        )}
        {incompleteError && (
          <div className="mt-3 flex items-start gap-2 p-2 rounded-md bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{incompleteError}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 4: odometer + start draft
// ─────────────────────────────────────────────────────
function Step4Odometer({
  vehicle,
  odometer,
  onOdometerChange,
  inspectionId,
  creatingDraft,
  createError,
  onEnsureDraft,
  odometerPhotoCount,
  onOdometerPhotoChanged,
}) {
  const { t } = useTranslation('wizard');
  const mileageNum = odometer ? parseInt(odometer, 10) : NaN;
  const mileageValid = Number.isFinite(mileageNum) && mileageNum > 0;
  const photoLanded = odometerPhotoCount >= 1;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Gauge size={16} className="text-accent-blue" />
        <h3 className="text-sm font-semibold text-white">{t('createInspection.step5.heading')}</h3>
      </div>

      <div className="rounded-lg bg-navy-900/60 border border-navy-700 p-3 text-sm">
        <span className="font-mono text-white font-bold">{vehicle?.fleetId}</span>
        <span className="text-navy-400 ml-2">
          {vehicle?.year} {vehicle?.make} {vehicle?.model} &middot; last: {vehicle?.mileage?.toLocaleString()} mi
        </span>
      </div>

      <div>
        <label className="text-xs font-semibold text-navy-300 mb-1.5 block">
          Current mileage <span className="text-accent-red">*</span>
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={odometer}
          onChange={(e) => onOdometerChange(e.target.value)}
          placeholder={t('createInspection.step5.placeholder')}
          className={`w-full rounded-lg px-3 py-3 bg-navy-800 border text-white text-lg font-mono text-right outline-none focus:border-accent-blue ${
            mileageValid ? 'border-navy-700' : 'border-accent-orange/50'
          }`}
        />
        {odometer && vehicle && parseInt(odometer, 10) < vehicle.mileage && (
          <p className="mt-1.5 text-[11px] text-accent-orange flex items-center gap-1">
            <AlertCircle size={12} /> Lower than last reading ({vehicle.mileage.toLocaleString()} mi)
          </p>
        )}
      </div>

      {/* Odometer photo — REQUIRED to start the inspection. The draft has to
          exist before we can bind the uploader, so we surface a "Start
          inspection" button until the draft lands. After that the uploader
          replaces the button and the inspector takes the picture. */}
      <div>
        <label className="text-xs font-semibold text-navy-300 mb-2 block">
          Odometer photo <span className="text-accent-red">*</span>
        </label>
        {inspectionId ? (
          <>
            <PhotoUploader
              parentKind="inspection"
              parentId={inspectionId}
              category="odometer"
              maxPhotos={1}
              onChanged={onOdometerPhotoChanged}
            />
            <div className={`mt-2 rounded-md border px-2.5 py-2 text-[11px] flex items-start gap-2 ${
              photoLanded
                ? 'bg-accent-green/10 border-accent-green/40 text-accent-green'
                : 'bg-accent-orange/10 border-accent-orange/40 text-accent-orange'
            }`}>
              {photoLanded
                ? <><Check size={12} className="shrink-0 mt-0.5" /> {t('createInspection.step5.photoAttached', 'Photo attached. You can continue to the inspection.')}</>
                : <><AlertCircle size={12} className="shrink-0 mt-0.5" /> {t('createInspection.step5.photoRequired', 'A photo of the odometer is required to start the inspection.')}</>}
            </div>
          </>
        ) : (
          <>
            <button
              onClick={onEnsureDraft}
              disabled={creatingDraft || !mileageValid}
              title={!mileageValid ? t('createInspection.step5.enterMileageFirst', 'Enter the current mileage first') : ''}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-accent-orange/40 bg-accent-orange/5 text-accent-orange hover:bg-accent-orange/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm font-semibold"
            >
              {creatingDraft ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              {creatingDraft
                ? t('createInspection.step5.creatingDraft', 'Creating draft…')
                : t('createInspection.step5.startToAttach', 'Start inspection to attach the odometer photo')}
            </button>
            <p className="mt-2 text-[11px] text-navy-400">
              {t('createInspection.step5.draftHint', 'We start a draft so the photo can be tied to the inspection. The draft becomes the inspection record once you submit at the end.')}
            </p>
          </>
        )}
      </div>

      {createError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{createError}</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 5 (v2): flat defects list + DefectWizard overlay launch
// ─────────────────────────────────────────────────────
function Step5Defects({ inspectionId, defects, onOpenWizard, onRemoveDefect }) {
  const { t } = useTranslation('wizard');
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardList size={16} className="text-accent-blue" />
        <h3 className="text-sm font-semibold text-white">
          {t('createInspection.review.defectsLabel')} {defects.length > 0 && <span className="text-navy-400 font-normal">({defects.length})</span>}
        </h3>
      </div>
      <p className="text-xs text-navy-400 -mt-1">
        {t('createInspection.step5Defects.hint', 'Tap "Add defect" for any issue you find during the walkthrough. Each defect goes through a quick 3-5 tap form, then you can attach photos.')}
      </p>

      {/* Defect cards */}
      {defects.map((d) => (
        <V2DefectCard
          key={d.id}
          defect={d}
          onRemove={() => onRemoveDefect(d)}
        />
      ))}

      {/* Add button */}
      <button
        onClick={onOpenWizard}
        className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-xl border-2 border-dashed border-accent-blue/40 bg-accent-blue/5 hover:bg-accent-blue/10 text-accent-blue cursor-pointer font-semibold text-sm transition-all"
      >
        <Plus size={16} /> {t('createInspection.step5Defects.addDefect', 'Add defect')}
      </button>

      {defects.length === 0 && (
        <p className="text-[11px] text-navy-500 text-center pt-2">
          {t('createInspection.step5Defects.skipHint', "If everything's fine, you can skip ahead — empty inspections are PASSED.")}
        </p>
      )}
    </div>
  );
}

function V2DefectCard({ defect, onRemove }) {
  const { t } = useTranslation('wizard');
  const positionLine = defect.positionLabel ? ` (${defect.positionLabel})` : '';
  return (
    <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-2xl shrink-0">{defect.partIcon || '🔧'}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-sm font-semibold text-white">
                {defect.partLabel || defect.part}{positionLine}
              </span>
            </div>
            <p className="text-xs text-navy-300">
              {defect.defectTypeIcon} {defect.defectTypeLabel || defect.description}
            </p>
            <p className="text-[10px] text-navy-500 font-mono">{defect.id}</p>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="text-navy-400 hover:text-accent-red p-1 -mr-1 rounded shrink-0"
          title={t('dvic.committedList.removeTitle')}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {/* Photo uploader inline — tech can attach damage photos right here */}
      <div className="mt-2">
        <PhotoUploader
          parentKind="defect"
          parentId={defect.id}
          category="damage"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 6: review + submit (v2 — flat defects list)
// ─────────────────────────────────────────────────────
function Step6Review({ dsp, keysReceived, vehicle, odometer, defects, totalDefects, inspectionId, submitting, submitError, onSubmit }) {
  const { t } = useTranslation('wizard');
  // Group defects by their (legacy mirror) section for review readability.
  const sectionGroups = (() => {
    const map = {};
    for (const d of defects) {
      const section = d.section || t('createInspection.step5Defects.otherSection', 'Other');
      if (!map[section]) map[section] = [];
      map[section].push(d);
    }
    return Object.entries(map);
  })();
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3">
        <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1">{t('createInspection.review.dspLabel')}</div>
        <div className="text-sm font-bold text-white">{dsp?.name}</div>
      </div>

      <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3 flex items-center gap-2">
        <KeyRound size={14} className="text-accent-blue" />
        <div className="text-sm text-white">
          <span className="font-bold">{keysReceived || '—'}</span>{' '}
          <span className="text-navy-400">{t('createInspection.review.keysReceivedFromFmt', { dsp: dsp?.name, defaultValue: `keys received from ${dsp?.name}` })}</span>
        </div>
      </div>

      <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3">
        <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1">{t('createInspection.review.vehicleLabel')}</div>
        <div className="text-sm font-bold text-white font-mono">{vehicle?.fleetId}</div>
        <div className="text-xs text-navy-300">{vehicle?.year} {vehicle?.make} {vehicle?.model}</div>
      </div>

      <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3">
        <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1">{t('createInspection.review.odometerLabel')}</div>
        <div className="text-sm font-mono text-white">
          {odometer ? `${parseInt(odometer, 10).toLocaleString()} mi` : t('createInspection.review.notProvided', '— not provided —')}
        </div>
      </div>

      <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wide text-navy-400">{t('createInspection.review.defectsLabel')}</div>
          <div className="text-xs font-bold text-white">{t('createInspection.review.totalCount', { count: totalDefects, defaultValue: '{{count}} total' })}</div>
        </div>
        {totalDefects === 0 ? (
          <div className="text-xs text-accent-green flex items-center gap-1">
            <Check size={12} /> All sections passed
          </div>
        ) : (
          <div className="space-y-2 mt-2">
            {sectionGroups.map(([section, list]) => (
              <div key={section} className="text-xs">
                <div className="text-navy-400 font-semibold">{section}</div>
                <ul className="ml-3 mt-0.5 space-y-0.5">
                  {list.map((d) => (
                    <li key={d.id} className="text-navy-200 flex items-center gap-1.5 flex-wrap">
                      <span className="text-navy-500 font-mono">{d.id}</span>
                      <span>{d.partIcon || ''}</span>
                      <span className="text-white font-medium">
                        {d.partLabel || d.part}
                        {d.positionLabel && <span className="text-navy-400"> ({d.positionLabel})</span>}
                      </span>
                      <span className="text-navy-500">·</span>
                      <span className="text-navy-300">{d.defectTypeLabel || ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 p-3 text-xs text-navy-200">
        <div className="font-semibold text-accent-blue mb-1">{t('createInspection.step6.ready')}</div>
        {t('createInspection.review.immutableHint', "Once submitted, this inspection becomes immutable. Defects can still be acknowledged or routed to vendors by the DSP owner.")}
      </div>

      {submitError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="text-[11px] text-navy-500 font-mono text-center">
        {t('createInspection.review.draftLabel', 'Draft')}: {inspectionId || '—'}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Post-submit chooser: 3 actions + recent inspection summary
// ─────────────────────────────────────────────────────
function PostSubmitChoice({
  user, dsp, submitResult, totalDefects, remainingVehicles, inspectedSession,
  loadingToday, onInspectAnother, onSwitchDsp, onCompleteFleet, onClose,
}) {
  const { t } = useTranslation('wizard');
  const remaining = remainingVehicles.length;
  const sessionTotal = inspectedSession.length;
  const firstName = user?.name?.split(' ')[0] || 'tech';

  return (
    <FullScreenShell title={t('createInspection.submittedTitle', 'Inspection submitted')} onClose={onClose}>
      <div className="max-w-md mx-auto px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-7">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring' }}
            className="w-16 h-16 rounded-full bg-accent-green/20 border-2 border-accent-green flex items-center justify-center mx-auto mb-3"
          >
            <Check size={28} className="text-accent-green" />
          </motion.div>
          <h2 className="text-xl font-bold text-white mb-1">
            {t('createInspection.postSubmit.headingFmt', { name: firstName, defaultValue: `All set, ${firstName}.` })}
          </h2>
          <p className="text-navy-400 mb-1 font-mono text-xs">
            {t('createInspection.postSubmit.summaryFmt', {
              count: totalDefects,
              id: submitResult.id,
              fleetId: submitResult.fleetId,
              defaultValue: `${submitResult.id} · ${submitResult.fleetId} · ${totalDefects} defect${totalDefects === 1 ? '' : 's'}`,
            })}
          </p>
          <p className={`text-sm font-semibold ${
            submitResult.result === 'passed' ? 'text-accent-green' :
            submitResult.result === 'flagged' ? 'text-accent-red' :
            submitResult.result === 'conditional' ? 'text-accent-gold' : 'text-navy-300'
          }`}>
            {t('createInspection.postSubmit.resultLabelFmt', { result: submitResult.result, defaultValue: `Result: ${submitResult.result}` })}
          </p>
        </div>

        {/* Session counter */}
        <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3 mb-5 text-center">
          <div className="text-[11px] uppercase tracking-wide text-navy-400 mb-0.5">{t('createInspection.session.label', 'This session')}</div>
          <div className="text-sm text-white">
            <span className="font-bold">{sessionTotal}</span> {t('createInspection.postSubmit.sessionStatusPart1', 'inspected')}
            {' · '}
            <span className="text-accent-orange font-bold">{remaining}</span> {t('createInspection.postSubmit.sessionStatusPart2', 'remaining in')} {dsp?.name}
          </div>
        </div>

        {/* Action 1 — Inspect another van */}
        <button
          onClick={onInspectAnother}
          disabled={remaining === 0}
          className={`w-full mb-3 p-4 rounded-xl border-2 text-left transition-all ${
            remaining === 0
              ? 'border-navy-800 bg-navy-900/30 opacity-40 cursor-not-allowed'
              : 'border-accent-blue/50 bg-accent-blue/10 hover:bg-accent-blue/20 cursor-pointer'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-blue/20 border border-accent-blue/40 flex items-center justify-center shrink-0">
              <Truck size={18} className="text-accent-blue" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">
                {t('createInspection.postSubmit.inspectAnotherVan', 'Inspect another van')}
              </div>
              <div className="text-[11px] text-navy-300">
                {loadingToday
                  ? t('createInspection.postSubmit.loadingRemaining', 'Loading remaining…')
                  : remaining === 0
                  ? t('createInspection.postSubmit.noMoreVans', 'No more vans pending in this DSP')
                  : t('createInspection.postSubmit.vansRemainingFmt', {
                      count: remaining,
                      dsp: dsp?.name,
                      defaultValue: `${remaining} ${remaining === 1 ? 'van' : 'vans'} remaining in ${dsp?.name}`,
                    })}
              </div>
            </div>
            <ArrowRight size={16} className="text-accent-blue shrink-0" />
          </div>
        </button>

        {/* Action 2 — Switch DSP */}
        <button
          onClick={onSwitchDsp}
          className="w-full mb-3 p-4 rounded-xl border-2 border-navy-700 bg-navy-900/40 hover:bg-navy-800/60 hover:border-navy-600 transition-all text-left cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-navy-800 border border-navy-700 flex items-center justify-center shrink-0">
              <Building2 size={18} className="text-navy-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">{t('createInspection.session.anotherDspTitle', 'Inspect another DSP')}</div>
              <div className="text-[11px] text-navy-400">{t('createInspection.session.anotherDspHint', 'Start a new session for a different fleet')}</div>
            </div>
            <ArrowRight size={16} className="text-navy-400 shrink-0" />
          </div>
        </button>

        {/* Action 3 — Complete fleet */}
        <button
          onClick={onCompleteFleet}
          className={`w-full p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
            remaining === 0
              ? 'border-accent-green/50 bg-accent-green/10 hover:bg-accent-green/20'
              : 'border-accent-orange/40 bg-accent-orange/5 hover:bg-accent-orange/10'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${
                remaining === 0
                  ? 'bg-accent-green/20 border-accent-green/40'
                  : 'bg-accent-orange/20 border-accent-orange/40'
              }`}
            >
              {remaining === 0 ? (
                <Check size={18} className="text-accent-green" />
              ) : (
                <AlertTriangle size={18} className="text-accent-orange" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">
                {t('createInspection.postSubmit.completeDspFmt', { dsp: dsp?.name, defaultValue: `Complete ${dsp?.name} inspection` })}
              </div>
              <div className="text-[11px] text-navy-300">
                {remaining === 0
                  ? t('createInspection.postSubmit.allInspectedHint', 'All vans inspected — finalize the session')
                  : t('createInspection.postSubmit.someRemainingHint', {
                      count: remaining,
                      defaultValue: `${remaining} van${remaining === 1 ? '' : 's'} not yet inspected — you'll need to flag them`,
                    })}
              </div>
            </div>
            <ArrowRight size={16} className="text-navy-400 shrink-0" />
          </div>
        </button>

        {/* Footer escape hatch */}
        <button
          onClick={onClose}
          className="w-full mt-6 text-[11px] text-navy-500 hover:text-navy-300 cursor-pointer"
        >
          {t('createInspection.postSubmit.pauseAndClose', 'Pause & close (resume from your dashboard)')}
        </button>
      </div>
    </FullScreenShell>
  );
}

// ─────────────────────────────────────────────────────
// Complete-warning screen: per-vehicle reason picker
// ─────────────────────────────────────────────────────
function CompleteWarningScreen({
  dsp, remainingVehicles, inspectedSession, bulkSkipReasons, setBulkSkipReasons,
  bulkSubmitting, bulkError, onCancel, onConfirm, onClose,
}) {
  const { t } = useTranslation('wizard');
  const allReasonPicked = remainingVehicles.every((v) => bulkSkipReasons[v.id]);
  const reasonsCount = remainingVehicles.filter((v) => bulkSkipReasons[v.id]).length;
  const totalVans = inspectedSession.length + remainingVehicles.length;

  return (
    <FullScreenShell
      title={t('createInspection.fleetEmptyTitle', 'Vans not yet inspected')}
      subtitle={t('createInspection.fleetPendingFmt', { count: remainingVehicles.length, name: dsp?.name, defaultValue: `${remainingVehicles.length} pending in ${dsp?.name}` })}
      onClose={onClose}
    >
      <div className="max-w-2xl mx-auto px-4 py-6 pb-32">
        {/* Warning banner */}
        <div className="rounded-lg border-2 border-accent-orange/40 bg-accent-orange/10 p-4 mb-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-accent-orange shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white mb-1">
                {t('createInspection.completeWarning.notInspectedHeadingFmt', {
                  count: remainingVehicles.length,
                  defaultValue: `${remainingVehicles.length} van${remainingVehicles.length === 1 ? '' : 's'} not inspected`,
                })}
              </div>
              <p className="text-xs text-navy-200">
                {t('createInspection.completeWarning.descFmt', {
                  inspected: inspectedSession.length,
                  total: totalVans,
                  dsp: dsp?.name,
                  defaultValue: `You inspected ${inspectedSession.length} of ${totalVans} vans in ${dsp?.name}. Pick a reason for each remaining van so the DSP knows why it wasn't inspected. Each one will be flagged in their dashboard with the reason.`,
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Per-vehicle reason picker */}
        <div className="space-y-2 mb-5">
          {remainingVehicles.map((v) => {
            const picked = bulkSkipReasons[v.id];
            return (
              <div
                key={v.id}
                className={`rounded-lg border p-3 ${
                  picked
                    ? 'border-accent-red/40 bg-accent-red/5'
                    : 'border-navy-700 bg-navy-900/60'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-bold text-white font-mono">{v.fleetId}</span>
                  <span className="text-[11px] text-navy-400 truncate">
                    {v.year} {v.make} {v.model}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  {INCOMPLETE_REASONS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() =>
                        setBulkSkipReasons((prev) => ({ ...prev, [v.id]: r.value }))
                      }
                      className={`text-left px-2.5 py-1.5 rounded-md text-[11px] font-semibold border cursor-pointer transition-all ${
                        picked === r.value
                          ? 'bg-accent-red/20 border-accent-red/50 text-accent-red'
                          : 'bg-navy-800 border-navy-700 text-navy-300 hover:text-white hover:border-navy-600'
                      }`}
                    >
                      {t(`createInspection.step4.reasons.${r.value}`, r.label)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {bulkError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs mb-3">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{bulkError}</span>
          </div>
        )}

        <div className="text-[11px] text-navy-500 text-center">
          {t('createInspection.completeWarning.reasonsCountFmt', {
            picked: reasonsCount,
            total: remainingVehicles.length,
            defaultValue: `${reasonsCount} of ${remainingVehicles.length} reasons picked`,
          })}
        </div>
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-navy-800 bg-navy-950/95 backdrop-blur px-4 py-3 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-navy-700 text-navy-300 hover:text-white hover:border-navy-600 cursor-pointer text-sm"
          >
            {t('createInspection.completeWarning.back', 'Back')}
          </button>
          <button
            onClick={onConfirm}
            disabled={bulkSubmitting || !allReasonPicked}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-red text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
          >
            {bulkSubmitting ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
            {t('createInspection.completeWarning.flagAndCompleteFmt', {
              count: remainingVehicles.length,
              defaultValue: `Flag ${remainingVehicles.length} & complete`,
            })}
          </button>
        </div>
      </div>
    </FullScreenShell>
  );
}

// ─────────────────────────────────────────────────────
// Fleet done — final celebration
// ─────────────────────────────────────────────────────
function FleetDoneScreen({ user, dsp, inspectedSession, skippedCount, onClose }) {
  const { t } = useTranslation('wizard');
  const firstName = user?.name?.split(' ')[0] || 'tech';
  return (
    <FullScreenShell title={t('createInspection.completedTitle', 'Fleet inspection complete')} onClose={onClose}>
      <div className="max-w-md mx-auto px-4 py-12 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring' }}
          className="w-24 h-24 rounded-full bg-accent-green/20 border-2 border-accent-green flex items-center justify-center mx-auto mb-6"
        >
          <Check size={48} className="text-accent-green" />
        </motion.div>
        <h2 className="text-2xl font-bold text-white mb-2">
          {t('createInspection.fleetDone.headingFmt', { dsp: dsp?.name, defaultValue: `${dsp?.name} fleet — done.` })}
        </h2>
        <p className="text-navy-300 text-sm mb-6">
          {t('createInspection.fleetDone.subtitleFmt', { name: firstName, defaultValue: `Great work, ${firstName}. The DSP dashboard is being updated now.` })}
        </p>

        <div className="grid grid-cols-2 gap-2 mb-6">
          <div className="rounded-lg border border-accent-green/40 bg-accent-green/10 p-3">
            <div className="text-2xl font-bold text-accent-green">{inspectedSession.length}</div>
            <div className="text-[10px] uppercase tracking-wide text-navy-300">{t('createInspection.doneCard.inspected', 'Inspected')}</div>
          </div>
          <div
            className={`rounded-lg border p-3 ${
              skippedCount > 0
                ? 'border-accent-red/40 bg-accent-red/10'
                : 'border-navy-700 bg-navy-900/60'
            }`}
          >
            <div className={`text-2xl font-bold ${skippedCount > 0 ? 'text-accent-red' : 'text-navy-400'}`}>
              {skippedCount}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-navy-300">{t('createInspection.doneCard.flagged', 'Flagged')}</div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-lg bg-accent-blue text-white font-semibold cursor-pointer"
        >
          {t('createInspection.fleetDone.done', 'Done')}
        </button>
      </div>
    </FullScreenShell>
  );
}
