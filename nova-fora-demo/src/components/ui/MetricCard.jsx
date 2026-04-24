import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

const colorMap = {
  'accent-blue':   { bg: 'bg-accent-blue/10',   text: 'text-accent-blue' },
  'accent-green':  { bg: 'bg-accent-green/10',  text: 'text-accent-green' },
  'accent-red':    { bg: 'bg-accent-red/10',    text: 'text-accent-red' },
  'accent-orange': { bg: 'bg-accent-orange/10', text: 'text-accent-orange' },
  'accent-purple': { bg: 'bg-accent-purple/10', text: 'text-accent-purple' },
  'accent-gold':   { bg: 'bg-accent-gold/10',   text: 'text-accent-gold' },
};

export default function MetricCard({ icon: Icon, label, value, subtitle, trend, trendUp, color = 'accent-blue', delay = 0, valueBadge, valueBadgeColor = 'accent-red', labelClassName, warning }) {
  const c = colorMap[color] || colorMap['accent-blue'];
  const hasTopRow = !!Icon || trend !== undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-xl p-5 hover:border-navy-600/60 transition-all duration-300 group h-full flex flex-col"
    >
      {hasTopRow ? (
        <div className="flex items-start justify-between mb-3">
          {Icon ? (
            <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center`}>
              <Icon size={20} className={c.text} />
            </div>
          ) : <div />}
          {trend !== undefined && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              trendUp ? 'bg-accent-green/15 text-accent-green' : 'bg-accent-red/15 text-accent-red'
            }`}>
              {trendUp ? '+' : ''}{trend}%
            </span>
          )}
        </div>
      ) : (
        <div className="h-10 mb-3" />
      )}
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="text-2xl font-bold text-white group-hover:text-navy-50 transition-colors">
            {value}
          </div>
          {valueBadge && (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
              valueBadgeColor === 'accent-red'
                ? 'bg-accent-red/10 border-accent-red/40 text-accent-red'
                : 'bg-accent-green/10 border-accent-green/40 text-accent-green'
            }`}>
              {valueBadge}
            </span>
          )}
        </div>
        <div className={labelClassName || 'text-sm text-navy-400'}>{label}</div>
      </div>
      <div className="mt-auto pt-2 flex flex-col items-center gap-1.5">
        {subtitle && <div className="text-xs text-navy-500 text-center">{subtitle}</div>}
        {warning && (
          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-gold/15 border border-accent-gold/40 text-accent-gold text-[10px] font-semibold">
            <AlertTriangle size={10} /> {warning}
          </div>
        )}
      </div>
    </motion.div>
  );
}
