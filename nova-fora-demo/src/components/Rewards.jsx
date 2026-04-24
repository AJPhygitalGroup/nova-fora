import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gift, Award, Shield, Flame, CheckCheck, Hourglass, Lock, Trophy, TrendingUp
} from 'lucide-react';
import { daList, dspRewards } from '../data/mockData';
import Badge from './ui/Badge';
import ProgressBar from './ui/ProgressBar';

const tierConfig = {
  1: { label: 'Tier 1', range: '1–25 defects', cash: '$1', bucks: '$1', color: '#3b82f6' },
  2: { label: 'Tier 2', range: '26–250 defects', cash: '$2', bucks: '$2', color: '#f59e0b' },
  3: { label: 'Tier 3', range: '250+ defects', cash: '$3', bucks: '$3', color: '#8b5cf6' },
};

// Award status: true = awarded, false = pending
const daAwardStatus = {
  'DA-1008': false,
  'DA-1001': true,
  'DA-1004': true,
  'DA-1002': true,
  'DA-1006': true,
  'DA-1003': false,
  'DA-1005': true,
  'DA-1007': true,
  'DA-1009': true,
  'DA-1010': true,
};

export default function Rewards({ user }) {
  const [tab, setTab] = useState('da');

  const totalCashAwarded = daList.reduce((sum, d) => sum + d.cashEarned, 0);
  const totalBucksEarned = daList.reduce((sum, d) => sum + d.vendorBucks, 0);
  const tier3Count = daList.filter((d) => d.tier === 3).length;
  const pendingAwards = daList.filter((d) => daAwardStatus[d.id] === false).length;

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Gift size={20} className="text-accent-gold" />
          <h2 className="text-2xl font-bold text-white">Rewards</h2>
        </div>
        <p className="text-navy-400 text-sm">DA performance incentives &middot; DSP loyalty program</p>
      </div>

      {/* Top stats band */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatTile label="Top-tier DAs" value={tier3Count} subtitle={`${daList.length} total`} icon={Trophy} color="accent-purple" />
        <StatTile label="Cash awarded" value={`$${totalCashAwarded.toLocaleString()}`} subtitle="This month" icon={TrendingUp} color="accent-green" />
        <StatTile label="Vendor Bucks" value={`$${totalBucksEarned.toLocaleString()}`} subtitle="Earned total" icon={Award} color="accent-gold" />
        <StatTile label="Pending awards" value={pendingAwards} subtitle="Needs review" icon={Hourglass} color="accent-orange" />
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 mb-4 sm:mb-6 border-b border-navy-800 overflow-x-auto">
        {[
          { id: 'da', label: 'DA Rewards', icon: Award },
          { id: 'dsp', label: 'DSP Rewards', icon: Shield },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                active ? 'text-white' : 'text-navy-400 hover:text-white'
              }`}>
              <Icon size={14} />
              {t.label}
              {active && (
                <motion.div layoutId="rewardsTabIndicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-accent-gold to-accent-orange"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
          {tab === 'da' && <DaRewardsSection />}
          {tab === 'dsp' && <DspRewardsSection />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function StatTile({ label, value, subtitle, icon: Icon, color }) {
  const colorClasses = {
    'accent-green':  { bg: 'bg-accent-green/10',  text: 'text-accent-green',  border: 'border-accent-green/30' },
    'accent-gold':   { bg: 'bg-accent-gold/10',   text: 'text-accent-gold',   border: 'border-accent-gold/30' },
    'accent-purple': { bg: 'bg-accent-purple/10', text: 'text-accent-purple', border: 'border-accent-purple/30' },
    'accent-orange': { bg: 'bg-accent-orange/10', text: 'text-accent-orange', border: 'border-accent-orange/30' },
  };
  const c = colorClasses[color];
  return (
    <div className={`rounded-xl border ${c.border} bg-navy-900/60 p-3 sm:p-4`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-navy-400 uppercase tracking-wide">{label}</span>
        <div className={`w-7 h-7 rounded-md ${c.bg} flex items-center justify-center`}><Icon size={13} className={c.text} /></div>
      </div>
      <div className={`text-xl sm:text-2xl font-bold text-white`}>{value}</div>
      <div className="text-[11px] text-navy-400">{subtitle}</div>
    </div>
  );
}

// ============================================================
// DA Rewards — leaderboard
// ============================================================
function DaRewardsSection() {
  return (
    <div className="space-y-4">
      {/* Tier breakdown card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Object.entries(tierConfig).map(([tier, cfg]) => {
          const count = daList.filter((d) => d.tier === Number(tier)).length;
          return (
            <div key={tier} className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <Badge variant={Number(tier) === 3 ? 'purple' : Number(tier) === 2 ? 'gold' : 'blue'} size="md">{cfg.label}</Badge>
                <span className="text-2xl font-bold text-white">{count}</span>
              </div>
              <div className="text-[11px] text-navy-400">{cfg.range}</div>
              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <span className="text-accent-green font-semibold">{cfg.cash}/defect cash</span>
                <span className="text-navy-500">·</span>
                <span className="text-accent-purple font-semibold">{cfg.bucks}/defect bucks</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Leaderboard table */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-navy-700/40">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Award size={16} className="text-accent-gold" /> DA Leaderboard &mdash; Inspection Champions
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-navy-400 text-xs border-b border-navy-800">
                <th className="text-left px-4 sm:px-5 py-3 font-medium">#</th>
                <th className="text-left px-4 sm:px-5 py-3 font-medium">Driver</th>
                <th className="text-center px-4 sm:px-5 py-3 font-medium">Tier</th>
                <th className="text-right px-4 sm:px-5 py-3 font-medium">Defects</th>
                <th className="text-right px-4 sm:px-5 py-3 font-medium hidden sm:table-cell">Streak</th>
                <th className="text-right px-4 sm:px-5 py-3 font-medium">Cash</th>
                <th className="text-right px-4 sm:px-5 py-3 font-medium hidden sm:table-cell">Bucks</th>
                <th className="text-center px-4 sm:px-5 py-3 font-medium">Award</th>
              </tr>
            </thead>
            <tbody>
              {[...daList].sort((a, b) => b.totalDefects - a.totalDefects).map((da, i) => {
                const cfg = tierConfig[da.tier];
                const awarded = daAwardStatus[da.id] ?? true;
                return (
                  <motion.tr key={da.id}
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                    className="border-b border-navy-800/50 hover:bg-navy-800/30 transition-colors">
                    <td className="px-4 sm:px-5 py-3">
                      {i < 3 ? (
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          i === 0 ? 'bg-accent-gold/20 text-accent-gold' : i === 1 ? 'bg-navy-400/20 text-navy-300' : 'bg-accent-orange/20 text-accent-orange'
                        }`}>{i + 1}</span>
                      ) : <span className="text-navy-500 text-xs">{i + 1}</span>}
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-white font-medium">{da.name}</td>
                    <td className="px-4 sm:px-5 py-3 text-center">
                      <Badge variant={da.tier === 3 ? 'purple' : da.tier === 2 ? 'gold' : 'blue'}>{cfg.label}</Badge>
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-right text-white font-semibold">{da.totalDefects}</td>
                    <td className="px-4 sm:px-5 py-3 text-right hidden sm:table-cell">
                      <span className="flex items-center justify-end gap-1">
                        <Flame size={12} className={da.streak >= 20 ? 'text-accent-orange' : 'text-navy-500'} />
                        <span className={`font-semibold ${da.streak >= 20 ? 'text-accent-orange' : 'text-navy-300'}`}>{da.streak}d</span>
                      </span>
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-right text-accent-green font-semibold">${da.cashEarned.toLocaleString()}</td>
                    <td className="px-4 sm:px-5 py-3 text-right text-accent-purple font-semibold hidden sm:table-cell">${da.vendorBucks.toLocaleString()}</td>
                    <td className="px-4 sm:px-5 py-3 text-center">
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

        <div className="p-4 sm:p-5 bg-navy-800/30 border-t border-navy-700/40">
          <div className="flex items-start gap-3">
            <Lock size={18} className="text-accent-gold mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-white font-medium mb-1">Attrition Lock-In Effect</p>
              <p className="text-xs text-navy-400">
                DAs who leave their DSP restart at Tier 1 and lose accumulated loyalty points.
                This creates a natural retention incentive &mdash; top performers have significant switching costs,
                reducing DSP turnover.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ============================================================
// DSP Rewards — loyalty program
// ============================================================
function DspRewardsSection() {
  return (
    <div className="space-y-4">
      <div className="mb-2">
        <h3 className="text-base font-semibold text-white mb-1">DSP Loyalty Program</h3>
        <p className="text-xs text-navy-400">DSPs unlock admin-team rewards as defect submissions accumulate</p>
      </div>
      {dspRewards.map((item, i) => (
        <motion.div key={item.id}
          initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
          className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-4 sm:p-5">
          <div className="flex items-start justify-between mb-3 gap-4">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-gold/10 border border-accent-gold/30 w-fit">
                <Gift size={14} className="text-accent-gold" />
                <span className="text-sm font-semibold text-white">{item.title}</span>
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-green/10 border border-accent-green/30 w-fit">
                <Shield size={14} className="text-accent-green" />
                <span className="text-xs text-navy-200">{item.detail}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl sm:text-2xl font-bold text-white">{item.totalDefects.toLocaleString()}</div>
              <div className="text-xs text-navy-400">/ {item.target.toLocaleString()} target</div>
            </div>
          </div>
          <ProgressBar value={item.totalDefects} max={item.target} color="#3b82f6" height={8} />
        </motion.div>
      ))}
    </div>
  );
}
