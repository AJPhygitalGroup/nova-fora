import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, ArrowRight, Edit3, Save, Trash2, ChevronRight, Info, Check,
  CheckCircle2, AlertTriangle, Lock, Truck, Wrench, ClipboardCheck, Calendar,
  Clock, TrendingUp, Gauge, RefreshCw, X, Plus, Hourglass, PlayCircle
} from 'lucide-react';
import { workOrdersData, preventiveMaintenanceJobs } from '../data/mockData';
import Badge from './ui/Badge';

// V2.2 vehicle types — drive the DVIC; map 1:1 to the backend enum.
const VEHICLE_TYPES = [
  { value: 'regular_cargo_van',   label: 'Branded Cargo Van' },
  { value: 'custom_delivery_van', label: 'Custom Delivery Van (CDV)' },
  { value: 'step_van_dot',        label: 'Step Van (DOT)' },
  { value: 'box_truck_dot',       label: 'Box Truck (AMXL)' },
  { value: 'electric_vehicle',    label: 'Electric Vehicle' },
];
// Mirror Amazon Cortex `ownershipType`. The wizard uses these to filter
// branded-only DVIC items (DOT decal, Prime decal) for non-Amazon vans.
const OWNERSHIPS = [
  { value: 'amazon_owned',  label: 'Amazon-Owned'  },
  { value: 'amazon_leased', label: 'Amazon-Leased' },
  { value: 'dsp_owned',     label: 'DSP-Owned'     },
  { value: 'rental',        label: 'Rental'        },
];
const VEHICLE_TYPE_LABEL = Object.fromEntries(
  VEHICLE_TYPES.map(({ value, label }) => [value, label]),
);
const OWNERSHIP_LABEL = Object.fromEntries(
  OWNERSHIPS.map(({ value, label }) => [value, label]),
);
// Best-effort migration from legacy display strings → new enum values
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

// Generate a plausible inspection history for the demo based on the vehicle id
function buildInspectionHistory(vehicleId) {
  const seed = parseInt(vehicleId.replace(/\D/g, ''), 10) || 1;
  const inspectors = ['David Torres', 'Olger Joya', 'Mike Chen', 'Sarah Johnson'];
  const out = [];
  const today = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (i * 3 + (seed % 4)));
    const flagged = (i + seed) % 3 === 0;
    out.push({
      id: `INS-${vehicleId.replace('VAN-', '')}-${String(i + 1).padStart(2, '0')}`,
      date: d.toISOString(),
      inspector: inspectors[(seed + i) % inspectors.length],
      result: flagged ? 'Flagged' : 'Pass',
      defectsFound: flagged ? ((seed + i) % 3) + 1 : 0,
      mileage: 48000 - i * 1200,
    });
  }
  return out;
}

function buildMileageHistory(vehicleId, currentMileage) {
  const out = [];
  let m = currentMileage || 48000;
  const today = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 7);
    out.push({ date: d.toISOString(), mileage: m, source: i === 0 ? 'Last inspection' : i % 2 === 0 ? 'DVIC' : 'WO completion' });
    m -= Math.round(800 + Math.random() * 300);
  }
  return out;
}

// Translate a vehicle row (which may carry a legacy display string for
// vehicleClass) into form state with V2.2-aligned enum values.
function vehicleToForm(v) {
  if (!v) return {};
  const vehicleClass =
    VEHICLE_TYPE_LABEL[v.vehicleClass]
      ? v.vehicleClass
      : (LEGACY_VEHICLE_CLASS_TO_TYPE[v.vehicleClass] || 'regular_cargo_van');
  const ownership =
    LEGACY_OWNERSHIP_TO_GRANULAR[v.ownership] || v.ownership
    || LEGACY_VEHICLE_CLASS_TO_OWNERSHIP[v.vehicleClass]
    || 'amazon_owned';
  return { ...v, vehicleClass, ownership };
}

export default function VehicleDetailPage({ vehicle, fleet, user, readOnly, onBack, onSave, onDelete, onNavigate, onLocationChange }) {
  const { t } = useTranslation('fleet');
  const [form, setForm] = useState(() => vehicleToForm(vehicle));
  const [activeTab, setActiveTab] = useState('service');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync form when vehicle prop changes (Previous/Next navigation)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => { setForm(vehicleToForm(vehicle)); setEditing(false); setSaveError(null); }, [vehicle.fleetId]);

  const currentIndex = fleet.findIndex((v) => v.fleetId === vehicle.fleetId);
  const prev = currentIndex > 0 ? fleet[currentIndex - 1] : null;
  const next = currentIndex < fleet.length - 1 ? fleet[currentIndex + 1] : null;

  const update = (k, v) => {
    setForm({ ...form, [k]: v });
    if (saveError) setSaveError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave?.(form);
      setEditing(false);
    } catch (err) {
      const detail = err?.detail || err?.message || 'Save failed';
      const cleaned = typeof detail === 'string'
        ? detail.replace(/^body\.[a-z_]+:\s*/i, '')
        : 'Save failed — check the form fields and try again.';
      setSaveError(cleaned);
    } finally {
      setSaving(false);
    }
  };

  // Data sources per vehicle
  const serviceHistory = useMemo(
    () => workOrdersData.filter((wo) => wo.vehicleId === vehicle.fleetId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [vehicle.fleetId]
  );
  const inspectionHistory = useMemo(() => buildInspectionHistory(vehicle.fleetId), [vehicle.fleetId]);
  const upcomingPMs = useMemo(
    () => preventiveMaintenanceJobs.filter((p) => p.vehicleId === vehicle.fleetId),
    [vehicle.fleetId]
  );
  const mileageHistory = useMemo(() => buildMileageHistory(vehicle.fleetId, vehicle.mileage), [vehicle.fleetId, vehicle.mileage]);

  // Operational status
  const opStatus = vehicle.grounded ? 'grounded' : (vehicle.defectCount || 0) > 0 ? 'attention' : 'operational';
  const opConfig = {
    operational: { label: t('vehicleDetail.operational', 'Operational'),     color: 'text-accent-green',  dot: 'bg-accent-green',  icon: CheckCircle2 },
    attention:   { label: t('vehicleDetail.attention', 'Needs attention'),   color: 'text-accent-orange', dot: 'bg-accent-orange', icon: AlertTriangle },
    grounded:    { label: t('vehicleDetail.grounded', 'Grounded'),           color: 'text-accent-red',    dot: 'bg-accent-red',    icon: Lock },
  }[opStatus];
  const OpIcon = opConfig.icon;

  const locationLabel = {
    parking_lot: t('vehicleDetail.sidebar.parkingLot', 'Parking Lot'),
    offsite: t('vehicleDetail.sidebar.offsite', 'Offsite'),
    checked_out: t('vehicleDetail.sidebar.checkedOut', 'Checked Out'),
  }[vehicle.location] || t('vehicleDetail.sidebar.parkingLot', 'Parking Lot');
  const locationColor = { parking_lot: 'blue', offsite: 'gold', checked_out: 'purple' }[vehicle.location] || 'blue';

  const tabs = [
    { id: 'service',     label: t('vehicleDetail.tabs.service', 'Service History'),         icon: Wrench,          count: serviceHistory.length },
    { id: 'inspections', label: t('vehicleDetail.tabs.inspections', 'Inspection History'),  icon: ClipboardCheck,  count: inspectionHistory.length },
    { id: 'pms',         label: t('vehicleDetail.tabs.pms', 'Upcoming PMs'),                icon: RefreshCw,       count: upcomingPMs.length },
    { id: 'mileage',     label: t('vehicleDetail.tabs.mileage', 'Mileage History'),         icon: Gauge,           count: mileageHistory.length },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Breadcrumb + back */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[11px] text-navy-400">
          <button onClick={onBack} className="flex items-center gap-1 hover:text-white cursor-pointer">
            <ArrowLeft size={12} /> {t('vehicleDetail.breadcrumbVehicles', 'Vehicles')}
          </button>
          <ChevronRight size={10} />
          <span className="text-white font-semibold">{vehicle.fleetId}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => prev && onNavigate?.(prev)} disabled={!prev}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-navy-800 border border-navy-700 text-navy-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
            <ArrowLeft size={11} /> {t('vehicleDetail.previous', 'Previous')}
          </button>
          <span className="text-[11px] text-navy-500 px-1">{currentIndex + 1} / {fleet.length}</span>
          <button onClick={() => next && onNavigate?.(next)} disabled={!next}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-navy-800 border border-navy-700 text-navy-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
            {t('vehicleDetail.next', 'Next')} <ArrowRight size={11} />
          </button>
        </div>
      </div>

      {/* Top section: edit form (2/3) + status card (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT — info + edit form */}
        <div className="lg:col-span-2 bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-2xl sm:text-3xl font-bold text-white">{vehicle.fleetId}</h2>
                {!readOnly && (
                  <button onClick={() => setEditing(!editing)}
                    className="p-1.5 rounded-md hover:bg-navy-800 text-navy-400 hover:text-white cursor-pointer">
                    <Edit3 size={14} />
                  </button>
                )}
                {vehicle.grounded && <Badge variant="red" size="md"><Lock size={9} className="inline mr-0.5" /> {t('vehicleDetail.groundedBadge', 'Grounded')}</Badge>}
              </div>
              <div className="flex items-center gap-2 text-xs text-navy-300 flex-wrap">
                <span>{vehicle.year} {vehicle.make} {vehicle.model}</span>
                <span className="text-navy-600">·</span>
                <span className="font-mono">{vehicle.plate}</span>
                <span className="text-navy-600">·</span>
                <span className="font-mono text-navy-400">{vehicle.vin}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-navy-400 mt-1 flex-wrap">
                <Badge variant="gold">
                  {VEHICLE_TYPE_LABEL[vehicle.vehicleClass] || vehicle.vehicleClass}
                </Badge>
                {(vehicle.ownership || LEGACY_VEHICLE_CLASS_TO_OWNERSHIP[vehicle.vehicleClass]) && (
                  <span className="text-[11px] text-navy-400">
                    · {OWNERSHIP_LABEL[vehicle.ownership || LEGACY_VEHICLE_CLASS_TO_OWNERSHIP[vehicle.vehicleClass]]}
                  </span>
                )}
                <span>·</span>
                <span>{vehicle.fmc}</span>
                <span>·</span>
                <span className="font-mono text-white">{vehicle.mileage?.toLocaleString() || '—'} mi</span>
                <span>·</span>
                <span>{vehicle.dsp}</span>
              </div>
            </div>
          </div>

          {/* Edit form — collapsible. Shown expanded by default on first open to encourage inline edits */}
          <AnimatePresence initial={false}>
            {(editing || !readOnly) && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden">
                {editing && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-accent-green/10 border border-accent-green/30 text-xs text-accent-green mb-3">
                    <CheckCircle2 size={12} /> {t('vehicleDetail.form.allEditableHint', 'All fields are editable at once — no pencil per field.')}
                  </div>
                )}
                <fieldset disabled={readOnly || !editing} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">{t('vehicleDetail.form.fleetId', 'Fleet ID')}</label>
                    <input value={form.fleetId} disabled
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800/30 border border-navy-800 text-navy-400 cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">{t('vehicleDetail.form.licensePlate', 'License Plate')}</label>
                    <input value={form.plate} onChange={(e) => update('plate', e.target.value.toUpperCase())}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">{t('vehicleDetail.form.vin', 'VIN')}</label>
                    <input value={form.vin} onChange={(e) => update('vin', e.target.value.toUpperCase())} maxLength={17}
                      className="w-full rounded-lg px-3 py-2 text-sm font-mono bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">{t('vehicleDetail.form.year', 'Year')}</label>
                    <input type="number" value={form.year} onChange={(e) => update('year', parseInt(e.target.value, 10))}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">{t('vehicleDetail.form.make', 'Make')}</label>
                    <select value={form.make} onChange={(e) => update('make', e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                      {MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">{t('vehicleDetail.form.model', 'Model')}</label>
                    <input value={form.model} onChange={(e) => update('model', e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">{t('vehicleDetail.form.color', 'Color')}</label>
                    <select value={form.color} onChange={(e) => update('color', e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                      {['White', 'Blue', 'Silver', 'Black', 'Gray'].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">
                      {t('vehicleDetail.form.vehicleType', 'Vehicle Type')}
                    </label>
                    <select value={form.vehicleClass} onChange={(e) => update('vehicleClass', e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                      {VEHICLE_TYPES.map((vt) => <option key={vt.value} value={vt.value}>{vt.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">
                      {t('vehicleDetail.form.ownership', 'Ownership')}
                    </label>
                    <select value={form.ownership} onChange={(e) => update('ownership', e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                      {OWNERSHIPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">
                      {t('vehicleDetail.form.fmc', 'FMC')}
                    </label>
                    <input
                      type="text"
                      value={form.fmc || ''}
                      onChange={(e) => update('fmc', e.target.value)}
                      list="fmc-options-detail"
                      placeholder={t('vehicleDetail.form.fmcPlaceholder', 'e.g. Element, LP, Budget…')}
                      maxLength={50}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
                    />
                    <datalist id="fmc-options-detail">
                      {FMC_OPTIONS.map((f) => <option key={f} value={f} />)}
                    </datalist>
                  </div>
                </fieldset>

                {saveError && (
                  <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-accent-red/10 border border-accent-red/30 text-xs text-accent-red">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold mb-0.5">{t('vehicleDetail.form.saveError', "Couldn't save")}</div>
                      <div className="text-accent-red/90">{saveError}</div>
                    </div>
                  </div>
                )}

                {!readOnly && editing && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-navy-800 flex-wrap gap-2">
                    <button onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-accent-red hover:bg-accent-red/10 cursor-pointer">
                      <Trash2 size={12} /> {t('vehicleDetail.form.delete', 'Delete')}
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setForm({ ...vehicle }); setEditing(false); }}
                        className="px-4 py-2 rounded-md text-xs font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">{t('vehicleDetail.form.cancel', 'Cancel')}</button>
                      <button onClick={handleSave} disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                        {saving ? t('vehicleDetail.form.saving', 'Saving…') : <><Save size={12} /> {t('vehicleDetail.form.save', 'Save')}</>}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT — Status sidebar */}
        <div className="lg:col-span-1 bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5 space-y-4">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-1.5">
              <Info size={10} /> {t('vehicleDetail.sidebar.ownershipStatus', 'Ownership status')}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-accent-green" />
              <span className="text-sm font-semibold text-white">{t('vehicleDetail.activeBadge', 'Active')}</span>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-1.5">
              <Info size={10} /> {t('vehicleDetail.sidebar.operationalStatus', 'Operational status')}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-2 h-2 rounded-full ${opConfig.dot} shrink-0`} />
                <OpIcon size={14} className={`${opConfig.color} shrink-0`} />
                <span className={`text-sm font-semibold ${opConfig.color} truncate`}>{opConfig.label}</span>
              </div>
              {!readOnly && (
                <button className="px-3 py-1 rounded-md bg-accent-blue text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
                  {t('vehicleDetail.sidebar.update', 'Update')}
                </button>
              )}
            </div>
            <p className="text-[11px] text-navy-400 mt-2">{t('vehicleDetail.lastRoutePart1', 'Last route completed')} <span className="text-white">{vehicle.lastInspected?.toLowerCase().includes('today') ? t('vehicleDetail.today', 'today') : t('vehicleDetail.yesterday', 'yesterday')}</span></p>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-1.5">
              <Info size={10} /> {t('vehicleDetail.sidebar.location', 'Location')}
            </div>
            <Badge variant={locationColor} size="md">{locationLabel}</Badge>
            {!readOnly && vehicle.location !== 'checked_out' && (
              <button onClick={() => onLocationChange?.(vehicle.fleetId, vehicle.location === 'offsite' ? 'parking_lot' : 'offsite')}
                className="block mt-2 text-[11px] text-accent-blue hover:underline">
                {t('vehicleDetail.sidebar.moveTo', 'Move to')} {vehicle.location === 'offsite' ? t('vehicleDetail.sidebar.parkingLot', 'Parking Lot') : t('vehicleDetail.sidebar.offsite', 'Offsite')}
              </button>
            )}
          </div>

          <div className="pt-3 border-t border-navy-800">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-1.5">
              <Info size={10} /> {t('vehicleDetail.sidebar.quickStats', 'Quick stats')}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-[10px] text-navy-400">{t('vehicleDetail.stat.openDefects', 'Open defects')}</div>
                <div className={`font-bold ${vehicle.defectCount > 0 ? 'text-accent-orange' : 'text-accent-green'}`}>{vehicle.defectCount}</div>
              </div>
              <div>
                <div className="text-[10px] text-navy-400">{t('vehicleDetail.stat.serviceItems', 'Service items')}</div>
                <div className="font-bold text-white">{serviceHistory.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-navy-400">{t('vehicleDetail.stat.inspections', 'Inspections')}</div>
                <div className="font-bold text-white">{inspectionHistory.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-navy-400">{t('vehicleDetail.stat.upcomingPMs', 'Upcoming PMs')}</div>
                <div className="font-bold text-white">{upcomingPMs.length}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
        <div className="flex items-center border-b border-navy-800 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  active ? 'text-white' : 'text-navy-400 hover:text-white'
                }`}>
                <Icon size={14} />
                {tab.label}
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  active ? 'bg-accent-blue/20 text-accent-blue' : 'bg-navy-800 text-navy-400'
                }`}>{tab.count}</span>
                {active && (
                  <motion.div layoutId="vehTabIndicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-accent-blue to-accent-purple"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
                )}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            {activeTab === 'service' && <ServiceHistoryTable items={serviceHistory} />}
            {activeTab === 'inspections' && <InspectionHistoryTable items={inspectionHistory} />}
            {activeTab === 'pms' && <UpcomingPMsTable items={upcomingPMs} readOnly={readOnly} />}
            {activeTab === 'mileage' && <MileageHistoryTable items={mileageHistory} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Delete confirm */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setConfirmDelete(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}
              className="bg-navy-900 border border-accent-red/40 rounded-xl p-5 max-w-sm w-full text-center"
              onClick={(e) => e.stopPropagation()}>
              <div className="w-12 h-12 rounded-full bg-accent-red/15 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle size={22} className="text-accent-red" />
              </div>
              <h4 className="text-base font-semibold text-white mb-1">{t('vehicleDetail.form.delete', 'Delete')} {vehicle.fleetId}?</h4>
              <p className="text-xs text-navy-400 mb-4">{t('vehicleDetail.form.confirmDeleteBody', 'This removes the vehicle from your fleet. Historical inspection and repair data is kept.')}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 px-4 py-2 rounded-lg border border-navy-600 text-navy-300 text-sm hover:bg-navy-800 cursor-pointer">{t('vehicleDetail.form.cancel', 'Cancel')}</button>
                <button onClick={() => { onDelete?.(vehicle); setConfirmDelete(false); onBack?.(); }} className="flex-1 px-4 py-2 rounded-lg bg-accent-red text-white text-sm font-semibold hover:opacity-90 cursor-pointer">{t('vehicleDetail.form.delete', 'Delete')}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============================================================
// History tables
// ============================================================
const WO_STATUS_VARIANT = {
  pending: 'gold', pending_fmc: 'purple', in_progress: 'blue',
  completed: 'green', declined: 'red', canceled: 'gray',
};

function ServiceHistoryTable({ items }) {
  const { t } = useTranslation('fleet');
  if (items.length === 0) {
    return <EmptyState icon={Wrench}
      title={t('vehicleDetail.service.empty', 'No service history')}
      description={t('vehicleDetail.service.emptyDesc', 'Completed work orders will appear here.')} />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800 bg-navy-950/30">
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.service.th.dateMileage', 'Date & mileage')}</th>
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.service.th.issueType', 'Issue type')}</th>
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.service.th.categoryDesc', 'Category & description')}</th>
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.service.th.source', 'Source')}</th>
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.service.th.serviceRepair', 'Service & repair')}</th>
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.service.th.status', 'Status')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((wo) => (
            <tr key={wo.id} className="border-b border-navy-800/50 last:border-b-0 hover:bg-navy-800/30">
              <td className="px-4 py-3 align-top">
                <div className="text-xs text-white">{new Date(wo.completedAt || wo.createdAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</div>
                <div className="text-[10px] text-navy-400 font-mono">{wo.lastMileage?.toLocaleString() || '—'}</div>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="text-sm text-white font-medium">{wo.section?.split('. ')[1] || t('vehicleDetail.service.defaultIssue', 'Repair')}</div>
                <div className="text-[11px] text-navy-400">{wo.part}</div>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="text-sm text-white">{wo.part}</div>
                <div className="text-[11px] text-navy-400">{wo.description}</div>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="text-xs text-white">DVIC</div>
                <div className="text-[11px] text-navy-400">{new Date(wo.createdAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</div>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="text-xs text-white">{wo.assignedTechnician || '—'}</div>
                <div className="text-[11px] text-navy-400">{wo.roNumber && wo.roNumber !== 'N/A' ? wo.roNumber : <span className="text-navy-500">—</span>}</div>
              </td>
              <td className="px-4 py-3 align-top">
                <Badge variant={WO_STATUS_VARIANT[wo.status]}>{t(`vehicleDetail.service.woStatus.${wo.status}`, wo.status)}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InspectionHistoryTable({ items }) {
  const { t } = useTranslation('fleet');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800 bg-navy-950/30">
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.inspections.th.date', 'Date')}</th>
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.inspections.th.inspector', 'Inspector')}</th>
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.inspections.th.mileage', 'Mileage')}</th>
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.inspections.th.result', 'Result')}</th>
            <th className="text-right px-4 py-3 font-semibold">{t('vehicleDetail.inspections.th.defectsFound', 'Defects found')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((ins) => (
            <tr key={ins.id} className="border-b border-navy-800/50 last:border-b-0 hover:bg-navy-800/30">
              <td className="px-4 py-3">
                <div className="text-xs text-white">{new Date(ins.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</div>
                <div className="text-[10px] text-navy-500">{ins.id}</div>
              </td>
              <td className="px-4 py-3 text-sm text-white">{ins.inspector}</td>
              <td className="px-4 py-3 text-xs text-white font-mono">{ins.mileage.toLocaleString()} {t('myVehicles.milesShort', 'mi')}</td>
              <td className="px-4 py-3">
                {ins.result === 'Pass'
                  ? <Badge variant="green"><CheckCircle2 size={9} className="inline mr-0.5" /> {t('vehicleDetail.inspections.result.pass', 'Pass')}</Badge>
                  : <Badge variant="orange"><AlertTriangle size={9} className="inline mr-0.5" /> {t('vehicleDetail.inspections.result.flagged', 'Flagged')}</Badge>}
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-white">{ins.defectsFound}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UpcomingPMsTable({ items, readOnly }) {
  const { t } = useTranslation('fleet');
  if (items.length === 0) {
    return <EmptyState icon={RefreshCw}
      title={t('vehicleDetail.pms.empty', 'No upcoming PMs')}
      description={t('vehicleDetail.pms.emptyDesc', 'Preventive maintenance jobs will appear here when triggers are hit.')} />;
  }
  return (
    <div>
      {!readOnly && (
        <div className="flex justify-end px-4 py-2 border-b border-navy-800">
          <button className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-green text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
            <Plus size={12} /> {t('vehicleDetail.pms.schedulePM', 'Schedule PM')}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800 bg-navy-950/30">
              <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.pms.th.type', 'Type')}</th>
              <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.pms.th.trigger', 'Trigger')}</th>
              <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.pms.th.due', 'Due')}</th>
              <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.pms.th.vendor', 'Vendor')}</th>
              <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.pms.th.status', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((pm) => {
              const isMileage = pm.triggerType === 'mileage';
              const pct = isMileage && pm.currentValue ? Math.round((pm.currentValue / pm.triggerAt) * 100) : null;
              return (
                <tr key={pm.id} className="border-b border-navy-800/50 last:border-b-0 hover:bg-navy-800/30">
                  <td className="px-4 py-3 text-sm font-medium text-white">{pm.type}</td>
                  <td className="px-4 py-3 text-xs text-navy-300">
                    {isMileage
                      ? <>{t('vehicleDetail.pms.atMileageFmt', 'At')} <span className="text-white font-mono">{pm.triggerAt.toLocaleString()} {t('myVehicles.milesShort', 'mi')}</span>{pct !== null && <span className="text-[10px] text-navy-500 ml-1">{t('vehicleDetail.pms.thereFmt', { pct, defaultValue: `(${pct}% there)` })}</span>}</>
                      : <>{t('vehicleDetail.pms.onDate', 'On')} <span className="text-white">{pm.triggerAt}</span></>}
                  </td>
                  <td className="px-4 py-3 text-xs text-white">{pm.dueAt}</td>
                  <td className="px-4 py-3 text-xs text-white">{pm.vendor}</td>
                  <td className="px-4 py-3">
                    <Badge variant={pm.status === 'upcoming' ? 'gold' : 'blue'}>{pm.status === 'upcoming' ? t('vehicleDetail.pms.status.upcoming', 'Upcoming') : t('vehicleDetail.pms.status.scheduled', 'Scheduled')}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MileageHistoryTable({ items }) {
  const { t } = useTranslation('fleet');
  if (items.length === 0) {
    return <EmptyState icon={Gauge}
      title={t('vehicleDetail.mileage.empty', 'No mileage history')}
      description={t('vehicleDetail.mileage.emptyDesc', 'Mileage readings from inspections and WOs will populate this timeline.')} />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800 bg-navy-950/30">
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.mileage.th.date', 'Date')}</th>
            <th className="text-right px-4 py-3 font-semibold">{t('vehicleDetail.mileage.th.mileage', 'Mileage')}</th>
            <th className="text-right px-4 py-3 font-semibold">{t('vehicleDetail.mileage.th.delta', 'Delta')}</th>
            <th className="text-left px-4 py-3 font-semibold">{t('vehicleDetail.mileage.th.source', 'Source')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m, i) => {
            const next = items[i + 1];
            const delta = next ? m.mileage - next.mileage : null;
            return (
              <tr key={`${m.date}-${i}`} className="border-b border-navy-800/50 last:border-b-0 hover:bg-navy-800/30">
                <td className="px-4 py-3 text-xs text-white">{new Date(m.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</td>
                <td className="px-4 py-3 text-right text-sm text-white font-mono">{m.mileage.toLocaleString()} {t('myVehicles.milesShort', 'mi')}</td>
                <td className="px-4 py-3 text-right text-xs">
                  {delta !== null ? <span className="text-accent-green">+{delta.toLocaleString()}</span> : <span className="text-navy-500">—</span>}
                </td>
                <td className="px-4 py-3 text-xs text-navy-300">{m.source}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="text-center py-12 px-6">
      <Icon size={40} className="text-navy-600 mx-auto mb-3" />
      <p className="text-sm font-semibold text-white mb-1">{title}</p>
      <p className="text-xs text-navy-400 max-w-sm mx-auto">{description}</p>
    </div>
  );
}
