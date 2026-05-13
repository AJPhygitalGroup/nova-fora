import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Truck, Plus, Upload, Search, Filter, Edit3, Trash2, MoreVertical,
  X, ArrowRight, ArrowLeft, Check, CheckCircle2, AlertCircle, AlertTriangle, FileSpreadsheet,
  ChevronDown, ChevronUp, Eye, Minus, Info, Download, Lock, Copy, Users, Building2,
  RefreshCw,
} from 'lucide-react';
import Badge from './ui/Badge';
import VehicleDetailPage from './VehicleDetailPage';
import { getViewMode } from '../lib/permissions';
import { FlexFleetModal } from './FleetSnapshot';
import { vehicles as vehiclesApi, APIError } from '../api/client';

// ============================================================
// Helpers
// ============================================================
function parseModel(modelStr) {
  // e.g. "2022 Ford Transit 250" → { year: 2022, make: 'Ford', model: 'Transit 250' }
  const parts = modelStr.split(' ');
  const year = parseInt(parts[0], 10);
  const make = parts[1] || '';
  const model = parts.slice(2).join(' ') || '';
  return { year, make, model };
}

function generateVin(fleetId) {
  // Deterministic fake VIN based on fleet id
  const hash = fleetId.replace(/\D/g, '');
  return `1FTBW3XM${hash.padStart(2, '0').slice(0, 2)}XAJ${hash.padStart(4, '0').slice(-4)}A${hash.padEnd(3, '7').slice(0, 3)}2`.toUpperCase().slice(0, 17);
}

function generateColor(fleetId) {
  const colors = ['White', 'Blue', 'Silver', 'Black', 'Gray'];
  const n = parseInt(fleetId.replace(/\D/g, ''), 10) || 0;
  return colors[n % colors.length];
}

// Default location per vehicle. Parking Lot is the baseline; a couple of
// seed vans are marked offsite/checked_out to show the three states in the demo.
const LOCATION_SEEDS = {
  'VAN-1072': 'checked_out', // shop — grounded / overnight repair
  'VAN-1091': 'offsite',      // customer manually set
};

function enrichVehicle(v) {
  const { year, make, model } = parseModel(v.model);
  return {
    ...v,
    fleetId: v.id,
    year,
    make,
    model,
    vin: generateVin(v.id),
    color: generateColor(v.id),
    vehicleClass: v.id.startsWith('VAN-3') || v.id.startsWith('VAN-5') ? 'Branded Cargo' : v.id.startsWith('VAN-4') ? 'Rental' : 'Owned',
    fmc: v.id.startsWith('VAN-1') ? 'Wheels' : v.id.startsWith('VAN-2') ? 'Element' : v.id.startsWith('VAN-3') ? 'Wheels' : v.id.startsWith('VAN-4') ? 'Rented/Owned' : 'Element',
    isFmcManaged: !v.id.startsWith('VAN-4'),
    location: LOCATION_SEEDS[v.id] || 'parking_lot',
  };
}

// Transform a VehicleResponse from the real API into the shape the existing
// components expect. The backend persists vehicle_class, ownership, and fmc;
// color and location are still frontend-only metadata until the admin panel
// owns them (post-Jun 15).
function fromApiVehicle(v) {
  // API returns (camelCase via snakeToCamel): id (VAN-XXXX), dspId, dsp,
  // fleetId, vin, plate, year, make, model, mileage, grounded, groundedReason,
  // defectCount, lastInspected, photos, isActive, vehicleClass, ownership, fmc.
  const seed = parseInt(String(v.id).replace(/\D/g, ''), 10) || 0;

  return {
    // Identity
    id: v.id,
    fleetId: v.fleetId,
    dspId: v.dspId,
    dsp: v.dsp,
    // Vehicle identity (real)
    vin: v.vin,
    plate: v.plate,
    year: v.year,
    make: v.make,
    model: v.model,
    // State
    mileage: v.mileage,
    grounded: v.grounded,
    groundedReason: v.groundedReason,
    isActive: v.isActive ?? true,
    // Real persisted fields (V2.2 + ownership + fmc):
    vehicleClass: v.vehicleClass || 'regular_cargo_van',
    ownership: LEGACY_OWNERSHIP_TO_GRANULAR[v.ownership] || v.ownership || 'amazon_owned',
    fmc: v.fmc || '',
    // Derived (stubbed until inspections are live)
    defectCount: v.defectCount ?? 0,
    lastInspected: v.lastInspected || 'Never',
    photos: v.photos ?? 0,
    inspector: v.inspector || '—',
    // Color is still derived (not on the model); ownership-driven FMC stays
    // local to the row.
    color: ['White', 'Blue', 'Silver', 'Black', 'Gray'][seed % 5],
    isFmcManaged: !!v.fmc,
    // Real persisted location (parking_lot | offsite | checked_out). Falls
    // back to parking_lot on legacy rows that haven't been migrated yet.
    location: v.location || 'parking_lot',
  };
}

const LOCATION_OPTIONS = [
  { id: 'parking_lot',  label: 'Parking Lot', icon: 'P',  variant: 'blue',
    description: 'At the station — available for routing and repairs' },
  { id: 'offsite',      label: 'Offsite',     icon: '⛌', variant: 'gold',
    description: 'Not at the station — vendors will skip this van for repairs' },
  { id: 'checked_out',  label: 'Checked Out', icon: '🔧', variant: 'purple',
    description: 'Moved to vendor shop for repair — vendor Check-In to restore',
    vendorOnly: true }, // only vendor can toggle this; DSP sees it as read-only
];

// ============================================================
// Add/Edit Vehicle Modal (the "all-fields-editable-at-once" fix)
// ============================================================
// V2.2: vehicle_class drives the DVIC template. Each entry below maps a
// user-friendly label to one of the backend's 5 enum values. Ownership is
// a separate metadata axis that filters branded-only DVIC items
// (DOT decal, Prime decal) when the van is Owner/Rented.
const VEHICLE_TYPES = [
  { value: 'regular_cargo_van',   label: 'Branded Cargo Van' },
  { value: 'custom_delivery_van', label: 'Custom Delivery Van (CDV)' },
  { value: 'step_van_dot',        label: 'Step Van (DOT)' },
  { value: 'box_truck_dot',       label: 'Box Truck (AMXL)' },
  { value: 'electric_vehicle',    label: 'Electric Vehicle' },
];
// Mirror Amazon Cortex `ownershipType`. Two of these (amazon_owned,
// amazon_leased) carry Amazon DOT + Prime decals; the other two don't —
// the wizard reads this to filter branded-only DVIC items.
const OWNERSHIPS = [
  { value: 'amazon_owned',  label: 'Amazon-Owned'  },
  { value: 'amazon_leased', label: 'Amazon-Leased' },
  { value: 'dsp_owned',     label: 'DSP-Owned'     },
  { value: 'rental',        label: 'Rental'        },
];

// Used by the table view + filter pills to render the right label
const VEHICLE_TYPE_LABEL = Object.fromEntries(
  VEHICLE_TYPES.map(({ value, label }) => [value, label]),
);
const OWNERSHIP_LABEL = Object.fromEntries(
  OWNERSHIPS.map(({ value, label }) => [value, label]),
);

// Best-effort migration from legacy display strings → new enum value.
// Used when the backend hasn't yet been updated for an old vehicle row.
const LEGACY_VEHICLE_CLASS_TO_TYPE = {
  'Branded Cargo': 'regular_cargo_van',
  'Step Van':      'step_van_dot',
  'Box Truck':     'box_truck_dot',
  'Rental':        'regular_cargo_van',
  'Owned':         'regular_cargo_van',
};
const LEGACY_VEHICLE_CLASS_TO_OWNERSHIP = {
  'Branded Cargo': 'amazon_owned',
  'Step Van':      'amazon_owned',
  'Box Truck':     'amazon_owned',
  'Rental':        'rental',
  'Owned':         'dsp_owned',
};
// Pre-V2.2 ownership values (branded/owner/rented) → granular Cortex values
const LEGACY_OWNERSHIP_TO_GRANULAR = {
  'branded': 'amazon_owned',
  'owner':   'dsp_owned',
  'rented':  'rental',
};

// Common FMC values shown as autocomplete suggestions. The field is
// free-text — Amazon's vehicleProvider column may carry anything.
const FMC_OPTIONS = [
  'Element', 'LP', 'Wheels', 'Holman', 'ARI',
  'Budget', 'Penske', 'Enterprise', 'Merchants',
];
const MAKES = ['Ford', 'Mercedes', 'Ram', 'Chevrolet', 'Isuzu'];

function VehicleModal({ vehicle, onSave, onClose, onDelete, readOnly = false }) {
  const { t } = useTranslation('fleet');
  const isEdit = !!vehicle;
  const [form, setForm] = useState(vehicle ? {
    fleetId: vehicle.fleetId,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    vin: vehicle.vin,
    plate: vehicle.plate,
    // V2.2: vehicleClass is the backend enum (drives DVIC). ownership is
    // its own axis. Legacy mock rows might have a label string in
    // vehicle.vehicleClass — translate it once on load so the form
    // shows a sensible default.
    vehicleClass:
      VEHICLE_TYPE_LABEL[vehicle.vehicleClass]
        ? vehicle.vehicleClass
        : (LEGACY_VEHICLE_CLASS_TO_TYPE[vehicle.vehicleClass] || 'regular_cargo_van'),
    ownership:
      LEGACY_OWNERSHIP_TO_GRANULAR[vehicle.ownership] || vehicle.ownership
      || LEGACY_VEHICLE_CLASS_TO_OWNERSHIP[vehicle.vehicleClass]
      || 'amazon_owned',
    fmc: vehicle.fmc,
  } : {
    fleetId: '',
    year: new Date().getFullYear(),
    make: 'Ford',
    model: '',
    color: 'White',
    vin: '',
    plate: '',
    vehicleClass: 'regular_cargo_van',
    ownership: 'amazon_owned',
    fmc: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const update = (k, v) => {
    setForm({ ...form, [k]: v });
    if (saveError) setSaveError(null);  // clear after the user tweaks
  };

  // VIN check: 17 chars, no I/O/Q (FMVSS reserves those for 1/0/0).
  // We surface a friendlier hint than the raw Pydantic regex error.
  const vinUpper = (form.vin || '').toUpperCase().trim();
  const vinHasIllegalChars = /[IOQ]/.test(vinUpper);
  const vinLengthOk = vinUpper.length === 17;
  const vinClientValid = vinLengthOk && !vinHasIllegalChars && /^[A-HJ-NPR-Z0-9]{17}$/.test(vinUpper);

  const isValid = form.fleetId && form.vin && form.plate && form.make && form.model && vinClientValid;

  const handleSave = async () => {
    setSaveError(null);
    if (!vinClientValid) {
      setSaveError(
        vinHasIllegalChars
          ? t('vehicleModal.vinErrorReserved', 'VIN contains I / O / Q — those letters are reserved (use 1 / 0 / 0).')
          : !vinLengthOk
            ? t('vehicleModal.vinErrorLengthFmt', { count: vinUpper.length, defaultValue: `VIN must be exactly 17 characters (got ${vinUpper.length}).` })
            : t('vehicleModal.vinErrorFormat', 'VIN format is invalid.'),
      );
      return;
    }
    setSubmitting(true);
    try {
      // onSave is async and throws on failure; only close on success
      await onSave(form);
      onClose();
    } catch (err) {
      // Try to surface the friendliest message available
      const detail = err?.detail || err?.message || 'Save failed';
      // If FastAPI returned a 422 with a body.<field> path, strip the prefix
      const cleaned = typeof detail === 'string'
        ? detail.replace(/^body\.[a-z_]+:\s*/i, '')
        : 'Save failed — check the form fields and try again.';
      setSaveError(cleaned);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 280 }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-green/15 flex items-center justify-center">
              <Truck size={16} className="text-accent-green" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                {readOnly ? t('vehicleModal.titleReadOnly', 'Vehicle Details')
                  : isEdit ? t('vehicleModal.titleEdit', 'Edit Vehicle')
                  : t('vehicleModal.titleAdd', 'Add New Vehicle')}
              </h3>
              <p className="text-[11px] text-navy-400">
                {readOnly ? `${vehicle.fleetId} · ${vehicle.dsp}`
                  : isEdit ? t('vehicleModal.subtitleEditFmt', { fleetId: vehicle.fleetId, defaultValue: `Modify ${vehicle.fleetId}` })
                  : t('vehicleModal.subtitleAdd', 'Register a new van in your fleet')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>

        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1 space-y-4">
          {isEdit && !readOnly && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-green/10 border border-accent-green/30 text-xs text-accent-green">
              <CheckCircle2 size={12} /> {t('vehicleModal.allEditable', 'All fields are editable at once — no need to click a pencil per field.')}
            </div>
          )}
          {readOnly && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-xs text-accent-blue">
              <Eye size={12} /> {t('vehicleModal.readOnlyHint', 'Read-only — vehicles are managed by the DSP owner')}
            </div>
          )}

          {saveError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-accent-red/10 border border-accent-red/30 text-xs text-accent-red">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-0.5">{t('vehicleModal.saveError', "Couldn't save")}</div>
                <div className="text-accent-red/90">{saveError}</div>
              </div>
            </div>
          )}

          <fieldset disabled={readOnly} className={`${readOnly ? 'opacity-90' : ''} contents`}>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">{t('vehicleModal.fleetIdLabel', 'Fleet ID *')}</label>
              <input value={form.fleetId} onChange={(e) => update('fleetId', e.target.value)}
                placeholder="VAN-1099"
                disabled={isEdit}
                className={`w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm border text-white placeholder-navy-500 outline-none focus:border-accent-blue ${
                  isEdit ? 'bg-navy-800/30 border-navy-800 cursor-not-allowed' : 'bg-navy-800 border-navy-700'
                }`} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">{t('vehicleModal.plateLabel', 'License Plate *')}</label>
              <input value={form.plate} onChange={(e) => update('plate', e.target.value.toUpperCase())}
                placeholder="WA-1A99-AZ"
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">
              {t('vehicleModal.vinLabel', 'VIN *')}
              {form.vin && !vinClientValid && (
                <span className="ml-1 normal-case font-normal text-accent-red">{t('vehicleModal.vinInvalid', '— invalid')}</span>
              )}
            </label>
            <input value={form.vin} onChange={(e) => update('vin', e.target.value.toUpperCase())}
              placeholder="1FTBW3XM22AJF3472"
              maxLength={17}
              aria-invalid={form.vin ? !vinClientValid : undefined}
              className={`w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm font-mono bg-navy-800 border text-white placeholder-navy-500 outline-none ${
                form.vin && !vinClientValid
                  ? 'border-accent-red focus:border-accent-red ring-1 ring-accent-red/40'
                  : 'border-navy-700 focus:border-accent-blue'
              }`} />
            {form.vin && !vinClientValid && (
              <p className="text-[11px] text-accent-red mt-1.5 flex items-start gap-1">
                <AlertCircle size={11} className="shrink-0 mt-0.5" />
                <span>
                  {vinHasIllegalChars
                    ? t('vehicleModal.vinHelpReserved', 'VIN cannot contain I, O, or Q — those letters are reserved (use 1, 0, 0).')
                    : !vinLengthOk
                      ? t('vehicleModal.vinHelpLengthFmt', { count: vinUpper.length, defaultValue: `VIN must be exactly 17 characters — you typed ${vinUpper.length}.` })
                      : t('vehicleModal.vinHelpFormat', 'VIN format invalid — only A-Z (no I/O/Q) and 0-9 allowed.')}
                </span>
              </p>
            )}
            {!form.vin && (
              <p className="text-[10px] text-navy-500 mt-1">{t('vehicleModal.vinHelpEmpty', '17 characters · no I, O, or Q')}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">{t('vehicleModal.yearLabel', 'Year')}</label>
              <input type="number" value={form.year} onChange={(e) => update('year', parseInt(e.target.value, 10))}
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">{t('vehicleModal.makeLabel', 'Make')}</label>
              <select value={form.make} onChange={(e) => update('make', e.target.value)}
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                {MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">{t('vehicleModal.colorLabel', 'Color')}</label>
              <select value={form.color} onChange={(e) => update('color', e.target.value)}
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                {['White', 'Blue', 'Silver', 'Black', 'Gray'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">{t('vehicleModal.modelLabel', 'Model *')}</label>
            <input value={form.model} onChange={(e) => update('model', e.target.value)}
              placeholder={t('vehicleModal.modelPlaceholder', 'Transit 250')}
              className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">
              {t('vehicleModal.vehicleTypeLabel', 'Vehicle Type *')}
            </label>
            <select value={form.vehicleClass} onChange={(e) => update('vehicleClass', e.target.value)}
              className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
              {VEHICLE_TYPES.map((vt) => <option key={vt.value} value={vt.value}>{vt.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">
                {t('vehicleModal.ownershipLabel', 'Ownership')}
              </label>
              <select value={form.ownership} onChange={(e) => update('ownership', e.target.value)}
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                {OWNERSHIPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">
                {t('vehicleModal.fmcLabel', 'FMC')}
              </label>
              <input
                type="text"
                value={form.fmc || ''}
                onChange={(e) => update('fmc', e.target.value)}
                list="fmc-options"
                placeholder={t('vehicleModal.fmcPlaceholder', 'e.g. Element, LP, Budget…')}
                maxLength={50}
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
              />
              <datalist id="fmc-options">
                {FMC_OPTIONS.map((f) => <option key={f} value={f} />)}
              </datalist>
            </div>
          </div>
          </fieldset>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          {readOnly ? (
            <>
              <span /> {/* spacer */}
              <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-navy-800 border border-navy-700 text-white hover:bg-navy-700 cursor-pointer">
                {t('vehicleModal.close', 'Close')}
              </button>
            </>
          ) : (
            <>
              {isEdit && onDelete ? (
                <button onClick={() => setShowConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium text-accent-red hover:bg-accent-red/10 cursor-pointer">
                  <Trash2 size={14} /> {t('vehicleModal.delete', 'Delete')}
                </button>
              ) : (
                <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">{t('vehicleModal.cancel', 'Cancel')}</button>
              )}
              <button onClick={handleSave} disabled={!isValid || submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-green to-accent-blue text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                {submitting
                  ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> {t('vehicleModal.saving', 'Saving…')}</>)
                  : (<><Check size={14} /> {isEdit ? t('vehicleModal.saveChanges', 'Save Changes') : t('vehicleModal.addVehicle', 'Add Vehicle')}</>)}
              </button>
            </>
          )}
        </div>

        <AnimatePresence>
          {showConfirmDelete && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-navy-950/90 backdrop-blur-sm flex items-center justify-center p-6"
              onClick={() => setShowConfirmDelete(false)}>
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} onClick={(e) => e.stopPropagation()}
                className="bg-navy-900 border border-accent-red/40 rounded-xl p-5 max-w-sm w-full text-center">
                <div className="w-12 h-12 rounded-full bg-accent-red/15 flex items-center justify-center mx-auto mb-3">
                  <AlertTriangle size={22} className="text-accent-red" />
                </div>
                <h4 className="text-base font-semibold text-white mb-1">{t('vehicleModal.confirmDeleteTitleFmt', { fleetId: vehicle.fleetId, defaultValue: `Delete ${vehicle.fleetId}?` })}</h4>
                <p className="text-xs text-navy-400 mb-4">{t('vehicleModal.confirmDeleteBody', 'This removes the vehicle from your fleet. Historical inspection data is kept.')}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowConfirmDelete(false)} className="flex-1 px-4 py-2 rounded-lg border border-navy-600 text-navy-300 text-sm hover:bg-navy-800 cursor-pointer">{t('vehicleModal.cancel', 'Cancel')}</button>
                  <button onClick={() => { onDelete(vehicle); onClose(); }} className="flex-1 px-4 py-2 rounded-lg bg-accent-red text-white text-sm font-semibold hover:opacity-90 cursor-pointer">{t('vehicleModal.delete', 'Delete')}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Bulk Upload Modal — 3-step flow with DELTA PREVIEW
// ============================================================
function BulkUploadModal({ currentFleet, onApply, onClose }) {
  const { t } = useTranslation('fleet');
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  // Real parsed state (replaces the mock delta)
  const [parseResult, setParseResult] = useState(null);  // { mapped, errors, skipped, missingColumns }
  const [parseError, setParseError] = useState(null);
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const [applyError, setApplyError] = useState(null);
  // NOTE: legacy in-modal success view was removed (2026-05-12). On a
  // successful Apply the modal now closes itself via onClose() and the
  // parent renders a separate <BulkUploadSuccessPrompt /> with the summary,
  // so the user sees a clear "upload was successful" dialog instead of
  // staying inside the same upload modal.

  // Real delta computed from the parsed XLSX rows.
  // Match by VIN (globally unique) — fleet_id is DSP-internal and can collide
  // when a DSP renames a van.
  const delta = useMemo(() => {
    if (!parseResult || !parseResult.mapped) return null;
    const incoming = parseResult.mapped;
    const byVinExisting = new Map(currentFleet.map((v) => [v.vin?.toUpperCase(), v]));
    const incomingVins = new Set(incoming.map((v) => v.vin));

    const newVans = [];
    const updatedVans = [];
    const unchangedVans = [];

    for (const inc of incoming) {
      const existing = byVinExisting.get(inc.vin);
      if (!existing) {
        newVans.push(inc);
        continue;
      }
      const changes = [];
      const cmp = (field, label, normalize = (x) => x) => {
        if (normalize(existing[field]) !== normalize(inc[field])) {
          changes.push({ field: label, old: existing[field], new: inc[field] });
        }
      };
      cmp('fleetId', 'Fleet ID');
      cmp('plate', 'Plate', (p) => (p || '').toUpperCase());
      cmp('year', 'Year', Number);
      cmp('make', 'Make');
      cmp('model', 'Model');
      cmp('vehicleClass', 'Type');
      cmp('ownership', 'Ownership');
      if (changes.length) updatedVans.push({ ...inc, changes });
      else unchangedVans.push(inc);
    }

    const deactivatedVans = currentFleet.filter(
      (v) => v.isActive !== false && !incomingVins.has(v.vin?.toUpperCase()),
    );

    return {
      totalInFile: incoming.length,
      currentTotal: currentFleet.length,
      newVans,
      updatedVans,
      unchangedVans,
      deactivatedVans,
    };
  }, [parseResult, currentFleet]);

  const handleFile = async (f) => {
    setFile({ name: f.name, size: f.size });
    setParsing(true);
    setParseError(null);
    setParseResult(null);
    try {
      // Defer xlsx import so the bundle only pays for it when the user
      // actually opens the upload modal (~600 KB gzipped library).
      // SheetJS is CommonJS — Vite exposes `read` and `utils` as named
      // exports on the namespace object, NOT under .default.
      const [XLSX, parserMod] = await Promise.all([
        import('xlsx'),
        import('../lib/amazonFleetParser'),
      ]);
      const xlsxRead = XLSX.read || XLSX.default?.read;
      const sheetToJson = XLSX.utils?.sheet_to_json || XLSX.default?.utils?.sheet_to_json;
      const { parseFleetSheet } = parserMod;
      if (typeof xlsxRead !== 'function' || typeof sheetToJson !== 'function') {
        throw new Error('XLSX library failed to load — refresh and try again.');
      }
      const buf = await f.arrayBuffer();
      const wb = xlsxRead(buf, { type: 'array', cellDates: false });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error('No sheets in this file.');
      const ws = wb.Sheets[firstSheet];
      // header: 1 → array of arrays (rows of cell values, header in row 0)
      const rows = sheetToJson(ws, {
        header: 1,
        defval: null,
        raw: true,
        blankrows: false,
      });
      const result = parseFleetSheet(rows);
      if (result.missingColumns?.length) {
        throw new Error(
          `Missing required column(s): ${result.missingColumns.join(', ')}.\n`
          + 'Expected the Amazon Logistics Fleet Data spreadsheet — at minimum: '
          + 'vin, vehicleName, licensePlateNumber, make, model, year.',
        );
      }
      setParseResult(result);
      setStep(2);
    } catch (err) {
      setParseError(err?.message || String(err));
    } finally {
      setParsing(false);
    }
  };

  const handleApply = async () => {
    if (!parseResult?.mapped?.length) return;
    setApplying(true);
    setApplyError(null);
    try {
      const { vehicles: vehiclesApi } = await import('../api/client');
      const rows = parseResult.mapped.map((m) => ({
        fleetId: m.fleetId,
        vin: m.vin,
        plate: m.plate,
        year: m.year,
        make: m.make,
        model: m.model,
        mileage: m.mileage ?? 0,
        vehicleClass: m.vehicleClass,
        ownership: m.ownership,
        fmc: m.fmc ?? null,
      }));
      const res = await vehiclesApi.bulkUpsert({
        rows,
        deactivateMissing,
      });
      // UX FIX (2026-05-12): close the upload modal immediately on success
      // and hand the summary up so the parent can show a dedicated success
      // prompt. The previous "stay inside the same modal with a green check
      // and a Done button" UI felt to the user like the upload form had
      // just reopened — they expected a clean confirmation dialog.
      onApply?.(res);
      onClose?.();
    } catch (err) {
      const msg = err?.detail || err?.message || 'Upload failed';
      setApplyError(typeof msg === 'string' ? msg : 'Upload failed');
    } finally {
      setApplying(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 280 }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-3xl w-full h-[95vh] sm:h-auto sm:max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-blue/15 flex items-center justify-center">
              <FileSpreadsheet size={16} className="text-accent-blue" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{t('bulkUpload.title', 'Bulk Upload Vehicles')}</h3>
              <p className="text-[11px] text-navy-400">{t('bulkUpload.subtitle', 'Sync your Amazon Logistics Fleet Data spreadsheet')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>

        {/* Progress */}
        <div className="px-4 sm:px-6 pt-4">
          <div className="flex items-center gap-2 mb-3">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex-1 h-1 rounded-full bg-navy-800 overflow-hidden">
                <motion.div className="h-full bg-gradient-to-r from-accent-blue to-accent-purple"
                  initial={false} animate={{ width: step >= s ? '100%' : '0%' }} transition={{ duration: 0.4 }} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-navy-400 mb-2">
            <span className={step >= 1 ? 'text-white font-semibold' : ''}>{t('bulkUpload.stepProgress.upload', '1. Upload file')}</span>
            <span className={step >= 2 ? 'text-white font-semibold' : ''}>{t('bulkUpload.stepProgress.review', '2. Review delta')}</span>
            <span className={step >= 3 ? 'text-white font-semibold' : ''}>{t('bulkUpload.stepProgress.apply', '3. Apply')}</span>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1">
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="rounded-lg bg-accent-blue/10 border border-accent-blue/30 p-3 text-xs text-navy-200 flex items-start gap-2">
                  <Info size={14} className="text-accent-blue mt-0.5 shrink-0" />
                  <div>
                    {t('bulkUpload.introBodyPart1', 'Upload your')} <strong className="text-white">{t('bulkUpload.introTitle', 'Fleet Data spreadsheet')}</strong> {t('bulkUpload.introBodyPart2', 'from Amazon Logistics. Nova Fora will compare it with your current fleet and show you exactly what will change —')} <strong className="text-white">{t('bulkUpload.introBodyPart3', 'nothing is deactivated silently.')}</strong>
                  </div>
                </div>

                <label className="block border-2 border-dashed border-navy-700/60 bg-navy-800/20 rounded-xl p-8 hover:bg-navy-800/40 cursor-pointer transition-colors text-center">
                  <div className="w-14 h-14 mx-auto rounded-xl bg-accent-blue/15 flex items-center justify-center mb-3">
                    <Upload size={24} className="text-accent-blue" />
                  </div>
                  <div className="text-sm font-semibold text-white mb-1">
                    {parsing ? t('bulkUpload.dropzoneParsing', 'Parsing file…') : file ? file.name : t('bulkUpload.dropzoneIdle', 'Drop your CSV / XLSX file here')}
                  </div>
                  <div className="text-[11px] text-navy-400">
                    {parsing ? t('bulkUpload.dropzoneDetecting', 'Detecting columns and matching fleet IDs…') : t('bulkUpload.dropzoneClickHint', 'or click to browse')}
                  </div>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />
                  {parsing && (
                    <div className="mt-4 flex justify-center">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        className="w-5 h-5 border-2 border-accent-blue/40 border-t-accent-blue rounded-full" />
                    </div>
                  )}
                </label>

                <div className="text-xs text-navy-400 leading-relaxed">
                  {t('bulkUpload.sourceHint', 'Source: the Fleet Data export from your Amazon Logistics Cortex portal (Active vehicles, .xlsx). Required columns: vin · vehicleName · licensePlateNumber · make · model · year. serviceTier (vehicle type) and ownershipType (Branded / Owner / Rented) are picked up automatically when present.')}
                </div>

                {parseError && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/10 border border-accent-red/40 text-xs text-accent-red">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <div className="whitespace-pre-line">{parseError}</div>
                  </div>
                )}
              </motion.div>
            ) : step === 2 ? (
              <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-accent-green/10 border border-accent-green/30 p-3 text-center">
                    <Plus size={16} className="mx-auto text-accent-green mb-1" />
                    <div className="text-lg font-bold text-white">{delta.newVans.length}</div>
                    <div className="text-[10px] text-navy-400">{t('bulkUpload.toAdd', 'To add')}</div>
                  </div>
                  <div className="rounded-lg bg-accent-blue/10 border border-accent-blue/30 p-3 text-center">
                    <Edit3 size={16} className="mx-auto text-accent-blue mb-1" />
                    <div className="text-lg font-bold text-white">{delta.updatedVans.length}</div>
                    <div className="text-[10px] text-navy-400">{t('bulkUpload.toUpdate', 'To update')}</div>
                  </div>
                  <div className="rounded-lg bg-accent-red/10 border border-accent-red/30 p-3 text-center">
                    <Minus size={16} className="mx-auto text-accent-red mb-1" />
                    <div className="text-lg font-bold text-white">{delta.deactivatedVans.length}</div>
                    <div className="text-[10px] text-navy-400">{t('bulkUpload.toDeactivate', 'To deactivate')}</div>
                  </div>
                </div>

                {/* Parse warnings — rows the parser couldn't accept */}
                {parseResult?.errors?.length > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-orange/10 border border-accent-orange/40 text-xs text-navy-200">
                    <AlertTriangle size={14} className="text-accent-orange mt-0.5 shrink-0" />
                    <div>
                      {t('bulkUpload.rowsSkippedFmt', { count: parseResult.errors.length, defaultValue: `${parseResult.errors.length} row(s) skipped due to validation errors. Top reasons:` })}
                      <ul className="mt-1 list-disc list-inside text-[11px] text-navy-300 space-y-0.5">
                        {parseResult.errors.slice(0, 3).map((e) => (
                          <li key={e.rowIndex} className="truncate">
                            {t('bulkUpload.rowErrorFmt', { row: e.rowIndex, error: e.error, defaultValue: `Row ${e.rowIndex}: ${e.error}` })}
                          </li>
                        ))}
                        {parseResult.errors.length > 3 && (
                          <li className="text-navy-400">{t('bulkUpload.moreErrorsFmt', { count: parseResult.errors.length - 3, defaultValue: `…and ${parseResult.errors.length - 3} more` })}</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Mapping audit — show how Cortex serviceTier and
                    ownershipType collapse into NF vehicle_class +
                    ownership. Inspectors see this before applying so
                    nothing maps unexpectedly. */}
                {(() => {
                  const mapped = parseResult?.mapped || [];
                  if (mapped.length === 0) return null;
                  const tierCount = {};
                  const ownCount = {};
                  let unknownTier = 0, unknownOwn = 0;
                  for (const m of mapped) {
                    const tk = `${m._meta?.serviceTier || '(blank)'} → ${m.vehicleClass}`;
                    tierCount[tk] = (tierCount[tk] || 0) + 1;
                    const ok = `${m._meta?.ownershipType || '(blank)'} → ${m.ownership}`;
                    ownCount[ok] = (ownCount[ok] || 0) + 1;
                    if (m._meta?.vehicleClassSource === 'fallback-unknown') unknownTier += 1;
                    if (m._meta?.ownershipSource === 'fallback-unknown')   unknownOwn += 1;
                  }
                  return (
                    <div className="rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-[11px] text-navy-200 space-y-2">
                      <div className="flex items-center gap-2 text-navy-300 font-semibold">
                        <Info size={12} />
                        {t('bulkUpload.cortexMapping', 'Cortex column mapping')}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <div className="text-navy-400 mb-1">{t('bulkUpload.serviceTierMap', 'serviceTier → vehicle_class')}</div>
                          <ul className="space-y-0.5">
                            {Object.entries(tierCount)
                              .sort((a, b) => b[1] - a[1])
                              .map(([k, n]) => (
                                <li key={k} className="flex justify-between gap-2 font-mono">
                                  <span className="truncate">{k}</span>
                                  <span className="text-navy-400 shrink-0">×{n}</span>
                                </li>
                              ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-navy-400 mb-1">{t('bulkUpload.ownershipTypeMap', 'ownershipType → ownership')}</div>
                          <ul className="space-y-0.5">
                            {Object.entries(ownCount)
                              .sort((a, b) => b[1] - a[1])
                              .map(([k, n]) => (
                                <li key={k} className="flex justify-between gap-2 font-mono">
                                  <span className="truncate">{k}</span>
                                  <span className="text-navy-400 shrink-0">×{n}</span>
                                </li>
                              ))}
                          </ul>
                        </div>
                      </div>
                      {(unknownTier > 0 || unknownOwn > 0) && (
                        <div className="flex items-start gap-1.5 text-accent-orange pt-1 border-t border-navy-800">
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                          <span>
                            {unknownTier > 0 && <>{t('bulkUpload.unknownTierFmt', { count: unknownTier, defaultValue: `${unknownTier} row(s) had an unrecognized serviceTier — defaulted to regular_cargo_van.` })} </>}
                            {unknownOwn > 0 && <>{t('bulkUpload.unknownOwnFmt', { count: unknownOwn, defaultValue: `${unknownOwn} row(s) had an unrecognized ownershipType — defaulted to amazon_owned.` })}</>}
                            {' '}{t('bulkUpload.unknownEditHint', 'Edit the affected vehicles after upload if needed.')}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Deactivation handling — opt-in via checkbox */}
                {delta.deactivatedVans.length > 0 && (
                  <div className="rounded-lg bg-accent-red/10 border border-accent-red/40 p-3 text-xs text-navy-200">
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle size={14} className="text-accent-red mt-0.5 shrink-0" />
                      <div>
                        {t('bulkUpload.missingFromSheetFmt', { count: delta.deactivatedVans.length, defaultValue: `${delta.deactivatedVans.length} vehicle${delta.deactivatedVans.length > 1 ? 's are' : ' is'} present in your fleet but missing from the uploaded sheet.` })}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer ml-6 select-none">
                      <input
                        type="checkbox"
                        checked={deactivateMissing}
                        onChange={(e) => setDeactivateMissing(e.target.checked)}
                        className="w-4 h-4 accent-accent-red"
                      />
                      <span className="text-[11px] text-navy-200">
                        {t('bulkUpload.deactivateThemLabel', 'Deactivate them.')} <span className="text-navy-400">{t('bulkUpload.deactivateThemHint', 'Historical defects + work orders preserved; they just stop appearing in the inspector picker.')}</span>
                      </span>
                    </label>
                  </div>
                )}

                {/* Apply error */}
                {applyError && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/10 border border-accent-red/40 text-xs text-accent-red">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold mb-0.5">{t('bulkUpload.applyError', "Couldn't apply")}</div>
                      <div className="text-accent-red/90">{applyError}</div>
                    </div>
                  </div>
                )}

                {/* New vehicles */}
                {delta.newVans.length > 0 && (
                  <DeltaSection
                    title={t('bulkUpload.newVehiclesTitleFmt', { count: delta.newVans.length, defaultValue: `New vehicles (${delta.newVans.length})` })}
                    icon={Plus}
                    color="accent-green"
                  >
                    {delta.newVans.map((v) => (
                      <div key={v.vin} className="flex items-center justify-between py-2 px-3 rounded-lg bg-accent-green/5 border border-accent-green/20">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{v.fleetId} <span className="text-navy-400 font-normal">— {v.year} {v.make} {v.model}</span></div>
                          <div className="text-[11px] text-navy-400 font-mono truncate">{v.vin} · {v.plate}</div>
                          <div className="text-[10px] text-navy-300 mt-0.5">
                            <span className="text-accent-blue/80 font-semibold">{VEHICLE_TYPE_LABEL[v.vehicleClass] || v.vehicleClass}</span>
                            <span className="text-navy-500"> · </span>
                            <span>{OWNERSHIP_LABEL[v.ownership] || v.ownership}</span>
                            {v.fmc && <><span className="text-navy-500"> · FMC </span><span>{v.fmc}</span></>}
                          </div>
                        </div>
                        <Badge variant="green" size="md">{t('bulkUpload.newBadge', 'New')}</Badge>
                      </div>
                    ))}
                  </DeltaSection>
                )}

                {/* Updated vehicles */}
                {delta.updatedVans.length > 0 && (
                  <DeltaSection
                    title={t('bulkUpload.updatesTitleFmt', { count: delta.updatedVans.length, defaultValue: `Updates (${delta.updatedVans.length})` })}
                    icon={Edit3}
                    color="accent-blue"
                  >
                    {delta.updatedVans.map((v) => (
                      <div key={v.fleetId} className="py-2 px-3 rounded-lg bg-accent-blue/5 border border-accent-blue/20">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-sm font-semibold text-white">{v.fleetId} <span className="text-navy-400 font-normal">— {v.year} {v.make} {v.model}</span></div>
                          <Badge variant="blue" size="md">{t('bulkUpload.changesBadge', 'Changes')}</Badge>
                        </div>
                        <div className="space-y-0.5">
                          {v.changes.map((c, i) => (
                            <div key={i} className="flex items-center gap-2 text-[11px]">
                              <span className="text-navy-500 min-w-[45px]">{c.field}:</span>
                              <span className="text-accent-red line-through font-mono truncate">{c.old}</span>
                              <ArrowRight size={10} className="text-navy-500 shrink-0" />
                              <span className="text-accent-green font-mono font-semibold truncate">{c.new}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </DeltaSection>
                )}

                {/* Deactivations */}
                {delta.deactivatedVans.length > 0 && (
                  <DeltaSection
                    title={t('bulkUpload.deactivationsTitleFmt', { count: delta.deactivatedVans.length, defaultValue: `Deactivations (${delta.deactivatedVans.length})` })}
                    icon={Minus}
                    color="accent-red"
                    defaultOpen
                  >
                    {delta.deactivatedVans.map((v) => (
                      <div key={v.fleetId} className="flex items-center justify-between py-2 px-3 rounded-lg bg-accent-red/5 border border-accent-red/20">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{v.fleetId} <span className="text-navy-400 font-normal">— {v.year} {v.make} {v.model}</span></div>
                          <div className="text-[11px] text-navy-400 truncate">{t('bulkUpload.deactivatedHint', 'Not found in uploaded sheet — will be deactivated')}</div>
                        </div>
                        <Badge variant="red" size="md">{t('bulkUpload.deactivateBadge', 'Deactivate')}</Badge>
                      </div>
                    ))}
                  </DeltaSection>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={() => (step === 1 ? onClose() : setStep(step - 1))} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">
            {step === 1 ? t('bulkUpload.cancel', 'Cancel') : t('bulkUpload.back', 'Back')}
          </button>
          {step === 2 && (
            <button onClick={handleApply} disabled={applying}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-blue to-accent-purple text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
              {applying ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> {t('bulkUpload.applying', 'Applying…')}</>) : (<>{t('bulkUpload.confirmApply', 'Confirm & Apply')} <Check size={14} /></>)}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Bulk Upload — standalone success prompt
//
// Shown by the MyVehicles parent after BulkUploadModal closes on a
// successful apply. Keeps the success acknowledgment visually distinct
// from the upload form so users don't mistake the green-check screen
// for "the upload modal reopened" (the original UX complaint).
// ============================================================
function BulkUploadSuccessPrompt({ summary, errors = [], onClose }) {
  const { t } = useTranslation('fleet');
  const created = summary?.created ?? 0;
  const updated = summary?.updated ?? 0;
  const skipped = summary?.skipped ?? 0;
  const deactivated = summary?.deactivated ?? 0;
  const errorCount = errors.length;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ type: 'spring', damping: 22, stiffness: 280 }}
        className="bg-navy-900 border border-navy-700 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 text-center">
          <motion.div
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 220, delay: 0.05 }}
            className="w-14 h-14 mx-auto rounded-full bg-accent-green/15 border border-accent-green/40 flex items-center justify-center mb-3">
            <CheckCircle2 size={28} className="text-accent-green" />
          </motion.div>
          <h3 className="text-base font-semibold text-white mb-1">
            {t('bulkUpload.successPrompt.title', 'Vehicles uploaded')}
          </h3>
          <p className="text-xs text-navy-400">
            {t(
              'bulkUpload.successPrompt.subtitle',
              'Your fleet is now synchronized with the spreadsheet.',
            )}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-px bg-navy-800 border-y border-navy-800">
          <div className="bg-navy-900 px-3 py-3 text-center">
            <div className="text-lg font-semibold text-accent-green">+{created}</div>
            <div className="text-[10px] uppercase tracking-wide text-navy-400">
              {t('bulkUpload.successPrompt.added', 'Added')}
            </div>
          </div>
          <div className="bg-navy-900 px-3 py-3 text-center">
            <div className="text-lg font-semibold text-accent-blue">{updated}</div>
            <div className="text-[10px] uppercase tracking-wide text-navy-400">
              {t('bulkUpload.successPrompt.updated', 'Updated')}
            </div>
          </div>
          <div className="bg-navy-900 px-3 py-3 text-center">
            <div className="text-lg font-semibold text-navy-200">{skipped}</div>
            <div className="text-[10px] uppercase tracking-wide text-navy-400">
              {t('bulkUpload.successPrompt.unchanged', 'Unchanged')}
            </div>
          </div>
        </div>
        {(deactivated > 0 || errorCount > 0) && (
          <div className="px-6 py-3 border-b border-navy-800 text-[11px] flex items-center justify-center gap-3 flex-wrap">
            {deactivated > 0 && (
              <span className="text-accent-red font-semibold">
                {t('bulkUpload.successPrompt.deactivatedFmt', {
                  count: deactivated,
                  defaultValue: `${deactivated} deactivated`,
                })}
              </span>
            )}
            {errorCount > 0 && (
              <span className="text-accent-red font-semibold">
                {t('bulkUpload.successPrompt.errorsFmt', {
                  count: errorCount,
                  defaultValue: `${errorCount} error${errorCount > 1 ? 's' : ''}`,
                })}
              </span>
            )}
          </div>
        )}
        {errorCount > 0 && (
          <div className="max-h-32 overflow-y-auto px-6 py-2 bg-accent-red/5 border-b border-navy-800 space-y-1">
            {errors.slice(0, 5).map((r) => (
              <div key={r.vin} className="text-[11px] text-navy-300">
                <span className="font-mono text-accent-red">
                  {r.fleetId} / {r.vin}
                </span>
                : {r.error}
              </div>
            ))}
            {errorCount > 5 && (
              <div className="text-[10px] text-navy-500 italic">
                {t('bulkUpload.successPrompt.moreErrorsFmt', {
                  count: errorCount - 5,
                  defaultValue: `+${errorCount - 5} more`,
                })}
              </div>
            )}
          </div>
        )}
        <div className="px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 cursor-pointer">
            {t('bulkUpload.successPrompt.done', 'Done')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DeltaSection({ title, icon: Icon, color, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-navy-700/40 bg-navy-800/30 overflow-hidden">
      <button onClick={() => setOpen(!open)} className={`w-full flex items-center justify-between px-3 py-2.5 hover:bg-navy-800/60 transition-colors cursor-pointer text-${color}`}>
        <div className="flex items-center gap-2">
          <Icon size={14} />
          <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
        </div>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="p-2 space-y-1.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Vehicle Table (shared between flat view and DSP-grouped view)
// ============================================================
function LocationBadge({ v, canEditLocation, onChange }) {
  const [open, setOpen] = useState(false);
  const cfg = LOCATION_OPTIONS.find((l) => l.id === v.location) || LOCATION_OPTIONS[0];
  const isCheckedOut = v.location === 'checked_out';
  // Customer can only switch between parking_lot and offsite. Checked Out
  // is triggered by the vendor during an overnight repair.
  const canOpen = canEditLocation && !isCheckedOut;

  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => canOpen && setOpen(!open)}
        disabled={!canOpen}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold transition-all ${
          cfg.variant === 'blue'   ? 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue' :
          cfg.variant === 'gold'   ? 'bg-accent-gold/15 border-accent-gold/40 text-accent-gold' :
          cfg.variant === 'purple' ? 'bg-accent-purple/15 border-accent-purple/40 text-accent-purple' :
          'bg-navy-800 border-navy-700 text-navy-300'
        } ${canOpen ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}`}>
        {cfg.label}
        {canOpen && <ChevronDown size={10} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 w-56 bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-50 overflow-hidden">
            {LOCATION_OPTIONS.filter((o) => !o.vendorOnly).map((o) => (
              <button key={o.id} onClick={() => { onChange(v.fleetId, o.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-navy-800 border-b border-navy-800/60 last:border-b-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">{o.label}</span>
                  {v.location === o.id && <Check size={11} className="text-accent-green" />}
                </div>
                <div className="text-[10px] text-navy-400">{o.description}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VehicleTable({ vans, isVendor, canEdit, onRowClick, onCopy, copiedId, onLocationChange }) {
  const { t } = useTranslation('fleet');
  // Tighter row layout (2026-05-12): the Amazon Logistics spreadsheet ships
  // verbose model strings like "2020 Ford Stripped Chassis 4X2 Chassis
  // 178.2-228.2 in. WB" that blew the table out into a horizontal scroller
  // on any normal-sized screen. We now:
  //   - cap the make/model cell at ~200px and truncate (full string on
  //     hover via the title attr),
  //   - move year onto a small caption line above the make so the column
  //     reads "2020 / Ford Stripped Chassis…" in two lines,
  //   - drop the unit suffix on mileage (the column header already says
  //     "Mileage"), and tighten cell padding from px-4 → px-3.
  // `table-fixed` would force equal-width cells; we keep `auto` and rely on
  // the truncate + max-width on the model cell to do the work.
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-navy-800 bg-navy-950/40">
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">{t('myVehicles.table.fleetId', 'Fleet ID')}</th>
          {isVendor && <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">DSP</th>}
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">{t('myVehicles.table.vehicle', 'Vehicle')}</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">VIN</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">{t('myVehicles.table.plate', 'Plate')}</th>
          <th className="text-right text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">{t('myVehicles.table.mileage', 'Mileage')}</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">{t('myVehicles.table.class', 'Class')}</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">FMC</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">{t('myVehicles.table.status', 'Status')}</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">{t('myVehicles.table.location', 'Location')}</th>
          <th className="text-right text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-3 py-3">{t('myVehicles.table.actions', 'Actions')}</th>
        </tr>
      </thead>
      <tbody>
        {vans.map((v) => (
          <tr key={v.fleetId} onClick={() => onRowClick(v)}
            className="border-b border-navy-800/60 last:border-b-0 hover:bg-navy-800/40 cursor-pointer transition-colors">
            <td className="px-3 py-3 text-sm font-semibold text-white">{v.fleetId}</td>
            {isVendor && <td className="px-3 py-3 text-sm text-navy-200">{v.dsp}</td>}
            <td
              className="px-3 py-3 text-sm text-white max-w-[200px]"
              title={`${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim()}
            >
              <div className="text-[10px] text-navy-400 leading-tight">{v.year}</div>
              <div className="truncate leading-tight">
                {v.make}
                {v.model ? <span className="text-navy-400"> {v.model}</span> : null}
              </div>
            </td>
            <td className="px-3 py-3 text-xs font-mono text-navy-300">{v.vin}</td>
            <td className="px-3 py-3 text-sm text-white whitespace-nowrap">{v.plate}</td>
            <td className="px-3 py-3 text-sm text-white text-right whitespace-nowrap font-mono">{v.mileage?.toLocaleString() || '—'}</td>
            <td className="px-3 py-3 whitespace-nowrap">
              <Badge variant="gold">
                {VEHICLE_TYPE_LABEL[v.vehicleClass] || v.vehicleClass}
              </Badge>
              {(v.ownership || LEGACY_VEHICLE_CLASS_TO_OWNERSHIP[v.vehicleClass]) && (
                <span className="ml-1.5 text-[10px] text-navy-400">
                  {OWNERSHIP_LABEL[v.ownership || LEGACY_VEHICLE_CLASS_TO_OWNERSHIP[v.vehicleClass]]}
                </span>
              )}
            </td>
            <td className="px-3 py-3 text-sm text-navy-300">{v.fmc}</td>
            <td className="px-3 py-3">
              {v.defectCount === 0 ? (
                <Badge variant="green"><CheckCircle2 size={9} className="inline mr-0.5" /> {t('myVehicles.cleanBadge', 'Clean')}</Badge>
              ) : (
                <Badge variant="gold">{t('myVehicles.defectsBadgeFmt', { count: v.defectCount, defaultValue: `${v.defectCount} ${v.defectCount === 1 ? 'defect' : 'defects'}` })}</Badge>
              )}
            </td>
            <td className="px-3 py-3">
              <LocationBadge v={v} canEditLocation={canEdit && !isVendor} onChange={onLocationChange} />
            </td>
            <td className="px-3 py-3 text-right">
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); onCopy(v); }}
                  title={t('myVehicles.copyDetailsTitle', 'Copy details for billing')}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-all ${
                    copiedId === v.fleetId
                      ? 'bg-accent-green/20 border-accent-green/50 text-accent-green'
                      : 'bg-navy-800 border-navy-700 text-navy-300 hover:text-white hover:border-navy-600'
                  }`}
                >
                  {copiedId === v.fleetId ? <><Check size={11} /> {t('myVehicles.copiedButton', 'Copied')}</> : <><Copy size={11} /> {t('myVehicles.copyButton', 'Copy')}</>}
                </button>
                {canEdit && <Edit3 size={12} className="text-navy-400" />}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Mobile card (compact, touch-friendly)
function VehicleCardMobile({ v, onClick, onCopy, copiedId, isVendor, showDsp, onLocationChange }) {
  const { t } = useTranslation('fleet');
  return (
    <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-3 transition-colors">
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-center justify-between mb-1 gap-2">
          <span className="text-sm font-semibold text-white">{v.fleetId}</span>
          {v.defectCount === 0
            ? <Badge variant="green"><CheckCircle2 size={9} className="inline mr-0.5" /> {t('myVehicles.cleanBadge', 'Clean')}</Badge>
            : <Badge variant="gold">{t('myVehicles.defectsBadgeFmt', { count: v.defectCount, defaultValue: `${v.defectCount} defect${v.defectCount > 1 ? 's' : ''}` })}</Badge>}
        </div>
        {showDsp && <div className="text-[11px] text-accent-blue font-medium mb-1">{v.dsp}</div>}
        <div className="text-xs text-white mb-0.5">{v.year} {v.make} {v.model}</div>
        <div className="text-[11px] text-navy-400 font-mono truncate">{v.vin}</div>
        <div className="flex items-center justify-between mt-1.5 text-[11px] gap-2">
          <span className="text-navy-300 truncate">{v.plate} <span className="text-navy-500">·</span> <span className="text-white font-mono">{v.mileage?.toLocaleString() || '—'} {t('myVehicles.milesShort', 'mi')}</span></span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="gold">{VEHICLE_TYPE_LABEL[v.vehicleClass] || v.vehicleClass}</Badge>
          </div>
        </div>
      </button>
      <div className="flex items-center gap-2 mt-2">
        <div className="shrink-0">
          <LocationBadge v={v} canEditLocation={!isVendor} onChange={onLocationChange || (() => {})} />
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(v); }}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-xs font-medium transition-all ${
            copiedId === v.fleetId
              ? 'bg-accent-green/20 border-accent-green/50 text-accent-green'
              : 'bg-navy-800 border-navy-700 text-navy-300 active:bg-navy-700'
          }`}
        >
          {copiedId === v.fleetId ? <><Check size={12} /> {t('myVehicles.copiedButton', 'Copied')}</> : <><Copy size={12} /> {t('myVehicles.copyDetailsTitle', 'Copy details for billing')}</>}
        </button>
      </div>
    </div>
  );
}

// (Role view mode helper lives in src/lib/permissions.js — imported above.)

// ============================================================
// Main Component
// ============================================================
export default function MyVehicles({ user }) {
  const { t } = useTranslation('fleet');
  const mode = getViewMode(user?.role);
  const canEdit = mode === 'owner' || mode === 'admin';
  const isVendor = mode === 'vendor';

  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [detailVehicle, setDetailVehicle] = useState(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showFlexFleet, setShowFlexFleet] = useState(false);
  // Holds the result summary from the bulk-upsert API after the upload modal
  // closes. Drives the standalone success prompt — the user explicitly asked
  // for a "your upload succeeded" dialog instead of staying inside the upload
  // modal with a green check (which they read as "upload form still open").
  const [bulkUploadSummary, setBulkUploadSummary] = useState(null);
  const [classFilter, setClassFilter] = useState('all');
  const [dspFilter, setDspFilter] = useState('all');
  const [dspFilterOpen, setDspFilterOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // Fleet data comes from the real /vehicles endpoint. Role scoping is
  // enforced server-side (dsp_owner auto-scoped to their org; vendor+admin
  // see all DSPs). No need to filter client-side by dspId.
  const [fleet, setFleet] = useState([]);
  const [loadingFleet, setLoadingFleet] = useState(true);
  const [fleetError, setFleetError] = useState(null);

  const reloadFleet = useCallback(async () => {
    setLoadingFleet(true);
    setFleetError(null);
    try {
      // per_page: 100 is enough for a single DSP (~50 vans typical). For
      // vendor/admin seeing hundreds of vans across DSPs, add pagination UI later.
      const res = await vehiclesApi.list({ perPage: 100 });
      setFleet(res.items.map(fromApiVehicle));
    } catch (err) {
      setFleetError(err instanceof APIError ? (err.detail || 'Load failed') : 'Network error');
    } finally {
      setLoadingFleet(false);
    }
  }, []);

  useEffect(() => {
    reloadFleet();
  }, [reloadFleet]);

  // Unique DSPs in this fleet (for vendor DSP filter)
  const uniqueDsps = useMemo(() => {
    const dsps = new Map();
    fleet.forEach((v) => {
      if (!dsps.has(v.dspId)) dsps.set(v.dspId, { id: v.dspId, name: v.dsp });
    });
    return Array.from(dsps.values());
  }, [fleet]);

  // Apply search, class & DSP filters
  const filtered = useMemo(() => {
    let list = fleet;
    if (dspFilter !== 'all') list = list.filter((v) => v.dspId === dspFilter);
    if (classFilter !== 'all') list = list.filter((v) => v.vehicleClass === classFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((v) =>
        v.fleetId.toLowerCase().includes(s) ||
        v.vin.toLowerCase().includes(s) ||
        v.plate.toLowerCase().includes(s) ||
        v.model.toLowerCase().includes(s) ||
        v.make.toLowerCase().includes(s) ||
        v.dsp.toLowerCase().includes(s)
      );
    }
    return list;
  }, [fleet, search, classFilter, dspFilter]);

  // Group by DSP when vendor view with no DSP filter applied
  const groupedByDsp = useMemo(() => {
    if (!isVendor || dspFilter !== 'all') return null;
    const map = new Map();
    filtered.forEach((v) => {
      if (!map.has(v.dspId)) map.set(v.dspId, { dspId: v.dspId, dspName: v.dsp, vans: [] });
      map.get(v.dspId).vans.push(v);
    });
    return Array.from(map.values()).sort((a, b) => a.dspName.localeCompare(b.dspName));
  }, [filtered, isVendor, dspFilter]);

  const handleLocationChange = async (fleetId, newLocation) => {
    const target = fleet.find((v) => v.fleetId === fleetId);
    if (!target) return;
    // Optimistic update so the UI reacts instantly; revert on API failure.
    const previous = target.location;
    setFleet((prev) => prev.map((v) => (v.fleetId === fleetId ? { ...v, location: newLocation } : v)));
    try {
      await vehiclesApi.update(target.id, { location: newLocation });
    } catch (err) {
      setFleet((prev) => prev.map((v) => (v.fleetId === fleetId ? { ...v, location: previous } : v)));
      const msg = err?.detail || err?.message || 'Could not update location';
      alert(typeof msg === 'string' ? msg : 'Could not update location');
    }
  };

  // Copy vehicle details to clipboard (helpful for vendors creating invoices)
  const handleCopy = (v) => {
    const text = `Fleet ID: ${v.fleetId}\nDSP: ${v.dsp}\nYear/Make/Model: ${v.year} ${v.make} ${v.model}\nVIN: ${v.vin}\nPlate: ${v.plate}`;
    navigator.clipboard?.writeText(text);
    setCopiedId(v.fleetId);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Export filtered list as CSV
  const handleExport = () => {
    const header = 'Fleet ID,DSP,Year,Make,Model,VIN,Plate,Class,FMC';
    const rows = filtered.map((v) => `${v.fleetId},${v.dsp},${v.year},${v.make},${v.model},${v.vin},${v.plate},${v.vehicleClass},${v.fmc}`);
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nova-fora-vehicles-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveVehicle = async (form) => {
    // Match by VIN (unique) if the form's VIN matches an existing fleet row.
    // Errors propagate to the modal so the user can fix and retry without
    // losing what they typed.
    const existing = form.vin && fleet.find((v) => v.vin === form.vin);
    if (existing) {
      await vehiclesApi.update(existing.id, {
        fleetId: form.fleetId,
        plate: form.plate,
        year: parseInt(form.year, 10),
        make: form.make,
        model: form.model,
        mileage: parseInt(form.mileage ?? existing.mileage, 10),
        vehicleClass: form.vehicleClass,
        ownership: form.ownership,
      });
    } else {
      await vehiclesApi.create({
        fleetId: form.fleetId,
        vin: form.vin,
        plate: form.plate,
        year: parseInt(form.year, 10),
        make: form.make,
        model: form.model,
        mileage: parseInt(form.mileage ?? 0, 10),
        vehicleClass: form.vehicleClass,
        ownership: form.ownership,
      });
    }
    await reloadFleet();
  };

  // Soft-delete via PATCH isActive=false (no hard DELETE endpoint yet —
  // we never hard-delete vehicles because of historical WO/inspection refs).
  const handleDeleteVehicle = async (v) => {
    try {
      await vehiclesApi.update(v.id, { isActive: false });
      await reloadFleet();
    } catch (err) {
      const msg = err?.detail || err?.message || 'Delete failed';
      alert(`Delete failed: ${msg}`);
    }
  };

  // The bulk-upsert endpoint already persisted everything; we just need to
  // refresh the fleet list from the backend so derived counts + photo / defect
  // counts pick up the new rows. The modal's onApply fires after the API
  // call succeeds, so it's safe to assume the change is committed.
  //
  // We also capture the API response so the standalone success prompt can
  // render the +N added / N updated / N unchanged summary (see
  // BulkUploadSuccessPrompt below). The modal closes itself on success.
  const handleApplyBulk = async (res) => {
    setBulkUploadSummary(res || null);
    await reloadFleet();
  };

  const totalCount = fleet.length;
  const rentalCount = fleet.filter(
    (v) => v.ownership === 'rental'
        || LEGACY_OWNERSHIP_TO_GRANULAR[v.ownership] === 'rental'
        || LEGACY_VEHICLE_CLASS_TO_OWNERSHIP[v.vehicleClass] === 'rental',
  ).length;
  const cleanCount = fleet.filter((v) => v.defectCount === 0).length;
  const defectiveCount = fleet.filter((v) => v.defectCount > 0).length;

  // Loading state — first load only (reload happens in-place without this splash)
  if (loadingFleet && fleet.length === 0) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-navy-400">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-accent-blue/40 border-t-accent-blue rounded-full"
        />
        <div className="text-sm">{t('myVehicles.loadingFmt', { org: user?.org || 'your organization', defaultValue: `Loading fleet from ${user?.org || 'your organization'}…` })}</div>
      </div>
    );
  }

  // Error state — retriable
  if (fleetError && fleet.length === 0) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertTriangle size={32} className="text-accent-red" />
        <div className="text-white font-semibold">{t('myVehicles.loadError', 'Could not load vehicles')}</div>
        <div className="text-sm text-navy-400 max-w-md">{fleetError}</div>
        <button
          onClick={reloadFleet}
          className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue/20 border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/30 text-sm cursor-pointer"
        >
          <RefreshCw size={14} /> {t('myVehicles.retry', 'Retry')}
        </button>
      </div>
    );
  }

  // When a vehicle is selected, render the full-page detail view instead of the grid
  if (detailVehicle) {
    return (
      <VehicleDetailPage
        vehicle={detailVehicle}
        fleet={fleet}
        user={user}
        readOnly={isVendor}
        onBack={() => setDetailVehicle(null)}
        onSave={handleSaveVehicle}
        onDelete={handleDeleteVehicle}
        onNavigate={(next) => setDetailVehicle({ ...next })}
        onLocationChange={handleLocationChange}
      />
    );
  }

  const title = isVendor ? t('myVehicles.titleVendor', 'DSP Vehicles') : t('myVehicles.titleOwner', 'My Vehicles');
  const subtitle = isVendor
    ? t('myVehicles.subtitleVendor', "Fleet directory across your assigned DSPs — copy any vehicle's details to your billing system")
    : t('myVehicles.subtitleOwner', 'Fleet management');

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 sm:mb-6 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-white mb-1">{title}</h2>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-navy-400">{subtitle} &mdash; <span className="text-white font-medium">{totalCount}</span> {t('myVehicles.vansLabel', 'vans')}</span>
            {!isVendor && (
              <>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-green/15 border border-accent-green/40 text-accent-green text-xs font-semibold">
                  <CheckCircle2 size={11} /> {t('myVehicles.cleanFmt', { count: cleanCount, defaultValue: `${cleanCount} Clean` })}
                </span>
                {defectiveCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs font-semibold">
                    <AlertTriangle size={11} /> {t('myVehicles.defectiveFmt', { count: defectiveCount, defaultValue: `${defectiveCount} defective` })}
                  </span>
                )}
              </>
            )}
            {isVendor && <span className="text-navy-400">{t('myVehicles.acrossDspsFmt', { count: uniqueDsps.length, defaultValue: `across ${uniqueDsps.length} DSPs` })}</span>}
            {!isVendor && rentalCount > 0 && <span className="text-navy-400">· <span className="text-accent-purple">{t('myVehicles.rentalsFmt', { count: rentalCount, defaultValue: `${rentalCount} rentals` })}</span></span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Vendor / technician actions — read-only */}
          {isVendor && (
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-blue/15 border border-accent-blue/40 text-accent-blue text-sm font-semibold hover:bg-accent-blue/25 cursor-pointer">
              <Download size={14} /> {t('myVehicles.exportCsv', 'Export CSV')}
            </button>
          )}
          {/* Owner / admin actions — write access */}
          {canEdit && (
            <>
              <button onClick={() => setShowFlexFleet(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-purple/15 border border-accent-purple/40 text-accent-purple text-sm font-semibold hover:bg-accent-purple/25 cursor-pointer">
                <Truck size={14} /> {t('myVehicles.orderFlexFleet', 'Order Flex Fleet')}
              </button>
              <button onClick={() => setShowBulkUpload(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-blue/15 border border-accent-blue/40 text-accent-blue text-sm font-semibold hover:bg-accent-blue/25 cursor-pointer">
                <Upload size={14} /> {t('myVehicles.bulkUpload', 'Bulk Upload')}
              </button>
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-green text-white text-sm font-semibold hover:bg-accent-green/80 cursor-pointer shadow-lg shadow-accent-green/20">
                <Plus size={14} /> {t('myVehicles.addVehicle', 'Add Vehicle')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Vendor info banner */}
      {isVendor && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-xs text-navy-200">
          <Info size={14} className="text-accent-blue mt-0.5 shrink-0" />
          <div>
            <strong className="text-white">{t('myVehicles.vendorReadOnlyTitle', 'Read-only view.')}</strong> {t('myVehicles.vendorReadOnlyBody', 'Click any vehicle to see its full details, or use the copy button to paste Fleet ID, VIN and plate into your billing/ticketing system.')}
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isVendor
              ? t('myVehicles.searchPlaceholderVendor', 'Search DSP, Fleet ID, VIN, plate or model…')
              : t('myVehicles.searchPlaceholderOwner', 'Search Fleet ID, VIN, plate or model…')}
            className="w-full rounded-lg pl-9 pr-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
          />
        </div>
        {/* DSP filter — prominent for vendors */}
        {(isVendor || mode === 'admin') && uniqueDsps.length > 1 && (
          <div className="relative">
            <button onClick={() => setDspFilterOpen(!dspFilterOpen)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm border cursor-pointer transition-colors min-h-[42px] ${
                dspFilter !== 'all'
                  ? 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue font-semibold'
                  : 'bg-navy-800 border-navy-700 text-navy-300 hover:text-white'
              }`}>
              <Building2 size={14} />
              <span className="truncate max-w-[140px]">{dspFilter === 'all' ? t('myVehicles.filter.allDsps', 'All DSPs') : uniqueDsps.find((d) => d.id === dspFilter)?.name}</span>
              <ChevronDown size={12} />
            </button>
            {dspFilterOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDspFilterOpen(false)} />
                <div className="absolute top-full right-0 mt-1 w-64 bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-20 overflow-hidden max-h-72 overflow-y-auto">
                  <button onClick={() => { setDspFilter('all'); setDspFilterOpen(false); }}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm text-white hover:bg-navy-800 border-b border-navy-800">
                    <span>{t('myVehicles.filter.allDsps', 'All DSPs')} <span className="text-navy-400">({fleet.length})</span></span>
                    {dspFilter === 'all' && <Check size={12} className="text-accent-green" />}
                  </button>
                  {uniqueDsps.map((d) => {
                    const count = fleet.filter((v) => v.dspId === d.id).length;
                    return (
                      <button key={d.id} onClick={() => { setDspFilter(d.id); setDspFilterOpen(false); }}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm text-white hover:bg-navy-800 border-b border-navy-800/60 last:border-b-0">
                        <span className="truncate">{d.name} <span className="text-navy-400">({count})</span></span>
                        {dspFilter === d.id && <Check size={12} className="text-accent-green shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}
          className="rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
          <option value="all">{t('myVehicles.filter.allTypes', 'All vehicle types')}</option>
          {VEHICLE_TYPES.map((vt) => <option key={vt.value} value={vt.value}>{vt.label}</option>)}
        </select>
      </div>

      {/* Desktop: grouped by DSP (vendors) or flat table */}
      {groupedByDsp ? (
        <div className="hidden md:block space-y-4">
          {groupedByDsp.map((group) => (
            <motion.div key={group.dspId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-navy-950/40 border-b border-navy-800">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-accent-blue" />
                  <h3 className="text-sm font-semibold text-white">{group.dspName}</h3>
                  <Badge variant="gray" size="md">{t('myVehicles.vansCountFmt', { count: group.vans.length, defaultValue: `${group.vans.length} vans` })}</Badge>
                </div>
                <button onClick={() => { setDspFilter(group.dspId); }}
                  className="text-[11px] text-accent-blue hover:underline">{t('myVehicles.filter.filterToThisDsp', 'Filter to this DSP')}</button>
              </div>
              <div className="overflow-x-auto">
                <VehicleTable vans={group.vans} isVendor={isVendor} canEdit={canEdit}
                  onRowClick={setDetailVehicle} onCopy={handleCopy} copiedId={copiedId}
                  onLocationChange={handleLocationChange} />
              </div>
            </motion.div>
          ))}
          {groupedByDsp.length === 0 && (
            <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-10 text-center text-sm text-navy-400">
              {t('myVehicles.noMatch', 'No vehicles match your filter.')}
            </div>
          )}
        </div>
      ) : (
        <div className="hidden md:block bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <VehicleTable vans={filtered} isVendor={isVendor} canEdit={canEdit}
              onRowClick={setDetailVehicle} onCopy={handleCopy} copiedId={copiedId}
              onLocationChange={handleLocationChange} />
          </div>
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-navy-400">{t('myVehicles.noMatch', 'No vehicles match your filter.')}</div>
          )}
        </div>
      )}

      {/* Mobile card list — with DSP header badges when grouped */}
      <div className="md:hidden space-y-2">
        {groupedByDsp ? (
          groupedByDsp.map((group) => (
            <div key={group.dspId} className="space-y-2">
              <div className="flex items-center justify-between px-1 pt-2">
                <div className="flex items-center gap-1.5">
                  <Users size={12} className="text-accent-blue" />
                  <span className="text-xs font-semibold text-white">{group.dspName}</span>
                  <Badge variant="gray">{group.vans.length}</Badge>
                </div>
                <button onClick={() => setDspFilter(group.dspId)} className="text-[10px] text-accent-blue">{t('myVehicles.filter.filterShort', 'Filter')}</button>
              </div>
              {group.vans.map((v) => (
                <VehicleCardMobile key={v.fleetId} v={v} onClick={() => setDetailVehicle(v)}
                  onCopy={handleCopy} copiedId={copiedId} isVendor={isVendor} showDsp={false}
                  onLocationChange={handleLocationChange} />
              ))}
            </div>
          ))
        ) : (
          filtered.map((v) => (
            <VehicleCardMobile key={v.fleetId} v={v} onClick={() => setDetailVehicle(v)}
              onCopy={handleCopy} copiedId={copiedId} isVendor={isVendor} showDsp={isVendor}
              onLocationChange={handleLocationChange} />
          ))
        )}
        {filtered.length === 0 && (
          <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-10 text-center text-sm text-navy-400">
            {t('myVehicles.noMatch', 'No vehicles match your filter.')}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAdd && (
          <VehicleModal
            vehicle={null}
            onSave={handleSaveVehicle}
            onDelete={null}
            onClose={() => setShowAdd(false)}
          />
        )}
        {showBulkUpload && (
          <BulkUploadModal
            currentFleet={fleet}
            onApply={handleApplyBulk}
            onClose={() => setShowBulkUpload(false)}
          />
        )}
        {bulkUploadSummary && (
          <BulkUploadSuccessPrompt
            summary={bulkUploadSummary.summary}
            errors={(bulkUploadSummary.results || []).filter((r) => r.action === 'error')}
            onClose={() => setBulkUploadSummary(null)}
          />
        )}
        {showFlexFleet && (
          <FlexFleetModal onClose={() => setShowFlexFleet(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
