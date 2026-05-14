import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Shield, ShieldCheck, AlertTriangle, Award, TrendingUp, Users, Flame, Camera, Gift, Lock, Star, Plus, Hourglass, CheckCheck, X, Clock, Wrench, CheckCircle2, Calendar, KeyRound, ChevronRight, Info, SkipForward, PlayCircle, ClipboardCheck, ChevronDown, Check, ArrowRight, Bell, LayoutGrid, Truck, ThumbsUp, ThumbsDown } from 'lucide-react';
import { daList, dspRewards, dspList, weeklyInspections, defectCategoryBreakdown, inspectionSections, workOrdersData } from '../data/mockData';
import MetricCard from './ui/MetricCard';
import ProgressBar from './ui/ProgressBar';
import Badge from './ui/Badge';
import { FlexFleetModal, VehicleReportCard, CreateWorkOrderModal } from './FleetSnapshot';
import { fleetSnapshotVans } from '../data/mockData';
import { isDspRole, canInspect, canApproveDefects } from '../lib/permissions';
import CreateInspectionWizard from './CreateInspectionWizard';
import LiveInspectionReportCard from './LiveInspectionReportCard';
import VendorPickerModal from './ui/VendorPickerModal';
import {
  inspections as inspectionsApi,
  vehicles as vehiclesApi,
  defects as defectsApi,
  defectReviews as defectReviewsApi,
  workOrders as workOrdersApi,
} from '../api/client';
import { adaptWO } from '../api/woAdapter';

const tierConfig = {
  1: { label: 'Tier 1', range: '1–25 defects', cash: '$1', bucks: '$1', color: '#3b82f6', bg: 'bg-accent-blue/10', border: 'border-accent-blue/30', pending: 1 },
  2: { label: 'Tier 2', range: '26–250 defects', cash: '$2', bucks: '$2', color: '#f59e0b', bg: 'bg-accent-gold/10', border: 'border-accent-gold/30', pending: 1 },
  3: { label: 'Tier 3', range: '250+ defects', cash: '$3', bucks: '$3', color: '#8b5cf6', bg: 'bg-accent-purple/10', border: 'border-accent-purple/30', pending: 0 },
};

// Award status: true = awarded (check), false = pending (hourglass)
const daAwardStatus = {
  'DA-1008': false, // Mia - pending
  'DA-1001': true,  // Marcus - awarded
  'DA-1004': true,  // Ana - awarded
  'DA-1006': false, // Destiny - pending
  'DA-1002': true,
  'DA-1009': true,
  'DA-1010': true,
  'DA-1003': true,
  'DA-1005': true,
  'DA-1007': true,
};

const defectStatusColors = { 'Rush Order': 'red', 'Scheduled': 'blue', 'Repair Ordered': 'green', 'Logged': 'gray' };

// Detail data for each metric card
const cardDetails = {
  reported: {
    title: 'DSP-reported Defects Today',
    accent: 'accent-green',
    icon: Shield,
    summary: '8 defects reported across fleet — 1 is a rush order',
    items: [
      { label: 'VAN-1042', title: 'Rear left tire — tread below 3/32"', meta: 'Marcus Johnson · 06:15 AM', status: 'Rush Order' },
      { label: 'VAN-1042', title: 'Brake light — passenger side out', meta: 'Marcus Johnson · 06:16 AM', status: 'Repair Ordered' },
      { label: 'VAN-2009', title: 'Minor scratch on driver door', meta: 'Ana Rodriguez · 06:05 AM', status: 'Scheduled' },
      { label: 'VAN-5012', title: 'Grinding noise — front brakes', meta: 'Mia Thompson · 05:55 AM', status: 'Rush Order' },
      { label: 'VAN-3021', title: 'Coolant level low', meta: 'Destiny Brooks · 06:22 AM', status: 'Repair Ordered' },
      { label: 'VAN-1018', title: 'Crack spreading from chip — driver side', meta: 'Sarah Chen · 06:30 AM', status: 'Repair Ordered' },
      { label: 'VAN-5008', title: 'Passenger side mirror — loose housing', meta: 'David Kim · 06:10 AM', status: 'Logged' },
      { label: 'VAN-2015', title: 'Cargo door — stiff latch mechanism', meta: 'James Williams · 06:20 AM', status: 'Logged' },
    ],
  },
  immediate: {
    title: 'Immediate Action Required',
    accent: 'accent-purple',
    icon: AlertTriangle,
    summary: '10 items pending approval to enroll in DVIC repair queue',
    items: [
      { label: 'VAN-5012', title: 'Grinding noise — front brakes, feels spongy', meta: 'Mia Thompson',         status: 'Pending Approval', section: '4. Back Side',      part: 'Brakes' },
      { label: 'VAN-1042', title: 'Rear left tire — tread below 3/32"',         meta: 'Marcus Johnson',              status: 'Pending Approval',     section: '4. Back Side',      part: 'Tire tread' },
      { label: 'VAN-1018', title: 'Windshield crack spreading',                  meta: 'Sarah Chen',                  status: 'Pending Approval',     section: '1. Front Side',     part: 'Windshield' },
      { label: 'VAN-2027', title: 'ABS warning light active',                    meta: 'Tyler Nguyen',            status: 'Pending Approval', section: '5. In-Cab',         part: 'Dashboard' },
      { label: 'VAN-3044', title: 'Power steering fluid leak',                   meta: 'Kevin Park',                  status: 'Pending Approval',     section: '1. Front Side',     part: 'Fluids' },
      { label: 'VAN-4012', title: 'Rear brake pad wear indicator',               meta: 'Aaliyah Washington',        status: 'Pending Approval',   section: '4. Back Side',      part: 'Brake pads' },
      { label: 'VAN-5033', title: 'Headlight alignment out of spec',             meta: 'David Kim',                 status: 'Pending Approval',   section: '1. Front Side',     part: 'Headlights' },
      { label: 'VAN-1055', title: 'Wiper blades torn — driver side',             meta: 'James Williams',               status: 'Pending Approval',      section: '1. Front Side',     part: 'Wiper blades' },
      { label: 'VAN-2088', title: 'Seatbelt retractor slow',   meta: 'Sarah Chen',    status: 'Pending Approval', section: '5. In-Cab',     part: 'Seat belts' },
      { label: 'VAN-3099', title: 'Cargo light intermittent',  meta: 'Destiny Brooks',   status: 'Pending Approval',    section: '4. Back Side',  part: 'Cargo light' },
    ],
  },
  inspected: {
    title: 'Vans Inspected in Recent QC DVIC',
    accent: 'accent-blue',
    icon: TrendingUp,
    summary: '23 inspected · 7 not inspected · 2 new to approve',
    // category → maps the inspecting vendor's specialty (AMR = Mechanical, Body = body work, etc.)
    inspectedVans: [
      { id: 'VAN-1042', vendor: 'ProFleet Auto Care',       tech: 'Carlos Mendez',  category: 'amr',      result: 'Flagged' },
      { id: 'VAN-1018', vendor: 'ProFleet Auto Care',       tech: "Brian O'Connor", category: 'amr',     result: 'Passed' },
      { id: 'VAN-2009', vendor: 'Evergreen Body Works',     tech: 'Luis Ramirez',   category: 'body',       result: 'Passed' },
      { id: 'VAN-2015', vendor: 'ProFleet Auto Care',       tech: 'Derek Hayes',    category: 'amr',     result: 'Passed' },
      { id: 'VAN-3021', vendor: 'ProFleet Auto Care',       tech: 'Jamal Foster',   category: 'amr',    result: 'Passed' },
      { id: 'VAN-3044', vendor: 'Evergreen Body Works',     tech: 'Marie Dubois',   category: 'body',       result: 'Passed' },
      { id: 'VAN-4005', vendor: 'Discount Tire Commercial', tech: 'Alex Rivera',    category: 'tires',      result: 'Flagged' },
      { id: 'VAN-4018', vendor: 'ProFleet Auto Care',       tech: 'Ivan Petrov',    category: 'amr',     result: 'Passed' },
      { id: 'VAN-5008', vendor: 'Spotless Mobile Detail',   tech: 'Jasmine Rhodes', category: 'detailing',     result: 'Passed' },
      { id: 'VAN-5012', vendor: 'ProFleet Auto Care',       tech: 'Miguel Torres',  category: 'amr', result: 'Flagged' },
      { id: 'VAN-3077', vendor: 'Discount Tire Commercial', tech: 'Priya Shah',     category: 'tires',    result: 'Passed' },
      { id: 'VAN-2022', vendor: 'Spotless Mobile Detail',   tech: 'Nate Kim',       category: 'detailing',     result: 'Passed' },
    ],
    notInspectedVans: [
      { id: 'VAN-1099', reason: 'Missed — no DA assigned' },
      { id: 'VAN-2044', reason: 'DA did not check in' },
      { id: 'VAN-3077', reason: 'Awaiting driver pickup' },
      { id: 'VAN-4005', reason: 'Missed — rushed rollout' },
      { id: 'VAN-4021', reason: 'No inspection logged' },
      { id: 'VAN-5018', reason: 'DA absent' },
      { id: 'VAN-5041', reason: 'Unassigned' },
    ],
    approveNewVans: [
      { id: 'VAN-6001', reason: 'Newly activated — needs baseline DVIC' },
      { id: 'VAN-6002', reason: 'Newly activated — needs baseline DVIC' },
    ],
  },
  scheduled: {
    title: 'Scheduled Repairs',
    accent: 'accent-red',
    icon: Wrench,
    summary: '2 vans scheduled — Immediate Action',
    // Items tagged by repairBucket to split the list into two groups in the modal:
    //   'overnight' = expected to finish before dispatch time
    //   'shop'      = likely to exceed dispatch window
    scheduledItems: [
      { fleetId: 'VAN-5012', scheduledAt: 'Tonight, Apr 15 · 22:00 – 02:00', vendor: 'AMR',          defect: 'Grinding noise — front brakes, feels spongy', status: 'Rush Order', repairBucket: 'overnight' },
      { fleetId: 'VAN-2009', scheduledAt: 'Tonight, Apr 15 · 20:00 – 23:00', vendor: 'Body Repairs', defect: 'Minor scratch on driver door',      status: 'Scheduled',  repairBucket: 'shop' },
    ],
  },
};

const DSP_RESPONSE_OPTIONS = ['Confirmed', 'Vehicle not available', 'Cancel'];
const KEY_LOCATION_OPTIONS = ['Cup holder', 'Fuel compartment', 'Other'];

function ScheduledRepairItem({ item, onChanged }) {
  const { t } = useTranslation('dashboard');
  // Persisted state lives on the WO row. Local copies let the UI update
  // optimistically while the API call is in flight; on failure we revert.
  const [dspResponse, setDspResponse] = useState(item.dspResponse || '');
  // The dropdown's *selection* (the literal value the picker shows: one of
  // KEY_LOCATION_OPTIONS or '' for the placeholder). When the inspector
  // picks 'Other', a free-text field appears and stores its value in
  // `keyLocationCustom`. The effective string sent to the API is whichever
  // of the two is meaningful — see `effectiveKeyLocation` below.
  //
  // Earlier version reused a single `keyLocation` state for both, which
  // meant typing in the "Other" input immediately stomped the dropdown
  // selection ("Other" → "a") and the AnimatePresence block hiding the
  // input on `keyLocation !== 'Other'` made it disappear after the first
  // keystroke. Splitting them keeps the input mounted while the user types.
  const initialKey = item.keyLocation || '';
  const isInitialKnown = KEY_LOCATION_OPTIONS.includes(initialKey);
  const [keyLocationSelect, setKeyLocationSelect] = useState(
    initialKey === '' ? '' : (isInitialKnown ? initialKey : 'Other')
  );
  const [keyLocationCustom, setKeyLocationCustom] = useState(
    isInitialKnown ? '' : initialKey
  );
  const effectiveKeyLocation = keyLocationSelect === 'Other'
    ? keyLocationCustom.trim()
    : keyLocationSelect;
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  // Inline reschedule form state — popped when the DSP clicks "Not
  // available" so they can pick the next date the van is actually free.
  // Defaults to "+1 day, same hour" relative to the original slot so the
  // DSP doesn't have to type from scratch.
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const rescheduleDefault = (() => {
    // item.scheduledAt is a pre-formatted display string at this point;
    // backend serves the raw ISO on wo.scheduledAt — when wired from the
    // queue we expose `rescheduleSeedIso` so this defaulting works.
    const base = item.rescheduleSeedIso ? new Date(item.rescheduleSeedIso) : new Date();
    base.setDate(base.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`;
  })();
  const [rescheduleAt, setRescheduleAt] = useState(rescheduleDefault);
  const [rescheduleNotes, setRescheduleNotes] = useState('');

  const callResponse = async (response, opts = {}) => {
    if (!item.woId || busy) return;
    setBusy(true);
    setErrorMsg(null);
    const prevResp = dspResponse;
    setDspResponse(response);
    try {
      await workOrdersApi.dspResponse(item.woId, {
        response,
        keyLocation: opts.keyLocation ?? effectiveKeyLocation ?? null,
      });
      onChanged?.();
    } catch (err) {
      setDspResponse(prevResp);
      setErrorMsg(err?.detail || err?.message || 'Failed to update');
    } finally {
      setBusy(false);
    }
  };
  const callCancel = async () => {
    if (!item.woId || busy) return;
    if (!window.confirm(t('scheduledRepair.confirmCancel',
      'Cancel this WO? The vendor and tech will be notified and the slot is released.'))) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await workOrdersApi.cancel(item.woId, { reason: 'Cancelled by DSP from Scheduled Repairs card' });
      onChanged?.();
    } catch (err) {
      setErrorMsg(err?.detail || err?.message || 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const callReschedule = async () => {
    if (!item.woId || busy || !rescheduleAt) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const isoNew = new Date(rescheduleAt).toISOString();
      await workOrdersApi.dspReschedule(item.woId, {
        scheduledAt: isoNew,
        keyLocation: effectiveKeyLocation || null,
        notes: rescheduleNotes.trim() || null,
      });
      setRescheduleOpen(false);
      setRescheduleNotes('');
      onChanged?.();
    } catch (err) {
      setErrorMsg(err?.detail || err?.message || 'Reschedule failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-navy-800/40 border border-navy-700/40 rounded-xl p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-semibold text-white">{item.fleetId}</span>
            <Badge variant="gray">{item.vendor}</Badge>
            {item.woId && <span className="text-[10px] font-mono text-navy-500">{item.woId}</span>}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-navy-300">
            <Clock size={12} className="text-accent-blue" />
            <span>{item.scheduledAt}</span>
          </div>
        </div>
        <Badge variant={defectStatusColors[item.status] || 'gray'} size="md">{item.status}</Badge>
      </div>

      {/* Defect description */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-navy-500 mb-1">{t('scheduledRepair.defectToRepairLabel', 'Defect to repair')}</div>
        <div className="text-sm text-white">{item.defect}</div>
      </div>

      {/* Already-decided state — show the badge + a "Change" affordance */}
      {dspResponse === 'confirmed' ? (
        <div className="rounded-lg bg-accent-green/10 border border-accent-green/30 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-accent-green font-semibold">
            <Check size={12} /> {t('scheduledRepair.confirmedBadge', 'Confirmed — keys: ')}
            <span className="text-white font-normal truncate">
              {item.keyLocation || effectiveKeyLocation || '—'}
            </span>
          </div>
          <button
            onClick={() => { setDspResponse(''); setErrorMsg(null); }}
            className="mt-1 text-[11px] text-navy-300 underline hover:text-white"
            disabled={busy}>
            {t('scheduledRepair.changeResponse', 'Change response')}
          </button>
        </div>
      ) : dspResponse === 'not_available' ? (
        <div className="rounded-lg bg-accent-gold/10 border border-accent-gold/30 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-accent-gold font-semibold">
            <AlertTriangle size={12} /> {t('scheduledRepair.notAvailableBadge', 'Vehicle not available — vendor will reschedule')}
          </div>
          <button
            onClick={() => { setDspResponse(''); setErrorMsg(null); }}
            className="mt-1 text-[11px] text-navy-300 underline hover:text-white"
            disabled={busy}>
            {t('scheduledRepair.changeResponse', 'Change response')}
          </button>
        </div>
      ) : (
        <>
          {/* Key location picker — required before confirming so the
              vendor knows where to find the keys at pickup time. */}
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-navy-500 mb-1">
              {t('scheduledRepair.keyLocationLabel', 'Key Location')}
            </label>
            <select
              value={keyLocationSelect}
              onChange={(e) => setKeyLocationSelect(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-navy-200 outline-none focus:border-accent-blue cursor-pointer">
              <option value="">{t('scheduledRepair.selectLocation', 'Select location…')}</option>
              {KEY_LOCATION_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{t(`scheduledRepair.keyLocationOption.${opt}`, opt)}</option>
              ))}
            </select>
          </div>
          <AnimatePresence>
            {keyLocationSelect === 'Other' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <input
                  type="text"
                  value={keyLocationCustom}
                  onChange={(e) => setKeyLocationCustom(e.target.value)}
                  placeholder={t('scheduledRepair.keyLocationPlaceholder',
                    'e.g. Glove box, driver seat pocket…')}
                  className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
                  autoFocus
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons — call the backend on click. The "Not
              available" path now opens an inline reschedule form rather
              than just persisting an inconclusive flag — per the spec,
              the DSP picks the next date the van will actually be free,
              the WO updates to that slot, and the vendor sees the new
              time as already-confirmed. */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={() => callResponse('confirmed')}
              disabled={busy || !effectiveKeyLocation}
              className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent-green text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer">
              <Check size={12} /> {t('scheduledRepair.confirm', 'Confirm')}
            </button>
            <button
              onClick={() => setRescheduleOpen((v) => !v)}
              disabled={busy}
              className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold disabled:opacity-40 cursor-pointer ${
                rescheduleOpen
                  ? 'bg-accent-gold/30 border-accent-gold text-accent-gold'
                  : 'bg-accent-gold/15 border-accent-gold/40 text-accent-gold hover:bg-accent-gold/25'
              }`}>
              <AlertTriangle size={12} /> {t('scheduledRepair.notAvailableReschedule', 'Not available — reschedule')}
            </button>
            <button
              onClick={callCancel}
              disabled={busy}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs font-semibold hover:bg-accent-red/25 disabled:opacity-40 cursor-pointer">
              <X size={12} /> {t('scheduledRepair.cancelWo', 'Cancel WO')}
            </button>
          </div>

          {/* Inline reschedule form — only rendered when the DSP clicks
              "Not available". Lets them pick the next available date +
              add a quick note that lands in the activity log. */}
          <AnimatePresence>
            {rescheduleOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <div className="mt-2 rounded-lg border border-accent-gold/40 bg-accent-gold/5 p-3 space-y-2">
                  <div className="text-[11px] text-accent-gold font-semibold">
                    {t('scheduledRepair.rescheduleHeading',
                      'Pick the next date the van is available')}
                  </div>
                  <input
                    type="datetime-local"
                    value={rescheduleAt}
                    onChange={(e) => setRescheduleAt(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-gold"
                  />
                  <input
                    type="text"
                    value={rescheduleNotes}
                    onChange={(e) => setRescheduleNotes(e.target.value)}
                    disabled={busy}
                    placeholder={t('scheduledRepair.rescheduleNotesPlaceholder',
                      "Reason (optional) — e.g. 'driver out tomorrow'")}
                    className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-gold"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setRescheduleOpen(false)}
                      disabled={busy}
                      className="px-3 py-1.5 rounded-md text-[11px] font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">
                      {t('scheduledRepair.cancelReschedule', 'Cancel')}
                    </button>
                    <button
                      onClick={callReschedule}
                      disabled={busy || !rescheduleAt}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-semibold bg-accent-gold text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                      <Check size={11} /> {t('scheduledRepair.submitReschedule', 'Submit new date')}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {errorMsg && (
        <div className="text-[11px] text-accent-red">{errorMsg}</div>
      )}
    </div>
  );
}

// ============ Inspected Detail — enhanced renderer for the 'inspected' card ============
// Status is binary from the DSP's perspective: Clean or Defective.
const INSPECTED_LEGEND = [
  { id: 'clean',     label: 'Clean',     color: 'text-accent-green', dot: 'bg-accent-green' },
  { id: 'defective', label: 'Defective', color: 'text-accent-red',   dot: 'bg-accent-red' },
];

const INSPECTOR_CATEGORIES = [
  { id: 'amr',       label: 'AMR',          description: 'Amazon Mechanical Repairs' },
  { id: 'body',      label: 'Body Defects', description: 'Body & paint work' },
  { id: 'tires',     label: 'Tires',        description: 'Tire service' },
  { id: 'detailing', label: 'Detailing',    description: 'Cleaning / interior detail' },
];

// Row backgrounds by inspection result
const ROW_RESULT_STYLES = {
  clean:     { bg: 'bg-accent-green/10 hover:bg-accent-green/15',   border: 'border-accent-green/30',  resultText: 'text-accent-green' },
  defective: { bg: 'bg-accent-red/10 hover:bg-accent-red/15',       border: 'border-accent-red/40',    resultText: 'text-accent-red' },
};

// Compact inline status of a van's defects: "1 pending", "1 approved",
// "1 rejected", or for mixed cases like "1 ✓ · 1 ⏳" with each segment colored.
// When all 3 buckets are zero (legacy mock rows that didn't supply a breakdown),
// falls back to the plain "{total} defects" label.
function DefectBreakdownInline({ pending, approved, rejected, total, fallbackClass }) {
  const { t } = useTranslation('dashboard');
  const sum = pending + approved + rejected;
  if (sum === 0) {
    return (
      <span className={`font-semibold ${fallbackClass || 'text-accent-orange'}`}>
        {t('defectBreakdown.defectsFmt', { count: total, defaultValue: `${total} defect${total === 1 ? '' : 's'}` })}
      </span>
    );
  }

  // Single-status case: pretty single label
  if (pending === sum) {
    return (
      <span className="font-semibold text-accent-orange">
        {t('defectBreakdown.pendingReviewFmt', { count: pending, defaultValue: `${pending} pending review` })}
      </span>
    );
  }
  if (approved === sum) {
    return (
      <span className="font-semibold text-accent-green">
        {t('defectBreakdown.approvedFmt', { count: approved, defaultValue: `✓ ${approved} approved` })}
      </span>
    );
  }
  if (rejected === sum) {
    return (
      <span className="font-semibold text-navy-400">
        {t('defectBreakdown.rejectedFmt', { count: rejected, defaultValue: `✕ ${rejected} rejected` })}
      </span>
    );
  }

  // Mixed — concatenate non-zero buckets
  const parts = [];
  if (approved > 0) parts.push(<span key="a" className="text-accent-green font-semibold">✓ {approved}</span>);
  if (pending > 0) parts.push(<span key="p" className="text-accent-orange font-semibold">⏳ {pending}</span>);
  if (rejected > 0) parts.push(<span key="r" className="text-navy-400 font-semibold">✕ {rejected}</span>);
  return (
    <span>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="text-navy-500 mx-1">·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}

function InspectedDetailRenderer({ data, onOpenVehicleReport }) {
  const { t } = useTranslation('dashboard');
  const inspected = data.inspectedVans || [];
  const notInspected = data.notInspectedVans || [];
  const approveNew = data.approveNewVans || [];

  // Filters
  const [activeCategories, setActiveCategories] = useState([]); // empty = all
  const toggleCategory = (id) => setActiveCategories(
    activeCategories.includes(id)
      ? activeCategories.filter((c) => c !== id)
      : [...activeCategories, id]
  );

  // Derived counts (read from real data; fall back to mocked values when not present)
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const total = inspected.length;
  const withIssues = inspected.filter((v) => v.result === 'Flagged').length;
  const flaggedCount = inspected.filter((v) => v.result === 'Flagged').length;
  const incompleteCount = inspected.filter((v) => v.rawResult === 'incomplete').length;
  // Keys recorded — use real data if the parent passed it, else 0 (no mock fallback)
  const keysRecorded = data.keysRecordedReal ?? 0;

  // Primary vendor = the vendor (vendor org name) who did the most inspections
  // today. Excludes "—" entries (no inspector linked).
  const vendorCount = {};
  inspected.forEach((v) => {
    if (!v.vendor || v.vendor === '—') return;
    vendorCount[v.vendor] = (vendorCount[v.vendor] || 0) + 1;
  });
  const primaryVendor = Object.entries(vendorCount).sort((a, b) => b[1] - a[1])[0]?.[0];

  const filteredInspected = activeCategories.length
    ? inspected.filter((v) => activeCategories.includes(v.category))
    : inspected;

  // Click → open the report card. If the row carries an inspectionId
  // (live API data), the parent opens the LiveInspectionReportCard with
  // real photos + defects. Otherwise it falls back to the legacy mock
  // VehicleReportCard via fleetSnapshotVans lookup.
  const handleRowClick = (v) => {
    if (!onOpenVehicleReport) return;
    if (v.inspectionId) {
      onOpenVehicleReport({ __live: true, ...v });
      return;
    }
    const fleetVan = fleetSnapshotVans.find((fv) => fv.id === v.id);
    if (fleetVan) onOpenVehicleReport(fleetVan);
  };

  return (
    <div className="space-y-4">
      {/* Primary vendor chip */}
      {primaryVendor && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-blue/10 border border-accent-blue/30 text-xs">
          <span className="text-navy-400">{t('inspectedRenderer.primaryVendor', 'Primary Vendor today:')}</span>
          <span className="text-white font-semibold">{primaryVendor}</span>
        </div>
      )}

      {/* Stats band */}
      <div className="rounded-xl border border-navy-700/40 bg-navy-800/30 p-3">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound size={14} className="text-accent-blue" />
          <span className="text-sm font-semibold text-white">
            <span className="text-accent-blue">{keysRecorded}</span> {t('inspectedRenderer.keysRecordedLabel', 'keys recorded')}
          </span>
          <span className="text-[11px] text-navy-400">&middot; {timeStr}</span>
        </div>
        <div className="text-[11px] text-navy-300">
          <span className="text-white font-semibold">{total}</span> {t('inspectedRenderer.vehiclesLabel', 'vehicles')} &middot;{' '}
          <span className="text-accent-orange font-semibold">{withIssues}</span> {t('inspectedRenderer.withIssuesLabel', 'with issues')}
          {incompleteCount > 0 && (
            <>
              {' '}&middot;{' '}
              <span className="text-accent-red font-semibold">{incompleteCount}</span> {t('inspectedRenderer.notInspectableLabel', 'not inspectable')}
            </>
          )}
        </div>
      </div>

      {/* Result legend */}
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <span className="text-navy-500 uppercase tracking-wide font-semibold">{t('inspectedRenderer.statusLabel', 'Status:')}</span>
        {INSPECTED_LEGEND.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
            <span className={s.color}>{t(`inspectedRenderer.legend.${s.id}`, s.label)}</span>
          </div>
        ))}
      </div>

      {/* Category filter checkboxes */}
      <div>
        <div className="text-[10px] text-navy-400 uppercase tracking-wide font-semibold mb-2 flex items-center gap-1.5">
          <Info size={10} /> {t('inspectedRenderer.filterByVendor', 'Filter by inspecting vendor')}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {INSPECTOR_CATEGORIES.map((c) => {
            const active = activeCategories.includes(c.id);
            const count = inspected.filter((v) => v.category === c.id).length;
            return (
              <label key={c.id} title={t(`inspectedRenderer.inspectorCategories.${c.id}Desc`, c.description)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all ${
                  active
                    ? 'border-accent-blue/50 bg-accent-blue/10 text-white'
                    : 'border-navy-700 bg-navy-800/40 text-navy-300 hover:border-navy-600 hover:text-white'
                }`}>
                <input type="checkbox" checked={active} onChange={() => toggleCategory(c.id)} className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">{t(`inspectedRenderer.inspectorCategories.${c.id}`, c.label)}</span>
                <span className="text-[10px] text-navy-400">({count})</span>
              </label>
            );
          })}
          {activeCategories.length > 0 && (
            <button onClick={() => setActiveCategories([])}
              className="text-[11px] text-accent-red hover:underline">{t('inspectedRenderer.clear', 'Clear')}</button>
          )}
        </div>
      </div>

      {/* Inspected list */}
      <div>
        <h4 className="text-xs font-semibold text-accent-green mb-2 uppercase tracking-wide">
          {activeCategories.length > 0
            ? t('inspectedRenderer.inspectedHeadingFilteredFmt', { filtered: filteredInspected.length, total: inspected.length, defaultValue: `Inspected (${filteredInspected.length} of ${inspected.length})` })
            : t('inspectedRenderer.inspectedHeadingFmt', { filtered: filteredInspected.length, defaultValue: `Inspected (${filteredInspected.length})` })}
        </h4>
        <div className="space-y-1.5">
          {filteredInspected.map((v) => {
            const flagged = v.result === 'Flagged';
            const stateId = flagged ? 'defective' : 'clean';
            const sev = INSPECTED_LEGEND.find((s) => s.id === stateId);
            const cat = INSPECTOR_CATEGORIES.find((c) => c.id === v.category);
            const style = ROW_RESULT_STYLES[stateId];
            // All rows are clickable now — clicking opens the Vehicle Report Card
            // where defects can be approved (→ Create WO) or rejected.
            const clickable = !!onOpenVehicleReport;
            // Use real defect count from API when present; fall back to a
            // count-based heuristic for legacy mock rows.
            const defectCount = typeof v.defectCount === 'number'
              ? v.defectCount
              : v.result === 'Flagged' ? 3 : v.result === 'Passed' ? 0
              : 0;
            const isIncomplete = v.rawResult === 'incomplete';
            return (
              <div key={v.id}
                onClick={() => handleRowClick(v)}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-all ${style.bg} ${style.border} ${
                  clickable ? 'cursor-pointer hover:ring-1 hover:ring-white/20' : ''
                }`}>
                <div className="flex items-center gap-2 min-w-0 shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full ${sev?.dot || 'bg-navy-600'}`} />
                  <span className="text-sm font-semibold text-white font-mono">{v.id}</span>
                </div>
                <div className="flex-1 min-w-0 text-right">
                  <div className="text-xs truncate">
                    {isIncomplete ? (
                      <span className="font-semibold text-accent-red">{t('inspectedRenderer.notInspectable', 'Not inspectable')}</span>
                    ) : flagged && defectCount > 0 ? (
                      <DefectBreakdownInline
                        pending={v.defectPending ?? 0}
                        approved={v.defectApproved ?? 0}
                        rejected={v.defectRejected ?? 0}
                        total={defectCount}
                        fallbackClass={style.resultText}
                      />
                    ) : (
                      <span className={`font-semibold ${style.resultText}`}>{v.result}</span>
                    )}
                    {' '}<span className="text-navy-300">{t('inspectedRenderer.techPrefix', '— Tech:')}</span> <span className="text-white">{v.tech}</span>
                  </div>
                  <div className="text-[11px] text-navy-300 truncate">
                    {t('inspectedRenderer.vendorPrefix', 'Vendor:')} <span className="text-white font-medium">{v.vendor}</span>
                    {cat && <> <span className="text-navy-500">·</span> <Badge variant="blue">{t(`inspectedRenderer.inspectorCategories.${cat.id}`, cat.label)}</Badge></>}
                    {clickable && <span className="text-accent-blue ml-1">&rarr;</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredInspected.length === 0 && (
            <div className="text-center py-6 text-xs text-navy-400">{t('inspectedRenderer.noFilterMatch', 'No inspections match the selected filters.')}</div>
          )}
        </div>
        <p className="text-[10px] text-navy-500 mt-2 italic">{t('inspectedRenderer.clickTip', 'Tip: click any van to open its report — from there, approve defects (auto-create a work order) or reject them.')}</p>
      </div>

      {/* Not inspected list */}
      {notInspected.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-accent-red mb-2 uppercase tracking-wide">{t('inspectedRenderer.notInspectedHeadingFmt', { count: notInspected.length, defaultValue: `Not Inspected (${notInspected.length})` })}</h4>
          <div className="space-y-1.5">
            {notInspected.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 bg-navy-800/50 border border-navy-700/40 rounded-lg px-3 py-2">
                <span className="text-sm text-white font-medium font-mono">{v.id}</span>
                <span className="text-[11px] text-navy-300">{v.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approve new list */}
      {approveNew.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-accent-blue mb-2 uppercase tracking-wide">{t('inspectedRenderer.approveNewHeadingFmt', { count: approveNew.length, defaultValue: `Approve New (${approveNew.length})` })}</h4>
          <div className="space-y-1.5">
            {approveNew.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 bg-accent-blue/5 border border-accent-blue/20 rounded-lg px-3 py-2">
                <span className="text-sm text-white font-medium font-mono">{v.id}</span>
                <span className="text-[11px] text-navy-300">{v.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Immediate Action Required — Approve / Reject per defect ============
// Repair-type → display label. Mirrors the backend RepairType enum so the
// filter chips show the same vocabulary that drives auto-routing on the
// server side. AMR/CMR both fold into "Mechanical" since they share the
// same workshop pool — billing distinction isn't surfaced here.
const REPAIR_TYPE_LABELS = {
  mechanical: 'Mechanical',
  body:       'Body',
  tires:      'Tires',
  pm:         'PM',
  cnmr:       'Compliance',
  detailing:  'Detailing',
  netradyne:  'Netradyne',
};
const REPAIR_TYPE_ORDER = ['mechanical', 'body', 'tires', 'pm', 'cnmr', 'detailing', 'netradyne'];

function ImmediateDetailRenderer({ items, onApprove, onReject, onBulkApprove, onBulkReject }) {
  const { t } = useTranslation('dashboard');
  // Each row's identity is the defect's database id when available. Items
  // sourced from the live queue ALWAYS carry defectId; the mock fallback
  // rows don't (in which case we fall back to label = fleet_id). The
  // fallback isn't enough on its own — fleets routinely report multiple
  // defects on the same van, so two rows can share label "12". Using a
  // stable per-defect key here fixes two cascading bugs:
  //   1. React keyed reconciliation kept stale DOM from a previous render
  //      when keys collided, so a filtered list showed leftover rows.
  //   2. The `actions` map was keyed by label too, meaning approving one
  //      defect on van 12 silently marked all of van 12's defects approved.
  const keyOf = (it) => (it.defectId != null ? `d${it.defectId}` : `l${it.label}`);

  // Local state tracks which items were approved or rejected in this session
  const [actions, setActions] = useState({}); // { [keyOf(it)]: 'approved' | 'rejected' }
  // Category filter: null = show all; otherwise a RepairType enum value.
  const [categoryFilter, setCategoryFilter] = useState(null);
  // Set of defectIds the user has ticked for bulk action. Survives across
  // filter changes — switching from "Tires" back to "All" doesn't drop a
  // selection the user made under the Tires filter.
  const [selected, setSelected] = useState(() => new Set());
  // Flag set while a bulk action is in flight so we can disable the bar.
  const [bulkInFlight, setBulkInFlight] = useState(false);

  // Optimistic update — flip to approved/rejected immediately, then roll back
  // if the parent's async handler throws. The parent's onApprove/onReject
  // now wraps the V2.0 defectReviews API and re-throws on failure.
  const handleApprove = async (it) => {
    const k = keyOf(it);
    setActions((a) => ({ ...a, [k]: 'approved' }));
    try {
      await onApprove?.(it);
    } catch {
      setActions((a) => {
        const c = { ...a };
        delete c[k];
        return c;
      });
    }
  };
  const handleReject = async (it) => {
    const k = keyOf(it);
    setActions((a) => ({ ...a, [k]: 'rejected' }));
    try {
      await onReject?.(it);
    } catch {
      setActions((a) => {
        const c = { ...a };
        delete c[k];
        return c;
      });
    }
  };

  const pending = items.filter((it) => !actions[keyOf(it)]);
  const processed = items.filter((it) => actions[keyOf(it)]);
  // Processed list ALSO respects the category filter — otherwise the
  // user filters to "Body", approves one, switches to "Mechanical", and
  // the processed Body defect is still visible, making it feel like the
  // filter isn't working. Visible-processed only shows items in the
  // currently-selected category (or all when no filter is active).
  // (normRT is hoisted-defined below in `pending` block via const-after-use;
  // we inline the same normalization here to avoid the TDZ.)
  const _normRT2 = (rt) => (rt == null ? 'mechanical' : String(rt).trim().toLowerCase());
  const visibleProcessed = categoryFilter
    ? processed.filter((it) => _normRT2(it.repairType) === categoryFilter)
    : processed;
  const approvedCount = Object.values(actions).filter((a) => a === 'approved').length;
  const rejectedCount = Object.values(actions).filter((a) => a === 'rejected').length;

  // Bucket counts for the filter chips (only pending — processed items are
  // already gone from the bulk-action universe).
  // Normalize the repair_type string so case / whitespace mismatches between
  // backend payloads and our enum constants can't silently break the filter.
  const normRT = (rt) => (rt == null ? 'mechanical' : String(rt).trim().toLowerCase());
  const countsByCategory = pending.reduce((acc, it) => {
    const k = normRT(it.repairType);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  // Visible list after the category filter.
  const visiblePending = categoryFilter
    ? pending.filter((it) => normRT(it.repairType) === categoryFilter)
    : pending;

  const visiblePendingIds = visiblePending.map((it) => it.defectId).filter(Boolean);
  const allVisibleSelected =
    visiblePendingIds.length > 0 &&
    visiblePendingIds.every((id) => selected.has(id));

  const toggleSelected = (defectId) => {
    if (!defectId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(defectId)) next.delete(defectId);
      else next.add(defectId);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visiblePendingIds.forEach((id) => next.delete(id));
      } else {
        visiblePendingIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  // Resolve `selected` (a set of defect ids) back to the full item objects
  // so the bulk handlers can flip optimistic state by `keyOf(it)`.
  const selectedItems = pending.filter((it) => it.defectId && selected.has(it.defectId));

  const handleBulkApprove = async () => {
    if (selectedItems.length === 0 || !onBulkApprove) return;
    if (!window.confirm(
      t('immediateRenderer.confirmBulkApproveFmt', {
        count: selectedItems.length,
        defaultValue: `Approve ${selectedItems.length} defect${selectedItems.length === 1 ? '' : 's'} and auto-route each to the appropriate vendor?`,
      })
    )) return;
    setBulkInFlight(true);
    // Optimistic: flip every selected item to 'approved' up front, roll
    // back any individual failures by their per-defect key.
    const itemKeys = selectedItems.map(keyOf);
    setActions((a) => {
      const next = { ...a };
      itemKeys.forEach((k) => { next[k] = 'approved'; });
      return next;
    });
    try {
      const { failedKeys } = await onBulkApprove(selectedItems);
      if (failedKeys && failedKeys.length > 0) {
        setActions((a) => {
          const next = { ...a };
          failedKeys.forEach((k) => { delete next[k]; });
          return next;
        });
      }
      setSelected(new Set());
    } finally {
      setBulkInFlight(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedItems.length === 0 || !onBulkReject) return;
    if (!window.confirm(
      t('immediateRenderer.confirmBulkRejectFmt', {
        count: selectedItems.length,
        defaultValue: `Reject ${selectedItems.length} defect${selectedItems.length === 1 ? '' : 's'}?`,
      })
    )) return;
    setBulkInFlight(true);
    const itemKeys = selectedItems.map(keyOf);
    setActions((a) => {
      const next = { ...a };
      itemKeys.forEach((k) => { next[k] = 'rejected'; });
      return next;
    });
    try {
      const { failedKeys } = await onBulkReject(selectedItems);
      if (failedKeys && failedKeys.length > 0) {
        setActions((a) => {
          const next = { ...a };
          failedKeys.forEach((k) => { delete next[k]; });
          return next;
        });
      }
      setSelected(new Set());
    } finally {
      setBulkInFlight(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Summary band — when a filter is active, the pending chip shows
          "X of Y pending" so the user can see at a glance how the filter
          narrowed the list (vs. just the raw totals before). */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-navy-400">
          {categoryFilter
            ? t('immediateRenderer.summaryFilteredFmt', {
                category: REPAIR_TYPE_LABELS[categoryFilter] || categoryFilter,
                defaultValue: `Defects awaiting your approval · filtered to ${REPAIR_TYPE_LABELS[categoryFilter] || categoryFilter}`,
              })
            : t('immediateRenderer.summary', 'Defects awaiting your approval')}
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-gold/15 border border-accent-gold/40 text-accent-gold font-semibold">
          <Hourglass size={10} />{' '}
          {categoryFilter
            ? t('immediateRenderer.pendingChipFilteredFmt', {
                shown: visiblePending.length,
                total: pending.length,
                defaultValue: `${visiblePending.length} of ${pending.length} pending`,
              })
            : t('immediateRenderer.pendingChipFmt', { count: pending.length, defaultValue: `${pending.length} pending` })}
        </span>
        {approvedCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-green/15 border border-accent-green/40 text-accent-green font-semibold">
            <Check size={10} /> {t('immediateRenderer.approvedChipFmt', { count: approvedCount, defaultValue: `${approvedCount} approved` })}
          </span>
        )}
        {rejectedCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/40 text-accent-red font-semibold">
            <X size={10} /> {t('immediateRenderer.rejectedChipFmt', { count: rejectedCount, defaultValue: `${rejectedCount} rejected` })}
          </span>
        )}
      </div>

      {/* Category filter chips — only show categories that actually have
          pending defects. "All" stays first so the un-filtered view is one
          click away. When a filter IS active the non-selected chips dim
          so the locked-in selection reads at a glance. */}
      {pending.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setCategoryFilter(null)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${
              categoryFilter === null
                ? 'bg-accent-blue/20 border-accent-blue text-accent-blue ring-2 ring-accent-blue/30'
                : 'bg-navy-800/40 border-navy-700 text-navy-500 opacity-60 hover:opacity-100 hover:text-white hover:border-navy-600'
            }`}>
            {t('immediateRenderer.filterAll', 'All')}
            <span className="px-1 rounded bg-navy-700/50 text-navy-200">{pending.length}</span>
          </button>
          {REPAIR_TYPE_ORDER.filter((rt) => countsByCategory[rt] > 0).map((rt) => {
            const isActive = categoryFilter === rt;
            const isDimmed = categoryFilter !== null && !isActive;
            return (
              <button
                key={rt}
                onClick={() => setCategoryFilter(isActive ? null : rt)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-accent-blue/20 border-accent-blue text-accent-blue ring-2 ring-accent-blue/30'
                    : isDimmed
                      ? 'bg-navy-800/40 border-navy-700 text-navy-500 opacity-60 hover:opacity-100 hover:text-white hover:border-navy-600'
                      : 'bg-navy-800/40 border-navy-700 text-navy-400 hover:text-white hover:border-navy-600'
                }`}>
                {t(`immediateRenderer.filter.${rt}`, REPAIR_TYPE_LABELS[rt] || rt)}
                <span className="px-1 rounded bg-navy-700/50 text-navy-200">{countsByCategory[rt]}</span>
              </button>
            );
          })}
        </div>
      )}


      {visiblePending.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <h4 className="text-[10px] font-semibold text-accent-gold uppercase tracking-wide">
              {t('immediateRenderer.pendingHeadingFmt', { count: visiblePending.length, defaultValue: `Pending (${visiblePending.length})` })}
            </h4>
            {visiblePendingIds.length > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] text-navy-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  className="w-3.5 h-3.5 rounded cursor-pointer"
                />
                {allVisibleSelected
                  ? t('immediateRenderer.deselectAll', 'Deselect all')
                  : t('immediateRenderer.selectAllVisibleFmt', { count: visiblePendingIds.length, defaultValue: `Select all (${visiblePendingIds.length})` })}
              </label>
            )}
          </div>
          <div className="space-y-2">
            {visiblePending.map((it) => {
              const isChecked = it.defectId ? selected.has(it.defectId) : false;
              return (
                <div key={keyOf(it)}
                  className={`border rounded-lg p-3 transition-colors ${
                    isChecked
                      ? 'bg-accent-blue/5 border-accent-blue/40'
                      : 'bg-navy-800/40 border-navy-700/40'
                  }`}>
                  <div className="flex items-start gap-3 mb-2">
                    {it.defectId && (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelected(it.defectId)}
                        className="w-4 h-4 mt-1 rounded cursor-pointer shrink-0"
                        aria-label="Select defect for bulk action"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-semibold text-white font-mono">{it.label}</span>
                        {it.section && <Badge variant="gray">{it.section.split('. ')[1] || it.section}</Badge>}
                        {it.repairType && (
                          <Badge variant="blue">{REPAIR_TYPE_LABELS[it.repairType] || it.repairType}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-navy-200">{it.title}</p>
                      <p className="text-[11px] text-navy-400 mt-1">{it.meta}</p>
                    </div>
                    <Badge variant="gold" size="md">{t('immediateRenderer.pendingBadge', 'Pending')}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5 pt-2 border-t border-navy-700/40">
                    <button
                      onClick={() => handleReject(it)}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-accent-red text-[11px] font-semibold hover:bg-accent-red/20 cursor-pointer"
                    >
                      <X size={11} /> {t('immediateRenderer.reject', 'Reject')}
                    </button>
                    <button
                      onClick={() => handleApprove(it)}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-md bg-accent-green text-white text-[11px] font-semibold hover:opacity-90 cursor-pointer shadow-lg shadow-accent-green/20"
                    >
                      <Check size={11} /> {t('immediateRenderer.approveAndCreateWO', 'Approve & Create WO')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty-when-filtered hint — shows when the user picked a category
          that has nothing pending (rare but reachable via stale selection). */}
      {visiblePending.length === 0 && pending.length > 0 && (
        <div className="text-center py-8 rounded-lg border border-dashed border-navy-700/60 bg-navy-800/20">
          <p className="text-sm text-navy-300">{t('immediateRenderer.emptyForFilter', 'No defects in this category.')}</p>
          <button
            onClick={() => setCategoryFilter(null)}
            className="mt-2 text-[11px] text-accent-blue hover:underline cursor-pointer">
            {t('immediateRenderer.clearFilter', 'Show all categories')}
          </button>
        </div>
      )}

      {visibleProcessed.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-2">
            {t('immediateRenderer.processedHeadingFmt', { count: visibleProcessed.length, defaultValue: `Processed this session (${visibleProcessed.length})` })}
          </h4>
          <div className="space-y-1.5">
            {visibleProcessed.map((it) => {
              const action = actions[keyOf(it)];
              return (
                <div key={keyOf(it)} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                  action === 'approved' ? 'bg-accent-green/5 border-accent-green/30' : 'bg-accent-red/5 border-accent-red/30'
                }`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-white font-mono">{it.label}</span>
                    <span className="text-[11px] text-navy-300 truncate">{it.title}</span>
                  </div>
                  <Badge variant={action === 'approved' ? 'green' : 'red'} size="md">
                    {action === 'approved' ? <><Check size={9} className="inline mr-0.5" /> {t('immediateRenderer.approvedRow', 'Approved → WO')}</> : <><X size={9} className="inline mr-0.5" /> {t('immediateRenderer.rejectedRow', 'Rejected')}</>}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pending.length === 0 && processed.length === 0 && (
        <div className="text-center py-10">
          <CheckCheck size={40} className="text-navy-600 mx-auto mb-3" />
          <p className="text-sm text-white">{t('immediateRenderer.emptyState', 'No defects pending approval')}</p>
        </div>
      )}

      {/* Sticky bulk action bar — only renders when items are checked.
          Approve uses auto-routing (no manual vendor pick) so the bulk
          flow stays one-click; the single-row Approve button still opens
          the VendorPickerModal for granular control. */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex justify-center p-4">
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="pointer-events-auto bg-navy-900 border border-navy-700 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 flex-wrap max-w-xl w-full">
            <span className="text-sm font-semibold text-white">
              {t('immediateRenderer.bulkSelectedFmt', { count: selected.size, defaultValue: `${selected.size} selected` })}
            </span>
            <span className="text-[11px] text-navy-400 hidden sm:inline">
              {t('immediateRenderer.bulkAutoRouteHint', 'Auto-routed to each defect’s preferred vendor')}
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setSelected(new Set())}
                disabled={bulkInFlight}
                className="px-3 py-1.5 rounded-md text-[11px] text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer disabled:opacity-40">
                {t('immediateRenderer.bulkClear', 'Clear')}
              </button>
              <button
                onClick={handleBulkReject}
                disabled={bulkInFlight}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-red/15 border border-accent-red/40 text-accent-red text-[11px] font-semibold hover:bg-accent-red/25 cursor-pointer disabled:opacity-40">
                <X size={11} /> {t('immediateRenderer.bulkReject', 'Reject selected')}
              </button>
              <button
                onClick={handleBulkApprove}
                disabled={bulkInFlight}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-green text-white text-[11px] font-semibold hover:opacity-90 cursor-pointer shadow-lg shadow-accent-green/20 disabled:opacity-40">
                <Check size={11} /> {t('immediateRenderer.bulkApprove', 'Approve selected')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ============ Scheduled Repairs — split into Overnight + Shop buckets ============
function ScheduledRepairsGrouped({ items, onChanged }) {
  const overnight = items.filter((i) => i.repairBucket === 'overnight' || i.status === 'Rush Order');
  const shop = items.filter((i) => !(i.repairBucket === 'overnight' || i.status === 'Rush Order'));

  return (
    <div className="space-y-5">
      {overnight.length > 0 && (
        <section>
          <div className="mb-2 px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/30">
            <div className="flex items-center gap-2 mb-0.5">
              <Flame size={13} className="text-accent-red" />
              <h4 className="text-sm font-semibold text-accent-red">Overnight Repair</h4>
              <Badge variant="red">{overnight.length}</Badge>
            </div>
            <p className="text-[11px] text-navy-300 ml-5">Repair expected to be completed before dispatch time</p>
          </div>
          <div className="space-y-3">
            {overnight.map((it) => <ScheduledRepairItem key={it.woId || it.fleetId} item={it} onChanged={onChanged} />)}
          </div>
        </section>
      )}
      {shop.length > 0 && (
        <section>
          <div className="mb-2 px-3 py-2 rounded-lg bg-accent-orange/10 border border-accent-orange/30">
            <div className="flex items-center gap-2 mb-0.5">
              <Wrench size={13} className="text-accent-orange" />
              <h4 className="text-sm font-semibold text-accent-orange">Shop Repair</h4>
              <Badge variant="orange">{shop.length}</Badge>
            </div>
            <p className="text-[11px] text-navy-300 ml-5">Repair not likely to be completed before dispatch time</p>
          </div>
          <div className="space-y-3">
            {shop.map((it) => <ScheduledRepairItem key={it.woId || it.fleetId} item={it} onChanged={onChanged} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function CardDetailModal({
  cardKey, onClose, onOpenVehicleReport, onOrderFlexFleet,
  liveInspected, liveDefects, pendingReviewQueue, scheduledWoQueue, onQueueChanged,
}) {
  const { t } = useTranslation('dashboard');
  // Vendor picker overlay state for the Immediate-Action approve flow.
  // When a row's Approve button is clicked, we stash the item here and
  // open the picker; the actual `defectReviews.approve` call (with the
  // chosen vendor_workshop_id) fires from the picker's onConfirm.
  const [pickerItem, setPickerItem] = useState(null);
  if (!cardKey) return null;
  let data = cardDetails[cardKey];
  // Override the static English title with a localized one (the mock summary
  // stays as fallback only — both 'reported' and 'inspected' override it below).
  data = { ...data, title: t(`cardDetail.title.${cardKey}`, data.title) };
  // Override the 'immediate' card with the live /defect-reviews/queue payload
  // when available. Each item carries the real `defectId` so the renderer's
  // Approve/Reject buttons can hit defectReviews.approve / .reject directly.
  // Fallback to the static mock items if the queue hasn't loaded (e.g. when
  // the user opens the card before the parent's fetch completes).
  if (cardKey === 'immediate' && Array.isArray(pendingReviewQueue)) {
    const items = pendingReviewQueue.map((q) => ({
      // The label uses the DSP-facing fleet_id from Amazon Cortex (e.g.
      // "10" / "PR006") — the same code that shows up in MyFleet. The
      // backend's `fleet_id` field surfaces that as-typed, so the DSP
      // doesn't have to mentally translate the database primary key into
      // their fleet number. Falls back to the prefixed numeric id only
      // for older payloads that don't carry the fleet_id yet.
      label: q.fleetId
        ? String(q.fleetId)
        : `VAN-${String(q.vehicleId).padStart(4, '0')}`,
      title: `${q.part}${q.position ? ` (${q.position})` : ''} — ${(q.defectType || '').replace(/_/g, ' ')}`,
      meta: q.plate
        ? `Plate ${q.plate} · Reported ${new Date(q.reportedAt).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })} · ${Math.round(q.hoursPending)}h pending`
        : `Reported ${new Date(q.reportedAt).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })} · ${Math.round(q.hoursPending)}h pending`,
      section: q.source === 'inspection' ? 'Inspection' : 'Off-inspection',
      part: q.part,
      // Real backend defect id — used by the V2.0 approve / reject calls.
      defectId: q.id,
      // Carried through to the vendor picker so it can pre-filter
      // workshops to those eligible for this defect's repair_type.
      repairType: q.repairType || 'mechanical',
    }));
    data = {
      ...data,
      summary: items.length
        ? t('cardDetail.summary.immediateFmt', {
            count: items.length,
            defaultValue: `${items.length} ${items.length === 1 ? 'defect' : 'defects'} awaiting your approval`,
          })
        : t('cardDetail.summary.immediateEmpty', 'No defects pending approval'),
      items,
    };
  }
  // Override the 'scheduled' card with live work-orders data — same
  // pattern as 'immediate'. Each scheduled item carries the WO id so the
  // DSP's response/cancel buttons hit the right endpoint server-side.
  if (cardKey === 'scheduled' && Array.isArray(scheduledWoQueue)) {
    const fmtSlot = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleString([], {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    };
    const items = scheduledWoQueue.map((wo) => ({
      // The shape `ScheduledRepairItem` reads. The renderer treats
      // `repairBucket` ('overnight' | 'shop') to bucket the row.
      woId: wo.id,                           // 'WO-00042'
      // Show the DSP-registered fleet_id verbatim (matches My Fleet) when
      // present, falling back to the system-generated VAN-XXXX only if the
      // DSP never set one. Don't prefix the fleet_id with "VAN-" — the
      // customer's value is the source of truth as-typed.
      fleetId: wo.vehicleFleetId || wo.vehicleIdStr,
      vendor: wo.workshopName || '—',
      scheduledAt: fmtSlot(wo.scheduledAt),
      // Raw ISO kept around so the reschedule form can default to
      // "the day after the originally-proposed slot" — friendlier than
      // making the DSP build the date from scratch.
      rescheduleSeedIso: wo.scheduledAt || null,
      defect: wo.defects?.[0]
        ? `${wo.defects[0].part} — ${(wo.defects[0].defectType || '').replace(/_/g, ' ')}`
        : '—',
      status: wo.isRush ? 'Rush Order' : 'Scheduled',
      repairBucket: wo.repairBucket || 'shop',
      dspResponse: wo.dspResponse || null,   // 'confirmed' | 'not_available' | null
      keyLocation: wo.keyLocation || null,
    }));
    const overnight = items.filter((i) => i.repairBucket === 'overnight').length;
    const shop = items.filter((i) => i.repairBucket === 'shop').length;
    data = {
      ...data,
      summary: items.length
        ? t('cardDetail.summary.scheduledFmt', {
            overnight,
            shop,
            defaultValue: `${overnight} overnight · ${shop} shop`,
          })
        : t('cardDetail.summary.scheduledEmpty', 'No WOs scheduled in the next 36h'),
      scheduledItems: items,
    };
  }
  // Override the 'reported' card with live /defects/v2 data when present.
  // Map the v2 wire shape (camelCased) into the modal's flat item shape.
  if (cardKey === 'reported' && Array.isArray(liveDefects)) {
    const fmtTime = (iso) => {
      try {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {
        return '';
      }
    };
    const items = liveDefects.map((d) => {
      const partLabel = d.position ? `${d.part} (${d.position})` : d.part;
      const typeLabel = (d.defectType || '').replace(/_/g, ' ');
      return {
        label: d.vehicleId,
        title: `${partLabel} — ${typeLabel}`,
        meta: `${d.reportedBy || 'Driver'} · ${fmtTime(d.reportedAt)}`,
        status: 'Reported',
      };
    });
    data = {
      ...data,
      summary: items.length
        ? t('cardDetail.summary.reportedDefaultFmt', { count: items.length, defaultValue: `${items.length} defect${items.length === 1 ? '' : 's'} reported across fleet today` })
        : t('cardDetail.summary.reportedEmpty', 'No defects reported today'),
      items,
    };
  }
  // Override the 'inspected' card with the live API data when we have it.
  // This way the modal shows the same vans you just inspected via the wizard,
  // not the mock list.
  if (cardKey === 'inspected' && Array.isArray(liveInspected)) {
    const RESULT_TO_LABEL = {
      passed: 'Passed',
      conditional: 'Conditional',
      flagged: 'Flagged',
    };
    const REASON_TO_LABEL = {
      vehicle_wont_start: "Vehicle won't start",
      not_at_lot: 'Vehicle not at the lot',
      no_keys: 'Vehicle keys not present',
    };

    // Split: real inspections vs flagged-as-not-inspectable
    const reallyInspected = liveInspected.filter((i) => i.result !== 'incomplete');
    const incomplete = liveInspected.filter((i) => i.result === 'incomplete');

    // Keys recorded for today: take the first non-null value across the
    // session's inspections (set ONCE on session-start, copied to each row).
    const keysRecordedReal = liveInspected.find((i) => i.keysReceived != null)?.keysReceived ?? null;

    data = {
      ...data,
      summary: t('cardDetail.summary.inspectedFmt', {
        inspected: reallyInspected.length,
        incomplete: incomplete.length,
        defaultValue: `${reallyInspected.length} inspected · ${incomplete.length} not inspectable today`,
      }),
      inspectedVans: reallyInspected.map((i) => ({
        id: i.fleetId || i.vehicleId,
        inspectionId: i.id,
        vehicleId: i.vehicleId,
        vendor: i.vendor || '—',
        tech: i.inspector || '—',
        category: 'amr',
        defectCount: i.defectCount ?? 0,
        defectPending: i.defectCountPending ?? 0,
        defectApproved: i.defectCountApproved ?? 0,
        defectRejected: i.defectCountRejected ?? 0,
        result: RESULT_TO_LABEL[i.result] || i.result,
        rawResult: i.result,
        keysReceived: i.keysReceived,
      })),
      // Real "not inspected" list: vans the tech flagged with a reason
      notInspectedVans: incomplete.map((i) => ({
        id: i.fleetId || i.vehicleId,
        reason:
          REASON_TO_LABEL[i.incompleteReason] ||
          i.incompleteReason ||
          'Not inspected (no reason recorded)',
      })),
      // 'Approve new' is for a different workflow (newly activated vans
      // needing baseline DVIC). Empty until that flow is wired.
      approveNewVans: [],
      keysRecordedReal,
    };
  }
  const Icon = data.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
        className="bg-navy-900 border border-navy-700 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg bg-${data.accent}/10 flex items-center justify-center`}>
              <Icon size={20} className={`text-${data.accent}`} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">{data.title}</h3>
              <p className="text-xs text-navy-400">{data.summary}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white cursor-pointer p-1">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {cardKey === 'inspected' ? (
            <InspectedDetailRenderer data={data} onOpenVehicleReport={onOpenVehicleReport} />
          ) : cardKey === 'immediate' ? (
            <ImmediateDetailRenderer
              items={data.items}
              onApprove={async (it) => {
                // Items sourced from the live queue carry the real defectId;
                // mock-fallback rows don't, so skip silently if missing.
                if (!it.defectId) return;
                // Open the vendor picker — the actual approve+route call
                // fires from the picker's onConfirm once the DSP picks a
                // workshop (auto-suggested pre-selected). Reject the
                // optimistic-state promise so the row reverts to Pending
                // if the user cancels the picker.
                return new Promise((resolve, reject) => {
                  setPickerItem({ item: it, resolve, reject });
                });
              }}
              onReject={async (it) => {
                if (!it.defectId) return;
                const { defectReviews } = await import('../api/client');
                try {
                  await defectReviews.reject(it.defectId, {
                    reason: 'Rejected via Immediate Action panel',
                  });
                  onQueueChanged?.();
                } catch (err) {
                  alert(`Reject failed: ${err?.detail || err?.message || 'unknown'}`);
                  throw err;
                }
              }}
              onBulkApprove={async (itemsToApprove) => {
                // Bulk approve uses auto-routing (no vendor_workshop_id)
                // so the action stays one click for the DSP. The single-row
                // Approve button still opens the picker if they want manual
                // control for a specific defect. Returns { failedKeys }
                // (per-defect keys, NOT labels — fleet_ids collide when a
                // van has multiple defects) so the renderer can roll back
                // optimistic state for items that errored without nuking
                // the whole batch.
                const { defectReviews } = await import('../api/client');
                const results = await Promise.allSettled(
                  itemsToApprove.map((it) =>
                    defectReviews.approve(it.defectId, {
                      reason: 'Bulk-approved via Immediate Action panel',
                    })
                  )
                );
                const failedKeys = results
                  .map((r, i) => (r.status === 'rejected'
                    ? (itemsToApprove[i].defectId != null
                        ? `d${itemsToApprove[i].defectId}`
                        : `l${itemsToApprove[i].label}`)
                    : null))
                  .filter(Boolean);
                if (failedKeys.length > 0) {
                  alert(`Bulk approve: ${failedKeys.length} of ${itemsToApprove.length} failed. The successful ones were routed.`);
                }
                onQueueChanged?.();
                return { failedKeys };
              }}
              onBulkReject={async (itemsToReject) => {
                const { defectReviews } = await import('../api/client');
                const results = await Promise.allSettled(
                  itemsToReject.map((it) =>
                    defectReviews.reject(it.defectId, {
                      reason: 'Bulk-rejected via Immediate Action panel',
                    })
                  )
                );
                const failedKeys = results
                  .map((r, i) => (r.status === 'rejected'
                    ? (itemsToReject[i].defectId != null
                        ? `d${itemsToReject[i].defectId}`
                        : `l${itemsToReject[i].label}`)
                    : null))
                  .filter(Boolean);
                if (failedKeys.length > 0) {
                  alert(`Bulk reject: ${failedKeys.length} of ${itemsToReject.length} failed.`);
                }
                onQueueChanged?.();
                return { failedKeys };
              }}
            />
          ) : data.scheduledItems ? (
            <ScheduledRepairsGrouped
              items={data.scheduledItems}
              onChanged={onQueueChanged}
            />
          ) : data.groups ? (
            data.groups.map((g) => (
              <div key={g.heading}>
                <h4 className={`text-xs font-semibold mb-2 text-${g.color === 'green' ? 'accent-green' : g.color === 'red' ? 'accent-red' : 'accent-blue'}`}>{g.heading}</h4>
                <div className="space-y-1.5">
                  {g.items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between bg-navy-800/40 border border-navy-700/40 rounded-lg px-3 py-2">
                      <span className="text-sm text-white font-medium">{it.label}</span>
                      <span className="text-xs text-navy-400">{it.meta}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="space-y-2">
              {data.items.map((it, i) => (
                <div key={i} className="bg-navy-800/40 border border-navy-700/40 rounded-lg p-3 hover:bg-navy-800/60 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-white">{it.label}</span>
                        
                      </div>
                      <p className="text-sm text-navy-200">{it.title}</p>
                      <p className="text-xs text-navy-400 mt-1">{it.meta}</p>
                    </div>
                    {it.status && <Badge variant={defectStatusColors[it.status] || 'gray'} size="md">{it.status}</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-navy-800 flex items-center justify-between gap-2">
          {/* Order Flex Fleet — shown only on the Scheduled Repairs modal */}
          {cardKey === 'scheduled' && onOrderFlexFleet ? (
            <button onClick={onOrderFlexFleet}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-purple/15 border border-accent-purple/40 text-accent-purple text-sm font-semibold hover:bg-accent-purple/25 transition-colors cursor-pointer">
              <Truck size={14} /> {t('cardDetail.orderFlexFleet', 'Order Flex Fleet')}
            </button>
          ) : <span />}
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-navy-600 text-navy-300 text-sm font-medium hover:bg-navy-800 transition-colors cursor-pointer">
            {t('cardDetail.close', 'Close')}
          </button>
        </div>
      </motion.div>

      {/* Vendor picker for the Immediate-Action approve flow. The renderer's
          optimistic `setActions(approved)` happens before the picker resolves
          — onClose rejects so the row reverts to Pending if the DSP cancels. */}
      <VendorPickerModal
        open={!!pickerItem}
        repairType={pickerItem?.item?.repairType || 'mechanical'}
        defectSummary={pickerItem?.item?.title || ''}
        vehicleLabel={pickerItem?.item?.label || ''}
        onClose={() => {
          if (pickerItem) {
            pickerItem.reject?.(new Error('cancelled'));
            setPickerItem(null);
          }
        }}
        onConfirm={async (workshopId) => {
          const ctx = pickerItem;
          if (!ctx) return;
          try {
            const { defectReviews } = await import('../api/client');
            const res = await defectReviews.approve(ctx.item.defectId, {
              reason: 'Approved via Immediate Action panel',
              vendorWorkshopId: workshopId,
            });
            if (res?.routedWorkshopName) {
              alert(`✓ ${res.routedWorkOrderId || 'Work order'} routed to ${res.routedWorkshopName}`);
            }
            ctx.resolve?.();
            onQueueChanged?.();
          } catch (err) {
            alert(`Approve failed: ${err?.detail || err?.message || 'unknown'}`);
            ctx.reject?.(err);
          } finally {
            setPickerItem(null);
          }
        }}
      />
    </motion.div>
  );
}

const CATEGORY_OPTIONS = ['Tires', 'Lights', 'Body', 'Brakes', 'Fluids', 'Windshield', 'Mirrors', 'Doors', 'Other'];
const STATUS_OPTIONS = ['Logged', 'Scheduled', 'Repair Ordered', 'Rush Order'];

function CreateDefectModal({ onClose, onCreate }) {
  const { t } = useTranslation('dashboard');
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    van: '',
    reportedBy: '',
    category: '',
    desc: '',
    status: 'Logged',
    photo: false,
  });
  const [submitted, setSubmitted] = useState(false);

  const canNext1 = form.van.trim() && form.reportedBy.trim();
  const canNext2 = form.category && form.desc.trim();

  const handleSubmit = () => {
    onCreate({
      id: `D-${Math.floor(Math.random() * 9000) + 1000}`,
      da: form.reportedBy,
      van: form.van.toUpperCase().startsWith('VAN-') ? form.van.toUpperCase() : `VAN-${form.van}`,
      category: form.category,
      desc: form.desc,
      reportedAt: new Date().toISOString(),
      status: form.status,
      photo: form.photo,
    });
    setSubmitted(true);
    setTimeout(onClose, 1400);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
        className="bg-navy-900 border border-navy-700 rounded-2xl max-w-lg w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-blue/10 flex items-center justify-center">
              <Plus size={20} className="text-accent-blue" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">{t('createDefect.title', 'Create New Defect')}</h3>
              <p className="text-xs text-navy-400">{t('createDefect.stepFmt', { step, section: t(`createDefect.stepSection.${step}`, ['Vehicle', 'Defect details', 'Review & submit'][step - 1]), defaultValue: `Step ${step} of 3 — ${['Vehicle', 'Defect details', 'Review & submit'][step - 1]}` })}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white cursor-pointer p-1">
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-navy-800">
          <motion.div
            className="h-full bg-accent-blue"
            initial={{ width: 0 }}
            animate={{ width: `${(step / 3) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <div className="p-5">
          {submitted ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8"
            >
              <div className="w-16 h-16 mx-auto rounded-full bg-accent-green/15 flex items-center justify-center mb-3">
                <CheckCircle2 size={32} className="text-accent-green" />
              </div>
              <h4 className="text-lg font-semibold text-white mb-1">{t('createDefect.successTitle', 'Defect Created!')}</h4>
              <p className="text-sm text-navy-400">{t('createDefect.successBodyFmt', { van: form.van.toUpperCase().startsWith('VAN-') ? form.van.toUpperCase() : `VAN-${form.van}`, defaultValue: `${form.van.toUpperCase().startsWith('VAN-') ? form.van.toUpperCase() : `VAN-${form.van}`} added to Today's Defect Reports` })}</p>
            </motion.div>
          ) : (
            <>
              {step === 1 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-navy-300 mb-1.5">{t('createDefect.fleetIdLabel', 'Fleet ID *')}</label>
                    <input
                      type="text"
                      placeholder={t('createDefect.fleetIdPlaceholder', 'e.g. VAN-1042 or 1042')}
                      value={form.van}
                      onChange={(e) => setForm({ ...form, van: e.target.value })}
                      className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-navy-300 mb-1.5">{t('createDefect.reportedByLabel', 'Reported by (DA) *')}</label>
                    <select
                      value={form.reportedBy}
                      onChange={(e) => setForm({ ...form, reportedBy: e.target.value })}
                      className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer"
                    >
                      <option value="">{t('createDefect.selectDriver', 'Select driver…')}</option>
                      {daList.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-navy-300 mb-1.5">{t('createDefect.categoryLabel', 'Category *')}</label>
                      <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                        className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer"
                      >
                        <option value="">{t('createDefect.selectCategory', 'Select…')}</option>
                        {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{t(`createDefect.category.${c}`, c)}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-navy-300 mb-1.5">{t('createDefect.descriptionLabel', 'Description *')}</label>
                    <textarea
                      value={form.desc}
                      onChange={(e) => setForm({ ...form, desc: e.target.value })}
                      placeholder={t('createDefect.descriptionPlaceholder', 'Describe the defect...')}
                      rows={3}
                      className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue resize-none"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.photo}
                      onChange={(e) => setForm({ ...form, photo: e.target.checked })}
                      className="accent-accent-blue"
                    />
                    <span className="text-sm text-navy-200 flex items-center gap-1">
                      <Camera size={14} /> {t('createDefect.photoAttached', 'Photo attached')}
                    </span>
                  </label>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-3">
                  <div className="bg-navy-800/50 border border-navy-700 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-navy-400">{t('createDefect.reviewFleetId', 'Fleet ID:')}</span>
                      <span className="text-white font-semibold">{form.van.toUpperCase().startsWith('VAN-') ? form.van.toUpperCase() : `VAN-${form.van}`}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-navy-400">{t('createDefect.reviewDriver', 'Driver:')}</span>
                      <span className="text-white font-semibold">{daList.find(d => d.id === form.reportedBy)?.name || '—'}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-navy-400">{t('createDefect.reviewCategory', 'Category:')}</span>
                      <Badge variant="gray" size="md">{t(`createDefect.category.${form.category}`, form.category)}</Badge>
                    </div>
                    <div className="text-sm">
                      <div className="text-navy-400 mb-1">{t('createDefect.reviewDescription', 'Description:')}</div>
                      <div className="text-white">{form.desc}</div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-navy-300 mb-1.5">{t('createDefect.initialStatusLabel', 'Initial Status')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      {STATUS_OPTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => setForm({ ...form, status: s })}
                          className={`px-3 py-2 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                            form.status === s
                              ? 'bg-accent-blue/20 text-accent-blue border-accent-blue/50'
                              : 'border-navy-700 text-navy-400 hover:text-white'
                          }`}
                        >
                          {t(`createDefect.status.${s}`, s)}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>

        {!submitted && (
          <div className="p-4 border-t border-navy-800 flex justify-between gap-2">
            <button
              onClick={step === 1 ? onClose : () => setStep(step - 1)}
              className="px-4 py-2 rounded-lg border border-navy-600 text-navy-300 text-sm font-medium hover:bg-navy-800 transition-colors cursor-pointer"
            >
              {step === 1 ? t('createDefect.cancel', 'Cancel') : t('createDefect.back', 'Back')}
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
                className="px-5 py-2 rounded-lg bg-accent-blue text-white text-sm font-semibold disabled:opacity-40 hover:bg-accent-blue/80 transition-colors cursor-pointer"
              >
                {t('createDefect.next', 'Next')}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                className="px-5 py-2 rounded-lg bg-accent-green text-white text-sm font-semibold hover:bg-accent-green/80 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 size={16} /> {t('createDefect.createDefect', 'Create Defect')}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ============ QC Inspection Readiness — Daily Banner + Modal ============
const INSPECTION_VEHICLES = [
  { fleetId: 'VAN-5012', scheduledAt: 'Tonight, Apr 15 · 22:00 – 02:00', vendor: 'AMR', defect: 'Grinding noise — front brakes, feels spongy', status: 'Rush Order' },
  { fleetId: 'VAN-2009', scheduledAt: 'Tonight, Apr 15 · 20:00 – 23:00', vendor: 'Body Repairs', defect: 'Minor scratch on driver door', status: 'Scheduled' },
  { fleetId: 'VAN-1042', scheduledAt: 'Tonight, Apr 15 · 21:00 – 23:30', vendor: 'AMR', defect: 'Rear left tire tread below 3/32"', status: 'Scheduled' },
  { fleetId: 'VAN-3021', scheduledAt: 'Tonight, Apr 15 · 19:30 – 21:00', vendor: 'AMR', defect: 'Coolant reservoir below min', status: 'Scheduled' },
];

const PREVIOUS_PENDING = [
  { fleetId: 'VAN-6001', reason: 'Awaiting baseline DVIC approval', days: 2 },
  { fleetId: 'VAN-6002', reason: 'Awaiting baseline DVIC approval', days: 1 },
];

function InspectionReadinessBanner({ onClick }) {
  const { t } = useTranslation('dashboard');
  return (
    <motion.button
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="w-full mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-accent-green/40 bg-gradient-to-r from-accent-green/15 via-accent-blue/10 to-accent-purple/10 hover:from-accent-green/20 hover:via-accent-blue/15 hover:to-accent-purple/15 transition-all cursor-pointer group text-left"
    >
      <div className="w-10 h-10 rounded-lg bg-accent-green/20 border border-accent-green/40 flex items-center justify-center shrink-0">
        <Calendar size={18} className="text-accent-green" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-white">{t('readinessBanner.heading', 'QC DVIC Scheduled Tonight')}</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/40 text-accent-red text-[10px] font-semibold">
            {t('readinessBanner.actionRequired', 'Action Required')}
          </span>
        </div>
        <div className="text-xs text-navy-300">{t('readinessBanner.subtitleFmt', { count: INSPECTION_VEHICLES.length + 34, defaultValue: `Confirm QC inspection readiness — ${INSPECTION_VEHICLES.length + 34} vehicles scheduled for tonight` })}</div>
      </div>
      <div className="hidden sm:flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-white group-hover:bg-white/10 transition-all">
        {t('readinessBanner.review', 'Review')} <ChevronRight size={12} />
      </div>
    </motion.button>
  );
}

function InspectionVehicleRow({ item }) {
  const { t } = useTranslation('dashboard');
  const [dspResponse, setDspResponse] = useState('');
  const [keyLocation, setKeyLocation] = useState('');
  const [otherText, setOtherText] = useState('');

  const sev = defectStatusColors;
  const responseColor = dspResponse === 'Confirmed' ? 'border-accent-green/40 text-accent-green bg-accent-green/5'
    : dspResponse === 'Vehicle not available' ? 'border-accent-gold/40 text-accent-gold bg-accent-gold/5'
    : dspResponse === 'Cancel' ? 'border-accent-red/40 text-accent-red bg-accent-red/5'
    : 'border-navy-700 text-navy-200 bg-navy-800';

  return (
    <div className="bg-navy-800/40 border border-navy-700/40 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-semibold text-white">{item.fleetId}</span><Badge variant="gray">{item.vendor}</Badge>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-navy-300">
            <Clock size={12} className="text-accent-blue" />
            <span>{item.scheduledAt}</span>
          </div>
        </div>
        <Badge variant={defectStatusColors[item.status] || 'gray'} size="md">{item.status}</Badge>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-navy-500 mb-1">{t('scheduledRepair.defectToRepairLabel', 'Defect to repair')}</div>
        <div className="text-sm text-white">{item.defect}</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-navy-500 mb-1">{t('scheduledRepair.dspResponseLabel', 'DSP Response')}</label>
          <select value={dspResponse} onChange={(e) => setDspResponse(e.target.value)}
            className={`w-full rounded-lg px-3 py-2 text-sm border outline-none cursor-pointer transition-colors ${responseColor}`}>
            <option value="">{t('scheduledRepair.selectResponse', 'Select response…')}</option>
            {DSP_RESPONSE_OPTIONS.map((o) => <option key={o} value={o}>{t(`scheduledRepair.dspResponseOption.${o}`, o)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-navy-500 mb-1">{t('scheduledRepair.keyLocationLabel', 'Key Location')}</label>
          <select value={keyLocation} onChange={(e) => setKeyLocation(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-navy-200 outline-none focus:border-accent-blue cursor-pointer">
            <option value="">{t('scheduledRepair.selectLocation', 'Select location…')}</option>
            {KEY_LOCATION_OPTIONS.map((o) => <option key={o} value={o}>{t(`scheduledRepair.keyLocationOption.${o}`, o)}</option>)}
          </select>
        </div>
      </div>

      <AnimatePresence>
        {keyLocation === 'Other' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <label className="block text-[10px] uppercase tracking-wide text-navy-500 mb-1">{t('scheduledRepair.describeKeyLocation', 'Describe key location')}</label>
            <input type="text" value={otherText} onChange={(e) => setOtherText(e.target.value)} placeholder={t('scheduledRepair.keyLocationPlaceholder', 'e.g. Glove box, driver seat pocket…')}
              className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" autoFocus />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InspectionReadinessModal({ onClose }) {
  const { t } = useTranslation('dashboard');
  const [step, setStep] = useState('review'); // review | success
  const [globalKeyLocation, setGlobalKeyLocation] = useState('Van 4 cabin area');
  const [inspectorNotes, setInspectorNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const dspName = 'Pacific Northwest Logistics';
  const totalVehicles = 38;

  const handleConfirm = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setStep('success');
    }, 1100);
  };

  const handleSkip = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setStep('success');
    }, 700);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.92, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.92, opacity: 0 }}
        className="bg-navy-900 border border-navy-700 rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-navy-800 bg-gradient-to-r from-accent-green/10 to-accent-blue/5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent-green/20 border border-accent-green/40 flex items-center justify-center shrink-0">
                <ShieldCheck size={18} className="text-accent-green" fill="#22c55e" stroke="white" strokeWidth={2.2} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">{t('readinessModal.title', 'Your Quality Control DVIC is scheduled for tonight')}</h3>
                <div className="flex items-center gap-3 mt-1 text-xs text-navy-300 flex-wrap">
                  <span className="flex items-center gap-1"><Users size={11} className="text-accent-blue" /> {dspName}</span>
                  <span className="flex items-center gap-1"><Calendar size={11} className="text-accent-green" /> {t('readinessModal.totalVehiclesFmt', { count: totalVehicles, defaultValue: `${totalVehicles} total vehicles` })}</span>
                  <span className="flex items-center gap-1"><KeyRound size={11} className="text-accent-gold" /> {t('readinessModal.keysInLabel', 'Keys in:')} <span className="text-white font-medium">{globalKeyLocation}</span></span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-navy-400 hover:text-white p-1"><X size={18} /></button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {step === 'success' ? (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                className="w-16 h-16 mx-auto rounded-full bg-accent-green/15 border border-accent-green/40 flex items-center justify-center mb-4">
                <CheckCircle2 size={32} className="text-accent-green" />
              </motion.div>
              <h4 className="text-lg font-semibold text-white mb-1">{t('readinessModal.successTitle', 'QC Inspection Readiness Confirmed')}</h4>
              <p className="text-sm text-navy-400 mb-4">{t('readinessModal.successBodyFmt', { scheduled: INSPECTION_VEHICLES.length, pending: PREVIOUS_PENDING.length, defaultValue: `Inspectors have been notified. ${INSPECTION_VEHICLES.length} vehicles scheduled with defect work · ${PREVIOUS_PENDING.length} awaiting approval.` })}</p>
              <div className="inline-flex flex-col gap-1 px-4 py-3 rounded-lg bg-navy-800/60 border border-navy-700/40 text-left">
                <div className="text-[11px] text-navy-400">{t('readinessModal.confirmationId', 'Confirmation ID')}</div>
                <div className="text-sm font-mono text-accent-blue">QC-{new Date().getFullYear()}{String(new Date().getMonth() + 1).padStart(2, '0')}{String(new Date().getDate()).padStart(2, '0')}-{Math.floor(100 + Math.random() * 900)}</div>
              </div>
            </motion.div>
          ) : (
            <div className="space-y-5">
              {/* Previously awaiting approval */}
              {PREVIOUS_PENDING.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Hourglass size={12} className="text-accent-gold" />
                    <span className="text-xs font-semibold text-accent-gold uppercase tracking-wide">{t('readinessModal.previousPendingHeadingFmt', { count: PREVIOUS_PENDING.length, defaultValue: `Previously Awaiting Approval (${PREVIOUS_PENDING.length})` })}</span>
                  </div>
                  <div className="space-y-1.5">
                    {PREVIOUS_PENDING.map((p) => (
                      <div key={p.fleetId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-accent-gold/5 border border-accent-gold/20">
                        <div>
                          <div className="text-sm font-semibold text-white">{p.fleetId}</div>
                          <div className="text-[11px] text-navy-400">{p.reason}</div>
                        </div>
                        <Badge variant="gold" size="md">{t('readinessModal.daysPendingFmt', { count: p.days, defaultValue: `${p.days}d pending` })}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Global key location */}
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block flex items-center gap-1.5">
                  <KeyRound size={12} className="text-accent-gold" /> {t('readinessModal.defaultKeyLocation', 'Default key location (all vehicles)')}
                </label>
                <select
                  value={globalKeyLocation}
                  onChange={(e) => setGlobalKeyLocation(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer"
                >
                  <option value="Van 4 cabin area">{t('readinessModal.keyLocationOptions.vanCabin', 'Van 4 cabin area')}</option>
                  <option value="Cup holder">{t('readinessModal.keyLocationOptions.cupHolder', 'Cup holder')}</option>
                  <option value="Fuel compartment">{t('readinessModal.keyLocationOptions.fuelCompartment', 'Fuel compartment')}</option>
                  <option value="Key lockbox — dispatch">{t('readinessModal.keyLocationOptions.lockboxDispatch', 'Key lockbox — dispatch')}</option>
                  <option value="Other">{t('readinessModal.keyLocationOptions.other', 'Other')}</option>
                </select>
              </div>

              {/* Vehicles list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-navy-300 uppercase tracking-wide">{t('readinessModal.vehiclesScheduledFmt', { count: INSPECTION_VEHICLES.length, defaultValue: `Vehicles scheduled tonight (${INSPECTION_VEHICLES.length})` })}</span>
                </div>
                <div className="space-y-3">
                  {INSPECTION_VEHICLES.map((it) => (
                    <InspectionVehicleRow key={it.fleetId} item={it} />
                  ))}
                </div>
              </div>

              {/* Inspector notes */}
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block flex items-center gap-1.5">
                  <Info size={12} className="text-accent-blue" /> {t('readinessModal.inspectorNotesLabel', 'Important notes for Inspectors')}
                </label>
                <textarea
                  value={inspectorNotes}
                  onChange={(e) => setInspectorNotes(e.target.value)}
                  rows={3}
                  placeholder={t('readinessModal.inspectorNotesPlaceholder', 'e.g. Gate code 4827 · back lot entry only after 10pm · contact Maria if issues')}
                  className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' ? (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-navy-800 bg-navy-900/60">
            <button
              onClick={handleSkip}
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-navy-600 text-navy-300 text-sm font-medium hover:bg-navy-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              <SkipForward size={14} /> {t('readinessModal.skipTonight', 'Skip Tonight')}
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
            >
              {submitting ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> {t('readinessModal.confirming', 'Confirming…')}</>) : (<><CheckCircle2 size={14} /> {t('readinessModal.confirmReadiness', 'Confirm Readiness')}</>)}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end px-6 py-4 border-t border-navy-800">
            <button onClick={onClose} className="px-5 py-2 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 cursor-pointer">{t('readinessModal.done', 'Done')}</button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ============ Start New Inspection — Vendor/Technician workflow ============
// DSPs assigned to this inspector (assignment is managed from Admin panel)
const ASSIGNED_DSPS = [
  { id: 'DSP-4201', name: 'Safety First LLC',       code: 'RBR', station: 'DSE4', vanCount: 42, address: '13420 NE 20th St, Bellevue WA' },
  { id: 'DSP-4202', name: 'Ceiba Routes',     code: 'CBR', station: 'DSE4', vanCount: 38, address: '8015 Martin Way E, Lacey WA' },
  { id: 'DSP-4203', name: 'TOTL Logistics',   code: 'TTL', station: 'DWA6', vanCount: 51, address: '2200 Alaskan Way, Seattle WA' },
  { id: 'DSP-4204', name: 'Summit Express',   code: 'SEX', station: 'DWA6', vanCount: 29, address: '5005 Union Bay Pl NE, Seattle WA' },
  { id: 'DSP-4205', name: 'Redmond Routes',   code: 'RDM', station: 'DSE4', vanCount: 45, address: '15900 NE 83rd St, Redmond WA' },
];

const INSPECTION_FLEET = [
  { id: 'VAN-1042', model: '2022 Ford Transit 250',   dsp: 'Safety First LLC',     dspId: 'DSP-4201', plate: 'WA-8F42-AZ', lastInspection: '2 days ago' },
  { id: 'VAN-1018', model: '2021 Mercedes Sprinter',  dsp: 'Safety First LLC',     dspId: 'DSP-4201', plate: 'WA-3K18-AZ', lastInspection: '4 hours ago' },
  { id: 'VAN-1033', model: '2023 Ford Transit 250',   dsp: 'Safety First LLC',     dspId: 'DSP-4201', plate: 'WA-1K33-AZ', lastInspection: 'Yesterday' },
  { id: 'VAN-2009', model: '2022 Ford Transit 250',   dsp: 'Ceiba Routes',   dspId: 'DSP-4202', plate: 'WA-2P09-AZ', lastInspection: 'Yesterday' },
  { id: 'VAN-2015', model: '2023 Ram ProMaster 2500', dsp: 'Ceiba Routes',   dspId: 'DSP-4202', plate: 'WA-2G15-AZ', lastInspection: '3 days ago' },
  { id: 'VAN-2022', model: '2022 Mercedes Sprinter',  dsp: 'Ceiba Routes',   dspId: 'DSP-4202', plate: 'WA-2M22-AZ', lastInspection: '5 hours ago' },
  { id: 'VAN-3021', model: '2022 Ford Transit 350',   dsp: 'TOTL Logistics', dspId: 'DSP-4203', plate: 'WA-5H21-AZ', lastInspection: '6 hours ago' },
  { id: 'VAN-3044', model: '2023 Mercedes Sprinter',  dsp: 'TOTL Logistics', dspId: 'DSP-4203', plate: 'WA-6M44-AZ', lastInspection: 'Yesterday' },
  { id: 'VAN-4005', model: '2021 Ford Transit 250',   dsp: 'Summit Express', dspId: 'DSP-4204', plate: 'WA-4B05-AZ', lastInspection: '1 week ago' },
  { id: 'VAN-5008', model: '2022 Ram ProMaster 1500', dsp: 'Redmond Routes', dspId: 'DSP-4205', plate: 'WA-7R08-AZ', lastInspection: 'Today' },
  { id: 'VAN-5012', model: '2023 Ford Transit 350',   dsp: 'Redmond Routes', dspId: 'DSP-4205', plate: 'WA-7R12-AZ', lastInspection: '2 days ago' },
];


function InspectionSectionRow({ section, state, onStateChange }) {
  const { t } = useTranslation('dashboard');
  const isIssue = state?.status === 'issue';
  const isOk = state?.status === 'ok';

  const toggleDefect = (part) => {
    const current = state?.defects || [];
    const exists = current.find((d) => d.part === part);
    const next = exists
      ? current.filter((d) => d.part !== part)
      : [...current, { part, note: '' }];
    onStateChange({ ...state, defects: next });
  };

  const updateDefect = (part, field, value) => {
    const next = (state?.defects || []).map((d) => (d.part === part ? { ...d, [field]: value } : d));
    onStateChange({ ...state, defects: next });
  };

  return (
    <div className={`rounded-xl border transition-all ${
      isOk ? 'border-accent-green/40 bg-accent-green/5' :
      isIssue ? 'border-accent-orange/40 bg-accent-orange/5' :
      'border-navy-700/40 bg-navy-800/40'
    }`}>
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-md flex items-center justify-center ${
            isOk ? 'bg-accent-green/20' :
            isIssue ? 'bg-accent-orange/20' :
            'bg-navy-700/50'
          }`}>
            {isOk ? <CheckCircle2 size={14} className="text-accent-green" /> :
             isIssue ? <AlertTriangle size={14} className="text-accent-orange" /> :
             <ClipboardCheck size={14} className="text-navy-400" />}
          </div>
          <span className="text-sm font-semibold text-white">{t(`inspectionSection.sectionName.${section.name}`, section.name)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onStateChange({ status: 'ok', defects: [] })}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
              isOk
                ? 'bg-accent-green/20 border-accent-green/50 text-accent-green'
                : 'bg-navy-800 border-navy-700 text-navy-300 hover:border-navy-600'
            }`}
          >{t('inspectionSection.ok', '✓ OK')}</button>
          <button
            onClick={() => onStateChange({ status: 'issue', defects: state?.defects || [] })}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
              isIssue
                ? 'bg-accent-orange/20 border-accent-orange/50 text-accent-orange'
                : 'bg-navy-800 border-navy-700 text-navy-300 hover:border-navy-600'
            }`}
          >{t('inspectionSection.issue', '⚠ Issue')}</button>
        </div>
      </div>

      <AnimatePresence>
        {isIssue && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-2 border-t border-navy-700/40">
              <div className="text-[10px] uppercase tracking-wide text-navy-500 mt-3 mb-1">{t('inspectionSection.selectAffectedParts', 'Select affected parts')}</div>
              <div className="flex flex-wrap gap-1.5">
                {section.parts.map((part) => {
                  const selected = (state?.defects || []).find((d) => d.part === part);
                  return (
                    <button
                      key={part}
                      onClick={() => toggleDefect(part)}
                      className={`px-2.5 py-1 rounded-md text-xs border transition-all cursor-pointer ${
                        selected
                          ? 'bg-accent-orange/20 border-accent-orange/50 text-accent-orange font-semibold'
                          : 'bg-navy-800 border-navy-700 text-navy-300 hover:border-navy-600'
                      }`}
                    >
                      {selected && <Check size={10} className="inline mr-1" />}
                      {t(`inspectionSection.part.${part}`, part)}
                    </button>
                  );
                })}
              </div>

              {(state?.defects || []).length > 0 && (
                <div className="mt-3 space-y-2">
                  {state.defects.map((d) => (
                    <div key={d.part} className="bg-navy-900/60 border border-navy-700/40 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-white">{t(`inspectionSection.part.${d.part}`, d.part)}</span>
                      </div>
                      <input
                        type="text"
                        value={d.note}
                        onChange={(e) => updateDefect(d.part, 'note', e.target.value)}
                        placeholder={t('inspectionSection.defectPlaceholder', "Describe the defect (e.g. 'cracked lens, visible hairline')")}
                        className="w-full rounded-md px-2.5 py-1.5 text-xs bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StartInspectionModal({ user, onClose }) {
  const { t } = useTranslation('dashboard');
  const [step, setStep] = useState(1);
  const [dsp, setDsp] = useState(null);
  const [dspDropdownOpen, setDspDropdownOpen] = useState(false);
  const [vehicle, setVehicle] = useState(null);
  const [vehicleDropdownOpen, setVehicleDropdownOpen] = useState(false);
  const [mileage, setMileage] = useState('');
  const [odometerPhoto, setOdometerPhoto] = useState(null);
  const [sectionStates, setSectionStates] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [inspectionId, setInspectionId] = useState('');

  const totalSections = inspectionSections.length;
  const completedSections = Object.values(sectionStates).filter((s) => s?.status).length;
  const totalDefects = Object.values(sectionStates).reduce((sum, s) => sum + (s?.defects?.length || 0), 0);
  const okSections = Object.values(sectionStates).filter((s) => s?.status === 'ok').length;
  const issueSections = Object.values(sectionStates).filter((s) => s?.status === 'issue').length;

  // Vehicles filtered by the selected DSP
  const availableVehicles = dsp ? INSPECTION_FLEET.filter((v) => v.dspId === dsp.id) : [];

  const canGoStep2 = dsp && vehicle && mileage.length >= 3;
  const canSubmit = completedSections === totalSections;

  // Reset vehicle if DSP changes and the previously selected vehicle doesn't belong to the new DSP
  const handleSelectDsp = (selected) => {
    setDsp(selected);
    setDspDropdownOpen(false);
    if (vehicle && vehicle.dspId !== selected.id) {
      setVehicle(null);
    }
  };

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      const id = `INS-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
      setInspectionId(id);
      setSubmitting(false);
      setSuccess(true);
    }, 1200);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 280 }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-2xl w-full h-[95vh] sm:h-auto sm:max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-navy-800 bg-gradient-to-r from-accent-green/10 to-accent-blue/5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-accent-green/20 border border-accent-green/40 flex items-center justify-center shrink-0">
                <ShieldCheck size={18} className="text-accent-green" fill="#22c55e" stroke="white" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-white truncate">{t('startInspectionModal.title', 'Start New Inspection')}</h3>
                <p className="text-[11px] text-navy-400 truncate">{t('startInspectionModal.inspectorPrefix', 'Inspector:')} <span className="text-white font-medium">{user?.name || t('startInspectionModal.technicianFallback', 'Technician')}</span></p>
              </div>
            </div>
            <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2 shrink-0"><X size={20} /></button>
          </div>
        </div>

        {/* Progress bar */}
        {!success && (
          <div className="px-4 sm:px-6 pt-4">
            <div className="flex items-center gap-2 mb-3">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex-1 h-1 rounded-full bg-navy-800 overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-accent-green to-accent-blue"
                    initial={false}
                    animate={{ width: step >= s ? '100%' : '0%' }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-navy-400 mb-2 gap-1">
              <span className={`truncate ${step >= 1 ? 'text-white font-semibold' : ''}`}>{t('startInspectionModal.step1Label', '1. DSP & Vehicle')}</span>
              <span className={`truncate ${step >= 2 ? 'text-white font-semibold' : ''}`}>{t('startInspectionModal.step2Label', '2. Walkthrough')}</span>
              <span className={`truncate ${step >= 3 ? 'text-white font-semibold' : ''}`}>{t('startInspectionModal.step3Label', '3. Submit')}</span>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1">
          <AnimatePresence mode="wait">
            {success ? (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                  className="w-16 h-16 mx-auto rounded-full bg-accent-green/15 border border-accent-green/40 flex items-center justify-center mb-4">
                  <CheckCircle2 size={32} className="text-accent-green" />
                </motion.div>
                <h4 className="text-lg font-semibold text-white mb-1">{t('startInspectionModal.successTitle', 'Inspection Submitted')}</h4>
                <p className="text-sm text-navy-400 mb-4">
                  {totalDefects > 0
                    ? t('startInspectionModal.successDefectsFmt', { count: totalDefects, sections: issueSections, defaultValue: `${totalDefects} defect${totalDefects > 1 ? 's' : ''} reported across ${issueSections} section${issueSections > 1 ? 's' : ''}.` })
                    : t('startInspectionModal.successAllPassed', 'All sections passed — van is ready to roll.')}
                </p>
                <div className="inline-flex flex-col gap-1 px-4 py-3 rounded-lg bg-navy-800/60 border border-navy-700/40 text-left">
                  <div className="text-[11px] text-navy-400">{t('startInspectionModal.inspectionIdLabel', 'Inspection ID')}</div>
                  <div className="text-sm font-mono text-accent-blue">{inspectionId}</div>
                  <div className="text-[11px] text-navy-400 mt-1">{t('startInspectionModal.dspLabel', 'DSP:')} <span className="text-white">{dsp?.name}</span> · {t('startInspectionModal.vehicleSummaryLabel', 'Vehicle:')} <span className="text-white">{vehicle?.id}</span></div>
                  <div className="text-[11px] text-navy-400">{t('startInspectionModal.mileageLabel', 'Mileage:')} <span className="text-white">{Number(mileage).toLocaleString()} {t('startInspectionModal.milesShort', 'mi')}</span></div>
                </div>
                {totalDefects > 0 && (
                  <div className="mt-4 text-[11px] text-navy-400">
                    {t('startInspectionModal.workOrdersAutoFmt', { count: totalDefects, defaultValue: `Work orders for the ${totalDefects} defect${totalDefects > 1 ? 's' : ''} have been auto-created and dispatched.` })}
                  </div>
                )}
              </motion.div>
            ) : step === 1 ? (
              <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                {/* DSP selection */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block flex items-center gap-1.5">
                    <Users size={12} className="text-accent-blue" /> {t('startInspectionModal.dspFieldLabel', 'DSP (assigned from Admin)')}
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => setDspDropdownOpen((v) => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-navy-700 bg-navy-800/50 text-left hover:border-navy-600 transition-colors cursor-pointer min-h-[52px]"
                    >
                      {dsp ? (
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{dsp.name} <span className="text-navy-400 font-normal">({dsp.code})</span></div>
                          <div className="text-[11px] text-navy-400 truncate">{t('startInspectionModal.dspOptionSubFmt', { station: dsp.station, vans: dsp.vanCount, address: dsp.address, defaultValue: `Station ${dsp.station} · ${dsp.vanCount} vans · ${dsp.address}` })}</div>
                        </div>
                      ) : (
                        <span className="text-sm text-navy-400">{t('startInspectionModal.dspPlaceholder', 'Select the DSP to inspect…')}</span>
                      )}
                      <ChevronDown size={16} className={`text-navy-400 shrink-0 ml-2 transition-transform ${dspDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {dspDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setDspDropdownOpen(false)} />
                        <div className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-20">
                          {ASSIGNED_DSPS.map((d) => (
                            <button
                              key={d.id}
                              onClick={() => handleSelectDsp(d)}
                              className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-navy-800 transition-colors border-b border-navy-800/60 last:border-b-0 min-h-[56px] ${
                                dsp?.id === d.id ? 'bg-navy-800' : ''
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-white truncate">{d.name} <span className="text-navy-400 font-normal">({d.code})</span></div>
                                <div className="text-[11px] text-navy-400 truncate">{t('startInspectionModal.dspListSubFmt', { station: d.station, vans: d.vanCount, defaultValue: `Station ${d.station} · ${d.vanCount} vans` })}</div>
                              </div>
                              {dsp?.id === d.id && <Check size={14} className="text-accent-green shrink-0" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Vehicle selection — filtered by DSP */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block flex items-center gap-1.5">
                    <Wrench size={12} className="text-accent-green" /> {t('startInspectionModal.vehicleFieldLabel', 'Vehicle')}
                    {dsp && <span className="text-[10px] font-normal text-navy-500 ml-auto">{t('startInspectionModal.vehiclesLinkedFmt', { count: availableVehicles.length, code: dsp.code, defaultValue: `${availableVehicles.length} linked to ${dsp.code}` })}</span>}
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => dsp && setVehicleDropdownOpen((v) => !v)}
                      disabled={!dsp}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border text-left transition-colors min-h-[52px] ${
                        dsp
                          ? 'border-navy-700 bg-navy-800/50 hover:border-navy-600 cursor-pointer'
                          : 'border-navy-800 bg-navy-800/20 cursor-not-allowed opacity-60'
                      }`}
                    >
                      {vehicle ? (
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{vehicle.id} <span className="text-navy-400 font-normal">— {vehicle.model}</span></div>
                          <div className="text-[11px] text-navy-400 truncate">{t('startInspectionModal.vehicleOptionSubFmt', { plate: vehicle.plate, date: vehicle.lastInspection, defaultValue: `${vehicle.plate} · Last inspected ${vehicle.lastInspection}` })}</div>
                        </div>
                      ) : (
                        <span className="text-sm text-navy-400">{dsp ? t('startInspectionModal.vehicleEmptyWithDsp', 'Select a vehicle from this DSP…') : t('startInspectionModal.vehicleEmptyNoDsp', 'Pick a DSP first')}</span>
                      )}
                      <ChevronDown size={16} className={`text-navy-400 shrink-0 ml-2 transition-transform ${vehicleDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {vehicleDropdownOpen && dsp && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setVehicleDropdownOpen(false)} />
                        <div className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-20">
                          {availableVehicles.map((v) => (
                            <button
                              key={v.id}
                              onClick={() => { setVehicle(v); setVehicleDropdownOpen(false); }}
                              className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-navy-800 transition-colors border-b border-navy-800/60 last:border-b-0 min-h-[56px] ${
                                vehicle?.id === v.id ? 'bg-navy-800' : ''
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-white truncate">{v.id} <span className="text-navy-400 font-normal">— {v.model}</span></div>
                                <div className="text-[11px] text-navy-400 truncate">{t('startInspectionModal.vehicleListOptionSubFmt', { plate: v.plate, date: v.lastInspection, defaultValue: `${v.plate} · Last: ${v.lastInspection}` })}</div>
                              </div>
                              {vehicle?.id === v.id && <Check size={14} className="text-accent-green shrink-0" />}
                            </button>
                          ))}
                          {availableVehicles.length === 0 && (
                            <div className="px-4 py-6 text-center text-xs text-navy-400">{t('startInspectionModal.noVehicles', 'No vehicles registered for this DSP.')}</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Mileage */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('startInspectionModal.mileageInputLabel', 'Current odometer reading (miles)')}</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={mileage}
                    onChange={(e) => setMileage(e.target.value)}
                    placeholder={t('startInspectionModal.mileageInputPlaceholder', 'e.g. 48250')}
                    className="w-full rounded-lg px-4 py-3 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
                  />
                </div>

                {/* Odometer photo */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('startInspectionModal.odometerPhotoLabel', 'Odometer photo (optional)')}</label>
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
                          <div className="text-white">{t('startInspectionModal.takePhotoOrUpload', 'Take a photo or upload one')}</div>
                          <div className="text-navy-400">{t('startInspectionModal.jpgPngHint', 'JPG/PNG — speeds up mileage audit')}</div>
                        </>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && setOdometerPhoto({ name: e.target.files[0].name, size: e.target.files[0].size })}
                    />
                  </label>
                </div>
              </motion.div>
            ) : step === 2 ? (
              <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs text-navy-400">{t('startInspectionModal.step2Instruction', 'Mark each section as OK or report issues.')}</div>
                  <div className="text-[11px] text-navy-400">
                    <span className="text-accent-green font-semibold">{okSections}</span> {t('startInspectionModal.statOk', 'OK')} ·
                    <span className="text-accent-orange font-semibold ml-1">{issueSections}</span> {t('startInspectionModal.statIssues', 'Issues')} ·
                    <span className="text-white font-semibold ml-1">{t('startInspectionModal.completedTotalFmt', { completed: completedSections, total: totalSections, defaultValue: `${completedSections}/${totalSections}` })}</span>
                  </div>
                </div>
                {inspectionSections.map((sec) => (
                  <InspectionSectionRow
                    key={sec.id}
                    section={sec}
                    state={sectionStates[sec.id]}
                    onStateChange={(next) => setSectionStates({ ...sectionStates, [sec.id]: next })}
                  />
                ))}
                {!canSubmit && completedSections > 0 && (
                  <div className="flex items-center gap-2 text-xs text-accent-orange bg-accent-orange/10 border border-accent-orange/30 rounded-lg px-3 py-2 mt-2">
                    <AlertTriangle size={12} /> {t('startInspectionModal.sectionsRemainingFmt', { count: totalSections - completedSections, defaultValue: `${totalSections - completedSections} section${totalSections - completedSections > 1 ? 's' : ''} remaining before you can submit.` })}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <div className="text-xs text-navy-400">{t('startInspectionModal.step3Instruction', 'Review before submitting.')}</div>
                <div className="rounded-xl border border-navy-700/60 bg-navy-800/40 p-4 space-y-2">
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400 shrink-0">{t('startInspectionModal.reviewDsp', 'DSP')}</span><span className="text-white font-semibold text-right truncate">{dsp?.name} <span className="text-navy-400 font-normal">({dsp?.code})</span></span></div>
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400 shrink-0">{t('startInspectionModal.reviewStation', 'Station')}</span><span className="text-white text-right">{dsp?.station}</span></div>
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400 shrink-0">{t('startInspectionModal.reviewVehicle', 'Vehicle')}</span><span className="text-white font-semibold text-right truncate">{vehicle?.id} · {vehicle?.model}</span></div>
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400 shrink-0">{t('startInspectionModal.reviewOdometer', 'Odometer')}</span><span className="text-white text-right">{Number(mileage).toLocaleString()} {t('startInspectionModal.milesShort', 'mi')}</span></div>
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400 shrink-0">{t('startInspectionModal.reviewInspector', 'Inspector')}</span><span className="text-white text-right truncate">{user?.name || t('startInspectionModal.technicianFallback', 'Technician')}</span></div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-accent-green/30 bg-accent-green/5 p-3 text-center">
                    <CheckCircle2 size={16} className="mx-auto text-accent-green mb-1" />
                    <div className="text-[10px] text-navy-400">{t('startInspectionModal.statOk', 'OK')}</div>
                    <div className="text-sm font-bold text-white">{okSections}</div>
                  </div>
                  <div className="rounded-lg border border-accent-orange/30 bg-accent-orange/5 p-3 text-center">
                    <AlertTriangle size={16} className="mx-auto text-accent-orange mb-1" />
                    <div className="text-[10px] text-navy-400">{t('startInspectionModal.statIssues', 'Issues')}</div>
                    <div className="text-sm font-bold text-white">{issueSections}</div>
                  </div>
                  <div className="rounded-lg border border-accent-red/30 bg-accent-red/5 p-3 text-center">
                    <Wrench size={16} className="mx-auto text-accent-red mb-1" />
                    <div className="text-[10px] text-navy-400">{t('startInspectionModal.statDefects', 'Defects')}</div>
                    <div className="text-sm font-bold text-white">{totalDefects}</div>
                  </div>
                </div>
                {totalDefects > 0 && (
                  <div className="rounded-lg border border-navy-700/40 bg-navy-800/40 p-3">
                    <div className="text-[11px] font-semibold text-navy-300 uppercase tracking-wide mb-2">{t('startInspectionModal.defectsDetected', 'Defects detected')}</div>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {Object.entries(sectionStates).flatMap(([secId, state]) => {
                        const sec = inspectionSections.find((s) => s.id === secId);
                        return (state?.defects || []).map((d) => (
                          <div key={`${secId}-${d.part}`} className="flex items-center justify-between text-xs py-1">
                            <span className="text-white">{sec ? t(`inspectionSection.sectionName.${sec.name}`, sec.name).split('. ')[1] : ''} · {t(`inspectionSection.part.${d.part}`, d.part)}</span>

                          </div>
                        ));
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        {!success && (
          <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80 backdrop-blur">
            <button
              onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 transition-colors cursor-pointer"
            >{step === 1 ? t('startInspectionModal.cancel', 'Cancel') : t('startInspectionModal.back', 'Back')}</button>
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 ? !canGoStep2 : !canSubmit}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-green to-accent-blue text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >{t('startInspectionModal.next', 'Next')} <ArrowRight size={14} /></button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-green to-accent-blue text-white hover:opacity-90 disabled:opacity-40 transition-all cursor-pointer"
              >
                {submitting ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> {t('startInspectionModal.submitting', 'Submitting…')}</>) : (<>{t('startInspectionModal.submit', 'Submit')} <Check size={14} /></>)}
              </button>
            )}
          </div>
        )}
        {success && (
          <div className="flex items-center justify-end px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800">
            <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 cursor-pointer">{t('startInspectionModal.done', 'Done')}</button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// Feedback attribute catalog for repair history thumbs up/down
const REPAIR_FEEDBACK_ATTRIBUTES = ['Turnaround Time', 'Communication', 'Professionalism', 'Work Quality', 'Price'];

// Compact thumbs-up / thumbs-down feedback control with attribute dropdown.
// Used inline on each row of the Defects Repaired history list so the DSP
// can rate the vendor's work without leaving the page.
function RepairFeedback({ woId, feedback, onChange }) {
  const { t } = useTranslation('dashboard');
  const [openDir, setOpenDir] = useState(null); // 'up' | 'down' | null
  const current = feedback?.[woId];

  const selectAttribute = (dir, attr) => {
    onChange({ ...feedback, [woId]: { vote: dir, attribute: attr } });
    setOpenDir(null);
  };

  const clear = (e) => {
    e.stopPropagation();
    const next = { ...feedback };
    delete next[woId];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="relative">
        <button
          onClick={(e) => { e.stopPropagation(); setOpenDir(openDir === 'up' ? null : 'up'); }}
          title={current?.vote === 'up'
            ? t('repairFeedback.positiveTitleFmt', { attribute: t(`repairFeedback.attribute.${current.attribute}`, current.attribute), defaultValue: `Positive: ${current.attribute}` })
            : t('repairFeedback.givePositive', 'Give positive feedback')}
          className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] transition-all cursor-pointer ${
            current?.vote === 'up'
              ? 'bg-accent-green/20 border-accent-green/50 text-accent-green'
              : 'bg-navy-800 border-navy-700 text-navy-400 hover:text-accent-green hover:border-accent-green/40'
          }`}
        >
          <ThumbsUp size={12} className={current?.vote === 'up' ? 'fill-current' : ''} />
          <ChevronDown size={9} />
        </button>
        <AnimatePresence>
          {openDir === 'up' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenDir(null)} />
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="absolute top-full right-0 mt-1 w-48 bg-navy-900 border border-accent-green/40 rounded-lg shadow-2xl z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-navy-800 bg-accent-green/10 text-[10px] font-semibold text-accent-green uppercase tracking-wide">
                  {t('repairFeedback.mostImpressive', 'Most impressive attribute')}
                </div>
                {REPAIR_FEEDBACK_ATTRIBUTES.map((attr) => (
                  <button key={attr} onClick={() => selectAttribute('up', attr)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-white hover:bg-accent-green/10 border-b border-navy-800/60 last:border-b-0">
                    <span>{t(`repairFeedback.attribute.${attr}`, attr)}</span>
                    {current?.vote === 'up' && current?.attribute === attr && <Check size={11} className="text-accent-green" />}
                  </button>
                ))}
                {current?.vote === 'up' && (
                  <button onClick={clear}
                    className="w-full px-3 py-2 text-[11px] text-navy-400 hover:text-accent-red border-t border-navy-800">{t('repairFeedback.clear', 'Clear feedback')}</button>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <div className="relative">
        <button
          onClick={(e) => { e.stopPropagation(); setOpenDir(openDir === 'down' ? null : 'down'); }}
          title={current?.vote === 'down'
            ? t('repairFeedback.issueTitleFmt', { attribute: t(`repairFeedback.attribute.${current.attribute}`, current.attribute), defaultValue: `Issue: ${current.attribute}` })
            : t('repairFeedback.reportIssue', 'Report an issue')}
          className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] transition-all cursor-pointer ${
            current?.vote === 'down'
              ? 'bg-accent-red/20 border-accent-red/50 text-accent-red'
              : 'bg-navy-800 border-navy-700 text-navy-400 hover:text-accent-red hover:border-accent-red/40'
          }`}
        >
          <ThumbsDown size={12} className={current?.vote === 'down' ? 'fill-current' : ''} />
          <ChevronDown size={9} />
        </button>
        <AnimatePresence>
          {openDir === 'down' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenDir(null)} />
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="absolute top-full right-0 mt-1 w-48 bg-navy-900 border border-accent-red/40 rounded-lg shadow-2xl z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-navy-800 bg-accent-red/10 text-[10px] font-semibold text-accent-red uppercase tracking-wide">
                  {t('repairFeedback.biggestIssue', 'Biggest issue')}
                </div>
                {REPAIR_FEEDBACK_ATTRIBUTES.map((attr) => (
                  <button key={attr} onClick={() => selectAttribute('down', attr)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-white hover:bg-accent-red/10 border-b border-navy-800/60 last:border-b-0">
                    <span>{t(`repairFeedback.attribute.${attr}`, attr)}</span>
                    {current?.vote === 'down' && current?.attribute === attr && <Check size={11} className="text-accent-red" />}
                  </button>
                ))}
                {current?.vote === 'down' && (
                  <button onClick={clear}
                    className="w-full px-3 py-2 text-[11px] text-navy-400 hover:text-accent-green border-t border-navy-800">{t('repairFeedback.clear', 'Clear feedback')}</button>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============ Repair History Modal — Completed defects timeline ============
function RepairHistoryModal({ repairedWOs, user, onClose }) {
  const { t } = useTranslation('dashboard');
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState({}); // { [woId]: { vote: 'up'|'down', attribute } }

  // Sort by most recently completed first
  const sorted = [...repairedWOs].sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

  const filtered = search
    ? sorted.filter((wo) => {
        const s = search.toLowerCase();
        return (
          wo.vehicleId.toLowerCase().includes(s) ||
          (wo.fleetId || '').toLowerCase().includes(s) ||
          wo.description.toLowerCase().includes(s) ||
          (wo.assignedTechnician || '').toLowerCase().includes(s)
        );
      })
    : sorted;

  // Stats
  const turnaroundHours = sorted
    .filter((wo) => wo.completedAt && wo.createdAt)
    .map((wo) => (new Date(wo.completedAt) - new Date(wo.createdAt)) / (1000 * 60 * 60));
  const avgTurnaround = turnaroundHours.length > 0
    ? Math.round(turnaroundHours.reduce((s, h) => s + h, 0) / turnaroundHours.length)
    : 0;

  // Most common defect section
  const sectionCounts = {};
  sorted.forEach((wo) => {
    sectionCounts[wo.section] = (sectionCounts[wo.section] || 0) + 1;
  });
  const topSection = Object.entries(sectionCounts).sort((a, b) => b[1] - a[1])[0];

  // Unique vendors + technicians
  const uniqueTechs = new Set(sorted.map((wo) => wo.assignedTechnician).filter(Boolean)).size;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 280 }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-3xl w-full h-[95vh] sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-navy-800 bg-gradient-to-r from-accent-green/10 to-navy-900">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent-green/15 border border-accent-green/40 flex items-center justify-center">
                <CheckCheck size={18} className="text-accent-green" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">{t('repairHistoryModal.title', 'Defects Repaired — History')}</h3>
                <p className="text-[11px] text-navy-400">{t('repairHistoryModal.subtitleFmt', { org: user?.role === 'dsp_owner' ? user.org : t('repairHistoryModal.yourFleetFallback', 'your fleet'), defaultValue: `Full audit trail of completed work orders for ${user?.role === 'dsp_owner' ? user.org : 'your fleet'}` })}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2 shrink-0"><X size={20} /></button>
          </div>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
              <div className="text-[10px] text-navy-400 uppercase tracking-wide">{t('repairHistoryModal.totalRepaired', 'Total repaired')}</div>
              <div className="text-base font-bold text-accent-green">{sorted.length}</div>
            </div>
            <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
              <div className="text-[10px] text-navy-400 uppercase tracking-wide">{t('repairHistoryModal.avgTurnaround', 'Avg turnaround')}</div>
              <div className="text-base font-bold text-white">{avgTurnaround}{t('repairHistoryModal.hoursShort', 'h')}</div>
            </div>
            <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
              <div className="text-[10px] text-navy-400 uppercase tracking-wide">{t('repairHistoryModal.technicians', 'Technicians')}</div>
              <div className="text-base font-bold text-white">{uniqueTechs}</div>
            </div>
            <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
              <div className="text-[10px] text-navy-400 uppercase tracking-wide">{t('repairHistoryModal.topSection', 'Top section')}</div>
              <div className="text-xs font-bold text-white truncate">{topSection ? t(`inspectionSection.sectionName.${topSection[0]}`, topSection[0]).split('. ')[1] : t('repairHistoryModal.emptyValue', '—')}</div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 sm:px-6 py-3 border-b border-navy-800">
          <div className="relative">
            <Info size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t('repairHistoryModal.searchPlaceholder', 'Search by van, defect or technician…')}
              className="w-full rounded-lg pl-9 pr-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green" />
          </div>
        </div>

        {/* Timeline */}
        <div className="px-4 sm:px-6 py-4 overflow-y-auto flex-1 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-10">
              <CheckCheck size={40} className="text-navy-600 mx-auto mb-2" />
              <p className="text-sm text-white">{search ? t('repairHistoryModal.noMatch', 'No repair history matches your search') : t('repairHistoryModal.noHistory', 'No repair history yet')}</p>
              <p className="text-xs text-navy-400">{search ? t('repairHistoryModal.tryDifferentKeyword', 'Try a different keyword') : t('repairHistoryModal.asVendorsComplete', 'As vendors complete work orders, they appear here')}</p>
            </div>
          ) : (
            filtered.map((wo) => {
              const isExpanded = expanded === wo.id;
              const turnaroundH = wo.completedAt && wo.createdAt
                ? Math.round((new Date(wo.completedAt) - new Date(wo.createdAt)) / (1000 * 60 * 60))
                : null;
              const completedNote = (wo.notes || []).find((n) => n.startsWith('Completed:'));
              const dispatcherNote = (wo.notes || []).find((n) => n.startsWith('Dispatcher:'));

              return (
                <motion.div key={wo.id} layout
                  className={`rounded-xl border transition-all overflow-hidden ${
                    isExpanded ? 'border-accent-green/40 bg-accent-green/5' : 'border-navy-700/40 bg-navy-800/30 hover:border-navy-600/60'
                  }`}>
                  <button onClick={() => setExpanded(isExpanded ? null : wo.id)}
                    className="w-full text-left px-4 py-3">
                    <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="green" size="md"><CheckCheck size={10} className="inline mr-0.5" /> {t('repairHistoryModal.completedBadge', 'Completed')}</Badge>
                          <span className="text-xs font-mono text-accent-green">{wo.id}</span>
                          {wo.flags?.includes('rush_order') && <Badge variant="red"><Flame size={9} className="inline mr-0.5" /> {t('repairHistoryModal.rushOrderBadge', 'Rush Order')}</Badge>}
                        </div>
                        <div className="text-sm font-semibold text-white">{wo.description}</div>
                        <div className="text-[11px] text-navy-400 mt-0.5">{wo.section} · {wo.part}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <RepairFeedback woId={wo.id} feedback={feedback} onChange={setFeedback} />
                        <div className="text-right">
                          <div className="text-[11px] text-navy-400">{t('repairHistoryModal.completedLabel', 'Completed')}</div>
                          <div className="text-xs text-white">{new Date(wo.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                          <div className="text-[10px] text-navy-500">{new Date(wo.completedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2 text-[11px] flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap text-navy-300">
                        <span className="flex items-center gap-1"><Wrench size={10} className="text-accent-green" /> {wo.assignedTechnician || t('repairHistoryModal.emptyValue', '—')}</span>
                        <span className="text-navy-600">·</span>
                        <span>{wo.fleetId || wo.vehicleId}</span>
                        {turnaroundH !== null && (
                          <>
                            <span className="text-navy-600">·</span>
                            <span className="flex items-center gap-1"><Clock size={10} className="text-accent-blue" /> {t('repairHistoryModal.turnaroundFmt', { count: turnaroundH, defaultValue: `${turnaroundH}h turnaround` })}</span>
                          </>
                        )}
                      </div>
                      <ChevronRight size={12} className={`text-navy-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </div>
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                        className="overflow-hidden border-t border-navy-700/40">
                        <div className="px-4 py-3 space-y-3">
                          {/* Timeline */}
                          <div>
                            <div className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-2">{t('repairHistoryModal.repairTimeline', 'Repair timeline')}</div>
                            <div className="space-y-2">
                              <TimelineItem
                                icon={AlertTriangle}
                                color="accent-orange"
                                label={t('repairHistoryModal.defectReported', 'Defect reported')}
                                time={new Date(wo.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                detail={wo.reportedBy}
                              />
                              <TimelineItem
                                icon={PlayCircle}
                                color="accent-blue"
                                label={t('repairHistoryModal.assignedToFmt', { name: wo.assignedTechnician, defaultValue: `Assigned to ${wo.assignedTechnician}` })}
                                time={t('repairHistoryModal.dispatcherAccepted', 'Dispatcher accepted')}
                                detail={dispatcherNote ? dispatcherNote.replace('Dispatcher: ', '') : t('repairHistoryModal.workOrderDispatched', 'Work order dispatched')}
                              />
                              <TimelineItem
                                icon={CheckCircle2}
                                color="accent-green"
                                label={t('repairHistoryModal.workCompleted', 'Work completed')}
                                time={new Date(wo.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                detail={completedNote ? completedNote.replace('Completed: ', '') : t('repairHistoryModal.workOrderClosed', 'Work order closed')}
                              />
                            </div>
                          </div>

                          {/* Details grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                            <DetailBox label={t('repairHistoryModal.detailVan', 'Van')} value={wo.fleetId || wo.vehicleId} />
                            <DetailBox label={t('repairHistoryModal.detailYearModel', 'Year/Model')} value={`${wo.year} ${wo.make} ${wo.model}`} />
                            <DetailBox label={t('repairHistoryModal.detailPlate', 'Plate')} value={wo.plate} mono />
                            <DetailBox label={t('repairHistoryModal.detailRoNumber', 'RO Number')} value={wo.roNumber} mono /><DetailBox label={t('repairHistoryModal.detailMileage', 'Mileage at completion')} value={wo.lastMileage ? `${wo.lastMileage.toLocaleString()} ${t('startInspectionModal.milesShort', 'mi')}` : t('repairHistoryModal.emptyValue', '—')} />
                            <DetailBox label={t('repairHistoryModal.detailPhotos', 'Photos')} value={wo.photos > 0 ? t('repairHistoryModal.photosAttachedFmt', { count: wo.photos, defaultValue: `${wo.photos} attached` }) : t('repairHistoryModal.photosNone', 'None')} />
                            <DetailBox label={t('repairHistoryModal.detailFmc', 'FMC')} value={wo.fmc} />
                          </div>

                          {/* All notes */}
                          {wo.notes && wo.notes.length > 0 && (
                            <div>
                              <div className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-1.5">{t('repairHistoryModal.allNotesFmt', { count: wo.notes.length, defaultValue: `All notes (${wo.notes.length})` })}</div>
                              <div className="space-y-1">
                                {wo.notes.map((n, i) => (
                                  <div key={i} className="rounded-md bg-navy-800/60 border border-navy-700/40 px-2.5 py-1.5 text-[11px] text-navy-200">{n}</div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <div className="text-[11px] text-navy-400">
            {t('repairHistoryModal.showingFmt', { filtered: filtered.length, total: sorted.length, defaultValue: `Showing ${filtered.length} of ${sorted.length} repaired defects` })}
          </div>
          <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-navy-800 border border-navy-700 text-white hover:bg-navy-700 cursor-pointer">{t('repairHistoryModal.close', 'Close')}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Severity color helper (re-exports concept from WorkOrders)

function TimelineItem({ icon: Icon, color, label, time, detail }) {
  const colorClasses = {
    'accent-green':  'bg-accent-green/15 border-accent-green/40 text-accent-green',
    'accent-blue':   'bg-accent-blue/15 border-accent-blue/40 text-accent-blue',
    'accent-orange': 'bg-accent-orange/15 border-accent-orange/40 text-accent-orange',
    'accent-red':    'bg-accent-red/15 border-accent-red/40 text-accent-red',
  };
  const c = colorClasses[color] || colorClasses['accent-blue'];
  return (
    <div className="flex items-start gap-2.5">
      <div className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${c}`}>
        <Icon size={12} />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="text-xs font-semibold text-white">{label}</div>
        <div className="text-[11px] text-navy-400">{time}</div>
        {detail && <div className="text-[11px] text-navy-300 mt-0.5">{detail}</div>}
      </div>
    </div>
  );
}

function DetailBox({ label, value, mono, badge, badgeValue }) {
  return (
    <div className="rounded-md bg-navy-800/40 border border-navy-700/40 px-2 py-1.5">
      <div className="text-[9px] text-navy-500 uppercase tracking-wide">{label}</div>
      {badge ? (
        <Badge variant={badge}>{badgeValue}</Badge>
      ) : (
        <div className={`text-xs ${mono ? 'font-mono' : ''} text-white truncate`}>{value}</div>
      )}
    </div>
  );
}

// ============ Today's Defects Table — filter by vendor type + per-row actions ============
// Exported so the dedicated Defects page can reuse the same table without duplication.
export const VENDOR_TYPES = [
  { id: 'all',       label: 'All',       categories: null },
  { id: 'amr',       label: 'AMR',       categories: ['Brakes', 'Fluids', 'Lights', 'Mirrors', 'Mechanical', 'Dashboard'] },
  { id: 'body',      label: 'Body',      categories: ['Body', 'Windshield', 'Paint'] },
  { id: 'netradyne', label: 'Netradyne', categories: ['Telematics', 'Camera'] },
  { id: 'tires',     label: 'Tires',     categories: ['Tires', 'Wheels'] },
  { id: 'detailing', label: 'Detailing', categories: ['Cleanliness', 'Interior', 'Detailing'] },
];

// Status filter values match the display labels produced by fromApiDefect()
// in Defects.jsx (which maps API workflow status → human label). 'open' is a
// convenience bucket meaning "still actionable" (not converted, not rejected).
const STATUS_FILTERS = [
  { id: 'all',            label: 'All' },
  { id: 'open',           label: 'Open',           match: (s) => s !== 'Repair Ordered' && s !== 'Scheduled' && s !== 'Rejected' && s !== 'Rush Order' },
  { id: 'Logged',         label: 'Logged' },
  { id: 'Repair Ordered', label: 'Repair Ordered' },
  { id: 'Scheduled',      label: 'Scheduled' },
  { id: 'Rejected',       label: 'Rejected' },
];

// Map a defect's (display) status to the row action state so the UI reflects
// persisted backend state — not just ephemeral button clicks.
const WO_CREATED_STATUSES = new Set(['Repair Ordered', 'Scheduled', 'Rush Order']);
const REJECTED_STATUSES = new Set(['Rejected']);

function deriveActionFromStatus(d) {
  if (REJECTED_STATUSES.has(d.status)) return 'rejected';
  if (WO_CREATED_STATUSES.has(d.status)) return 'wo_created';
  return null;
}

export function TodaysDefectsTable({ defects, daList, onReject, onCreateWO, onBulkCreateWO, onBulkReject, onViewPhotos, onOpenCreateDefect, scheduledCount, rushOrderCount, title }) {
  const { t } = useTranslation('dashboard');
  const resolvedTitle = title ?? t('todaysDefects.defaultTitle', "Today's Defects");
  const [activeVendor, setActiveVendor] = useState('all');
  const [activeStatus, setActiveStatus] = useState('all');
  // rowActions: ephemeral per-click state (rare — only if the parent DIDN'T
  // yet reload after the API call). The effective action is derived from
  // defect.status so refreshes / backend reloads persist correctly.
  const [rowActions, setRowActions] = useState({});
  // Bulk-select mode (enabled when parent passes either bulk handler)
  const bulkEnabled = !!(onBulkCreateWO || onBulkReject);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const filtered = defects.filter((d) => {
    if (activeVendor !== 'all') {
      const v = VENDOR_TYPES.find((x) => x.id === activeVendor);
      if (!v?.categories?.includes(d.category)) return false;
    }
    if (activeStatus !== 'all') {
      const s = STATUS_FILTERS.find((x) => x.id === activeStatus);
      if (s?.match) {
        if (!s.match(d.status)) return false;
      } else if (d.status !== activeStatus) {
        return false;
      }
    }
    return true;
  });

  // A defect is selectable only if it's still actionable (not already
  // converted to WO and not rejected). Same rule the per-row buttons use.
  const isSelectable = (d) => deriveActionFromStatus(d) === null;
  const selectableInView = filtered.filter(isSelectable);

  // Selected rows that are still in the current filtered view AND still
  // actionable. We use this for the action bar count + the "all selected" check.
  const visibleSelected = selectableInView.filter((d) => selectedIds.has(d.id));
  const selectedDefects = defects.filter((d) => selectedIds.has(d.id));

  // Same-vehicle constraint: one WO is sent to one vendor for one vehicle, so
  // bulk only makes sense when every selected defect is on the same van.
  const distinctVans = new Set(selectedDefects.map((d) => d.vanInternalId).filter(Boolean));
  const sameVan = distinctVans.size <= 1;

  const handleReject = (d) => {
    setRowActions({ ...rowActions, [d.id]: 'rejected' });
    onReject?.(d);
  };
  const handleCreateWO = (d) => {
    setRowActions({ ...rowActions, [d.id]: 'wo_created' });
    onCreateWO?.(d);
  };

  // ── Selection helpers ────────────────────────────
  const toggleOne = (d) => {
    if (!isSelectable(d)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(d.id)) next.delete(d.id);
      else next.add(d.id);
      return next;
    });
  };
  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allVisibleSelected = selectableInView.length > 0 &&
        selectableInView.every((d) => prev.has(d.id));
      if (allVisibleSelected) {
        // un-check all visible
        selectableInView.forEach((d) => next.delete(d.id));
      } else {
        // check all visible
        selectableInView.forEach((d) => next.add(d.id));
      }
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const exitSelectMode = () => {
    setSelectMode(false);
    clearSelection();
  };
  const handleBulkCreate = () => {
    if (!sameVan || selectedDefects.length === 0) return;
    onBulkCreateWO?.(selectedDefects);
    // Optimistically mark these rows as wo_created
    setRowActions((prev) => {
      const next = { ...prev };
      selectedDefects.forEach((d) => { next[d.id] = 'wo_created'; });
      return next;
    });
    exitSelectMode();
  };
  const handleBulkRejectClick = () => {
    if (selectedDefects.length === 0) return;
    onBulkReject?.(selectedDefects);
    // Optimistically mark these rows as rejected
    setRowActions((prev) => {
      const next = { ...prev };
      selectedDefects.forEach((d) => { next[d.id] = 'rejected'; });
      return next;
    });
    exitSelectMode();
  };
  const allVisibleSelected = selectableInView.length > 0 &&
    selectableInView.every((d) => selectedIds.has(d.id));
  const someVisibleSelected = visibleSelected.length > 0 && !allVisibleSelected;

  return (
    <div className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-navy-800 bg-navy-950/40 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-accent-orange" />
          <h3 className="text-sm font-semibold text-white">{resolvedTitle}</h3>
          <Badge variant="gray">{t('todaysDefects.totalFmt', { count: defects.length, defaultValue: `${defects.length} total` })}</Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {scheduledCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-blue/15 border border-accent-blue/30 text-[11px] font-semibold text-accent-blue">
              {t('todaysDefects.scheduledFmt', { count: scheduledCount, defaultValue: `${scheduledCount} Scheduled` })}
            </span>
          )}
          {rushOrderCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/30 text-[11px] font-semibold text-accent-red">
              {t('todaysDefects.rushOrderFmt', { count: rushOrderCount, defaultValue: `${rushOrderCount} Rush Order` })}
            </span>
          )}
          {bulkEnabled && (
            <button
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                selectMode
                  ? 'bg-navy-800 border-navy-600 text-white'
                  : 'bg-navy-800/60 border-navy-700 text-navy-300 hover:text-white hover:border-navy-600'
              }`}
              title={selectMode ? t('todaysDefects.exitSelectModeTitle', 'Exit select mode') : t('todaysDefects.selectMultipleTitle', 'Select multiple defects to bulk-convert')}
            >
              {selectMode ? <X size={12} /> : <Check size={12} />}
              {selectMode ? t('todaysDefects.cancel', 'Cancel') : t('todaysDefects.select', 'Select')}
            </button>
          )}
          <button onClick={onOpenCreateDefect}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-blue text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
            <Plus size={12} /> {t('todaysDefects.createDefect', 'Create Defect')}
          </button>
        </div>
      </div>

      {/* Bulk action bar — appears when defects are selected */}
      {bulkEnabled && selectMode && selectedDefects.length > 0 && (
        <div className="px-4 py-2.5 border-b border-navy-800 bg-accent-blue/10 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent-blue/20 border border-accent-blue/40 text-accent-blue font-semibold">
              <Check size={11} /> {t('todaysDefects.bulkBar.selectedFmt', { count: selectedDefects.length, defaultValue: `${selectedDefects.length} selected` })}
            </span>
            {!sameVan && (
              <span className="inline-flex items-center gap-1.5 text-accent-orange">
                <AlertTriangle size={11} />
                {t('todaysDefects.bulkBar.needsSingleVan', 'Bulk WO requires defects from a single vehicle')}
                {' '}{t('todaysDefects.bulkBar.vansSelectedFmt', { count: distinctVans.size, defaultValue: `(${distinctVans.size} vans selected)` })}
              </span>
            )}
            {sameVan && distinctVans.size === 1 && (
              <span className="text-navy-300">
                {t('todaysDefects.bulkBar.fromVan', 'from')} <span className="font-mono text-white">{[...distinctVans][0]}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelection}
              className="px-2.5 py-1 rounded-md bg-navy-800 border border-navy-700 text-navy-300 hover:text-white text-[11px] font-semibold cursor-pointer"
            >
              {t('todaysDefects.bulkBar.clear', 'Clear')}
            </button>
            {onBulkReject && (
              <button
                onClick={handleBulkRejectClick}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-semibold bg-accent-red/15 border border-accent-red/40 text-accent-red hover:bg-accent-red/25 cursor-pointer"
                title={t('todaysDefects.bulkBar.bulkRejectTitle', 'Reject all selected defects')}
              >
                <X size={11} /> {t('todaysDefects.bulkBar.bulkReject', 'Bulk Reject')} ({selectedDefects.length})
              </button>
            )}
            {onBulkCreateWO && (
              <button
                onClick={handleBulkCreate}
                disabled={!sameVan}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-semibold ${
                  sameVan
                    ? 'bg-accent-green text-white hover:opacity-90 cursor-pointer'
                    : 'bg-navy-800 border border-navy-700 text-navy-500 cursor-not-allowed'
                }`}
                title={sameVan ? t('todaysDefects.bulkBar.bulkCreateWOTitle', 'Create one work order containing all selected defects') : t('todaysDefects.bulkBar.bulkCreateWODisabledTitle', 'All selected defects must belong to the same vehicle')}
              >
                <Check size={11} /> {t('todaysDefects.bulkBar.bulkCreateWO', 'Bulk Create WO')} ({selectedDefects.length})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Vendor filter pills */}
      <div className="px-4 py-2.5 border-b border-navy-800 bg-navy-950/20 flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[10px] text-navy-400 font-semibold uppercase tracking-wide shrink-0 mr-1">{t('todaysDefects.filter.vendorLabel', 'Vendor:')}</span>
        {VENDOR_TYPES.map((v) => {
          const count = v.id === 'all' ? defects.length : defects.filter((d) => v.categories?.includes(d.category)).length;
          const active = activeVendor === v.id;
          return (
            <button key={v.id} onClick={() => setActiveVendor(v.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer shrink-0 ${
                active
                  ? 'bg-accent-blue/20 border-accent-blue/50 text-accent-blue'
                  : 'bg-navy-800/40 border-navy-700 text-navy-400 hover:text-white hover:border-navy-600'
              }`}>
              {t(`todaysDefects.vendorType.${v.id}`, v.label)}
              <span className={`px-1 rounded ${active ? 'bg-black/20' : 'bg-navy-700/50 text-navy-300'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Status filter pills */}
      <div className="px-4 py-2.5 border-b border-navy-800 bg-navy-950/20 flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[10px] text-navy-400 font-semibold uppercase tracking-wide shrink-0 mr-1">{t('todaysDefects.filter.statusLabel', 'Status:')}</span>
        {STATUS_FILTERS.map((s) => {
          const count = s.id === 'all'
            ? defects.length
            : s.match
              ? defects.filter((d) => s.match(d.status)).length
              : defects.filter((d) => d.status === s.id).length;
          const active = activeStatus === s.id;
          return (
            <button key={s.id} onClick={() => setActiveStatus(s.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer shrink-0 ${
                active
                  ? 'bg-accent-purple/20 border-accent-purple/50 text-accent-purple'
                  : 'bg-navy-800/40 border-navy-700 text-navy-400 hover:text-white hover:border-navy-600'
              }`}>
              {t(`todaysDefects.statusFilter.${s.id}`, s.label)}
              <span className={`px-1 rounded ${active ? 'bg-black/20' : 'bg-navy-700/50 text-navy-300'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800">
              {bulkEnabled && selectMode && (
                <th className="text-left pl-4 pr-2 py-2.5 font-semibold w-8">
                  <input
                    type="checkbox"
                    aria-label={t('todaysDefects.table.selectAllAria', 'Select all visible defects')}
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                    onChange={toggleAllVisible}
                    disabled={selectableInView.length === 0}
                    className="w-3.5 h-3.5 accent-accent-blue cursor-pointer disabled:opacity-40"
                  />
                </th>
              )}
              <th className="text-left px-4 py-2.5 font-semibold">{t('todaysDefects.table.van', 'Van')}</th>
              <th className="text-left px-4 py-2.5 font-semibold">{t('todaysDefects.table.defect', 'Defect')}</th>
              <th className="text-left px-4 py-2.5 font-semibold">{t('todaysDefects.table.category', 'Category')}</th>
              <th className="text-left px-4 py-2.5 font-semibold">{t('todaysDefects.table.reportedBy', 'Reported by')}</th>
              <th className="text-left px-4 py-2.5 font-semibold">{t('todaysDefects.table.status', 'Status')}</th>
              <th className="text-right px-4 py-2.5 font-semibold">{t('todaysDefects.table.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const da = daList.find((x) => x.id === d.da);
              // Prefer ephemeral click state, fall back to derived-from-status
              const action = rowActions[d.id] || deriveActionFromStatus(d);
              const rowSelectable = bulkEnabled && selectMode && isSelectable(d);
              const rowSelected = selectedIds.has(d.id);
              return (
                <tr key={d.id} className={`border-b border-navy-800/50 last:border-b-0 transition-colors ${
                  action === 'rejected' ? 'bg-accent-red/5 opacity-60'
                  : action === 'wo_created' ? 'bg-accent-green/5'
                  : rowSelected ? 'bg-accent-blue/10'
                  : 'hover:bg-navy-800/30'
                }`}>
                  {bulkEnabled && selectMode && (
                    <td className="pl-4 pr-2 py-2.5 w-8">
                      <input
                        type="checkbox"
                        aria-label={t('todaysDefects.table.selectAriaFmt', { id: d.id, defaultValue: `Select defect ${d.id}` })}
                        checked={rowSelected}
                        onChange={() => toggleOne(d)}
                        disabled={!rowSelectable}
                        className="w-3.5 h-3.5 accent-accent-blue cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        title={rowSelectable ? '' : t('todaysDefects.table.alreadyHandledTitle', 'This defect is already converted or rejected')}
                      />
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-white font-semibold font-mono">{d.van}</td>
                  <td className="px-4 py-2.5 text-white">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {d.line1 ? (
                          // v2 two-line structured display
                          <>
                            <div className="text-sm text-white font-medium truncate">{d.line1}</div>
                            {d.line2 && (
                              <div className="text-[11px] text-navy-300 truncate">{d.line2}</div>
                            )}
                          </>
                        ) : (
                          // legacy fallback
                          d.desc
                        )}
                      </div>
                      {onViewPhotos ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onViewPhotos(d); }}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer shrink-0 ${
                            d.photoCount > 0
                              ? 'bg-accent-blue/15 border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/25'
                              : 'bg-navy-800 border border-navy-700 text-navy-400 hover:text-white hover:border-navy-600'
                          }`}
                          title={d.photoCount > 0 ? t('todaysDefects.table.viewPhotosFmt', { count: d.photoCount, defaultValue: `View ${d.photoCount} photo${d.photoCount === 1 ? '' : 's'}` }) : t('todaysDefects.table.addPhoto', 'Add photo')}
                        >
                          <Camera size={10} />
                          {d.photoCount > 0 ? d.photoCount : '+'}
                        </button>
                      ) : (
                        d.photo && <Camera size={11} className="text-navy-400" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><Badge variant="gray">{d.category}</Badge></td>
                  <td className="px-4 py-2.5 text-[11px] text-navy-300">{da?.name || '—'}</td>
                  <td className="px-4 py-2.5"><Badge variant={defectStatusColors[d.status] || 'gray'}>{t(`todaysDefects.table.statusBadge.${d.status}`, d.status)}</Badge></td>
                  <td className="px-4 py-2.5">
                    {action === 'rejected' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-accent-red font-semibold"><X size={11} /> {t('todaysDefects.table.rowState.rejected', 'Rejected')}</span>
                    ) : action === 'wo_created' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-accent-green font-semibold"><Check size={11} /> {t('todaysDefects.table.rowState.woSent', 'WO sent')}</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleReject(d)}
                          title={t('todaysDefects.table.rejectTitle', 'Reject defect')}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent-red/10 border border-accent-red/40 text-accent-red text-[11px] font-semibold hover:bg-accent-red/20 cursor-pointer">
                          <X size={11} /> {t('todaysDefects.table.reject', 'Reject')}
                        </button>
                        <button onClick={() => handleCreateWO(d)}
                          title={t('todaysDefects.table.createWOTitle', 'Create Work Order for this defect')}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent-green text-white text-[11px] font-semibold hover:opacity-90 cursor-pointer">
                          <Check size={11} /> {t('todaysDefects.table.createWO', 'Create WO')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={bulkEnabled && selectMode ? 7 : 6} className="px-4 py-8 text-center text-sm text-navy-400">
                {t('todaysDefects.table.noMatch', 'No defects match the current filters.')}
                {(activeVendor !== 'all' || activeStatus !== 'all') && (
                  <button
                    onClick={() => { setActiveVendor('all'); setActiveStatus('all'); }}
                    className="ml-2 text-accent-blue hover:underline cursor-pointer"
                  >
                    {t('todaysDefects.table.clearFilters', 'Clear filters')}
                  </button>
                )}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RealDVIC({ user }) {
  const { t } = useTranslation('dashboard');
  const [activeSection, setActiveSection] = useState('overview');
  const [openCard, setOpenCard] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInspection, setShowInspection] = useState(false);
  const [showStartInspection, setShowStartInspection] = useState(false);
  const [showRepairHistory, setShowRepairHistory] = useState(false);
  const [showFlexFleet, setShowFlexFleet] = useState(false);
  const [vehicleReportVan, setVehicleReportVan] = useState(null);
  // When opening a row that comes from live API data, we render
  // LiveInspectionReportCard instead of the legacy mock-driven one.
  const [liveReport, setLiveReport] = useState(null);
  const [vanUpdates, setVanUpdates] = useState({});
  const [createWOContext, setCreateWOContext] = useState(null); // { van, defect }

  // Live "Vans inspected today" — pulled from /inspections + /vehicles.
  // Server scopes by JWT: dsp_owner sees own DSP, vendor/tech sees all DSPs.
  //
  // We split into TRUE inspections (real walkaround happened) vs INCOMPLETE
  // (van flagged as won't-start / not-at-lot / no-keys). The card shows
  // "real inspected of fleet" + the incomplete count as a separate badge,
  // because for the DSP owner they're operationally distinct.
  const [todayCount, setTodayCount] = useState(0);            // unique vans truly inspected
  const [todayIncompleteCount, setTodayIncompleteCount] = useState(0); // unique vans flagged as not-inspectable
  const [fleetTotal, setFleetTotal] = useState(0);
  const [todayInspected, setTodayInspected] = useState([]);   // for the expand modal

  const refreshTodayMetrics = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
      const [inspsRes, vehsRes] = await Promise.all([
        inspectionsApi.list({ dateFrom: today, dateTo: today, perPage: 100 }),
        vehiclesApi.list({ perPage: 100 }),
      ]);
      // First-seen wins per vehicleId — if a van had both a real inspection
      // AND was later flagged, the FIRST recorded result wins. (In practice
      // this won't happen because the wizard only creates incomplete for
      // vans without an inspection.)
      const seen = new Map(); // vehicleId -> result
      const uniq = [];
      for (const i of inspsRes.items) {
        if (!seen.has(i.vehicleId)) {
          seen.set(i.vehicleId, i.result);
          uniq.push(i);
        }
      }
      // Real inspections = anything that's not "incomplete"
      let realCount = 0;
      let incompleteCount = 0;
      for (const result of seen.values()) {
        if (result === 'incomplete') incompleteCount += 1;
        else realCount += 1;
      }
      setTodayCount(realCount);
      setTodayIncompleteCount(incompleteCount);
      setFleetTotal(vehsRes.total ?? vehsRes.items.length);
      setTodayInspected(uniq);
    } catch (err) {
      console.warn('refresh today metrics failed', err);
    }
  }, []);

  useEffect(() => {
    refreshTodayMetrics();
  }, [refreshTodayMetrics]);

  // After the wizard submits (closes), refresh
  const wizardJustClosed = !showStartInspection;
  useEffect(() => {
    if (wizardJustClosed) refreshTodayMetrics();
  }, [wizardJustClosed, refreshTodayMetrics]);

  // Completed WOs feeding the "Defects Repaired" metric card + history
  // modal. Backend already scopes the list by role (DSP sees their own,
  // vendor sees their own workshop, site_admin sees all) so we just ask
  // for status=completed and run each row through the V2→V1 adapter so
  // the modal's existing renderer reads the shape it expects.
  const [repairedWOs, setRepairedWOs] = useState([]);
  useEffect(() => {
    let cancelled = false;
    workOrdersApi
      .list({ status: 'completed', limit: 200 })
      .then((res) => {
        if (cancelled) return;
        setRepairedWOs((res.items || []).map((wo) => adaptWO(wo)));
      })
      .catch((err) => console.warn('completed WO history fetch failed', err));
    return () => { cancelled = true; };
    // Refetch when the wizard closes (a newly-reported defect could
    // trigger auto-routing). Completed WOs flip status on the vendor
    // side; the DSP home doesn't drive that transition, so we don't
    // need a tighter polling cycle here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardJustClosed]);
  const repairedDefectsCount = repairedWOs.length;
  // "This week" = last 7 days
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const repairedThisWeekCount = repairedWOs.filter((wo) => wo.completedAt && new Date(wo.completedAt) >= oneWeekAgo).length;
  const [newDefects, setNewDefects] = useState([]);

  // Real DSP fleet — feeds the Create Work Order modal's vehicle dropdown
  // so the DSP picks from their actual vans (not the demo mockup). Backend
  // scopes by JWT: dsp_owner sees own org only; vendor/site_admin see all.
  // The modal expects a `{ id, model, plate, mileage, dsp, dspId, defectCount,
  // vehicleClass }` shape — we adapt vehicles.list() rows on the fly.
  const [realFleetVans, setRealFleetVans] = useState([]);
  useEffect(() => {
    let cancelled = false;
    vehiclesApi
      // Backend caps per_page at 100. Most DSPs have < 100 vans; if a customer
      // exceeds the cap we'll paginate (the rest just won't appear in the
      // Create-WO dropdown until then, which is a tolerable demo gap).
      .list({ perPage: 100 })
      .then((res) => {
        if (cancelled) return;
        const rows = (res.items || []).map((v) => ({
          id: v.id,                                       // 'VAN-0151'
          fleetId: v.fleetId || null,                     // 'SV12' / '12' / etc
          model: [v.year, v.make, v.model].filter(Boolean).join(' '),
          plate: v.plate,
          mileage: v.mileage,
          dspId: v.dspId,                                 // numeric — modal doesn't render it
          dsp: v.dspName || '',
          defectCount: 0,                                 // modal only renders if > 0
          vehicleClass: v.vehicleClass,                   // drives catalog filter
          vin: v.vin,
          year: v.year,
          make: v.make,
        }));
        setRealFleetVans(rows);
      })
      .catch((err) => console.warn('fleet fetch (for Create WO modal) failed', err));
    return () => { cancelled = true; };
  }, []);

  // Live "DSP-reported defects today" — seeded from GET /defects/v2 and kept
  // current via the SSE stream at /defects/v2/events. Both are role-scoped on
  // the server (dsp_owner sees own DSP only). dedup by id_str so a publish
  // arriving while the initial fetch is in flight doesn't double-count.
  //
  // "DSP-reported" excludes defects the inspector found during a walkaround
  // (source='inspection') and findings vendors flagged from the shop
  // (source='shop_finding'). The remaining sources — driver_report,
  // maintenance_request, customer_report, other — are all DSP-originated.
  const DSP_REPORTED_SOURCES = new Set([
    'driver_report',
    'maintenance_request',
    'customer_report',
    'other',
  ]);
  const isDspReportedSource = (d) => DSP_REPORTED_SOURCES.has(d?.source);

  const [liveDefects, setLiveDefects] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    defectsApi
      .list({ dateFrom: today, dateTo: today, perPage: 100 })
      .then((res) => {
        if (cancelled) return;
        // Filter to DSP-originated sources so inspector-found defects don't
        // inflate the "DSP-reported defects today" metric.
        const rows = (res.items || []).filter(isDspReportedSource);
        setLiveDefects(rows);
      })
      .catch((err) => console.warn('defects/v2 list failed', err));

    const cleanup = defectsApi.subscribe({
      onDefect: (d) => {
        if (!isDspReportedSource(d)) return;
        setLiveDefects((prev) => (prev.some((x) => x.id === d.id) ? prev : [d, ...prev]));
      },
      onError: (e) => console.warn('defects/v2 SSE error', e),
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalDefectsToday = newDefects.length + liveDefects.length;
  // v2 spec has no urgency / rush concept yet — keep the slot for future use.
  const rushOrders = 0;
  const allDefects = [...newDefects];
  // The Scheduled Repairs metric used to count items from this mock array;
  // it now reads `scheduledWoQueue.length` (real WOs with scheduled_at in
  // the next 36h). Kept as an empty derived value for any legacy reference.
  const notInspected = 7;
  const newToApprove = 2;

  // Defects awaiting DSP approval — fetched from /defect-reviews/queue
  // (DSP-scoped server-side). The queue is exactly the set of defects with
  // no review row yet — the canonical "needs DSP decision" cohort under
  // V2.0. Older code path read /defects total which counted every defect
  // in the fleet (including approved/rejected/repaired), inflating the
  // home dashboard tile.
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  // Hold the full queue payload so the "Immediate Action Required" modal can
  // render real defect cards (each with the underlying defectId so its
  // Approve/Reject buttons hit defectReviews.approve / .reject directly).
  const [pendingReviewQueue, setPendingReviewQueue] = useState([]);
  // Scheduled-WOs queue for the "Scheduled Repairs" home card. Same idea:
  // bump the refresh tick from inside the modal whenever the DSP commits
  // a response so the count + list update without a full page reload.
  const [scheduledWoQueue, setScheduledWoQueue] = useState([]);
  // A bumpable tick: anything that needs the queue refreshed (e.g. after a
  // defect was approved from the modal) increments this so the effect refires.
  const [queueRefreshTick, setQueueRefreshTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    defectReviewsApi
      .queue({ limit: 200 })
      .then((res) => {
        if (cancelled) return;
        setPendingApprovalCount(res.total ?? (res.items?.length ?? 0));
        setPendingReviewQueue(res.items || []);
      })
      .catch((err) => console.warn('pending-review queue failed', err));
    // Scheduled WOs in the next 36h — drives the "Scheduled Repairs" card.
    // Backend filters out cancelled / declined / completed so the count
    // matches what the DSP actually needs to respond to.
    workOrdersApi
      .list({ scheduledWithinHours: 36, limit: 100 })
      .then((res) => {
        if (cancelled) return;
        setScheduledWoQueue(res.items || []);
      })
      .catch((err) => console.warn('scheduled WO queue failed', err));
    return () => { cancelled = true; };
    // refetch when a new defect lands via SSE (totalDefectsToday changes)
    // or after the inspection wizard closes — or any time something in the
    // modal flagged the queue as stale via setQueueRefreshTick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalDefectsToday, wizardJustClosed, queueRefreshTick]);
  // Repairs still waiting for DSP feedback (thumbs up/down) on the vendor's work
  const repairsPendingFeedback = repairedDefectsCount;
  // Next inspection date auto-computed from the org's inspection frequency
  // set during initial setup (first_inspection + frequency_days). For the
  // demo we compute today + 7 days and render as MM-DD-YYYY.
  const nextInspectionDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}-${dd}-${d.getFullYear()}`;
  })();

  // Sub-tabs for DSP Owner home:
  //   Overview · Today's Defects
  // QC DVIC is no longer a tab — it's reached by clicking the 'Vans Inspected'
  // metric card, which lists the vans; clicking a row opens its Vehicle Report
  // Card where the DSP approves/rejects defects and creates work orders.
  // DSP-side dashboard (Overview + Today's Defects). All DSP roles see this
  // — owners + managers approve, inspectors + viewers read.
  const isDspHome = isDspRole(user) || user?.role === 'site_admin';
  const sections = [
    { id: 'overview', label: 'Overview', icon: Shield },
    { id: 'defects', label: "Today's Defects", icon: AlertTriangle },
  ];

  // Who SEES the home "Start a new QC DVIC" banner. We deliberately
  // narrow this from `canInspect()` — DSP owners and managers can still
  // technically launch a walkaround as a fallback (canInspect is true
  // for them) but they don't belong on the DSP dashboard, which is for
  // overseeing reported defects + work orders. The walkaround is the
  // inspector's / technician's day-to-day workflow, so the banner only
  // surfaces for those roles + site_admin.
  const canStartInspection =
    canInspect(user) && !['dsp_owner', 'dsp_manager'].includes(user?.role);

  // QC inspection banner: in production it appears automatically on
  // inspection day. For the demo we expose a barely-visible toggle in the
  // top-right corner of the Home view so we can show/hide it on demand.
  const [showQcBanner, setShowQcBanner] = useState(false);

  return (
    <div>
      {/* Subtle banner-visibility toggle — DSP users only */}
      {(isDspRole(user) || user?.role === 'site_admin') && (
        <div className="flex justify-end -mt-2 mb-1">
          <button
            onClick={() => setShowQcBanner((s) => !s)}
            title={showQcBanner ? t('realDvic.qcBannerHideTitle', 'Hide QC inspection banner') : t('realDvic.qcBannerShowTitle', 'Simulate inspection day (show banner)')}
            className="text-[10px] text-navy-600 hover:text-navy-300 px-2 py-1 rounded transition-colors cursor-pointer"
          >
            {showQcBanner ? t('realDvic.qcBannerToggleHide', '· hide banner ·') : t('realDvic.qcBannerToggleShow', '· · ·')}
          </button>
        </div>
      )}

      {/* Daily QC Inspection Readiness banner — only when toggle is on (simulating inspection day) */}
      {(user?.role === 'dsp_owner' || user?.role === 'site_admin') && showQcBanner && (
        <InspectionReadinessBanner onClick={() => setShowInspection(true)} />
      )}

      {/* Start New Inspection banner — for Vendor / Technician */}
      {canStartInspection && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="w-full mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-accent-green/40 bg-gradient-to-r from-accent-green/15 via-accent-blue/10 to-accent-purple/10">
          <div className="w-10 h-10 rounded-lg bg-accent-green/20 border border-accent-green/40 flex items-center justify-center shrink-0">
            <PlayCircle size={18} className="text-accent-green" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-white">{t('realDvic.startInspectionBanner.heading', 'Start a new QC DVIC')}</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-blue/15 border border-accent-blue/40 text-accent-blue text-[10px] font-semibold">
                {t('realDvic.startInspectionBanner.badge', 'Inspector workflow')}
              </span>
            </div>
            <div className="text-xs text-navy-300">{t('realDvic.startInspectionBanner.subtitle', 'Walk through the 5-section inspection and auto-create work orders for any defects found')}</div>
          </div>
          <button
            onClick={() => setShowStartInspection(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-green text-white text-sm font-semibold hover:bg-accent-green/80 transition-all cursor-pointer shadow-lg shadow-accent-green/20"
          >
            <PlayCircle size={14} /> {t('realDvic.startInspectionBanner.button', 'Start Inspection')}
          </button>
        </motion.div>
      )}

      {/* Home body — single scrollable view (no sub-tabs) */}
      <div className="space-y-6">
          {/* Key metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            {/* DSP-reported defects today — + button floats right, number centered */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
              onClick={() => setOpenCard('reported')}
              className="relative bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5 hover:border-navy-600/60 transition-all cursor-pointer h-full flex flex-col">
              <div className="flex items-start justify-end mb-3">
                <button
                  onClick={(e) => { e.stopPropagation(); setCreateWOContext({ van: null, defect: null }); }}
                  className="w-9 h-9 rounded-full bg-accent-blue/15 border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/25 transition-colors cursor-pointer flex items-center justify-center"
                  title={t('realDvic.metrics.createWOTitle', 'Create work order (no inspection required)')}
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white mb-1">{totalDefectsToday}</div>
                <div className="text-sm text-navy-400">{t('realDvic.metrics.reportedToday', 'DSP-reported defects today')}</div>
              </div>
              <div className="mt-auto pt-2 flex justify-center">
                {rushOrders > 0 ? (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/30">
                    <span className="text-[10px] font-semibold text-accent-red">{t('realDvic.metrics.rushOrderFmt', { count: rushOrders, defaultValue: `${rushOrders} Rush Order` })}</span>
                  </div>
                ) : <div className="h-[22px]" />}
              </div>
            </motion.div>

            {/* Vans Inspected — 23 of 30, next inspection date below */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.4 }}
              onClick={() => setOpenCard('inspected')}
              className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5 hover:border-navy-600/60 transition-all cursor-pointer h-full flex flex-col">
              <div className="flex items-start justify-between mb-3">
                {/* Left: incomplete badge (only shown if any) */}
                {todayIncompleteCount > 0 ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent-red/15 text-accent-red border border-accent-red/30"
                    title={t('realDvic.metrics.flaggedTitleFmt', { count: todayIncompleteCount, defaultValue: `${todayIncompleteCount} van${todayIncompleteCount === 1 ? '' : 's'} flagged as not inspectable today` })}
                  >
                    <AlertTriangle size={10} /> {t('realDvic.metrics.flaggedFmt', { count: todayIncompleteCount, defaultValue: `${todayIncompleteCount} flagged` })}
                  </span>
                ) : <span />}
                {/* Right: coverage % (real inspections only) */}
                {fleetTotal > 0 && (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    todayCount === fleetTotal
                      ? 'bg-accent-green/15 text-accent-green'
                      : todayCount === 0
                      ? 'bg-navy-700/40 text-navy-400'
                      : 'bg-accent-orange/15 text-accent-orange'
                  }`}>
                    {`${Math.round((todayCount / fleetTotal) * 100)}%`}
                  </span>
                )}
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white mb-1">
                  {todayCount} <span className="text-navy-400 font-normal text-xl">{t('realDvic.metrics.ofFleetFmt', { count: fleetTotal, defaultValue: `of ${fleetTotal}` })}</span>
                </div>
                <div className="text-sm text-navy-400">{t('realDvic.metrics.vansInspected', 'Vans Inspected')}</div>
              </div>
              <div className="mt-auto pt-2 text-center text-[11px] text-navy-400">
                {t('realDvic.metrics.nextInspectionFmt', 'Next inspection')} <span className="text-white font-medium">{nextInspectionDate}</span>
              </div>
            </motion.div>

            <div onClick={() => setOpenCard('immediate')} className="cursor-pointer h-full">
              <MetricCard
                icon={pendingApprovalCount > 0 ? AlertTriangle : undefined}
                label={t('realDvic.metrics.defectsForApproval', 'Defects for approval')}
                value={pendingApprovalCount}
                color="accent-red"
                delay={0.1}
              />
            </div>

            <div onClick={() => setOpenCard('scheduled')} className="cursor-pointer h-full">
              <MetricCard
                icon={AlertTriangle}
                label={t('realDvic.metrics.scheduledRepairs', 'Scheduled Repairs')}
                value={scheduledWoQueue.length}
                color="accent-red"
                delay={0.15}
              />
            </div>

            <div onClick={() => setShowRepairHistory(true)} className="cursor-pointer h-full">
              <MetricCard
                label={t('realDvic.metrics.defectsRepaired', 'Defects Repaired')}
                value={repairedDefectsCount}
                subtitle={t('realDvic.metrics.currentWeek', 'Current Week')}
                color="accent-green"
                delay={0.2}
                trend={repairedThisWeekCount > 0 ? Math.round((repairedThisWeekCount / Math.max(totalDefectsToday, 1)) * 100) : undefined}
                trendUp
                warning={repairsPendingFeedback > 0 ? t('realDvic.metrics.pendingFeedbackFmt', { count: repairsPendingFeedback, defaultValue: `${repairsPendingFeedback} pending feedback` }) : undefined}
              />
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
            >
              <h3 className="text-sm font-semibold text-white mb-4">{t('realDvic.charts.approvedVsRepaired', 'Daily Approved vs Repaired Defects')}</h3>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyInspections}>
                    <XAxis dataKey="day" tick={{ fill: '#829ab1', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#829ab1', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#102a43', border: '1px solid #334e68', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#829ab1' }} />
                    <Bar dataKey="approved" name={t('realDvic.charts.approvedSeries', 'Approved Defects')} fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="repaired" name={t('realDvic.charts.repairedSeries', 'Repaired')} fill="#627d98" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
              className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
            >
              <h3 className="text-sm font-semibold text-white mb-4">{t('realDvic.charts.openDefects', 'Open Defects')}</h3>
              <div className="h-[200px] flex items-center">
                <ResponsiveContainer width="50%" height="100%">
                  <PieChart>
                    <Pie data={defectCategoryBreakdown} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" stroke="none">
                      {defectCategoryBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#102a43', border: '1px solid #334e68', borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v}%`]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1.5 text-xs">
                  {defectCategoryBreakdown.map((cat) => (
                    <div key={cat.name} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: cat.color }} />
                      <span className="text-navy-300">{cat.name}</span>
                      <span className="text-white font-semibold">{cat.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>

          {/* DA Reward Tiers cards removed from Home — they live on the dedicated Rewards page */}
          {/* Today's Defects table moved to its own top-level 'Defects' page */}
          {/* Order Flex Fleet lives inside the Scheduled Repairs modal footer */}
      </div>

      {/* DSP Rewards (formerly DSP Loyalty) — moved to /rewards tab, kept here for legacy only */}
      {activeSection === 'rewards_legacy_removed' && (
        <div className="space-y-4">
          <div className="mb-2">
            <h3 className="text-base font-semibold text-white mb-1">DSP Loyalty Program</h3>
            <p className="text-xs text-navy-400">DSPs unlock admin-team rewards as defect submissions accumulate</p>
          </div>
          {dspRewards.map((item, i) => (
            <motion.div key={item.id}
              initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
            >
              <div className="flex items-start justify-between mb-3 gap-4">
                <div className="flex flex-col gap-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-gold/10 border border-accent-gold/30">
                    <Gift size={14} className="text-accent-gold" />
                    <span className="text-sm font-semibold text-white">{item.title}</span>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-green/10 border border-accent-green/30 w-fit">
                    <Shield size={14} className="text-accent-green" />
                    <span className="text-xs text-navy-200">{item.detail}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold text-white">{item.totalDefects.toLocaleString()}</div>
                  <div className="text-xs text-navy-400">/ {item.target.toLocaleString()} target</div>
                </div>
              </div>
              <ProgressBar value={item.totalDefects} max={item.target} color="#3b82f6" height={8} />
            </motion.div>
          ))}
        </div>
      )}

      {/* Live Defects feed removed — replaced by the TodaysDefectsTable above */}

      {/* DA Leaderboard — moved to /rewards tab, kept here as legacy only */}
      {activeSection === 'leaderboard_legacy_removed' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl overflow-hidden"
        >
          <div className="p-5 border-b border-navy-700/40">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Award size={16} className="text-accent-gold" /> DA Leaderboard &mdash; Inspection Champions
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-navy-400 text-xs border-b border-navy-800">
                  <th className="text-left px-5 py-3 font-medium">#</th>
                  <th className="text-left px-5 py-3 font-medium">Driver</th>
                  <th className="text-center px-5 py-3 font-medium">Tier</th>
                  <th className="text-right px-5 py-3 font-medium">Defects</th>
                  <th className="text-right px-5 py-3 font-medium">Streak</th>
                  <th className="text-right px-5 py-3 font-medium">Cash Earned</th>
                  <th className="text-right px-5 py-3 font-medium">Vendor Bucks</th>
                  <th className="text-center px-5 py-3 font-medium">Award Status</th>
                </tr>
              </thead>
              <tbody>
                {[...daList].sort((a, b) => b.totalDefects - a.totalDefects).map((da, i) => {
                  const cfg = tierConfig[da.tier];
                  const awarded = daAwardStatus[da.id] ?? true;
                  return (
                    <motion.tr key={da.id}
                      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                      className="border-b border-navy-800/50 hover:bg-navy-800/30 transition-colors"
                    >
                      <td className="px-5 py-3">
                        {i < 3 ? (
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            i === 0 ? 'bg-accent-gold/20 text-accent-gold' : i === 1 ? 'bg-navy-400/20 text-navy-300' : 'bg-accent-orange/20 text-accent-orange'
                          }`}>{i + 1}</span>
                        ) : <span className="text-navy-500 text-xs">{i + 1}</span>}
                      </td>
                      <td className="px-5 py-3 text-white font-medium">{da.name}</td>
                      <td className="px-5 py-3 text-center">
                        <Badge variant={da.tier === 3 ? 'purple' : da.tier === 2 ? 'gold' : 'blue'}>{cfg.label}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right text-white font-semibold">{da.totalDefects}</td>
                      <td className="px-5 py-3 text-right">
                        <span className="flex items-center justify-end gap-1">
                          <Flame size={12} className={da.streak >= 20 ? 'text-accent-orange' : 'text-navy-500'} />
                          <span className={`font-semibold ${da.streak >= 20 ? 'text-accent-orange' : 'text-navy-300'}`}>{da.streak}d</span>
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-accent-green font-semibold">${da.cashEarned.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right text-accent-purple font-semibold">${da.vendorBucks.toLocaleString()}</td>
                      <td className="px-5 py-3 text-center">
                        {awarded ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-green/10 border border-accent-green/30" title="Awarded">
                            <CheckCheck size={14} className="text-accent-green" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-orange/10 border border-accent-orange/30" title="Pending">
                            <Hourglass size={14} className="text-accent-orange" />
                          </span>
                        )}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-5 bg-navy-800/30 border-t border-navy-700/40">
            <div className="flex items-start gap-3">
              <Lock size={18} className="text-accent-gold mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-white font-medium mb-1">Attrition Lock-In Effect</p>
                <p className="text-xs text-navy-400">
                  DAs who leave their DSP restart at Tier 1 and lose accumulated loyalty points.
                  This creates a natural retention incentive — top performers like Mia Thompson (Tier 3, $2,334 vendor bucks)
                  have significant switching costs, reducing DSP turnover.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {openCard && (
          <CardDetailModal
            cardKey={openCard}
            onClose={() => setOpenCard(null)}
            liveInspected={todayInspected}
            liveDefects={liveDefects}
            pendingReviewQueue={pendingReviewQueue}
            scheduledWoQueue={scheduledWoQueue}
            onQueueChanged={() => setQueueRefreshTick((n) => n + 1)}
            onOrderFlexFleet={isDspHome ? () => { setOpenCard(null); setShowFlexFleet(true); } : null}
            onOpenVehicleReport={(van) => {
              // Close the Vans Inspected modal first, then pop the appropriate
              // report card. Live rows (from API) → LiveInspectionReportCard.
              // Legacy mock rows → original VehicleReportCard with vanUpdates patch.
              setOpenCard(null);
              if (van.__live) {
                setLiveReport(van);
              } else {
                setVehicleReportVan({ ...van, ...(vanUpdates[van.id] || {}) });
              }
            }}
          />
        )}
        {vehicleReportVan && (
          <VehicleReportCard
            van={vehicleReportVan}
            onClose={() => setVehicleReportVan(null)}
            onUpdateVan={(vanId, updates) => setVanUpdates({ ...vanUpdates, [vanId]: { ...(vanUpdates[vanId] || {}), ...updates } })}
            userRole={user?.role}
            onCreateWO={(van, defect) => setCreateWOContext({ van, defect })}
          />
        )}
        {liveReport && (
          <LiveInspectionReportCard
            inspection={liveReport}
            user={user}
            onClose={() => {
              setLiveReport(null);
              // Refresh the home metrics since defect statuses may have changed
              refreshTodayMetrics();
            }}
            onCreateWO={(ctx) => setCreateWOContext(ctx)}
          />
        )}
        {createWOContext && (
          <CreateWorkOrderModal
            initialVan={createWOContext.van}
            initialDefect={createWOContext.defect}
            vans={realFleetVans.length > 0 ? realFleetVans : fleetSnapshotVans}
            user={user}
            onClose={() => setCreateWOContext(null)}
          />
        )}
        {showCreate && (
          <CreateDefectModal
            onClose={() => setShowCreate(false)}
            onCreate={(d) => setNewDefects([d, ...newDefects])}
          />
        )}
        {showInspection && <InspectionReadinessModal onClose={() => setShowInspection(false)} />}
        {showStartInspection && (
          <CreateInspectionWizard
            user={user}
            onClose={() => setShowStartInspection(false)}
          />
        )}
        {showRepairHistory && <RepairHistoryModal repairedWOs={repairedWOs} user={user} onClose={() => setShowRepairHistory(false)} />}
        {showFlexFleet && <FlexFleetModal onClose={() => setShowFlexFleet(false)} />}
      </AnimatePresence>
    </div>
  );
}
