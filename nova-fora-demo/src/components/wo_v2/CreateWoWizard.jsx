/**
 * CreateWoWizard — 3-step modal the SW opens from "+ Create WO" on the
 * Work Orders page (mockup pages 4-6).
 *
 *   Step 1  Vehicle & Defect
 *     • Vehicle picker (from DSPs this workshop services)
 *     • Part / Defect type / Position dropdowns (catalog-driven by
 *       vehicle.vehicle_class — same UX as the mid-find form)
 *     • Description (free text)
 *     • RO Number (optional — the real vendor RO# from RO Writer /
 *       Mitchell / Auto Integrate)
 *
 *   Step 2  Reason code
 *     • One of: newly_discovered / secondary / auto_integrate /
 *               customer_requested / other
 *     • Notes / Details
 *     • Banner reminds the SW that "shop-created defects must be
 *       approved by customers for work authorization" — informational
 *       (the customer still sees this in their scope-review queue).
 *
 *   Step 3  Review & Send
 *     • Read-only summary of everything entered
 *     • Send → POST /work-orders/manual → returns the new WO id
 *     • On success the parent list refreshes and the wizard closes.
 *
 * Damage photos are NOT wired in iter-1 — the upload pipeline reuses
 * `defects.uploadPhoto` and we'd need defect_id BEFORE the manual
 * endpoint runs. Iter-1b can split the flow into draft-defect → photos
 * → finalize. For now the photo block shows "Iter-1b" placeholder.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, ChevronLeft, ChevronRight, Send, Loader2, AlertTriangle,
  ClipboardPlus, Image as ImageIcon, ListChecks, Eye,
} from 'lucide-react';
import {
  workOrders as woApi,
  vehicles as vehiclesApi,
  catalog as catalogApi,
  vendorWorkshops as workshopsApi,
} from '../../api/client';

const REASON_CODES = [
  { id: 'newly_discovered',  label: 'Newly Discovered Defect' },
  { id: 'secondary',         label: 'Secondary Defect' },
  { id: 'auto_integrate',    label: 'Auto Integrate Required Service' },
  { id: 'customer_requested',label: 'Customer Requested Service' },
  { id: 'other',             label: 'Other' },
];

export default function CreateWoWizard({ user, workshopId: workshopIdProp, onClose, onCreated }) {
  // Step state
  const [step, setStep] = useState(1);

  // Form state
  const [dspId, setDspId] = useState('');           // step-1 customer picker
  const [vehicleId, setVehicleId] = useState('');
  const [part, setPart] = useState('');
  const [defectType, setDefectType] = useState('');
  const [position, setPosition] = useState('');
  const [description, setDescription] = useState('');
  const [roNumber, setRoNumber] = useState('');
  const [reasonCode, setReasonCode] = useState('newly_discovered');
  const [notes, setNotes] = useState('');

  // Pickers data
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [cat, setCat] = useState(null);
  const [catErr, setCatErr] = useState(null);

  // Workshop fallback (the wizard can be opened without an explicit
  // workshopId; auto-pick the first one this user owns).
  const [workshopId, setWorkshopId] = useState(workshopIdProp || null);
  useEffect(() => {
    if (workshopId) return;
    workshopsApi.list({ includeInactive: false }).then((res) => {
      const items = res.items || [];
      const myOrgInt = parseOrgInt(user?.organizationId);
      const mine = user?.role === 'site_admin' ? items
        : items.filter((w) => Number(w.organizationId) === myOrgInt);
      if (mine.length > 0) setWorkshopId(parseOrgInt(mine[0].id));
    }).catch(() => {});
  }, [workshopId, user]);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  // ── Load vehicles for the SW (all DSPs they service) ──
  useEffect(() => {
    setVehiclesLoading(true);
    // Backend caps per_page at 100. Walk pages if the user really has
    // more than 100 vans across DSPs they service.
    const loadAll = async () => {
      const all = [];
      let page = 1;
      // Safety stop at 10 pages = 1000 vans — more than any real DSP.
      for (let i = 0; i < 10; i += 1) {
        const res = await vehiclesApi.list({ perPage: 100, isActive: true, page });
        const items = res.items || [];
        all.push(...items);
        if (items.length < 100) break;
        page += 1;
      }
      return all;
    };
    loadAll()
      .then(setVehicles)
      .catch(() => setVehicles([]))
      .finally(() => setVehiclesLoading(false));
  }, []);

  // ── Distinct DSPs derived from the loaded fleet ──
  // (Vendors typically service 2-10 DSPs; deriving from the data we
  // already have avoids a second fetch.)
  const dspOptions = useMemo(() => {
    const seen = new Map();
    vehicles.forEach((v) => {
      const id = parseIntFromId(v.dspId);
      if (id != null && !seen.has(id)) {
        seen.set(id, { id, name: v.dsp || `DSP ${id}` });
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [vehicles]);

  // ── Vehicles filtered by selected DSP ──
  const vehiclesForDsp = useMemo(() => {
    if (!dspId) return [];
    return vehicles.filter(
      (v) => String(parseIntFromId(v.dspId)) === String(dspId),
    );
  }, [vehicles, dspId]);

  // ── Selected vehicle → reload catalog when class changes ──
  const selectedVehicle = useMemo(
    () => vehicles.find((v) => String(parseIntFromId(v.id)) === String(vehicleId)),
    [vehicles, vehicleId],
  );
  useEffect(() => {
    if (!selectedVehicle?.vehicleClass) { setCat(null); return; }
    setCatErr(null);
    catalogApi
      .load(selectedVehicle.vehicleClass)
      .then(setCat)
      .catch((e) => setCatErr(e.detail || e.message || 'Catalog failed'));
  }, [selectedVehicle]);

  // ── Cascaded catalog dropdown options ──
  // Catalog shape (per /defect-catalog response):
  //   parts: [{ id, label, defectTypes: [{ id, label, validPositions: [{id, label}] }] }]
  const parts = useMemo(() => {
    if (!Array.isArray(cat?.parts)) return [];
    return cat.parts.map((p) => ({ id: p.id, label: p.label || p.id }));
  }, [cat]);
  const partInfo = useMemo(
    () => cat?.parts?.find((p) => p.id === part) || null,
    [cat, part],
  );
  const typesForPart = useMemo(() => {
    if (!partInfo?.defectTypes) return [];
    return partInfo.defectTypes.map((t) => ({ id: t.id, label: t.label || t.id }));
  }, [partInfo]);
  const typeInfo = useMemo(
    () => partInfo?.defectTypes?.find((t) => t.id === defectType) || null,
    [partInfo, defectType],
  );
  const positionsForPair = useMemo(() => {
    if (!typeInfo?.validPositions) return [];
    return typeInfo.validPositions.map((p) => ({ id: p.id, label: p.label || p.id }));
  }, [typeInfo]);

  // ── Step validity gates ──
  const canNext1 = !!dspId && !!vehicleId && !!part && !!defectType;
  const canNext2 = !!reasonCode;

  // ── Submit on Step 3 ──
  const submit = useCallback(async () => {
    setErr(null);
    setSubmitting(true);
    try {
      const res = await woApi.manualCreate({
        vehicleId: Number(vehicleId),
        part,
        defectType,
        position: position || undefined,
        description: description.trim() || undefined,
        reasonCode,
        vendorWorkshopId: workshopId,
        roNumber: roNumber.trim() || undefined,
      });
      onCreated && onCreated(res);
      onClose && onClose();
    } catch (e) {
      setErr(e.detail || e.message || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }, [vehicleId, part, defectType, position, description, reasonCode, workshopId, roNumber, onCreated, onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="text-text-muted hover:text-text-strong"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <div className="w-9 h-9 rounded-lg bg-accent-blue/15 border border-accent-blue/40 flex items-center justify-center">
              <ClipboardPlus size={16} className="text-accent-blue" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-strong">Create Work Order</h3>
              <p className="text-[11px] text-text-muted">Send repair work to your chosen vendor</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-strong p-2 -mr-2">
            <X size={20} />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex border-b border-navy-800">
          <StepHeader index={1} label="Vehicle & Defect" current={step} />
          <StepHeader index={2} label="Reason code" current={step} />
          <StepHeader index={3} label="Review & Send" current={step} />
        </div>

        {/* Body */}
        <div className="px-4 sm:px-6 py-5 space-y-3 overflow-y-auto flex-1">
          {step === 1 && (
            <Step1
              vehiclesLoading={vehiclesLoading}
              dspOptions={dspOptions}
              dspId={dspId}
              setDspId={(v) => {
                // Changing customer wipes the vehicle + downstream picks.
                setDspId(v);
                setVehicleId('');
                setPart('');
                setDefectType('');
                setPosition('');
              }}
              vehiclesForDsp={vehiclesForDsp}
              vehicleId={vehicleId} setVehicleId={(v) => { setVehicleId(v); setPart(''); setDefectType(''); setPosition(''); }}
              cat={cat} catErr={catErr}
              part={part} setPart={(v) => { setPart(v); setDefectType(''); setPosition(''); }}
              defectType={defectType} setDefectType={(v) => { setDefectType(v); setPosition(''); }}
              position={position} setPosition={setPosition}
              description={description} setDescription={setDescription}
              roNumber={roNumber} setRoNumber={setRoNumber}
              parts={parts} typesForPart={typesForPart} positionsForPair={positionsForPair}
            />
          )}
          {step === 2 && (
            <Step2
              reasonCode={reasonCode} setReasonCode={setReasonCode}
              notes={notes} setNotes={setNotes}
            />
          )}
          {step === 3 && (
            <Step3
              vehicle={selectedVehicle}
              part={part} defectType={defectType} position={position}
              description={description} roNumber={roNumber}
              reasonCode={reasonCode} notes={notes}
            />
          )}
          {err && (
            <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium text-accent-red border border-accent-red/40 hover:bg-accent-red/10"
          >
            Cancel
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={step === 1 ? !canNext1 : !canNext2}
              className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-semibold bg-accent-blue text-white hover:opacity-90 disabled:opacity-40"
            >
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-semibold bg-accent-green text-navy-950 hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {submitting ? 'Sending…' : 'Create Work Order'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step header
// ─────────────────────────────────────────────────────
function StepHeader({ index, label, current }) {
  const active = current === index;
  const done = current > index;
  return (
    <div className="flex-1 px-3 py-2 border-b-2 text-xs"
      style={{ borderColor: active ? 'rgb(96, 165, 250)' : (done ? 'rgb(74, 222, 128)' : 'transparent') }}>
      <div className={`font-semibold ${active ? 'text-accent-blue' : done ? 'text-accent-green' : 'text-text-muted'}`}>
        {index}. {label}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Step 1 — Vehicle & Defect
// ─────────────────────────────────────────────────────
function Step1({
  vehiclesLoading, dspOptions, dspId, setDspId, vehiclesForDsp,
  vehicleId, setVehicleId,
  cat, catErr, part, setPart, defectType, setDefectType, position, setPosition,
  description, setDescription, roNumber, setRoNumber,
  parts, typesForPart, positionsForPair,
}) {
  return (
    <>
      {/* Customer (DSP) — pick first; vehicle list filters off this. */}
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">
          Customer
        </span>
        {vehiclesLoading ? (
          <div className="text-xs text-text-muted flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading customers…
          </div>
        ) : dspOptions.length === 0 ? (
          <div className="text-xs text-text-muted">
            No customers found — make sure you have vehicles associated with at least one DSP.
          </div>
        ) : (
          <select
            value={dspId}
            onChange={(e) => setDspId(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none focus:border-accent-blue"
          >
            <option value="">— Pick a customer —</option>
            {dspOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
      </label>

      {/* Vehicle — narrowed to chosen customer. */}
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">
          Vehicle
        </span>
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          disabled={!dspId}
          className="w-full px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none focus:border-accent-blue disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <option value="">
            {!dspId
              ? '— Pick a customer first —'
              : vehiclesForDsp.length === 0
              ? '— No active vehicles for this customer —'
              : `— Pick a vehicle (${vehiclesForDsp.length} available) —`}
          </option>
          {vehiclesForDsp.map((v) => (
            <option key={v.id} value={parseIntFromId(v.id)}>
              Van {v.fleetId || v.id} · {v.year} {v.make} {v.model} · {v.plate || ''}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">Part</span>
          <select
            value={part}
            onChange={(e) => setPart(e.target.value)}
            disabled={!cat}
            className="w-full px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none disabled:opacity-40"
          >
            <option value="">— Part —</option>
            {parts.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">Defect type</span>
          <select
            value={defectType}
            onChange={(e) => setDefectType(e.target.value)}
            disabled={!part || typesForPart.length === 0}
            className="w-full px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none disabled:opacity-40"
          >
            <option value="">— Defect type —</option>
            {typesForPart.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">Position</span>
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          disabled={!defectType || positionsForPair.length === 0}
          className="w-full px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none disabled:opacity-40"
        >
          <option value="">{positionsForPair.length === 0 ? '— No position needed —' : '— Position (optional) —'}</option>
          {positionsForPair.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">Description</span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What did you find / what needs repair?"
          className="w-full px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong placeholder-text-muted outline-none focus:border-accent-blue resize-none"
        />
      </label>

      {/* Damage Photos placeholder — iter-1b will wire to defects.uploadPhoto */}
      <div className="rounded-md border border-dashed border-navy-700 px-3 py-3 flex items-center gap-3 text-xs text-text-muted">
        <ImageIcon className="w-5 h-5" />
        <div className="flex-1">
          <div className="font-semibold text-text-muted">Damage Photos</div>
          <div>Wide shot + close-ups recommended. Photo upload lands in iter-1b.</div>
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">RO Number</span>
        <input
          type="text"
          value={roNumber}
          onChange={(e) => setRoNumber(e.target.value)}
          placeholder="e.g. RO-12345 — leave blank if not ready"
          className="w-full px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong placeholder-text-muted outline-none focus:border-accent-blue"
        />
      </label>

      {catErr && <div className="text-[10px] text-accent-red">{catErr}</div>}
    </>
  );
}

// ─────────────────────────────────────────────────────
// Step 2 — Reason code
// ─────────────────────────────────────────────────────
function Step2({ reasonCode, setReasonCode, notes, setNotes }) {
  return (
    <>
      <div className="rounded-md border border-accent-gold/40 bg-accent-gold/5 px-3 py-2 text-xs text-accent-gold flex items-start gap-2">
        <ListChecks className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Shop-created defects must be approved by customers for work authorization.</span>
      </div>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">
          How defects get routed
        </span>
        <div className="space-y-1">
          {REASON_CODES.map((r) => (
            <label key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-md border border-navy-700 bg-navy-800/40 cursor-pointer hover:bg-navy-800">
              <input
                type="radio"
                name="reason"
                checked={reasonCode === r.id}
                onChange={() => setReasonCode(r.id)}
                className="accent-accent-blue"
              />
              <span className="text-sm text-text-strong">{r.label}</span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-[10px] italic text-text-muted">
        Want a different vendor for a repair type? Configure preferred vendors in Admin → Vendor Workshops (coming soon).
      </p>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">Notes / Details</span>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything else the customer or other techs should see…"
          className="w-full px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong placeholder-text-muted outline-none focus:border-accent-blue resize-none"
        />
      </label>
    </>
  );
}

// ─────────────────────────────────────────────────────
// Step 3 — Review & Send
// ─────────────────────────────────────────────────────
function Step3({ vehicle, part, defectType, position, description, roNumber, reasonCode, notes }) {
  const reasonLabel = REASON_CODES.find((r) => r.id === reasonCode)?.label || reasonCode;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Eye className="w-3.5 h-3.5" />
        Review the details below — clicking <span className="font-semibold text-text-strong">Create Work Order</span> sends it to the vendor.
      </div>
      <Box title="Vehicle">
        {vehicle ? (
          <>
            <div className="text-sm font-semibold text-text-strong">
              Van {vehicle.fleetId || vehicle.id}
            </div>
            <div className="text-xs text-text-muted">
              {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.dsp || `DSP ${vehicle.dspId}`}
            </div>
          </>
        ) : 'No vehicle picked.'}
      </Box>
      <Box title="Defect">
        <div className="text-sm text-text-strong">
          {(part || '').replace(/_/g, ' ')}
          {defectType ? ` — ${defectType.replace(/_/g, ' ')}` : ''}
        </div>
        {position && <div className="text-xs text-text-muted">Position: {position.replace(/_/g, ' ')}</div>}
        {description && <div className="text-xs text-text-muted mt-1">"{description}"</div>}
      </Box>
      <Box title="Reason">
        <div className="text-sm text-text-strong">{reasonLabel}</div>
        {notes && <div className="text-xs text-text-muted mt-1">{notes}</div>}
      </Box>
      {roNumber && (
        <Box title="RO Number">
          <div className="text-sm font-mono text-text-strong">{roNumber}</div>
        </Box>
      )}
    </div>
  );
}

function Box({ title, children }) {
  return (
    <div className="rounded-md border border-navy-700 bg-navy-800/30 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

function parseOrgInt(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function parseIntFromId(raw) {
  if (raw == null) return null;
  const s = String(raw);
  const m = s.match(/(\d+)$/);
  return m ? Number(m[1]) : Number(s);
}
