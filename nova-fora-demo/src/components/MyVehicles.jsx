import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Truck, Plus, Upload, Search, Filter, Edit3, Trash2, MoreVertical,
  X, ArrowRight, ArrowLeft, Check, CheckCircle2, AlertTriangle, FileSpreadsheet,
  ChevronDown, ChevronUp, Eye, Minus, Info, Download, Lock, Copy, Users, Building2
} from 'lucide-react';
import { fleetSnapshotVans } from '../data/mockData';
import Badge from './ui/Badge';
import VehicleDetailPage from './VehicleDetailPage';

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
const VEHICLE_CLASSES = ['Branded Cargo', 'Step Van', 'Rental', 'Owned'];
const FMC_OPTIONS = ['Wheels', 'Element', 'Rented/Owned', 'Holman', 'Enterprise Fleet', 'Other'];
const MAKES = ['Ford', 'Mercedes', 'Ram', 'Chevrolet', 'Isuzu'];

function VehicleModal({ vehicle, onSave, onClose, onDelete, readOnly = false }) {
  const isEdit = !!vehicle;
  const [form, setForm] = useState(vehicle ? {
    fleetId: vehicle.fleetId,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    vin: vehicle.vin,
    plate: vehicle.plate,
    vehicleClass: vehicle.vehicleClass,
    fmc: vehicle.fmc,
  } : {
    fleetId: '',
    year: new Date().getFullYear(),
    make: 'Ford',
    model: '',
    color: 'White',
    vin: '',
    plate: '',
    vehicleClass: 'Branded Cargo',
    fmc: 'Wheels',
  });
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const update = (k, v) => setForm({ ...form, [k]: v });
  const isValid = form.fleetId && form.vin && form.plate && form.make && form.model;

  const handleSave = () => {
    setSubmitting(true);
    setTimeout(() => {
      onSave(form);
      setSubmitting(false);
      onClose();
    }, 600);
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
              <h3 className="text-base font-semibold text-white">{readOnly ? 'Vehicle Details' : isEdit ? 'Edit Vehicle' : 'Add New Vehicle'}</h3>
              <p className="text-[11px] text-navy-400">{readOnly ? `${vehicle.fleetId} · ${vehicle.dsp}` : isEdit ? `Modify ${vehicle.fleetId}` : 'Register a new van in your fleet'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>

        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1 space-y-4">
          {isEdit && !readOnly && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-green/10 border border-accent-green/30 text-xs text-accent-green">
              <CheckCircle2 size={12} /> All fields are editable at once &mdash; no need to click a pencil per field.
            </div>
          )}
          {readOnly && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-xs text-accent-blue">
              <Eye size={12} /> Read-only &mdash; vehicles are managed by the DSP owner
            </div>
          )}

          <fieldset disabled={readOnly} className={`${readOnly ? 'opacity-90' : ''} contents`}>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">Fleet ID *</label>
              <input value={form.fleetId} onChange={(e) => update('fleetId', e.target.value)}
                placeholder="VAN-1099"
                disabled={isEdit}
                className={`w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm border text-white placeholder-navy-500 outline-none focus:border-accent-blue ${
                  isEdit ? 'bg-navy-800/30 border-navy-800 cursor-not-allowed' : 'bg-navy-800 border-navy-700'
                }`} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">License Plate *</label>
              <input value={form.plate} onChange={(e) => update('plate', e.target.value.toUpperCase())}
                placeholder="WA-1A99-AZ"
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">VIN *</label>
            <input value={form.vin} onChange={(e) => update('vin', e.target.value.toUpperCase())}
              placeholder="1FTBW3XM22AJF3472"
              maxLength={17}
              className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm font-mono bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">Year</label>
              <input type="number" value={form.year} onChange={(e) => update('year', parseInt(e.target.value, 10))}
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">Make</label>
              <select value={form.make} onChange={(e) => update('make', e.target.value)}
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                {MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">Color</label>
              <select value={form.color} onChange={(e) => update('color', e.target.value)}
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                {['White', 'Blue', 'Silver', 'Black', 'Gray'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">Model *</label>
            <input value={form.model} onChange={(e) => update('model', e.target.value)}
              placeholder="Transit 250"
              className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">Vehicle Class</label>
              <select value={form.vehicleClass} onChange={(e) => update('vehicleClass', e.target.value)}
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                {VEHICLE_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-navy-300 mb-1.5 block uppercase tracking-wide">FMC</label>
              <select value={form.fmc} onChange={(e) => update('fmc', e.target.value)}
                className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                {FMC_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          </fieldset>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          {readOnly ? (
            <>
              <span /> {/* spacer */}
              <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-navy-800 border border-navy-700 text-white hover:bg-navy-700 cursor-pointer">
                Close
              </button>
            </>
          ) : (
            <>
              {isEdit && onDelete ? (
                <button onClick={() => setShowConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium text-accent-red hover:bg-accent-red/10 cursor-pointer">
                  <Trash2 size={14} /> Delete
                </button>
              ) : (
                <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Cancel</button>
              )}
              <button onClick={handleSave} disabled={!isValid || submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-green to-accent-blue text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                {submitting ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> Saving…</>) : (<><Check size={14} /> {isEdit ? 'Save Changes' : 'Add Vehicle'}</>)}
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
                <h4 className="text-base font-semibold text-white mb-1">Delete {vehicle.fleetId}?</h4>
                <p className="text-xs text-navy-400 mb-4">This removes the vehicle from your fleet. Historical inspection data is kept.</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowConfirmDelete(false)} className="flex-1 px-4 py-2 rounded-lg border border-navy-600 text-navy-300 text-sm hover:bg-navy-800 cursor-pointer">Cancel</button>
                  <button onClick={() => { onDelete(vehicle); onClose(); }} className="flex-1 px-4 py-2 rounded-lg bg-accent-red text-white text-sm font-semibold hover:opacity-90 cursor-pointer">Delete</button>
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
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [success, setSuccess] = useState(false);

  // Mock parsed delta — calculated when file is uploaded
  const delta = useMemo(() => {
    if (!file || step < 2) return null;
    const currentIds = currentFleet.map((v) => v.fleetId);

    // Simulated incoming CSV: 3 new + 2 modified + current minus 1 deactivation
    const incoming = [
      // New vehicles
      { fleetId: 'VAN-9001', year: 2024, make: 'Ford', model: 'Transit 350 HD', vin: '1FTBW3XM9024NEW0001', plate: 'WA-9A01-AZ', color: 'White', vehicleClass: 'Branded Cargo', fmc: 'Wheels' },
      { fleetId: 'VAN-9002', year: 2024, make: 'Mercedes', model: 'eSprinter', vin: '1FTBW3XM9024NEW0002', plate: 'WA-9A02-AZ', color: 'White', vehicleClass: 'Branded Cargo', fmc: 'Wheels' },
      { fleetId: 'VAN-9003', year: 2024, make: 'Ram', model: 'ProMaster 3500', vin: '1FTBW3XM9024NEW0003', plate: 'WA-9A03-AZ', color: 'Blue',  vehicleClass: 'Rental',        fmc: 'Rented/Owned' },

      // Updates to existing (first 2 current vehicles — VIN/plate correction)
      ...currentFleet.slice(0, 2).map((v, i) => ({
        fleetId: v.fleetId,
        year: v.year,
        make: v.make,
        model: v.model,
        vin: v.vin.slice(0, 14) + 'UPD',
        plate: i === 0 ? 'WA-NEW-99' : v.plate,
        color: v.color,
        vehicleClass: v.vehicleClass,
        fmc: v.fmc,
      })),

      // Keep the rest (but exclude the last one = deactivation)
      ...currentFleet.slice(2, -1).map((v) => ({
        fleetId: v.fleetId, year: v.year, make: v.make, model: v.model,
        vin: v.vin, plate: v.plate, color: v.color, vehicleClass: v.vehicleClass, fmc: v.fmc,
      })),
    ];

    const incomingIds = incoming.map((v) => v.fleetId);

    const newVans = incoming.filter((v) => !currentIds.includes(v.fleetId));
    const updatedVans = incoming.filter((v) => {
      const existing = currentFleet.find((c) => c.fleetId === v.fleetId);
      if (!existing) return false;
      return existing.vin !== v.vin || existing.plate !== v.plate || existing.color !== v.color || existing.fmc !== v.fmc;
    }).map((v) => {
      const existing = currentFleet.find((c) => c.fleetId === v.fleetId);
      const changes = [];
      if (existing.vin !== v.vin) changes.push({ field: 'VIN', old: existing.vin, new: v.vin });
      if (existing.plate !== v.plate) changes.push({ field: 'Plate', old: existing.plate, new: v.plate });
      if (existing.color !== v.color) changes.push({ field: 'Color', old: existing.color, new: v.color });
      if (existing.fmc !== v.fmc) changes.push({ field: 'FMC', old: existing.fmc, new: v.fmc });
      return { ...v, changes };
    });
    const deactivatedVans = currentFleet.filter((v) => !incomingIds.includes(v.fleetId));

    return {
      totalInFile: incoming.length,
      currentTotal: currentFleet.length,
      newVans,
      updatedVans,
      deactivatedVans,
    };
  }, [file, step, currentFleet]);

  const handleFile = (f) => {
    setFile({ name: f.name, size: f.size });
    setParsing(true);
    setTimeout(() => {
      setParsing(false);
      setStep(2);
    }, 1200);
  };

  const handleApply = () => {
    setApplying(true);
    setTimeout(() => {
      onApply(delta);
      setApplying(false);
      setSuccess(true);
    }, 1400);
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
              <h3 className="text-base font-semibold text-white">Bulk Upload Vehicles</h3>
              <p className="text-[11px] text-navy-400">Sync your Amazon Logistics Fleet Data spreadsheet</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>

        {/* Progress */}
        {!success && (
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
              <span className={step >= 1 ? 'text-white font-semibold' : ''}>1. Upload file</span>
              <span className={step >= 2 ? 'text-white font-semibold' : ''}>2. Review delta</span>
              <span className={step >= 3 ? 'text-white font-semibold' : ''}>3. Apply</span>
            </div>
          </div>
        )}

        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1">
          <AnimatePresence mode="wait">
            {success ? (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
                  className="w-16 h-16 mx-auto rounded-full bg-accent-green/15 border border-accent-green/40 flex items-center justify-center mb-4">
                  <CheckCircle2 size={32} className="text-accent-green" />
                </motion.div>
                <h4 className="text-lg font-semibold text-white mb-1">Fleet synchronized</h4>
                <p className="text-sm text-navy-400 mb-4">
                  <span className="text-accent-green">+{delta.newVans.length} added</span> &middot;{' '}
                  <span className="text-accent-blue">{delta.updatedVans.length} updated</span> &middot;{' '}
                  <span className="text-accent-red">{delta.deactivatedVans.length} deactivated</span>
                </p>
                <div className="inline-flex flex-col gap-1 px-4 py-3 rounded-lg bg-navy-800/60 border border-navy-700/40 text-left">
                  <div className="text-[11px] text-navy-400">Sync ID</div>
                  <div className="text-sm font-mono text-accent-blue">SYNC-{new Date().getFullYear()}{String(new Date().getMonth() + 1).padStart(2, '0')}{String(new Date().getDate()).padStart(2, '0')}-{Math.floor(1000 + Math.random() * 9000)}</div>
                </div>
              </motion.div>
            ) : step === 1 ? (
              <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="rounded-lg bg-accent-blue/10 border border-accent-blue/30 p-3 text-xs text-navy-200 flex items-start gap-2">
                  <Info size={14} className="text-accent-blue mt-0.5 shrink-0" />
                  <div>
                    Upload your <strong className="text-white">Fleet Data spreadsheet</strong> from Amazon Logistics.
                    Nova Fora will compare it with your current fleet and show you exactly what will change
                    &mdash; <strong className="text-white">nothing is deactivated silently.</strong>
                  </div>
                </div>

                <label className="block border-2 border-dashed border-navy-700/60 bg-navy-800/20 rounded-xl p-8 hover:bg-navy-800/40 cursor-pointer transition-colors text-center">
                  <div className="w-14 h-14 mx-auto rounded-xl bg-accent-blue/15 flex items-center justify-center mb-3">
                    <Upload size={24} className="text-accent-blue" />
                  </div>
                  <div className="text-sm font-semibold text-white mb-1">
                    {parsing ? 'Parsing file…' : file ? file.name : 'Drop your CSV / XLSX file here'}
                  </div>
                  <div className="text-[11px] text-navy-400">
                    {parsing ? 'Detecting columns and matching fleet IDs…' : 'or click to browse'}
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

                <div className="flex items-center gap-2 text-xs text-navy-400">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-navy-700 hover:bg-navy-800 cursor-pointer text-navy-300">
                    <Download size={12} /> Download template
                  </button>
                  <span className="text-navy-500">Expected columns: Fleet ID, VIN, Year, Make, Model, Plate, Class, FMC</span>
                </div>
              </motion.div>
            ) : step === 2 ? (
              <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-accent-green/10 border border-accent-green/30 p-3 text-center">
                    <Plus size={16} className="mx-auto text-accent-green mb-1" />
                    <div className="text-lg font-bold text-white">{delta.newVans.length}</div>
                    <div className="text-[10px] text-navy-400">To add</div>
                  </div>
                  <div className="rounded-lg bg-accent-blue/10 border border-accent-blue/30 p-3 text-center">
                    <Edit3 size={16} className="mx-auto text-accent-blue mb-1" />
                    <div className="text-lg font-bold text-white">{delta.updatedVans.length}</div>
                    <div className="text-[10px] text-navy-400">To update</div>
                  </div>
                  <div className="rounded-lg bg-accent-red/10 border border-accent-red/30 p-3 text-center">
                    <Minus size={16} className="mx-auto text-accent-red mb-1" />
                    <div className="text-lg font-bold text-white">{delta.deactivatedVans.length}</div>
                    <div className="text-[10px] text-navy-400">To deactivate</div>
                  </div>
                </div>

                {/* Warning for deactivations */}
                {delta.deactivatedVans.length > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/10 border border-accent-red/40 text-xs text-navy-200">
                    <AlertTriangle size={14} className="text-accent-red mt-0.5 shrink-0" />
                    <div>
                      <strong className="text-accent-red">Warning:</strong> {delta.deactivatedVans.length} vehicle{delta.deactivatedVans.length > 1 ? 's are' : ' is'} missing from your uploaded sheet and will be deactivated.
                      Historical data is preserved but {delta.deactivatedVans.length > 1 ? 'they' : 'it'} won't be inspectable anymore.
                    </div>
                  </div>
                )}

                {/* New vehicles */}
                {delta.newVans.length > 0 && (
                  <DeltaSection
                    title={`New vehicles (${delta.newVans.length})`}
                    icon={Plus}
                    color="accent-green"
                  >
                    {delta.newVans.map((v) => (
                      <div key={v.fleetId} className="flex items-center justify-between py-2 px-3 rounded-lg bg-accent-green/5 border border-accent-green/20">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{v.fleetId} <span className="text-navy-400 font-normal">— {v.year} {v.make} {v.model}</span></div>
                          <div className="text-[11px] text-navy-400 font-mono truncate">{v.vin} · {v.plate}</div>
                        </div>
                        <Badge variant="green" size="md">New</Badge>
                      </div>
                    ))}
                  </DeltaSection>
                )}

                {/* Updated vehicles */}
                {delta.updatedVans.length > 0 && (
                  <DeltaSection
                    title={`Updates (${delta.updatedVans.length})`}
                    icon={Edit3}
                    color="accent-blue"
                  >
                    {delta.updatedVans.map((v) => (
                      <div key={v.fleetId} className="py-2 px-3 rounded-lg bg-accent-blue/5 border border-accent-blue/20">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-sm font-semibold text-white">{v.fleetId} <span className="text-navy-400 font-normal">— {v.year} {v.make} {v.model}</span></div>
                          <Badge variant="blue" size="md">Changes</Badge>
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
                    title={`Deactivations (${delta.deactivatedVans.length})`}
                    icon={Minus}
                    color="accent-red"
                    defaultOpen
                  >
                    {delta.deactivatedVans.map((v) => (
                      <div key={v.fleetId} className="flex items-center justify-between py-2 px-3 rounded-lg bg-accent-red/5 border border-accent-red/20">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{v.fleetId} <span className="text-navy-400 font-normal">— {v.year} {v.make} {v.model}</span></div>
                          <div className="text-[11px] text-navy-400 truncate">Not found in uploaded sheet — will be deactivated</div>
                        </div>
                        <Badge variant="red" size="md">Deactivate</Badge>
                      </div>
                    ))}
                  </DeltaSection>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {!success && (
          <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
            <button onClick={() => (step === 1 ? onClose() : setStep(step - 1))} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step === 2 && (
              <button onClick={handleApply} disabled={applying}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-blue to-accent-purple text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                {applying ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> Applying…</>) : (<>Confirm & Apply <Check size={14} /></>)}
              </button>
            )}
          </div>
        )}
        {success && (
          <div className="flex justify-end px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800">
            <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 cursor-pointer">Done</button>
          </div>
        )}
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
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-navy-800 bg-navy-950/40">
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Fleet ID</th>
          {isVendor && <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">DSP</th>}
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Year / Make / Model</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">VIN</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Plate</th>
          <th className="text-right text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Mileage</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Class</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">FMC</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Status</th>
          <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Location</th>
          <th className="text-right text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Actions</th>
        </tr>
      </thead>
      <tbody>
        {vans.map((v) => (
          <tr key={v.fleetId} onClick={() => onRowClick(v)}
            className="border-b border-navy-800/60 last:border-b-0 hover:bg-navy-800/40 cursor-pointer transition-colors">
            <td className="px-4 py-3 text-sm font-semibold text-white">{v.fleetId}</td>
            {isVendor && <td className="px-4 py-3 text-sm text-navy-200">{v.dsp}</td>}
            <td className="px-4 py-3 text-sm text-white whitespace-nowrap">{v.year} {v.make} <span className="text-navy-400">{v.model}</span></td>
            <td className="px-4 py-3 text-xs font-mono text-navy-300">{v.vin}</td>
            <td className="px-4 py-3 text-sm text-white whitespace-nowrap">{v.plate}</td>
            <td className="px-4 py-3 text-sm text-white text-right whitespace-nowrap font-mono">{v.mileage?.toLocaleString() || '—'} mi</td>
            <td className="px-4 py-3"><Badge variant={v.vehicleClass === 'Rental' ? 'purple' : v.vehicleClass === 'Owned' ? 'blue' : 'gold'}>{v.vehicleClass}</Badge></td>
            <td className="px-4 py-3 text-sm text-navy-300">{v.fmc}</td>
            <td className="px-4 py-3">
              {v.grounded ? (
                <Badge variant="red" size="md"><Lock size={9} className="inline mr-0.5" /> Grounded</Badge>
              ) : v.severity === 'clean' ? (
                <Badge variant="green"><CheckCircle2 size={9} className="inline mr-0.5" /> Clean</Badge>
              ) : v.severity === 'critical' ? (
                <Badge variant="red">{v.defectCount} defects</Badge>
              ) : v.severity === 'high' ? (
                <Badge variant="orange">{v.defectCount} defects</Badge>
              ) : (
                <Badge variant="gold">{v.defectCount} {v.defectCount === 1 ? 'defect' : 'defects'}</Badge>
              )}
            </td>
            <td className="px-4 py-3">
              <LocationBadge v={v} canEditLocation={canEdit && !isVendor} onChange={onLocationChange} />
            </td>
            <td className="px-4 py-3 text-right">
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); onCopy(v); }}
                  title="Copy details for billing"
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-all ${
                    copiedId === v.fleetId
                      ? 'bg-accent-green/20 border-accent-green/50 text-accent-green'
                      : 'bg-navy-800 border-navy-700 text-navy-300 hover:text-white hover:border-navy-600'
                  }`}
                >
                  {copiedId === v.fleetId ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
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
  return (
    <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-3 transition-colors">
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-center justify-between mb-1 gap-2">
          <span className="text-sm font-semibold text-white">{v.fleetId}</span>
          {v.grounded ? <Badge variant="red" size="md"><Lock size={9} className="inline mr-0.5" /> Grounded</Badge>
            : v.severity === 'clean' ? <Badge variant="green"><CheckCircle2 size={9} className="inline mr-0.5" /> Clean</Badge>
            : <Badge variant={v.severity === 'critical' ? 'red' : v.severity === 'high' ? 'orange' : 'gold'}>{v.defectCount} defect{v.defectCount > 1 ? 's' : ''}</Badge>}
        </div>
        {showDsp && <div className="text-[11px] text-accent-blue font-medium mb-1">{v.dsp}</div>}
        <div className="text-xs text-white mb-0.5">{v.year} {v.make} {v.model}</div>
        <div className="text-[11px] text-navy-400 font-mono truncate">{v.vin}</div>
        <div className="flex items-center justify-between mt-1.5 text-[11px] gap-2">
          <span className="text-navy-300 truncate">{v.plate} <span className="text-navy-500">·</span> <span className="text-white font-mono">{v.mileage?.toLocaleString() || '—'} mi</span></span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant={v.vehicleClass === 'Rental' ? 'purple' : v.vehicleClass === 'Owned' ? 'blue' : 'gold'}>{v.vehicleClass}</Badge>
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
          {copiedId === v.fleetId ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy details</>}
        </button>
      </div>
    </div>
  );
}

// Role view mode — DSP owners manage their own fleet; vendors browse (read-only) for invoicing
function getViewMode(role) {
  if (role === 'dsp_owner') return 'owner';
  if (role === 'vendor_admin' || role === 'technician') return 'vendor';
  return 'admin'; // site_admin
}

// ============================================================
// Main Component
// ============================================================
export default function MyVehicles({ user }) {
  const mode = getViewMode(user?.role);
  const canEdit = mode === 'owner' || mode === 'admin';
  const isVendor = mode === 'vendor';

  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [detailVehicle, setDetailVehicle] = useState(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [classFilter, setClassFilter] = useState('all');
  const [dspFilter, setDspFilter] = useState('all');
  const [dspFilterOpen, setDspFilterOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // Filter by user's DSP (DSPs see only their own fleet; vendors/admins see all)
  const [fleet, setFleet] = useState(() => {
    const base = mode === 'owner'
      ? fleetSnapshotVans.filter((v) => v.dspId === user?.orgId)
      : fleetSnapshotVans;
    return base.map(enrichVehicle);
  });

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

  const handleLocationChange = (fleetId, newLocation) => {
    setFleet(fleet.map((v) => (v.fleetId === fleetId ? { ...v, location: newLocation } : v)));
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

  const handleSaveVehicle = (form) => {
    if (editVehicle) {
      setFleet(fleet.map((v) => (v.fleetId === form.fleetId ? { ...v, ...form } : v)));
    } else {
      const newVan = {
        ...form,
        id: form.fleetId,
        dspId: user?.orgId || 'DSP-4201',
        dsp: user?.org || 'Unknown',
        defectCount: 0,
        severity: 'clean',
        lastInspected: 'Never',
        inspector: '—',
        grounded: false,
        mileage: 0,
        isFmcManaged: form.fmc !== 'Rented/Owned',
      };
      setFleet([newVan, ...fleet]);
    }
  };

  const handleDeleteVehicle = (v) => {
    setFleet(fleet.filter((x) => x.fleetId !== v.fleetId));
  };

  const handleApplyBulk = (delta) => {
    // Remove deactivated
    let next = fleet.filter((v) => !delta.deactivatedVans.find((d) => d.fleetId === v.fleetId));
    // Apply updates
    next = next.map((v) => {
      const upd = delta.updatedVans.find((u) => u.fleetId === v.fleetId);
      if (!upd) return v;
      return { ...v, vin: upd.vin, plate: upd.plate, color: upd.color, fmc: upd.fmc };
    });
    // Add new
    delta.newVans.forEach((n) => {
      next = [{
        ...n,
        id: n.fleetId,
        dspId: user?.orgId || 'DSP-4201',
        dsp: user?.org || 'Unknown',
        defectCount: 0,
        severity: 'clean',
        lastInspected: 'Never',
        inspector: '—',
        grounded: false,
        mileage: 0,
        isFmcManaged: n.fmc !== 'Rented/Owned',
      }, ...next];
    });
    setFleet(next);
  };

  const totalCount = fleet.length;
  const rentalCount = fleet.filter((v) => v.vehicleClass === 'Rental').length;
  const groundedCount = fleet.filter((v) => v.grounded).length;
  const cleanCount = fleet.filter((v) => v.defectCount === 0).length;
  const defectiveCount = fleet.filter((v) => v.defectCount > 0).length;

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

  const title = isVendor ? 'DSP Vehicles' : 'My Vehicles';
  const subtitle = isVendor
    ? 'Fleet directory across your assigned DSPs — copy any vehicle\'s details to your billing system'
    : 'Fleet management';

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 sm:mb-6 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-white mb-1">{title}</h2>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-navy-400">{subtitle} &mdash; <span className="text-white font-medium">{totalCount}</span> vans</span>
            {!isVendor && (
              <>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-green/15 border border-accent-green/40 text-accent-green text-xs font-semibold">
                  <CheckCircle2 size={11} /> {cleanCount} Clean
                </span>
                {defectiveCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs font-semibold">
                    <AlertTriangle size={11} /> {defectiveCount} defective
                  </span>
                )}
              </>
            )}
            {isVendor && <span className="text-navy-400">across <span className="text-white font-medium">{uniqueDsps.length}</span> DSPs</span>}
            {!isVendor && rentalCount > 0 && <span className="text-navy-400">· <span className="text-accent-purple">{rentalCount} rentals</span></span>}
            {!isVendor && groundedCount > 0 && <span className="text-navy-400">· <span className="text-accent-red">{groundedCount} grounded</span></span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Vendor / technician actions — read-only */}
          {isVendor && (
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-blue/15 border border-accent-blue/40 text-accent-blue text-sm font-semibold hover:bg-accent-blue/25 cursor-pointer">
              <Download size={14} /> Export CSV
            </button>
          )}
          {/* Owner / admin actions — write access */}
          {canEdit && (
            <>
              <button onClick={() => setShowBulkUpload(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-blue/15 border border-accent-blue/40 text-accent-blue text-sm font-semibold hover:bg-accent-blue/25 cursor-pointer">
                <Upload size={14} /> Bulk Upload
              </button>
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-green text-white text-sm font-semibold hover:bg-accent-green/80 cursor-pointer shadow-lg shadow-accent-green/20">
                <Plus size={14} /> Add Vehicle
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
            <strong className="text-white">Read-only view.</strong> Click any vehicle to see its full details, or use the copy button to paste Fleet ID, VIN and plate into your billing/ticketing system.
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
            placeholder={isVendor ? 'Search DSP, Fleet ID, VIN, plate or model…' : 'Search Fleet ID, VIN, plate or model…'}
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
              <span className="truncate max-w-[140px]">{dspFilter === 'all' ? 'All DSPs' : uniqueDsps.find((d) => d.id === dspFilter)?.name}</span>
              <ChevronDown size={12} />
            </button>
            {dspFilterOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDspFilterOpen(false)} />
                <div className="absolute top-full right-0 mt-1 w-64 bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-20 overflow-hidden max-h-72 overflow-y-auto">
                  <button onClick={() => { setDspFilter('all'); setDspFilterOpen(false); }}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm text-white hover:bg-navy-800 border-b border-navy-800">
                    <span>All DSPs <span className="text-navy-400">({fleet.length})</span></span>
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
          <option value="all">All classes</option>
          {VEHICLE_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
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
                  <Badge variant="gray" size="md">{group.vans.length} vans</Badge>
                </div>
                <button onClick={() => { setDspFilter(group.dspId); }}
                  className="text-[11px] text-accent-blue hover:underline">Filter to this DSP</button>
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
              No vehicles match your filter.
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
            <div className="px-4 py-10 text-center text-sm text-navy-400">No vehicles match your filter.</div>
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
                <button onClick={() => setDspFilter(group.dspId)} className="text-[10px] text-accent-blue">Filter</button>
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
            No vehicles match your filter.
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
      </AnimatePresence>
    </div>
  );
}
