/**
 * SignupAcceptPage — public landing for /signup/accept?token=XXX.
 *
 * Flow:
 *   1. Read the token from the query string.
 *   2. Hit /auth/invitations/{token}/preview to validate it and pre-fill the
 *      form (email locked; org + role shown read-only so the invitee knows
 *      who invited them).
 *   3. User picks a password + confirms full name → POST accept → API returns
 *      JWT pair which the client.js helper persists.
 *   4. Call /auth/me with the new token, hand the user up to App.jsx, and
 *      replace the URL with "/" so reload doesn't try to re-accept.
 *
 * Error states the page handles:
 *   - missing token        → "this invitation link is incomplete"
 *   - 404 token not found  → "this invitation does not exist or was revoked"
 *   - 410 expired/used     → "this invitation expired" / "already accepted"
 *   - 409 email exists     → "an account with this email already exists; log in"
 *   - 422 password         → field-level error
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, CheckCircle2, AlertCircle, Mail, Lock, User as UserIcon, Phone, Building2,
} from 'lucide-react';
import { auth, invitations as invitationsApi, APIError } from '../api/client';

// Mirrors AdminPanel.ROLE_LABELS — one source of truth would be cleaner
// but these are tiny dicts and the duplication keeps the components
// independent. Update both if you add roles.
const ROLE_LABEL = {
  dsp_owner:      'DSP Owner',
  dsp_manager:    'DSP Manager',
  dsp_inspector:  'DSP Inspector',
  dsp_viewer:     'DSP Viewer',
  vendor_admin:   'Vendor Admin',
  service_writer: 'Service Writer',
  technician:     'Technician',
  vendor_viewer:  'Vendor Viewer',
  site_admin:     'Site Admin',
};

const ORG_TYPE_LABEL = {
  dsp:      'Delivery Service Partner',
  vendor:   'Service Vendor',
  platform: 'Platform',
};


export default function SignupAcceptPage({ onAccepted }) {
  const token = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('token') || '';
  }, []);

  const [phase, setPhase] = useState('loading'); // loading | form | submitting | done | error
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  // Form state — full_name pre-filled from invitation if available
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [phone, setPhone] = useState('');

  // Validate the token + load the preview on mount
  useEffect(() => {
    if (!token || token.length < 10) {
      setPhase('error');
      setError('Invitation link is missing or malformed. Ask your inviter to resend it.');
      return;
    }
    let cancelled = false;
    invitationsApi.preview(token)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setFullName(p.fullName || '');
        setPhase('form');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof APIError) {
          setError(
            err.status === 404
              ? "This invitation doesn't exist or has been revoked."
              : err.status === 410
                ? `This invitation is no longer valid (${(err.detail || 'expired').toString().toLowerCase()}).`
                : (err.detail || 'Could not load invitation.')
          );
        } else {
          setError(err.message || 'Network error — please try again.');
        }
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [token]);

  // Form-side validation — keeps the Submit button honest before we POST
  const passwordOk = password.length >= 8
    && /[A-Za-z]/.test(password)
    && /\d/.test(password);
  const passwordsMatch = password === confirmPw;
  const formValid = fullName.trim().length >= 2 && passwordOk && passwordsMatch;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formValid) return;
    setPhase('submitting');
    setError(null);
    try {
      const result = await invitationsApi.accept(token, {
        fullName: fullName.trim(),
        password,
        phone: phone.trim() || undefined,
      });
      // Auto-login: client.js stored the JWT pair; ask App.jsx to take over.
      const me = await auth.me();
      setPhase('done');
      // Wipe ?token=… from the URL so a refresh doesn't try to re-accept.
      window.history.replaceState({}, '', '/');
      // Hand the freshly-authenticated user up.
      onAccepted?.(me);
    } catch (err) {
      const detail = err instanceof APIError
        ? (err.detail || `HTTP ${err.status}`)
        : (err.message || 'Sign-up failed');
      setError(typeof detail === 'string' ? detail : JSON.stringify(detail));
      setPhase('form');
    }
  };

  // ── Render branches ──────────────────────────────────
  if (phase === 'loading') {
    return (
      <Shell>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-accent-blue animate-spin" size={28} />
        </div>
      </Shell>
    );
  }

  if (phase === 'error') {
    return (
      <Shell>
        <div className="text-center py-8">
          <div className="w-14 h-14 mx-auto rounded-full bg-accent-red/15 border border-accent-red/40 flex items-center justify-center mb-4">
            <AlertCircle size={28} className="text-accent-red" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">We couldn't open that invitation</h2>
          <p className="text-sm text-navy-300 max-w-sm mx-auto">{error}</p>
          <a href="/" className="inline-block mt-6 px-4 py-2 rounded-md bg-navy-800 border border-navy-700 text-sm text-white hover:border-accent-blue cursor-pointer">
            Go to login
          </a>
        </div>
      </Shell>
    );
  }

  if (phase === 'done') {
    return (
      <Shell>
        <div className="text-center py-8">
          <motion.div
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="w-14 h-14 mx-auto rounded-full bg-accent-green/15 border border-accent-green/40 flex items-center justify-center mb-4"
          >
            <CheckCircle2 size={28} className="text-accent-green" />
          </motion.div>
          <h2 className="text-lg font-semibold text-white mb-2">Welcome aboard!</h2>
          <p className="text-sm text-navy-300">Loading your dashboard…</p>
        </div>
      </Shell>
    );
  }

  // phase === 'form' or 'submitting'
  const submitting = phase === 'submitting';

  return (
    <Shell>
      <div className="mb-5">
        <div className="text-[11px] uppercase tracking-wider text-accent-blue font-semibold mb-1">
          Invitation
        </div>
        <h2 className="text-xl font-bold text-white mb-1">
          Join <span className="text-accent-blue">{preview.orgName}</span>
        </h2>
        <p className="text-sm text-navy-300">
          <strong className="text-white">{preview.inviterName}</strong> invited you to be a{' '}
          <strong className="text-white">{ROLE_LABEL[preview.role] || preview.role}</strong>{' '}
          at this {ORG_TYPE_LABEL[preview.orgType] || preview.orgType} on Nova Fora.
        </p>
      </div>

      {/* Read-only invitation summary */}
      <div className="rounded-lg bg-navy-900/60 border border-navy-700 px-3 py-3 text-[11px] text-navy-300 mb-5 space-y-1">
        <Row icon={Mail}      label="Email"        value={preview.email} mono />
        <Row icon={Building2} label="Organization" value={preview.orgName} />
        <Row icon={UserIcon}  label="Role"         value={ROLE_LABEL[preview.role] || preview.role} />
      </div>

      {error && (
        <div className="mb-4 px-3 py-2.5 rounded-lg bg-accent-red/10 border border-accent-red/30 text-xs text-accent-red flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Full name *">
          <div className="relative">
            <UserIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
            <input
              type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Ana López"
              className="w-full pl-9 pr-3 py-2.5 rounded-md bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue text-sm"
              maxLength={200} required
            />
          </div>
        </Field>

        <Field label="Phone (optional)">
          <div className="relative">
            <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
            <input
              type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              className="w-full pl-9 pr-3 py-2.5 rounded-md bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue text-sm"
              maxLength={30}
            />
          </div>
        </Field>

        <Field
          label="Password *"
          hint="At least 8 characters with one letter and one number."
          error={password.length > 0 && !passwordOk
            ? 'Must be 8+ chars with at least one letter and one number.'
            : null}
        >
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className={`w-full pl-9 pr-3 py-2.5 rounded-md bg-navy-800 border text-white outline-none text-sm ${
                password.length > 0 && !passwordOk
                  ? 'border-accent-red focus:border-accent-red'
                  : 'border-navy-700 focus:border-accent-blue'
              }`}
              minLength={8} maxLength={128} required
            />
          </div>
        </Field>

        <Field
          label="Confirm password *"
          error={confirmPw.length > 0 && !passwordsMatch ? 'Passwords do not match.' : null}
        >
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
            <input
              type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
              className={`w-full pl-9 pr-3 py-2.5 rounded-md bg-navy-800 border text-white outline-none text-sm ${
                confirmPw.length > 0 && !passwordsMatch
                  ? 'border-accent-red focus:border-accent-red'
                  : 'border-navy-700 focus:border-accent-blue'
              }`}
              required
            />
          </div>
        </Field>

        <button
          type="submit" disabled={!formValid || submitting}
          className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-accent-blue text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting ? <><Loader2 size={14} className="animate-spin" /> Creating account…</>
                      : <>Create account &amp; sign in</>}
        </button>

        <p className="text-[11px] text-navy-500 text-center mt-3">
          By creating an account you agree to Nova Fora's terms of service.
        </p>
      </form>
    </Shell>
  );
}


function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-navy-900 border border-navy-800 rounded-2xl p-6 sm:p-7 shadow-2xl"
      >
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-accent-blue flex items-center justify-center text-white font-bold">N</div>
          <span className="text-white font-semibold">Nova Fora</span>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function Row({ icon: Icon, label, value, mono }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={11} className="text-navy-500 shrink-0" />
      <span className="text-navy-400 w-24">{label}</span>
      <span className={`text-white truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function Field({ label, hint, error, children }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">
        {label}
      </label>
      {children}
      {error && (
        <p className="text-[11px] text-accent-red mt-1 flex items-start gap-1">
          <AlertCircle size={11} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}
      {!error && hint && <p className="text-[10px] text-navy-500 mt-1">{hint}</p>}
    </div>
  );
}
