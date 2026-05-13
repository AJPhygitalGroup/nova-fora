/**
 * VendorPickerModal — lightweight "pick a vendor before approve" dialog.
 *
 * Surfaces between the DSP's "Create WO" click and the actual
 * `defectReviews.approve()` call. The picker:
 *
 *   - Fetches workshops that handle the defect's `repair_type` from
 *     `/vendor-workshops?repair_type=...` (the same eligibility filter
 *     the auto-router applies server-side).
 *   - Pre-selects the first eligible workshop — that's the one the
 *     auto-router WOULD have picked, so confirming without changing the
 *     selection produces the same outcome as the legacy auto-approve.
 *   - Lets the DSP override by tapping any other row.
 *   - Calls `onConfirm(workshopId)` on submit so the caller can pass
 *     `vendor_workshop_id` to the approve endpoint.
 *
 * Props:
 *   open            — boolean, controls visibility
 *   onClose         — close without picking
 *   onConfirm       — fn(workshopId) — required
 *   repairType      — string ('mechanical' | 'body' | ...); used to filter eligibility
 *   defectSummary   — short string shown at the top so the DSP knows
 *                     what they're routing (e.g. "horn — not_working")
 *   vehicleLabel    — optional, displayed alongside the defect summary
 *
 * Auto-routed pre-selection logic mirrors the server's
 * `wo_router._find_eligible_workshops` (ORDER BY workshop_id, first one
 * wins). When the API list is sorted by name (it is), the visual order
 * matches but the auto-pick is still the first one — that's the row
 * marked "Auto-suggested".
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, MapPin, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { vendorWorkshops as workshopsApi } from '../../api/client';

const REPAIR_TYPE_LABELS = {
  mechanical: 'Mechanical',
  body:       'Body',
  tires:      'Tires',
  pm:         'Preventive Maintenance',
  cnmr:       'Compliance / Non-Mechanical',
  detailing:  'Detailing',
  netradyne:  'Netradyne',
};

export default function VendorPickerModal({
  open,
  onClose,
  onConfirm,
  repairType,
  defectSummary,
  vehicleLabel,
  initialWorkshopId = null,
}) {
  const { t } = useTranslation('fleet');
  const [workshops, setWorkshops] = useState(null);   // null = loading, [] = empty
  const [picked, setPicked] = useState(initialWorkshopId);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setWorkshops(null);
    setLoadError(null);
    workshopsApi
      .list({ repairType, includeInactive: false })
      .then((res) => {
        if (!alive) return;
        const items = res.items || [];
        setWorkshops(items);
        // Pre-select the first (the auto-router's pick) unless caller
        // already specified a preferred initial selection.
        if (initialWorkshopId == null && items.length > 0) {
          setPicked(items[0].id);
        }
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(err?.detail || err?.message || 'Failed to load vendors');
        setWorkshops([]);
      });
    return () => { alive = false; };
  }, [open, repairType, initialWorkshopId]);

  const handleConfirm = async () => {
    if (picked == null) return;
    setSubmitting(true);
    try {
      await onConfirm(picked);
    } finally {
      setSubmitting(false);
    }
  };

  // Helper: pull the underlying int from a 'VW-007' or numeric string id.
  // The component accepts whatever shape the API returns and the caller
  // expects the same int back.
  const idAsNumber = (raw) => {
    if (raw == null) return null;
    if (typeof raw === 'number') return raw;
    const parts = String(raw).split('-');
    const n = parseInt(parts[parts.length - 1], 10);
    return Number.isFinite(n) ? n : null;
  };

  const autoPickId = workshops && workshops.length > 0 ? idAsNumber(workshops[0].id) : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
          onClick={onClose}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 280 }}
            className="bg-navy-900 border border-navy-700 rounded-2xl max-w-md w-full overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-navy-800">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-white">
                  {t('vendorPicker.title', 'Choose vendor')}
                </h3>
                <p className="text-xs text-navy-400 mt-0.5 truncate">
                  {defectSummary}
                  {vehicleLabel && <span className="text-navy-500"> · {vehicleLabel}</span>}
                </p>
              </div>
              <button onClick={onClose} className="text-navy-400 hover:text-white p-1 -mr-1 shrink-0">
                <X size={18} />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {workshops === null ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="text-accent-blue animate-spin" />
                </div>
              ) : loadError ? (
                <div className="px-5 py-6 text-center text-sm text-accent-red">
                  {loadError}
                </div>
              ) : workshops.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-white mb-1">
                    {t('vendorPicker.noEligible', 'No eligible vendors')}
                  </p>
                  <p className="text-xs text-navy-400">
                    {t('vendorPicker.noEligibleHintFmt', {
                      type: REPAIR_TYPE_LABELS[repairType] || repairType,
                      defaultValue: `No active workshop handles ${REPAIR_TYPE_LABELS[repairType] || repairType} repairs yet. Configure one in Admin → Vendor Workshops.`,
                    })}
                  </p>
                </div>
              ) : (
                <>
                  <div className="px-5 py-3 bg-accent-blue/5 border-b border-accent-blue/20 flex items-start gap-2">
                    <Sparkles size={14} className="text-accent-blue shrink-0 mt-0.5" />
                    <p className="text-[11px] text-navy-200 leading-relaxed">
                      {t('vendorPicker.repairTypeHintFmt', {
                        type: REPAIR_TYPE_LABELS[repairType] || repairType,
                        defaultValue: `Workshops that handle ${REPAIR_TYPE_LABELS[repairType] || repairType} repairs. Tap to choose — the first one is the auto-suggested pick.`,
                      })}
                    </p>
                  </div>
                  <div className="divide-y divide-navy-800">
                    {workshops.map((w) => {
                      const wid = idAsNumber(w.id);
                      const selected = picked === wid;
                      const isAuto = wid === autoPickId;
                      return (
                        <button
                          key={w.id}
                          onClick={() => setPicked(wid)}
                          className={`w-full text-left px-5 py-3 transition-colors flex items-start gap-3 ${
                            selected ? 'bg-accent-blue/10' : 'hover:bg-navy-800/40'
                          }`}>
                          <div className={`mt-1 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            selected ? 'border-accent-blue bg-accent-blue' : 'border-navy-600'
                          }`}>
                            {selected && <Check size={9} className="text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-white truncate">{w.name}</span>
                              {isAuto && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide font-bold bg-accent-blue/20 border border-accent-blue/40 text-accent-blue">
                                  <Sparkles size={8} /> {t('vendorPicker.autoSuggested', 'Auto-suggested')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-navy-400 mt-0.5">
                              <MapPin size={9} />
                              <span className="truncate">
                                {(w.repairTypes || []).join(' · ') || repairType}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-navy-800 bg-navy-900/80">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">
                {t('vendorPicker.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleConfirm}
                disabled={picked == null || submitting || (workshops?.length ?? 0) === 0}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
                {submitting && <Loader2 size={14} className="animate-spin" />}
                <Check size={14} />
                {t('vendorPicker.confirm', 'Approve & Send')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
