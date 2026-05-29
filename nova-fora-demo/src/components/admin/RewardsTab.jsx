/**
 * Admin → Rewards tab (mockup p.11).
 *
 * Vendor configures their loyalty program for one workshop at a time:
 *   1. Vendor-bucks % (0-100) of DFS per-defect payout
 *   2. Bucks expiry window (3-12 months)
 *   3. Up to 5 reward tiers — criteria_metric + criteria_count → reward_label
 *      (e.g. "1000 Repaired light bulbs → 3 Free Safety Inspections")
 *
 * Iter-1: ships config UI only — the accrual engine ships in iter-2.
 * site_admin sees the workshop picker (can edit any vendor's program);
 * vendor_admin auto-binds to their workshop.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Gift, Plus, Pencil, Trash2, Loader2, AlertTriangle, AlertCircle, Save, X,
} from 'lucide-react';
import {
  rewards as rewardsApi,
  vendorWorkshops as workshopsApi,
} from '../../api/client';

export default function RewardsTab({ user }) {
  const isSiteAdmin = user?.role === 'site_admin';

  // Workshop selector for site_admin; vendor_admin auto-binds.
  const [workshops, setWorkshops] = useState([]);
  const [workshopId, setWorkshopId] = useState(null);
  const [program, setProgram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Bootstrap workshops + pick the first one
  useEffect(() => {
    workshopsApi
      .list({ includeInactive: false })
      .then((res) => {
        const items = res.items || [];
        const myOrgInt = parseOrgInt(user?.organizationId);
        const mine = isSiteAdmin
          ? items
          : items.filter((w) => Number(w.organizationId) === myOrgInt);
        setWorkshops(mine);
        if (mine.length > 0 && workshopId == null) {
          setWorkshopId(parseOrgInt(mine[0].id));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Fetch program when workshop changes
  const loadProgram = useCallback(() => {
    if (!workshopId) return;
    setLoading(true);
    setErr(null);
    rewardsApi
      .getProgram(workshopId)
      .then(setProgram)
      .catch((e) => setErr(e.detail || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [workshopId]);

  useEffect(() => { loadProgram(); }, [loadProgram]);

  return (
    <div>
      <header className="flex items-center gap-3 mb-4">
        <Gift className="text-accent-gold" size={20} />
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white">Rewards Program</h3>
          <p className="text-xs text-navy-400">
            Configure vendor-bucks payout + up to 5 reward tiers. Customers see their balance + the next tier they're working toward.
          </p>
        </div>
        {workshops.length > 1 && (
          <select
            value={workshopId || ''}
            onChange={(e) => setWorkshopId(Number(e.target.value))}
            className="px-3 py-1.5 rounded-md bg-navy-900 border border-navy-700 text-sm text-text-strong"
          >
            {workshops.map((w) => (
              <option key={w.id} value={parseOrgInt(w.id)}>{w.name}</option>
            ))}
          </select>
        )}
      </header>

      {err && (
        <div className="mb-3 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/40 text-sm text-accent-red flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {err}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading…
        </div>
      )}

      {!loading && program && workshopId && (
        <div className="space-y-4">
          <ProgramSettingsCard workshopId={workshopId} program={program} onSaved={loadProgram} />
          <TiersList workshopId={workshopId} program={program} onChanged={loadProgram} />
        </div>
      )}

      {!loading && !workshopId && (
        <p className="text-sm text-text-muted">
          You don't own any workshops yet — create one in Admin → Organization first.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Program settings card — vendor_bucks_pct + duration
// ─────────────────────────────────────────────────────
function ProgramSettingsCard({ workshopId, program, onSaved }) {
  const [pct, setPct] = useState(String(program.vendorBucksPct ?? 0));
  const [duration, setDuration] = useState(String(program.vendorBucksDurationMonths ?? 6));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Reset local edits when the program reloads
  useEffect(() => {
    setPct(String(program.vendorBucksPct ?? 0));
    setDuration(String(program.vendorBucksDurationMonths ?? 6));
  }, [program]);

  const dirty = (
    Number(pct) !== Number(program.vendorBucksPct ?? 0)
    || Number(duration) !== Number(program.vendorBucksDurationMonths ?? 6)
  );

  const save = async () => {
    const pctNum = Number(pct);
    const durNum = Number(duration);
    if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
      setErr('Bucks % must be between 0 and 100');
      return;
    }
    if (!Number.isInteger(durNum) || durNum < 3 || durNum > 12) {
      setErr('Duration must be a whole number between 3 and 12 months');
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      await rewardsApi.upsertProgram(workshopId, {
        vendorBucksPct: pctNum,
        vendorBucksDurationMonths: durNum,
      });
      onSaved && onSaved();
    } catch (e) {
      setErr(e.detail || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-navy-700 bg-navy-900 p-4">
      <div className="text-sm font-semibold text-white mb-3">Vendor-bucks settings</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">
            Bucks % per defect
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className="flex-1 px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none focus:border-accent-gold"
            />
            <span className="text-text-muted text-sm">%</span>
          </div>
          <div className="text-[10px] text-text-muted mt-1">
            % of the DFS per-defect payout converted to vendor bucks. 0 = no bucks.
          </div>
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 block">
            Expiry window
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="3"
              max="12"
              step="1"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="flex-1 px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none focus:border-accent-gold"
            />
            <span className="text-text-muted text-sm">months</span>
          </div>
          <div className="text-[10px] text-text-muted mt-1">
            How long the DSP has to spend bucks before they expire (3-12).
          </div>
        </label>
      </div>
      {err && (
        <div className="mt-2 text-xs text-accent-red flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {err}
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="px-4 py-2 rounded-md bg-accent-gold text-navy-950 text-sm font-semibold disabled:opacity-40 flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Tier list + add/edit/delete
// ─────────────────────────────────────────────────────
function TiersList({ workshopId, program, onChanged }) {
  const tiers = program.tiers || [];
  const [editingTier, setEditingTier] = useState(null);  // { id?, tier_order, ... } | null
  const [showAdd, setShowAdd] = useState(false);

  const nextOrder = useMemo(() => {
    const orders = new Set(tiers.map((t) => t.tierOrder));
    for (let i = 1; i <= 5; i += 1) {
      if (!orders.has(i)) return i;
    }
    return null;
  }, [tiers]);

  const handleSaved = () => {
    setEditingTier(null);
    setShowAdd(false);
    onChanged && onChanged();
  };

  return (
    <div className="rounded-lg border border-navy-700 bg-navy-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-white">
          Reward tiers <span className="text-text-muted font-normal">· {tiers.length} of 5</span>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          disabled={tiers.length >= 5 || nextOrder == null}
          className="px-3 py-1.5 rounded-md bg-accent-gold/20 border border-accent-gold/50 text-accent-gold text-xs font-semibold flex items-center gap-1 disabled:opacity-40"
        >
          <Plus className="w-3 h-3" />
          Add tier
        </button>
      </div>

      {tiers.length === 0 && !showAdd && (
        <p className="text-xs text-text-muted py-2">
          No tiers configured yet. Add one to start rewarding customers.
        </p>
      )}

      <div className="space-y-2">
        {tiers.map((t) => (
          editingTier?.id === t.id ? (
            <TierForm
              key={t.id}
              workshopId={workshopId}
              initial={t}
              onCancel={() => setEditingTier(null)}
              onSaved={handleSaved}
            />
          ) : (
            <TierRow key={t.id} tier={t} onEdit={() => setEditingTier(t)} onChanged={onChanged} />
          )
        ))}
        {showAdd && nextOrder && (
          <TierForm
            workshopId={workshopId}
            initial={{ tierOrder: nextOrder, metricLabel: '', metricTarget: '', rewardLabel: '' }}
            onCancel={() => setShowAdd(false)}
            onSaved={handleSaved}
          />
        )}
      </div>
    </div>
  );
}

function TierRow({ tier, onEdit, onChanged }) {
  const [busy, setBusy] = useState(false);
  const del = async () => {
    if (!window.confirm(`Remove tier ${tier.tierOrder} — "${tier.rewardLabel}"?`)) return;
    setBusy(true);
    try {
      await rewardsApi.deleteTier(tier.id);
      onChanged && onChanged();
    } catch (e) {
      alert(`Delete failed: ${e.detail || e.message || 'unknown'}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-md border border-navy-800 bg-navy-800/40 px-3 py-2">
      <div className="w-7 h-7 rounded-full bg-accent-gold/20 border border-accent-gold/50 text-accent-gold text-xs font-bold flex items-center justify-center shrink-0">
        {tier.tierOrder}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-strong">
          <span className="font-semibold">{tier.metricTarget.toLocaleString()}</span>{' '}
          <span className="text-text-muted">{tier.metricLabel}</span>{' '}
          <span className="text-text-muted">→</span>{' '}
          <span className="text-accent-gold font-semibold">{tier.rewardLabel}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        className="p-1.5 rounded text-text-muted hover:text-text-strong hover:bg-navy-800"
        title="Edit tier"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={del}
        disabled={busy}
        className="p-1.5 rounded text-accent-red hover:bg-accent-red/10"
        title="Delete tier"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function TierForm({ workshopId, initial, onCancel, onSaved }) {
  const [tierOrder, setTierOrder] = useState(String(initial.tierOrder || 1));
  const [metricTarget, setMetricTarget] = useState(String(initial.metricTarget || ''));
  const [metricLabel, setMetricLabel] = useState(initial.metricLabel || '');
  const [rewardLabel, setRewardLabel] = useState(initial.rewardLabel || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const isEdit = !!initial.id;

  const save = async () => {
    const targetNum = Number(metricTarget);
    if (!metricLabel.trim() || !rewardLabel.trim()) {
      setErr('Both metric label and reward label are required');
      return;
    }
    if (!Number.isInteger(targetNum) || targetNum <= 0) {
      setErr('Target count must be a positive whole number');
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const body = {
        tierOrder: Number(tierOrder),
        metricLabel: metricLabel.trim(),
        metricTarget: targetNum,
        rewardLabel: rewardLabel.trim(),
      };
      if (isEdit) {
        await rewardsApi.patchTier(initial.id, body);
      } else {
        await rewardsApi.addTier(workshopId, body);
      }
      onSaved && onSaved();
    } catch (e) {
      setErr(e.detail || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-accent-gold/50 bg-accent-gold/5 p-3 space-y-2">
      <div className="grid grid-cols-12 gap-2">
        <label className="col-span-2">
          <span className="text-[10px] uppercase text-text-muted tracking-wider mb-1 block">Order</span>
          <select
            value={tierOrder}
            onChange={(e) => setTierOrder(e.target.value)}
            className="w-full px-2 py-1.5 rounded bg-navy-800 border border-navy-700 text-sm text-text-strong"
          >
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="col-span-3">
          <span className="text-[10px] uppercase text-text-muted tracking-wider mb-1 block">Target #</span>
          <input
            type="number"
            min="1"
            value={metricTarget}
            onChange={(e) => setMetricTarget(e.target.value)}
            placeholder="1000"
            className="w-full px-2 py-1.5 rounded bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none focus:border-accent-gold"
          />
        </label>
        <label className="col-span-7">
          <span className="text-[10px] uppercase text-text-muted tracking-wider mb-1 block">Metric label</span>
          <input
            type="text"
            value={metricLabel}
            onChange={(e) => setMetricLabel(e.target.value)}
            placeholder="e.g. repaired light bulbs"
            className="w-full px-2 py-1.5 rounded bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none focus:border-accent-gold"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-[10px] uppercase text-text-muted tracking-wider mb-1 block">Reward</span>
        <input
          type="text"
          value={rewardLabel}
          onChange={(e) => setRewardLabel(e.target.value)}
          placeholder="e.g. 3 Free Safety Inspections"
          className="w-full px-2 py-1.5 rounded bg-navy-800 border border-navy-700 text-sm text-text-strong outline-none focus:border-accent-gold"
        />
      </label>
      {err && (
        <div className="text-xs text-accent-red flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {err}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded text-xs font-medium text-text-muted hover:text-text-strong"
        >
          <X className="w-3 h-3 inline" /> Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 rounded bg-accent-gold text-navy-950 text-xs font-semibold disabled:opacity-40 flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          {isEdit ? 'Save' : 'Add tier'}
        </button>
      </div>
    </div>
  );
}

function parseOrgInt(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}
