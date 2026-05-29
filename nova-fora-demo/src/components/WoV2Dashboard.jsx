/**
 * WO V2 dashboard — Stakeholder-demo flow adapted to Nova Fora layout.
 *
 * Two tabs:
 *   - Customer (DSP_OWNER, DSP_MANAGER): 5 tiles + table with three actions
 *     ($ Approve cost / Approve defects / Confirm pickup) + van-detail modal.
 *   - Service Writer (VENDOR_ADMIN, SERVICE_WRITER, SITE_ADMIN): 8 status
 *     chips + Customer Confirmed Pickup section + Incoming Requests +
 *     main table with the per-row SW actions.
 *
 * Both tabs read their own counter endpoint
 * (`dashboards.dsp.counters` / `dashboards.sw.counters`) for the header
 * tiles so the page renders in a single fetch + then refines per-row data.
 *
 * Why a brand-new component (instead of extending WorkOrders.jsx): per
 * the root README rule "Do not refactor the frontend demo without
 * authorization", we add — never modify — the existing surface. This
 * component lives alongside WorkOrders and gets its own Layout entry
 * (`wo_v2` view id).
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wrench, ClipboardList, Loader2, AlertTriangle, Flame, Check,
  Hourglass, Briefcase, PackageCheck, Truck, PlayCircle, CheckCircle2,
  XCircle, CircleDashed, DollarSign, CalendarCheck, Eye,
} from 'lucide-react';
import {
  workOrders as woApi,
  dashboards as dashboardsApi,
} from '../api/client';
import CustomerDashboard from './wo_v2/CustomerDashboard';
import ServiceWriterDashboard from './wo_v2/ServiceWriterDashboard';

// Roles that should see the SW pane by default. DSP roles only see Customer.
const SW_ROLES = new Set([
  'vendor_admin', 'service_writer', 'technician', 'vendor_viewer', 'site_admin',
]);
const DSP_ROLES = new Set([
  'dsp_owner', 'dsp_manager', 'dsp_inspector', 'dsp_viewer',
]);

export default function WoV2Dashboard({ user }) {
  // Decide the initial tab from the user's role. Site-admins see both
  // and default to SW (the more action-heavy view); DSP roles are pinned
  // to Customer; vendor roles default to SW.
  const initialTab = DSP_ROLES.has(user?.role) ? 'customer' : 'sw';
  const [tab, setTab] = useState(initialTab);

  // Both tabs allowed only for site_admin. The role-based tab toggle is
  // hidden otherwise so a DSP user doesn't see a SW tab they can't load.
  const showBothTabs = user?.role === 'site_admin';

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-purple/15 flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-accent-purple" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text-strong">
                Work Orders v2
              </h1>
              <p className="text-sm text-text-muted">
                {tab === 'customer'
                  ? 'Customer · DSP Owner'
                  : 'Service Writer'}
              </p>
            </div>
          </div>
          {showBothTabs && (
            <nav className="flex p-1 rounded-lg bg-navy-900 border border-navy-700">
              <TabButton
                active={tab === 'customer'}
                onClick={() => setTab('customer')}
              >
                Customer
              </TabButton>
              <TabButton
                active={tab === 'sw'}
                onClick={() => setTab('sw')}
              >
                Service Writer
              </TabButton>
            </nav>
          )}
        </header>

        {tab === 'customer'
          ? <CustomerDashboard user={user} />
          : <ServiceWriterDashboard user={user} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? 'bg-navy-800 text-text-strong shadow-sm'
          : 'text-text-muted hover:text-text-strong'
      }`}
    >
      {children}
    </button>
  );
}
