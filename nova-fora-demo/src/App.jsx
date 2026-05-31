// Build cache-buster: 2026-05-15 EDT — net code diff between 9fbad0c
// and f81b82c is zero (added then reverted my changes), so Vite was
// emitting the exact same bundle hash and EasyPanel kept serving the
// old artifact. This comment forces a content-hash flip on the next
// build so production picks up the redeploy.
import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Layout from './components/Layout';
import Login from './components/Login';
import SignupAcceptPage from './components/SignupAcceptPage';
import { auth, getAccessToken, clearTokens, APIError } from './api/client';
import { setLanguage as setI18nLanguage } from './i18n';

export default function App() {
  const [user, setUser] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [adminUser, setAdminUser] = useState(null); // Stores original admin when impersonating

  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    return localStorage.getItem('nf-theme') || 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') root.classList.add('light');
    else root.classList.remove('light');
    localStorage.setItem('nf-theme', theme);
  }, [theme]);

  // Restore session on mount — if there's a stored JWT, validate it by
  // calling /auth/me. If valid, log the user in silently; if not, clear
  // the tokens and show the login screen.
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setBootstrapping(false);
      return;
    }
    auth
      .me()
      .then((me) => {
        setUser(me);
        // If bootstrap loaded an impersonation session (e.g. page reload
        // mid-impersonation), reconstruct the `adminUser` slot so the
        // "Viewing as X" banner + exit button persist. The actual admin
        // tokens still live in sessionStorage under IMPERSONATION_KEY;
        // this just rehydrates the UI marker from the JWT claim.
        if (me?.actingAs) {
          setAdminUser({
            id: me.actingAs.id,
            email: me.actingAs.email,
            name: me.actingAs.name,
            role: 'site_admin',
          });
        }
        // Sync the user's stored language preference to i18n so the UI
        // shows their language right after auth bootstrap (without making
        // them re-pick on every device).
        if (me?.language) {
          const base = String(me.language).split('-', 1)[0].toLowerCase();
          if (['es', 'en'].includes(base)) setI18nLanguage(base);
        }
      })
      .catch((err) => {
        if (err instanceof APIError && (err.status === 401 || err.status === 403)) {
          clearTokens();
        }
        // network errors leave tokens in place — user can retry
      })
      .finally(() => setBootstrapping(false));
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const handleLogin = (account) => {
    // `account` is the UserResponse from /auth/me, already camelCased by the client
    setUser(account);
  };

  const handleLogout = async () => {
    await auth.logout();
    setUser(null);
    setAdminUser(null);
  };

  const handleSwitchRole = (account) => {
    // Dev-only: quick re-auth as another demo user. Real users can't do this
    // — it's meant to demo role-specific flows. We hit /auth/login again.
    // (Note: SwitchRole from RoleSwitcher passes a demoAccount, so we log in
    // with its real credentials.)
    auth
      .login(account.email, account.password || 'nova2026!')
      .then((me) => {
        setAdminUser(null);
        setUser(me);
      })
      .catch(() => {
        // ignore — if the switch fails, user stays where they were
      });
  };

  // Called from GhostMode when site admin picks a user to impersonate.
  // Real impersonation as of 2026-05-29: POST /auth/impersonate/{id}
  // returns a token pair scoped to the target with `acting_as_id=admin.id`.
  // The client helper saves the admin's tokens to sessionStorage before
  // overwriting localStorage with the target's pair, so every API call
  // henceforth goes out as the target — backend authz now actually fires
  // for the impersonated identity (the previous setState-only swap kept
  // the admin's token and masked vendor/DSP scoping bugs).
  const handleImpersonate = async (targetUser) => {
    try {
      const targetId = targetUser?.id;
      if (!targetId) return;
      const stashedAdmin = user;
      const meAsTarget = await auth.impersonate(targetId);
      setAdminUser(stashedAdmin);
      setUser(meAsTarget);
    } catch (err) {
      const detail = err?.detail || err?.message || 'unknown';
      // eslint-disable-next-line no-alert
      alert(`Impersonation failed: ${detail}`);
    }
  };

  // Called from the impersonation banner. Pops the admin's tokens back
  // out of sessionStorage and refreshes user state — symmetric to
  // handleImpersonate. Always clears adminUser even if the server call
  // fails so the user isn't stuck staring at a stale banner.
  const handleExitImpersonation = async () => {
    try {
      const admin = await auth.stopImpersonate();
      if (admin) setUser(admin);
    } catch (err) {
      const detail = err?.detail || err?.message || 'unknown';
      // eslint-disable-next-line no-alert
      alert(`Exit impersonation failed: ${detail}`);
    } finally {
      setAdminUser(null);
    }
  };

  // ── Sign-up via invitation: bypass auth bootstrap entirely ────────
  // /signup/accept?token=… is a public landing for invitees. We detect it
  // by path (no router used elsewhere). On success the page hands the
  // freshly-authenticated user up via onAccepted, which routes them into
  // the normal Layout flow.
  const isSignupAccept =
    typeof window !== 'undefined' && window.location.pathname === '/signup/accept';
  if (isSignupAccept && !user) {
    return <SignupAcceptPage onAccepted={(me) => setUser(me)} />;
  }

  // ── Bootstrapping splash ─────────────────────────────
  if (bootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-950">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-accent-blue/40 border-t-accent-blue rounded-full"
        />
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {user ? (
        <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <Layout
            user={user}
            onSwitchRole={handleSwitchRole}
            onLogout={handleLogout}
            onImpersonate={handleImpersonate}
            impersonating={!!adminUser}
            onExitImpersonation={handleExitImpersonation}
          />
        </motion.div>
      ) : (
        <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <Login onLogin={handleLogin} theme={theme} onToggleTheme={toggleTheme} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
