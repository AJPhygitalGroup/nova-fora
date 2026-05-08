/**
 * My DSPs — list of DSPs assigned to the current user (vendors / techs / admins).
 *
 * Replaces "My Fleet" for non-DSP roles. The DSP owner keeps "My Fleet" since
 * that view shows their own vehicles — vendors/techs/admins service multiple
 * DSPs and need to see WHICH DSPs they cover before drilling into vans.
 *
 * Flow:
 *   1. List of DSP cards (name, vehicle count, fleet snapshot stats)
 *   2. Click a card → drill-down view (vehicles + recent inspections for THAT DSP)
 *   3. Back arrow → return to the list
 *
 * Tenant scoping is server-side via `vehicles.list({ dspId })`. Each user role
 * gets the DSPs the API returns (currently all of them — vendor↔DSP contract
 * filtering lands post-Jun 15).
 */
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Building2, Truck, ChevronRight, ArrowLeft, Loader2, AlertCircle,
  Search, Star,
} from 'lucide-react';
import {
  directory as directoryApi,
  vehicles as vehiclesApi,
  APIError,
} from '../api/client';


// ─────────────────────────────────────────────────────
// DSP assignment per user — temporary hardcoded scope while the backend
// vendor↔DSP contract table doesn't exist yet (post-Jun 15 work).
//
// For each user email, the value is either:
//   - 'all'                — sees every DSP (admin-style)
//   - Array<orgName>       — sees only the named DSPs
//
// Match is by `dsp.name` so it survives backend ID renumbering. When the
// backend exposes `user.assignedDspIds` via /auth/me, swap this for that.
// ─────────────────────────────────────────────────────
const ASSIGNED_DSPS_BY_EMAIL = {
  // Vendor admin — Olger sees all DSPs his vendor (Dulles Midas) services.
  'olger@dullesmidas.com': 'all',
  // Technician — David is rotated through a subset.
  'david@dullesmidas.com': ['Safety First LLC', 'Ceiba Routes', 'Summit Express'],
  // Site admin — sees everything (platform-wide).
  'maria@novafora.com': 'all',
};


export default function MyDsps({ user }) {
  const { t } = useTranslation('fleet');
  const [dsps, setDsps] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  // Selected DSP for drill-down. Null = list view.
  const [selectedDsp, setSelectedDsp] = useState(null);

  // Initial fetch — orgs (DSPs) + vehicles for the per-DSP van count.
  //
  // Both fetches are independent: a vehicles failure shouldn't hide the DSP
  // list. The orgs list is the source of truth; vehicles just enriches the
  // cards with counts (defaults to 0 when absent).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    directoryApi.organizations({ orgType: 'dsp' })
      .then((res) => {
        if (alive) setDsps(res.items || res || []);
      })
      .catch((err) => {
        if (alive) setError(err instanceof APIError ? err.detail : (err.message || 'Failed to load DSPs'));
      })
      .finally(() => alive && setLoading(false));

    // /vehicles caps per_page at 100 — fetch the first page only. With 5 DSPs
    // × 8 vans demo data we're well under the cap. If a real DSP fleet
    // exceeds 100 vans, the vehicle counts on each card become per-page
    // approximations until we add a `/dsps/{id}/stats` endpoint.
    vehiclesApi.list({ perPage: 100 })
      .then((res) => alive && setVehicles(res.items || []))
      .catch((err) => console.warn('vehicles fetch failed (DSP cards will show 0 vans):', err));

    return () => { alive = false; };
  }, []);

  // Index vehicles by DSP id_str for fast lookup in cards
  const vehiclesByDsp = useMemo(() => {
    const out = {};
    for (const v of vehicles) {
      if (!out[v.dspId]) out[v.dspId] = [];
      out[v.dspId].push(v);
    }
    return out;
  }, [vehicles]);

  // Filter to user's assigned DSPs first, then by search term.
  const assignedDsps = useMemo(() => {
    const scope = ASSIGNED_DSPS_BY_EMAIL[user?.email?.toLowerCase()];
    if (scope === 'all' || scope === undefined) return dsps;  // admin-style or no override → show all
    return dsps.filter((d) => scope.includes(d.name));
  }, [dsps, user?.email]);

  const filteredDsps = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignedDsps;
    return assignedDsps.filter((d) =>
      d.name.toLowerCase().includes(q) || d.id?.toLowerCase().includes(q)
    );
  }, [assignedDsps, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-navy-300">
        <Loader2 size={28} className="animate-spin mr-3" />
        {t('myDsps.loading', 'Loading DSPs…')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-4 py-6 text-center text-accent-red">
        <AlertCircle size={24} className="mx-auto mb-2" />
        <p className="text-sm font-semibold">{t('myDsps.loadError', "Couldn't load DSPs")}</p>
        <p className="text-xs mt-1">{error}</p>
      </div>
    );
  }

  // ─── Drill-down view: vehicles for one DSP ───────────
  if (selectedDsp) {
    const dspVehicles = vehiclesByDsp[selectedDsp.id] || [];
    return (
      <DspDetail
        dsp={selectedDsp}
        vehicles={dspVehicles}
        onBack={() => setSelectedDsp(null)}
      />
    );
  }

  // ─── List view: cards of all assigned DSPs ───────────
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Building2 size={22} className="text-accent-blue" />
            {t('myDsps.heading', 'My DSPs')}
          </h2>
          <p className="text-sm text-navy-400 mt-1">
            {t('myDsps.assignedFmt', {
              count: assignedDsps.length,
              role: user.roleLabel || user.role,
              defaultValue: `${user.roleLabel || user.role} — ${assignedDsps.length} DSP${assignedDsps.length === 1 ? '' : 's'} assigned to you for inspections.`,
            })}
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
          <input
            type="text"
            placeholder={t('myDsps.searchPlaceholder', 'Search DSP…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 rounded-md bg-navy-900 border border-navy-700 text-white text-sm outline-none focus:border-accent-blue w-64"
          />
        </div>
      </div>

      {filteredDsps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-navy-700 bg-navy-900/40 px-6 py-12 text-center">
          <Building2 size={32} className="mx-auto text-navy-500 mb-2" />
          <p className="text-sm text-navy-300">
            {search
              ? t('myDsps.emptyMatchFmt', { search, defaultValue: `No DSPs match "${search}".` })
              : t('myDsps.emptyAssigned', 'No DSPs assigned yet.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredDsps.map((dsp) => {
            const dspVans = vehiclesByDsp[dsp.id] || [];
            const groundedCount = dspVans.filter((v) => v.grounded).length;
            const activeCount = dspVans.filter((v) => v.isActive).length;
            return (
              <motion.button
                key={dsp.id}
                whileHover={{ y: -2 }}
                onClick={() => setSelectedDsp(dsp)}
                className="text-left rounded-xl border-2 border-navy-700 bg-navy-900/60 hover:border-accent-blue hover:bg-navy-900 transition-all p-4 cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Building2 size={14} className="text-accent-blue shrink-0" />
                      <span className="text-[10px] font-mono text-navy-400">{dsp.id}</span>
                    </div>
                    <h3 className="text-base font-semibold text-white truncate">{dsp.name}</h3>
                  </div>
                  <ChevronRight size={16} className="text-navy-500 group-hover:text-accent-blue group-hover:translate-x-0.5 transition-all" />
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Truck size={12} className="text-accent-green" />
                    <span className="text-white font-semibold">{dspVans.length}</span>
                    <span className="text-navy-400">{t('myDsps.vansLabel', 'vans')}</span>
                  </div>
                  {groundedCount > 0 && (
                    <div className="flex items-center gap-1 text-accent-orange">
                      <span className="text-[10px]">⛔</span>
                      <span className="font-semibold">{groundedCount}</span>
                      <span className="text-navy-400">{t('myDsps.groundedLabel', 'grounded')}</span>
                    </div>
                  )}
                </div>

                {dsp.isActive === false && (
                  <div className="mt-2 inline-block px-2 py-0.5 rounded-full bg-navy-800 text-navy-400 text-[10px] font-semibold border border-navy-700">
                    {t('myDsps.inactiveBadge', 'Inactive')}
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-navy-500 italic mt-6">
        {t('myDsps.tapHint', 'Tap a DSP to see its vans, recent inspections, and pending defects.')}
      </p>
    </div>
  );
}


// ─────────────────────────────────────────────────────
// Drill-down — vehicles + quick stats for one DSP
// ─────────────────────────────────────────────────────
function DspDetail({ dsp, vehicles, onBack }) {
  const { t } = useTranslation('fleet');
  const grounded = vehicles.filter((v) => v.grounded);
  const active = vehicles.filter((v) => v.isActive);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-navy-700 text-navy-300 hover:text-white hover:border-navy-600 cursor-pointer text-sm"
        >
          <ArrowLeft size={14} /> {t('myDsps.allDspsBack', 'All DSPs')}
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={20} className="text-accent-blue shrink-0" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">{dsp.name}</h2>
            <p className="text-[11px] text-navy-500 font-mono">{dsp.id}</p>
          </div>
        </div>
      </div>

      {/* Quick stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatTile label={t('myDsps.stat.vans', 'Vans')} value={vehicles.length} icon={<Truck size={14} className="text-accent-green" />} />
        <StatTile label={t('myDsps.stat.active', 'Active')} value={active.length} icon={<Star size={14} className="text-accent-blue" />} />
        <StatTile label={t('myDsps.stat.grounded', 'Grounded')} value={grounded.length} icon={<span className="text-[12px]">⛔</span>} accent={grounded.length > 0 ? 'orange' : null} />
        <StatTile label={t('myDsps.stat.inactive', 'Inactive')} value={vehicles.length - active.length} />
      </div>

      {/* Vehicle list */}
      {vehicles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-navy-700 bg-navy-900/40 px-6 py-12 text-center">
          <Truck size={28} className="mx-auto text-navy-500 mb-2" />
          <p className="text-sm text-navy-300">{t('myDsps.noVansYet', 'No vans on this DSP yet.')}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-navy-700 bg-navy-900/40 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-navy-400 border-b border-navy-700/60 bg-navy-900/60">
            <div className="col-span-2">{t('myDsps.table.fleetId', 'Fleet ID')}</div>
            <div className="col-span-5">{t('myDsps.table.vehicle', 'Vehicle')}</div>
            <div className="col-span-2">{t('myDsps.table.plate', 'Plate')}</div>
            <div className="col-span-2 text-right">{t('myDsps.table.mileage', 'Mileage')}</div>
            <div className="col-span-1 text-right">{t('myDsps.table.status', 'Status')}</div>
          </div>
          <ul className="divide-y divide-navy-800/60">
            {vehicles.map((v) => (
              <li key={v.id} className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-navy-900/60 transition-colors">
                <div className="col-span-2">
                  <div className="text-sm font-mono text-white">{v.fleetId}</div>
                  <div className="text-[10px] text-navy-500 font-mono">{v.id}</div>
                </div>
                <div className="col-span-5 text-sm text-white">
                  {v.year} {v.make} {v.model}
                </div>
                <div className="col-span-2 text-sm text-navy-300 font-mono">{v.plate}</div>
                <div className="col-span-2 text-sm text-white text-right font-mono">
                  {v.mileage?.toLocaleString() ?? '—'}
                </div>
                <div className="col-span-1 text-right">
                  {v.grounded ? (
                    <span className="inline-block w-2 h-2 rounded-full bg-accent-red" title={t('myDsps.statusTitle.grounded', 'Grounded')} />
                  ) : v.isActive ? (
                    <span className="inline-block w-2 h-2 rounded-full bg-accent-green" title={t('myDsps.statusTitle.active', 'Active')} />
                  ) : (
                    <span className="inline-block w-2 h-2 rounded-full bg-navy-600" title={t('myDsps.statusTitle.inactive', 'Inactive')} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


function StatTile({ label, value, icon, accent }) {
  const accentCls = accent === 'orange' ? 'border-accent-orange/40 bg-accent-orange/10' : 'border-navy-700 bg-navy-900/60';
  return (
    <div className={`rounded-lg border ${accentCls} px-3 py-2.5`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        {icon}
        <div className="text-[10px] uppercase tracking-wide text-navy-400 font-semibold">{label}</div>
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
    </div>
  );
}
