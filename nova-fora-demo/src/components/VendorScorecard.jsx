/**
 * VendorScorecard — Vendor (workshop) quality scorecard. 100% live:
 * picks the workshop from /vendor-workshops, pulls aggregated DSP
 * feedback from /vendor-scorecard/{ws_id}, and renders the four
 * pillars. Sections we don't yet have data for (price catalog, speed
 * counters, reward tier, service breakdown) render a "coming soon"
 * placeholder rather than mock values — so the page never lies.
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ThumbsUp, ThumbsDown, Clock, DollarSign, Star, Award, AlertTriangle, MessageSquare, Zap, AlertCircle, Loader2 } from 'lucide-react';
import { vendorScorecard as scorecardApi, vendorWorkshops as workshopsApi } from '../api/client';
import MetricCard from './ui/MetricCard';
import ScoreRing from './ui/ScoreRing';
import ProgressBar from './ui/ProgressBar';

// Wire-key → display label for impressive/negative attribute chips.
const ATTRIBUTE_LABEL = {
  turnaround_time: 'Turnaround Time',
  communication: 'Communication',
  professionalism: 'Professionalism',
  work_quality: 'Work Quality',
  price: 'Price',
};

function ComingSoon({ note }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[120px] text-center py-6">
      <div className="text-[11px] uppercase tracking-wider text-navy-500 mb-1">Coming soon</div>
      {note && <div className="text-xs text-navy-400 max-w-[220px]">{note}</div>}
    </div>
  );
}

export default function VendorScorecard() {
  const [workshops, setWorkshops] = useState([]);
  const [selectedWorkshopId, setSelectedWorkshopId] = useState(null);
  const [liveScorecard, setLiveScorecard] = useState(null);
  const [liveBenchmarks, setLiveBenchmarks] = useState(null);
  const [scorecardLoading, setScorecardLoading] = useState(false);

  // ── Load real workshops + auto-pick first ──
  useEffect(() => {
    workshopsApi.list({ includeInactive: false }).then((res) => {
      const items = (res.items || []).filter((w) => w.isActive !== false);
      setWorkshops(items);
      if (items.length > 0) {
        setSelectedWorkshopId((cur) => {
          if (cur) return cur;
          const raw = items[0].id;
          if (typeof raw === 'number') return raw;
          const m = String(raw).match(/(\d+)/);
          return m ? Number(m[1]) : null;
        });
      }
    }).catch(() => {});
  }, []);

  // ── Live scorecard + benchmarks for the selected workshop ──
  useEffect(() => {
    if (!selectedWorkshopId) return;
    setScorecardLoading(true);
    Promise.all([
      scorecardApi.get(selectedWorkshopId, { days: 90 }).catch(() => null),
      scorecardApi.benchmarks(selectedWorkshopId, { days: 90 }).catch(() => null),
    ]).then(([sc, bm]) => {
      setLiveScorecard(sc);
      setLiveBenchmarks(bm);
    }).finally(() => setScorecardLoading(false));
  }, [selectedWorkshopId]);

  const currentWs = workshops.find((w) => {
    const raw = w.id;
    if (typeof raw === 'number') return raw === selectedWorkshopId;
    const m = String(raw).match(/(\d+)/);
    return m && Number(m[1]) === selectedWorkshopId;
  });
  const vendor = currentWs ? {
    id: `WS-${selectedWorkshopId}`,
    name: currentWs.name,
    fullName: currentWs.name,
    primaryVendor: currentWs.repairTypes?.[0] || 'general',
  } : { id: '', name: '—', fullName: '—', primaryVendor: '—' };

  const liveThumbsUp = liveScorecard?.thumbsUp ?? 0;
  const liveThumbsDown = liveScorecard?.thumbsDown ?? 0;
  const liveTotal = liveScorecard?.totalFeedback ?? 0;
  const liveSatisfaction = liveScorecard?.satisfactionPct;
  const satisfactionRate = liveSatisfaction != null ? liveSatisfaction.toFixed(1) : null;
  const topPositive = liveScorecard?.impressiveAttributes?.[0];
  const topNegative = liveScorecard?.negativeAttributes?.[0];
  const liveRecentFeedback = liveScorecard?.recent || [];

  // Overall ring — use live satisfaction% as the overall score for now
  // (the only quality metric we collect). Coming-soon when no data.
  const overallScore = satisfactionRate != null ? Math.round(liveSatisfaction) : null;

  const benchmarkData = liveBenchmarks ? [
    { group: 'Best In Station', satisfaction: liveBenchmarks.bestInStationPct ?? 0 },
    { group: 'Best In Class',   satisfaction: liveBenchmarks.bestInClassPct ?? 0 },
    { group: 'Primary Vendor',  satisfaction: liveBenchmarks.primaryVendorPct ?? 0 },
  ] : [];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">Vendor Scorecard</h2>
        <p className="text-navy-400 text-sm">DFS value proposition &mdash; Quality, Speed, Price & Service at a glance</p>
      </div>

      {/* Vendor picker — real workshops from /vendor-workshops */}
      <div className="flex flex-wrap gap-2 mb-6">
        {workshops.length === 0 && (
          <span className="text-xs text-navy-400">Loading vendors…</span>
        )}
        {workshops.map((w) => {
          const wsIdInt = (() => {
            const raw = w.id;
            if (typeof raw === 'number') return raw;
            const m = String(raw).match(/(\d+)/);
            return m ? Number(m[1]) : null;
          })();
          const active = wsIdInt === selectedWorkshopId;
          return (
            <button
              key={w.id}
              onClick={() => setSelectedWorkshopId(wsIdInt)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                active
                  ? 'bg-accent-blue text-white shadow-lg shadow-accent-blue/20'
                  : 'bg-navy-800/60 text-navy-300 hover:bg-navy-700/60 border border-navy-700/40'
              }`}
            >
              {w.name}
            </button>
          );
        })}
      </div>

      {scorecardLoading && (
        <div className="flex items-center gap-2 text-xs text-navy-400 mb-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading scorecard…
        </div>
      )}

      {/* Overall Score + Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="col-span-2 lg:col-span-1 bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5 flex flex-col items-center justify-center"
        >
          {overallScore != null ? (
            <ScoreRing score={overallScore} size={100} strokeWidth={8} />
          ) : (
            <div className="w-[100px] h-[100px] rounded-full border-2 border-dashed border-navy-700 flex items-center justify-center text-navy-500 text-xs">
              No data
            </div>
          )}
          <span className="text-sm font-semibold text-white mt-2">Overall Score</span>
          <span className="text-xs text-navy-400">{vendor.fullName}</span>
          <span className="text-[11px] text-navy-300 mt-1">
            <span className="text-navy-500">Primary: </span>
            <span className="text-accent-blue font-medium">{vendor.primaryVendor}</span>
          </span>
        </motion.div>

        <MetricCard
          icon={ThumbsUp}
          label="Satisfaction"
          value={liveTotal > 0 ? `${satisfactionRate}%` : '—'}
          subtitle={liveTotal > 0 ? `${liveTotal} reviews · 90d` : 'No feedback yet'}
          color="accent-green"
          delay={0.05}
        />
        <MetricCard
          icon={Clock}
          label="72-hour Completion"
          value="—"
          subtitle="Coming soon"
          color="accent-blue"
          delay={0.1}
        />
        <MetricCard
          icon={DollarSign}
          label="Enrolled Discount"
          value="—"
          subtitle="Coming soon"
          color="accent-orange"
          delay={0.15}
        />
        <MetricCard
          icon={Award}
          label="Reward Tier"
          value="—"
          subtitle="Coming soon"
          color="accent-purple"
          delay={0.2}
        />
      </div>

      {/* Four Pillar Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Quality & Safety — LIVE */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-accent-green/10 flex items-center justify-center">
              <ThumbsUp size={16} className="text-accent-green" />
            </div>
            <h3 className="text-base font-semibold text-white">Quality & Safety</h3>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-xs text-navy-400 mb-1">Total Reviews</div>
              <div className="text-xl font-bold text-white">{liveTotal}</div>
              <div className="text-xs text-navy-500">{liveTotal === 0 ? 'No feedback yet' : 'Last 90 days'}</div>
            </div>
            <div>
              <div className="text-xs text-navy-400 mb-1">Escalations</div>
              <div className={`text-xl font-bold ${(liveScorecard?.escalations ?? 0) === 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {liveScorecard?.escalations ?? 0}
              </div>
              <div className="text-xs text-navy-500">{(liveScorecard?.escalations ?? 0) === 0 ? 'Clean record' : 'Requires review'}</div>
            </div>
          </div>
          <div className="flex items-center gap-6 mb-4">
            <div className="flex items-center gap-2">
              <ThumbsUp size={14} className="text-accent-green" />
              <span className="text-sm text-white font-semibold">{liveThumbsUp}</span>
            </div>
            <div className="flex items-center gap-2">
              <ThumbsDown size={14} className="text-accent-red" />
              <span className="text-sm text-white font-semibold">{liveThumbsDown}</span>
            </div>
            <div className="flex-1">
              <ProgressBar value={liveThumbsUp} max={Math.max(liveTotal, 1)} color="#22c55e" showPercent={false} height={6} />
            </div>
          </div>
          <div className="pt-3 border-t border-navy-800 flex items-center gap-3">
            <AlertCircle size={14} className="text-accent-orange" />
            <span className="text-xs text-navy-400">Top Negative:</span>
            <span className="text-xs text-white font-medium">{topNegative?.label || '—'}</span>
            <span className="ml-auto text-sm font-bold text-accent-orange">{topNegative?.count ?? 0}</span>
          </div>
          <div className="pt-2 flex items-center gap-3">
            <ThumbsUp size={14} className="text-accent-green" />
            <span className="text-xs text-navy-400">Top Positive:</span>
            <span className="text-xs text-white font-medium">{topPositive?.label || '—'}</span>
            <span className="ml-auto text-sm font-bold text-accent-green">{topPositive?.count ?? 0}</span>
          </div>
        </motion.div>

        {/* Satisfaction Benchmarks — LIVE */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center">
              <Zap size={16} className="text-accent-blue" />
            </div>
            <h3 className="text-base font-semibold text-white">Satisfaction Benchmark</h3>
          </div>
          {liveBenchmarks ? (
            <>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={benchmarkData} barSize={32}>
                    <XAxis dataKey="group" tick={{ fill: '#829ab1', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#829ab1', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                    <Tooltip contentStyle={{ background: '#102a43', border: '1px solid #334e68', borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v}%`]} />
                    <Bar dataKey="satisfaction" name="Satisfaction" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-4 mt-1 text-[11px] text-navy-400 justify-center">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-green" />Satisfaction % (90d)</span>
              </div>
            </>
          ) : (
            <div className="h-[180px] flex items-center justify-center">
              <ComingSoon note="Needs more feedback across the station to compute benchmarks." />
            </div>
          )}
        </motion.div>

        {/* Price — placeholder */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-accent-orange/10 flex items-center justify-center">
              <DollarSign size={16} className="text-accent-orange" />
            </div>
            <h3 className="text-base font-semibold text-white">Price</h3>
          </div>
          <ComingSoon note="Per-workshop labor-rate catalog + enrollment status will live here once the price endpoint is wired." />
        </motion.div>

        {/* Service — placeholder */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-accent-purple/10 flex items-center justify-center">
              <Star size={16} className="text-accent-purple" />
            </div>
            <h3 className="text-base font-semibold text-white">Service</h3>
          </div>
          <ComingSoon note="Communication / cleanliness / key handling / rewards-adoption breakdown lands when the service endpoint is wired." />
        </motion.div>
      </div>

      {/* Recent Customer Feedback — LIVE */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl overflow-hidden"
      >
        <div className="flex items-center justify-between p-5 border-b border-navy-700/40">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-accent-blue" />
            <h3 className="text-base font-semibold text-white">Recent Customer Feedback</h3>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-accent-blue/15 border border-accent-blue/40 text-accent-blue font-semibold">
            {liveRecentFeedback.length} reviews · 90d
          </span>
        </div>
        {liveRecentFeedback.length === 0 ? (
          <div className="p-10 text-center text-sm text-navy-400">
            No customer feedback in the last 90 days. DSPs leave reviews from the
            "Defects Repaired" tile on their home dashboard once a work order completes.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-navy-400 text-xs border-b border-navy-800">
                  <th className="text-left px-5 py-3 font-medium">WO</th>
                  <th className="text-left px-5 py-3 font-medium">Van</th>
                  <th className="text-left px-5 py-3 font-medium">Customer</th>
                  <th className="text-left px-5 py-3 font-medium">Reviewed by</th>
                  <th className="text-center px-5 py-3 font-medium">Vote</th>
                  <th className="text-left px-5 py-3 font-medium">Attribute</th>
                  <th className="text-left px-5 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {liveRecentFeedback.map((fb) => (
                  <tr key={fb.feedbackId} className="border-b border-navy-800/50 hover:bg-navy-800/30 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-accent-blue">{fb.workOrderIdStr}</td>
                    {/* Display the customer's fleet number ("Van 11", "Van SV12")
                        instead of the internal "VAN-0121" prefix — the DSP
                        doesn't recognize the internal id. Falls back to the
                        internal id only if fleet id is missing. */}
                    <td className="px-5 py-3 text-navy-200">
                      {fb.vehicleFleetId ? `Van ${fb.vehicleFleetId}` : (fb.vehicleIdStr || '—')}
                    </td>
                    <td className="px-5 py-3 text-navy-200">{fb.dspName || '—'}</td>
                    <td className="px-5 py-3 text-navy-300 text-xs">{fb.submittedByName || 'system'}</td>
                    <td className="px-5 py-3 text-center">
                      {fb.vote === 'up' ? (
                        <ThumbsUp size={14} className="text-accent-green inline-block" />
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <ThumbsDown size={14} className="text-accent-red" />
                          {fb.escalate && <AlertTriangle size={12} className="text-accent-red" />}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-navy-200 text-xs">
                      {fb.vote === 'up'
                        ? (fb.impressiveAttribute ? (ATTRIBUTE_LABEL[fb.impressiveAttribute] || fb.impressiveAttribute) : '—')
                        : (fb.negativeAttribute ? (ATTRIBUTE_LABEL[fb.negativeAttribute] || fb.negativeAttribute) : '—')}
                    </td>
                    <td className="px-5 py-3 text-navy-300 text-xs max-w-[280px] truncate" title={fb.reason || ''}>
                      {fb.reason || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}
