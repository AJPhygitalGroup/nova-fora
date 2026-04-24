import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, Search, Filter, X, Check, CheckCircle2, AlertTriangle, Clock,
  User, Wrench, Camera, FileText, Send, XCircle, PlayCircle, PauseCircle,
  ChevronDown, ChevronUp, MoreVertical, Plus, ArrowRight, Flame, RefreshCw, Hourglass,
  Truck, Building2, MessageSquare, CircleDashed, Briefcase, PackageCheck
} from 'lucide-react';
import { workOrdersData, WO_DECLINE_REASONS, availableTechnicians } from '../data/mockData';
import Badge from './ui/Badge';

// ============================================================
// Status config
// ============================================================
const STATUS_CONFIG = {
  pending:     { label: 'Pending',     variant: 'gold',   icon: Hourglass,     color: 'text-accent-gold',   bg: 'bg-accent-gold/10',   border: 'border-accent-gold/40' },
  pending_fmc: { label: 'Pending FMC', variant: 'purple', icon: Briefcase,     color: 'text-accent-purple', bg: 'bg-accent-purple/10', border: 'border-accent-purple/40' },
  in_progress: { label: 'In Progress', variant: 'blue',   icon: PlayCircle,    color: 'text-accent-blue',   bg: 'bg-accent-blue/10',   border: 'border-accent-blue/40' },
  completed:   { label: 'Completed',   variant: 'green',  icon: CheckCircle2,  color: 'text-accent-green',  bg: 'bg-accent-green/10',  border: 'border-accent-green/40' },
  declined:    { label: 'Declined',    variant: 'red',    icon: XCircle,       color: 'text-accent-red',    bg: 'bg-accent-red/10',    border: 'border-accent-red/40' },
  canceled:    { label: 'Canceled',    variant: 'gray',   icon: CircleDashed,  color: 'text-navy-400',      bg: 'bg-navy-800',         border: 'border-navy-700' },
};

const FLAG_CONFIG = {
  rush_order:     { label: 'Rush Order',     variant: 'red',    icon: Flame },
  stale:          { label: 'Stale',          variant: 'gold',   icon: Clock },
  subcontracted:  { label: 'Subcontracted',  variant: 'purple', icon: RefreshCw },
};

const SEVERITY_COLORS = { Low: 'blue', Medium: 'gold', High: 'orange', Critical: 'red' };

// ============================================================
// Accept / Assign Technician Modal (dispatcher action)
// ============================================================
function AssignTechnicianModal({ wo, onAssign, onClose }) {
  const [tech, setTech] = useState(null);
  const [techOpen, setTechOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAssign = () => {
    setSubmitting(true);
    setTimeout(() => {
      onAssign({ technician: tech.name, notes });
      onClose();
    }, 700);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 280 }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-blue/15 flex items-center justify-center">
              <PlayCircle size={16} className="text-accent-blue" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Accept & Assign</h3>
              <p className="text-[11px] text-navy-400">{wo.id} · {wo.plate}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div className="rounded-lg bg-navy-800/40 border border-navy-700/40 p-3">
            <div className="text-[10px] text-navy-400 uppercase tracking-wide mb-1">Work to complete</div>
            <div className="text-sm text-white mb-1">{wo.description}</div>
            <div className="text-[11px] text-navy-400">{wo.section} · {wo.part}</div>
          </div>

          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Assign to technician</label>
            <div className="relative">
              <button onClick={() => setTechOpen(!techOpen)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-navy-700 bg-navy-800/50 text-left hover:border-navy-600 cursor-pointer min-h-[52px]">
                {tech ? (
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate">{tech.name}</div>
                    <div className="text-[11px] text-navy-400 truncate">{tech.specialties.join(', ')} · {tech.activeWOs} active WOs</div>
                  </div>
                ) : (
                  <span className="text-sm text-navy-400">Select a technician…</span>
                )}
                <ChevronDown size={16} className={`text-navy-400 shrink-0 ml-2 transition-transform ${techOpen ? 'rotate-180' : ''}`} />
              </button>
              {techOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setTechOpen(false)} />
                  <div className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-20">
                    {availableTechnicians.map((t) => (
                      <button key={t.id} onClick={() => { setTech(t); setTechOpen(false); }}
                        className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-navy-800 transition-colors border-b border-navy-800/60 last:border-b-0 min-h-[56px] ${
                          tech?.id === t.id ? 'bg-navy-800' : ''
                        }`}>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{t.name}</div>
                          <div className="text-[11px] text-navy-400 truncate">{t.specialties.join(', ')}</div>
                        </div>
                        <Badge variant={t.activeWOs > 4 ? 'orange' : 'gray'}>{t.activeWOs} active</Badge>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Dispatcher notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="e.g. 'Parts already ordered — arriving 2pm'"
              className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Cancel</button>
          <button onClick={handleAssign} disabled={!tech || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-blue to-accent-purple text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {submitting ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> Assigning…</>) : (<><Check size={14} /> Accept & Assign</>)}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Decline Modal (with reason code)
// ============================================================
function DeclineModal({ wo, onDecline, onClose }) {
  const [reason, setReason] = useState(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      onDecline({ reason: reason.label, notes });
      onClose();
    }, 600);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-red/15 border border-accent-red/40 flex items-center justify-center">
              <XCircle size={16} className="text-accent-red" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Decline Work Order</h3>
              <p className="text-[11px] text-navy-400">{wo.id} · Requires reason code</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Reason code *</label>
            <div className="space-y-2">
              {WO_DECLINE_REASONS.map((r) => (
                <button key={r.code} onClick={() => setReason(r)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all cursor-pointer ${
                    reason?.code === r.code
                      ? 'border-accent-red/50 bg-accent-red/10'
                      : 'border-navy-700 bg-navy-800/40 hover:border-navy-600'
                  }`}>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    reason?.code === r.code ? 'border-accent-red bg-accent-red text-white' : 'border-navy-600'
                  }`}>
                    {reason?.code === r.code && <Check size={12} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-navy-400 uppercase tracking-wide">Code {r.code}</div>
                    <div className="text-sm text-white">{r.label}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Additional notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-red resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Cancel</button>
          <button onClick={handleSubmit} disabled={!reason || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-red text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {submitting ? 'Declining…' : <>Decline <XCircle size={14} /></>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Complete Work Modal (technician action)
// ============================================================
function CompleteWorkModal({ wo, onComplete, onClose }) {
  const [comments, setComments] = useState('');
  const [mileage, setMileage] = useState(wo.lastMileage || '');
  const [odometerPhoto, setOdometerPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = comments.length > 4 && mileage && String(mileage).length >= 3;

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      onComplete({ comments, mileage: Number(mileage), hasPhoto: !!odometerPhoto });
      onClose();
    }, 900);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800 bg-gradient-to-r from-accent-green/10 to-navy-900">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-green/15 border border-accent-green/40 flex items-center justify-center">
              <CheckCircle2 size={16} className="text-accent-green" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Complete Work</h3>
              <p className="text-[11px] text-navy-400">{wo.id} · {wo.plate}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Work completed comments *</label>
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3}
              placeholder="e.g. Replaced both brake pads and rotors on front axle. Test-driven OK."
              className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green resize-none" />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Last mileage *</label>
            <input type="number" inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)}
              placeholder="e.g. 48290"
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green" />
            <p className="text-[10px] text-navy-500 mt-1">Previously: {wo.lastMileage?.toLocaleString() || '—'} mi</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Odometer photo</label>
            <label className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed border-navy-700/60 bg-navy-800/20 active:bg-navy-800/60 hover:bg-navy-800/40 cursor-pointer transition-colors min-h-[64px]">
              <div className="w-10 h-10 rounded-lg bg-accent-blue/15 flex items-center justify-center shrink-0">
                <Camera size={16} className="text-accent-blue" />
              </div>
              <div className="flex-1 text-xs min-w-0">
                {odometerPhoto ? (
                  <>
                    <div className="text-white font-semibold truncate">{odometerPhoto.name}</div>
                    <div className="text-navy-400">{(odometerPhoto.size / 1024).toFixed(0)} KB</div>
                  </>
                ) : (
                  <>
                    <div className="text-white">Capture odometer photo</div>
                    <div className="text-navy-400">Required for audit</div>
                  </>
                )}
              </div>
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => e.target.files?.[0] && setOdometerPhoto({ name: e.target.files[0].name, size: e.target.files[0].size })} />
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Cancel</button>
          <button onClick={handleSubmit} disabled={!canSubmit || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {submitting ? 'Completing…' : <>Complete <Check size={14} /></>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Release Modal (technician returns WO to dispatcher)
// ============================================================
function ReleaseModal({ wo, onRelease, onClose }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
        className="bg-navy-900 border border-accent-orange/40 rounded-xl p-5 max-w-sm w-full text-center"
        onClick={(e) => e.stopPropagation()}>
        <div className="w-12 h-12 rounded-full bg-accent-orange/15 border border-accent-orange/40 flex items-center justify-center mx-auto mb-3">
          <PauseCircle size={22} className="text-accent-orange" />
        </div>
        <h4 className="text-base font-semibold text-white mb-1">Release Work Order?</h4>
        <p className="text-xs text-navy-400 mb-4">
          {wo.id} will be returned to the dispatcher who can re-assign it or decline with a reason code.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-navy-600 text-navy-300 text-sm hover:bg-navy-800 cursor-pointer">Cancel</button>
          <button onClick={() => { onRelease(); onClose(); }}
            className="flex-1 px-4 py-2.5 rounded-lg bg-accent-orange text-white text-sm font-semibold hover:opacity-90 cursor-pointer">Release</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Notes Modal (free-text notes via kebab)
// ============================================================
function NotesModal({ wo, onAddNote, onClose }) {
  const [note, setNote] = useState('');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-blue/15 flex items-center justify-center">
              <MessageSquare size={16} className="text-accent-blue" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Work Order Notes</h3>
              <p className="text-[11px] text-navy-400">{wo.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-3 overflow-y-auto flex-1">
          {wo.notes && wo.notes.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-navy-400">Previous notes</div>
              {wo.notes.map((n, i) => (
                <div key={i} className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2 text-xs text-white">{n}</div>
              ))}
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Add note</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
              placeholder="Enter notes…"
              className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue resize-none" autoFocus />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Close</button>
          <button onClick={() => { onAddNote(note); onClose(); }} disabled={!note.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-blue text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            <Check size={14} /> Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Log a Job Modal (floating toolbox — technician misc jobs)
// ============================================================
function LogJobModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({ dsp: '', vehicle: '', description: '', hours: 1 });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [jobId, setJobId] = useState('');

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      const id = `JOB-${Math.floor(10000 + Math.random() * 90000)}`;
      setJobId(id);
      onSubmit({ ...form, id });
      setSubmitting(false);
      setSuccess(true);
    }, 900);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-purple/15 flex items-center justify-center">
              <PackageCheck size={16} className="text-accent-purple" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Log a Job</h3>
              <p className="text-[11px] text-navy-400">Record miscellaneous work not tied to a WO</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {success ? (
            <div className="text-center py-6">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}
                className="w-14 h-14 mx-auto rounded-full bg-accent-green/15 border border-accent-green/40 flex items-center justify-center mb-3">
                <CheckCircle2 size={26} className="text-accent-green" />
              </motion.div>
              <h4 className="text-base font-semibold text-white mb-1">Job logged</h4>
              <div className="inline-flex flex-col gap-1 px-4 py-2.5 rounded-lg bg-navy-800/60 border border-navy-700/40 text-left mt-2">
                <div className="text-[11px] text-navy-400">Job ID</div>
                <div className="text-sm font-mono text-accent-purple">{jobId}</div>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-accent-purple/10 border border-accent-purple/30 p-3 text-xs text-navy-200">
                Use this form to record jobs completed throughout the day that weren't tied to a Work Order (e.g., quick DA-requested check, spot reinforcement).
              </div>
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">DSP *</label>
                <input value={form.dsp} onChange={(e) => setForm({ ...form, dsp: e.target.value })}
                  placeholder="Ribrell 21"
                  className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-purple" />
              </div>
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Vehicle *</label>
                <input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })}
                  placeholder="VAN-1042"
                  className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-purple" />
              </div>
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Description *</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3}
                  placeholder="e.g. Tire pressure check + air fill on all 4 tires"
                  className="w-full rounded-lg px-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-purple resize-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Time spent (hours)</label>
                <input type="number" step="0.25" value={form.hours} onChange={(e) => setForm({ ...form, hours: parseFloat(e.target.value) })}
                  className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-purple" />
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          {success ? (
            <>
              <span />
              <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 cursor-pointer">Done</button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Cancel</button>
              <button onClick={handleSubmit} disabled={!form.dsp || !form.vehicle || !form.description || submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-purple text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                {submitting ? 'Logging…' : <>Log Job <Check size={14} /></>}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Work Order Card
// ============================================================
function WorkOrderCard({ wo, expanded, onToggle, userRole, onAction }) {
  const statusConf = STATUS_CONFIG[wo.status];
  const StatusIcon = statusConf.icon;

  const isDispatcher = userRole === 'vendor_admin' || userRole === 'site_admin';
  const isTechnician = userRole === 'technician';
  const isMyWO = wo.assignedTechnician === 'David Torres' && isTechnician;

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className={`bg-navy-900/60 border rounded-xl overflow-hidden transition-all ${
        expanded ? 'border-accent-blue/40' : 'border-navy-700/40 hover:border-navy-600/60'
      }`}>

      {/* Header (always visible) */}
      <button onClick={onToggle} className="w-full text-left px-4 py-3 hover:bg-navy-800/30 transition-colors">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-sm font-mono font-semibold text-accent-blue">{wo.id}</span>
              <Badge variant={statusConf.variant} size="md">
                <StatusIcon size={10} className="inline mr-0.5" /> {statusConf.label}
              </Badge>
              {wo.flags?.map((f) => {
                const fConf = FLAG_CONFIG[f];
                if (!fConf) return null;
                const FIcon = fConf.icon;
                return (
                  <Badge key={f} variant={fConf.variant}>
                    <FIcon size={9} className="inline mr-0.5" /> {fConf.label}
                  </Badge>
                );
              })}
            </div>
            <div className="text-sm text-white font-medium">
              <span className="text-navy-300">{wo.dspName}</span> &nbsp;·&nbsp; {wo.vehicleId} &nbsp;·&nbsp; <span className="text-navy-400 font-mono">{wo.plate}</span>
            </div>
            <div className="text-xs text-navy-400 mt-0.5 truncate">{wo.section} &nbsp;·&nbsp; <span className="text-white">{wo.part}</span></div>
          </div>
          <ChevronDown size={16} className={`text-navy-400 shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
        <div className="flex items-center justify-between text-xs text-navy-400">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={SEVERITY_COLORS[wo.severity]}>{wo.severity}</Badge>
            {wo.assignedTechnician && (
              <span className="flex items-center gap-1 text-navy-300">
                <User size={10} /> {wo.assignedTechnician}{isMyWO ? ' (you)' : ''}
              </span>
            )}
            {wo.scheduledAt && (
              <span className="flex items-center gap-1 text-accent-blue">
                <Clock size={10} /> {wo.scheduledAt}
              </span>
            )}
          </div>
          <span className="shrink-0">{new Date(wo.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
      </button>

      {/* Expanded body */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden border-t border-navy-800">
            <div className="px-4 py-4 space-y-4">
              {/* Description */}
              <div className="rounded-lg bg-navy-800/40 border border-navy-700/40 p-3">
                <div className="text-[10px] text-navy-400 uppercase tracking-wide mb-1">Defect description</div>
                <div className="text-sm text-white">{wo.description}</div>
              </div>

              {/* WO details grid */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <Field label="RO Number" value={wo.roNumber} mono />
                <Field label="Reported by" value={wo.reportedBy} />
                <Field label="Last mileage" value={wo.lastMileage ? `${wo.lastMileage.toLocaleString()} mi` : '—'} />
                <Field label="FMC" value={wo.fmc} />
                <Field label="Y / Make / Model" value={`${wo.year} ${wo.make} ${wo.model}`} />
                <Field label="VIN" value={wo.vin} mono small />
                {wo.declinedReason && <Field label="Declined reason" value={wo.declinedReason} warn />}
                {wo.canceledReason && <Field label="Canceled reason" value={wo.canceledReason} warn />}
                {wo.completedAt && <Field label="Completed at" value={new Date(wo.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} />}
              </div>

              {/* Notes */}
              {wo.notes && wo.notes.length > 0 && (
                <div>
                  <div className="text-[10px] text-navy-400 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                    <MessageSquare size={10} /> Notes ({wo.notes.length})
                  </div>
                  <div className="space-y-1">
                    {wo.notes.map((n, i) => (
                      <div key={i} className="rounded-md bg-navy-800/40 border border-navy-700/40 px-2.5 py-1.5 text-xs text-navy-200">{n}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-navy-800">
                <button onClick={() => onAction('notes', wo)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-xs font-medium text-navy-300 hover:text-white hover:border-navy-600 cursor-pointer">
                  <MessageSquare size={11} /> Notes
                </button>

                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {/* Dispatcher actions on Pending */}
                  {isDispatcher && wo.status === 'pending' && (
                    <>
                      <button onClick={() => onAction('decline', wo)}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs font-semibold hover:bg-accent-red/25 cursor-pointer">
                        <XCircle size={11} /> Decline
                      </button>
                      <button onClick={() => onAction('accept', wo)}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-accent-blue text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
                        <PlayCircle size={11} /> Accept & Assign
                      </button>
                    </>
                  )}

                  {/* Dispatcher actions on Pending FMC */}
                  {isDispatcher && wo.status === 'pending_fmc' && (
                    <div className="text-[11px] text-accent-purple flex items-center gap-1">
                      <Briefcase size={11} /> Awaiting {wo.fmc} approval
                    </div>
                  )}

                  {/* Technician actions on In Progress (only if assigned to them, or dispatcher view) */}
                  {((isTechnician && isMyWO) || isDispatcher || userRole === 'site_admin') && wo.status === 'in_progress' && (
                    <>
                      <button onClick={() => onAction('release', wo)}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-accent-orange/15 border border-accent-orange/40 text-accent-orange text-xs font-semibold hover:bg-accent-orange/25 cursor-pointer">
                        <PauseCircle size={11} /> Release
                      </button>
                      <button onClick={() => onAction('complete', wo)}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-accent-green text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
                        <CheckCircle2 size={11} /> Complete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Field({ label, value, mono, small, warn }) {
  return (
    <div>
      <div className="text-[10px] text-navy-500 uppercase tracking-wide">{label}</div>
      <div className={`${small ? 'text-[11px]' : 'text-xs'} ${mono ? 'font-mono' : ''} ${warn ? 'text-accent-orange' : 'text-white'} truncate`}>{value || '—'}</div>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================
export default function WorkOrders({ user }) {
  const [workOrders, setWorkOrders] = useState(workOrdersData);
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState([]);
  const [dspFilter, setDspFilter] = useState('all');
  const [dspFilterOpen, setDspFilterOpen] = useState(false);
  const [expandedWO, setExpandedWO] = useState(null);
  const [modal, setModal] = useState(null); // { type, wo }
  const [showLogJob, setShowLogJob] = useState(false);

  const isTechnician = user?.role === 'technician';
  const isVendor = user?.role === 'vendor_admin' || user?.role === 'site_admin';

  // For technicians, filter to only their WOs; for vendors/site admins, show all
  const visibleWOs = useMemo(() => {
    if (isTechnician) {
      return workOrders.filter((wo) => wo.assignedTechnician === user.name || (wo.status !== 'in_progress' && wo.assignedTechnician === null));
      // Technicians don't see pending WOs normally; simplification for demo: they see only their in-progress
    }
    // Actually for technicians in v1: they only see their assigned WOs
    return workOrders;
  }, [workOrders, isTechnician, user]);

  // Actually for technicians, only show WOs assigned to them
  const myWOs = useMemo(() => {
    if (isTechnician) {
      return workOrders.filter((wo) => wo.assignedTechnician === user.name);
    }
    return workOrders;
  }, [workOrders, isTechnician, user]);

  // Apply search + filters
  const filtered = useMemo(() => {
    let list = myWOs;
    if (statusFilters.length > 0) list = list.filter((wo) => statusFilters.includes(wo.status));
    if (dspFilter !== 'all') list = list.filter((wo) => wo.dspId === dspFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((wo) =>
        wo.id.toLowerCase().includes(s) ||
        wo.vehicleId.toLowerCase().includes(s) ||
        wo.plate.toLowerCase().includes(s) ||
        wo.description.toLowerCase().includes(s) ||
        wo.dspName.toLowerCase().includes(s) ||
        (wo.assignedTechnician || '').toLowerCase().includes(s)
      );
    }
    return list;
  }, [myWOs, search, statusFilters, dspFilter]);

  // Summary stats (week-to-date)
  const summary = useMemo(() => {
    const pending = myWOs.filter((wo) => wo.status === 'pending').length;
    const pendingFmc = myWOs.filter((wo) => wo.status === 'pending_fmc').length;
    const inProgress = myWOs.filter((wo) => wo.status === 'in_progress').length;
    const completed = myWOs.filter((wo) => wo.status === 'completed').length;
    const declined = myWOs.filter((wo) => wo.status === 'declined').length;
    const rushOrders = myWOs.filter((wo) => wo.flags.includes('rush_order')).length;
    const total = myWOs.length;
    return { pending, pendingFmc, inProgress, completed, declined, rushOrders, total };
  }, [myWOs]);

  const uniqueDsps = useMemo(() => {
    const map = new Map();
    myWOs.forEach((wo) => map.set(wo.dspId, wo.dspName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [myWOs]);

  const toggleStatusFilter = (status) => {
    setStatusFilters(statusFilters.includes(status) ? statusFilters.filter((s) => s !== status) : [...statusFilters, status]);
  };

  // Action dispatcher
  const handleAction = (type, wo) => setModal({ type, wo });

  // Mutations
  const updateWO = (woId, updates) => {
    setWorkOrders(workOrders.map((wo) => (wo.id === woId ? { ...wo, ...updates } : wo)));
  };
  const addNote = (woId, note) => {
    setWorkOrders(workOrders.map((wo) => (wo.id === woId ? { ...wo, notes: [...(wo.notes || []), note] } : wo)));
  };

  const handleAssign = (assignment) => {
    updateWO(modal.wo.id, {
      status: 'in_progress',
      assignedTechnician: assignment.technician,
      roNumber: `RO-2026-${Math.floor(8000 + Math.random() * 2000)}`,
      notes: assignment.notes ? [...(modal.wo.notes || []), `Dispatcher: ${assignment.notes}`] : modal.wo.notes,
    });
    setModal(null);
  };
  const handleDecline = (decline) => {
    updateWO(modal.wo.id, {
      status: 'declined',
      declinedReason: decline.reason,
      declinedAt: new Date().toISOString(),
      notes: decline.notes ? [...(modal.wo.notes || []), `Decline note: ${decline.notes}`] : modal.wo.notes,
    });
    setModal(null);
  };
  const handleComplete = (completion) => {
    updateWO(modal.wo.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      lastMileage: completion.mileage,
      notes: [...(modal.wo.notes || []), `Completed: ${completion.comments}`],
    });
    setModal(null);
  };
  const handleRelease = () => {
    updateWO(modal.wo.id, {
      status: 'pending',
      assignedTechnician: null,
      notes: [...(modal.wo.notes || []), `Released by ${user.name} — returned to dispatcher`],
    });
    setModal(null);
  };

  // Today's date string
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const completionRate = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 sm:mb-6 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-white mb-1">Work Orders</h2>
          <p className="text-navy-400 text-sm">
            {isTechnician
              ? <>My assigned WOs &mdash; <span className="text-white font-medium">{summary.total}</span> total</>
              : <>Vendor hub &mdash; <span className="text-white font-medium">{summary.total}</span> WOs across <span className="text-white font-medium">{uniqueDsps.length}</span> DSPs</>}
          </p>
        </div>
        <button onClick={() => setShowLogJob(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-purple/15 border border-accent-purple/40 text-accent-purple text-sm font-semibold hover:bg-accent-purple/25 cursor-pointer">
          <PackageCheck size={14} /> Log a Job
        </button>
      </div>

      {/* Summary card — week-to-date stats */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-navy-900/80 to-navy-900/40 border border-navy-700/40 rounded-xl p-4 sm:p-5 mb-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/15 flex items-center justify-center">
              <ClipboardList size={14} className="text-accent-blue" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Work Order Summary</div>
              <div className="text-[11px] text-navy-400">{dateStr} &middot; week-to-date</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-navy-400">Completion rate</div>
            <div className="text-lg font-bold text-accent-green">{completionRate}%</div>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <StatCard label="Total" value={summary.total} color="text-white" icon={ClipboardList} />
          <StatCard label="Pending" value={summary.pending + summary.pendingFmc} color="text-accent-gold" icon={Hourglass} />
          <StatCard label="In Progress" value={summary.inProgress} color="text-accent-blue" icon={PlayCircle} />
          <StatCard label="Completed" value={summary.completed} color="text-accent-green" icon={CheckCircle2} />
          <StatCard label="Declined" value={summary.declined} color="text-accent-red" icon={XCircle} />
        </div>
        {summary.rushOrders > 0 && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/30 text-xs">
            <Flame size={12} className="text-accent-red" />
            <span className="text-white font-medium">{summary.rushOrders}</span>
            <span className="text-navy-300">Rush Order{summary.rushOrders > 1 ? 's' : ''} requiring immediate attention</span>
          </div>
        )}
      </motion.div>

      {/* Search + filters */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search WO ID, fleet ID, plate, DSP or description…"
            className="w-full rounded-lg pl-9 pr-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" />
        </div>

        {/* DSP filter */}
        {!isTechnician && uniqueDsps.length > 1 && (
          <div className="relative">
            <button onClick={() => setDspFilterOpen(!dspFilterOpen)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm border cursor-pointer min-h-[42px] ${
                dspFilter !== 'all' ? 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue font-semibold' : 'bg-navy-800 border-navy-700 text-navy-300 hover:text-white'
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
                    <span>All DSPs ({myWOs.length})</span>
                    {dspFilter === 'all' && <Check size={12} className="text-accent-green" />}
                  </button>
                  {uniqueDsps.map((d) => {
                    const count = myWOs.filter((wo) => wo.dspId === d.id).length;
                    return (
                      <button key={d.id} onClick={() => { setDspFilter(d.id); setDspFilterOpen(false); }}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm text-white hover:bg-navy-800 border-b border-navy-800/60 last:border-b-0">
                        <span className="truncate">{d.name} ({count})</span>
                        {dspFilter === d.id && <Check size={12} className="text-accent-green shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap overflow-x-auto">
        <span className="text-[11px] text-navy-400 font-semibold uppercase tracking-wide shrink-0 mr-1">Status:</span>
        {Object.entries(STATUS_CONFIG).map(([key, conf]) => {
          const active = statusFilters.includes(key);
          const count = myWOs.filter((wo) => wo.status === key).length;
          if (count === 0 && !active) return null;
          const Icon = conf.icon;
          return (
            <button key={key} onClick={() => toggleStatusFilter(key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer shrink-0 ${
                active
                  ? `${conf.bg} ${conf.border} ${conf.color}`
                  : 'bg-navy-800/40 border-navy-700 text-navy-400 hover:text-white hover:border-navy-600'
              }`}>
              <Icon size={10} />
              {conf.label}
              <span className={`ml-0.5 px-1 rounded ${active ? 'bg-black/20' : 'bg-navy-700/50 text-navy-300'}`}>{count}</span>
            </button>
          );
        })}
        {statusFilters.length > 0 && (
          <button onClick={() => setStatusFilters([])} className="text-[11px] text-accent-red hover:underline ml-1 shrink-0">Clear filters</button>
        )}
      </div>

      {/* WO list */}
      <div className="space-y-2">
        {filtered.map((wo) => (
          <WorkOrderCard
            key={wo.id}
            wo={wo}
            expanded={expandedWO === wo.id}
            onToggle={() => setExpandedWO(expandedWO === wo.id ? null : wo.id)}
            userRole={user?.role}
            onAction={handleAction}
          />
        ))}
        {filtered.length === 0 && (
          <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-10 text-center">
            <ClipboardList size={40} className="text-navy-600 mx-auto mb-3" />
            <h4 className="text-sm font-semibold text-white mb-1">No work orders match your filters</h4>
            <p className="text-xs text-navy-400">Try clearing filters or changing your search.</p>
          </div>
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {modal?.type === 'accept' && <AssignTechnicianModal wo={modal.wo} onAssign={handleAssign} onClose={() => setModal(null)} />}
        {modal?.type === 'decline' && <DeclineModal wo={modal.wo} onDecline={handleDecline} onClose={() => setModal(null)} />}
        {modal?.type === 'complete' && <CompleteWorkModal wo={modal.wo} onComplete={handleComplete} onClose={() => setModal(null)} />}
        {modal?.type === 'release' && <ReleaseModal wo={modal.wo} onRelease={handleRelease} onClose={() => setModal(null)} />}
        {modal?.type === 'notes' && <NotesModal wo={modal.wo} onAddNote={(n) => addNote(modal.wo.id, n)} onClose={() => setModal(null)} />}
        {showLogJob && <LogJobModal onClose={() => setShowLogJob(false)} onSubmit={() => { /* logged */ }} />}
      </AnimatePresence>
    </div>
  );
}

// Small metric stat card
function StatCard({ label, value, color, icon: Icon }) {
  return (
    <div className="rounded-lg bg-navy-800/40 border border-navy-700/40 p-2.5 text-center">
      {Icon && <Icon size={14} className={`mx-auto mb-1 ${color}`} />}
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-navy-400 uppercase tracking-wide">{label}</div>
    </div>
  );
}
