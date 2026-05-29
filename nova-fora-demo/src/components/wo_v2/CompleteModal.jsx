/**
 * Complete WO modal — captures final mileage (required).
 *
 * The old WorkOrders also required odometer + work photos; we keep
 * iter-1 minimal (mileage only) and add photo upload in a later round
 * once the SW heavy modal lands. Backend re-validates the mileage
 * against `inspectionMileageFloor`; if the entry is below the floor
 * the server returns 422 and we surface the detail.
 */
import { useState } from 'react';
import { X, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { workOrders as woApi } from '../../api/client';

export default function CompleteModal({ wo, onClose, onSuccess }) {
  // Pull whatever floor we can find from the cached WO so the UI can
  // pre-fill a sensible value and warn early — the server still owns
  // the authoritative check.
  const floor = wo._v2?.inspectionMileageFloor
    ?? wo.inspectionMileageFloor
    ?? wo._v2?.lastMileage
    ?? wo.lastMileage
    ?? null;

  const [mileage, setMileage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const parsedMileage = Number(String(mileage).replace(/[^0-9.\-]/g, ''));

  const submit = async () => {
    if (!Number.isFinite(parsedMileage) || parsedMileage < 0) {
      setError('Enter a valid mileage reading');
      return;
    }
    if (floor != null && parsedMileage < Number(floor)) {
      setError(`Mileage must be ≥ last known floor (${floor})`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await woApi.complete(wo.id, { lastMileage: parsedMileage });
      onSuccess && onSuccess();
    } catch (e) {
      setError(e.detail || e.message || 'Complete failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-navy-900 border border-navy-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-navy-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-green/15 border border-accent-green/40 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-accent-green" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-strong">
                Complete {wo.id}
              </h3>
              <p className="text-xs text-text-muted">
                Captures final mileage and marks the work order done.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-strong">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-text-muted mb-1 block uppercase tracking-wider">
              Final mileage *
            </label>
            <input
              type="number"
              min={floor || 0}
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder={floor ? `≥ ${floor}` : 'e.g. 42180'}
              className="w-full rounded-md px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-text-strong"
            />
            {floor != null && (
              <div className="text-xs text-text-muted mt-1">
                Last known reading: {floor}
              </div>
            )}
          </div>
          {error && (
            <div className="text-xs text-accent-red flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-navy-700 bg-navy-900/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium text-text-muted hover:text-text-strong hover:bg-navy-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !mileage}
            className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {submitting ? 'Completing…' : 'Mark complete'}
          </button>
        </div>
      </div>
    </div>
  );
}
