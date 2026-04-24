import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Layout from './components/Layout';
import Login from './components/Login';
import { auth, getAccessToken, clearTokens, APIError } from './api/client';

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
      .then((me) => setUser(me))
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

  // Called from GhostMode when site admin picks a user to impersonate
  const handleImpersonate = (targetUser) => {
    setAdminUser(user); // stash the current site admin
    setUser(targetUser); // switch view to the target
    // TODO(Semana 6): call /auth/impersonate to get a real impersonation token
  };

  // Called from the impersonation banner
  const handleExitImpersonation = () => {
    if (adminUser) {
      setUser(adminUser);
      setAdminUser(null);
    }
  };

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
