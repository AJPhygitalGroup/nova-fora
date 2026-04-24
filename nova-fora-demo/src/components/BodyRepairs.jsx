import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench, Camera, Scan, Users, DollarSign, TrendingDown, ArrowRight, AlertTriangle, Layers, Zap, Eye, Plus, X, Upload, FileText, Video, Check, ChevronDown, Image as ImageIcon, CheckCircle2 } from 'lucide-react';
import { bodyRepairOrders, groupDiscountTiers, dspList } from '../data/mockData';
import MetricCard from './ui/MetricCard';
import Badge from './ui/Badge';

const statusColors = {
  'Estimate Ready': 'blue',
  'In Repair': 'orange',
  'Pending Approval': 'gold',
  'Completed': 'green',
};

const severityIcons = {
  Minor: { color: 'text-accent-blue', bg: 'bg-accent-blue/10' },
  Moderate: { color: 'text-accent-gold', bg: 'bg-accent-gold/10' },
  Major: { color: 'text-accent-orange', bg: 'bg-accent-orange/10' },
  Severe: { color: 'text-accent-red', bg: 'bg-accent-red/10' },
};

function PaveScoreIndicator({ score }) {
  const color = score >= 80 ? '#ef4444' : score >= 50 ? '#f59e0b' : '#22c55e';
  const label = score >= 80 ? 'Critical' : score >= 50 ? 'Moderate' : 'Minor';
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 rounded-full bg-navy-700 overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ background: color }}
          initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{score}</span>
      <span className="text-[10px] text-navy-400">{label}</span>
    </div>
  );
}

function RepairDetailModal({ order, onClose }) {
  const pooledDspNames = order.pooledDsps.map((id) => dspList.find((d) => d.id === id)?.name || id);
  const savingsAmount = Math.round(order.paveEstimate * (order.groupDiscount / 100));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="bg-navy-900 border border-navy-700 rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{order.id}</h3>
          <Badge variant={statusColors[order.status]} size="md">{order.status}</Badge>
        </div>
        <div className="bg-gradient-to-r from-accent-purple/10 to-accent-blue/10 border border-accent-purple/20 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Scan size={16} className="text-accent-purple" />
            <span className="text-sm font-semibold text-white">Pave AI Analysis</span>
            <Badge variant="purple">Powered by Pave</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <div className="text-[10px] text-navy-400">Damage Score</div>
              <PaveScoreIndicator score={order.paveScore} />
            </div>
            <div>
              <div className="text-[10px] text-navy-400">Photos Analyzed</div>
              <div className="text-sm font-semibold text-white">{order.photos} images</div>
            </div>
          </div>
          <div className="text-xs text-navy-300">{order.damage}</div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-xs text-navy-400 mb-1">Vehicle</div>
            <div className="text-sm font-semibold text-white">{order.van}</div>
          </div>
          <div>
            <div className="text-xs text-navy-400 mb-1">DSP</div>
            <div className="text-sm font-semibold text-white">{dspList.find((d) => d.id === order.dsp)?.name}</div>
          </div>
        </div>
        <div className="bg-navy-800/50 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Users size={16} className="text-accent-green" />
            <span className="text-sm font-semibold text-white">Group Discount Pool</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {pooledDspNames.map((name) => <Badge key={name} variant="blue">{name}</Badge>)}
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] text-navy-400">Estimate</div>
              <div className="text-sm font-bold text-white">${order.paveEstimate.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] text-navy-400">Group Discount</div>
              <div className="text-sm font-bold text-accent-green">{order.groupDiscount}%</div>
            </div>
            <div>
              <div className="text-[10px] text-navy-400">You Save</div>
              <div className="text-sm font-bold text-accent-gold">${savingsAmount}</div>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="w-full py-2.5 rounded-lg border border-navy-600 text-navy-300 text-sm font-medium hover:bg-navy-800 transition-colors cursor-pointer">Close</button>
      </motion.div>
    </motion.div>
  );
}

// ---------------- Start a Quote Modal ----------------
const AVAILABLE_VANS = [
  { id: 'VAN-1042', model: '2022 Ford Transit 250', dsp: 'Pacific Northwest Logistics', plate: 'WA-8F42-AZ' },
  { id: 'VAN-1018', model: '2021 Mercedes Sprinter', dsp: 'Pacific Northwest Logistics', plate: 'WA-3K18-AZ' },
  { id: 'VAN-2009', model: '2022 Ford Transit 250', dsp: 'Emerald City Delivery', plate: 'WA-2P09-AZ' },
  { id: 'VAN-2015', model: '2023 Ram ProMaster 2500', dsp: 'Emerald City Delivery', plate: 'WA-2G15-AZ' },
  { id: 'VAN-3021', model: '2022 Ford Transit 350', dsp: 'Cascade Fleet Partners', plate: 'WA-5H21-AZ' },
  { id: 'VAN-3044', model: '2023 Mercedes Sprinter', dsp: 'Cascade Fleet Partners', plate: 'WA-6M44-AZ' },
  { id: 'VAN-4005', model: '2021 Ford Transit 250', dsp: 'Summit Express Delivery', plate: 'WA-4B05-AZ' },
  { id: 'VAN-5008', model: '2022 Ram ProMaster 1500', dsp: 'Redmond Route Masters', plate: 'WA-7R08-AZ' },
  { id: 'VAN-5012', model: '2023 Ford Transit 350', dsp: 'Redmond Route Masters', plate: 'WA-7R12-AZ' },
];

const FILE_PICKER_COLORS = {
  'accent-purple': { bg: 'bg-accent-purple/15', text: 'text-accent-purple', border: 'border-accent-purple/50', tint: 'bg-accent-purple/5' },
  'accent-blue':   { bg: 'bg-accent-blue/15',   text: 'text-accent-blue',   border: 'border-accent-blue/50',   tint: 'bg-accent-blue/5' },
  'accent-green':  { bg: 'bg-accent-green/15',  text: 'text-accent-green',  border: 'border-accent-green/50',  tint: 'bg-accent-green/5' },
};

function FilePicker({ icon: Icon, title, subtitle, accept, multiple, files, onChange, color }) {
  const c = FILE_PICKER_COLORS[color] || FILE_PICKER_COLORS['accent-purple'];
  const inputId = `file-${title.replace(/\s+/g, '-')}`;
  const addFiles = (incoming) => {
    const arr = Array.from(incoming).map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
    }));
    onChange(multiple ? [...files, ...arr] : arr.slice(0, 1));
  };
  const remove = (idx) => onChange(files.filter((_, i) => i !== idx));
  return (
    <div>
      <label
        htmlFor={inputId}
        className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all hover:bg-navy-800/40 ${
          files.length > 0 ? `${c.border} ${c.tint}` : 'border-navy-700/60 bg-navy-800/20'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center shrink-0`}>
            <Icon size={18} className={c.text} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className="text-[11px] text-navy-400">{subtitle}</div>
            <div className="text-[11px] text-navy-500 mt-1">Click to browse {multiple ? 'or drop multiple files' : ''}</div>
          </div>
          <Upload size={14} className="text-navy-400 mt-1" />
        </div>
      </label>
      <input id={inputId} type="file" accept={accept} multiple={multiple} className="hidden"
        onChange={(e) => e.target.files && addFiles(e.target.files)} />
      {files.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-navy-800/60 border border-navy-700/40">
              <Check size={12} className={`${c.text} shrink-0`} />
              <span className="text-xs text-white truncate flex-1">{f.name}</span>
              <span className="text-[10px] text-navy-400">{(f.size / 1024).toFixed(0)} KB</span>
              <button onClick={(e) => { e.preventDefault(); remove(i); }} className="text-navy-400 hover:text-accent-red">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StartQuoteModal({ onClose, onSubmit }) {
  const [step, setStep] = useState(1);
  const [van, setVan] = useState(null);
  const [vanDropdownOpen, setVanDropdownOpen] = useState(false);
  const [damageDesc, setDamageDesc] = useState('');
  const [severity, setSeverity] = useState('Moderate');
  const [paveReport, setPaveReport] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [video, setVideo] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const canGoStep2 = van && damageDesc.trim().length >= 4;
  const canSubmit = photos.length > 0 || paveReport.length > 0 || video.length > 0;

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSuccess(true);
      onSubmit && onSubmit({ van, damageDesc, severity, paveReport, photos, video });
    }, 1400);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.92, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.92, opacity: 0 }}
        className="bg-navy-900 border border-navy-700 rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-purple/15 flex items-center justify-center">
              <Scan size={18} className="text-accent-purple" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Start a Quote</h3>
              <p className="text-[11px] text-navy-400">Pave AI-powered damage assessment</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-1">
            <X size={18} />
          </button>
        </div>

        {/* Progress */}
        {!success && (
          <div className="px-6 pt-4">
            <div className="flex items-center gap-2 mb-3">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex-1 h-1 rounded-full bg-navy-800 overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-accent-purple to-accent-blue"
                    initial={false}
                    animate={{ width: step >= s ? '100%' : '0%' }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-[11px] text-navy-400 mb-2">
              <span className={step >= 1 ? 'text-white font-semibold' : ''}>1. Vehicle & Damage</span>
              <span className={step >= 2 ? 'text-white font-semibold' : ''}>2. Upload Evidence</span>
              <span className={step >= 3 ? 'text-white font-semibold' : ''}>3. Review & Submit</span>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          <AnimatePresence mode="wait">
            {success ? (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                  className="w-16 h-16 mx-auto rounded-full bg-accent-green/15 border border-accent-green/40 flex items-center justify-center mb-4">
                  <CheckCircle2 size={32} className="text-accent-green" />
                </motion.div>
                <h4 className="text-lg font-semibold text-white mb-1">Quote request submitted</h4>
                <p className="text-sm text-navy-400 mb-4">Pave AI is analyzing your uploads. Estimate ready in ~2 minutes.</p>
                <div className="inline-flex flex-col gap-1 px-4 py-3 rounded-lg bg-navy-800/60 border border-navy-700/40 text-left">
                  <div className="text-[11px] text-navy-400">Tracking ID</div>
                  <div className="text-sm font-mono text-accent-blue">BR-{Math.floor(7100 + Math.random() * 900)}</div>
                  <div className="text-[11px] text-navy-400 mt-1">Vehicle: <span className="text-white">{van?.id}</span></div>
                </div>
              </motion.div>
            ) : step === 1 ? (
              <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                {/* Vehicle dropdown */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Vehicle (registered fleet)</label>
                  <div className="relative">
                    <button
                      onClick={() => setVanDropdownOpen((v) => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-navy-700 bg-navy-800/50 text-left hover:border-navy-600 transition-colors cursor-pointer"
                    >
                      {van ? (
                        <div>
                          <div className="text-sm font-semibold text-white">{van.id} <span className="text-navy-400 font-normal">— {van.model}</span></div>
                          <div className="text-[11px] text-navy-400">{van.dsp} · {van.plate}</div>
                        </div>
                      ) : (
                        <span className="text-sm text-navy-400">Select a vehicle…</span>
                      )}
                      <ChevronDown size={16} className={`text-navy-400 transition-transform ${vanDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {vanDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setVanDropdownOpen(false)} />
                        <div className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-20">
                          {AVAILABLE_VANS.map((v) => (
                            <button
                              key={v.id}
                              onClick={() => { setVan(v); setVanDropdownOpen(false); }}
                              className={`w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-navy-800 transition-colors border-b border-navy-800/60 last:border-b-0 ${
                                van?.id === v.id ? 'bg-navy-800' : ''
                              }`}
                            >
                              <div>
                                <div className="text-sm font-semibold text-white">{v.id} <span className="text-navy-400 font-normal">— {v.model}</span></div>
                                <div className="text-[11px] text-navy-400">{v.dsp} · {v.plate}</div>
                              </div>
                              {van?.id === v.id && <Check size={14} className="text-accent-green" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Damage description */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Damage description</label>
                  <textarea
                    value={damageDesc}
                    onChange={(e) => setDamageDesc(e.target.value)}
                    rows={3}
                    placeholder="e.g. Rear quarter panel dent with paint scuffs after backing into loading dock"
                    className="w-full px-4 py-3 rounded-lg border border-navy-700 bg-navy-800/50 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-accent-purple resize-none"
                  />
                </div>

                {/* Severity */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Severity (initial assessment)</label>
                  <div className="grid grid-cols-4 gap-2">
                    {['Minor', 'Moderate', 'Major', 'Severe'].map((s) => (
                      <button key={s} onClick={() => setSeverity(s)}
                        className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                          severity === s
                            ? 'bg-accent-purple/20 border border-accent-purple/50 text-white'
                            : 'bg-navy-800/40 border border-navy-700/50 text-navy-300 hover:border-navy-600'
                        }`}
                      >{s}</button>
                    ))}
                  </div>
                </div>
              </motion.div>
            ) : step === 2 ? (
              <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <div className="text-xs text-navy-400 mb-2">Upload the Pave report, damage photos, and a short video so our AI and vendors can review the scope.</div>
                <FilePicker
                  icon={FileText}
                  title="Pave Report (PDF)"
                  subtitle="Export from the Pave app — optional but speeds up the quote"
                  accept="application/pdf"
                  multiple={false}
                  files={paveReport}
                  onChange={setPaveReport}
                  color="accent-purple"
                />
                <FilePicker
                  icon={ImageIcon}
                  title="Damage Photos"
                  subtitle="JPG/PNG — wide shot + close-ups recommended"
                  accept="image/*"
                  multiple
                  files={photos}
                  onChange={setPhotos}
                  color="accent-blue"
                />
                <FilePicker
                  icon={Video}
                  title="Short Damage Video"
                  subtitle="MP4/MOV — 15-30 seconds walk-around"
                  accept="video/*"
                  multiple={false}
                  files={video}
                  onChange={setVideo}
                  color="accent-green"
                />
              </motion.div>
            ) : (
              <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <div className="text-xs text-navy-400 mb-2">Review the details before submitting for quoting.</div>
                <div className="rounded-xl border border-navy-700/60 bg-navy-800/40 p-4 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-navy-400">Vehicle</span><span className="text-white font-semibold">{van?.id} · {van?.model}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-navy-400">DSP</span><span className="text-white">{van?.dsp}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-navy-400">Severity</span><span className="text-white">{severity}</span></div>
                  <div className="pt-2 border-t border-navy-700/50">
                    <div className="text-[11px] text-navy-400 mb-1">Damage</div>
                    <div className="text-sm text-white">{damageDesc}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-navy-700/60 bg-navy-800/40 p-3 text-center">
                    <FileText size={16} className="mx-auto text-accent-purple mb-1" />
                    <div className="text-[10px] text-navy-400">Pave Report</div>
                    <div className="text-sm font-bold text-white">{paveReport.length}</div>
                  </div>
                  <div className="rounded-lg border border-navy-700/60 bg-navy-800/40 p-3 text-center">
                    <ImageIcon size={16} className="mx-auto text-accent-blue mb-1" />
                    <div className="text-[10px] text-navy-400">Photos</div>
                    <div className="text-sm font-bold text-white">{photos.length}</div>
                  </div>
                  <div className="rounded-lg border border-navy-700/60 bg-navy-800/40 p-3 text-center">
                    <Video size={16} className="mx-auto text-accent-green mb-1" />
                    <div className="text-[10px] text-navy-400">Video</div>
                    <div className="text-sm font-bold text-white">{video.length}</div>
                  </div>
                </div>
                {!canSubmit && (
                  <div className="flex items-center gap-2 text-xs text-accent-orange bg-accent-orange/10 border border-accent-orange/30 rounded-lg px-3 py-2">
                    <AlertTriangle size={12} /> Upload at least one photo, report, or video to submit.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        {!success && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-navy-800 bg-navy-900/60">
            <button
              onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
              className="px-4 py-2 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 transition-colors cursor-pointer"
            >{step === 1 ? 'Cancel' : 'Back'}</button>
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 ? !canGoStep2 : false}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-purple to-accent-blue text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >Next <ArrowRight size={14} /></button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-purple to-accent-blue text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                {submitting ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> Submitting…</>) : (<>Submit Quote <Check size={14} /></>)}
              </button>
            )}
          </div>
        )}
        {success && (
          <div className="flex items-center justify-end px-6 py-4 border-t border-navy-800">
            <button onClick={onClose} className="px-5 py-2 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 cursor-pointer">Done</button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

export default function BodyRepairs() {
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showQuote, setShowQuote] = useState(false);

  const totalEstimate = bodyRepairOrders.reduce((s, o) => s + o.paveEstimate, 0);
  const totalSavings = bodyRepairOrders.reduce((s, o) => s + Math.round(o.paveEstimate * (o.groupDiscount / 100)), 0);
  const dfsSavings = 3600; // Aggregate DFS platform savings
  const avgDiscount = Math.round(bodyRepairOrders.reduce((s, o) => s + o.groupDiscount, 0) / bodyRepairOrders.length);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">Enhanced Body Repairs</h2>
        <p className="text-navy-400 text-sm">Pave AI integration & group discount pooling across DSPs</p>
      </div>

      {/* Row 1: Feature Highlights with action buttons (Discount Tiers embedded in Group card) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-accent-purple/10 to-navy-900 border border-accent-purple/20 rounded-xl p-5 relative"
        >
          <div className="flex items-start justify-between mb-3 gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent-purple/15 flex items-center justify-center">
                <Scan size={20} className="text-accent-purple" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Pave API Integration</h3>
                <p className="text-[11px] text-navy-400">AI-powered damage assessment</p>
              </div>
            </div>
            <button
              onClick={() => setShowQuote(true)}
              className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-purple/15 border border-accent-purple/40 text-accent-purple hover:bg-accent-purple/25 transition-all cursor-pointer"
            >
              <Plus size={16} className="transition-transform group-hover:rotate-90" />
              <span className="text-xs font-semibold">Start a Quote</span>
            </button>
          </div>
          <ul className="space-y-2 text-xs text-navy-300">
            <li className="flex items-start gap-2"><Zap size={12} className="text-accent-purple mt-0.5 shrink-0" /> Instant photo-based damage scoring</li>
            <li className="flex items-start gap-2"><Eye size={12} className="text-accent-purple mt-0.5 shrink-0" /> Identify critical vs cosmetic damage automatically</li>
            <li className="flex items-start gap-2"><DollarSign size={12} className="text-accent-purple mt-0.5 shrink-0" /> Accurate repair estimates in seconds</li>
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-gradient-to-br from-accent-green/10 to-navy-900 border border-accent-green/20 rounded-xl p-5"
        >
          <div className="flex items-start justify-between mb-3 gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent-green/15 flex items-center justify-center">
                <Users size={20} className="text-accent-green" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Group Discount Pooling</h3>
                <p className="text-[11px] text-navy-400">GroupOn-style multi-DSP savings</p>
              </div>
            </div>
            <button className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-green/15 border border-accent-green/40 text-accent-green hover:bg-accent-green/25 transition-all cursor-pointer">
              <Plus size={16} className="transition-transform group-hover:rotate-90" />
              <span className="text-xs font-semibold">Activate Group Quote</span>
            </button>
          </div>
          {/* Discount tiers embedded inline — reduces from 3 rows to 2 */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {groupDiscountTiers.map((tier, i) => (
              <div key={i} className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] ${
                i === 0 ? 'border-navy-700/40 bg-navy-800/40 text-navy-400' : 'border-accent-green/20 bg-accent-green/5 text-accent-green'
              }`}>
                <span className="font-semibold">{tier.discount > 0 ? `${tier.discount}%` : 'Base'}</span>
                <span className="text-navy-400 font-normal">{tier.label.replace(/\(.+/, '').trim()}</span>
              </div>
            ))}
          </div>
          {/* Enrolled customers only notice */}
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-orange/15 border border-accent-orange/40 text-accent-orange text-xs font-semibold">
            <AlertTriangle size={12} />
            Enrolled Customers Only
          </div>
        </motion.div>
      </div>

      {/* Row 2: Metric cards (Photos Analyzed → DFS Savings) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard icon={Wrench} label="Active Orders" value={bodyRepairOrders.length} subtitle="Body repair orders" color="accent-purple" delay={0} />
        <MetricCard icon={DollarSign} label="Total Estimates" value={`$${(totalEstimate / 1000).toFixed(1)}K`} subtitle="Pave AI estimated" color="accent-blue" delay={0.05} />
        <MetricCard icon={TrendingDown} label="Group Savings" value={`$${(totalSavings / 1000).toFixed(1)}K`} subtitle="From pooled discounts" trend={avgDiscount} trendUp color="accent-green" delay={0.1} />
        <MetricCard icon={DollarSign} label="DFS Savings" value={`$${(dfsSavings / 1000).toFixed(1)}K`} subtitle="Platform-wide value" color="accent-gold" delay={0.15} />
      </div>

      {/* Repair Orders Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {bodyRepairOrders.map((order, i) => {
          const sev = severityIcons[order.severity];
          const savings = Math.round(order.paveEstimate * (order.groupDiscount / 100));
          return (
            <motion.div key={order.id}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              onClick={() => setSelectedOrder(order)}
              className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5 hover:border-navy-600/60 transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-accent-blue">{order.id}</span>
                  <Badge variant={statusColors[order.status]}>{order.status}</Badge>
                </div>
                <div className={`w-8 h-8 rounded-lg ${sev.bg} flex items-center justify-center`}>
                  <AlertTriangle size={14} className={sev.color} />
                </div>
              </div>
              <h4 className="text-sm font-semibold text-white mb-1">{order.damage}</h4>
              <div className="flex items-center gap-3 text-xs text-navy-400 mb-3">
                <span>{order.van}</span>
                <span>{dspList.find((d) => d.id === order.dsp)?.code}</span>
                <span className="flex items-center gap-1"><Camera size={10} /> {order.photos} photos</span>
              </div>
              <div className="mb-3">
                <div className="text-[10px] text-navy-400 mb-1 flex items-center gap-1">
                  <Scan size={10} className="text-accent-purple" /> Pave Damage Score
                </div>
                <PaveScoreIndicator score={order.paveScore} />
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-navy-800">
                <div>
                  <div className="text-[10px] text-navy-400">Estimate</div>
                  <div className="text-sm font-bold text-white">${order.paveEstimate.toLocaleString()}</div>
                </div>
                {order.groupDiscount > 0 && (
                  <>
                    <div>
                      <div className="text-[10px] text-navy-400">Pool ({order.pooledDsps.length} DSPs)</div>
                      <div className="text-sm font-bold text-accent-green">-{order.groupDiscount}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-navy-400">You Save</div>
                      <div className="text-sm font-bold text-accent-gold">${savings}</div>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedOrder && <RepairDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
        {showQuote && <StartQuoteModal onClose={() => setShowQuote(false)} />}
      </AnimatePresence>
    </div>
  );
}
