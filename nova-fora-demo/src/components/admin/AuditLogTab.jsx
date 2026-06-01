/**
 * AuditLogTab — site_admin view over the auth_audit_log table.
 *
 * Backs the deferred UI piece of pilot-plan P0 #2 (real impersonation,
 * commit d7fe052) and P0 #1 partial (real logout, commit 08510f9). The
 * table + write hooks shipped 2026-05-29 (commit 5d59ee2); this is the
 * frontend listing.
 *
 * Surface: filter chips (event type) + Since presets (24h / 7d / 30d /
 * All) + actor search + paginated table. site_admin only — the parent
 * AdminPanel already gates the tab off the menu for other roles; the
 * backend 403s as defence-in-depth.
 *
 * Lives in its own file rather than inside AdminPanel.jsx to keep the
 * latter from growing further (tester critique #1/#2 is about giant
 * files; net-new code goes here).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, LogIn, LogOut, UserCog, ChevronLeft, ChevronRight,
  Loader2, AlertTriangle, Search,
} from 'lucide-react';
import { auth as authApi, APIError } from '../../api/client';

// ─────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────

const EVENT_META = {
  login: {
    label: 'Login',
    Icon: LogIn,
    color: 'text-accent-green',
    bg: 'bg-accent-green/15',
    border: 'border-accent-green/40',
  },
  logout: {
    label: 'Logout',
    Icon: LogOut,
    color: 'text-accent-blue',
    bg: 'bg-accent-blue/15',
    border: 'border-accent-blue/40',
  },
  impersonate_start: {
    label: 'Impersonate',
    Icon: UserCog,
    color: 'text-accent-purple',
    bg: 'bg-accent-purple/15',
    border: 'border-accent-purple/40',
  },
};

const FILTER_CHIPS = [
  { id: 'all',                eventType: '',                 label: 'All' },
  { id: 'login',              eventType: 'login',            label: 'Login' },
  { id: 'logout',             eventType: 'logout',           label: 'Logout' },
  { id: 'impersonate_start',  eventType: 'impersonate_start',label: 'Impersonate' },
];

// Quick presets shifted off "now" each fetch — keep them as functions
// so the lower bound moves forward when the user refreshes.
const SINCE_PRESETS = [
  { id: 'all',  label: 'All time', value: () => null },
  { id: '24h', label: 'Last 24h', value: () => new Date(Date.now() - 24 * 3_600_000).toISOString() },
  { id: '7d',  label: 'Last 7d',  value: () => new Date(Date.now() - 7  * 24 * 3_600_000).toISOString() },
  { id: '30d', label: 'Last 30d', value: () => new Date(Date.now() - 30 * 24 * 3_600_000).toISOString() },
];

const PER_PAGE = 50;

// ─────────────────────────────────────────────────────
// Time helpers — local, no date-fns. Backend ships UTC ISO.
// ─────────────────────────────────────────────────────

function relativeTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function absoluteTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return iso; }
}

// ─────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────

export default function AuditLogTab() {
  const [filterChip, setFilterChip] = useState('all');
  const [sincePreset, setSincePreset] = useState('7d');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const eventType = useMemo(
    () => FILTER_CHIPS.find((c) => c.id === filterChip)?.eventType || '',
    [filterChip],
  );
  const sinceIso = useMemo(
    () => SINCE_PRESETS.find((p) => p.id === sincePreset)?.value() || null,
    [sincePreset, refreshKey],
  );

  // Reset to page 1 when filters change so users don't get stuck on
  // page 4 of a fresh narrow filter that only has 1 page of results.
  useEffect(() => { setPage(1); }, [filterChip, sincePreset]);

  // Fetch
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authApi.auditLog({
        eventType: eventType || undefined,
        since: sinceIso || undefined,
        page,
        perPage: PER_PAGE,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (e) {
      setError(e instanceof APIError ? (e.detail || e.message) : String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [eventType, sinceIso, page]);

  useEffect(() => { load(); }, [load]);

  // Client-side actor search — backend has no `q` param yet; for the
  // typical 50 rows on screen this is fine and avoids a round trip.
  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const a = (it.actorEmail || '').toLowerCase();
      const t = (it.targetEmail || '').toLowerCase();
      return a.includes(needle) || t.includes(needle);
    });
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-4">
      {/* Header w/ refresh */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-white mb-1">Authentication audit log</h3>
          <p className="text-xs text-navy-400">
            Append-only record of login, logout, and impersonation events.
            site_admin scope (the log can leak email + IP patterns).
          </p>
        </div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-navy-800 hover:bg-navy-700 border border-navy-700 text-white disabled:opacity-50 cursor-pointer"
          title="Re-fetch from the server"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Event-type chips */}
        <div className="flex items-center gap-1">
          {FILTER_CHIPS.map((c) => {
            const active = filterChip === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setFilterChip(c.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40'
                    : 'bg-navy-800/60 text-navy-300 border border-navy-700 hover:text-white'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Since presets */}
        <div className="ml-2 flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide text-navy-500 mr-1">Since</span>
          {SINCE_PRESETS.map((p) => {
            const active = sincePreset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setSincePreset(p.id)}
                className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                  active
                    ? 'bg-navy-700 text-white'
                    : 'text-navy-400 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="ml-auto relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by email…"
            className="pl-8 pr-3 py-1.5 text-sm rounded-md bg-navy-800/60 border border-navy-700 text-white placeholder:text-navy-500 outline-none focus:border-accent-blue w-56"
          />
        </div>
      </div>

      {/* Body */}
      {error && (
        <div className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red flex items-center gap-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <div className="rounded-lg border border-navy-700 bg-navy-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-navy-800/60 text-navy-400 text-[11px] uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Event</th>
                <th className="px-3 py-2 text-left font-medium">Actor</th>
                <th className="px-3 py-2 text-left font-medium">Target</th>
                <th className="px-3 py-2 text-left font-medium">IP</th>
                <th className="px-3 py-2 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center">
                  <Loader2 size={16} className="inline animate-spin text-navy-400" />
                </td></tr>
              ) : filteredItems.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-navy-500">
                  No events match the current filters.
                </td></tr>
              ) : filteredItems.map((it) => {
                const meta = EVENT_META[it.eventType] || {
                  label: it.eventType, Icon: LogIn,
                  color: 'text-navy-300', bg: 'bg-navy-800', border: 'border-navy-700',
                };
                const { Icon } = meta;
                return (
                  <tr key={it.id} className="border-t border-navy-800 hover:bg-navy-800/30">
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${meta.bg} ${meta.color} border ${meta.border}`}>
                        <Icon size={11} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-navy-200 truncate max-w-[18rem]" title={it.actorEmail || ''}>
                      {it.actorEmail || <span className="text-navy-500">—</span>}
                    </td>
                    <td className="px-3 py-2 text-navy-200 truncate max-w-[18rem]" title={it.targetEmail || ''}>
                      {it.targetEmail || <span className="text-navy-500">—</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-navy-400" title={it.userAgent || ''}>
                      {it.ipAddress || <span className="text-navy-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-navy-300 whitespace-nowrap" title={absoluteTime(it.createdAt)}>
                      {relativeTime(it.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer + pagination */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-navy-800 bg-navy-900/60 text-[11px] text-navy-400">
          <span>
            {total > 0
              ? `${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, total)} of ${total.toLocaleString()}`
              : '0 events'}
            {search && filteredItems.length !== items.length && (
              <span className="ml-2 text-navy-500">
                ({filteredItems.length} after search)
              </span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded hover:bg-navy-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-2">Page {page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded hover:bg-navy-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
