import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Shield, BarChart3, Wrench, ChevronRight, Menu, X, Sun, Moon, Bell,
  LayoutGrid, Truck, ClipboardList, Settings, Eye, Star, Home as HomeIcon,
  AlertTriangle, ChevronDown, Check
} from 'lucide-react';
import VendorScorecard from './VendorScorecard';
import HomeRouter from './HomeRouter';
import BodyRepairs from './BodyRepairs';
import FleetSnapshot from './FleetSnapshot';
import MyVehicles from './MyVehicles';
import MyDsps from './MyDsps';
import WoV2Dashboard from './WoV2Dashboard';
import AdminPanel from './AdminPanel';
import GhostMode from './GhostMode';
import Defects from './Defects';
import NotificationsPanel from './NotificationsPanel';
import RoleSwitcher from './ui/RoleSwitcher';
import { rolePermissions, notificationsSeed } from '../data/mockData';
import { vendorWorkshops as vendorWorkshopsApi } from '../api/client';
import { isVendorRole } from '../lib/permissions';

// View catalog — id, i18n key, icon, accent color, component.
// Labels are looked up via t('layout:nav.<key>') and t('layout:subtitles.<key>')
// at render time so language changes apply without a reload.
const VIEW_CATALOG = {
  // Home tab — HomeRouter dispatches by user.role: DSP → RealDVIC
  // (inspector landing); vendor / site_admin → VendorHome (the new
  // Vendor View dashboard, mockup page 2). Single nav slot, two layouts.
  dvic:        { id: 'dvic',        i18nKey: 'dvic',        icon: HomeIcon,       color: 'text-accent-green',  Component: HomeRouter },
  defects:     { id: 'defects',     i18nKey: 'defects',     icon: AlertTriangle,  color: 'text-accent-orange', Component: Defects },
  snapshot:    { id: 'snapshot',    i18nKey: 'snapshot',    icon: LayoutGrid,     color: 'text-accent-blue',   Component: FleetSnapshot },
  vehicles:    { id: 'vehicles',    i18nKey: 'vehicles',    icon: Truck,          color: 'text-accent-green',  Component: MyVehicles },
  my_dsps:     { id: 'my_dsps',     i18nKey: 'myDsps',      icon: Truck,          color: 'text-accent-blue',   Component: MyDsps },
  // The canonical Work Orders view. Was 'wo_v2' during the iter-1 build,
  // promoted to the only WO surface 2026-05-25 once feature parity with
  // the legacy WorkOrders page was reached (Accept/Decline/Start/Complete
  // via StatusChanger + Schedule + Van detail + DSP approval flows).
  // The old WorkOrders.jsx component is no longer imported.
  //
  // Two view ids point at the same component on purpose:
  //   • `work_orders` — top-level tab. Used by vendor + site_admin roles
  //                     (their daily entry point).
  //   • `wo_status`  — same component, surfaced inside the DSP's
  //                     Dashboard dropdown. The DSP's original IA placed
  //                     "Work Orders" under Dashboard alongside Defects
  //                     and Body Repairs, so we preserve that grouping.
  // The Component is role-aware (renders the SW dashboard for vendors,
  // the Customer dashboard for DSPs) so the same Component works for both.
  work_orders: { id: 'work_orders', i18nKey: 'workOrders',  icon: ClipboardList,  color: 'text-accent-purple', Component: WoV2Dashboard },
  wo_status:   { id: 'wo_status',   i18nKey: 'workOrders',  icon: ClipboardList,  color: 'text-accent-purple', Component: WoV2Dashboard },
  body:        { id: 'body',        i18nKey: 'body',        icon: Wrench,         color: 'text-accent-purple', Component: BodyRepairs },
  scorecard:   { id: 'scorecard',   i18nKey: 'scorecard',   icon: BarChart3,      color: 'text-accent-blue',   Component: VendorScorecard },
  admin:       { id: 'admin',       i18nKey: 'admin',       icon: Settings,       color: 'text-accent-gold',   Component: AdminPanel },
  ghost:       { id: 'ghost',       i18nKey: 'ghost',       icon: Eye,            color: 'text-accent-red',    Component: GhostMode },
};

// URL-hash slugs for top-level tabs. The internal view ids are legacy
// (`dvic` literally means "the DVIC dashboard tab" from V1; on the
// vendor side it's been repurposed as Home, and `snapshot` is the QC
// DVIC heatmap). Showing those raw in the address bar is confusing —
// e.g. /#dvic when the visible label says "Home". This map is COSMETIC
// only: the React state and history-state payload still carry the
// internal id, the slug just decorates the URL. Unknown ids fall back
// to the id with underscores swapped for dashes.
const TAB_SLUG = {
  dvic:        'home',
  snapshot:    'qc-dvic',
  my_dsps:     'my-dsps',
  work_orders: 'work-orders',
  wo_status:   'work-orders',
};

function tabSlug(id) {
  if (TAB_SLUG[id]) return TAB_SLUG[id];
  return String(id || '').replace(/_/g, '-');
}

// 'Dashboard' is a virtual group rendered as a dropdown that contains the
// defects + body repairs + work orders views (so they share a single nav
// slot for DSP). `wo_status` is the DSP-side handle for Work Orders —
// same WoV2Dashboard component as vendors get top-level, just nested in
// the dropdown per the DSP's IA convention.
const DASHBOARD_GROUP = {
  id: 'dashboard',
  i18nKey: 'dashboard',
  icon: AlertTriangle,
  color: 'text-accent-orange',
  children: ['defects', 'body', 'wo_status'],
};

export default function Layout({ user, onSwitchRole, onLogout, onImpersonate, impersonating, onExitImpersonation }) {
  const { t } = useTranslation('layout');
  const [showNotifs, setShowNotifs] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);

  // Resolve translated label/subtitle for a view-catalog entry on each render.
  const navLabel = (key) => t(`nav.${key}`);
  const navSub = (key) => t(`subtitles.${key}`, '');

  // For vendor users, the Body Repairs tab only belongs in the nav if the
  // vendor's own workshop(s) actually do body work — a mechanical or tires
  // shop has no business in that view. We fetch the workshop catalog (the
  // endpoint is read-only for vendor_admin and below) and collect the
  // repair_types for workshops that belong to this user's organization.
  //
  // States:
  //   null  → not yet known (don't render the tab to avoid leakage)
  //   true  → vendor does body work, show the tab
  //   false → vendor doesn't do body work, hide the tab
  // For non-vendor roles the value is `true` so the static tab list runs
  // unfiltered (DSP admins, site_admin keep their Body tab as defined in
  // rolePermissions).
  const [vendorDoesBody, setVendorDoesBody] = useState(
    isVendorRole(user) ? null : true,
  );
  useEffect(() => {
    if (!isVendorRole(user)) {
      setVendorDoesBody(true);
      return;
    }
    let cancelled = false;
    vendorWorkshopsApi
      .list({ includeInactive: false })
      .then((res) => {
        if (cancelled) return;
        // /auth/me serves orgId as the prefixed string ("V-006") — strip
        // it back to the integer that vendor_workshops.organization_id
        // carries so the filter actually matches.
        const rawOrgId = user?.organizationId ?? user?.orgId;
        const m = String(rawOrgId ?? '').match(/(\d+)/);
        const myOrgIntId = m ? Number(m[1]) : null;
        const mine = (res.items || []).filter(
          (w) => myOrgIntId != null && Number(w.organizationId) === myOrgIntId,
        );
        const repairTypes = new Set(
          mine.flatMap((w) => w.repairTypes || []),
        );
        setVendorDoesBody(repairTypes.has('body'));
      })
      .catch((err) => {
        // On failure: leave the tab hidden so we don't accidentally
        // surface a section the user has no business in. The user can
        // reload if their workshop is actually body-typed.
        console.warn('vendor workshop fetch (for body-tab gate) failed', err);
        if (!cancelled) setVendorDoesBody(false);
      });
    return () => { cancelled = true; };
  }, [user]);

  // Tabs are derived from the user's role. Views that belong to the
  // Dashboard dropdown collapse into a single virtual group entry placed
  // where the first of its children appeared in the role's permission list.
  const tabs = useMemo(() => {
    let allowedIds = rolePermissions[user.role] || [];
    if (isVendorRole(user) && !vendorDoesBody) {
      // Drop 'body' until we confirm the vendor does body work.
      allowedIds = allowedIds.filter((id) => id !== 'body');
    }
    const decorate = (v) => ({
      ...v,
      label: navLabel(v.i18nKey),
      subtitle: navSub(v.i18nKey),
    });
    const groupChildren = DASHBOARD_GROUP.children
      .filter((c) => allowedIds.includes(c))
      .map((id) => VIEW_CATALOG[id])
      .filter(Boolean)
      .map(decorate);
    const result = [];
    let dashboardInserted = false;
    for (const id of allowedIds) {
      if (DASHBOARD_GROUP.children.includes(id)) {
        if (!dashboardInserted && groupChildren.length > 0) {
          result.push({
            ...DASHBOARD_GROUP,
            label: navLabel(DASHBOARD_GROUP.i18nKey),
            subtitle: navSub(DASHBOARD_GROUP.i18nKey),
            isGroup: true,
            childrenViews: groupChildren,
          });
          dashboardInserted = true;
        }
        continue;
      }
      const view = VIEW_CATALOG[id];
      if (view) result.push(decorate(view));
    }
    return result;
    // i18n.language as dep so tabs re-build when the user toggles language.
    // vendorDoesBody as dep so the Body tab is added once we confirm the
    // vendor actually does body work (and removed if the answer flips).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role, t, vendorDoesBody]);

  // 2026-06-02 bug 03 fix: lift the notif list to Layout so the header
  // badge AND the modal share ONE source of truth. Before, the header
  // was reading the imported notificationsSeed via useMemo and the
  // modal had its own useState copy — clicking "mark read" in the
  // modal updated only the local copy and the badge stayed stale.
  // Now we own the list here, pass setUserNotifs into the modal, and
  // it dispatches up. user?.id dep re-seeds on role switch.
  const [userNotifs, setUserNotifs] = useState(() =>
    notificationsSeed.filter((n) => n.userId === user?.id),
  );
  useEffect(() => {
    setUserNotifs(notificationsSeed.filter((n) => n.userId === user?.id));
  }, [user?.id]);
  const userNotifCount = useMemo(
    () => userNotifs.filter((n) => !n.read).length,
    [userNotifs],
  );

  // Pick a sensible default landing view per role
  const defaultTab = tabs[0]?.id || 'dvic';
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Reset to first allowed tab when role changes
  useEffect(() => {
    const allTabIds = new Set();
    tabs.forEach((t) => {
      if (t.isGroup && Array.isArray(t.childrenViews)) {
        t.childrenViews.forEach((c) => allTabIds.add(c.id));
      } else {
        allTabIds.add(t.id);
      }
    });
    if (!allTabIds.has(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [user.role, tabs, activeTab, defaultTab]);

  // ─── Browser back/forward integration (minimal — no react-router) ───
  // Each top-level activeTab change pushes a history entry tagged
  // { nf: true, tab: id }. Browser back triggers popstate, we read the
  // stored tab id and restore it instead of letting the browser exit
  // the SPA. Without this the user got "back kicks me out of the app"
  // (no history entries existed because every nav was a setState).
  //
  // The URL hash uses a human-friendly slug (#home, #qc-dvic) — the
  // internal `dvic`/`snapshot`/etc. ids are legacy from the demo's
  // evolution and confusing in the address bar ("dvic" used to mean the
  // DVIC dashboard; now for the vendor it's just Home). The slug is
  // cosmetic; the state we push/restore is still the canonical id.
  //
  // Scope is intentionally tabs only — modals/sub-views still use their
  // own state. If a modal is open when the user hits back, the tab
  // switch tears it down via re-render, which is acceptable for now.
  const skipNextPushRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Tag the current entry with the active tab so popstate landing
    // back here knows what to restore. replaceState (not push) — we
    // don't synthesise a fake step.
    window.history.replaceState(
      { nf: true, tab: activeTab },
      '',
      `${window.location.pathname}#${tabSlug(activeTab)}`,
    );
    const onPopState = (e) => {
      const tab = e.state && e.state.nf ? e.state.tab : null;
      if (tab) {
        skipNextPushRef.current = true;
        setActiveTab(tab);
      }
      // If state has no nf tag (user navigated back beyond the app's
      // first entry), do nothing — the browser handles it natively.
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // intentionally [] — runs once per mount; activeTab updates handled
    // by the second effect below
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // popstate already restored this tab — don't push a duplicate entry
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false;
      return;
    }
    // Avoid duplicate on initial render (replaceState above just set it)
    const cur = window.history.state;
    if (cur && cur.nf && cur.tab === activeTab) return;
    window.history.pushState(
      { nf: true, tab: activeTab },
      '',
      `${window.location.pathname}#${tabSlug(activeTab)}`,
    );
  }, [activeTab]);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    return localStorage.getItem('nf-theme') || 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') root.classList.add('light');
    else root.classList.remove('light');
    // Calm mode (grayscale palette) was removed — make sure the class is off
    root.classList.remove('calm');
    localStorage.setItem('nf-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

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
                <span className="font-semibold">{t('impersonation.title', 'Ghost Mode')}</span> — {t('impersonation.viewingAs', 'viewing as')} <span className="font-bold text-white">{user.name}</span>
                <span className="text-navy-200 hidden sm:inline"> &middot; {user.roleLabel}</span>
              </div>
            </div>
            <button onClick={onExitImpersonation}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent-red text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
              {t('impersonation.exit')}
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

            {/* Desktop tabs (compact). overflow-visible required so the
                Dashboard dropdown isn't clipped by the nav. */}
            <nav className="hidden lg:flex items-center gap-1 overflow-visible flex-wrap">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                if (tab.isGroup) {
                  // Group dropdown — active when any child view is the active tab
                  const isActive = tab.childrenViews.some((c) => c.id === activeTab);
                  return (
                    <div key={tab.id} className="relative shrink-0">
                      <button
                        onClick={() => setDashboardOpen((o) => !o)}
                        className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                          isActive
                            ? 'bg-navy-800 text-white'
                            : 'text-navy-300 hover:text-white hover:bg-navy-800/50'
                        }`}>
                        <Icon size={15} className={isActive ? tab.color : ''} />
                        <span>{tab.label}</span>
                        <ChevronDown size={12} className={`transition-transform ${dashboardOpen ? 'rotate-180' : ''}`} />
                        {isActive && (
                          <motion.div
                            layoutId="activeTabIndicator"
                            className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-accent-blue to-accent-purple rounded-full"
                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                          />
                        )}
                      </button>
                      {dashboardOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setDashboardOpen(false)} />
                          <div className="absolute top-full left-0 mt-1 w-56 bg-navy-900 border border-navy-700 rounded-lg shadow-2xl z-50 overflow-hidden">
                            {tab.childrenViews.map((child) => {
                              const ChildIcon = child.icon;
                              const childActive = activeTab === child.id;
                              return (
                                <button key={child.id}
                                  onClick={() => { setActiveTab(child.id); setDashboardOpen(false); }}
                                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors border-b border-navy-800/60 last:border-b-0 ${
                                    childActive ? 'bg-navy-800 text-white' : 'text-navy-200 hover:bg-navy-800/60 hover:text-white'
                                  }`}>
                                  <ChildIcon size={14} className={child.color} />
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium">{child.label}</div>
                                    <div className="text-[10px] text-navy-400">{child.subtitle}</div>
                                  </div>
                                  {childActive && <Check size={12} className="text-accent-green shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                }
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

              {/* Language toggle (compact) */}
              <LanguageToggle />

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
                  if (tab.isGroup) {
                    return (
                      <div key={tab.id} className="space-y-1">
                        <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-navy-400">
                          <Icon size={14} className={tab.color} />
                          {tab.label}
                        </div>
                        {tab.childrenViews.map((child) => {
                          const ChildIcon = child.icon;
                          const childActive = activeTab === child.id;
                          return (
                            <button key={child.id}
                              onClick={() => { setActiveTab(child.id); setMobileMenuOpen(false); }}
                              className={`w-full flex items-center gap-3 px-4 py-3 ml-2 rounded-lg text-left transition-all ${
                                childActive ? 'bg-navy-800 text-white' : 'text-navy-300 hover:bg-navy-800/50'
                              }`}>
                              <ChildIcon size={18} className={childActive ? child.color : ''} />
                              <div>
                                <div className="font-medium text-sm">{child.label}</div>
                                <div className="text-xs text-navy-400">{child.subtitle}</div>
                              </div>
                              <ChevronRight size={14} className="ml-auto" />
                            </button>
                          );
                        })}
                      </div>
                    );
                  }
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

      {/* Page Content
          NOTE: Removed the framer-motion wrapper here — it was getting
          stuck at opacity 0 when the Dashboard dropdown fired two state
          updates simultaneously (setActiveTab + setDashboardOpen), which
          confused framer-motion v12's enter handshake on the keyed motion.div.
          Each child component (RealDVIC, BodyRepairs, etc.) does its own
          enter animations internally, so we don't lose the polish. */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <div key={`${user.id}-${activeTab}`}>
          <ActiveComponent user={user} onImpersonate={onImpersonate} />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-navy-800 py-4 px-6 text-center text-xs text-navy-500">
        Nova Fora &mdash; Safety First, LLC &mdash; Customer Preview Demo &mdash; signed in as <span className="text-navy-300">{user.name}</span> ({user.roleLabel})
      </footer>

      {/* Notifications side panel */}
      <NotificationsPanel
        user={user}
        open={showNotifs}
        onClose={() => setShowNotifs(false)}
        notifs={userNotifs}
        setNotifs={setUserNotifs}
      />
    </div>
  );
}


// ─────────────────────────────────────────────────────
// Compact ES/US toggle in the top bar — same persistence path as the
// dropdown picker in RoleSwitcher (localStorage + PATCH /auth/me/language).
// ─────────────────────────────────────────────────────
import { setLanguage as setI18nLang, SUPPORTED_LANGUAGES } from '../i18n';
import { auth as authApi } from '../api/client';

function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage || i18n.language || 'es').slice(0, 2);

  const next = SUPPORTED_LANGUAGES.find((l) => l.code !== current) || SUPPORTED_LANGUAGES[0];
  const active = SUPPORTED_LANGUAGES.find((l) => l.code === current) || SUPPORTED_LANGUAGES[0];

  const handleClick = async () => {
    await setI18nLang(next.code);
    // Best-effort sync to user record (no-op if not authenticated yet).
    authApi.setLanguage(next.code).catch(() => {});
  };

  return (
    <button
      onClick={handleClick}
      title={`${active.nativeLabel} → ${next.nativeLabel}`}
      className="hidden sm:flex items-center justify-center px-2.5 h-9 rounded-lg border border-navy-700/60 bg-navy-800/60 text-navy-200 hover:text-white hover:bg-navy-700/60 transition-all cursor-pointer text-xs font-semibold"
    >
      <span className="tracking-wide">{active.shortCode}</span>
    </button>
  );
}
