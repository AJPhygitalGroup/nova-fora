import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ThumbsUp, ThumbsDown, Clock, DollarSign, Star, Award, AlertTriangle, ChevronDown, MessageSquare, Zap, AlertCircle, CheckCircle2 } from 'lucide-react';
import { vendors, vendorScorecard, vendorBenchmarks, repairOrders } from '../data/mockData';
import MetricCard from './ui/MetricCard';
import ScoreRing from './ui/ScoreRing';
import ProgressBar from './ui/ProgressBar';
import Badge from './ui/Badge';

const tierColors = { Platinum: 'purple', Gold: 'gold', Silver: 'gray', Bronze: 'orange' };

function FeedbackModal({ repair, onClose, onSubmit }) {
  const [vote, setVote] = useState(null);
  const [reason, setReason] = useState('');
  const [escalate, setEscalate] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="bg-navy-900 border border-navy-700 rounded-2xl p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white mb-1">Rate This Repair</h3>
        <p className="text-sm text-navy-400 mb-4">{repair.id} &mdash; {repair.desc}</p>
        <div className="flex gap-4 mb-4">
          <button onClick={() => setVote('up')}
            className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all cursor-pointer ${vote === 'up' ? 'border-accent-green bg-accent-green/10' : 'border-navy-700 hover:border-navy-500'}`}>
            <ThumbsUp size={28} className={vote === 'up' ? 'text-accent-green' : 'text-navy-400'} />
            <span className={`text-sm font-medium ${vote === 'up' ? 'text-accent-green' : 'text-navy-300'}`}>Good Job</span>
          </button>
          <button onClick={() => setVote('down')}
            className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all cursor-pointer ${vote === 'down' ? 'border-accent-red bg-accent-red/10' : 'border-navy-700 hover:border-navy-500'}`}>
            <ThumbsDown size={28} className={vote === 'down' ? 'text-accent-red' : 'text-navy-400'} />
            <span className={`text-sm font-medium ${vote === 'down' ? 'text-accent-red' : 'text-navy-300'}`}>Needs Work</span>
          </button>
        </div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell us why (optional)..."
          className="w-full bg-navy-800 border border-navy-700 rounded-lg p-3 text-sm text-white placeholder-navy-500 resize-none h-20 focus:outline-none focus:border-accent-blue" />
        {vote === 'down' && (
          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input type="checkbox" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} className="accent-accent-red" />
            <span className="text-sm text-accent-red flex items-center gap-1"><AlertTriangle size={14} /> Escalate — egregious quality issue</span>
          </label>
        )}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-navy-600 text-navy-300 text-sm font-medium hover:bg-navy-800 transition-colors cursor-pointer">Cancel</button>
          <button onClick={() => { onSubmit({ vote, reason, escalate }); onClose(); }} disabled={!vote}
            className="flex-1 px-4 py-2.5 rounded-lg bg-accent-blue text-white text-sm font-semibold disabled:opacity-40 hover:bg-accent-blue/80 transition-colors cursor-pointer">Submit Feedback</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const IMPRESSIVE_ATTRIBUTES = ['Turnaround Time', 'Communication', 'Professionalism', 'Work Quality', 'Price'];
const NEGATIVE_ATTRIBUTES = ['Turnaround Time', 'Communication', 'Professionalism', 'Work Quality', 'Price'];

export default function VendorScorecard() {
  const [selectedVendor, setSelectedVendor] = useState('V-101');
  const [feedbackRepair, setFeedbackRepair] = useState(null);
  const [showAllRepairs, setShowAllRepairs] = useState(false);
  const [openAttribute, setOpenAttribute] = useState(null); // repair.id
  const [attributeMap, setAttributeMap] = useState({}); // { [repairId]: 'Work Quality' }

  const vendor = vendors.find((v) => v.id === selectedVendor);
  const scores = vendorScorecard[selectedVendor];
  const benchmarks = vendorBenchmarks[selectedVendor];
  const vendorRepairs = repairOrders.filter((r) => r.vendor === selectedVendor);

  const totalFeedback = scores.quality.thumbsUp + scores.quality.thumbsDown;
  const satisfactionRate = ((scores.quality.thumbsUp / totalFeedback) * 100).toFixed(1);

  // Benchmark bar chart: three clusters (Best In Station / Best In Class / Primary Vendor)
  const benchmarkData = [
    { group: 'Best In Station', within24h: benchmarks.bestInStation.within24h, within72h: benchmarks.bestInStation.within72h, rush: benchmarks.bestInStation.rushSameNight },
    { group: 'Best In Class',   within24h: benchmarks.bestInClass.within24h,   within72h: benchmarks.bestInClass.within72h,   rush: benchmarks.bestInClass.rushSameNight },
    { group: 'Primary Vendor',  within24h: benchmarks.primary.within24h,       within72h: benchmarks.primary.within72h,       rush: benchmarks.primary.rushSameNight },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">Vendor Scorecard</h2>
        <p className="text-navy-400 text-sm">DFS value proposition &mdash; Quality, Speed, Price & Service at a glance</p>
      </div>

      {/* Service-type selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {vendors.map((v) => (
          <button key={v.id} onClick={() => setSelectedVendor(v.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              selectedVendor === v.id
                ? 'bg-accent-blue text-white shadow-lg shadow-accent-blue/20'
                : 'bg-navy-800/60 text-navy-300 hover:bg-navy-700/60 border border-navy-700/40'
            }`}
          >
            {v.name}
          </button>
        ))}
      </div>

      {/* Overall Score + Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="col-span-2 lg:col-span-1 bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5 flex flex-col items-center justify-center"
        >
          <ScoreRing score={scores.overall} size={100} strokeWidth={8} />
          <span className="text-sm font-semibold text-white mt-2">Overall Score</span>
          <span className="text-xs text-navy-400">{vendor.fullName}</span>
          <span className="text-[11px] text-navy-300 mt-1">
            <span className="text-navy-500">Primary: </span>
            <span className="text-accent-blue font-medium">{vendor.primaryVendor}</span>
          </span>
        </motion.div>

        <MetricCard icon={ThumbsUp} label="Satisfaction" value={`${satisfactionRate}%`} subtitle={`${totalFeedback} reviews`} trend={2.3} trendUp color="accent-green" delay={0.05} />
        <MetricCard icon={Clock} label="72-hour Completion" value={`${scores.speed.within72h}%`} subtitle="Target: 75%" trend={5.1} trendUp color="accent-blue" delay={0.1} />
        <MetricCard icon={DollarSign} label="Enrolled Discount" value={scores.price.enrolledDiscount ? `${scores.price.avgDiscount}% off` : 'N/A'} subtitle="Rental & Owned Vehicles" color="accent-orange" delay={0.15} />
        <MetricCard icon={Award} label="Reward Tier" value={scores.service.loyaltyTier} subtitle={`${scores.service.loyaltyAdoption}% adoption`} color="accent-purple" delay={0.2} />
      </div>

      {/* Four Pillar Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Quality & Safety */}
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
              <div className="text-xs text-navy-400 mb-1">Customer Feedback (DPMO)</div>
              <div className="text-xl font-bold text-white">{scores.quality.dpmo.toLocaleString()}</div>
              <div className="text-xs text-navy-500">{scores.quality.dpmo <= 10000 ? 'Excellent' : scores.quality.dpmo <= 20000 ? 'Good' : 'Needs Improvement'}</div>
            </div>
            <div>
              <div className="text-xs text-navy-400 mb-1">Escalations</div>
              <div className={`text-xl font-bold ${scores.quality.escalations === 0 ? 'text-accent-green' : 'text-accent-red'}`}>{scores.quality.escalations}</div>
              <div className="text-xs text-navy-500">{scores.quality.escalations === 0 ? 'Clean record' : 'Requires review'}</div>
            </div>
          </div>
          <div className="flex items-center gap-6 mb-4">
            <div className="flex items-center gap-2">
              <ThumbsUp size={14} className="text-accent-green" />
              <span className="text-sm text-white font-semibold">{scores.quality.thumbsUp}</span>
            </div>
            <div className="flex items-center gap-2">
              <ThumbsDown size={14} className="text-accent-red" />
              <span className="text-sm text-white font-semibold">{scores.quality.thumbsDown}</span>
            </div>
            <div className="flex-1">
              <ProgressBar value={scores.quality.thumbsUp} max={totalFeedback} color="#22c55e" showPercent={false} height={6} />
            </div>
          </div>
          {/* Top Defect */}
          <div className="pt-3 border-t border-navy-800 flex items-center gap-3">
            <AlertCircle size={14} className="text-accent-orange" />
            <span className="text-xs text-navy-400">Top Defect:</span>
            <span className="text-xs text-white font-medium">Turnaround time</span>
            <span className="ml-auto text-sm font-bold text-accent-orange">{scores.quality.thumbsDown}</span>
          </div>
          {/* Top Positive Feedback */}
          <div className="pt-2 flex items-center gap-3">
            <ThumbsUp size={14} className="text-accent-green" />
            <span className="text-xs text-navy-400">Top Positive Feedback:</span>
            <span className="text-xs text-white font-medium">Work Quality</span>
            <span className="ml-auto text-sm font-bold text-accent-green">{scores.quality.thumbsUp - 18}</span>
          </div>
        </motion.div>

        {/* 72-hour Turnaround Time with grouped bars */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center">
              <Zap size={16} className="text-accent-blue" />
            </div>
            <h3 className="text-base font-semibold text-white">72-hour Turnaround Time</h3>
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={benchmarkData} barSize={14}>
                <XAxis dataKey="group" tick={{ fill: '#829ab1', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#829ab1', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: '#102a43', border: '1px solid #334e68', borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v}%`]} />
                <Bar dataKey="within24h" name="Within 24h" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="within72h" name="Within 72h" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="rush" name="Rush (same night)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-1 text-[11px] text-navy-400 justify-center">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-green" />Within 24h</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-blue" />Within 72h</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-gold" />Rush (same night)</span>
          </div>
        </motion.div>

        {/* Price */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-accent-orange/10 flex items-center justify-center">
              <DollarSign size={16} className="text-accent-orange" />
            </div>
            <h3 className="text-base font-semibold text-white">Price</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-navy-300">Rental Labor Rate</span>
              <span className="text-sm font-semibold text-white">
                {scores.price.enrolledDiscount ? (
                  <span className="text-accent-green">{scores.price.avgDiscount}% discount (enrolled)</span>
                ) : (
                  <span className="text-navy-400">Standard rate</span>
                )}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-navy-300">Enrollment Status</span>
              <Badge variant={scores.price.enrolledDiscount ? 'green' : 'gray'}>
                {scores.price.enrolledDiscount ? 'Enrolled' : 'Not Enrolled'}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-navy-300">Base Labor Rate</span>
              <span className="text-sm font-semibold text-white">$196</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-navy-300">Oil Change</span>
              <span className="text-sm font-semibold text-white">$89</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-navy-300">Side/Rear Steps</span>
              <span className="text-sm font-semibold text-white">$150</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-navy-300">Side Mirror (R & R)</span>
              <span className="text-sm font-semibold text-white">$280</span>
            </div>
          </div>
        </motion.div>

        {/* Service */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-accent-purple/10 flex items-center justify-center">
              <Star size={16} className="text-accent-purple" />
            </div>
            <h3 className="text-base font-semibold text-white">Service</h3>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Communication', value: scores.service.communication, max: 5 },
              { label: 'Cleanliness', value: scores.service.cleanliness, max: 5 },
              { label: 'Key Handling', value: scores.service.keyHandling, max: 5 },
              { label: 'Rewards Adoption', value: scores.service.loyaltyAdoption, max: 100 },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-navy-300">{item.label}</span>
                  <span className="text-xs font-semibold text-white">
                    {item.max === 5 ? `${item.value}/5.0` : `${item.value}%`}
                  </span>
                </div>
                <ProgressBar value={item.value} max={item.max}
                  color={item.value / item.max >= 0.8 ? '#22c55e' : item.value / item.max >= 0.6 ? '#3b82f6' : '#f59e0b'}
                  showPercent={false} height={5} />
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <Award size={14} className="text-accent-gold" />
              <span className="text-xs text-navy-300">Reward Tier:</span>
              <Badge variant={tierColors[scores.service.loyaltyTier]} size="md">{scores.service.loyaltyTier}</Badge>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Repair Orders with Feedback */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl overflow-hidden"
      >
        <div className="flex items-center justify-between p-5 border-b border-navy-700/40">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-accent-blue" />
            <h3 className="text-base font-semibold text-white">Recent Repairs &mdash; Customer Feedback</h3>
          </div>
          <Badge variant="blue" size="md">{vendorRepairs.length} orders</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-navy-400 text-xs border-b border-navy-800">
                <th className="text-left px-5 py-3 font-medium">Order</th>
                <th className="text-left px-5 py-3 font-medium">Van</th>
                <th className="text-left px-5 py-3 font-medium">Description</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Cost</th>
                <th className="text-center px-5 py-3 font-medium">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {(showAllRepairs ? vendorRepairs : vendorRepairs.slice(0, 5)).map((repair) => (
                <tr key={repair.id} className="border-b border-navy-800/50 hover:bg-navy-800/30 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-accent-blue">{repair.id}</td>
                  <td className="px-5 py-3 text-navy-200">{repair.van}</td>
                  <td className="px-5 py-3 text-navy-200 max-w-[250px] truncate">{repair.desc}</td>
                  <td className="px-5 py-3">
                    <Badge variant={repair.status === 'Completed' ? 'green' : 'orange'}>{repair.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-white font-semibold">${repair.cost}</td>
                  <td className="px-5 py-3 text-center relative">
                    {repair.feedback ? (
                      repair.feedback === 'up' ? (
                        <div className="relative inline-block">
                          <button
                            onClick={() => setOpenAttribute(openAttribute === repair.id ? null : repair.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-accent-green hover:bg-accent-green/10 transition-colors cursor-pointer"
                            title="Select most impressive attribute"
                          >
                            <ThumbsUp size={14} />
                            {attributeMap[repair.id] && (
                              <span className="text-[10px] font-semibold">{attributeMap[repair.id]}</span>
                            )}
                            <ChevronDown size={10} className={`transition-transform ${openAttribute === repair.id ? 'rotate-180' : ''}`} />
                          </button>
                          <AnimatePresence>
                            {openAttribute === repair.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setOpenAttribute(null)} />
                                <motion.div
                                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                                  transition={{ duration: 0.15 }}
                                  className="absolute top-full right-0 mt-1 z-20 bg-navy-900 border border-navy-700 rounded-lg shadow-xl shadow-black/40 overflow-hidden min-w-[180px]"
                                >
                                  <div className="px-3 py-2 border-b border-navy-800 text-[10px] uppercase tracking-wide text-navy-400 font-semibold">
                                    Most Impressive Attribute
                                  </div>
                                  {IMPRESSIVE_ATTRIBUTES.map((attr) => (
                                    <button
                                      key={attr}
                                      onClick={() => {
                                        setAttributeMap({ ...attributeMap, [repair.id]: attr });
                                        setOpenAttribute(null);
                                      }}
                                      className={`w-full text-left px-3 py-2 text-xs hover:bg-navy-800 transition-colors cursor-pointer flex items-center justify-between ${
                                        attributeMap[repair.id] === attr ? 'text-accent-green bg-accent-green/5' : 'text-navy-200'
                                      }`}
                                    >
                                      <span>{attr}</span>
                                      {attributeMap[repair.id] === attr && <CheckCircle2 size={12} className="text-accent-green" />}
                                    </button>
                                  ))}
                                </motion.div>
                              </>
                            )}
                          </AnimatePresence>
                        </div>
                      ) : (
                        <div className="relative inline-block">
                          <button
                            onClick={() => setOpenAttribute(openAttribute === repair.id ? null : repair.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-accent-red hover:bg-accent-red/10 transition-colors cursor-pointer"
                            title="Select biggest issue"
                          >
                            <ThumbsDown size={14} />
                            {attributeMap[repair.id] && (
                              <span className="text-[10px] font-semibold">{attributeMap[repair.id]}</span>
                            )}
                            <ChevronDown size={10} className={`transition-transform ${openAttribute === repair.id ? 'rotate-180' : ''}`} />
                          </button>
                          <AnimatePresence>
                            {openAttribute === repair.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setOpenAttribute(null)} />
                                <motion.div
                                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                                  transition={{ duration: 0.15 }}
                                  className="absolute top-full right-0 mt-1 z-20 bg-navy-900 border border-navy-700 rounded-lg shadow-xl shadow-black/40 overflow-hidden min-w-[180px]"
                                >
                                  <div className="px-3 py-2 border-b border-navy-800 text-[10px] uppercase tracking-wide text-navy-400 font-semibold">
                                    Biggest Issue
                                  </div>
                                  {NEGATIVE_ATTRIBUTES.map((attr) => (
                                    <button
                                      key={attr}
                                      onClick={() => {
                                        setAttributeMap({ ...attributeMap, [repair.id]: attr });
                                        setOpenAttribute(null);
                                      }}
                                      className={`w-full text-left px-3 py-2 text-xs hover:bg-navy-800 transition-colors cursor-pointer flex items-center justify-between ${
                                        attributeMap[repair.id] === attr ? 'text-accent-red bg-accent-red/5' : 'text-navy-200'
                                      }`}
                                    >
                                      <span>{attr}</span>
                                      {attributeMap[repair.id] === attr && <CheckCircle2 size={12} className="text-accent-red" />}
                                    </button>
                                  ))}
                                </motion.div>
                              </>
                            )}
                          </AnimatePresence>
                        </div>
                      )
                    ) : (
                      <button onClick={() => setFeedbackRepair(repair)}
                        className="px-3 py-1 text-xs bg-accent-blue/15 text-accent-blue rounded-full hover:bg-accent-blue/25 transition-colors cursor-pointer font-medium">
                        Rate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {vendorRepairs.length > 5 && (
          <button onClick={() => setShowAllRepairs(!showAllRepairs)}
            className="w-full py-3 text-sm text-accent-blue hover:bg-navy-800/30 transition-colors flex items-center justify-center gap-1 cursor-pointer">
            {showAllRepairs ? 'Show Less' : `Show All (${vendorRepairs.length})`}
            <ChevronDown size={14} className={`transition-transform ${showAllRepairs ? 'rotate-180' : ''}`} />
          </button>
        )}
      </motion.div>

      <AnimatePresence>
        {feedbackRepair && (
          <FeedbackModal repair={feedbackRepair} onClose={() => setFeedbackRepair(null)}
            onSubmit={(data) => console.log('Feedback submitted:', data)} />
        )}
      </AnimatePresence>
    </div>
  );
}
