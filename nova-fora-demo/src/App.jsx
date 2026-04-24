import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Layout from './components/Layout';
import Login from './components/Login';

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('nf-user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
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

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const handleLogin = (account) => {
    setUser(account);
    localStorage.setItem('nf-user', JSON.stringify(account));
  };

  const handleLogout = () => {
    setUser(null);
    setAdminUser(null);
    localStorage.removeItem('nf-user');
  };

  const handleSwitchRole = (account) => {
    // Clear impersonation when switching roles manually
    setAdminUser(null);
    setUser(account);
    localStorage.setItem('nf-user', JSON.stringify(account));
  };

  // Called from GhostMode when site admin picks a user to impersonate
  const handleImpersonate = (targetUser) => {
    setAdminUser(user); // stash the current site admin
    setUser(targetUser); // switch view to the target
  };

  // Called from the impersonation banner
  const handleExitImpersonation = () => {
    if (adminUser) {
      setUser(adminUser);
      setAdminUser(null);
    }
  };

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
