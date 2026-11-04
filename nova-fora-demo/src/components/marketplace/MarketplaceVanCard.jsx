/**
 * MarketplaceVanCard — one van on the shop's marketplace board.
 *
 * Modeled on the Nov 3 Chemas Autohaus pilot page: vehicle, VIN, defect
 * photos, inspector notes, a price input and a live "10% DFS fee / you
 * keep" calc. The shop ticks the defects it wants to quote; one quote
 * covers the whole van selection. The fleet owner's identity is NOT shown
 * here — the API masks it until the quote is approved.
 *
 * States:
 *   - no live quote  → quote form
 *   - live quote     → status + "Revise price" / "Withdraw"
 *   - revise         → same form, pre-filled, sends /revise
 */
import { useMemo, useState } from 'react';
import {
  Camera, CheckCircle2, Loader2, MessageSquare, Send, Undo2, AlertCircle,
} from 'lucide-react';
import { marketplace } from '../../api/client';
import { errorText, feeSplit, money, stateChip, vehicleTitle } from './marketplaceFormat';

const SPECIALTY_LABEL = { body: 'Body', general: 'General' };

export default function MarketplaceVanCard({ van, shop, inviteToken, onChanged }) {
  const myQuote = van.myQuote;
  const quotedIds = useMemo(
    () => new Set((myQuote?.lines || []).map((l) => l.offerId)),
    [myQuote],
  );
  const [editing, setEditing] = useState(!myQuote);
  const [selected, setSelected] = useState(() =>
    myQuote ? quotedIds : new Set(van.offers.map((o) => o.id)),
  );
  const [price, setPrice] = useState(myQuote ? String(myQuote.totalAmount) : '');
  const [replyTo, setReplyTo] = useState(myQuote?.replyToEmail || shop.quoteReplyEmail || '');
  const [notes, setNotes] = useState(myQuote?.notes || '');
  const [accountEmail, setAccountEmail] = useState(shop.contactEmail || '');
  const [accountName, setAccountName] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const needsOnboarding = shop.isProspect && !shop.termsAccepted;
  const split = feeSplit(price, shop.feeRate);
  const canSubmit =
    shop.canQuote &&
    selected.size > 0 &&
    split.valid &&
    /.+@.+\..+/.test(replyTo) &&
    (!needsOnboarding || (acceptTerms && accountName.trim() && /.+@.+\..+/.test(accountEmail)));

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const lines = [...selected].map((offerId) => ({ offerId }));
      if (myQuote) {
        await marketplace.reviseQuote(
          myQuote.id,
          { lines, total: Number(price).toFixed(2), replyToEmail: replyTo, notes },
          { inviteToken },
        );
        setNotice('Revised price sent to the fleet owner.');
      } else {
        await marketplace.submitQuote(
          {
            vehicleId: van.vehicle.id,
            lines,
            total: Number(price).toFixed(2),
            replyToEmail: replyTo,
            notes,
            ...(needsOnboarding ? { accountEmail, accountName: accountName.trim(), acceptTerms } : {}),
          },
          { inviteToken },
        );
        setNotice(
          needsOnboarding
            ? 'Quote sent. Check your inbox to finish creating your Nova Fora account.'
            : 'Quote sent to the fleet owner.',
        );
      }
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!myQuote) return;
    if (!window.confirm('Withdraw this quote? You can send a new one while the repairs are open.')) return;
    setBusy(true);
    setError(null);
    try {
      await marketplace.withdrawQuote(myQuote.id, { inviteToken });
      onChanged?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const chip = myQuote ? stateChip(myQuote.state) : null;
  // A withdrawn / closed quote drops off `myQuote` on refetch → form again.
  const showForm = editing || !myQuote;

  return (
    <div className="rounded-xl border border-navy-700 bg-navy-900/60 overflow-hidden">
      {/* Vehicle header */}
      <div className="px-4 py-3 border-b border-navy-700 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-white font-semibold">{vehicleTitle(van.vehicle)}</div>
          <div className="text-xs text-navy-300 font-mono">VIN {van.vehicle.vin}</div>
        </div>
        <div className="flex items-center gap-2">
          {van.station && (
            <span className="text-xs px-2 py-0.5 rounded-full border border-navy-600 text-navy-200">
              {van.station}
            </span>
          )}
          {chip && (
            <span className={`text-xs px-2 py-0.5 rounded-full border ${chip.cls}`}>{chip.label}</span>
          )}
        </div>
      </div>

      {/* Defects */}
      <ul className="divide-y divide-navy-800">
        {van.offers.map((o) => {
          const checked = selected.has(o.id);
          return (
            <li key={o.id} className="px-4 py-3 flex gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-accent-blue cursor-pointer disabled:cursor-not-allowed"
                checked={checked}
                disabled={!showForm || busy}
                onChange={() => toggle(o.id)}
                aria-label={`Quote ${o.label}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-white">{o.label}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded border border-navy-600 text-navy-300">
                    {SPECIALTY_LABEL[o.specialty] || o.specialty}
                  </span>
                </div>
                {o.notes && (
                  <p className="text-xs text-navy-300 mt-1">
                    <span className="text-navy-400">Inspector notes:</span> {o.notes}
                  </p>
                )}
                {o.photos?.length > 0 ? (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {o.photos.map((p) => (
                      <a key={p.id} href={p.url} target="_blank" rel="noreferrer"
                        className="block w-20 h-16 rounded-md overflow-hidden border border-navy-700 hover:border-accent-blue">
                        <img src={p.url} alt={o.label} className="w-full h-full object-cover" loading="lazy" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-navy-400 mt-1 flex items-center gap-1">
                    <Camera size={12} /> No photo
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Live quote summary */}
      {myQuote && !editing && (
        <div className="px-4 py-3 border-t border-navy-700 bg-navy-900">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm text-navy-200">
              Your quote <span className="font-mono text-navy-300">{myQuote.id}</span> · rev {myQuote.revision}
            </div>
            <div className="text-lg font-bold text-white">{money(myQuote.totalAmount)}</div>
          </div>
          <div className="text-xs text-navy-300 mt-1">
            DFS fee {money(myQuote.feeAmount)} · you keep {money(myQuote.shopKeeps)}
          </div>
          {myQuote.state === 'revision_requested' && myQuote.decisionNote && (
            <div className="mt-2 text-sm rounded-md border border-accent-gold/40 bg-accent-gold/10 text-accent-gold px-3 py-2 flex gap-2">
              <MessageSquare size={16} className="shrink-0 mt-0.5" />
              <span>Fleet owner: “{myQuote.decisionNote}”</span>
            </div>
          )}
          {shop.canQuote && (
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => { setEditing(true); setNotice(null); }} disabled={busy}
                className="px-3 py-1.5 rounded-md bg-accent-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer">
                Revise price
              </button>
              <button type="button" onClick={withdraw} disabled={busy}
                className="px-3 py-1.5 rounded-md border border-navy-600 text-navy-200 text-sm hover:border-accent-red hover:text-accent-red disabled:opacity-50 cursor-pointer flex items-center gap-1">
                <Undo2 size={14} /> Withdraw
              </button>
            </div>
          )}
        </div>
      )}

      {/* Quote form */}
      {showForm && (
        <form onSubmit={submit} className="px-4 py-4 border-t border-navy-700 bg-navy-900 space-y-3">
          {!shop.canQuote && (
            <p className="text-xs text-navy-300">Only your shop admin or service writer can send quotes.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <label className="block">
              <span className="text-xs text-navy-300">Your price for the selected repairs (USD)</span>
              <input type="number" min="1" step="0.01" inputMode="decimal" value={price}
                onChange={(e) => setPrice(e.target.value)} placeholder="0.00"
                className="mt-1 w-full rounded-md bg-navy-950 border border-navy-700 px-3 py-2 text-white text-lg focus:border-accent-blue outline-none" />
            </label>
            <div className="text-sm">
              <div className="text-navy-300">DFS fee ({Math.round(Number(shop.feeRate) * 100)}%)</div>
              <div className="text-white font-semibold">{money(split.fee)}</div>
            </div>
            <div className="text-sm">
              <div className="text-navy-300">You keep</div>
              <div className="text-accent-green font-semibold text-lg">{money(split.keep)}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-navy-300">Fleet owner replies go to</span>
              <input type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)}
                className="mt-1 w-full rounded-md bg-navy-950 border border-navy-700 px-3 py-2 text-white text-sm focus:border-accent-blue outline-none" />
            </label>
            <label className="block">
              <span className="text-xs text-navy-300">Notes for the fleet owner (optional)</span>
              <input type="text" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. OEM part, 1-day turnaround"
                className="mt-1 w-full rounded-md bg-navy-950 border border-navy-700 px-3 py-2 text-white text-sm focus:border-accent-blue outline-none" />
            </label>
          </div>

          {needsOnboarding && (
            <div className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 p-3 space-y-2">
              <div className="text-sm text-white font-medium">First quote — confirm your account</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-navy-300">Your email</span>
                  <input type="email" value={accountEmail} onChange={(e) => setAccountEmail(e.target.value)}
                    className="mt-1 w-full rounded-md bg-navy-950 border border-navy-700 px-3 py-2 text-white text-sm focus:border-accent-blue outline-none" />
                </label>
                <label className="block">
                  <span className="text-xs text-navy-300">Your name</span>
                  <input type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)}
                    className="mt-1 w-full rounded-md bg-navy-950 border border-navy-700 px-3 py-2 text-white text-sm focus:border-accent-blue outline-none" />
                </label>
              </div>
              <label className="flex items-start gap-2 text-xs text-navy-200 cursor-pointer">
                <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-0.5 accent-accent-blue" />
                <span>
                  I accept the{' '}
                  {shop.termsUrl ? (
                    <a href={shop.termsUrl} target="_blank" rel="noreferrer" className="text-accent-blue underline">
                      DFS Repair Partner terms
                    </a>
                  ) : 'DFS Repair Partner terms'}{' '}
                  (version {shop.termsVersion}), including the {Math.round(Number(shop.feeRate) * 100)}% DFS
                  coordination fee on approved quotes. We’ll email you a link to set up your Nova Fora account.
                </span>
              </label>
            </div>
          )}

          {error && (
            <div className="text-sm text-accent-red flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={!canSubmit || busy}
              className="px-4 py-2 rounded-md bg-accent-green text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-2">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {myQuote ? 'Send revised price' : `Send quote for ${selected.size} repair${selected.size === 1 ? '' : 's'}`}
            </button>
            {myQuote && (
              <button type="button" onClick={() => setEditing(false)} disabled={busy}
                className="px-3 py-2 rounded-md border border-navy-600 text-navy-200 text-sm cursor-pointer">
                Cancel
              </button>
            )}
          </div>
          <p className="text-[11px] text-navy-400">
            The fleet owner sees your price and compares it with other shops; they pay you directly.
            Their name is shared once they approve your quote.
          </p>
        </form>
      )}

      {notice && (
        <div className="px-4 py-2 border-t border-navy-700 text-sm text-accent-green flex items-center gap-2">
          <CheckCircle2 size={16} /> {notice}
        </div>
      )}
    </div>
  );
}
