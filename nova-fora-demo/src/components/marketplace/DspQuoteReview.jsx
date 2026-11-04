/**
 * DspQuoteReview — public page the fleet (DSP) owner opens from a quote email.
 *
 * URL: /marketplace/review?t=<token>[&quote=MQ-00012&action=approve|reject|revise|compare]
 *
 * No login: the token (one per DSP per van) is sent in the X-Review-Token
 * header. The page lists every live quote for the van side by side, cheapest
 * first. The email buttons only PRE-SELECT a quote + action — nothing is
 * decided until the owner confirms here (mail scanners pre-open links).
 *
 * Decisions: approve (optional note), reject (reason required), ask for a
 * lower price (note required). The owner can't edit a price.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Loader2, Mail, MessageSquare, ThumbsUp, XCircle,
} from 'lucide-react';
import { marketplace, APIError } from '../../api/client';
import { errorText, money, stateChip, vehicleTitle } from './marketplaceFormat';

const ACTION_FROM_PARAM = { approve: 'approve', reject: 'reject', revise: 'revise' };

function useParams() {
  return useMemo(() => {
    const p = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    return { token: p.get('t') || '', quote: p.get('quote') || '', action: p.get('action') || '' };
  }, []);
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-navy-950">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="text-white text-xl font-semibold mb-1">Repair quotes for your van</div>
        <div className="text-xs text-navy-400 mb-5">DFS Repair Marketplace · Dantzig Fleet Solutions</div>
        {children}
      </div>
    </div>
  );
}

function QuoteCard({ q, highlighted, initialAction, onDecide, busy }) {
  const [action, setAction] = useState(highlighted ? ACTION_FROM_PARAM[initialAction] || null : null);
  const [text, setText] = useState('');
  const chip = stateChip(q.state);
  const live = q.state === 'submitted' || q.state === 'revision_requested';

  const confirm = () => {
    if (action === 'approve') onDecide('approve', q, text);
    else if (text.trim()) onDecide(action, q, text.trim());
  };

  return (
    <div className={`rounded-xl border bg-navy-900/70 flex flex-col ${highlighted ? 'border-accent-blue ring-1 ring-accent-blue/50' : 'border-navy-700'}`}>
      <div className="px-4 py-3 border-b border-navy-700">
        <div className="flex items-start justify-between gap-2">
          <div className="text-white font-semibold">{q.shopName}</div>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${chip.cls}`}>
            {q.state === 'submitted' ? 'Waiting for you' : chip.label}
          </span>
        </div>
        <div className="text-2xl font-bold text-white mt-1">{money(q.totalAmount)}</div>
        <div className="text-xs text-navy-400 mt-0.5">
          {q.id} · revision {q.revision} · {new Date(q.submittedAt).toLocaleString()}
        </div>
      </div>
      <ul className="px-4 py-3 space-y-1 text-sm text-navy-200 flex-1">
        {q.lines.map((l) => (
          <li key={l.offerId} className="flex justify-between gap-2">
            <span>{l.label}</span>
            {l.amount != null && <span className="text-navy-300">{money(l.amount)}</span>}
          </li>
        ))}
        {q.notes && <li className="text-xs text-navy-300 pt-1">Shop notes: {q.notes}</li>}
        <li className="text-xs text-navy-400 pt-1 flex items-center gap-1">
          <Mail size={12} /> Replies go to {q.replyToEmail}
        </li>
        {q.decisionNote && (
          <li className="text-xs text-accent-gold pt-1">Your note: “{q.decisionNote}”</li>
        )}
      </ul>

      {live && (
        <div className="px-4 pb-4 space-y-2">
          {q.state === 'submitted' && (
            <div className="grid grid-cols-3 gap-2">
              <button type="button" disabled={busy} onClick={() => setAction('approve')}
                className={`px-2 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-1 cursor-pointer ${action === 'approve' ? 'bg-accent-green text-white' : 'border border-accent-green/50 text-accent-green'}`}>
                <ThumbsUp size={14} /> Approve
              </button>
              <button type="button" disabled={busy} onClick={() => setAction('revise')}
                className={`px-2 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-1 cursor-pointer ${action === 'revise' ? 'bg-accent-gold text-white' : 'border border-accent-gold/50 text-accent-gold'}`}>
                <MessageSquare size={14} /> Lower price
              </button>
              <button type="button" disabled={busy} onClick={() => setAction('reject')}
                className={`px-2 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-1 cursor-pointer ${action === 'reject' ? 'bg-accent-red text-white' : 'border border-accent-red/50 text-accent-red'}`}>
                <XCircle size={14} /> Reject
              </button>
            </div>
          )}
          {q.state === 'revision_requested' && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-navy-300">Waiting for the shop to revise its price.</span>
              <button type="button" disabled={busy} onClick={() => setAction('reject')}
                className="px-2 py-1 rounded-md border border-accent-red/50 text-accent-red text-xs cursor-pointer">
                Reject instead
              </button>
            </div>
          )}

          {action && (
            <div className="rounded-lg border border-navy-700 p-3 space-y-2">
              <div className="text-sm text-white">
                {action === 'approve' && `Approve ${q.shopName}'s quote for ${money(q.totalAmount)}?`}
                {action === 'reject' && 'Why are you rejecting this quote?'}
                {action === 'revise' && 'Ask the shop for a lower price'}
              </div>
              <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
                placeholder={action === 'approve' ? 'Optional note for the shop (e.g. best time to pick up the van)'
                  : action === 'reject' ? 'Reason (required)' : 'e.g. Another shop quoted $250 — can you match it? (required)'}
                className="w-full rounded-md bg-navy-950 border border-navy-700 px-3 py-2 text-white text-sm focus:border-accent-blue outline-none" />
              {action === 'approve' && (
                <p className="text-[11px] text-navy-400">
                  Approving closes these repairs for every other shop. {q.shopName} will contact you to
                  schedule; you pay the shop directly.
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={confirm}
                  disabled={busy || (action !== 'approve' && !text.trim())}
                  className="px-3 py-1.5 rounded-md bg-accent-blue text-white text-sm font-semibold disabled:opacity-40 cursor-pointer flex items-center gap-2">
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {action === 'approve' ? 'Confirm approval' : action === 'reject' ? 'Reject quote' : 'Send request'}
                </button>
                <button type="button" onClick={() => { setAction(null); setText(''); }} disabled={busy}
                  className="px-3 py-1.5 rounded-md border border-navy-600 text-navy-200 text-sm cursor-pointer">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DspQuoteReview() {
  const params = useParams();
  const [review, setReview] = useState(null);
  // loading | ready | error | done — a link without a token is an error up front.
  const [phase, setPhase] = useState(params.token ? 'loading' : 'error');
  const [error, setError] = useState(
    params.token ? null : 'This link is incomplete. Please open it again from your email.',
  );
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  // index.html carries the demo DSP's name as its title — never show it here.
  useEffect(() => {
    document.title = 'Repair quotes — DFS Repair Marketplace';
  }, []);

  useEffect(() => {
    if (!params.token) return;
    marketplace.review
      .get(params.token)
      .then((r) => { setReview(r); setPhase('ready'); })
      .catch((err) => {
        setError(
          err instanceof APIError && err.status === 410
            ? 'Every repair on this van has already been decided, so this link is no longer active.'
            : err instanceof APIError && err.status === 404
              ? 'We could not find this review link. Please open it again from your email.'
              : errorText(err),
        );
        setPhase('error');
      });
  }, [params.token]);

  const decide = async (kind, q, text) => {
    setBusy(true);
    setActionError(null);
    try {
      let res;
      if (kind === 'approve') {
        res = await marketplace.review.approve(params.token, q.id, { note: text || undefined, expectedRevision: q.revision });
        setNotice(`Approved ${q.shopName}'s quote for ${money(q.totalAmount)}. They will contact you to schedule the repair.`);
      } else if (kind === 'reject') {
        res = await marketplace.review.reject(params.token, q.id, text);
        setNotice(`Rejected ${q.shopName}'s quote. The shop has been notified.`);
      } else {
        res = await marketplace.review.requestRevision(params.token, q.id, text);
        setNotice(`Asked ${q.shopName} for a lower price. You'll get an email when they revise it.`);
      }
      if (res.tokenUsedUp || !res.review) setPhase('done');
      else setReview(res.review);
    } catch (err) {
      setActionError(errorText(err));
      // Refresh — another decision (or a shop revision) may have landed.
      marketplace.review.get(params.token).then(setReview).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'loading') {
    return <Shell><div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent-blue" size={28} /></div></Shell>;
  }
  if (phase === 'error') {
    return (
      <Shell>
        <div className="rounded-xl border border-accent-red/40 bg-accent-red/10 p-6 text-center">
          <AlertCircle className="mx-auto text-accent-red mb-2" size={28} />
          <p className="text-sm text-white">{error}</p>
        </div>
      </Shell>
    );
  }
  if (phase === 'done') {
    return (
      <Shell>
        <div className="rounded-xl border border-accent-green/40 bg-accent-green/10 p-6 text-center">
          <CheckCircle2 className="mx-auto text-accent-green mb-2" size={28} />
          <p className="text-sm text-white">{notice}</p>
          <p className="text-xs text-navy-300 mt-2">Every repair on this van is now decided. You can close this page.</p>
        </div>
      </Shell>
    );
  }

  const v = review.vehicle;
  const open = review.offers.filter((o) => o.state === 'open');
  const awarded = review.offers.filter((o) => o.state === 'awarded');
  return (
    <Shell>
      <div className="rounded-xl border border-navy-700 bg-navy-900/60 px-4 py-3 mb-5">
        <div className="text-white font-semibold">
          Van {v.fleetId} · {vehicleTitle(v)}
        </div>
        <div className="text-xs text-navy-300 font-mono">VIN {v.vin}{v.plate ? ` · ${v.plate}` : ''} · {review.dspName}</div>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-accent-green/40 bg-accent-green/10 px-4 py-2 text-sm text-accent-green flex items-center gap-2">
          <CheckCircle2 size={16} /> {notice}
        </div>
      )}
      {actionError && (
        <div className="mb-4 rounded-lg border border-accent-red/40 bg-accent-red/10 px-4 py-2 text-sm text-accent-red flex items-center gap-2">
          <AlertCircle size={16} /> {actionError}
        </div>
      )}

      <div className="mb-6">
        <div className="text-sm text-navy-200 font-medium mb-2">Repairs found by the inspection</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[...open, ...awarded].map((o) => (
            <div key={o.id} className="rounded-lg border border-navy-700 bg-navy-900/40 p-3 flex gap-3">
              {o.photos?.[0] ? (
                <a href={o.photos[0].url} target="_blank" rel="noreferrer" className="shrink-0 w-24 h-20 rounded-md overflow-hidden border border-navy-700">
                  <img src={o.photos[0].url} alt={o.label} className="w-full h-full object-cover" loading="lazy" />
                </a>
              ) : null}
              <div className="min-w-0">
                <div className="text-sm text-white">{o.label}</div>
                {o.notes && <div className="text-xs text-navy-300 mt-1">Inspector notes: {o.notes}</div>}
                <div className={`text-[11px] mt-1 ${o.state === 'awarded' ? 'text-accent-green' : 'text-navy-400'}`}>
                  {o.state === 'awarded' ? 'Approved — assigned to a shop' : 'Open for quotes'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-sm text-navy-200 font-medium mb-2">
        {review.liveQuotes.length > 0
          ? `Quotes to compare (${review.liveQuotes.length}) — cheapest first`
          : 'No open quotes right now. You will get an email when a shop sends one.'}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {review.liveQuotes.map((q) => (
          <QuoteCard key={`${q.id}-${q.revision}-${q.state}`} q={q} busy={busy} onDecide={decide}
            highlighted={q.id === params.quote} initialAction={params.action} />
        ))}
      </div>

      {review.otherQuotes.length > 0 && (
        <div className="mt-8">
          <div className="text-sm text-navy-200 font-medium mb-2">Earlier decisions</div>
          <ul className="rounded-xl border border-navy-700 divide-y divide-navy-800">
            {review.otherQuotes.map((q) => {
              const chip = stateChip(q.state);
              return (
                <li key={q.id} className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-navy-200">{q.shopName} · {money(q.totalAmount)} · {q.lines.map((l) => l.label).join(', ')}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${chip.cls}`}>{chip.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-navy-400 mt-8">
        Prices are set by each shop; you can approve, reject or ask for a lower price, but not edit a price.
        Replying to a quote email reaches the shop directly but is not tracked — please decide here.
      </p>
    </Shell>
  );
}
