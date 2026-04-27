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
  Loader2, Plus, Trash2, Camera, ChevronDown, ChevronUp, AlertTriangle,
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

// ─────────────────────────────────────────────────────
export default function CreateInspectionWizard({ user, onClose, onSubmitted }) {
  const [step, setStep] = useState(1); // 1=vehicle, 2=odometer, 3=sections, 4=review
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);

  // Wizard state
  const [vehicle, setVehicle] = useState(null);
  const [odometer, setOdometer] = useState('');
  const [inspectionId, setInspectionId] = useState(null); // INS-id once draft is created
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Map of section -> array of defects ({ id (FD), part, description, severity, photoCount, photos })
  const [defectsBySection, setDefectsBySection] = useState({});

  // Section accordion state — which one is open for "+ Add Defect"
  const [openSection, setOpenSection] = useState(null);
  const [addingDefect, setAddingDefect] = useState(null); // section name or null

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitError, setSubmitError] = useState(null);

  // Load vehicles on mount
  useEffect(() => {
    vehiclesApi.list({ perPage: 100 })
      .then((res) => setVehicles(res.items))
      .catch((err) => console.error('vehicles load failed', err))
      .finally(() => setVehiclesLoading(false));
  }, []);

  // ─── Step transitions ───────────────────────────────
  const canGoNextStep1 = !!vehicle;
  const canGoNextStep2 = inspectionId !== null;  // draft must exist
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
      // Move to odometer step
      setStep(2);
    } else if (step === 2) {
      // Create draft if not yet, then go to sections
      const id = await ensureDraft();
      if (id) setStep(3);
    } else if (step === 3) {
      setStep(4);
    }
  };

  const goBack = () => {
    if (step > 1) setStep(step - 1);
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
      onSubmitted?.(final);
    } catch (err) {
      setSubmitError(err?.detail || err?.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Counts derived for UI ──────────────────────────
  const totalDefects = Object.values(defectsBySection)
    .reduce((sum, arr) => sum + arr.length, 0);
  const sectionsCovered = Object.keys(defectsBySection).filter(
    (s) => (defectsBySection[s] || []).length > 0
  );

  // ─── Success screen (after submit) ──────────────────
  if (submitResult) {
    return (
      <FullScreenShell title="Inspection submitted" onClose={onClose}>
        <div className="max-w-md mx-auto px-4 py-12 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring' }}
            className="w-20 h-20 rounded-full bg-accent-green/20 border-2 border-accent-green flex items-center justify-center mx-auto mb-6"
          >
            <Check size={40} className="text-accent-green" />
          </motion.div>
          <h2 className="text-2xl font-bold text-white mb-2">All set, {user?.name?.split(' ')[0] || 'tech'}.</h2>
          <p className="text-navy-400 mb-1 font-mono text-sm">
            {submitResult.id} &middot; {submitResult.fleetId} &middot; {totalDefects} defect{totalDefects === 1 ? '' : 's'}
          </p>
          <p className={`text-sm font-semibold mb-6 ${
            submitResult.result === 'passed' ? 'text-accent-green' :
            submitResult.result === 'flagged' ? 'text-accent-red' :
            submitResult.result === 'conditional' ? 'text-accent-gold' : 'text-navy-300'
          }`}>
            Result: {submitResult.result}
          </p>
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

  return (
    <FullScreenShell
      title="QC DVIC Inspection"
      subtitle={`Step ${step} of 4`}
      onClose={onClose}
    >
      {/* Body */}
      <div className="max-w-2xl mx-auto px-4 py-6 pb-32">
        {/* ── Step 1: vehicle ── */}
        {step === 1 && (
          <Step1VehiclePicker
            vehicles={vehicles}
            loading={vehiclesLoading}
            value={vehicle}
            onChange={setVehicle}
          />
        )}

        {/* ── Step 2: odometer ── */}
        {step === 2 && (
          <Step2Odometer
            vehicle={vehicle}
            odometer={odometer}
            onOdometerChange={setOdometer}
            inspectionId={inspectionId}
            creatingDraft={creatingDraft}
            createError={createError}
            onEnsureDraft={ensureDraft}
          />
        )}

        {/* ── Step 3: sections / defects ── */}
        {step === 3 && (
          <Step3Sections
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

        {/* ── Step 4: review + submit ── */}
        {step === 4 && (
          <Step4Review
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

          <div className="text-[10px] text-navy-500 uppercase tracking-wide">
            {step === 1 && 'Pick a vehicle'}
            {step === 2 && 'Odometer'}
            {step === 3 && `${totalDefects} defect${totalDefects === 1 ? '' : 's'}`}
            {step === 4 && 'Review & submit'}
          </div>

          {step < 4 && (
            <button
              onClick={goNext}
              disabled={
                (step === 1 && !canGoNextStep1) ||
                (step === 2 && creatingDraft)
              }
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
            >
              {creatingDraft ? <Loader2 size={14} className="animate-spin" /> : null}
              {step === 2 && !inspectionId ? 'Start' : 'Next'} <ArrowRight size={14} />
            </button>
          )}
          {step === 4 && (
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
// Step 1: vehicle picker
// ─────────────────────────────────────────────────────
function Step1VehiclePicker({ vehicles, loading, value, onChange }) {
  const [search, setSearch] = useState('');
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={32} className="text-accent-blue animate-spin" />
      </div>
    );
  }
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
        <h3 className="text-sm font-semibold text-white">Which vehicle are you inspecting?</h3>
      </div>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Fleet ID, VIN, plate…"
        className="w-full rounded-lg px-3 py-2.5 bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue text-sm"
      />
      <div className="grid sm:grid-cols-2 gap-2">
        {filtered.map((v) => {
          const selected = value?.id === v.id;
          return (
            <button
              key={v.id}
              onClick={() => onChange(v)}
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
        })}
        {filtered.length === 0 && (
          <div className="col-span-2 py-8 text-center text-sm text-navy-400">
            No vehicles match.
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 2: odometer + start draft
// ─────────────────────────────────────────────────────
function Step2Odometer({ vehicle, odometer, onOdometerChange, inspectionId, creatingDraft, createError, onEnsureDraft }) {
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
// Step 3: sections walkthrough
// ─────────────────────────────────────────────────────
function Step3Sections({
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
// Step 4: review + submit
// ─────────────────────────────────────────────────────
function Step4Review({ vehicle, odometer, defectsBySection, totalDefects, inspectionId, submitting, submitError, onSubmit }) {
  const sectionEntries = Object.entries(defectsBySection).filter(([, arr]) => arr && arr.length > 0);
  return (
    <div className="space-y-4">
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
