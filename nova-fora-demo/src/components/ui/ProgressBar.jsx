import { motion } from 'framer-motion';

export default function ProgressBar({ value, max = 100, color = '#3b82f6', label, showPercent = true, height = 8 }) {
  const percent = Math.min((value / max) * 100, 100);

  return (
    <div className="w-full">
      {(label || showPercent) && (
        <div className="flex justify-between items-center mb-1.5">
          {label && <span className="text-xs text-navy-300">{label}</span>}
          {showPercent && <span className="text-xs font-semibold text-navy-200">{Math.round(percent)}%</span>}
        </div>
      )}
      <div className="w-full rounded-full overflow-hidden" style={{ height, background: '#1e3a5f' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }}
        />
      </div>
    </div>
  );
}
