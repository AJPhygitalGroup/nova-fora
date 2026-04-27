/**
 * DefectWizard — full-screen 6-step tile picker for adding ONE defect.
 *
 * Drives the v2 schema flow per the Notion 'Defect Data Schema' spec §13:
 *   1. System  (13 tiles, emoji + label)
 *   2. Part    (filtered + grouped per system)
 *   3. Position (only if part requires)              ← auto-skip otherwise
 *   4. Defect type (filtered, with severity badges)
 *   5. Details (only if defect_type requires_details) ← auto-skip otherwise
 *   6. Review  (notes + severity override + commit)
 *
 * Used inside CreateInspectionWizard step 5: when the tech taps '+ Add defect',
 * this opens on top. On commit, the resulting defect is added to the
 * inspection's defects list.
 *
 * Catalog is loaded once via catalog.load() and cached. Every render reads
 * the same object — no jank.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, X, Check, AlertCircle, Loader2,
  ClipboardList, ChevronRight,
} from 'lucide-react';
import { catalog as catalogApi, inspections as inspectionsApi, APIError } from '../api/client';

const SEVERITY_TINT = {
  low: 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue',
  medium: 'bg-accent-gold/15 border-accent-gold/40 text-accent-gold',
  high: 'bg-accent-orange/15 border-accent-orange/40 text-accent-orange',
  critical: 'bg-accent-red/15 border-accent-red/40 text-accent-red',
};

// Subheading labels for display_group keys (per Notion spec §3 visual grouping)
const GROUP_LABELS = {
  exterior: 'Exterior',
  cabin_cargo: 'Cabin & Cargo',
  attached: 'Attached',
  panels: 'Panels',
  steps: 'Steps',
  doors: 'Doors',
  windows: 'Windows',
  hardware: 'Hardware',
  seating: 'Seating',
  restraints: 'Restraints',
  cab: 'Cab',
  cleanliness: 'Cleanliness',
  safety_gear: 'Safety gear',
  safety: 'Safety',
  cameras: 'Cameras',
  alerts: 'Alerts',
  charging: 'Charging',
  mounts: 'Mounts',
  plates: 'Plates & tags',
  stickers: 'Inspection stickers',
};


export default function DefectWizard({ inspectionId, onCommitted, onCancel }) {
  // 1=system, 2=part, 3=position, 4=type, 5=details, 6=review
  const [step, setStep] = useState(1);

  // Selections
  const [system, setSystem] = useState(null);
  const [part, setPart] = useState(null);
  const [position, setPosition] = useState(null);
  const [defectType, setDefectType] = useState(null);
  const [details, setDetails] = useState({});
  const [notes, setNotes] = useState('');
  const [severityOverride, setSeverityOverride] = useState(null); // null = use default

  // Catalog
  const [cat, setCat] = useState(null);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState(null);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    catalogApi.load()
      .then((c) => setCat(c))
      .catch((err) => setCatError(err instanceof APIError ? err.detail : 'Failed to load catalog'))
      .finally(() => setCatLoading(false));
  }, []);

  // Derived state
  const partsForSys = useMemo(
    () => (system && cat ? catalogApi.partsByGroup(cat, system.id) : null),
    [system, cat]
  );
  const positionRequired = part?.positionRequired;
  const hasPositions = (part?.validPositions?.length || 0) > 0;
  const requiresDetails = !!defectType?.requiresDetails;
  const effectiveSeverity = severityOverride || defectType?.defaultSeverity || 'medium';

  // Step transitions
  const canNextStep = (s) => {
    switch (s) {
      case 1: return !!system;
      case 2: return !!part;
      case 3: return !positionRequired || !!position;
      case 4: return !!defectType;
      case 5: return validateDetails(defectType, details);
      case 6: return true;
      default: return false;
    }
  };

  const goNext = () => {
    let next = step + 1;
    // Skip step 3 if no positions for this part
    if (next === 3 && !hasPositions) next = 4;
    // Skip step 5 if no details required
    if (next === 5 && !requiresDetails) next = 6;
    setStep(next);
  };

  const goBack = () => {
    let prev = step - 1;
    if (prev === 5 && !requiresDetails) prev = 4;
    if (prev === 3 && !hasPositions) prev = 2;
    if (prev < 1) prev = 1;
    // Reset downstream selections on back
    if (prev <= 1) { setPart(null); setPosition(null); setDefectType(null); setDetails({}); }
    if (prev <= 2) { setPosition(null); setDefectType(null); setDetails({}); }
    if (prev <= 3) { setDefectType(null); setDetails({}); }
    if (prev <= 4) { setDetails({}); }
    setStep(prev);
  };

  // Submit
  const handleSubmit = async () => {
    if (!part || !defectType) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = {
        partV2: part.id,
        defectTypeV2: defectType.id,
        details,
      };
      if (position) body.position = position.id;
      if (notes.trim()) body.notes = notes.trim();
      if (severityOverride && severityOverride !== defectType.defaultSeverity) {
        body.severityOverride = severityOverride;
      }
      const created = await inspectionsApi.addDefect(inspectionId, body);
      onCommitted?.({
        ...created,
        // augment with catalog labels for nice rendering upstream
        partLabel: part.label,
        partIcon: part.icon,
        positionLabel: position?.label,
        defectTypeLabel: defectType.label,
        defectTypeIcon: defectType.icon,
        severity: effectiveSeverity,
      });
    } catch (err) {
      setSubmitError(err instanceof APIError ? err.detail : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Loading / error gates ────────────────────────
  if (catLoading) {
    return (
      <Shell title="Loading catalog…" onClose={onCancel}>
        <div className="flex items-center justify-center py-16">
          <Loader2 size={32} className="text-accent-blue animate-spin" />
        </div>
      </Shell>
    );
  }
  if (catError || !cat) {
    return (
      <Shell title="Catalog error" onClose={onCancel}>
        <div className="flex flex-col items-center gap-3 py-16 px-4 text-center">
          <AlertCircle size={32} className="text-accent-red" />
          <p className="text-sm text-navy-300 max-w-md">{catError || 'Catalog unavailable'}</p>
        </div>
      </Shell>
    );
  }

  // ─── Render the active step ───────────────────────
  const subtitleByStep = {
    1: 'Pick the system',
    2: `${system?.icon} ${system?.label} — pick a part`,
    3: `${part?.icon} ${part?.label} — pick the position`,
    4: `${part?.icon} ${part?.label} — what's wrong?`,
    5: `${part?.icon} ${part?.label} — ${defectType?.label} — details`,
    6: 'Review & add',
  };

  return (
    <Shell
      title={`Add defect — Step ${step} of ${requiresDetails ? 6 : (hasPositions ? 5 : (requiresDetails ? 5 : 4))}`}
      subtitle={subtitleByStep[step]}
      onClose={onCancel}
    >
      <div className="max-w-2xl mx-auto px-4 py-5 pb-32">
        {step === 1 && (
          <SystemPicker
            systems={cat.systems}
            value={system}
            onChange={(s) => { setSystem(s); setPart(null); setPosition(null); setDefectType(null); setDetails({}); }}
          />
        )}
        {step === 2 && partsForSys && (
          <PartPicker
            partsByGroup={partsForSys}
            systemId={system.id}
            value={part}
            onChange={(p) => { setPart(p); setPosition(null); setDefectType(null); setDetails({}); }}
          />
        )}
        {step === 3 && part && (
          <PositionPicker
            part={part}
            value={position}
            onChange={setPosition}
          />
        )}
        {step === 4 && part && (
          <TypePicker
            part={part}
            value={defectType}
            onChange={(t) => { setDefectType(t); setDetails({}); setSeverityOverride(null); }}
          />
        )}
        {step === 5 && part && defectType && (
          <DetailsForm
            part={part}
            defectType={defectType}
            value={details}
            onChange={setDetails}
          />
        )}
        {step === 6 && (
          <ReviewStep
            part={part}
            position={position}
            defectType={defectType}
            details={details}
            notes={notes}
            onNotesChange={setNotes}
            severityOverride={severityOverride}
            onSeverityOverrideChange={setSeverityOverride}
            effectiveSeverity={effectiveSeverity}
            submitError={submitError}
          />
        )}
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-navy-800 bg-navy-950/95 backdrop-blur px-4 py-3 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button
            onClick={step === 1 ? onCancel : goBack}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-navy-700 text-navy-300 hover:text-white hover:border-navy-600 cursor-pointer text-sm"
          >
            <ArrowLeft size={14} /> {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < 6 ? (
            <button
              onClick={goNext}
              disabled={!canNextStep(step)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm"
            >
              Next <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-green text-white font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer text-sm"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Add defect
            </button>
          )}
        </div>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────
// Shell
// ─────────────────────────────────────────────────────
function Shell({ title, subtitle, onClose, children }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-navy-950 overflow-y-auto"
    >
      <div className="sticky top-0 z-20 px-4 sm:px-6 py-4 border-b border-navy-800 bg-navy-900/95 backdrop-blur">
        <div className="max-w-2xl mx-auto flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-accent-blue/15 border border-accent-blue/40 flex items-center justify-center shrink-0">
              <ClipboardList size={18} className="text-accent-blue" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-white truncate">{title}</h2>
              {subtitle && <p className="text-[11px] text-navy-400 truncate">{subtitle}</p>}
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
// Step 1 — System picker (13 tiles)
// ─────────────────────────────────────────────────────
function SystemPicker({ systems, value, onChange }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {systems.map((s) => {
        const selected = value?.id === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onChange(s)}
            className={`aspect-square rounded-xl border-2 flex flex-col items-center justify-center gap-1.5 p-2 transition-all cursor-pointer ${
              selected
                ? 'border-accent-blue bg-accent-blue/15'
                : 'border-navy-700 bg-navy-900/60 hover:border-navy-600 hover:bg-navy-800/40'
            }`}
          >
            <span className="text-3xl">{s.icon}</span>
            <span className={`text-xs font-semibold text-center leading-tight ${selected ? 'text-white' : 'text-navy-200'}`}>
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 2 — Part picker (grouped if 6+ parts, flat otherwise)
// ─────────────────────────────────────────────────────
function PartPicker({ partsByGroup, value, onChange }) {
  const groupKeys = Object.keys(partsByGroup);
  const allFlat = groupKeys.length === 1 && groupKeys[0] === '_flat';
  const totalParts = Object.values(partsByGroup).flat().length;
  const showHeadings = !allFlat && totalParts >= 6;

  if (allFlat || !showHeadings) {
    const parts = Object.values(partsByGroup).flat();
    return <PartGrid parts={parts} value={value} onChange={onChange} />;
  }

  // Grouped rendering
  return (
    <div className="space-y-4">
      {groupKeys.map((key) => (
        <div key={key}>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-navy-400 mb-2 px-1">
            {GROUP_LABELS[key] || key.replace(/_/g, ' ')}
          </div>
          <PartGrid parts={partsByGroup[key]} value={value} onChange={onChange} />
        </div>
      ))}
    </div>
  );
}

function PartGrid({ parts, value, onChange }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {parts.map((p) => {
        const selected = value?.id === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onChange(p)}
            className={`rounded-xl border-2 flex flex-col items-center justify-center gap-1.5 p-3 transition-all cursor-pointer min-h-[88px] ${
              selected
                ? 'border-accent-blue bg-accent-blue/15'
                : 'border-navy-700 bg-navy-900/60 hover:border-navy-600 hover:bg-navy-800/40'
            }`}
          >
            <span className="text-2xl">{p.icon}</span>
            <span className={`text-xs font-semibold text-center leading-tight ${selected ? 'text-white' : 'text-navy-200'}`}>
              {p.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 3 — Position picker (literal layout)
// ─────────────────────────────────────────────────────
function PositionPicker({ part, value, onChange }) {
  const positions = part.validPositions || [];

  // Pick a 2x2 layout for 4-corner parts; horizontal pair for 2-position parts;
  // vertical pair for driver/passenger interior. Catch-all is a wrap row.
  const ids = positions.map((p) => p.id).sort().join(',');
  const isFourCorner = ids === 'driver_front,driver_rear,passenger_front,passenger_rear';
  const isLeftRight = ids === 'driver_side,passenger_side';
  const isFrontRear = ids === 'front,rear';
  const isInterior = ids === 'driver,passenger';

  if (isFourCorner) {
    const grid = {
      driver_front: positions.find((p) => p.id === 'driver_front'),
      passenger_front: positions.find((p) => p.id === 'passenger_front'),
      driver_rear: positions.find((p) => p.id === 'driver_rear'),
      passenger_rear: positions.find((p) => p.id === 'passenger_rear'),
    };
    return (
      <div className="max-w-sm mx-auto space-y-2">
        <div className="text-center text-[11px] uppercase tracking-wide text-navy-400">Front</div>
        <div className="grid grid-cols-2 gap-2">
          <PositionTile pos={grid.driver_front} value={value} onChange={onChange} icon="↖" />
          <PositionTile pos={grid.passenger_front} value={value} onChange={onChange} icon="↗" />
          <PositionTile pos={grid.driver_rear} value={value} onChange={onChange} icon="↙" />
          <PositionTile pos={grid.passenger_rear} value={value} onChange={onChange} icon="↘" />
        </div>
        <div className="text-center text-[11px] uppercase tracking-wide text-navy-400">Rear</div>
      </div>
    );
  }

  // 2-position layouts
  return (
    <div className={`max-w-sm mx-auto grid gap-2 ${
      isLeftRight ? 'grid-cols-2'
      : isFrontRear ? 'grid-cols-1'
      : isInterior ? 'grid-cols-2'
      : 'grid-cols-2 sm:grid-cols-3'
    }`}>
      {positions.map((p) => (
        <PositionTile key={p.id} pos={p} value={value} onChange={onChange} />
      ))}
    </div>
  );
}

function PositionTile({ pos, value, onChange, icon }) {
  if (!pos) return <div />;
  const selected = value?.id === pos.id;
  return (
    <button
      onClick={() => onChange(pos)}
      className={`min-h-[80px] rounded-xl border-2 flex flex-col items-center justify-center gap-1 p-3 transition-all cursor-pointer ${
        selected
          ? 'border-accent-blue bg-accent-blue/15'
          : 'border-navy-700 bg-navy-900/60 hover:border-navy-600'
      }`}
    >
      <span className="text-2xl">{icon || pos.icon}</span>
      <span className={`text-xs font-semibold text-center leading-tight ${selected ? 'text-white' : 'text-navy-200'}`}>
        {pos.label}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────
// Step 4 — Defect type picker (rows with severity badges)
// ─────────────────────────────────────────────────────
function TypePicker({ part, value, onChange }) {
  const types = part.defectTypes || [];
  return (
    <div className="space-y-1.5">
      {types.map((t) => {
        const selected = value?.id === t.id;
        const tint = SEVERITY_TINT[t.defaultSeverity] || SEVERITY_TINT.medium;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t)}
            className={`w-full rounded-lg border-2 flex items-center gap-3 px-3 py-3 transition-all cursor-pointer ${
              selected
                ? 'border-accent-blue bg-accent-blue/10'
                : 'border-navy-700 bg-navy-900/60 hover:border-navy-600'
            }`}
          >
            <span className="text-2xl shrink-0">{t.icon}</span>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-semibold text-white truncate">{t.label}</div>
              {t.requiresDetails && (
                <div className="text-[10px] text-navy-400">Has follow-up details</div>
              )}
            </div>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tint} shrink-0 capitalize`}>
              {t.defaultSeverity}
            </span>
            {selected && <ChevronRight size={14} className="text-accent-blue shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 5 — Details form (4 specific shapes per spec §7)
// ─────────────────────────────────────────────────────
function DetailsForm({ part, defectType, value, onChange }) {
  // tire + low_tread → integer 0-10
  if (part.id === 'tire' && defectType.id === 'low_tread') {
    const depth = value.tread_depth_32nds ?? '';
    return (
      <div className="space-y-3">
        <p className="text-sm text-navy-300">
          What's the tread depth in 32nds of an inch?
        </p>
        <div className="rounded-xl border border-navy-700 bg-navy-900/60 p-5">
          <label className="text-[10px] uppercase tracking-wide text-navy-400 block mb-2">
            Tread depth (/32)
          </label>
          <div className="flex items-center gap-2">
            {[0,1,2,3,4,5,6,7,8,9,10].map((n) => {
              const selected = depth === n;
              return (
                <button
                  key={n}
                  onClick={() => onChange({ tread_depth_32nds: n })}
                  className={`flex-1 min-w-[36px] py-2 rounded-md border-2 text-sm font-semibold cursor-pointer transition-all ${
                    selected
                      ? 'border-accent-blue bg-accent-blue/20 text-white'
                      : 'border-navy-700 bg-navy-900 text-navy-300 hover:text-white'
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-navy-500 mt-2">
            DOT minimum: 4/32 for steer tires, 2/32 for others. Lower values escalate severity.
          </p>
        </div>
      </div>
    );
  }

  // warning_lamp + on_or_flashing → multi-select chips + state toggle
  if (part.id === 'warning_lamp' && defectType.id === 'on_or_flashing') {
    const lamps = ['check_engine', 'oil', 'tire_pressure', 'brake', 'abs', 'airbag',
      'battery', 'coolant', 'def', 'glow_plug', 'service_due', 'other'];
    const lampLabels = {
      check_engine: 'Check Engine', oil: 'Oil', tire_pressure: 'Tire Pressure',
      brake: 'Brake', abs: 'ABS', airbag: 'Airbag', battery: 'Battery',
      coolant: 'Coolant', def: 'DEF', glow_plug: 'Glow Plug', service_due: 'Service Due',
      other: 'Other',
    };
    const selectedLamps = new Set(value.lamp_type || []);
    const state = value.state;
    const toggleLamp = (id) => {
      const next = new Set(selectedLamps);
      next.has(id) ? next.delete(id) : next.add(id);
      onChange({ ...value, lamp_type: Array.from(next) });
    };
    return (
      <div className="space-y-4">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-navy-400 block mb-2">
            Which lamps? (pick all that apply)
          </label>
          <div className="flex flex-wrap gap-1.5">
            {lamps.map((id) => {
              const selected = selectedLamps.has(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleLamp(id)}
                  className={`px-2.5 py-1.5 rounded-full border text-[11px] font-semibold cursor-pointer transition-all ${
                    selected
                      ? 'bg-accent-blue/20 border-accent-blue/50 text-accent-blue'
                      : 'bg-navy-800 border-navy-700 text-navy-300 hover:text-white'
                  }`}
                >
                  {lampLabels[id]}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-navy-400 block mb-2">State</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onChange({ ...value, state: 'on' })}
              className={`py-3 rounded-lg border-2 text-sm font-semibold cursor-pointer ${
                state === 'on' ? 'border-accent-blue bg-accent-blue/15 text-white' : 'border-navy-700 bg-navy-900 text-navy-300'
              }`}
            >
              🔆 On
            </button>
            <button
              onClick={() => onChange({ ...value, state: 'flashing' })}
              className={`py-3 rounded-lg border-2 text-sm font-semibold cursor-pointer ${
                state === 'flashing' ? 'border-accent-orange bg-accent-orange/15 text-white' : 'border-navy-700 bg-navy-900 text-navy-300'
              }`}
            >
              ✨ Flashing
            </button>
          </div>
        </div>
      </div>
    );
  }

  // windshield + cracked → yes/no toggle (in_drivers_line_of_sight)
  if (part.id === 'windshield' && defectType.id === 'cracked') {
    const v = value.in_drivers_line_of_sight;
    return (
      <div className="space-y-3">
        <p className="text-sm text-navy-300">
          Is the crack in the driver's line of sight?
        </p>
        <p className="text-[11px] text-navy-500">
          A 'yes' grounds the vehicle. 'No' just schedules the repair.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onChange({ in_drivers_line_of_sight: true })}
            className={`py-4 rounded-lg border-2 text-base font-semibold cursor-pointer ${
              v === true
                ? 'border-accent-red bg-accent-red/15 text-white'
                : 'border-navy-700 bg-navy-900 text-navy-300 hover:text-white'
            }`}
          >
            Yes
          </button>
          <button
            onClick={() => onChange({ in_drivers_line_of_sight: false })}
            className={`py-4 rounded-lg border-2 text-base font-semibold cursor-pointer ${
              v === false
                ? 'border-accent-blue bg-accent-blue/15 text-white'
                : 'border-navy-700 bg-navy-900 text-navy-300 hover:text-white'
            }`}
          >
            No
          </button>
        </div>
      </div>
    );
  }

  // Compliance expirations → date or month picker
  const isExpiration = defectType.id === 'expired';
  if (isExpiration) {
    const monthParts = ['inspection_sticker', 'registration_sticker'];
    const useMonth = monthParts.includes(part.id);
    const fieldName = useMonth ? 'expiration_month' : 'expiration_date';
    const inputType = useMonth ? 'month' : 'date';
    return (
      <div className="space-y-3">
        <p className="text-sm text-navy-300">
          When did it expire? <span className="text-navy-500">(optional but helpful)</span>
        </p>
        <input
          type={inputType}
          value={value[fieldName] || ''}
          onChange={(e) => onChange({ [fieldName]: e.target.value })}
          className="w-full rounded-lg px-3 py-3 bg-navy-800 border border-navy-700 text-white text-base outline-none focus:border-accent-blue"
        />
      </div>
    );
  }

  // Generic fallback (shouldn't be reached in practice — types without
  // requires_details auto-skip step 5).
  return (
    <div className="text-sm text-navy-400">
      No follow-up needed for this defect.
    </div>
  );
}

function validateDetails(defectType, details) {
  if (!defectType?.requiresDetails) return true;
  const required = defectType.detailsSchema?.required || [];
  for (const key of required) {
    const v = details[key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────
// Step 6 — Review + commit
// ─────────────────────────────────────────────────────
function ReviewStep({
  part, position, defectType, details, notes, onNotesChange,
  severityOverride, onSeverityOverrideChange, effectiveSeverity, submitError,
}) {
  const summary = humanSummary(part, position, defectType, details);
  const tint = SEVERITY_TINT[effectiveSeverity] || SEVERITY_TINT.medium;

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="rounded-xl border border-navy-700 bg-navy-900/60 p-4">
        <div className="flex items-start gap-3">
          <span className="text-3xl shrink-0">{defectType?.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-base font-semibold text-white">{defectType?.label}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tint} capitalize`}>
                {effectiveSeverity}
              </span>
            </div>
            <p className="text-sm text-navy-200">{summary}</p>
          </div>
        </div>
      </div>

      {/* Severity override */}
      <div>
        <label className="text-[10px] uppercase tracking-wide text-navy-400 block mb-2">
          Severity (default: {defectType?.defaultSeverity})
        </label>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onSeverityOverrideChange(null)}
            className={`px-3 py-1.5 rounded-md border text-[11px] font-semibold cursor-pointer ${
              severityOverride == null
                ? 'bg-accent-blue/20 border-accent-blue/50 text-accent-blue'
                : 'bg-navy-800 border-navy-700 text-navy-300 hover:text-white'
            }`}
          >
            Default
          </button>
          {['low', 'medium', 'high', 'critical'].map((sev) => {
            const selected = severityOverride === sev;
            return (
              <button
                key={sev}
                onClick={() => onSeverityOverrideChange(sev)}
                className={`px-3 py-1.5 rounded-md border text-[11px] font-semibold cursor-pointer capitalize ${
                  selected ? SEVERITY_TINT[sev] : 'bg-navy-800 border-navy-700 text-navy-300 hover:text-white'
                }`}
              >
                {sev}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes (escape hatch) */}
      <div>
        <label className="text-[10px] uppercase tracking-wide text-navy-400 block mb-2">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Anything the structured fields don't cover…"
          rows={2}
          className="w-full rounded-md px-3 py-2 bg-navy-900 border border-navy-700 text-white text-sm outline-none focus:border-accent-blue resize-none"
        />
        <p className="text-[11px] text-navy-500 mt-1">
          Target usage: under 5% of defects. Most info should be in the structured fields above.
        </p>
      </div>

      {submitError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}
    </div>
  );
}

function humanSummary(part, position, defectType, details) {
  if (!part || !defectType) return '';
  const pos = position?.label ? ` (${position.label})` : '';
  let extras = [];
  if (details?.tread_depth_32nds !== undefined) extras.push(`${details.tread_depth_32nds}/32`);
  if (details?.in_drivers_line_of_sight === true) extras.push("in driver's line of sight");
  if (details?.in_drivers_line_of_sight === false) extras.push("outside driver's line of sight");
  if (details?.lamp_type?.length) extras.push(details.lamp_type.join(', '));
  if (details?.state) extras.push(details.state);
  if (details?.expiration_month) extras.push(`expired ${details.expiration_month}`);
  if (details?.expiration_date) extras.push(`expired ${details.expiration_date}`);
  const tail = extras.length ? ` — ${extras.join(' · ')}` : '';
  return `${part.label}${pos} — ${defectType.label}${tail}`;
}
