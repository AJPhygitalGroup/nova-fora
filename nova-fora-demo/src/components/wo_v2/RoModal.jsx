/**
 * RoModal — focused per-RO action surface (Jorge#4).
 *
 * Replaces the "everything in VanDetailView" pattern. When the SW
 * clicks a RO# from the dashboard table, this modal opens with:
 *
 *   1. Header   — RO-NNNN · Van XX · Customer · status pill
 *   2. Status   — interactive StatusChanger (linear flow)
 *   3. Tech     — assign / change technician
 *   4. Schedule — opens ScheduleModal when status='accepted' AND
 *                  ready-to-schedule sub-state. (Jorge#10 — discrete)
 *   5. Defects  — per-defect cost-input + defer
 *   6. Notes    — internal (vendor-only) + customer (with escalate)
 *   7. Options  — collapsible — AMR / advanced (Jorge#6)
 *   8. Footer   — "Open Van" link → VanDetailView
 *
 * Reuses the panels we already built inside SwWoActions.jsx — the
 * actions don't change, only their container does.
 *
 * Per Jorge#5, VanDetailView no longer renders these panels itself.
 * Instead each active RO in the Van view shows a small "Open RO"
 * button that opens this modal.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  X, Loader2, AlertTriangle, ExternalLink, Calendar, ChevronDown, ChevronUp,
  Briefcase, DollarSign,
} from 'lucide-react';
import { workOrders as woApi } from '../../api/client';
import StatusChanger, { StatusPill } from './StatusChanger';
import SwWoActions from './SwWoActions';

export default function RoModal({
  woId,                  // 'WO-00026' or numeric
  onClose,
  onAfterChange,         // refetch hook for the parent table
  onOpenSchedule,        // (wo) => parent opens ScheduleModal
  onOpenComplete,        // (wo) => parent opens CompleteModal
  onOpenDecline,         // (wo) => parent opens DeclineModal
  onOpenVan,             // (vehicleId) => parent navigates to VanDetailView
}) {
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showOptions, setShowOptions] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    woApi
      .get(woId)
      .then(setWo)
      .catch((e) => setErr(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [woId]);

  useEffect(() => { load(); }, [load]);

  // Compose a WoSummaryRo-shaped row to feed SwWoActions (which
  // expects that shape from the wo-summary endpoint). Map fields
  // from the WO detail response so the existing component reuses
  // without modification.
  const row = wo ? composeSwWoRow(wo) : null;

  const refetch = () => {
    load();
    onAfterChange && onAfterChange();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-text-strong">
              {wo ? roLabel(wo) : 'Loading…'}
            </h3>
            <p className="text-[11px] text-text-muted">
              {wo && (
                <>
                  Van {wo.vehicleFleetId || wo.vehicleIdStr || wo.vehicleId}
                  {wo.dspName ? ` · ${wo.dspName}` : ''}
                  {wo.workshopName ? ` · ${wo.workshopName}` : ''}
                </>
              )}
            </p>
          </div>
          {wo && (
            <div className="ml-3 shrink-0">
              <StatusPill wo={wo} />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-2 text-text-muted hover:text-text-strong p-2 -mr-2"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-6 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Loading…
            </div>
          )}
          {err && (
            <div className="px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {err}
            </div>
          )}
          {!loading && wo && (
            <>
              {/* ── Status changer (always at the top) ── */}
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                  Status
                </div>
                <StatusChanger
                  wo={wo}
                  onAfter={refetch}
                  onOpenDeclineModal={() => onOpenDecline && onOpenDecline(wo)}
                  onOpenCompleteModal={() => onOpenComplete && onOpenComplete(wo)}
                  /* onOpenScheduleModal is intentionally omitted — see
                     Jorge#10. Schedule is its own discrete action below. */
                />
              </section>

              {/* ── Discrete Schedule action (Jorge#10) ── */}
              {canSchedule(wo) && (
                <section className="rounded-md border border-accent-green/40 bg-accent-green/5 px-3 py-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-accent-green" />
                  <div className="flex-1 text-xs">
                    <div className="font-semibold text-accent-green">Ready to schedule</div>
                    <div className="text-text-muted">Pick a date/time + bucket so the DSP and tech see it on their Scheduled Repairs card.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenSchedule && onOpenSchedule(wo)}
                    className="px-3 py-1.5 rounded-md bg-accent-green text-navy-950 text-xs font-semibold hover:opacity-90"
                  >
                    Schedule pickup
                  </button>
                </section>
              )}

              {/* ── Everything else (tech / cost / notes / defer / mid-find) ──
                  Re-uses SwWoActions which already encapsulates all the
                  RO-scoped panels (Jorge#5 moves them out of VanDetailView). */}
              {row && (
                <SwWoActions row={row} onChanged={refetch} />
              )}

              {/* ── Options ▾ — hide AMR / advanced actions by default (Jorge#6) ── */}
              <section className="rounded-md border border-navy-800 bg-navy-900/40">
                <button
                  type="button"
                  onClick={() => setShowOptions(!showOptions)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-text-muted hover:text-text-strong"
                >
                  {showOptions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  Options
                  <span className="text-text-muted/70 font-normal normal-case">
                    advanced / AMR-specific
                  </span>
                </button>
                {showOptions && <OptionsPanel wo={wo} onAfter={refetch} />}
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button
            type="button"
            onClick={() => {
              if (wo && onOpenVan) onOpenVan(wo.vehicleId);
              onClose && onClose();
            }}
            disabled={!wo}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs text-text-muted hover:text-text-strong border border-navy-700 hover:border-navy-600 disabled:opacity-40"
            title="Jump to the Van detail view"
          >
            <ExternalLink className="w-3 h-3" />
            Open Van
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-xs font-semibold bg-navy-800 text-text-strong hover:bg-navy-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Options panel — AMR-only / advanced. Hidden by default
// because most ROs don't need these; surfacing them on every
// row is noise (Jorge's note: "isn't standard, not always
// showing"). Iter-1 placeholders so the toggle is wired and
// real actions land in iter-2.
// ─────────────────────────────────────────────────────
function OptionsPanel({ wo }) {
  return (
    <div className="px-3 pb-3 space-y-2 border-t border-navy-800 pt-3 text-xs">
      <Option
        icon={DollarSign}
        label="Request AMR payment from FMC"
        sub="Only valid when the RO has an AMR-billed defect with Amazon-cap."
        disabled
      />
      <Option
        icon={Briefcase}
        label="Mark RO as 'No-show'"
        sub="DSP didn't show up at the scheduled slot. Re-routes for re-schedule."
        disabled
      />
      <div className="text-[10px] text-text-muted italic pt-1">
        More options shipping in iter-2 (Jorge#6).
      </div>
    </div>
  );
}

function Option({ icon: Icon, label, sub, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-navy-800 cursor-pointer'
      }`}
    >
      <Icon className="w-3.5 h-3.5 mt-0.5 text-text-muted shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-text-strong">{label}</div>
        <div className="text-text-muted text-[10px]">{sub}</div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────
function roLabel(wo) {
  const primary = (wo.ros || []).find((r) => r.isPrimary) || wo.ros?.[0];
  return primary?.roNumber || wo.id || '—';
}

function canSchedule(wo) {
  if (!wo) return false;
  if (wo.status !== 'accepted') return false;
  const ro = (wo.ros || []).find((r) => r.isPrimary) || wo.ros?.[0];
  if (!ro) return false;
  if (ro.scheduledStartAt) return false;
  if (ro.pickupType) return false;
  // Parts and FMC must be cleared for a clean schedule.
  if (ro.partsOrderedAt && !ro.partsReceivedAt) return false;
  if (ro.submittedToFmcAt && !ro.fmcApprovedAt) return false;
  return true;
}

// Compose a WoSummaryRo-shape from the WO detail so SwWoActions
// (which was built against the wo-summary endpoint shape) works
// without modification. Maps the detail's nested arrays to the
// flat fields SwWoActions expects.
function composeSwWoRow(wo) {
  const ro = (wo.ros || []).find((r) => r.isPrimary) || wo.ros?.[0] || null;
  return {
    workOrderId: wo.id,
    workOrderIdStr: wo.id,                       // already prefixed
    repairRequestId: wo.repairRequestId,
    vendorWorkshopId: wo.vendorWorkshopId,
    vendorWorkshopOrgId: wo.workshopOrganizationId || null,
    roNumber: ro?.roNumber || null,
    workshopName: wo.workshopName,
    woStatus: wo.status,
    isPrimary: ro?.isPrimary ?? false,
    assignedTechnicianName: wo.assignedTechnicianName || null,
    estimatedTotal: null,
    scheduledStartAt: ro?.scheduledStartAt || null,
    partsOrderedAt: ro?.partsOrderedAt || null,
    partsReceivedAt: ro?.partsReceivedAt || null,
    submittedToFmcAt: ro?.submittedToFmcAt || null,
    fmcApprovedAt: ro?.fmcApprovedAt || null,
    pickupType: ro?.pickupType || null,
    pickupLocation: ro?.pickupLocation || null,
    keyLocation: ro?.keyLocation || null,
    defects: (wo.defects || []).map((d) => ({
      id: typeof d.id === 'string' ? Number(String(d.id).replace(/\D/g, '')) : d.id,
      idStr: typeof d.id === 'string' ? d.id : `FD-${String(d.id).padStart(3, '0')}`,
      part: d.part,
      type: d.defectType,
      position: d.position,
      source: d.source,
      reportedAt: d.reportedAt,
      notes: d.notes,
      billingType: d.billingType,
      costDecision: d.costDecision,
      estimatedCost: d.estimatedCost,
      fmcCappedAt: d.fmcCappedAt,
    })),
  };
}
