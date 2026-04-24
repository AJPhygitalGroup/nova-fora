const variants = {
  green: 'bg-accent-green/15 text-accent-green border-accent-green/30',
  red: 'bg-accent-red/15 text-accent-red border-accent-red/30',
  blue: 'bg-accent-blue/15 text-accent-blue border-accent-blue/30',
  orange: 'bg-accent-orange/15 text-accent-orange border-accent-orange/30',
  purple: 'bg-accent-purple/15 text-accent-purple border-accent-purple/30',
  gold: 'bg-accent-gold/15 text-accent-gold border-accent-gold/30',
  gray: 'bg-navy-600/15 text-navy-300 border-navy-600/30',
};

export default function Badge({ children, variant = 'blue', size = 'sm' }) {
  return (
    <span className={`inline-flex items-center font-semibold border rounded-full ${variants[variant]} ${
      size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
    }`}>
      {children}
    </span>
  );
}
