import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutGrid, Truck, KeyRound, AlertTriangle, CheckCircle2, X, Lock, Send, Eye,
  ArrowRight, Calendar, Users, Filter, Plus, ShieldCheck, Camera, Clock,
  ChevronDown, ChevronRight, Check, Image as ImageIcon, Star, MapPin,
  Wrench, Flame, FileText, ClipboardList, Zap, Info
} from 'lucide-react';
import { fleetSnapshotVans, fleetSnapshotDefectDetails, availableVendors, SECTION_TO_SERVICES } from '../data/mockData';
import Badge from './ui/Badge';

// Severity → color configuration for heatmap tiles
const SEVERITY_CONFIG = {
  clean:    { bg: 'bg-accent-green/15',   border: 'border-accent-green/40',  text: 'text-accent-green',  label: 'Clean',    bar: 'bg-accent-green', ring: 'ring-accent-green/30' },
  low:      { bg: 'bg-accent-blue/15',    border: 'border-accent-blue/40',   text: 'text-accent-blue',   label: 'Low',      bar: 'bg-accent-blue',  ring: 'ring-accent-blue/30' },
  medium:   { bg: 'bg-accent-gold/15',    border: 'border-accent-gold/40',   text: 'text-accent-gold',   label: 'Medium',   bar: 'bg-accent-gold',  ring: 'ring-accent-gold/30' },
  high:     { bg: 'bg-accent-orange/15',  border: 'border-accent-orange/40', text: 'text-accent-orange', label: 'High',     bar: 'bg-accent-orange',ring: 'ring-accent-orange/30' },
  critical: { bg: 'bg-accent-red/20',     border: 'border-accent-red/50',    text: 'text-accent-red',    label: 'Critical', bar: 'bg-accent-red',   ring: 'ring-accent-red/40' },
};

const DEFECT_STATUS_CONFIG = {
  pending:        { label: 'Pending',         variant: 'gold' },
  approved:       { label: 'Approved',        variant: 'green' },
  canceled:       { label: 'Canceled',        variant: 'gray' },
  acknowledged:   { label: 'Acknowledged',    variant: 'blue' },
  sent_to_vendor: { label: 'Sent to Vendor',  variant: 'purple' },
  completed:      { label: 'Completed',       variant: 'green' },
};

const SEVERITY_BADGE = { Low: 'blue', Medium: 'gold', High: 'orange', Critical: 'red' };

// Tile sizes based on screen breakpoint — we want the heatmap to feel dense like a real fleet view
function HeatmapTile({ van, onClick }) {
  const conf = SEVERITY_CONFIG[van.severity] || SEVERITY_CONFIG.clean;
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.05, zIndex: 10 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => onClick(van)}
      className={`relative aspect-square rounded-lg border ${conf.border} ${conf.bg} hover:ring-2 ${conf.ring} transition-all cursor-pointer group flex flex-col items-center justify-center p-1 overflow-hidden min-h-[56px]`}
    >
      {van.grounded && (
        <div className="absolute inset-0 bg-accent-red/30 backdrop-blur-[1px] flex items-center justify-center z-10">
          <Lock size={18} className="text-accent-red" />
        </div>
      )}
      <div className={`text-[10px] sm:text-[11px] font-mono font-semibold ${conf.text} leading-none`}>
        {van.id.replace('VAN-', '')}
      </div>
      {van.defectCount > 0 && (
        <div className={`mt-1 text-[9px] sm:text-[10px] ${conf.text} font-bold leading-none`}>
          {van.defectCount} {van.defectCount === 1 ? 'defect' : 'defects'}
        </div>
      )}
      {van.defectCount === 0 && (
        <CheckCircle2 size={10} className={`mt-0.5 ${conf.text}`} />
      )}
    </motion.button>
  );
}

function SeverityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {Object.entries(SEVERITY_CONFIG).map(([k, c]) => (
        <div key={k} className="flex items-center gap-1.5">
          <div className={`w-3 h-3 rounded-sm ${c.bar}`} />
          <span className="text-navy-300">{c.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <Lock size={10} className="text-accent-red" />
        <span className="text-navy-300">Grounded</span>
      </div>
    </div>
  );
}

// ---------- Flex Fleet Modal ----------
export function FlexFleetModal({ onClose }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [vanCount, setVanCount] = useState(5);
  const [reason, setReason] = useState('Prime Day');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSuccess(true);
    }, 1000);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 280 }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[95vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-purple/15 flex items-center justify-center">
              <Truck size={16} className="text-accent-purple" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Order Flex Fleet</h3>
              <p className="text-[11px] text-navy-400">Temporary rentals for peak demand</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>

        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1">
          {success ? (
            <div className="text-center py-4">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
                className="w-14 h-14 mx-auto rounded-full bg-accent-green/15 border border-accent-green/40 flex items-center justify-center mb-4">
                <CheckCircle2 size={26} className="text-accent-green" />
              </motion.div>
              <h4 className="text-base font-semibold text-white mb-1">Flex Fleet Requested</h4>
              <p className="text-xs text-navy-400 mb-4">Your {vanCount} vans will be delivered on {startDate || 'the start date'}.</p>
              <div className="inline-flex flex-col gap-1 px-4 py-3 rounded-lg bg-navy-800/60 border border-navy-700/40 text-left">
                <div className="text-[11px] text-navy-400">Request ID</div>
                <div className="text-sm font-mono text-accent-purple">FF-{Math.floor(10000 + Math.random() * 90000)}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Start date</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-purple" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">End date</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-purple" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Number of vans</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setVanCount(Math.max(1, vanCount - 1))}
                    className="w-11 h-11 rounded-lg border border-navy-700 bg-navy-800 text-white text-lg font-bold hover:bg-navy-700 cursor-pointer">−</button>
                  <input type="number" value={vanCount} onChange={(e) => setVanCount(Math.max(1, Number(e.target.value)))}
                    className="flex-1 rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white text-center outline-none focus:border-accent-purple" />
                  <button onClick={() => setVanCount(vanCount + 1)}
                    className="w-11 h-11 rounded-lg border border-navy-700 bg-navy-800 text-white text-lg font-bold hover:bg-navy-700 cursor-pointer">+</button>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Reason</label>
                <select value={reason} onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-purple cursor-pointer">
                  <option>Prime Day</option>
                  <option>Black Friday / Cyber Monday</option>
                  <option>Holiday Surge</option>
                  <option>Temporary Vehicle Breakdown</option>
                  <option>New Route Launch</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="p-3 rounded-lg bg-accent-purple/10 border border-accent-purple/30 text-xs text-navy-200">
                <strong className="text-accent-purple">Estimated cost:</strong> ${(vanCount * 89).toLocaleString()}/day · Delivered within 48h
              </div>
            </div>
          )}
        </div>

        {!success && (
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Cancel</button>
            <button onClick={handleSubmit} disabled={!startDate || !endDate || submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-purple text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
              {submitting ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> Submitting…</>) : (<>Request Fleet <ArrowRight size={14} /></>)}
            </button>
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

// Ground Vehicle Modal was removed — Ground action is no longer available
// from the Vehicle Report Card (Create Work Order is the single primary
// action there). The underlying `grounded` flag is still surfaced via the
// grounded banner and legend.

// ---------- Vehicle Report Card (drawer/bottom sheet) ----------
export function VehicleReportCard({ van, onClose, onUpdateVan, userRole, onCreateWO }) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [defectActions, setDefectActions] = useState({});
  const [autoApproveSimilar, setAutoApproveSimilar] = useState({});
  const defects = fleetSnapshotDefectDetails[van.id] || [];

  // Mock photos — labeled
  const photos = [
    { id: 1, label: 'Odometer', caption: `${van.mileage.toLocaleString()} mi` },
    { id: 2, label: 'Front / Plate', caption: van.plate },
    { id: 3, label: 'Damage — Q1', caption: 'Crack spreading' },
    { id: 4, label: 'Damage — Q2', caption: 'Tread 2/32"' },
  ];

  // Group defects by section
  const defectsBySection = useMemo(() => {
    const groups = {};
    defects.forEach((d) => {
      if (!groups[d.section]) groups[d.section] = [];
      groups[d.section].push(d);
    });
    return groups;
  }, [defects]);

  const handleAction = (defectId, action) => {
    setDefectActions({ ...defectActions, [defectId]: action });
  };

  // Approve a single defect. If autoApproveSimilar is checked for it, also
  // approve any other pending defect with the same part so the DSP clears
  // many small, routine items in one click.
  const handleApprove = (defect) => {
    const next = { ...defectActions, [defect.id]: 'approved' };
    if (autoApproveSimilar[defect.id]) {
      defects.forEach((d) => {
        const cur = defectActions[d.id] || d.status;
        if (d.id !== defect.id && cur === 'pending' && d.part === defect.part) {
          next[d.id] = 'approved';
        }
      });
    }
    setDefectActions(next);
    // After approving, open the Create WO modal pre-filled with this defect
    onCreateWO?.(van, defect);
  };

  const handleCancel = (defect) => {
    setDefectActions({ ...defectActions, [defect.id]: 'canceled' });
  };

  const toggleAutoApprove = (defectId) => {
    setAutoApproveSimilar({ ...autoApproveSimilar, [defectId]: !autoApproveSimilar[defectId] });
  };

  const handleUnground = () => {
    onUpdateVan(van.id, { grounded: false, groundedReason: null });
  };

  const canTakeActions = userRole === 'dsp_owner' || userRole === 'site_admin' || userRole === 'vendor_admin';

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-navy-950 z-50 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="w-full h-full flex flex-col">

          {/* Header — sticky full-width */}
          <div className="px-4 sm:px-6 lg:px-8 py-4 border-b border-navy-800 bg-navy-900/80 backdrop-blur">
            <div className="max-w-6xl mx-auto">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={onClose}
                    className="text-navy-300 hover:text-white p-2 -ml-2 rounded-md hover:bg-navy-800 cursor-pointer shrink-0" title="Back">
                    <ArrowRight size={18} className="rotate-180" />
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <h3 className="text-xl sm:text-2xl font-bold text-white">{van.id}</h3>
                      <Badge variant={SEVERITY_BADGE[van.severity === 'critical' ? 'Critical' : van.severity === 'high' ? 'High' : van.severity === 'medium' ? 'Medium' : van.severity === 'low' ? 'Low' : 'Low'] || 'gray'} size="md">
                        {SEVERITY_CONFIG[van.severity]?.label || 'Clean'}
                      </Badge>
                      {van.grounded && <Badge variant="red" size="md">Grounded</Badge>}
                    </div>
                    <div className="text-xs sm:text-sm text-navy-300 truncate">
                      <span>{van.model}</span>
                      <span className="text-navy-600 mx-2">·</span>
                      <span className="font-mono">{van.plate}</span>
                      <span className="text-navy-600 mx-2">·</span>
                      <span>{van.dsp}</span>
                      <span className="text-navy-600 mx-2">·</span>
                      <span className="font-mono">{van.mileage.toLocaleString()} mi</span>
                    </div>
                  </div>
                </div>
                <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2 shrink-0 rounded-md hover:bg-navy-800" title="Close"><X size={20} /></button>
              </div>

              {/* Last inspection + quick stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
                  <div className="text-[10px] text-navy-400 uppercase tracking-wide">Last inspected</div>
                  <div className="text-white font-medium flex items-center gap-1 mt-0.5"><Clock size={11} className="text-accent-blue" /> {van.lastInspected}</div>
                  <div className="text-[11px] text-navy-400 truncate">by {van.inspector}</div>
                </div>
                <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
                  <div className="text-[10px] text-navy-400 uppercase tracking-wide">Current defects</div>
                  <div className={`text-lg font-bold ${SEVERITY_CONFIG[van.severity]?.text || 'text-accent-green'}`}>{van.defectCount}</div>
                  <div className="text-[11px] text-navy-400">{van.defectCount === 0 ? 'Clean bill' : 'Active issues'}</div>
                </div>
                <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
                  <div className="text-[10px] text-navy-400 uppercase tracking-wide">Mileage</div>
                  <div className="text-sm text-white font-semibold mt-0.5 font-mono">{van.mileage.toLocaleString()} mi</div>
                </div>
                <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
                  <div className="text-[10px] text-navy-400 uppercase tracking-wide">DSP</div>
                  <div className="text-sm text-white font-semibold mt-0.5 truncate">{van.dsp}</div>
                </div>
              </div>

              {/* Grounded banner */}
              {van.grounded && (
                <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-accent-red/10 border border-accent-red/40">
                  <Lock size={14} className="text-accent-red mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-accent-red">Vehicle Grounded</div>
                    <div className="text-[11px] text-navy-300 mt-0.5">{van.groundedReason || 'Unsafe for routing'}</div>
                  </div>
                  {canTakeActions && (
                    <button onClick={handleUnground} className="text-[11px] font-semibold text-accent-green hover:underline shrink-0">Unground</button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Body — centered with generous max-width; two-column on wide screens */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
            <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* LEFT column — Photo carousel (2/5 on desktop, full width mobile) */}
            <div className="lg:col-span-2 lg:sticky lg:top-4 lg:self-start">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-navy-300">
                  <ImageIcon size={13} className="text-accent-blue" /> Photos ({photos.length})
                </div>
                <div className="flex items-center gap-1">
                  {photos.map((_, i) => (
                    <button key={i} onClick={() => setPhotoIndex(i)}
                      className={`w-1.5 h-1.5 rounded-full transition-all ${i === photoIndex ? 'bg-accent-blue w-4' : 'bg-navy-600'}`} />
                  ))}
                </div>
              </div>
              <motion.div key={photoIndex} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                className="relative aspect-[4/3] rounded-xl bg-gradient-to-br from-navy-800 to-navy-900 border border-navy-700 overflow-hidden flex items-center justify-center">
                <Camera size={48} className="text-navy-600" />
                <div className="absolute bottom-2 left-2 px-2 py-1 rounded-md bg-black/60 backdrop-blur text-[10px] font-semibold text-white">
                  {photos[photoIndex].label}
                </div>
                <div className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-black/60 backdrop-blur text-[10px] text-navy-200">
                  {photos[photoIndex].caption}
                </div>
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-accent-blue/80 text-[10px] font-semibold text-white">
                  {photoIndex + 1} / {photos.length}
                </div>
              </motion.div>
              {/* Photo thumbnails row */}
              <div className="mt-2 grid grid-cols-4 gap-2">
                {photos.map((p, i) => (
                  <button key={p.id} onClick={() => setPhotoIndex(i)}
                    className={`aspect-[4/3] rounded-md border flex items-center justify-center transition-all ${
                      i === photoIndex ? 'border-accent-blue bg-accent-blue/10' : 'border-navy-700 bg-navy-800/60 hover:border-navy-600'
                    }`}>
                    <Camera size={14} className={i === photoIndex ? 'text-accent-blue' : 'text-navy-500'} />
                  </button>
                ))}
              </div>
            </div>

            {/* RIGHT column — Defects (3/5 on desktop, stacked on mobile) */}
            <div className="lg:col-span-3">
            {defects.length > 0 ? (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-navy-300 mb-3">
                  <AlertTriangle size={13} className="text-accent-orange" /> Accumulated Defects ({defects.length})
                </div>
                <div className="space-y-3">
                  {Object.entries(defectsBySection).map(([section, list]) => (
                    <div key={section}>
                      <div className="text-[10px] font-semibold text-navy-500 uppercase tracking-wide mb-1.5">{section}</div>
                      <div className="space-y-1.5">
                        {list.map((d) => {
                          const action = defectActions[d.id];
                          const currentStatus = action || d.status;
                          const statusConf = DEFECT_STATUS_CONFIG[currentStatus];
                          return (
                            <div key={d.id} className="rounded-lg bg-navy-800/40 border border-navy-700/40 p-3">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                    <span className="text-sm font-semibold text-white">{d.part}</span>
                                    <Badge variant={SEVERITY_BADGE[d.severity]}>{d.severity}</Badge>
                                    {d.hasPhoto && <Camera size={11} className="text-navy-400" />}
                                  </div>
                                  <p className="text-xs text-navy-300 mb-1">{d.description}</p>
                                  <p className="text-[10px] text-navy-500">{d.reportedAt}</p>
                                </div>
                                {statusConf && <Badge variant={statusConf.variant} size="md">{statusConf.label}</Badge>}
                              </div>
                              {canTakeActions && currentStatus === 'pending' && (
                                <div className="pt-2 border-t border-navy-700/40 space-y-2">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => handleCancel(d)}
                                      className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-accent-red text-[11px] font-semibold hover:bg-accent-red/20 cursor-pointer"
                                      title="Dismiss this defect"
                                    >
                                      <X size={11} /> Cancel
                                    </button>
                                    <button
                                      onClick={() => handleApprove(d)}
                                      className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-md bg-accent-green text-white text-[11px] font-semibold hover:opacity-90 cursor-pointer shadow-lg shadow-accent-green/20"
                                      title="Approve and create a work order"
                                    >
                                      <Check size={11} /> Approve
                                    </button>
                                  </div>
                                  <label className="flex items-center gap-1.5 text-[11px] text-navy-400 cursor-pointer select-none">
                                    <input type="checkbox"
                                      checked={!!autoApproveSimilar[d.id]}
                                      onChange={() => toggleAutoApprove(d.id)}
                                      className="w-3.5 h-3.5 cursor-pointer" />
                                    Auto-approve similar defects
                                    <span className="text-navy-500">({d.part})</span>
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-accent-green/30 bg-accent-green/5 p-6 text-center">
                <CheckCircle2 size={32} className="text-accent-green mx-auto mb-2" />
                <h4 className="text-sm font-semibold text-white mb-1">No Active Defects</h4>
                <p className="text-xs text-navy-400">Vehicle passed its most recent inspection.</p>
              </div>
            )}
            </div> {/* /right column */}
            </div> {/* /inner grid */}
          </div> {/* /body */}

          {/* Footer — Create Work Order is the single primary action */}
          {canTakeActions && !van.grounded && (
            <div className="px-4 sm:px-6 lg:px-8 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80 backdrop-blur">
              <div className="max-w-6xl mx-auto flex items-center gap-2">
                <button
                  onClick={() => onCreateWO?.(van, null)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-accent-blue to-accent-purple text-white text-sm font-semibold hover:opacity-90 cursor-pointer"
                >
                  <ClipboardList size={14} /> Create Work Order
                </button>
              </div>
            </div>
          )}
          {van.grounded && (
            <div className="px-4 sm:px-6 lg:px-8 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
              <div className="max-w-6xl mx-auto flex items-center justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Close</button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </>
  );
}

// ---------- Create Work Order Modal ----------
const INSPECTION_SECTIONS = [
  { id: '1. Front Side', label: '1. Front Side' },
  { id: '2. Driver Side', label: '2. Driver Side' },
  { id: '3. Passenger Side', label: '3. Passenger Side' },
  { id: '4. Back Side', label: '4. Back Side' },
  { id: '5. In-Cab', label: '5. In-Cab' },
];

const WO_SEVERITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'];
const WO_SEVERITY_COLORS = { Low: 'blue', Medium: 'gold', High: 'orange', Critical: 'red' };

function VendorCard({ vendor, selected, onSelect, neededServices }) {
  const matchedServices = neededServices?.length > 0
    ? vendor.services.filter((s) => neededServices.includes(s))
    : vendor.services;
  const hasMatch = matchedServices.length > 0 || !neededServices || neededServices.length === 0;

  return (
    <button onClick={() => onSelect(vendor)}
      className={`w-full text-left p-3 sm:p-4 rounded-xl border-2 transition-all cursor-pointer ${
        selected
          ? 'border-accent-blue/50 bg-accent-blue/5'
          : hasMatch
            ? 'border-navy-700 bg-navy-800/30 hover:border-navy-600'
            : 'border-navy-700/40 bg-navy-800/20 opacity-60 hover:opacity-80'
      }`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{vendor.name}</span>
            {vendor.preferred && <Badge variant="gold"><Star size={9} className="inline fill-current mr-0.5" /> Preferred</Badge>}
            <div className="flex items-center gap-0.5 text-[11px]">
              <Star size={10} className="text-accent-gold fill-accent-gold" />
              <span className="text-white font-semibold">{vendor.rating}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-navy-400 flex-wrap">
            <span className="flex items-center gap-1"><MapPin size={10} /> {vendor.city}</span>
            <span className="text-navy-600">·</span>
            <span>{vendor.distance}</span>
            <span className="text-navy-600">·</span>
            <span className="flex items-center gap-1"><Clock size={10} /> {vendor.responseTime}</span>
          </div>
        </div>
        {selected && (
          <div className="w-6 h-6 rounded-full bg-accent-blue flex items-center justify-center shrink-0">
            <Check size={14} className="text-white" />
          </div>
        )}
      </div>
      {/* Services with match highlight */}
      <div className="flex flex-wrap gap-1 mt-2">
        {vendor.services.slice(0, 6).map((s) => {
          const matched = neededServices?.includes(s);
          return (
            <span key={s} className={`text-[10px] px-1.5 py-0.5 rounded border ${
              matched
                ? 'bg-accent-green/15 border-accent-green/40 text-accent-green font-semibold'
                : 'bg-navy-800 border-navy-700 text-navy-400'
            }`}>
              {matched && <Check size={8} className="inline mr-0.5" />}
              {s}
            </span>
          );
        })}
      </div>
      <div className="mt-2 pt-2 border-t border-navy-700/40 flex items-center justify-between text-[10px] text-navy-400">
        <span>{vendor.activeJobs} active jobs</span>
        {hasMatch && matchedServices.length > 0 && (
          <span className="text-accent-green font-semibold">{matchedServices.length} matching service{matchedServices.length > 1 ? 's' : ''}</span>
        )}
      </div>
    </button>
  );
}

export function CreateWorkOrderModal({ initialVan, initialDefect, vans, user, onClose, onCreate }) {
  const [step, setStep] = useState(initialVan ? 2 : 1);
  // Step 1: vehicle + defect
  const [van, setVan] = useState(initialVan || null);
  const [vanDropdownOpen, setVanDropdownOpen] = useState(false);
  const [section, setSection] = useState(initialDefect?.section || '');
  const [part, setPart] = useState(initialDefect?.part || '');
  const [description, setDescription] = useState(initialDefect?.description || '');
  const [severity, setSeverity] = useState(initialDefect?.severity || 'Medium');
  const [isRush, setIsRush] = useState(initialDefect?.severity === 'Critical');
  const [damagePhotos, setDamagePhotos] = useState([]);
  const [isPM, setIsPM] = useState(false);
  const [pmType, setPmType] = useState('Oil Change');
  // Step 2: vendor
  const [vendor, setVendor] = useState(null);
  // Step 3: review
  const [preferredDate, setPreferredDate] = useState('');
  const [extraNotes, setExtraNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdWoId, setCreatedWoId] = useState('');

  // Services needed for this section
  const neededServices = section ? (SECTION_TO_SERVICES[section] || []) : [];
  // Sort vendors: preferred first, then by matching services + rating
  const sortedVendors = [...availableVendors].sort((a, b) => {
    const aMatch = neededServices.length ? a.services.filter((s) => neededServices.includes(s)).length : 0;
    const bMatch = neededServices.length ? b.services.filter((s) => neededServices.includes(s)).length : 0;
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return b.rating - a.rating;
  });

  // Step 1 validity: defect mode needs section + description; PM mode only needs vehicle + PM type
  const canGoNext = step === 1
    ? (van && (isPM ? !!pmType : (section && description.length > 4)))
    : step === 2 ? !!vendor : true;

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      const woId = `WO-${Math.floor(55000 + Math.random() * 1000)}`;
      setCreatedWoId(woId);
      onCreate?.({
        id: woId,
        van,
        section,
        part,
        description,
        severity,
        isRush,
        vendor,
        preferredDate,
        extraNotes,
        createdBy: user?.name,
      });
      setSubmitting(false);
      setSuccess(true);
    }, 1100);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-navy-950 z-[60] flex flex-col overflow-hidden">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full h-full flex flex-col">

        {/* Header — sticky full-width */}
        <div className="px-4 sm:px-6 lg:px-8 py-4 border-b border-navy-800 bg-navy-900/80 backdrop-blur">
          <div className="max-w-6xl mx-auto flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="text-navy-300 hover:text-white p-2 -ml-2 rounded-md hover:bg-navy-800 cursor-pointer" title="Back">
                <ArrowRight size={18} className="rotate-180" />
              </button>
              <div className="w-10 h-10 rounded-lg bg-accent-blue/15 border border-accent-blue/40 flex items-center justify-center shrink-0">
                <ClipboardList size={18} className="text-accent-blue" />
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-semibold text-white">Create Work Order</h3>
                <p className="text-[11px] text-navy-400">Send repair work to your chosen vendor</p>
              </div>
            </div>
            <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2 shrink-0 rounded-md hover:bg-navy-800" title="Close"><X size={20} /></button>
          </div>
        </div>

        {/* Progress */}
        {!success && (
          <div className="px-4 sm:px-6 lg:px-8 pt-4 border-b border-navy-800/60 pb-4">
            <div className="max-w-6xl mx-auto">
              <div className="flex items-center gap-2 mb-3">
                {[1, 2, 3].map((s) => (
                  <div key={s} className="flex-1 h-1 rounded-full bg-navy-800 overflow-hidden">
                    <motion.div className="h-full bg-gradient-to-r from-accent-blue to-accent-purple"
                      initial={false} animate={{ width: step >= s ? '100%' : '0%' }} transition={{ duration: 0.4 }} />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-navy-400">
                <span className={step >= 1 ? 'text-white font-semibold' : ''}>1. Vehicle & Defect</span>
                <span className={step >= 2 ? 'text-white font-semibold' : ''}>2. Choose Vendor</span>
                <span className={step >= 3 ? 'text-white font-semibold' : ''}>3. Review & Send</span>
              </div>
            </div>
          </div>
        )}

        {/* Body — centered content with generous max-width for full-page feel */}
        <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 overflow-y-auto flex-1">
          <div className={step === 2 ? 'max-w-4xl mx-auto' : 'max-w-3xl mx-auto'}>
          <AnimatePresence mode="wait">
            {success ? (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
                  className="w-16 h-16 mx-auto rounded-full bg-accent-green/15 border border-accent-green/40 flex items-center justify-center mb-4">
                  <CheckCircle2 size={32} className="text-accent-green" />
                </motion.div>
                <h4 className="text-lg font-semibold text-white mb-1">Work order sent to {vendor.name}</h4>
                <p className="text-sm text-navy-400 mb-4">
                  {vendor.name} has been notified and will see this in their Work Orders hub.
                  You'll receive an update when they accept, decline or complete.
                </p>
                <div className="inline-flex flex-col gap-1 px-4 py-3 rounded-lg bg-navy-800/60 border border-navy-700/40 text-left">
                  <div className="text-[11px] text-navy-400">Work Order ID</div>
                  <div className="text-sm font-mono text-accent-blue">{createdWoId}</div>
                  <div className="text-[11px] text-navy-400 mt-1">Vehicle: <span className="text-white">{van?.id}</span> · Vendor: <span className="text-white">{vendor?.name}</span></div>
                  {isRush && <div className="text-[11px] text-accent-red mt-1 flex items-center gap-1"><Flame size={10} /> Rush Order — scheduled tonight</div>}
                </div>
              </motion.div>
            ) : step === 1 ? (
              <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                {/* Vehicle selection */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Vehicle</label>
                  <div className="relative">
                    <button onClick={() => setVanDropdownOpen(!vanDropdownOpen)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-navy-700 bg-navy-800/50 text-left hover:border-navy-600 cursor-pointer min-h-[52px]">
                      {van ? (
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{van.id} <span className="text-navy-400 font-normal">— {van.model}</span></div>
                          <div className="text-[11px] text-navy-400 truncate">{van.plate} · {van.mileage?.toLocaleString()} mi</div>
                        </div>
                      ) : (
                        <span className="text-sm text-navy-400">Select a vehicle…</span>
                      )}
                      <ChevronDown size={16} className={`text-navy-400 shrink-0 ml-2 transition-transform ${vanDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {vanDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setVanDropdownOpen(false)} />
                        <div className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-20">
                          {vans.map((v) => (
                            <button key={v.id} onClick={() => { setVan(v); setVanDropdownOpen(false); }}
                              className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-navy-800 transition-colors border-b border-navy-800/60 last:border-b-0 min-h-[56px] ${
                                van?.id === v.id ? 'bg-navy-800' : ''
                              }`}>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-white truncate">{v.id} <span className="text-navy-400 font-normal">— {v.model}</span></div>
                                <div className="text-[11px] text-navy-400 truncate">{v.plate} · {v.defectCount} defect{v.defectCount !== 1 ? 's' : ''}</div>
                              </div>
                              {van?.id === v.id && <Check size={14} className="text-accent-green shrink-0" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Mode toggle — defect vs scheduled PM */}
                <div className="flex items-center gap-2 p-1 rounded-lg bg-navy-800/60 border border-navy-700/40 w-fit">
                  <button onClick={() => setIsPM(false)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      !isPM ? 'bg-accent-blue text-white' : 'text-navy-400 hover:text-white'
                    }`}>
                    <AlertTriangle size={11} /> Defect repair
                  </button>
                  <button onClick={() => setIsPM(true)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      isPM ? 'bg-accent-green text-white' : 'text-navy-400 hover:text-white'
                    }`}>
                    <Plus size={11} /> Schedule PM
                  </button>
                </div>

                {/* PM mode: show PM type selector instead of Section */}
                {isPM ? (
                  <div>
                    <label className="text-xs font-semibold text-navy-300 mb-1.5 block">PM service type</label>
                    <select value={pmType} onChange={(e) => setPmType(e.target.value)}
                      className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green cursor-pointer">
                      <option>Oil Change</option>
                      <option>Tire Rotation</option>
                      <option>Brake Inspection</option>
                      <option>Full Service</option>
                      <option>Alignment</option>
                      <option>Coolant Flush</option>
                      <option>Transmission Service</option>
                      <option>Cabin Air Filter</option>
                      <option>Other PM</option>
                    </select>
                    <p className="text-[10px] text-navy-400 mt-1">No inspection required — scheduled preventive maintenance.</p>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Vehicle section</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {INSPECTION_SECTIONS.map((s) => (
                        <button key={s.id} onClick={() => setSection(s.id)}
                          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer min-h-[44px] ${
                            section === s.id ? 'bg-accent-blue/15 border-accent-blue/50 text-white' : 'bg-navy-800 border-navy-700 text-navy-300 hover:border-navy-600'
                          }`}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Part */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Part (optional)</label>
                  <input value={part} onChange={(e) => setPart(e.target.value)}
                    placeholder={isPM ? 'e.g. Oil filter, Brake pads' : 'e.g. Windshield, Brake pads, Headlight'}
                    className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Description{isPM ? ' (optional)' : ''}</label>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                    placeholder={isPM ? 'e.g. Routine 5,000 mi synthetic oil change' : 'e.g. Crack in windshield spreading from stone chip — driver side, approximately 8 inches'}
                    className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue resize-none" />
                </div>

                {/* Damage photos — shown for defect repair mode */}
                {!isPM && (
                  <div>
                    <label className="text-xs font-semibold text-navy-300 mb-1.5 block flex items-center gap-1.5">
                      <ImageIcon size={12} className="text-accent-blue" /> Damage Photos
                    </label>
                    <label className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all hover:bg-navy-800/40 ${
                      damagePhotos.length > 0 ? 'border-accent-blue/50 bg-accent-blue/5' : 'border-navy-700/60 bg-navy-800/20'
                    }`}>
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-accent-blue/15 flex items-center justify-center shrink-0">
                          <Camera size={18} className="text-accent-blue" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-white">Damage Photos</div>
                          <div className="text-[11px] text-navy-400">JPG/PNG &mdash; wide shot + close-ups recommended</div>
                          <div className="text-[11px] text-navy-500 mt-1">Click to browse or drop multiple files</div>
                        </div>
                        <Send size={14} className="text-navy-400 mt-1 rotate-180" />
                      </div>
                      <input type="file" accept="image/*" multiple className="hidden"
                        onChange={(e) => {
                          if (e.target.files) {
                            const arr = Array.from(e.target.files).map((f) => ({ name: f.name, size: f.size }));
                            setDamagePhotos([...damagePhotos, ...arr]);
                          }
                        }} />
                    </label>
                    {damagePhotos.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {damagePhotos.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-navy-800/60 border border-navy-700/40">
                            <Check size={12} className="text-accent-blue shrink-0" />
                            <span className="text-xs text-white truncate flex-1">{f.name}</span>
                            <span className="text-[10px] text-navy-400">{(f.size / 1024).toFixed(0)} KB</span>
                            <button onClick={(e) => { e.preventDefault(); setDamagePhotos(damagePhotos.filter((_, j) => j !== i)); }}
                              className="text-navy-400 hover:text-accent-red">
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Severity — hidden for PM mode */}
                {!isPM && (
                  <div>
                    <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Severity</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {WO_SEVERITY_OPTIONS.map((s) => {
                        const active = severity === s;
                        const color = WO_SEVERITY_COLORS[s];
                        return (
                          <button key={s} onClick={() => { setSeverity(s); if (s === 'Critical') setIsRush(true); }}
                            className={`px-2 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer min-h-[44px] ${
                              active
                                ? `bg-accent-${color}/20 border-accent-${color}/50 text-accent-${color}`
                                : 'bg-navy-800 border-navy-700 text-navy-300 hover:border-navy-600'
                            }`}>{s}</button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Rush order toggle — hidden for PM mode */}
                {!isPM && (
                  <label className="flex items-start gap-3 p-3 rounded-lg bg-navy-800/40 border border-navy-700/40 cursor-pointer hover:border-navy-600">
                    <input type="checkbox" checked={isRush} onChange={() => setIsRush(!isRush)} className="mt-0.5 w-5 h-5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5"><Flame size={12} className="text-accent-red" /><span className="text-sm font-semibold text-white">Mark as Rush Order</span></div>
                      <div className="text-[11px] text-navy-400">Vendor is asked to schedule this tonight. Expect a priority fee.</div>
                    </div>
                  </label>
                )}

                {/* PM scheduled date — only in PM mode */}
                {isPM && (
                  <div>
                    <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Scheduled date</label>
                    <input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)}
                      className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green" />
                  </div>
                )}
              </motion.div>
            ) : step === 2 ? (
              <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-navy-400 mb-2 flex-wrap">
                  <span>Choose a vendor to process this work order</span>
                  {neededServices.length > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent-green/10 border border-accent-green/30 text-accent-green">
                      <Zap size={10} /> Services needed: {neededServices.join(', ')}
                    </span>
                  )}
                </div>
                {sortedVendors.map((v) => (
                  <VendorCard key={v.id} vendor={v} selected={vendor?.id === v.id} onSelect={setVendor} neededServices={neededServices} />
                ))}
              </motion.div>
            ) : (
              <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="text-xs text-navy-400">Review your work order before sending.</div>

                {/* Vehicle + defect summary */}
                <div className="rounded-xl border border-navy-700/60 bg-navy-800/40 p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Truck size={14} className="text-accent-green" />
                    <span className="text-sm font-semibold text-white">{van?.id} · {van?.model}</span>
                  </div>
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400">Plate</span><span className="text-white font-mono">{van?.plate}</span></div>
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400">Section</span><span className="text-white">{section}</span></div>
                  {part && <div className="flex justify-between text-sm gap-3"><span className="text-navy-400">Part</span><span className="text-white">{part}</span></div>}
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400">Severity</span><Badge variant={WO_SEVERITY_COLORS[severity]} size="md">{severity}</Badge></div>
                  {isRush && <div className="flex justify-between text-sm gap-3"><span className="text-navy-400">Priority</span><Badge variant="red"><Flame size={9} className="inline mr-0.5" /> Rush Order</Badge></div>}
                  <div className="pt-2 border-t border-navy-700/40">
                    <div className="text-[11px] text-navy-400 mb-1">Description</div>
                    <div className="text-sm text-white">{description}</div>
                  </div>
                </div>

                {/* Vendor summary */}
                <div className="rounded-xl border border-accent-blue/40 bg-accent-blue/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Send size={14} className="text-accent-blue" />
                    <span className="text-sm font-semibold text-white">Sending to {vendor?.name}</span>
                    {vendor?.preferred && <Badge variant="gold"><Star size={9} className="inline fill-current mr-0.5" /> Preferred</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-navy-300 flex-wrap">
                    <span className="flex items-center gap-1"><Star size={10} className="text-accent-gold fill-accent-gold" /> {vendor?.rating}</span>
                    <span className="text-navy-600">·</span>
                    <span className="flex items-center gap-1"><MapPin size={10} /> {vendor?.city}</span>
                    <span className="text-navy-600">·</span>
                    <span className="flex items-center gap-1"><Clock size={10} /> Response time: {vendor?.responseTime}</span>
                  </div>
                </div>

                {/* Optional extras */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Preferred completion date (optional)</label>
                  <input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)}
                    className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Extra notes for vendor (optional)</label>
                  <textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} rows={2}
                    placeholder="e.g. Van available after 3pm. Gate code 4827. Call Maria if issues: 206-555-0142"
                    className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue resize-none" />
                </div>

                {/* Auto-approval note */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-green/10 border border-accent-green/30 text-xs">
                  <Info size={12} className="text-accent-green mt-0.5 shrink-0" />
                  <div className="text-navy-200">
                    Matches your auto-approval rules for <strong className="text-white">{section}</strong> · <strong className="text-white">{severity}</strong>.
                    This WO will be <strong className="text-accent-green">processed automatically</strong> unless cost exceeds your cap.
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          </div>
        </div>

        {/* Footer — sticky at page bottom */}
        {!success && (
          <div className="px-4 sm:px-6 lg:px-8 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80 backdrop-blur">
            <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
              <button onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                  step === 1
                    ? 'text-accent-red border border-accent-red/40 bg-accent-red/10 hover:bg-accent-red/20'
                    : 'text-navy-300 hover:text-white hover:bg-navy-800'
                }`}>
                {step === 1 ? <><X size={12} className="inline mr-1" /> Reject</> : 'Back'}
              </button>
              {step < 3 ? (
                <button onClick={() => setStep(step + 1)} disabled={!canGoNext}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-blue to-accent-purple text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                  Next <ArrowRight size={14} />
                </button>
              ) : (
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-blue to-accent-purple text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                  {submitting ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> Sending…</>) : (<>Send to Vendor <Send size={14} /></>)}
                </button>
              )}
            </div>
          </div>
        )}
        {success && (
          <div className="flex items-center justify-end px-4 sm:px-6 lg:px-8 py-3 sm:py-4 border-t border-navy-800">
            <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 cursor-pointer">Done</button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ---------- Main Component ----------
export default function FleetSnapshot({ user, embedded = false }) {
  const [selectedVan, setSelectedVan] = useState(null);
  const [showFlexFleet, setShowFlexFleet] = useState(false);
  const [showCreateWO, setShowCreateWO] = useState(false);
  const [createWOContext, setCreateWOContext] = useState({ van: null, defect: null });
  const [includeCustom, setIncludeCustom] = useState(true);
  const [includeBody, setIncludeBody] = useState(true);
  const [dspFilter, setDspFilter] = useState('all');
  const [dspFilterOpen, setDspFilterOpen] = useState(false);
  const [vanUpdates, setVanUpdates] = useState({});

  const openCreateWO = (van = null, defect = null) => {
    setCreateWOContext({ van, defect });
    setShowCreateWO(true);
  };

  // Apply per-van updates (ground state etc.)
  const allVans = useMemo(() => {
    return fleetSnapshotVans.map((v) => ({ ...v, ...(vanUpdates[v.id] || {}) }));
  }, [vanUpdates]);

  // DSP users only see their own flota; vendors see all
  const isDsp = user?.role === 'dsp_owner';
  const userDspId = user?.orgId;

  const vans = useMemo(() => {
    if (isDsp && userDspId && userDspId.startsWith('DSP-')) {
      return allVans.filter((v) => v.dspId === userDspId);
    }
    if (dspFilter !== 'all') return allVans.filter((v) => v.dspId === dspFilter);
    return allVans;
  }, [allVans, isDsp, userDspId, dspFilter]);

  // Group by DSP for vendor view
  const vansByDsp = useMemo(() => {
    const map = new Map();
    vans.forEach((v) => {
      if (!map.has(v.dspId)) map.set(v.dspId, { dspId: v.dspId, dspName: v.dsp, vans: [] });
      map.get(v.dspId).vans.push(v);
    });
    return Array.from(map.values());
  }, [vans]);

  // Stats
  const stats = useMemo(() => {
    const total = vans.length;
    const critical = vans.filter((v) => v.severity === 'critical').length;
    const withIssues = vans.filter((v) => v.defectCount > 0).length;
    const grounded = vans.filter((v) => v.grounded).length;
    const keysRecorded = total - grounded; // roughly
    return { total, critical, withIssues, grounded, keysRecorded };
  }, [vans]);

  const uniqueDsps = useMemo(() => {
    const dsps = new Map();
    fleetSnapshotVans.forEach((v) => {
      if (!dsps.has(v.dspId)) dsps.set(v.dspId, { id: v.dspId, name: v.dsp });
    });
    return Array.from(dsps.values());
  }, []);

  const handleUpdateVan = (vanId, updates) => {
    setVanUpdates({ ...vanUpdates, [vanId]: { ...(vanUpdates[vanId] || {}), ...updates } });
  };

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div>
      {/* Header — hidden when embedded (Real DVIC renders its own header) */}
      {!embedded && (
        <div className="mb-4 sm:mb-6">
          <h2 className="text-2xl font-bold text-white mb-1">QC DVIC</h2>
          <p className="text-navy-400 text-sm">Heatmap view &mdash; defect severity at a glance, per vehicle</p>
        </div>
      )}

      {/* Summary card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-navy-900/80 to-navy-900/40 border border-navy-700/40 rounded-xl p-4 sm:p-5 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-accent-blue/15 border border-accent-blue/30 flex items-center justify-center shrink-0">
              <KeyRound size={18} className="text-accent-blue" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">
                <span className="text-accent-blue">{stats.keysRecorded}</span> keys recorded &middot; {dateStr}, {timeStr}
              </div>
              <div className="text-xs text-navy-400">
                <span className="text-white font-medium">{stats.total}</span> vehicles
                {stats.withIssues > 0 && (<>&nbsp;·&nbsp;<span className="text-accent-orange font-medium">{stats.withIssues}</span> with issues</>)}
                {stats.critical > 0 && (<>&nbsp;·&nbsp;<span className="text-accent-red font-medium">{stats.critical}</span> critical</>)}
                {stats.grounded > 0 && (<>&nbsp;·&nbsp;<span className="text-accent-red font-medium">{stats.grounded}</span> grounded</>)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter toggles */}
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-navy-700 bg-navy-800/40 cursor-pointer text-xs text-navy-300">
              <input type="checkbox" checked={includeCustom} onChange={() => setIncludeCustom(!includeCustom)} className="rounded" />
              Custom Defects
            </label>
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-navy-700 bg-navy-800/40 cursor-pointer text-xs text-navy-300">
              <input type="checkbox" checked={includeBody} onChange={() => setIncludeBody(!includeBody)} className="rounded" />
              Body Defects
            </label>

            {/* DSP filter (only for non-DSP users) */}
            {!isDsp && (
              <div className="relative">
                <button onClick={() => setDspFilterOpen(!dspFilterOpen)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-navy-700 bg-navy-800/40 text-xs text-navy-300 hover:text-white cursor-pointer">
                  <Filter size={12} />
                  {dspFilter === 'all' ? 'All DSPs' : uniqueDsps.find((d) => d.id === dspFilter)?.name}
                  <ChevronDown size={11} />
                </button>
                {dspFilterOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setDspFilterOpen(false)} />
                    <div className="absolute top-full right-0 mt-1 w-56 bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-20 overflow-hidden">
                      <button onClick={() => { setDspFilter('all'); setDspFilterOpen(false); }}
                        className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-white hover:bg-navy-800 border-b border-navy-800">
                        All DSPs {dspFilter === 'all' && <Check size={12} className="text-accent-green" />}
                      </button>
                      {uniqueDsps.map((d) => (
                        <button key={d.id} onClick={() => { setDspFilter(d.id); setDspFilterOpen(false); }}
                          className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-white hover:bg-navy-800 border-b border-navy-800/60 last:border-b-0">
                          {d.name} {dspFilter === d.id && <Check size={12} className="text-accent-green" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Create WO — DSP can send repair work to any vendor */}
            {isDsp && (
              <button onClick={() => openCreateWO()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-blue text-white text-xs font-semibold hover:opacity-90 cursor-pointer shadow-lg shadow-accent-blue/20">
                <ClipboardList size={12} /> Create Work Order
              </button>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 pt-3 border-t border-navy-800/60">
          <SeverityLegend />
        </div>
      </motion.div>

      {/* Heatmap grid(s) */}
      {isDsp ? (
        /* DSP sees only their flota — single grid */
        <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-3 sm:p-4">
          <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5 sm:gap-2">
            {vans.map((van) => (
              <HeatmapTile key={van.id} van={van} onClick={setSelectedVan} />
            ))}
          </div>
        </div>
      ) : (
        /* Vendor sees grouped by DSP */
        <div className="space-y-4">
          {vansByDsp.map((group) => {
            const groupCritical = group.vans.filter((v) => v.severity === 'critical').length;
            const groupIssues = group.vans.filter((v) => v.defectCount > 0).length;
            return (
              <motion.div key={group.dspId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-3 sm:p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Users size={14} className="text-accent-blue shrink-0" />
                    <h3 className="text-sm font-semibold text-white truncate">{group.dspName}</h3>
                    <Badge variant="gray" size="md">{group.vans.length} vans</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    {groupCritical > 0 && <span className="text-accent-red font-semibold">{groupCritical} critical</span>}
                    {groupIssues > 0 && groupCritical !== groupIssues && <span className="text-accent-orange">{groupIssues} with issues</span>}
                    {groupIssues === 0 && <span className="text-accent-green">All clean</span>}
                  </div>
                </div>
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5 sm:gap-2">
                  {group.vans.map((van) => (
                    <HeatmapTile key={van.id} van={van} onClick={setSelectedVan} />
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {selectedVan && (
          <VehicleReportCard
            van={selectedVan}
            onClose={() => setSelectedVan(null)}
            onUpdateVan={handleUpdateVan}
            userRole={user?.role}
            onCreateWO={(van, defect) => { setSelectedVan(null); openCreateWO(van, defect); }}
          />
        )}
        {showFlexFleet && <FlexFleetModal onClose={() => setShowFlexFleet(false)} />}
        {showCreateWO && (
          <CreateWorkOrderModal
            initialVan={createWOContext.van}
            initialDefect={createWOContext.defect}
            vans={vans}
            user={user}
            onClose={() => { setShowCreateWO(false); setCreateWOContext({ van: null, defect: null }); }}
            onCreate={(wo) => { /* in a real app this would POST to /api/work-orders */ }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
