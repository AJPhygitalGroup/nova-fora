import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, BarChart3, Wrench, ChevronRight, Menu, X, Sun, Moon, Bell,
  LayoutGrid, Truck, ClipboardList, Settings, Eye, Star, Home as HomeIcon, Gift,
  Droplets, Sparkles, AlertTriangle
} from 'lucide-react';
import VendorScorecard from './VendorScorecard';
import RealDVIC from './RealDVIC';
import BodyRepairs from './BodyRepairs';
import FleetSnapshot from './FleetSnapshot';
import MyVehicles from './MyVehicles';
import WorkOrders from './WorkOrders';
import AdminPanel from './AdminPanel';
import GhostMode from './GhostMode';
import Rewards from './Rewards';
import Defects from './Defects';
import NotificationsPanel from './NotificationsPanel';
import RoleSwitcher from './ui/RoleSwitcher';
import { rolePermissions, notificationsSeed } from '../data/mockData';

// View catalog — id, label, subtitle, icon, accent color, component
const VIEW_CATALOG = {
  dvic:        { id: 'dvic',        label: 'Home',             subtitle: 'Command center',           icon: HomeIcon,       color: 'text-accent-green',  Component: RealDVIC },
  defects:     { id: 'defects',     label: 'Defects',          subtitle: 'All reported defects',     icon: AlertTriangle,  color: 'text-accent-orange', Component: Defects },
  snapshot:    { id: 'snapshot',    label: 'QC DVIC',          subtitle: 'Heatmap view',             icon: LayoutGrid,     color: 'text-accent-blue',   Component: FleetSnapshot },
  vehicles:    { id: 'vehicles',    label: 'Vehicles',         subtitle: 'Fleet directory',          icon: Truck,          color: 'text-accent-green',  Component: MyVehicles },
  work_orders: { id: 'work_orders', label: 'Work Orders',      subtitle: 'Vendor hub',               icon: ClipboardList,  color: 'text-accent-purple', Component: WorkOrders },
  body:        { id: 'body',        label: 'Body Repairs',     subtitle: 'Enhanced Portal',          icon: Wrench,         color: 'text-accent-purple', Component: BodyRepairs },
  scorecard:   { id: 'scorecard',   label: 'Vendor Scorecard', subtitle: 'DFS Value Proposition',    icon: BarChart3,      color: 'text-accent-blue',   Component: VendorScorecard },
  rewards:     { id: 'rewards',     label: 'Rewards',          subtitle: 'DA + DSP loyalty',         icon: Gift,           color: 'text-accent-gold',   Component: Rewards },
  admin:       { id: 'admin',       label: 'Admin',            subtitle: 'Users, org, security',     icon: Settings,       color: 'text-accent-gold',   Component: AdminPanel },
  ghost:       { id: 'ghost',       label: 'Ghost Mode',       subtitle: 'Impersonate users',        icon: Eye,            color: 'text-accent-red',    Component: GhostMode },
};

export default function Layout({ user, onSwitchRole, onLogout, onImpersonate, impersonating, onExitImpersonation }) {
  const [showNotifs, setShowNotifs] = useState(false);

  // Tabs are derived from the user's role — no hardcoding
  const tabs = useMemo(() => {
    const allowedIds = rolePermissions[user.role] || [];
    return allowedIds.map((id) => VIEW_CATALOG[id]).filter(Boolean);
  }, [user.role]);

  // Live notification count per user (computed from seed)
  const userNotifCount = useMemo(() => {
    return notificationsSeed.filter((n) => n.userId === user?.id && !n.read).length;
  }, [user?.id]);

  // Pick a sensible default landing view per role
  const defaultTab = tabs[0]?.id || 'dvic';
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Reset to first allowed tab when role changes
  useEffect(() => {
    if (!tabs.find((t) => t.id === activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [user.role, tabs, activeTab, defaultTab]);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    return localStorage.getItem('nf-theme') || 'dark';
  });
  // Calm mode defaults to ON so the first impression is soft/subtle; colors
  // come alive on hover. Persisted in localStorage.
  const [calm, setCalm] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('nf-calm');
    return stored === null ? true : stored === '1';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') root.classList.add('light');
    else root.classList.remove('light');
    localStorage.setItem('nf-theme', theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (calm) root.classList.add('calm');
    else root.classList.remove('calm');
    localStorage.setItem('nf-calm', calm ? '1' : '0');
  }, [calm]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const toggleCalm = () => setCalm((c) => !c);

  const ActiveComponent = VIEW_CATALOG[activeTab]?.Component || RealDVIC;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Impersonation banner */}
      <AnimatePresence>
        {impersonating && (
          <motion.div initial={{ y: -40 }} animate={{ y: 0 }} exit={{ y: -40 }}
            className="bg-gradient-to-r from-accent-red/30 via-accent-red/20 to-accent-red/30 border-b border-accent-red/50 px-4 py-2 flex items-center justify-between gap-3 sticky top-0 z-[55] backdrop-blur">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full bg-accent-red/20 border border-accent-red flex items-center justify-center shrink-0">
                <span className="text-[10px]">👁</span>
              </div>
              <div className="text-xs text-white min-w-0 truncate">
                <span className="font-semibold">Ghost Mode</span> — viewing as <span className="font-bold text-white">{user.name}</span>
                <span className="text-navy-200 hidden sm:inline"> &middot; {user.roleLabel}</span>
              </div>
            </div>
            <button onClick={onExitImpersonation}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent-red text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
              Exit Ghost Mode
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Bar */}
      <header className="bg-navy-900/80 backdrop-blur-md border-b border-navy-700/50 sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-6">
          <div className="flex items-center justify-between h-14 sm:h-16 gap-2 sm:gap-3">
            {/* Logo + brand */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center font-bold text-white text-xs sm:text-sm shrink-0">
                NF
              </div>
              <div className="hidden sm:block min-w-0">
                <h1 className="text-base font-semibold text-white leading-tight truncate">Nova Fora</h1>
                <p className="text-[11px] text-navy-400 leading-tight truncate">{user.org}</p>
              </div>
              <div className="sm:hidden min-w-0">
                <h1 className="text-sm font-semibold text-white leading-tight truncate">Nova Fora</h1>
              </div>
              {user.orgType === 'dsp' && (
                <span className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-green/15 border border-accent-green/40 text-accent-green text-[11px] font-semibold">
                  <Star size={11} className="fill-accent-green" />
                  Enrolled
                </span>
              )}
            </div>

            {/* Desktop tabs (compact, scrolls if many) */}
            <nav className="hidden lg:flex items-center gap-1 overflow-x-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer shrink-0 ${
                      isActive
                        ? 'bg-navy-800 text-white'
                        : 'text-navy-300 hover:text-white hover:bg-navy-800/50'
                    }`}
                  >
                    <Icon size={15} className={isActive ? tab.color : ''} />
                    <span>{tab.label}</span>
                    {isActive && (
                      <motion.div
                        layoutId="activeTabIndicator"
                        className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-accent-blue to-accent-purple rounded-full"
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Right cluster */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Notifications bell */}
              <button
                onClick={() => setShowNotifs(true)}
                className="relative w-9 h-9 rounded-lg border border-navy-700/60 bg-navy-800/60 text-navy-200 hover:text-white hover:bg-navy-700/60 flex items-center justify-center transition-all cursor-pointer"
                title="Notifications"
              >
                <Bell size={15} />
                {userNotifCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent-red text-white text-[10px] font-bold flex items-center justify-center">
                    {userNotifCount > 99 ? '99+' : userNotifCount}
                  </span>
                )}
              </button>

              {/* Calm / Vivid palette toggle */}
              <button
                onClick={toggleCalm}
                title={calm ? 'Colors are muted — click to go vivid' : 'Colors are vivid — click to go calm'}
                className="hidden sm:flex relative w-9 h-9 rounded-lg border border-navy-700/60 bg-navy-800/60 text-navy-200 hover:text-white hover:bg-navy-700/60 items-center justify-center transition-all cursor-pointer"
              >
                <AnimatePresence mode="wait" initial={false}>
                  {calm ? (
                    <motion.span key="droplets" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                      <Droplets size={14} />
                    </motion.span>
                  ) : (
                    <motion.span key="sparkles" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                      <Sparkles size={14} className="text-accent-gold" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="hidden sm:flex relative w-9 h-9 rounded-lg border border-navy-700/60 bg-navy-800/60 text-navy-200 hover:text-white hover:bg-navy-700/60 items-center justify-center transition-all cursor-pointer"
              >
                <AnimatePresence mode="wait" initial={false}>
                  {theme === 'dark' ? (
                    <motion.span key="moon" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                      <Moon size={14} />
                    </motion.span>
                  ) : (
                    <motion.span key="sun" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                      <Sun size={14} className="text-accent-gold" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              {/* Role switcher */}
              <RoleSwitcher user={user} onSwitchRole={onSwitchRole} onLogout={onLogout} />

              {/* Mobile menu toggle */}
              <button
                className="lg:hidden text-navy-300 hover:text-white p-2"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="lg:hidden border-t border-navy-700/50 overflow-hidden"
            >
              <div className="p-4 space-y-2">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${
                        isActive
                          ? 'bg-navy-800 text-white'
                          : 'text-navy-300 hover:bg-navy-800/50'
                      }`}
                    >
                      <Icon size={18} className={isActive ? tab.color : ''} />
                      <div>
                        <div className="font-medium text-sm">{tab.label}</div>
                        <div className="text-xs text-navy-400">{tab.subtitle}</div>
                      </div>
                      <ChevronRight size={14} className="ml-auto" />
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Page Content */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${user.id}-${activeTab}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
          >
            <ActiveComponent user={user} onImpersonate={onImpersonate} />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-navy-800 py-4 px-6 text-center text-xs text-navy-500">
        Nova Fora &mdash; Safety First, LLC &mdash; Customer Preview Demo &mdash; signed in as <span className="text-navy-300">{user.name}</span> ({user.roleLabel})
      </footer>

      {/* Notifications side panel */}
      <NotificationsPanel user={user} open={showNotifs} onClose={() => setShowNotifs(false)} />
    </div>
  );
}
