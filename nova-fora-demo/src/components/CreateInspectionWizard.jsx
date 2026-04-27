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
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, X, Truck, Gauge, ClipboardList, Check, AlertCircle,
  Loader2, Plus, Trash2, Camera, ChevronDown, ChevronUp, AlertTriangle, Building2,
} from 'lucide-react';
import {
  inspections as inspectionsApi,
  vehicles as vehiclesApi,
  APIError,
} from '../api/client';
import PhotoUploader from './ui/PhotoUploader';

// 11 standard DVIC sections (matches what nova4a uses)
const SECTIONS = [
  '1. Front Side',
  '2. Driver Side',
  '3. Passenger Side',
  '4. Rear',
  '5. In-Cab',
  '6. Brakes',
  '7. Tires',
  '8. Engine',
  '9. Lights',
  '10. Cargo Area',
  '11. Other',
];

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low', tint: 'text-accent-blue border-accent-blue/40 bg-accent-blue/15' },
  { value: 'medium', label: 'Medium', tint: 'text-accent-gold border-accent-gold/40 bg-accent-gold/15' },
  { value: 'high', label: 'High', tint: 'text-accent-orange border-accent-orange/40 bg-accent-orange/15' },
  { value: 'critical', label: 'Critical', tint: 'text-accent-red border-accent-red/40 bg-accent-red/15' },
];

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
  // Phase-based state machine. Within `inspecting` phase, `step` 1-5 walks
  // through DSP/vehicle/odometer/sections/review for ONE vehicle.
  // After submit:
  //   - postSubmit: 3-action chooser (next van / switch DSP / complete fleet)
  //   - completeWarning: shown when user clicks Complete with vans pending
  //   - fleetDone: terminal celebration screen
  const [phase, setPhase] = useState('inspecting');
  const [step, setStep] = useState(1); // 1=DSP, 2=vehicle, 3=odometer, 4=sections, 5=review

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
  const [defectsBySection, setDefectsBySection] = useState({});
  const [openSection, setOpenSection] = useState(null);
  const [addingDefect, setAddingDefect] = useState(null);

  // Session-wide state (kept across multiple inspections in one shift)
  const [dsp, setDsp] = useState(null);  // {id, numericId, name, count}
  const [inspectedSession, setInspectedSession] = useState([]); // {vehicleId, fleetId, defectCount, result}[]

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitError, setSubmitError] = useState(null);

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
  const canGoNextStep2 = !!vehicle;
  const canGoNextStep3 = inspectionId !== null;  // draft must exist after odometer
  const canSubmit = inspectionId !== null;

  // Auto-create the DRAFT when entering step 2 (odometer)
  const ensureDraft = async () => {
    if (inspectionId) return inspectionId;
    setCreatingDraft(true);
    setCreateError(null);
    try {
      const odoNum = odometer ? parseInt(odometer, 10) : null;
      const draft = await inspectionsApi.create({
        vehicleId: vehicle.id,
        odometerMiles: odoNum && !Number.isNaN(odoNum) ? odoNum : null,
        odometerSource: odoNum ? 'manual' : null,
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
      // DSP picked → vehicle list
      setStep(2);
    } else if (step === 2) {
      // Vehicle picked → odometer
      setStep(3);
    } else if (step === 3) {
      // Create draft (with vehicle + odometer), then go to sections
      const id = await ensureDraft();
      if (id) setStep(4);
    } else if (step === 4) {
      setStep(5);
    }
  };

  const goBack = () => {
    if (step > 1) {
      // If user backs out from step 2, also clear vehicle (they may switch DSPs)
      if (step === 2) setVehicle(null);
      setStep(step - 1);
    }
  };

  // ─── Defect operations ──────────────────────────────
  const handleAddDefectStart = (section) => {
    setOpenSection(section);
    setAddingDefect(section);
  };

  const handleAddDefectCommit = async (section, defectData) => {
    if (!inspectionId) return null;
    try {
      const created = await inspectionsApi.addDefect(inspectionId, {
        section,
        part: defectData.part,
        description: defectData.description,
        severity: defectData.severity,
        category: defectData.category || null,
      });
      // Add to local state with empty photos
      setDefectsBySection((prev) => ({
        ...prev,
        [section]: [
          ...(prev[section] || []),
          {
            id: created.id,
            part: created.part,
            description: created.description,
            severity: created.severity,
            photos: [],
          },
        ],
      }));
      setAddingDefect(null);
      return created.id;
    } catch (err) {
      alert(`Add defect failed: ${err?.detail || err?.message || 'unknown'}`);
      return null;
    }
  };

  const handleRemoveDefect = async (section, defect) => {
    if (!confirm(`Remove "${defect.part}" defect?`)) return;
    try {
      await inspectionsApi.removeDefect(inspectionId, defect.id);
      setDefectsBySection((prev) => ({
        ...prev,
        [section]: (prev[section] || []).filter((d) => d.id !== defect.id),
      }));
    } catch (err) {
      alert(`Remove failed: ${err?.detail || err?.message || 'unknown'}`);
    }
  };

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
    setDefectsBySection({});
    setOpenSection(null);
    setAddingDefect(null);
    setSubmitResult(null);
    setSubmitError(null);
  };

  // ─── Action: inspect another van in the SAME DSP ────
  const handleInspectAnother = () => {
    resetForNextVehicle();
    setPhase('inspecting');
    setStep(2); // skip DSP picker — we keep the same DSP
  };

  // ─── Action: switch DSP (full reset) ────────────────
  const handleSwitchDsp = () => {
    resetForNextVehicle();
    setDsp(null);
    setInspectedSession([]); // new session
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
  const totalDefects = Object.values(defectsBySection)
    .reduce((sum, arr) => sum + arr.length, 0);
  const sectionsCovered = Object.keys(defectsBySection).filter(
    (s) => (defectsBySection[s] || []).length > 0
  );

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

  return (
    <FullScreenShell
      title="QC DVIC Inspection"
      subtitle={`Step ${step} of 5`}
      onClose={onClose}
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
              setVehicle(null);  // clear if user switches DSP
            }}
          />
        )}

        {/* ── Step 2: vehicle picker (filtered to selected DSP) ── */}
        {step === 2 && (
          <Step2VehiclePicker
            dsp={dsp}
            vehicles={vehiclesForDsp}
            value={vehicle}
            onChange={setVehicle}
          />
        )}

        {/* ── Step 3: odometer ── */}
        {step === 3 && (
          <Step3Odometer
            vehicle={vehicle}
            odometer={odometer}
            onOdometerChange={setOdometer}
            inspectionId={inspectionId}
            creatingDraft={creatingDraft}
            createError={createError}
            onEnsureDraft={ensureDraft}
          />
        )}

        {/* ── Step 4: sections / defects ── */}
        {step === 4 && (
          <Step4Sections
            inspectionId={inspectionId}
            defectsBySection={defectsBySection}
            openSection={openSection}
            setOpenSection={setOpenSection}
            addingDefect={addingDefect}
            setAddingDefect={setAddingDefect}
            onAddDefect={handleAddDefectStart}
            onCommitDefect={handleAddDefectCommit}
            onRemoveDefect={handleRemoveDefect}
          />
        )}

        {/* ── Step 5: review + submit ── */}
        {step === 5 && (
          <Step5Review
            dsp={dsp}
            vehicle={vehicle}
            odometer={odometer}
            defectsBySection={defectsBySection}
            totalDefects={totalDefects}
            inspectionId={inspectionId}
            submitting={submitting}
            submitError={submitError}
            onSubmit={handleSubmit}
          />
        )}
      </div>

      {/* Sticky footer nav */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-navy-800 bg-navy-950/95 backdrop-blur px-4 py-3 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button
            onClick={goBack}
            disabled={step === 1}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-navy-700 text-navy-300 hover:text-white hover:border-navy-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
          >
            <ArrowLeft size={14} /> Back
          </button>

          <div className="text-[10px] text-navy-500 uppercase tracking-wide hidden sm:block">
            {step === 1 && 'Pick the DSP'}
            {step === 2 && 'Pick a vehicle'}
            {step === 3 && 'Odometer'}
            {step === 4 && `${totalDefects} defect${totalDefects === 1 ? '' : 's'}`}
            {step === 5 && 'Review & submit'}
          </div>

          {step < 5 && (
            <button
              onClick={goNext}
              disabled={
                (step === 1 && !canGoNextStep1) ||
                (step === 2 && !canGoNextStep2) ||
                (step === 3 && creatingDraft)
              }
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
            >
              {creatingDraft ? <Loader2 size={14} className="animate-spin" /> : null}
              {step === 3 && !inspectionId ? 'Start' : 'Next'} <ArrowRight size={14} />
            </button>
          )}
          {step === 5 && (
            <button
              onClick={handleSubmit}
              disabled={submitting || !canSubmit}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-green text-white font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer text-sm"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Submit
            </button>
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
// Step 1: DSP picker (mandatory first)
// ─────────────────────────────────────────────────────
function Step1DspPicker({ dsps, loading, value, onChange }) {
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
          You don't have access to any DSPs with vehicles assigned.
        </p>
        <p className="text-[11px] text-navy-500 mt-1">
          Contact your admin to be assigned to a DSP fleet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Building2 size={16} className="text-accent-blue" />
        <h3 className="text-sm font-semibold text-white">
          Which DSP are you servicing today?
        </h3>
      </div>
      <p className="text-xs text-navy-400 -mt-1 mb-2">
        Pick the fleet whose van you're about to inspect.
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
                    {d.count} van{d.count === 1 ? '' : 's'} in fleet
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
// Step 2: vehicle picker (already filtered to selected DSP)
// ─────────────────────────────────────────────────────
function Step2VehiclePicker({ dsp, vehicles, value, onChange }) {
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Truck size={16} className="text-accent-blue" />
        <h3 className="text-sm font-semibold text-white">
          Pick a van from <span className="text-accent-blue">{dsp?.name}</span>
        </h3>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Fleet ID, VIN, plate…"
        className="w-full rounded-lg px-3 py-2.5 bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue text-sm"
      />

      <div className="grid sm:grid-cols-2 gap-2">
        {filtered.map((v) => (
          <VehicleCard key={v.id} v={v} selected={value?.id === v.id} onSelect={onChange} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-8 text-center text-sm text-navy-400">
          {vehicles.length === 0
            ? `${dsp?.name} has no vehicles in your visibility.`
            : 'No vehicles match the search.'}
        </div>
      )}
    </div>
  );
}

function VehicleCard({ v, selected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(v)}
      className={`text-left rounded-lg p-3 border-2 transition-all cursor-pointer ${
        selected
          ? 'border-accent-blue bg-accent-blue/10'
          : 'border-navy-700 bg-navy-900/60 hover:border-navy-600'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-bold text-white font-mono">{v.fleetId}</span>
        {v.grounded && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent-red/20 border border-accent-red/40 text-accent-red">
            GROUNDED
          </span>
        )}
      </div>
      <div className="text-xs text-navy-300 truncate">
        {v.year} {v.make} {v.model}
      </div>
      <div className="text-[10px] text-navy-500 mt-1">
        {v.plate} &middot; {v.mileage?.toLocaleString() || 0} mi
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────
// Step 3: odometer + start draft
// ─────────────────────────────────────────────────────
function Step3Odometer({ vehicle, odometer, onOdometerChange, inspectionId, creatingDraft, createError, onEnsureDraft }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Gauge size={16} className="text-accent-blue" />
        <h3 className="text-sm font-semibold text-white">Odometer reading</h3>
      </div>

      <div className="rounded-lg bg-navy-900/60 border border-navy-700 p-3 text-sm">
        <span className="font-mono text-white font-bold">{vehicle?.fleetId}</span>
        <span className="text-navy-400 ml-2">
          {vehicle?.year} {vehicle?.make} {vehicle?.model} &middot; last: {vehicle?.mileage?.toLocaleString()} mi
        </span>
      </div>

      <div>
        <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Current mileage</label>
        <input
          type="number"
          inputMode="numeric"
          value={odometer}
          onChange={(e) => onOdometerChange(e.target.value)}
          placeholder="e.g. 86209"
          className="w-full rounded-lg px-3 py-3 bg-navy-800 border border-navy-700 text-white text-lg font-mono text-right outline-none focus:border-accent-blue"
        />
        {odometer && vehicle && parseInt(odometer, 10) < vehicle.mileage && (
          <p className="mt-1.5 text-[11px] text-accent-orange flex items-center gap-1">
            <AlertCircle size={12} /> Lower than last reading ({vehicle.mileage.toLocaleString()} mi)
          </p>
        )}
      </div>

      {/* Photo of odometer (only after the draft is created — we need an inspection_id) */}
      {inspectionId ? (
        <div>
          <label className="text-xs font-semibold text-navy-300 mb-2 block">Odometer photo (optional)</label>
          <PhotoUploader
            parentKind="inspection"
            parentId={inspectionId}
            category="odometer"
            maxPhotos={1}
          />
        </div>
      ) : (
        <button
          onClick={onEnsureDraft}
          disabled={creatingDraft}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-navy-600 text-navy-400 hover:border-accent-blue hover:text-accent-blue cursor-pointer text-sm"
        >
          {creatingDraft ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          {creatingDraft ? 'Creating draft…' : 'Start inspection to add photo'}
        </button>
      )}

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
// Step 4: sections walkthrough
// ─────────────────────────────────────────────────────
function Step4Sections({
  inspectionId, defectsBySection, openSection, setOpenSection,
  addingDefect, setAddingDefect, onCommitDefect, onRemoveDefect,
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList size={16} className="text-accent-blue" />
        <h3 className="text-sm font-semibold text-white">Walkthrough — tap "+" on any section to add a defect</h3>
      </div>

      {SECTIONS.map((section) => {
        const sectionDefects = defectsBySection[section] || [];
        const isOpen = openSection === section || sectionDefects.length > 0;
        return (
          <div
            key={section}
            className="rounded-lg border border-navy-700/60 bg-navy-900/40 overflow-hidden"
          >
            <button
              onClick={() => setOpenSection(isOpen ? null : section)}
              className="w-full flex items-center justify-between px-3 py-3 hover:bg-navy-800/40 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{section}</span>
                {sectionDefects.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent-orange/15 border border-accent-orange/40 text-accent-orange text-[10px] font-semibold">
                    <AlertTriangle size={9} /> {sectionDefects.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {sectionDefects.length === 0 && !isOpen && (
                  <span className="text-[10px] text-navy-500 font-semibold uppercase tracking-wide">
                    Pass
                  </span>
                )}
                {isOpen ? <ChevronUp size={14} className="text-navy-400" /> : <ChevronDown size={14} className="text-navy-400" />}
              </div>
            </button>

            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-navy-800/60 overflow-hidden"
                >
                  <div className="p-3 space-y-3">
                    {sectionDefects.map((d) => (
                      <DefectCard
                        key={d.id}
                        defect={d}
                        onRemove={() => onRemoveDefect(section, d)}
                      />
                    ))}

                    {addingDefect === section ? (
                      <NewDefectForm
                        onCommit={(data) => onCommitDefect(section, data)}
                        onCancel={() => setAddingDefect(null)}
                      />
                    ) : (
                      <button
                        onClick={() => setAddingDefect(section)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md border border-dashed border-navy-600 text-navy-400 hover:text-accent-blue hover:border-accent-blue cursor-pointer text-sm"
                      >
                        <Plus size={14} /> Add defect to {section.split(' ').slice(1).join(' ').toLowerCase() || section}
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function DefectCard({ defect, onRemove }) {
  const sev = SEVERITY_OPTIONS.find((s) => s.value === defect.severity);
  return (
    <div className="rounded-lg border border-navy-700 bg-navy-950/40 p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-white">{defect.part}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${sev?.tint || ''}`}>
              {sev?.label || defect.severity}
            </span>
          </div>
          <p className="text-xs text-navy-300 line-clamp-2">{defect.description}</p>
        </div>
        <button
          onClick={onRemove}
          className="text-navy-400 hover:text-accent-red p-1 -mr-1 rounded shrink-0"
          title="Remove defect"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {/* Inline photo uploader for this defect */}
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

function NewDefectForm({ onCommit, onCancel }) {
  const [part, setPart] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = part.trim().length > 0 && description.trim().length > 4;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    await onCommit({ part: part.trim(), description: description.trim(), severity });
    setSubmitting(false);
  };

  return (
    <div className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 p-3 space-y-3">
      <div>
        <label className="text-[10px] font-semibold text-navy-300 uppercase tracking-wide block mb-1">Part</label>
        <input
          type="text"
          value={part}
          onChange={(e) => setPart(e.target.value)}
          placeholder="e.g. Windshield, Brake light, Side mirror"
          className="w-full rounded-md px-3 py-2 bg-navy-900 border border-navy-700 text-white text-sm outline-none focus:border-accent-blue"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-navy-300 uppercase tracking-wide block mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's wrong with it?"
          rows={2}
          className="w-full rounded-md px-3 py-2 bg-navy-900 border border-navy-700 text-white text-sm outline-none focus:border-accent-blue resize-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-navy-300 uppercase tracking-wide block mb-1">Severity</label>
        <div className="flex flex-wrap gap-1.5">
          {SEVERITY_OPTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSeverity(s.value)}
              className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold cursor-pointer transition-all ${
                severity === s.value ? s.tint : 'border-navy-700 text-navy-400 bg-navy-800/40 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md border border-navy-700 text-navy-300 text-xs hover:text-white hover:border-navy-600 cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-blue text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
        >
          {submitting && <Loader2 size={12} className="animate-spin" />}
          Add &amp; take photo
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 5: review + submit
// ─────────────────────────────────────────────────────
function Step5Review({ dsp, vehicle, odometer, defectsBySection, totalDefects, inspectionId, submitting, submitError, onSubmit }) {
  const sectionEntries = Object.entries(defectsBySection).filter(([, arr]) => arr && arr.length > 0);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3">
        <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1">DSP</div>
        <div className="text-sm font-bold text-white">{dsp?.name}</div>
      </div>

      <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3">
        <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1">Vehicle</div>
        <div className="text-sm font-bold text-white font-mono">{vehicle?.fleetId}</div>
        <div className="text-xs text-navy-300">{vehicle?.year} {vehicle?.make} {vehicle?.model}</div>
      </div>

      <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3">
        <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1">Odometer</div>
        <div className="text-sm font-mono text-white">
          {odometer ? `${parseInt(odometer, 10).toLocaleString()} mi` : '— not provided —'}
        </div>
      </div>

      <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wide text-navy-400">Defects</div>
          <div className="text-xs font-bold text-white">{totalDefects} total</div>
        </div>
        {totalDefects === 0 ? (
          <div className="text-xs text-accent-green flex items-center gap-1">
            <Check size={12} /> All sections passed
          </div>
        ) : (
          <div className="space-y-2 mt-2">
            {sectionEntries.map(([section, defects]) => (
              <div key={section} className="text-xs">
                <div className="text-navy-400 font-semibold">{section}</div>
                <ul className="ml-3 mt-0.5 space-y-0.5">
                  {defects.map((d) => (
                    <li key={d.id} className="text-navy-200 flex items-center gap-1.5">
                      <span className="text-navy-500">{d.id}</span>
                      <span className="text-white font-medium">{d.part}</span>
                      <span className="text-navy-500">·</span>
                      <span className="text-navy-300">{d.severity}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 p-3 text-xs text-navy-200">
        <div className="font-semibold text-accent-blue mb-1">Ready to submit</div>
        Once submitted, this inspection becomes immutable. Defects can still
        be acknowledged or routed to vendors by the DSP owner.
      </div>

      {submitError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="text-[11px] text-navy-500 font-mono text-center">
        Draft: {inspectionId || '—'}
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
  const remaining = remainingVehicles.length;
  const isSinglePending = remaining === 1;
  const sessionTotal = inspectedSession.length;

  return (
    <FullScreenShell title="Inspection submitted" onClose={onClose}>
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
            All set, {user?.name?.split(' ')[0] || 'tech'}.
          </h2>
          <p className="text-navy-400 mb-1 font-mono text-xs">
            {submitResult.id} &middot; {submitResult.fleetId} &middot; {totalDefects} defect{totalDefects === 1 ? '' : 's'}
          </p>
          <p className={`text-sm font-semibold ${
            submitResult.result === 'passed' ? 'text-accent-green' :
            submitResult.result === 'flagged' ? 'text-accent-red' :
            submitResult.result === 'conditional' ? 'text-accent-gold' : 'text-navy-300'
          }`}>
            Result: {submitResult.result}
          </p>
        </div>

        {/* Session counter */}
        <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3 mb-5 text-center">
          <div className="text-[11px] uppercase tracking-wide text-navy-400 mb-0.5">This session</div>
          <div className="text-sm text-white">
            <span className="font-bold">{sessionTotal}</span> inspected
            {' · '}
            <span className="text-accent-orange font-bold">{remaining}</span> remaining in {dsp?.name}
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
                Inspect another van
              </div>
              <div className="text-[11px] text-navy-300">
                {loadingToday
                  ? 'Loading remaining…'
                  : remaining === 0
                  ? 'No more vans pending in this DSP'
                  : `${remaining} ${isSinglePending ? 'van' : 'vans'} remaining in ${dsp?.name}`}
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
              <div className="text-sm font-semibold text-white">Inspect another DSP</div>
              <div className="text-[11px] text-navy-400">Start a new session for a different fleet</div>
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
                Complete {dsp?.name} inspection
              </div>
              <div className="text-[11px] text-navy-300">
                {remaining === 0
                  ? 'All vans inspected — finalize the session'
                  : `${remaining} van${isSinglePending ? '' : 's'} not yet inspected — you'll need to flag them`}
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
          Pause &amp; close (resume from your dashboard)
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
  const allReasonPicked = remainingVehicles.every((v) => bulkSkipReasons[v.id]);
  const reasonsCount = remainingVehicles.filter((v) => bulkSkipReasons[v.id]).length;

  return (
    <FullScreenShell
      title="Vans not yet inspected"
      subtitle={`${remainingVehicles.length} pending in ${dsp?.name}`}
      onClose={onClose}
    >
      <div className="max-w-2xl mx-auto px-4 py-6 pb-32">
        {/* Warning banner */}
        <div className="rounded-lg border-2 border-accent-orange/40 bg-accent-orange/10 p-4 mb-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-accent-orange shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white mb-1">
                {remainingVehicles.length} van{remainingVehicles.length === 1 ? '' : 's'} not inspected
              </div>
              <p className="text-xs text-navy-200">
                You inspected {inspectedSession.length} of {inspectedSession.length + remainingVehicles.length} vans in {dsp?.name}.
                Pick a reason for each remaining van so the DSP knows why it
                wasn't inspected. Each one will be flagged in their dashboard
                with the reason.
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
                      {r.label}
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
          {reasonsCount} of {remainingVehicles.length} reasons picked
        </div>
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-navy-800 bg-navy-950/95 backdrop-blur px-4 py-3 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-navy-700 text-navy-300 hover:text-white hover:border-navy-600 cursor-pointer text-sm"
          >
            Back
          </button>
          <button
            onClick={onConfirm}
            disabled={bulkSubmitting || !allReasonPicked}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-red text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
          >
            {bulkSubmitting ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
            Flag {remainingVehicles.length} &amp; complete
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
  const total = inspectedSession.length + skippedCount;
  return (
    <FullScreenShell title="Fleet inspection complete" onClose={onClose}>
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
          {dsp?.name} fleet — done.
        </h2>
        <p className="text-navy-300 text-sm mb-6">
          Great work, {user?.name?.split(' ')[0] || 'tech'}. The DSP dashboard
          is being updated now.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-6">
          <div className="rounded-lg border border-accent-green/40 bg-accent-green/10 p-3">
            <div className="text-2xl font-bold text-accent-green">{inspectedSession.length}</div>
            <div className="text-[10px] uppercase tracking-wide text-navy-300">Inspected</div>
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
            <div className="text-[10px] uppercase tracking-wide text-navy-300">Flagged</div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-lg bg-accent-blue text-white font-semibold cursor-pointer"
        >
          Done
        </button>
      </div>
    </FullScreenShell>
  );
}
