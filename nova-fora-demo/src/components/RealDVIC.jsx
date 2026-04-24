import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Shield, ShieldCheck, AlertTriangle, Award, TrendingUp, Users, Flame, Camera, Gift, Lock, Star, Plus, Hourglass, CheckCheck, X, Clock, Wrench, CheckCircle2, Calendar, KeyRound, ChevronRight, Info, SkipForward, PlayCircle, ClipboardCheck, ChevronDown, Check, ArrowRight, Bell, LayoutGrid, Truck, ThumbsUp, ThumbsDown } from 'lucide-react';
import { daList, dvicDefects, dspRewards, dspList, weeklyInspections, defectCategoryBreakdown, inspectionSections, workOrdersData } from '../data/mockData';
import MetricCard from './ui/MetricCard';
import ProgressBar from './ui/ProgressBar';
import Badge from './ui/Badge';
import { FlexFleetModal, VehicleReportCard, CreateWorkOrderModal } from './FleetSnapshot';
import { fleetSnapshotVans } from '../data/mockData';

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

const severityColors = { Critical: 'red', High: 'orange', Medium: 'gold', Low: 'blue' };
const defectStatusColors = { 'Rush Order': 'red', 'Scheduled': 'blue', 'Repair Ordered': 'green', 'Logged': 'gray' };

// Detail data for each metric card
const cardDetails = {
  reported: {
    title: 'DSP-reported Defects Today',
    accent: 'accent-green',
    icon: Shield,
    summary: '8 defects reported across fleet — 1 is a rush order',
    items: [
      { label: 'VAN-1042', title: 'Rear left tire — tread below 3/32"', meta: 'Marcus Johnson · 06:15 AM', status: 'Rush Order', severity: 'High' },
      { label: 'VAN-1042', title: 'Brake light — passenger side out', meta: 'Marcus Johnson · 06:16 AM', status: 'Repair Ordered', severity: 'Medium' },
      { label: 'VAN-2009', title: 'Minor scratch on driver door', meta: 'Ana Rodriguez · 06:05 AM', status: 'Scheduled', severity: 'Low' },
      { label: 'VAN-5012', title: 'Grinding noise — front brakes', meta: 'Mia Thompson · 05:55 AM', status: 'Rush Order', severity: 'Critical' },
      { label: 'VAN-3021', title: 'Coolant level low', meta: 'Destiny Brooks · 06:22 AM', status: 'Repair Ordered', severity: 'Medium' },
      { label: 'VAN-1018', title: 'Crack spreading from chip — driver side', meta: 'Sarah Chen · 06:30 AM', status: 'Repair Ordered', severity: 'High' },
      { label: 'VAN-5008', title: 'Passenger side mirror — loose housing', meta: 'David Kim · 06:10 AM', status: 'Logged', severity: 'Medium' },
      { label: 'VAN-2015', title: 'Cargo door — stiff latch mechanism', meta: 'James Williams · 06:20 AM', status: 'Logged', severity: 'Low' },
    ],
  },
  immediate: {
    title: 'Immediate Action Required',
    accent: 'accent-purple',
    icon: AlertTriangle,
    summary: '10 items pending approval to enroll in DVIC repair queue',
    items: [
      { label: 'VAN-5012', title: 'Grinding noise — front brakes, feels spongy', meta: 'Critical · Mia Thompson',         status: 'Pending Approval', severity: 'Critical', section: '4. Back Side',      part: 'Brakes' },
      { label: 'VAN-1042', title: 'Rear left tire — tread below 3/32"',         meta: 'High · Marcus Johnson',              status: 'Pending Approval', severity: 'High',     section: '4. Back Side',      part: 'Tire tread' },
      { label: 'VAN-1018', title: 'Windshield crack spreading',                  meta: 'High · Sarah Chen',                  status: 'Pending Approval', severity: 'High',     section: '1. Front Side',     part: 'Windshield' },
      { label: 'VAN-2027', title: 'ABS warning light active',                    meta: 'Critical · Tyler Nguyen',            status: 'Pending Approval', severity: 'Critical', section: '5. In-Cab',         part: 'Dashboard' },
      { label: 'VAN-3044', title: 'Power steering fluid leak',                   meta: 'High · Kevin Park',                  status: 'Pending Approval', severity: 'High',     section: '1. Front Side',     part: 'Fluids' },
      { label: 'VAN-4012', title: 'Rear brake pad wear indicator',               meta: 'Medium · Aaliyah Washington',        status: 'Pending Approval', severity: 'Medium',   section: '4. Back Side',      part: 'Brake pads' },
      { label: 'VAN-5033', title: 'Headlight alignment out of spec',             meta: 'Medium · David Kim',                 status: 'Pending Approval', severity: 'Medium',   section: '1. Front Side',     part: 'Headlights' },
      { label: 'VAN-1055', title: 'Wiper blades torn — driver side',             meta: 'Low · James Williams',               status: 'Pending Approval', severity: 'Low',      section: '1. Front Side',     part: 'Wiper blades' },
      { label: 'VAN-2088', title: 'Seatbelt retractor slow',   meta: 'Medium · Sarah Chen',    status: 'Pending Approval', severity: 'Medium', section: '5. In-Cab',     part: 'Seat belts' },
      { label: 'VAN-3099', title: 'Cargo light intermittent',  meta: 'Low · Destiny Brooks',   status: 'Pending Approval', severity: 'Low',    section: '4. Back Side',  part: 'Cargo light' },
    ],
  },
  inspected: {
    title: 'Vans Inspected in Recent QC DVIC',
    accent: 'accent-blue',
    icon: TrendingUp,
    summary: '23 inspected · 7 not inspected · 2 new to approve',
    // category → maps the inspecting vendor's specialty (AMR = Mechanical, Body = body work, etc.)
    // severity → clean | low | medium | high | defective
    inspectedVans: [
      { id: 'VAN-1042', vendor: 'ProFleet Auto Care',       tech: 'Carlos Mendez',  category: 'amr',       severity: 'high',      result: 'Flagged' },
      { id: 'VAN-1018', vendor: 'ProFleet Auto Care',       tech: "Brian O'Connor", category: 'amr',       severity: 'clean',     result: 'Passed' },
      { id: 'VAN-2009', vendor: 'Evergreen Body Works',     tech: 'Luis Ramirez',   category: 'body',      severity: 'low',       result: 'Passed' },
      { id: 'VAN-2015', vendor: 'ProFleet Auto Care',       tech: 'Derek Hayes',    category: 'amr',       severity: 'clean',     result: 'Passed' },
      { id: 'VAN-3021', vendor: 'ProFleet Auto Care',       tech: 'Jamal Foster',   category: 'amr',       severity: 'medium',    result: 'Passed' },
      { id: 'VAN-3044', vendor: 'Evergreen Body Works',     tech: 'Marie Dubois',   category: 'body',      severity: 'low',       result: 'Passed' },
      { id: 'VAN-4005', vendor: 'Discount Tire Commercial', tech: 'Alex Rivera',    category: 'tires',     severity: 'high',      result: 'Flagged' },
      { id: 'VAN-4018', vendor: 'ProFleet Auto Care',       tech: 'Ivan Petrov',    category: 'amr',       severity: 'clean',     result: 'Passed' },
      { id: 'VAN-5008', vendor: 'Spotless Mobile Detail',   tech: 'Jasmine Rhodes', category: 'detailing', severity: 'clean',     result: 'Passed' },
      { id: 'VAN-5012', vendor: 'ProFleet Auto Care',       tech: 'Miguel Torres',  category: 'amr',       severity: 'defective', result: 'Flagged' },
      { id: 'VAN-3077', vendor: 'Discount Tire Commercial', tech: 'Priya Shah',     category: 'tires',     severity: 'medium',    result: 'Passed' },
      { id: 'VAN-2022', vendor: 'Spotless Mobile Detail',   tech: 'Nate Kim',       category: 'detailing', severity: 'clean',     result: 'Passed' },
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
      { fleetId: 'VAN-5012', scheduledAt: 'Tonight, Apr 15 · 22:00 – 02:00', vendor: 'AMR',          defect: 'Grinding noise — front brakes, feels spongy', severity: 'Critical', status: 'Rush Order', repairBucket: 'overnight' },
      { fleetId: 'VAN-2009', scheduledAt: 'Tonight, Apr 15 · 20:00 – 23:00', vendor: 'Body Repairs', defect: 'Minor scratch on driver door',                severity: 'Low',      status: 'Scheduled',  repairBucket: 'shop' },
    ],
  },
};

const DSP_RESPONSE_OPTIONS = ['Confirmed', 'Vehicle not available', 'Cancel'];
const KEY_LOCATION_OPTIONS = ['Cup holder', 'Fuel compartment', 'Other'];

function ScheduledRepairItem({ item }) {
  const [dspResponse, setDspResponse] = useState('');
  const [keyLocation, setKeyLocation] = useState('');
  const [otherText, setOtherText] = useState('');

  const responseColor = dspResponse === 'Confirmed' ? 'border-accent-green/40 text-accent-green bg-accent-green/5'
    : dspResponse === 'Vehicle not available' ? 'border-accent-gold/40 text-accent-gold bg-accent-gold/5'
    : dspResponse === 'Cancel' ? 'border-accent-red/40 text-accent-red bg-accent-red/5'
    : 'border-navy-700 text-navy-200 bg-navy-800';

  return (
    <div className="bg-navy-800/40 border border-navy-700/40 rounded-xl p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-white">{item.fleetId}</span>
            <Badge variant={severityColors[item.severity]}>{item.severity}</Badge>
            <Badge variant="gray">{item.vendor}</Badge>
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
        <div className="text-[10px] uppercase tracking-wide text-navy-500 mb-1">Defect to repair</div>
        <div className="text-sm text-white">{item.defect}</div>
      </div>

      {/* Controls grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* DSP Response */}
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-navy-500 mb-1">DSP Response</label>
          <select
            value={dspResponse}
            onChange={(e) => setDspResponse(e.target.value)}
            className={`w-full rounded-lg px-3 py-2 text-sm border outline-none cursor-pointer transition-colors ${responseColor}`}
          >
            <option value="">Select response…</option>
            {DSP_RESPONSE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Key Location */}
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-navy-500 mb-1">Key Location</label>
          <select
            value={keyLocation}
            onChange={(e) => setKeyLocation(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-navy-200 outline-none focus:border-accent-blue cursor-pointer"
          >
            <option value="">Select location…</option>
            {KEY_LOCATION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Other description */}
      <AnimatePresence>
        {keyLocation === 'Other' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <label className="block text-[10px] uppercase tracking-wide text-navy-500 mb-1">Describe key location</label>
            <input
              type="text"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder="e.g. Glove box, driver seat pocket…"
              className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
              autoFocus
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ Inspected Detail — enhanced renderer for the 'inspected' card ============
// Status is binary from the DSP's perspective: Clean or Defective. Granular
// severity levels still drive row tint but the legend stays minimal.
const INSPECTED_SEVERITY_LEGEND = [
  { id: 'clean',     label: 'Clean',     color: 'text-accent-green', dot: 'bg-accent-green' },
  { id: 'defective', label: 'Defective', color: 'text-accent-red',   dot: 'bg-accent-red' },
];

// Map the 5-level severity into the 2-state dot for row indicators
const SEVERITY_TO_STATE = {
  clean: 'clean',
  low: 'clean',
  medium: 'defective',
  high: 'defective',
  defective: 'defective',
};

const INSPECTOR_CATEGORIES = [
  { id: 'amr',       label: 'AMR',          description: 'Amazon Mechanical Repairs' },
  { id: 'body',      label: 'Body Defects', description: 'Body & paint work' },
  { id: 'tires',     label: 'Tires',        description: 'Tire service' },
  { id: 'detailing', label: 'Detailing',    description: 'Cleaning / interior detail' },
];

// Row backgrounds by severity / result
const ROW_SEVERITY_STYLES = {
  clean:     { bg: 'bg-accent-green/10 hover:bg-accent-green/15',   border: 'border-accent-green/30',  resultText: 'text-accent-green' },
  low:       { bg: 'bg-accent-green/10 hover:bg-accent-green/15',   border: 'border-accent-green/30',  resultText: 'text-accent-green' },
  medium:    { bg: 'bg-accent-gold/10 hover:bg-accent-gold/15',     border: 'border-accent-gold/30',   resultText: 'text-accent-gold' },
  high:      { bg: 'bg-accent-orange/10 hover:bg-accent-orange/15', border: 'border-accent-orange/30', resultText: 'text-accent-orange' },
  defective: { bg: 'bg-accent-red/10 hover:bg-accent-red/15',       border: 'border-accent-red/40',    resultText: 'text-accent-red' },
};

function InspectedDetailRenderer({ data, onOpenVehicleReport }) {
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

  // Derived counts
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const total = inspected.length;
  const withIssues = inspected.filter((v) => v.severity !== 'clean').length;
  const critical = inspected.filter((v) => v.severity === 'defective' || v.severity === 'high').length;
  const grounded = 1;
  const keysRecorded = total - grounded;

  // Primary vendor = the vendor who did the most inspections today
  const vendorCount = {};
  inspected.forEach((v) => { vendorCount[v.vendor] = (vendorCount[v.vendor] || 0) + 1; });
  const primaryVendor = Object.entries(vendorCount).sort((a, b) => b[1] - a[1])[0]?.[0];

  const filteredInspected = activeCategories.length
    ? inspected.filter((v) => activeCategories.includes(v.category))
    : inspected;

  // Map an inspected van to the fleetSnapshotVans record so we can open the
  // existing Vehicle Report Card with real plate, mileage, defects, etc.
  // Every row is clickable — clean vans just show their photos/info, while
  // flagged vans show the Cancel / Approve actions per defect.
  const handleRowClick = (v) => {
    if (!onOpenVehicleReport) return;
    const fleetVan = fleetSnapshotVans.find((fv) => fv.id === v.id);
    if (fleetVan) onOpenVehicleReport(fleetVan);
  };

  return (
    <div className="space-y-4">
      {/* Primary vendor chip */}
      {primaryVendor && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-blue/10 border border-accent-blue/30 text-xs">
          <span className="text-navy-400">Primary Vendor today:</span>
          <span className="text-white font-semibold">{primaryVendor}</span>
        </div>
      )}

      {/* Stats band */}
      <div className="rounded-xl border border-navy-700/40 bg-navy-800/30 p-3">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound size={14} className="text-accent-blue" />
          <span className="text-sm font-semibold text-white"><span className="text-accent-blue">{keysRecorded}</span> keys recorded</span>
          <span className="text-[11px] text-navy-400">&middot; {timeStr}</span>
        </div>
        <div className="text-[11px] text-navy-300">
          <span className="text-white font-semibold">{total}</span> vehicles &middot;{' '}
          <span className="text-accent-orange font-semibold">{withIssues}</span> with issues &middot;{' '}
          <span className="text-accent-red font-semibold">{critical}</span> critical &middot;{' '}
          <span className="text-accent-red font-semibold">{grounded}</span> grounded
        </div>
      </div>

      {/* Severity legend */}
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <span className="text-navy-500 uppercase tracking-wide font-semibold">Severity:</span>
        {INSPECTED_SEVERITY_LEGEND.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
            <span className={s.color}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Category filter checkboxes */}
      <div>
        <div className="text-[10px] text-navy-400 uppercase tracking-wide font-semibold mb-2 flex items-center gap-1.5">
          <Info size={10} /> Filter by inspecting vendor
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {INSPECTOR_CATEGORIES.map((c) => {
            const active = activeCategories.includes(c.id);
            const count = inspected.filter((v) => v.category === c.id).length;
            return (
              <label key={c.id} title={c.description}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all ${
                  active
                    ? 'border-accent-blue/50 bg-accent-blue/10 text-white'
                    : 'border-navy-700 bg-navy-800/40 text-navy-300 hover:border-navy-600 hover:text-white'
                }`}>
                <input type="checkbox" checked={active} onChange={() => toggleCategory(c.id)} className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">{c.label}</span>
                <span className="text-[10px] text-navy-400">({count})</span>
              </label>
            );
          })}
          {activeCategories.length > 0 && (
            <button onClick={() => setActiveCategories([])}
              className="text-[11px] text-accent-red hover:underline">Clear</button>
          )}
        </div>
      </div>

      {/* Inspected list */}
      <div>
        <h4 className="text-xs font-semibold text-accent-green mb-2 uppercase tracking-wide">
          Inspected ({filteredInspected.length}{activeCategories.length > 0 ? ` of ${inspected.length}` : ''})
        </h4>
        <div className="space-y-1.5">
          {filteredInspected.map((v) => {
            // Collapse granular severity into the 2-state (clean/defective) model used by the legend
            const stateId = SEVERITY_TO_STATE[v.severity] || 'clean';
            const sev = INSPECTED_SEVERITY_LEGEND.find((s) => s.id === stateId);
            const cat = INSPECTOR_CATEGORIES.find((c) => c.id === v.category);
            const style = ROW_SEVERITY_STYLES[v.severity] || ROW_SEVERITY_STYLES.clean;
            const flagged = v.result === 'Flagged' || v.severity === 'defective';
            // All rows are clickable now — clicking opens the Vehicle Report Card
            // where defects can be approved (→ Create WO) or rejected.
            const clickable = !!onOpenVehicleReport;
            const defectCount = v.severity === 'defective' ? 5 : v.severity === 'high' ? 3 : v.severity === 'medium' ? 2 : 0;
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
                    {flagged && defectCount > 0 ? (
                      <span className={`font-semibold ${style.resultText}`}>{defectCount} defects</span>
                    ) : (
                      <span className={`font-semibold ${style.resultText}`}>{v.result}</span>
                    )}
                    {' '}<span className="text-navy-300">&mdash; Tech:</span> <span className="text-white">{v.tech}</span>
                  </div>
                  <div className="text-[11px] text-navy-300 truncate">
                    Vendor: <span className="text-white font-medium">{v.vendor}</span>
                    {cat && <> <span className="text-navy-500">·</span> <Badge variant="blue">{cat.label}</Badge></>}
                    {clickable && <span className="text-accent-blue ml-1">&rarr;</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredInspected.length === 0 && (
            <div className="text-center py-6 text-xs text-navy-400">No inspections match the selected filters.</div>
          )}
        </div>
        <p className="text-[10px] text-navy-500 mt-2 italic">Tip: click any van to open its report — from there, approve defects (auto-create a work order) or reject them.</p>
      </div>

      {/* Not inspected list */}
      {notInspected.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-accent-red mb-2 uppercase tracking-wide">Not Inspected ({notInspected.length})</h4>
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
          <h4 className="text-xs font-semibold text-accent-blue mb-2 uppercase tracking-wide">Approve New ({approveNew.length})</h4>
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
function ImmediateDetailRenderer({ items, onApprove, onReject }) {
  // Local state tracks which items were approved or rejected in this session
  const [actions, setActions] = useState({}); // { [label]: 'approved' | 'rejected' }

  const handleApprove = (it) => {
    setActions({ ...actions, [it.label]: 'approved' });
    onApprove?.(it);
  };
  const handleReject = (it) => {
    setActions({ ...actions, [it.label]: 'rejected' });
    onReject?.(it);
  };

  const pending = items.filter((it) => !actions[it.label]);
  const processed = items.filter((it) => actions[it.label]);
  const approvedCount = Object.values(actions).filter((a) => a === 'approved').length;
  const rejectedCount = Object.values(actions).filter((a) => a === 'rejected').length;

  return (
    <div className="space-y-4">
      {/* Summary band */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-navy-400">Defects awaiting your approval</span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-gold/15 border border-accent-gold/40 text-accent-gold font-semibold">
          <Hourglass size={10} /> {pending.length} pending
        </span>
        {approvedCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-green/15 border border-accent-green/40 text-accent-green font-semibold">
            <Check size={10} /> {approvedCount} approved
          </span>
        )}
        {rejectedCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/40 text-accent-red font-semibold">
            <X size={10} /> {rejectedCount} rejected
          </span>
        )}
      </div>

      {pending.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold text-accent-gold uppercase tracking-wide mb-2">
            Pending ({pending.length})
          </h4>
          <div className="space-y-2">
            {pending.map((it) => (
              <div key={it.label} className="bg-navy-800/40 border border-navy-700/40 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-white font-mono">{it.label}</span>
                      {it.severity && <Badge variant={severityColors[it.severity]}>{it.severity}</Badge>}
                      {it.section && <Badge variant="gray">{it.section.split('. ')[1] || it.section}</Badge>}
                    </div>
                    <p className="text-sm text-navy-200">{it.title}</p>
                    <p className="text-[11px] text-navy-400 mt-1">{it.meta}</p>
                  </div>
                  <Badge variant="gold" size="md">Pending</Badge>
                </div>
                <div className="flex items-center gap-1.5 pt-2 border-t border-navy-700/40">
                  <button
                    onClick={() => handleReject(it)}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-accent-red text-[11px] font-semibold hover:bg-accent-red/20 cursor-pointer"
                  >
                    <X size={11} /> Reject
                  </button>
                  <button
                    onClick={() => handleApprove(it)}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-md bg-accent-green text-white text-[11px] font-semibold hover:opacity-90 cursor-pointer shadow-lg shadow-accent-green/20"
                  >
                    <Check size={11} /> Approve &amp; Create WO
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {processed.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-2">
            Processed this session ({processed.length})
          </h4>
          <div className="space-y-1.5">
            {processed.map((it) => {
              const action = actions[it.label];
              return (
                <div key={it.label} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                  action === 'approved' ? 'bg-accent-green/5 border-accent-green/30' : 'bg-accent-red/5 border-accent-red/30'
                }`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-white font-mono">{it.label}</span>
                    <span className="text-[11px] text-navy-300 truncate">{it.title}</span>
                  </div>
                  <Badge variant={action === 'approved' ? 'green' : 'red'} size="md">
                    {action === 'approved' ? <><Check size={9} className="inline mr-0.5" /> Approved → WO</> : <><X size={9} className="inline mr-0.5" /> Rejected</>}
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
          <p className="text-sm text-white">No defects pending approval</p>
        </div>
      )}
    </div>
  );
}

// ============ Scheduled Repairs — split into Overnight + Shop buckets ============
function ScheduledRepairsGrouped({ items }) {
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
            {overnight.map((it) => <ScheduledRepairItem key={it.fleetId} item={it} />)}
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
            {shop.map((it) => <ScheduledRepairItem key={it.fleetId} item={it} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function CardDetailModal({ cardKey, onClose, onOpenVehicleReport, onApproveDefect, onOrderFlexFleet }) {
  if (!cardKey) return null;
  const data = cardDetails[cardKey];
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
            <ImmediateDetailRenderer items={data.items} onApprove={onApproveDefect} />
          ) : data.scheduledItems ? (
            <ScheduledRepairsGrouped items={data.scheduledItems} />
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
                        {it.severity && <Badge variant={severityColors[it.severity]}>{it.severity}</Badge>}
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
              <Truck size={14} /> Order Flex Fleet
            </button>
          ) : <span />}
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-navy-600 text-navy-300 text-sm font-medium hover:bg-navy-800 transition-colors cursor-pointer">
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const CATEGORY_OPTIONS = ['Tires', 'Lights', 'Body', 'Brakes', 'Fluids', 'Windshield', 'Mirrors', 'Doors', 'Other'];
const SEVERITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'];
const STATUS_OPTIONS = ['Logged', 'Scheduled', 'Repair Ordered', 'Rush Order'];

function CreateDefectModal({ onClose, onCreate }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    van: '',
    reportedBy: '',
    category: '',
    severity: 'Medium',
    desc: '',
    status: 'Logged',
    photo: false,
  });
  const [submitted, setSubmitted] = useState(false);

  const canNext1 = form.van.trim() && form.reportedBy.trim();
  const canNext2 = form.category && form.severity && form.desc.trim();

  const handleSubmit = () => {
    onCreate({
      id: `D-${Math.floor(Math.random() * 9000) + 1000}`,
      da: form.reportedBy,
      van: form.van.toUpperCase().startsWith('VAN-') ? form.van.toUpperCase() : `VAN-${form.van}`,
      category: form.category,
      severity: form.severity,
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
              <h3 className="text-lg font-semibold text-white">Create New Defect</h3>
              <p className="text-xs text-navy-400">Step {step} of 3 — {['Vehicle', 'Defect details', 'Review & submit'][step - 1]}</p>
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
              <h4 className="text-lg font-semibold text-white mb-1">Defect Created!</h4>
              <p className="text-sm text-navy-400">{form.van.toUpperCase().startsWith('VAN-') ? form.van.toUpperCase() : `VAN-${form.van}`} added to Today's Defect Reports</p>
            </motion.div>
          ) : (
            <>
              {step === 1 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-navy-300 mb-1.5">Fleet ID *</label>
                    <input
                      type="text"
                      placeholder="e.g. VAN-1042 or 1042"
                      value={form.van}
                      onChange={(e) => setForm({ ...form, van: e.target.value })}
                      className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-navy-300 mb-1.5">Reported by (DA) *</label>
                    <select
                      value={form.reportedBy}
                      onChange={(e) => setForm({ ...form, reportedBy: e.target.value })}
                      className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer"
                    >
                      <option value="">Select driver…</option>
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
                      <label className="block text-xs font-semibold text-navy-300 mb-1.5">Category *</label>
                      <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                        className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer"
                      >
                        <option value="">Select…</option>
                        {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-navy-300 mb-1.5">Severity *</label>
                      <div className="grid grid-cols-2 gap-1">
                        {SEVERITY_OPTIONS.map((s) => (
                          <button
                            key={s}
                            onClick={() => setForm({ ...form, severity: s })}
                            className={`px-2 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                              form.severity === s
                                ? `bg-accent-${severityColors[s] === 'red' ? 'red' : severityColors[s] === 'orange' ? 'orange' : severityColors[s] === 'gold' ? 'gold' : 'blue'}/20 text-accent-${severityColors[s] === 'red' ? 'red' : severityColors[s] === 'orange' ? 'orange' : severityColors[s] === 'gold' ? 'gold' : 'blue'} border-accent-${severityColors[s] === 'red' ? 'red' : severityColors[s] === 'orange' ? 'orange' : severityColors[s] === 'gold' ? 'gold' : 'blue'}/50`
                                : 'border-navy-700 text-navy-400 hover:text-white'
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-navy-300 mb-1.5">Description *</label>
                    <textarea
                      value={form.desc}
                      onChange={(e) => setForm({ ...form, desc: e.target.value })}
                      placeholder="Describe the defect..."
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
                      <Camera size={14} /> Photo attached
                    </span>
                  </label>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-3">
                  <div className="bg-navy-800/50 border border-navy-700 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-navy-400">Fleet ID:</span>
                      <span className="text-white font-semibold">{form.van.toUpperCase().startsWith('VAN-') ? form.van.toUpperCase() : `VAN-${form.van}`}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-navy-400">Driver:</span>
                      <span className="text-white font-semibold">{daList.find(d => d.id === form.reportedBy)?.name || '—'}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-navy-400">Severity:</span>
                      <Badge variant={severityColors[form.severity]} size="md">{form.severity}</Badge>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-navy-400">Category:</span>
                      <Badge variant="gray" size="md">{form.category}</Badge>
                    </div>
                    <div className="text-sm">
                      <div className="text-navy-400 mb-1">Description:</div>
                      <div className="text-white">{form.desc}</div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-navy-300 mb-1.5">Initial Status</label>
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
                          {s}
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
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
                className="px-5 py-2 rounded-lg bg-accent-blue text-white text-sm font-semibold disabled:opacity-40 hover:bg-accent-blue/80 transition-colors cursor-pointer"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                className="px-5 py-2 rounded-lg bg-accent-green text-white text-sm font-semibold hover:bg-accent-green/80 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 size={16} /> Create Defect
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
  { fleetId: 'VAN-5012', scheduledAt: 'Tonight, Apr 15 · 22:00 – 02:00', vendor: 'AMR', defect: 'Grinding noise — front brakes, feels spongy', severity: 'Critical', status: 'Rush Order' },
  { fleetId: 'VAN-2009', scheduledAt: 'Tonight, Apr 15 · 20:00 – 23:00', vendor: 'Body Repairs', defect: 'Minor scratch on driver door', severity: 'Low', status: 'Scheduled' },
  { fleetId: 'VAN-1042', scheduledAt: 'Tonight, Apr 15 · 21:00 – 23:30', vendor: 'AMR', defect: 'Rear left tire tread below 3/32"', severity: 'High', status: 'Scheduled' },
  { fleetId: 'VAN-3021', scheduledAt: 'Tonight, Apr 15 · 19:30 – 21:00', vendor: 'AMR', defect: 'Coolant reservoir below min', severity: 'Medium', status: 'Scheduled' },
];

const PREVIOUS_PENDING = [
  { fleetId: 'VAN-6001', reason: 'Awaiting baseline DVIC approval', days: 2 },
  { fleetId: 'VAN-6002', reason: 'Awaiting baseline DVIC approval', days: 1 },
];

function InspectionReadinessBanner({ onClick }) {
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
          <span className="text-sm font-semibold text-white">QC DVIC Scheduled Tonight</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/40 text-accent-red text-[10px] font-semibold">
            Action Required
          </span>
        </div>
        <div className="text-xs text-navy-300">Confirm QC inspection readiness &mdash; {INSPECTION_VEHICLES.length + 34} vehicles scheduled for tonight</div>
      </div>
      <div className="hidden sm:flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-white group-hover:bg-white/10 transition-all">
        Review <ChevronRight size={12} />
      </div>
    </motion.button>
  );
}

function InspectionVehicleRow({ item }) {
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
            <span className="text-sm font-semibold text-white">{item.fleetId}</span>
            <Badge variant={severityColors[item.severity]}>{item.severity}</Badge>
            <Badge variant="gray">{item.vendor}</Badge>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-navy-300">
            <Clock size={12} className="text-accent-blue" />
            <span>{item.scheduledAt}</span>
          </div>
        </div>
        <Badge variant={defectStatusColors[item.status] || 'gray'} size="md">{item.status}</Badge>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-navy-500 mb-1">Defect to repair</div>
        <div className="text-sm text-white">{item.defect}</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-navy-500 mb-1">DSP Response</label>
          <select value={dspResponse} onChange={(e) => setDspResponse(e.target.value)}
            className={`w-full rounded-lg px-3 py-2 text-sm border outline-none cursor-pointer transition-colors ${responseColor}`}>
            <option value="">Select response…</option>
            {DSP_RESPONSE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-navy-500 mb-1">Key Location</label>
          <select value={keyLocation} onChange={(e) => setKeyLocation(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-navy-200 outline-none focus:border-accent-blue cursor-pointer">
            <option value="">Select location…</option>
            {KEY_LOCATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <AnimatePresence>
        {keyLocation === 'Other' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <label className="block text-[10px] uppercase tracking-wide text-navy-500 mb-1">Describe key location</label>
            <input type="text" value={otherText} onChange={(e) => setOtherText(e.target.value)} placeholder="e.g. Glove box, driver seat pocket…"
              className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" autoFocus />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InspectionReadinessModal({ onClose }) {
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
                <h3 className="text-base font-semibold text-white">Your Quality Control DVIC is scheduled for tonight</h3>
                <div className="flex items-center gap-3 mt-1 text-xs text-navy-300 flex-wrap">
                  <span className="flex items-center gap-1"><Users size={11} className="text-accent-blue" /> {dspName}</span>
                  <span className="flex items-center gap-1"><Calendar size={11} className="text-accent-green" /> {totalVehicles} total vehicles</span>
                  <span className="flex items-center gap-1"><KeyRound size={11} className="text-accent-gold" /> Keys in: <span className="text-white font-medium">{globalKeyLocation}</span></span>
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
              <h4 className="text-lg font-semibold text-white mb-1">QC Inspection Readiness Confirmed</h4>
              <p className="text-sm text-navy-400 mb-4">Inspectors have been notified. {INSPECTION_VEHICLES.length} vehicles scheduled with defect work · {PREVIOUS_PENDING.length} awaiting approval.</p>
              <div className="inline-flex flex-col gap-1 px-4 py-3 rounded-lg bg-navy-800/60 border border-navy-700/40 text-left">
                <div className="text-[11px] text-navy-400">Confirmation ID</div>
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
                    <span className="text-xs font-semibold text-accent-gold uppercase tracking-wide">Previously Awaiting Approval ({PREVIOUS_PENDING.length})</span>
                  </div>
                  <div className="space-y-1.5">
                    {PREVIOUS_PENDING.map((p) => (
                      <div key={p.fleetId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-accent-gold/5 border border-accent-gold/20">
                        <div>
                          <div className="text-sm font-semibold text-white">{p.fleetId}</div>
                          <div className="text-[11px] text-navy-400">{p.reason}</div>
                        </div>
                        <Badge variant="gold" size="md">{p.days}d pending</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Global key location */}
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block flex items-center gap-1.5">
                  <KeyRound size={12} className="text-accent-gold" /> Default key location (all vehicles)
                </label>
                <select
                  value={globalKeyLocation}
                  onChange={(e) => setGlobalKeyLocation(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue cursor-pointer"
                >
                  <option value="Van 4 cabin area">Van 4 cabin area</option>
                  <option value="Cup holder">Cup holder</option>
                  <option value="Fuel compartment">Fuel compartment</option>
                  <option value="Key lockbox — dispatch">Key lockbox — dispatch</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Vehicles list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-navy-300 uppercase tracking-wide">Vehicles scheduled tonight ({INSPECTION_VEHICLES.length})</span>
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
                  <Info size={12} className="text-accent-blue" /> Important notes for Inspectors
                </label>
                <textarea
                  value={inspectorNotes}
                  onChange={(e) => setInspectorNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. Gate code 4827 · back lot entry only after 10pm · contact Maria if issues"
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
              <SkipForward size={14} /> Skip Tonight
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
            >
              {submitting ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> Confirming…</>) : (<><CheckCircle2 size={14} /> Confirm Readiness</>)}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end px-6 py-4 border-t border-navy-800">
            <button onClick={onClose} className="px-5 py-2 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 cursor-pointer">Done</button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ============ Start New Inspection — Vendor/Technician workflow ============
// DSPs assigned to this inspector (assignment is managed from Admin panel)
const ASSIGNED_DSPS = [
  { id: 'DSP-4201', name: 'Ribrell 21',       code: 'RBR', station: 'DSE4', vanCount: 42, address: '13420 NE 20th St, Bellevue WA' },
  { id: 'DSP-4202', name: 'Ceiba Routes',     code: 'CBR', station: 'DSE4', vanCount: 38, address: '8015 Martin Way E, Lacey WA' },
  { id: 'DSP-4203', name: 'TOTL Logistics',   code: 'TTL', station: 'DWA6', vanCount: 51, address: '2200 Alaskan Way, Seattle WA' },
  { id: 'DSP-4204', name: 'Summit Express',   code: 'SEX', station: 'DWA6', vanCount: 29, address: '5005 Union Bay Pl NE, Seattle WA' },
  { id: 'DSP-4205', name: 'Redmond Routes',   code: 'RDM', station: 'DSE4', vanCount: 45, address: '15900 NE 83rd St, Redmond WA' },
];

const INSPECTION_FLEET = [
  { id: 'VAN-1042', model: '2022 Ford Transit 250',   dsp: 'Ribrell 21',     dspId: 'DSP-4201', plate: 'WA-8F42-AZ', lastInspection: '2 days ago' },
  { id: 'VAN-1018', model: '2021 Mercedes Sprinter',  dsp: 'Ribrell 21',     dspId: 'DSP-4201', plate: 'WA-3K18-AZ', lastInspection: '4 hours ago' },
  { id: 'VAN-1033', model: '2023 Ford Transit 250',   dsp: 'Ribrell 21',     dspId: 'DSP-4201', plate: 'WA-1K33-AZ', lastInspection: 'Yesterday' },
  { id: 'VAN-2009', model: '2022 Ford Transit 250',   dsp: 'Ceiba Routes',   dspId: 'DSP-4202', plate: 'WA-2P09-AZ', lastInspection: 'Yesterday' },
  { id: 'VAN-2015', model: '2023 Ram ProMaster 2500', dsp: 'Ceiba Routes',   dspId: 'DSP-4202', plate: 'WA-2G15-AZ', lastInspection: '3 days ago' },
  { id: 'VAN-2022', model: '2022 Mercedes Sprinter',  dsp: 'Ceiba Routes',   dspId: 'DSP-4202', plate: 'WA-2M22-AZ', lastInspection: '5 hours ago' },
  { id: 'VAN-3021', model: '2022 Ford Transit 350',   dsp: 'TOTL Logistics', dspId: 'DSP-4203', plate: 'WA-5H21-AZ', lastInspection: '6 hours ago' },
  { id: 'VAN-3044', model: '2023 Mercedes Sprinter',  dsp: 'TOTL Logistics', dspId: 'DSP-4203', plate: 'WA-6M44-AZ', lastInspection: 'Yesterday' },
  { id: 'VAN-4005', model: '2021 Ford Transit 250',   dsp: 'Summit Express', dspId: 'DSP-4204', plate: 'WA-4B05-AZ', lastInspection: '1 week ago' },
  { id: 'VAN-5008', model: '2022 Ram ProMaster 1500', dsp: 'Redmond Routes', dspId: 'DSP-4205', plate: 'WA-7R08-AZ', lastInspection: 'Today' },
  { id: 'VAN-5012', model: '2023 Ford Transit 350',   dsp: 'Redmond Routes', dspId: 'DSP-4205', plate: 'WA-7R12-AZ', lastInspection: '2 days ago' },
];

const SECTION_SEVERITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'];

function InspectionSectionRow({ section, state, onStateChange }) {
  const isIssue = state?.status === 'issue';
  const isOk = state?.status === 'ok';

  const toggleDefect = (part) => {
    const current = state?.defects || [];
    const exists = current.find((d) => d.part === part);
    const next = exists
      ? current.filter((d) => d.part !== part)
      : [...current, { part, severity: 'Medium', note: '' }];
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
          <span className="text-sm font-semibold text-white">{section.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onStateChange({ status: 'ok', defects: [] })}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
              isOk
                ? 'bg-accent-green/20 border-accent-green/50 text-accent-green'
                : 'bg-navy-800 border-navy-700 text-navy-300 hover:border-navy-600'
            }`}
          >✓ OK</button>
          <button
            onClick={() => onStateChange({ status: 'issue', defects: state?.defects || [] })}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
              isIssue
                ? 'bg-accent-orange/20 border-accent-orange/50 text-accent-orange'
                : 'bg-navy-800 border-navy-700 text-navy-300 hover:border-navy-600'
            }`}
          >⚠ Issue</button>
        </div>
      </div>

      <AnimatePresence>
        {isIssue && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-2 border-t border-navy-700/40">
              <div className="text-[10px] uppercase tracking-wide text-navy-500 mt-3 mb-1">Select affected parts</div>
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
                      {part}
                    </button>
                  );
                })}
              </div>

              {(state?.defects || []).length > 0 && (
                <div className="mt-3 space-y-2">
                  {state.defects.map((d) => (
                    <div key={d.part} className="bg-navy-900/60 border border-navy-700/40 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-white">{d.part}</span>
                        <select
                          value={d.severity}
                          onChange={(e) => updateDefect(d.part, 'severity', e.target.value)}
                          className="text-xs rounded-md px-2 py-1 bg-navy-800 border border-navy-700 text-white outline-none cursor-pointer"
                        >
                          {SECTION_SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <input
                        type="text"
                        value={d.note}
                        onChange={(e) => updateDefect(d.part, 'note', e.target.value)}
                        placeholder="Describe the defect (e.g. 'cracked lens, visible hairline')"
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
                <h3 className="text-base font-semibold text-white truncate">Start New Inspection</h3>
                <p className="text-[11px] text-navy-400 truncate">Inspector: <span className="text-white font-medium">{user?.name || 'Technician'}</span></p>
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
              <span className={`truncate ${step >= 1 ? 'text-white font-semibold' : ''}`}>1. DSP &amp; Vehicle</span>
              <span className={`truncate ${step >= 2 ? 'text-white font-semibold' : ''}`}>2. Walkthrough</span>
              <span className={`truncate ${step >= 3 ? 'text-white font-semibold' : ''}`}>3. Submit</span>
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
                <h4 className="text-lg font-semibold text-white mb-1">Inspection Submitted</h4>
                <p className="text-sm text-navy-400 mb-4">
                  {totalDefects > 0 ? `${totalDefects} defect${totalDefects > 1 ? 's' : ''} reported across ${issueSections} section${issueSections > 1 ? 's' : ''}.` : 'All sections passed — van is ready to roll.'}
                </p>
                <div className="inline-flex flex-col gap-1 px-4 py-3 rounded-lg bg-navy-800/60 border border-navy-700/40 text-left">
                  <div className="text-[11px] text-navy-400">Inspection ID</div>
                  <div className="text-sm font-mono text-accent-blue">{inspectionId}</div>
                  <div className="text-[11px] text-navy-400 mt-1">DSP: <span className="text-white">{dsp?.name}</span> · Vehicle: <span className="text-white">{vehicle?.id}</span></div>
                  <div className="text-[11px] text-navy-400">Mileage: <span className="text-white">{Number(mileage).toLocaleString()} mi</span></div>
                </div>
                {totalDefects > 0 && (
                  <div className="mt-4 text-[11px] text-navy-400">
                    Work orders for the {totalDefects} defect{totalDefects > 1 ? 's' : ''} have been auto-created and dispatched.
                  </div>
                )}
              </motion.div>
            ) : step === 1 ? (
              <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                {/* DSP selection */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block flex items-center gap-1.5">
                    <Users size={12} className="text-accent-blue" /> DSP (assigned from Admin)
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => setDspDropdownOpen((v) => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-navy-700 bg-navy-800/50 text-left hover:border-navy-600 transition-colors cursor-pointer min-h-[52px]"
                    >
                      {dsp ? (
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{dsp.name} <span className="text-navy-400 font-normal">({dsp.code})</span></div>
                          <div className="text-[11px] text-navy-400 truncate">Station {dsp.station} · {dsp.vanCount} vans · {dsp.address}</div>
                        </div>
                      ) : (
                        <span className="text-sm text-navy-400">Select the DSP to inspect…</span>
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
                                <div className="text-[11px] text-navy-400 truncate">Station {d.station} · {d.vanCount} vans</div>
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
                    <Wrench size={12} className="text-accent-green" /> Vehicle
                    {dsp && <span className="text-[10px] font-normal text-navy-500 ml-auto">{availableVehicles.length} linked to {dsp.code}</span>}
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
                          <div className="text-[11px] text-navy-400 truncate">{vehicle.plate} · Last inspected {vehicle.lastInspection}</div>
                        </div>
                      ) : (
                        <span className="text-sm text-navy-400">{dsp ? 'Select a vehicle from this DSP…' : 'Pick a DSP first'}</span>
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
                                <div className="text-[11px] text-navy-400 truncate">{v.plate} · Last: {v.lastInspection}</div>
                              </div>
                              {vehicle?.id === v.id && <Check size={14} className="text-accent-green shrink-0" />}
                            </button>
                          ))}
                          {availableVehicles.length === 0 && (
                            <div className="px-4 py-6 text-center text-xs text-navy-400">No vehicles registered for this DSP.</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Mileage */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Current odometer reading (miles)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={mileage}
                    onChange={(e) => setMileage(e.target.value)}
                    placeholder="e.g. 48250"
                    className="w-full rounded-lg px-4 py-3 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
                  />
                </div>

                {/* Odometer photo */}
                <div>
                  <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Odometer photo (optional)</label>
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
                          <div className="text-white">Take a photo or upload one</div>
                          <div className="text-navy-400">JPG/PNG — speeds up mileage audit</div>
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
                  <div className="text-xs text-navy-400">Mark each section as OK or report issues.</div>
                  <div className="text-[11px] text-navy-400">
                    <span className="text-accent-green font-semibold">{okSections}</span> OK ·
                    <span className="text-accent-orange font-semibold ml-1">{issueSections}</span> Issue ·
                    <span className="text-white font-semibold ml-1">{completedSections}/{totalSections}</span>
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
                    <AlertTriangle size={12} /> {totalSections - completedSections} section{totalSections - completedSections > 1 ? 's' : ''} remaining before you can submit.
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <div className="text-xs text-navy-400">Review before submitting.</div>
                <div className="rounded-xl border border-navy-700/60 bg-navy-800/40 p-4 space-y-2">
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400 shrink-0">DSP</span><span className="text-white font-semibold text-right truncate">{dsp?.name} <span className="text-navy-400 font-normal">({dsp?.code})</span></span></div>
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400 shrink-0">Station</span><span className="text-white text-right">{dsp?.station}</span></div>
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400 shrink-0">Vehicle</span><span className="text-white font-semibold text-right truncate">{vehicle?.id} · {vehicle?.model}</span></div>
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400 shrink-0">Odometer</span><span className="text-white text-right">{Number(mileage).toLocaleString()} mi</span></div>
                  <div className="flex justify-between text-sm gap-3"><span className="text-navy-400 shrink-0">Inspector</span><span className="text-white text-right truncate">{user?.name || 'Technician'}</span></div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-accent-green/30 bg-accent-green/5 p-3 text-center">
                    <CheckCircle2 size={16} className="mx-auto text-accent-green mb-1" />
                    <div className="text-[10px] text-navy-400">OK</div>
                    <div className="text-sm font-bold text-white">{okSections}</div>
                  </div>
                  <div className="rounded-lg border border-accent-orange/30 bg-accent-orange/5 p-3 text-center">
                    <AlertTriangle size={16} className="mx-auto text-accent-orange mb-1" />
                    <div className="text-[10px] text-navy-400">Issues</div>
                    <div className="text-sm font-bold text-white">{issueSections}</div>
                  </div>
                  <div className="rounded-lg border border-accent-red/30 bg-accent-red/5 p-3 text-center">
                    <Wrench size={16} className="mx-auto text-accent-red mb-1" />
                    <div className="text-[10px] text-navy-400">Defects</div>
                    <div className="text-sm font-bold text-white">{totalDefects}</div>
                  </div>
                </div>
                {totalDefects > 0 && (
                  <div className="rounded-lg border border-navy-700/40 bg-navy-800/40 p-3">
                    <div className="text-[11px] font-semibold text-navy-300 uppercase tracking-wide mb-2">Defects detected</div>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {Object.entries(sectionStates).flatMap(([secId, state]) => {
                        const sec = inspectionSections.find((s) => s.id === secId);
                        return (state?.defects || []).map((d) => (
                          <div key={`${secId}-${d.part}`} className="flex items-center justify-between text-xs py-1">
                            <span className="text-white">{sec?.name.split('. ')[1]} · {d.part}</span>
                            <Badge variant={d.severity === 'Critical' ? 'red' : d.severity === 'High' ? 'orange' : d.severity === 'Medium' ? 'gold' : 'blue'}>{d.severity}</Badge>
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
            >{step === 1 ? 'Cancel' : 'Back'}</button>
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 ? !canGoStep2 : !canSubmit}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-green to-accent-blue text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >Next <ArrowRight size={14} /></button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent-green to-accent-blue text-white hover:opacity-90 disabled:opacity-40 transition-all cursor-pointer"
              >
                {submitting ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> Submitting…</>) : (<>Submit <Check size={14} /></>)}
              </button>
            )}
          </div>
        )}
        {success && (
          <div className="flex items-center justify-end px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800">
            <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 cursor-pointer">Done</button>
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
          title={current?.vote === 'up' ? `Positive: ${current.attribute}` : 'Give positive feedback'}
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
                  Most impressive attribute
                </div>
                {REPAIR_FEEDBACK_ATTRIBUTES.map((attr) => (
                  <button key={attr} onClick={() => selectAttribute('up', attr)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-white hover:bg-accent-green/10 border-b border-navy-800/60 last:border-b-0">
                    <span>{attr}</span>
                    {current?.vote === 'up' && current?.attribute === attr && <Check size={11} className="text-accent-green" />}
                  </button>
                ))}
                {current?.vote === 'up' && (
                  <button onClick={clear}
                    className="w-full px-3 py-2 text-[11px] text-navy-400 hover:text-accent-red border-t border-navy-800">Clear feedback</button>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <div className="relative">
        <button
          onClick={(e) => { e.stopPropagation(); setOpenDir(openDir === 'down' ? null : 'down'); }}
          title={current?.vote === 'down' ? `Issue: ${current.attribute}` : 'Report an issue'}
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
                  Biggest issue
                </div>
                {REPAIR_FEEDBACK_ATTRIBUTES.map((attr) => (
                  <button key={attr} onClick={() => selectAttribute('down', attr)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-white hover:bg-accent-red/10 border-b border-navy-800/60 last:border-b-0">
                    <span>{attr}</span>
                    {current?.vote === 'down' && current?.attribute === attr && <Check size={11} className="text-accent-red" />}
                  </button>
                ))}
                {current?.vote === 'down' && (
                  <button onClick={clear}
                    className="w-full px-3 py-2 text-[11px] text-navy-400 hover:text-accent-green border-t border-navy-800">Clear feedback</button>
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
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState({}); // { [woId]: { vote: 'up'|'down', attribute } }

  // Sort by most recently completed first
  const sorted = [...repairedWOs].sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

  const filtered = search
    ? sorted.filter((wo) =>
        wo.vehicleId.toLowerCase().includes(search.toLowerCase()) ||
        wo.description.toLowerCase().includes(search.toLowerCase()) ||
        (wo.assignedTechnician || '').toLowerCase().includes(search.toLowerCase())
      )
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
                <h3 className="text-base font-semibold text-white">Defects Repaired — History</h3>
                <p className="text-[11px] text-navy-400">Full audit trail of completed work orders for {user?.role === 'dsp_owner' ? user.org : 'your fleet'}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2 shrink-0"><X size={20} /></button>
          </div>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
              <div className="text-[10px] text-navy-400 uppercase tracking-wide">Total repaired</div>
              <div className="text-base font-bold text-accent-green">{sorted.length}</div>
            </div>
            <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
              <div className="text-[10px] text-navy-400 uppercase tracking-wide">Avg turnaround</div>
              <div className="text-base font-bold text-white">{avgTurnaround}h</div>
            </div>
            <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
              <div className="text-[10px] text-navy-400 uppercase tracking-wide">Technicians</div>
              <div className="text-base font-bold text-white">{uniqueTechs}</div>
            </div>
            <div className="rounded-lg bg-navy-800/60 border border-navy-700/40 px-3 py-2">
              <div className="text-[10px] text-navy-400 uppercase tracking-wide">Top section</div>
              <div className="text-xs font-bold text-white truncate">{topSection ? topSection[0].split('. ')[1] : '—'}</div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 sm:px-6 py-3 border-b border-navy-800">
          <div className="relative">
            <Info size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by van, defect or technician…"
              className="w-full rounded-lg pl-9 pr-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green" />
          </div>
        </div>

        {/* Timeline */}
        <div className="px-4 sm:px-6 py-4 overflow-y-auto flex-1 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-10">
              <CheckCheck size={40} className="text-navy-600 mx-auto mb-2" />
              <p className="text-sm text-white">No repair history {search ? 'matches your search' : 'yet'}</p>
              <p className="text-xs text-navy-400">{search ? 'Try a different keyword' : 'As vendors complete work orders, they appear here'}</p>
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
                          <Badge variant="green" size="md"><CheckCheck size={10} className="inline mr-0.5" /> Completed</Badge>
                          <span className="text-xs font-mono text-accent-green">{wo.id}</span>
                          {wo.flags?.includes('rush_order') && <Badge variant="red"><Flame size={9} className="inline mr-0.5" /> Rush Order</Badge>}
                        </div>
                        <div className="text-sm font-semibold text-white">{wo.description}</div>
                        <div className="text-[11px] text-navy-400 mt-0.5">{wo.section} · {wo.part}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <RepairFeedback woId={wo.id} feedback={feedback} onChange={setFeedback} />
                        <div className="text-right">
                          <div className="text-[11px] text-navy-400">Completed</div>
                          <div className="text-xs text-white">{new Date(wo.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                          <div className="text-[10px] text-navy-500">{new Date(wo.completedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2 text-[11px] flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap text-navy-300">
                        <span className="flex items-center gap-1"><Wrench size={10} className="text-accent-green" /> {wo.assignedTechnician || '—'}</span>
                        <span className="text-navy-600">·</span>
                        <span>{wo.vehicleId}</span>
                        {turnaroundH !== null && (
                          <>
                            <span className="text-navy-600">·</span>
                            <span className="flex items-center gap-1"><Clock size={10} className="text-accent-blue" /> {turnaroundH}h turnaround</span>
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
                            <div className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-2">Repair timeline</div>
                            <div className="space-y-2">
                              <TimelineItem
                                icon={AlertTriangle}
                                color="accent-orange"
                                label="Defect reported"
                                time={new Date(wo.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                detail={wo.reportedBy}
                              />
                              <TimelineItem
                                icon={PlayCircle}
                                color="accent-blue"
                                label={`Assigned to ${wo.assignedTechnician}`}
                                time="Dispatcher accepted"
                                detail={dispatcherNote ? dispatcherNote.replace('Dispatcher: ', '') : 'Work order dispatched'}
                              />
                              <TimelineItem
                                icon={CheckCircle2}
                                color="accent-green"
                                label="Work completed"
                                time={new Date(wo.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                detail={completedNote ? completedNote.replace('Completed: ', '') : 'Work order closed'}
                              />
                            </div>
                          </div>

                          {/* Details grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                            <DetailBox label="Van" value={wo.vehicleId} />
                            <DetailBox label="Year/Model" value={`${wo.year} ${wo.make} ${wo.model}`} />
                            <DetailBox label="Plate" value={wo.plate} mono />
                            <DetailBox label="RO Number" value={wo.roNumber} mono />
                            <DetailBox label="Severity" badge={SEVERITY_COLORS[wo.severity]} badgeValue={wo.severity} />
                            <DetailBox label="Mileage at completion" value={wo.lastMileage ? `${wo.lastMileage.toLocaleString()} mi` : '—'} />
                            <DetailBox label="Photos" value={wo.photos > 0 ? `${wo.photos} attached` : 'None'} />
                            <DetailBox label="FMC" value={wo.fmc} />
                          </div>

                          {/* All notes */}
                          {wo.notes && wo.notes.length > 0 && (
                            <div>
                              <div className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-1.5">All notes ({wo.notes.length})</div>
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
            Showing <span className="text-white font-semibold">{filtered.length}</span> of {sorted.length} repaired defects
          </div>
          <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-navy-800 border border-navy-700 text-white hover:bg-navy-700 cursor-pointer">Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Severity color helper (re-exports concept from WorkOrders)
const SEVERITY_COLORS = { Low: 'blue', Medium: 'gold', High: 'orange', Critical: 'red' };

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

export function TodaysDefectsTable({ defects, daList, onReject, onCreateWO, onOpenCreateDefect, scheduledCount, rushOrderCount, title = "Today's Defects" }) {
  const [activeVendor, setActiveVendor] = useState('all');
  const [rowActions, setRowActions] = useState({}); // id → 'rejected' | 'wo_created'

  const filtered = defects.filter((d) => {
    if (activeVendor === 'all') return true;
    const v = VENDOR_TYPES.find((x) => x.id === activeVendor);
    return v?.categories?.includes(d.category);
  });

  const handleReject = (d) => {
    setRowActions({ ...rowActions, [d.id]: 'rejected' });
    onReject?.(d);
  };
  const handleCreateWO = (d) => {
    setRowActions({ ...rowActions, [d.id]: 'wo_created' });
    onCreateWO?.(d);
  };

  return (
    <div className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-navy-800 bg-navy-950/40 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-accent-orange" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <Badge variant="gray">{defects.length} total</Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {scheduledCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-blue/15 border border-accent-blue/30 text-[11px] font-semibold text-accent-blue">
              {scheduledCount} Scheduled
            </span>
          )}
          {rushOrderCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/30 text-[11px] font-semibold text-accent-red">
              {rushOrderCount} Rush Order
            </span>
          )}
          <button onClick={onOpenCreateDefect}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-blue text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
            <Plus size={12} /> Create Defect
          </button>
        </div>
      </div>

      {/* Vendor filter pills */}
      <div className="px-4 py-2.5 border-b border-navy-800 bg-navy-950/20 flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[10px] text-navy-400 font-semibold uppercase tracking-wide shrink-0 mr-1">Filter:</span>
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
              {v.label}
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
              <th className="text-left px-4 py-2.5 font-semibold">Van</th>
              <th className="text-left px-4 py-2.5 font-semibold">Defect</th>
              <th className="text-left px-4 py-2.5 font-semibold">Category</th>
              <th className="text-left px-4 py-2.5 font-semibold">Severity</th>
              <th className="text-left px-4 py-2.5 font-semibold">Reported by</th>
              <th className="text-left px-4 py-2.5 font-semibold">Status</th>
              <th className="text-right px-4 py-2.5 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const da = daList.find((x) => x.id === d.da);
              const action = rowActions[d.id];
              return (
                <tr key={d.id} className={`border-b border-navy-800/50 last:border-b-0 transition-colors ${
                  action === 'rejected' ? 'bg-accent-red/5 opacity-60'
                  : action === 'wo_created' ? 'bg-accent-green/5'
                  : 'hover:bg-navy-800/30'
                }`}>
                  <td className="px-4 py-2.5 text-white font-semibold font-mono">{d.van}</td>
                  <td className="px-4 py-2.5 text-white">
                    <div className="flex items-center gap-1.5">
                      {d.desc}
                      {d.photo && <Camera size={11} className="text-navy-400" />}
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><Badge variant="gray">{d.category}</Badge></td>
                  <td className="px-4 py-2.5"><Badge variant={severityColors[d.severity]}>{d.severity}</Badge></td>
                  <td className="px-4 py-2.5 text-[11px] text-navy-300">{da?.name || '—'}</td>
                  <td className="px-4 py-2.5"><Badge variant={defectStatusColors[d.status] || 'gray'}>{d.status}</Badge></td>
                  <td className="px-4 py-2.5">
                    {action === 'rejected' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-accent-red font-semibold"><X size={11} /> Rejected</span>
                    ) : action === 'wo_created' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-accent-green font-semibold"><Check size={11} /> WO sent</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleReject(d)}
                          title="Reject defect"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent-red/10 border border-accent-red/40 text-accent-red text-[11px] font-semibold hover:bg-accent-red/20 cursor-pointer">
                          <X size={11} /> Reject
                        </button>
                        <button onClick={() => handleCreateWO(d)}
                          title="Create Work Order for this defect"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent-green text-white text-[11px] font-semibold hover:opacity-90 cursor-pointer">
                          <Check size={11} /> Create WO
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-navy-400">No defects match the selected vendor filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RealDVIC({ user }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [openCard, setOpenCard] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInspection, setShowInspection] = useState(false);
  const [showStartInspection, setShowStartInspection] = useState(false);
  const [showRepairHistory, setShowRepairHistory] = useState(false);
  const [showFlexFleet, setShowFlexFleet] = useState(false);
  const [vehicleReportVan, setVehicleReportVan] = useState(null);
  const [vanUpdates, setVanUpdates] = useState({});
  const [createWOContext, setCreateWOContext] = useState(null); // { van, defect }

  // Completed WOs filtered by DSP (DSP owner sees only theirs; admin sees all)
  const repairedWOs = user?.role === 'dsp_owner'
    ? workOrdersData.filter((wo) => wo.status === 'completed' && wo.dspId === user?.orgId)
    : workOrdersData.filter((wo) => wo.status === 'completed');
  const repairedDefectsCount = repairedWOs.length;
  // "This week" = last 7 days
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const repairedThisWeekCount = repairedWOs.filter((wo) => wo.completedAt && new Date(wo.completedAt) >= oneWeekAgo).length;
  const [newDefects, setNewDefects] = useState([]);

  const allDefects = [...newDefects, ...dvicDefects];
  const totalDefectsToday = allDefects.length;
  const rushOrders = allDefects.filter((d) => d.status === 'Rush Order').length;
  const scheduledTonight = allDefects.filter((d) => d.status === 'Rush Order' || d.status === 'Scheduled').length;
  const notInspected = 7;
  const newToApprove = 2;
  // Defects awaiting DSP approval — drives the AlertTriangle visibility on that card
  const pendingApprovalCount = 10;
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
  const isDspHome = user?.role === 'dsp_owner' || user?.role === 'site_admin';
  const sections = [
    { id: 'overview', label: 'Overview', icon: Shield },
    { id: 'defects', label: "Today's Defects", icon: AlertTriangle },
  ];

  const canStartInspection = user?.role === 'vendor_admin' || user?.role === 'technician' || user?.role === 'site_admin';

  return (
    <div>
      {/* Daily QC Inspection Readiness banner — only for DSP users */}
      {(user?.role === 'dsp_owner' || user?.role === 'site_admin') && (
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
              <span className="text-sm font-semibold text-white">Start a new QC DVIC</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-blue/15 border border-accent-blue/40 text-accent-blue text-[10px] font-semibold">
                Inspector workflow
              </span>
            </div>
            <div className="text-xs text-navy-300">Walk through the 5-section inspection and auto-create work orders for any defects found</div>
          </div>
          <button
            onClick={() => setShowStartInspection(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-green text-white text-sm font-semibold hover:bg-accent-green/80 transition-all cursor-pointer shadow-lg shadow-accent-green/20"
          >
            <PlayCircle size={14} /> Start Inspection
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
                  title="Create work order (no inspection required)"
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white mb-1">{totalDefectsToday}</div>
                <div className="text-sm text-navy-400">DSP-reported defects today</div>
              </div>
              <div className="mt-auto pt-2 flex justify-center">
                {rushOrders > 0 ? (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-red/15 border border-accent-red/30">
                    <span className="text-[10px] font-semibold text-accent-red">{rushOrders} Rush Order</span>
                  </div>
                ) : <div className="h-[22px]" />}
              </div>
            </motion.div>

            {/* Vans Inspected — 23 of 30, next inspection date below */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.4 }}
              onClick={() => setOpenCard('inspected')}
              className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5 hover:border-navy-600/60 transition-all cursor-pointer h-full flex flex-col">
              <div className="flex items-start justify-end mb-3">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-green/15 text-accent-green">+18%</span>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white mb-1">23 <span className="text-navy-400 font-normal text-xl">of 30</span></div>
                <div className="text-sm text-navy-400">Vans Inspected in Recent QC DVIC</div>
              </div>
              <div className="mt-auto pt-2 text-center text-[11px] text-navy-400">
                Next inspection <span className="text-white font-medium">{nextInspectionDate}</span>
              </div>
            </motion.div>

            <div onClick={() => setOpenCard('immediate')} className="cursor-pointer h-full">
              <MetricCard
                icon={pendingApprovalCount > 0 ? AlertTriangle : undefined}
                label="Defects for approval"
                value={pendingApprovalCount}
                color="accent-red"
                delay={0.1}
                labelClassName="text-sm font-semibold text-accent-red"
              />
            </div>

            <div onClick={() => setOpenCard('scheduled')} className="cursor-pointer h-full">
              <MetricCard
                icon={AlertTriangle}
                label="Scheduled Vehicle"
                value={scheduledTonight}
                color="accent-red"
                delay={0.15}
              />
            </div>

            <div onClick={() => setShowRepairHistory(true)} className="cursor-pointer h-full">
              <MetricCard
                label="Defects Repaired"
                value={repairedDefectsCount}
                subtitle={repairedThisWeekCount > 0 ? `${repairedThisWeekCount} this week · tap for history` : 'Completed by vendors'}
                color="accent-green"
                delay={0.2}
                trend={repairedThisWeekCount > 0 ? Math.round((repairedThisWeekCount / Math.max(totalDefectsToday, 1)) * 100) : undefined}
                trendUp
                warning={repairsPendingFeedback > 0 ? `${repairsPendingFeedback} pending feedback` : undefined}
              />
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
            >
              <h3 className="text-sm font-semibold text-white mb-4">Daily Approved vs Repaired Defects</h3>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyInspections}>
                    <XAxis dataKey="day" tick={{ fill: '#829ab1', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#829ab1', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#102a43', border: '1px solid #334e68', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#829ab1' }} />
                    <Bar dataKey="approved" name="Approved Defects" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="repaired" name="Repaired" fill="#627d98" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
              className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
            >
              <h3 className="text-sm font-semibold text-white mb-4">Open Defects</h3>
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

          {/* Reward Tiers with pending award counts */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Gift size={16} className="text-accent-gold" /> DA Reward Tiers
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {Object.entries(tierConfig).map(([tier, cfg]) => (
                <motion.div key={tier} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * Number(tier) }}
                  className={`${cfg.bg} border ${cfg.border} rounded-xl p-4`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Star size={16} style={{ color: cfg.color }} />
                      <span className="text-sm font-semibold text-white">{cfg.label}</span>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      cfg.pending > 0 ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/30' : 'bg-navy-700/30 text-navy-400 border-navy-600/30'
                    }`}>
                      ({cfg.pending}) DAs pending award
                    </span>
                  </div>
                  <div className="text-xs text-navy-300 mb-3">{cfg.range}</div>
                  <div className="flex justify-between text-sm">
                    <div>
                      <div className="text-navy-400 text-[10px]">Cash/defect</div>
                      <div className="font-bold text-white">{cfg.cash}</div>
                    </div>
                    <div>
                      <div className="text-navy-400 text-[10px]">Vendor Bucks</div>
                      <div className="font-bold text-white">{cfg.bucks}</div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

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
            onOrderFlexFleet={isDspHome ? () => { setOpenCard(null); setShowFlexFleet(true); } : null}
            onOpenVehicleReport={(van) => {
              // Close the Vans Inspected modal first, then pop the Vehicle Report Card
              setOpenCard(null);
              setVehicleReportVan({ ...van, ...(vanUpdates[van.id] || {}) });
            }}
            onApproveDefect={(item) => {
              // Close the Immediate modal and open the Create WO modal pre-filled with
              // the defect info so the DSP can choose a vendor and send it off.
              setOpenCard(null);
              const fleetVan = fleetSnapshotVans.find((fv) => fv.id === item.label);
              setCreateWOContext({
                van: fleetVan || null,
                defect: {
                  section: item.section || '',
                  part: item.part || '',
                  description: item.title || '',
                  severity: item.severity || 'Medium',
                },
              });
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
        {createWOContext && (
          <CreateWorkOrderModal
            initialVan={createWOContext.van}
            initialDefect={createWOContext.defect}
            vans={fleetSnapshotVans}
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
        {showStartInspection && <StartInspectionModal user={user} onClose={() => setShowStartInspection(false)} />}
        {showRepairHistory && <RepairHistoryModal repairedWOs={repairedWOs} user={user} onClose={() => setShowRepairHistory(false)} />}
        {showFlexFleet && <FlexFleetModal onClose={() => setShowFlexFleet(false)} />}
      </AnimatePresence>
    </div>
  );
}
