/**
 * MarketplaceBoard — the repair shop's view of the DFS Repair Marketplace.
 *
 * Three ways in:
 *   - In-app "Marketplace" tab for registered shop users (Layout).
 *   - /marketplace/board deep link from the daily digest (standalone page,
 *     the user is logged in).
 *   - /marketplace/board?invite=<token> — a prospect shop with no account
 *     yet; every API call carries the magic-link token instead of a JWT.
 *
 * Shows open repairs for the shop's specialties grouped per van (one
 * MarketplaceVanCard each) and the shop's own quote history. Shops never
 * see other shops' quotes, and the fleet owner's name only appears on a
 * quote the owner approved.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Store } from 'lucide-react';
import { marketplace, APIError } from '../../api/client';
import MarketplaceVanCard from './MarketplaceVanCard';
import { errorText, money, stateChip, vehicleTitle } from './marketplaceFormat';

const SPECIALTY_LABEL = { body: 'Body', general: 'General' };

function HistoryRow({ q }) {
  const chip = stateChip(q.state);
  return (
    <li className="px-4 py-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm text-white">
          <span className="font-mono text-navy-300 mr-2">{q.id}</span>
          {vehicleTitle(q.vehicle)}
          {q.vehicle.fleetId && <span className="text-navy-300"> · van {q.vehicle.fleetId}</span>}
        </div>
        <div className="text-xs text-navy-300 mt-0.5">
          {q.lines.map((l) => l.label).join(' · ')}
        </div>
        {q.state === 'approved' && q.dsp && (
          <div className="mt-2 text-sm rounded-md border border-accent-green/40 bg-accent-green/10 text-accent-green px-3 py-2">
            <div className="font-medium">Customer: {q.dsp.name}{q.dsp.phone ? ` · ${q.dsp.phone}` : ''}</div>
            <div className="text-xs mt-0.5 text-accent-green/80">
              {q.workRef ? `On your Nova Fora queue as ${q.workRef}. ` : ''}
              DFS fee owed: {money(q.feeAmount)}. The customer pays you directly.
            </div>
          </div>
        )}
        {q.decisionNote && q.state !== 'approved' && (
          <div className="text-xs text-navy-300 mt-1">Fleet owner: “{q.decisionNote}”</div>
        )}
      </div>
      <div className="text-right">
        <div className="text-white font-semibold">{money(q.totalAmount)}</div>
        <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full border ${chip.cls}`}>{chip.label}</span>
      </div>
    </li>
  );
}

export default function MarketplaceBoard({ inviteToken = null, standalone = false }) {
  const [board, setBoard] = useState(null);
  const [history, setHistory] = useState([]);
  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch + apply are split so the mount effect only sets state from the
  // promise callbacks (react-hooks/set-state-in-effect).
  const fetchAll = useCallback(
    () => Promise.all([marketplace.board({ inviteToken }), marketplace.myQuotes({ inviteToken })]),
    [inviteToken],
  );
  const apply = useCallback(([b, quotes]) => {
    setBoard(b);
    setHistory((quotes || []).filter((q) => !['submitted', 'revision_requested'].includes(q.state)));
    setPhase('ready');
    setError(null);
  }, []);
  const fail = useCallback((err) => {
    setError(
      err instanceof APIError && err.status === 401 && inviteToken
        ? 'This board link expired, or your shop already has a Nova Fora account. Please log in.'
        : err instanceof APIError && err.status === 403
          ? err.detail
          : errorText(err),
    );
    setPhase('error');
  }, [inviteToken]);

  const load = useCallback(() => {
    setRefreshing(true);
    return fetchAll().then(apply, fail).finally(() => setRefreshing(false));
  }, [fetchAll, apply, fail]);

  useEffect(() => {
    fetchAll().then(apply, fail);
  }, [fetchAll, apply, fail]);

  // Standalone (digest / magic link): index.html's title names the demo
  // DSP — replace it so a shop never sees a fleet owner's name pre-award.
  useEffect(() => {
    if (standalone) document.title = 'DFS Repair Marketplace';
  }, [standalone]);

  const shop = board?.shop;
  const vans = board?.vans || [];
  const repairs = vans.reduce((n, v) => n + v.offers.length, 0);

  const body = (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-white text-xl font-semibold">
            <Store size={22} className="text-accent-orange" /> DFS Repair Marketplace
          </div>
          {shop && (
            <div className="text-sm text-navy-300 mt-1">
              {shop.name} · {shop.specialties.map((s) => SPECIALTY_LABEL[s] || s).join(' + ')} repairs ·
              DFS keeps {Math.round(Number(shop.feeRate) * 100)}% of approved quotes
            </div>
          )}
        </div>
        {phase === 'ready' && (
          <button type="button" onClick={load} disabled={refreshing}
            className="px-3 py-1.5 rounded-md border border-navy-600 text-navy-200 text-sm hover:border-accent-blue flex items-center gap-2 cursor-pointer disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      </div>

      {phase === 'loading' && (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent-blue" size={28} /></div>
      )}

      {phase === 'error' && (
        <div className="rounded-xl border border-accent-red/40 bg-accent-red/10 p-6 text-center">
          <AlertCircle className="mx-auto text-accent-red mb-2" size={28} />
          <p className="text-sm text-white">{error}</p>
          {inviteToken && (
            <a href="/" className="inline-block mt-4 px-4 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-white hover:border-accent-blue">
              Go to login
            </a>
          )}
        </div>
      )}

      {phase === 'ready' && (
        <>
          {shop?.isProspect && (
            <div className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 px-4 py-3 text-sm text-navy-200">
              {shop.termsAccepted
                ? 'Your account invitation is on its way — accept it from your inbox to log in next time.'
                : 'Pick the repairs you want, set your price and send. Your first quote also sets up your free Nova Fora account.'}
            </div>
          )}

          <div className="text-sm text-navy-300">
            {repairs > 0
              ? `${repairs} open repair${repairs === 1 ? '' : 's'} on ${vans.length} van${vans.length === 1 ? '' : 's'}`
              : 'No open repairs for your specialties right now. New ones arrive every morning.'}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {vans.map((v) => (
              <MarketplaceVanCard key={v.vehicle.id} van={v} shop={shop} inviteToken={inviteToken} onChanged={load} />
            ))}
          </div>

          {history.length > 0 && (
            <div className="rounded-xl border border-navy-700 bg-navy-900/60">
              <div className="px-4 py-3 border-b border-navy-700 text-white font-medium flex items-center gap-2">
                <CheckCircle2 size={16} className="text-accent-green" /> Decided quotes
              </div>
              <ul className="divide-y divide-navy-800">
                {history.map((q) => <HistoryRow key={q.id} q={q} />)}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );

  if (!standalone) return <div className="p-4 sm:p-6">{body}</div>;
  return (
    <div className="min-h-screen bg-navy-950">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {body}
        <p className="text-[11px] text-navy-400 mt-8 text-center">
          DFS Repair Marketplace · Dantzig Fleet Solutions · powered by Nova Fora
        </p>
      </div>
    </div>
  );
}
