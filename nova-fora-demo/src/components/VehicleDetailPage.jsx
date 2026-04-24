import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Edit3, Save, Trash2, ChevronRight, Info, Check,
  CheckCircle2, AlertTriangle, Lock, Truck, Wrench, ClipboardCheck, Calendar,
  Clock, TrendingUp, Gauge, RefreshCw, X, Plus, Hourglass, PlayCircle
} from 'lucide-react';
import { workOrdersData, preventiveMaintenanceJobs } from '../data/mockData';
import Badge from './ui/Badge';

const VEHICLE_CLASSES = ['Branded Cargo', 'Step Van', 'Rental', 'Owned'];
const FMC_OPTIONS = ['Wheels', 'Element', 'Rented/Owned', 'Holman', 'Enterprise Fleet', 'Other'];
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

export default function VehicleDetailPage({ vehicle, fleet, user, readOnly, onBack, onSave, onDelete, onNavigate, onLocationChange }) {
  const [form, setForm] = useState({ ...vehicle });
  const [activeTab, setActiveTab] = useState('service');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync form when vehicle prop changes (Previous/Next navigation)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => { setForm({ ...vehicle }); setEditing(false); }, [vehicle.fleetId]);

  const currentIndex = fleet.findIndex((v) => v.fleetId === vehicle.fleetId);
  const prev = currentIndex > 0 ? fleet[currentIndex - 1] : null;
  const next = currentIndex < fleet.length - 1 ? fleet[currentIndex + 1] : null;

  const update = (k, v) => setForm({ ...form, [k]: v });

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      onSave?.(form);
      setSaving(false);
      setEditing(false);
    }, 500);
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
  const opStatus = vehicle.grounded ? 'grounded' : vehicle.severity === 'critical' ? 'critical' : vehicle.severity === 'high' ? 'attention' : 'operational';
  const opConfig = {
    operational: { label: 'Operational',   color: 'text-accent-green',  dot: 'bg-accent-green',  icon: CheckCircle2 },
    attention:   { label: 'Needs attention', color: 'text-accent-orange', dot: 'bg-accent-orange', icon: AlertTriangle },
    critical:    { label: 'Critical',       color: 'text-accent-red',    dot: 'bg-accent-red',    icon: AlertTriangle },
    grounded:    { label: 'Grounded',       color: 'text-accent-red',    dot: 'bg-accent-red',    icon: Lock },
  }[opStatus];
  const OpIcon = opConfig.icon;

  const locationLabel = { parking_lot: 'Parking Lot', offsite: 'Offsite', checked_out: 'Checked Out' }[vehicle.location] || 'Parking Lot';
  const locationColor = { parking_lot: 'blue', offsite: 'gold', checked_out: 'purple' }[vehicle.location] || 'blue';

  const tabs = [
    { id: 'service',     label: 'Service History',    icon: Wrench,          count: serviceHistory.length },
    { id: 'inspections', label: 'Inspection History', icon: ClipboardCheck,  count: inspectionHistory.length },
    { id: 'pms',         label: 'Upcoming PMs',       icon: RefreshCw,       count: upcomingPMs.length },
    { id: 'mileage',     label: 'Mileage History',    icon: Gauge,           count: mileageHistory.length },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Breadcrumb + back */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[11px] text-navy-400">
          <button onClick={onBack} className="flex items-center gap-1 hover:text-white cursor-pointer">
            <ArrowLeft size={12} /> Vehicles
          </button>
          <ChevronRight size={10} />
          <span className="text-white font-semibold">{vehicle.fleetId}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => prev && onNavigate?.(prev)} disabled={!prev}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-navy-800 border border-navy-700 text-navy-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
            <ArrowLeft size={11} /> Previous
          </button>
          <span className="text-[11px] text-navy-500 px-1">{currentIndex + 1} / {fleet.length}</span>
          <button onClick={() => next && onNavigate?.(next)} disabled={!next}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-navy-800 border border-navy-700 text-navy-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
            Next <ArrowRight size={11} />
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
                {vehicle.grounded && <Badge variant="red" size="md"><Lock size={9} className="inline mr-0.5" /> Grounded</Badge>}
              </div>
              <div className="flex items-center gap-2 text-xs text-navy-300 flex-wrap">
                <span>{vehicle.year} {vehicle.make} {vehicle.model}</span>
                <span className="text-navy-600">·</span>
                <span className="font-mono">{vehicle.plate}</span>
                <span className="text-navy-600">·</span>
                <span className="font-mono text-navy-400">{vehicle.vin}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-navy-400 mt-1 flex-wrap">
                <Badge variant={vehicle.vehicleClass === 'Rental' ? 'purple' : vehicle.vehicleClass === 'Owned' ? 'blue' : 'gold'}>{vehicle.vehicleClass}</Badge>
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
                    <CheckCircle2 size={12} /> All fields are editable at once &mdash; no pencil per field.
                  </div>
                )}
                <fieldset disabled={readOnly || !editing} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">Fleet ID</label>
                    <input value={form.fleetId} disabled
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800/30 border border-navy-800 text-navy-400 cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">License Plate</label>
                    <input value={form.plate} onChange={(e) => update('plate', e.target.value.toUpperCase())}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">VIN</label>
                    <input value={form.vin} onChange={(e) => update('vin', e.target.value.toUpperCase())} maxLength={17}
                      className="w-full rounded-lg px-3 py-2 text-sm font-mono bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">Year</label>
                    <input type="number" value={form.year} onChange={(e) => update('year', parseInt(e.target.value, 10))}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">Make</label>
                    <select value={form.make} onChange={(e) => update('make', e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                      {MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">Model</label>
                    <input value={form.model} onChange={(e) => update('model', e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">Color</label>
                    <select value={form.color} onChange={(e) => update('color', e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                      {['White', 'Blue', 'Silver', 'Black', 'Gray'].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">Vehicle Class</label>
                    <select value={form.vehicleClass} onChange={(e) => update('vehicleClass', e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                      {VEHICLE_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">FMC</label>
                    <select value={form.fmc} onChange={(e) => update('fmc', e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer">
                      {FMC_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                </fieldset>

                {!readOnly && editing && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-navy-800 flex-wrap gap-2">
                    <button onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-accent-red hover:bg-accent-red/10 cursor-pointer">
                      <Trash2 size={12} /> Delete Vehicle
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setForm({ ...vehicle }); setEditing(false); }}
                        className="px-4 py-2 rounded-md text-xs font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Cancel</button>
                      <button onClick={handleSave} disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                        {saving ? 'Saving…' : <><Save size={12} /> Save Changes</>}
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
              <Info size={10} /> Ownership status
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-accent-green" />
              <span className="text-sm font-semibold text-white">Active</span>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-1.5">
              <Info size={10} /> Operational status
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-2 h-2 rounded-full ${opConfig.dot} shrink-0`} />
                <OpIcon size={14} className={`${opConfig.color} shrink-0`} />
                <span className={`text-sm font-semibold ${opConfig.color} truncate`}>{opConfig.label}</span>
              </div>
              {!readOnly && (
                <button className="px-3 py-1 rounded-md bg-accent-blue text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
                  Update
                </button>
              )}
            </div>
            <p className="text-[11px] text-navy-400 mt-2">Last route completed <span className="text-white">{vehicle.lastInspected?.toLowerCase().includes('today') ? 'today' : 'yesterday'}</span></p>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-1.5">
              <Info size={10} /> Location
            </div>
            <Badge variant={locationColor} size="md">{locationLabel}</Badge>
            {!readOnly && vehicle.location !== 'checked_out' && (
              <button onClick={() => onLocationChange?.(vehicle.fleetId, vehicle.location === 'offsite' ? 'parking_lot' : 'offsite')}
                className="block mt-2 text-[11px] text-accent-blue hover:underline">
                Move to {vehicle.location === 'offsite' ? 'Parking Lot' : 'Offsite'}
              </button>
            )}
          </div>

          <div className="pt-3 border-t border-navy-800">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-1.5">
              <Info size={10} /> Quick stats
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-[10px] text-navy-400">Open defects</div>
                <div className={`font-bold ${vehicle.defectCount > 0 ? 'text-accent-orange' : 'text-accent-green'}`}>{vehicle.defectCount}</div>
              </div>
              <div>
                <div className="text-[10px] text-navy-400">Service items</div>
                <div className="font-bold text-white">{serviceHistory.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-navy-400">Inspections</div>
                <div className="font-bold text-white">{inspectionHistory.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-navy-400">Upcoming PMs</div>
                <div className="font-bold text-white">{upcomingPMs.length}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
        <div className="flex items-center border-b border-navy-800 overflow-x-auto">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  active ? 'text-white' : 'text-navy-400 hover:text-white'
                }`}>
                <Icon size={14} />
                {t.label}
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  active ? 'bg-accent-blue/20 text-accent-blue' : 'bg-navy-800 text-navy-400'
                }`}>{t.count}</span>
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
              <h4 className="text-base font-semibold text-white mb-1">Delete {vehicle.fleetId}?</h4>
              <p className="text-xs text-navy-400 mb-4">This removes the vehicle from your fleet. Historical inspection and repair data is kept.</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 px-4 py-2 rounded-lg border border-navy-600 text-navy-300 text-sm hover:bg-navy-800 cursor-pointer">Cancel</button>
                <button onClick={() => { onDelete?.(vehicle); setConfirmDelete(false); onBack?.(); }} className="flex-1 px-4 py-2 rounded-lg bg-accent-red text-white text-sm font-semibold hover:opacity-90 cursor-pointer">Delete</button>
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
const WO_STATUS_LABEL = {
  pending: 'Pending', pending_fmc: 'Pending FMC', in_progress: 'In Progress',
  completed: 'Completed', declined: 'Declined', canceled: 'Canceled',
};

function ServiceHistoryTable({ items }) {
  if (items.length === 0) {
    return <EmptyState icon={Wrench} title="No service history" description="Completed work orders will appear here." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800 bg-navy-950/30">
            <th className="text-left px-4 py-3 font-semibold">Date &amp; mileage</th>
            <th className="text-left px-4 py-3 font-semibold">Issue type</th>
            <th className="text-left px-4 py-3 font-semibold">Category &amp; description</th>
            <th className="text-left px-4 py-3 font-semibold">Source</th>
            <th className="text-left px-4 py-3 font-semibold">Service &amp; repair</th>
            <th className="text-left px-4 py-3 font-semibold">Status</th>
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
                <div className="text-sm text-white font-medium">{wo.section?.split('. ')[1] || 'Repair'}</div>
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
                <Badge variant={WO_STATUS_VARIANT[wo.status]}>{WO_STATUS_LABEL[wo.status]}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InspectionHistoryTable({ items }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800 bg-navy-950/30">
            <th className="text-left px-4 py-3 font-semibold">Date</th>
            <th className="text-left px-4 py-3 font-semibold">Inspector</th>
            <th className="text-left px-4 py-3 font-semibold">Mileage</th>
            <th className="text-left px-4 py-3 font-semibold">Result</th>
            <th className="text-right px-4 py-3 font-semibold">Defects found</th>
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
              <td className="px-4 py-3 text-xs text-white font-mono">{ins.mileage.toLocaleString()} mi</td>
              <td className="px-4 py-3">
                {ins.result === 'Pass'
                  ? <Badge variant="green"><CheckCircle2 size={9} className="inline mr-0.5" /> Pass</Badge>
                  : <Badge variant="orange"><AlertTriangle size={9} className="inline mr-0.5" /> Flagged</Badge>}
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
  if (items.length === 0) {
    return <EmptyState icon={RefreshCw} title="No upcoming PMs" description="Preventive maintenance jobs will appear here when triggers are hit." />;
  }
  return (
    <div>
      {!readOnly && (
        <div className="flex justify-end px-4 py-2 border-b border-navy-800">
          <button className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-green text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
            <Plus size={12} /> Schedule PM
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800 bg-navy-950/30">
              <th className="text-left px-4 py-3 font-semibold">Type</th>
              <th className="text-left px-4 py-3 font-semibold">Trigger</th>
              <th className="text-left px-4 py-3 font-semibold">Due</th>
              <th className="text-left px-4 py-3 font-semibold">Vendor</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
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
                      ? <>At <span className="text-white font-mono">{pm.triggerAt.toLocaleString()} mi</span>{pct !== null && <span className="text-[10px] text-navy-500 ml-1">({pct}% there)</span>}</>
                      : <>On <span className="text-white">{pm.triggerAt}</span></>}
                  </td>
                  <td className="px-4 py-3 text-xs text-white">{pm.dueAt}</td>
                  <td className="px-4 py-3 text-xs text-white">{pm.vendor}</td>
                  <td className="px-4 py-3">
                    <Badge variant={pm.status === 'upcoming' ? 'gold' : 'blue'}>{pm.status === 'upcoming' ? 'Upcoming' : 'Scheduled'}</Badge>
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
  if (items.length === 0) {
    return <EmptyState icon={Gauge} title="No mileage history" description="Mileage readings from inspections and WOs will populate this timeline." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800 bg-navy-950/30">
            <th className="text-left px-4 py-3 font-semibold">Date</th>
            <th className="text-right px-4 py-3 font-semibold">Mileage</th>
            <th className="text-right px-4 py-3 font-semibold">Delta</th>
            <th className="text-left px-4 py-3 font-semibold">Source</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m, i) => {
            const next = items[i + 1];
            const delta = next ? m.mileage - next.mileage : null;
            return (
              <tr key={`${m.date}-${i}`} className="border-b border-navy-800/50 last:border-b-0 hover:bg-navy-800/30">
                <td className="px-4 py-3 text-xs text-white">{new Date(m.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</td>
                <td className="px-4 py-3 text-right text-sm text-white font-mono">{m.mileage.toLocaleString()} mi</td>
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
