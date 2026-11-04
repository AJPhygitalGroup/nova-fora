// Shared formatting for the DFS Repair Marketplace screens.

export const money = (n) =>
  Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Mirrors the backend: fee = price × rate, rounded half-up to the cent.
export function feeSplit(price, rate) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return { fee: 0, keep: 0, valid: false };
  const fee = Math.round(p * Number(rate || 0.1) * 100) / 100;
  return { fee, keep: Math.round((p - fee) * 100) / 100, valid: true };
}

export const QUOTE_STATE = {
  submitted: { label: 'Waiting for the fleet owner', cls: 'bg-accent-blue/15 text-accent-blue border-accent-blue/40' },
  revision_requested: { label: 'Lower price requested', cls: 'bg-accent-gold/15 text-accent-gold border-accent-gold/40' },
  approved: { label: 'Approved', cls: 'bg-accent-green/15 text-accent-green border-accent-green/40' },
  rejected: { label: 'Rejected', cls: 'bg-accent-red/15 text-accent-red border-accent-red/40' },
  not_selected: { label: 'Not selected', cls: 'bg-navy-700/40 text-navy-300 border-navy-600' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-navy-700/40 text-navy-300 border-navy-600' },
};

export function stateChip(state) {
  return QUOTE_STATE[state] || { label: state, cls: 'bg-navy-700/40 text-navy-300 border-navy-600' };
}

export const vehicleTitle = (v) => (v ? `${v.year} ${v.make} ${v.model}` : '');

export function errorText(err) {
  if (!err) return '';
  if (err.name === 'NetworkError') return 'Network error — please try again.';
  return err.detail || err.message || 'Something went wrong.';
}
