import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Settings, Users, Shield, Building2, ClipboardCheck, Plus, X, Check, CheckCircle2,
  Mail, Key, Lock, Unlock, Smartphone, Trash2, Edit3, AlertTriangle, Info,
  ChevronDown, ChevronRight, Phone, MapPin, MessageSquare, Wrench as WrenchIcon,
  Clock, Calendar, RefreshCw, RotateCw, Send, QrCode, Eye, EyeOff, Copy, Package, Sparkles,
  Armchair, Paintbrush, Car, Zap, Circle, Search, Lightbulb, Droplet, Wind,
  LifeBuoy, Gauge, MonitorSmartphone, ThermometerSun, HelpCircle, Zap as ZapIcon,
  Ban, CheckCheck, ExternalLink, UserCircle, Loader2, Gift, ScrollText
} from 'lucide-react';
import { orgUsers, AVAILABLE_ROLES, rolesAssignableBy, preventiveMaintenanceJobs, pmIntervalsByVehicleType, VENDOR_SERVICES, DEFECT_CATEGORIES, fleetSnapshotVans, VENDOR_ASSIGNABLE_DSPS } from '../data/mockData';
import { inspectionRules as inspectionRulesApi, catalog as defectCatalogApi, invitations as invitationsApi, APIError } from '../api/client';
import { isOrgAdmin as isOrgAdminRole, isVendorRole } from '../lib/permissions';
import Badge from './ui/Badge';
import RewardsTab from './admin/RewardsTab';
import InspectorPerformanceTab from './admin/InspectorPerformanceTab';
import AuditLogTab from './admin/AuditLogTab';

// V2.2 vehicle classes — drive both the DVIC checklist and this admin
// catalog view. Labels intentionally describe the *physical* vehicle type;
// "Branded vs Owner vs Rental" is the separate Ownership axis on each
// vehicle, not a class.
const DVIC_TEMPLATES = [
  { id: 'regular_cargo_van',   label: 'Cargo Van' },
  { id: 'custom_delivery_van', label: 'Custom Delivery Van (CDV)' },
  { id: 'step_van_dot',        label: 'Step Van (DOT)' },
  { id: 'box_truck_dot',       label: 'Box Truck (AMXL)' },
  { id: 'electric_vehicle',    label: 'Electric Vehicle' },
];

const DVIC_SECTIONS = [
  { id: 'general',         label: 'General' },
  { id: 'front_side',      label: 'Front Side' },
  { id: 'back_side',       label: 'Back Side' },
  { id: 'driver_side',     label: 'Driver Side' },
  { id: 'passenger_side',  label: 'Passenger Side' },
  { id: 'in_cab',          label: 'In Cab' },
];
const SECTION_LABEL = Object.fromEntries(DVIC_SECTIONS.map((s) => [s.id, s.label]));

const CLASSIFICATIONS = ['Sev1', 'Sev2', 'Sev3', 'ULC', 'Advisory'];
const GROUPS = ['AMR', 'Body', 'CMR', 'CNMR', 'PM', 'Tires', 'Detailing', 'Netradyne'];
const LINES = ['Mechanical', 'Electrical', 'Body', 'Tires', 'Fluids', 'Documentation', 'Cleanliness', 'Safety'];

const DEFECT_CATEGORY_ICONS = {
  Circle, Lightbulb, Droplet, Wind, LifeBuoy, Eye, Gauge, Car, Shield, MonitorSmartphone, ThermometerSun, HelpCircle,
};

const SERVICE_ICONS = { WrenchIcon, Zap, Car, Paintbrush, Shield, Armchair, Sparkles, ClipboardCheck, Circle, Package };

// ============================================================
// Reusable DSP picker — multi-select with "All" quick action
// ============================================================
function DspAssignmentPicker({ selected, onChange, color = 'accent-blue' }) {
  const { t } = useTranslation('admin');
  const allIds = VENDOR_ASSIGNABLE_DSPS.map((d) => d.id);
  const allSelected = selected.length === allIds.length;
  const noneSelected = selected.length === 0;

  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const selectAll = () => onChange(allSelected ? [] : allIds);

  const borderMap = { 'accent-blue': 'border-accent-blue/50 bg-accent-blue/5', 'accent-green': 'border-accent-green/50 bg-accent-green/5' };
  const checkMap  = { 'accent-blue': 'bg-accent-blue border-accent-blue', 'accent-green': 'bg-accent-green border-accent-green' };
  const activeBorder = borderMap[color] || borderMap['accent-blue'];
  const activeCheck = checkMap[color] || checkMap['accent-blue'];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[11px] text-navy-400">
          <Building2 size={11} />
          {noneSelected
            ? <span className="text-accent-orange font-semibold">{t('dspPicker.noneSelected', "No DSPs assigned — this user won't see any WOs")}</span>
            : allSelected
              ? <span className="text-white font-semibold">{t('dspPicker.allSelected', 'All DSPs selected')}</span>
              : <span className="text-white font-semibold">{t('dspPicker.selectedCountFmt', { selected: selected.length, total: allIds.length, defaultValue: `${selected.length} of ${allIds.length} DSPs selected` })}</span>}
        </div>
        <button onClick={selectAll} className="text-[11px] text-accent-blue hover:underline font-medium">
          {allSelected ? t('dspPicker.clearAll', 'Clear all') : t('dspPicker.selectAll', 'Select all')}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {VENDOR_ASSIGNABLE_DSPS.map((d) => {
          const active = selected.includes(d.id);
          return (
            <button key={d.id} type="button" onClick={() => toggle(d.id)}
              className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                active ? activeBorder : 'border-navy-700 bg-navy-800/30 hover:border-navy-600'
              }`}>
              <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                active ? activeCheck : 'border-navy-600'
              }`}>
                {active && <Check size={12} className="text-white" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-white truncate">{d.name} <span className="text-navy-400 font-normal">({d.code})</span></div>
                <div className="text-[10px] text-navy-400">{t('dspPicker.stationFmt', { station: d.station, count: d.vanCount, defaultValue: `Station ${d.station} · ${d.vanCount} vans` })}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Tab: Users
// ============================================================
function UsersTab({ user, users, onUpdateUsers }) {
  const { t } = useTranslation('admin');
  const [showInvite, setShowInvite] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [search, setSearch] = useState('');

  // Vendor admin view needs an extra DSP-assignment column
  const isVendorOrg = user?.orgType === 'vendor' || user?.orgId?.startsWith('V-');

  const filtered = search
    ? users.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
    : users;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('users.searchPlaceholder', 'Search users…')}
            className="w-full rounded-lg pl-9 pr-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" />
        </div>
        <button onClick={() => setShowInvite(true)}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-accent-green text-white text-sm font-semibold hover:bg-accent-green/80 cursor-pointer">
          <Plus size={14} /> {t('users.inviteUser', 'Invite User')}
        </button>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-navy-800 bg-navy-950/40">
              <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">{t('users.table.user', 'User')}</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">{t('users.table.roles', 'Roles')}</th>
              {isVendorOrg && <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">{t('users.table.dspsAssigned', 'DSPs Assigned')}</th>}
              <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">{t('users.table.status', 'Status')}</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">{t('users.table.twoFA', '2FA')}</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">{t('users.table.lastLogin', 'Last login')}</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} onClick={() => setEditUser(u)}
                className="border-b border-navy-800/60 last:border-b-0 hover:bg-navy-800/40 cursor-pointer transition-colors">
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-white">{u.name}</div>
                  <div className="text-[11px] text-navy-400">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.slice(0, 2).map((r) => {
                      const role = AVAILABLE_ROLES.find((x) => x.id === r);
                      return <Badge key={r} variant="blue">{role?.label || r}</Badge>;
                    })}
                    {u.roles.length > 2 && <Badge variant="gray">+{u.roles.length - 2}</Badge>}
                  </div>
                </td>
                {isVendorOrg && (
                  <td className="px-4 py-3">
                    {(u.assignedDsps || []).length === 0 ? (
                      <span className="text-[11px] text-accent-orange">{t('users.noneAssignment', 'None')}</span>
                    ) : (u.assignedDsps || []).length === VENDOR_ASSIGNABLE_DSPS.length ? (
                      <Badge variant="green">{t('users.allCountFmt', { count: VENDOR_ASSIGNABLE_DSPS.length, defaultValue: `All (${VENDOR_ASSIGNABLE_DSPS.length})` })}</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(u.assignedDsps || []).slice(0, 2).map((did) => {
                          const d = VENDOR_ASSIGNABLE_DSPS.find((x) => x.id === did);
                          return <Badge key={did} variant="blue">{d?.code || did.replace('DSP-', '')}</Badge>;
                        })}
                        {(u.assignedDsps || []).length > 2 && <Badge variant="gray">+{(u.assignedDsps || []).length - 2}</Badge>}
                      </div>
                    )}
                  </td>
                )}
                <td className="px-4 py-3">
                  {u.status === 'active' && <Badge variant="green">{t('users.status.active', 'Active')}</Badge>}
                  {u.status === 'pending' && <Badge variant="gold">{t('users.status.pending', 'Pending')}</Badge>}
                  {u.status === 'invited' && <Badge variant="purple">{t('users.status.invited', 'Invited')}</Badge>}
                </td>
                <td className="px-4 py-3">
                  {u.twoFAEnabled ? <Lock size={14} className="text-accent-green" /> : <Unlock size={14} className="text-navy-500" />}
                </td>
                <td className="px-4 py-3 text-xs text-navy-300">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : <span className="text-navy-500">{t('users.lastLoginNever', 'Never')}</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <Edit3 size={14} className="text-navy-400" />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={isVendorOrg ? 7 : 6} className="px-4 py-10 text-center text-sm text-navy-400">{t('users.noMatch', 'No users match your search.')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {filtered.map((u) => (
          <button key={u.id} onClick={() => setEditUser(u)}
            className="w-full text-left bg-navy-900/60 border border-navy-700/40 rounded-xl p-3 hover:bg-navy-800/60 cursor-pointer">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white truncate">{u.name}</div>
                <div className="text-[11px] text-navy-400 truncate">{u.email}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {u.twoFAEnabled && <Lock size={12} className="text-accent-green" />}
                {u.status === 'active' && <Badge variant="green">{t('users.status.active', 'Active')}</Badge>}
                {u.status === 'pending' && <Badge variant="gold">{t('users.status.pending', 'Pending')}</Badge>}
                {u.status === 'invited' && <Badge variant="purple">{t('users.status.invited', 'Invited')}</Badge>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {u.roles.map((r) => {
                const role = AVAILABLE_ROLES.find((x) => x.id === r);
                return <Badge key={r} variant="blue">{role?.label || r}</Badge>;
              })}
            </div>
            {isVendorOrg && (
              <div className="mt-2 pt-2 border-t border-navy-800/60">
                <div className="text-[10px] text-navy-400 uppercase tracking-wide mb-1 flex items-center gap-1"><Building2 size={9} /> {t('users.mobileDspsLabel', 'DSPs assigned')}</div>
                {(u.assignedDsps || []).length === 0 ? (
                  <span className="text-[11px] text-accent-orange">{t('users.noneWontSeeWOs', "None — user won't see any WOs")}</span>
                ) : (u.assignedDsps || []).length === VENDOR_ASSIGNABLE_DSPS.length ? (
                  <Badge variant="green">{t('users.allDspsFmt', { count: VENDOR_ASSIGNABLE_DSPS.length, defaultValue: `All ${VENDOR_ASSIGNABLE_DSPS.length} DSPs` })}</Badge>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {(u.assignedDsps || []).map((did) => {
                      const d = VENDOR_ASSIGNABLE_DSPS.find((x) => x.id === did);
                      return <Badge key={did} variant="blue">{d?.code || did}</Badge>;
                    })}
                  </div>
                )}
              </div>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {showInvite && <InviteUserModal isVendorOrg={isVendorOrg} adminOrgType={user?.orgType} onClose={() => setShowInvite(false)} onInvite={(newUser) => {
          onUpdateUsers([{ ...newUser, id: `u-${Date.now()}`, dspId: user.orgId, status: 'invited', lastLoginAt: null, twoFAEnabled: false, invitedBy: user.name }, ...users]);
        }} />}
        {editUser && <EditUserModal user={editUser} isVendorOrg={isVendorOrg} adminOrgType={user?.orgType} onClose={() => setEditUser(null)}
          onSave={(updated) => { onUpdateUsers(users.map((x) => (x.id === updated.id ? updated : x))); setEditUser(null); }}
          onRemove={(id) => { onUpdateUsers(users.filter((x) => x.id !== id)); setEditUser(null); }} />}
      </AnimatePresence>
    </div>
  );
}

function InviteUserModal({ onClose, onInvite, isVendorOrg = false, adminOrgType }) {
  const { t } = useTranslation('admin');
  const assignableRoles = rolesAssignableBy(adminOrgType);
  const defaultRole = isVendorOrg ? 'technician' : adminOrgType === 'dsp' ? 'fleet_owner' : assignableRoles[0]?.id;
  const [form, setForm] = useState({ name: '', email: '', roles: [defaultRole], assignedDsps: [] });
  const [submitting, setSubmitting] = useState(false);
  const toggleRole = (r) => setForm({ ...form, roles: form.roles.includes(r) ? form.roles.filter((x) => x !== r) : [...form.roles, r] });
  const valid = form.name && form.email.includes('@') && form.roles.length > 0;

  const submit = () => {
    setSubmitting(true);
    setTimeout(() => { onInvite(form); onClose(); }, 700);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-green/15 flex items-center justify-center"><Mail size={16} className="text-accent-green" /></div>
            <div><h3 className="text-base font-semibold text-white">{t('inviteModal.title', 'Invite User')}</h3><p className="text-[11px] text-navy-400">{t('inviteModal.subtitle', "They'll receive an email to set their password")}</p></div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('inviteModal.fullName', 'Full name')}</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('inviteModal.fullNamePlaceholder', 'e.g. Jose Pérez')}
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green" />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('inviteModal.email', 'Email')}</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t('inviteModal.emailPlaceholder', 'jose@example.com')}
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green" />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('inviteModal.rolesLabel', 'Roles')}</label>
            <p className="text-[11px] text-navy-400 mb-2">
              {isVendorOrg
                ? t('inviteModal.rolesHintVendor', "Only vendor roles are available — you can't grant DSP or platform roles from here.")
                : adminOrgType === 'dsp'
                  ? t('inviteModal.rolesHintDsp', 'Only DSP roles are available for your organization.')
                  : t('inviteModal.rolesHintPlatform', 'Assign any platform role.')}
            </p>
            <div className="space-y-1.5">
              {assignableRoles.map((r) => (
                <label key={r.id} className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                  form.roles.includes(r.id) ? 'border-accent-green/50 bg-accent-green/5' : 'border-navy-700 bg-navy-800/30 hover:border-navy-600'
                }`}>
                  <input type="checkbox" checked={form.roles.includes(r.id)} onChange={() => toggleRole(r.id)} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white">{r.label}</div>
                    <div className="text-[11px] text-navy-400">{r.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* DSP assignments — vendor orgs only */}
          {isVendorOrg && (
            <div>
              <label className="text-xs font-semibold text-navy-300 mb-1.5 block flex items-center gap-1.5">
                <Building2 size={12} className="text-accent-blue" /> {t('inviteModal.dspAssignmentsLabel', 'DSP Assignments')}
              </label>
              <p className="text-[11px] text-navy-400 mb-2">{t('inviteModal.dspAssignmentsHint', "Choose which DSPs this user will handle. They'll only see WOs and vehicles from the DSPs selected here.")}</p>
              <DspAssignmentPicker selected={form.assignedDsps} onChange={(v) => setForm({ ...form, assignedDsps: v })} color="accent-green" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">{t('inviteModal.cancel', 'Cancel')}</button>
          <button onClick={submit} disabled={!valid || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {submitting ? t('inviteModal.sending', 'Sending…') : <>{t('inviteModal.sendInvite', 'Send Invite')} <Mail size={14} /></>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function EditUserModal({ user, onClose, onSave, onRemove, isVendorOrg = false, adminOrgType }) {
  const { t } = useTranslation('admin');
  const assignableRoles = rolesAssignableBy(adminOrgType);
  const [form, setForm] = useState({ ...user, assignedDsps: user.assignedDsps || [] });
  const [showRemove, setShowRemove] = useState(false);
  const toggleRole = (r) => setForm({ ...form, roles: form.roles.includes(r) ? form.roles.filter((x) => x !== r) : [...form.roles, r] });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-blue/15 flex items-center justify-center"><Users size={16} className="text-accent-blue" /></div>
            <div><h3 className="text-base font-semibold text-white">{t('editUserModal.title', 'Edit User')}</h3><p className="text-[11px] text-navy-400">{user.email}</p></div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div><label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('editUserModal.fullName', 'Full name')}</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('editUserModal.rolesLabel', 'Roles')}</label>
            <p className="text-[11px] text-navy-400 mb-2">
              {isVendorOrg
                ? t('editUserModal.rolesHintVendor', "Only vendor roles are available — you can't grant DSP or platform roles from here.")
                : adminOrgType === 'dsp'
                  ? t('editUserModal.rolesHintDsp', 'Only DSP roles are available for your organization.')
                  : t('editUserModal.rolesHintPlatform', 'Any role can be granted.')}
            </p>
            <div className="space-y-1.5">
              {assignableRoles.map((r) => (
                <label key={r.id} className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                  form.roles.includes(r.id) ? 'border-accent-blue/50 bg-accent-blue/5' : 'border-navy-700 bg-navy-800/30 hover:border-navy-600'
                }`}>
                  <input type="checkbox" checked={form.roles.includes(r.id)} onChange={() => toggleRole(r.id)} className="mt-0.5" />
                  <div><div className="text-sm font-semibold text-white">{r.label}</div><div className="text-[11px] text-navy-400">{r.description}</div></div>
                </label>
              ))}
            </div>
          </div>
          {/* DSP assignments — vendor orgs only */}
          {isVendorOrg && (
            <div>
              <label className="text-xs font-semibold text-navy-300 mb-1.5 block flex items-center gap-1.5">
                <Building2 size={12} className="text-accent-blue" /> {t('editUserModal.dspAssignmentsLabel', 'DSP Assignments')}
              </label>
              <p className="text-[11px] text-navy-400 mb-2">{t('editUserModal.dspAssignmentsHint', 'Pick which DSPs this user will handle. Each user only sees WOs and vehicles from the assigned DSPs.')}</p>
              <DspAssignmentPicker selected={form.assignedDsps} onChange={(v) => setForm({ ...form, assignedDsps: v })} color="accent-blue" />
            </div>
          )}

          <div className="flex items-center gap-2 p-3 rounded-lg bg-navy-800/40 border border-navy-700/40">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${form.twoFAEnabled ? 'bg-accent-green/15' : 'bg-navy-700'}`}>
              {form.twoFAEnabled ? <Lock size={14} className="text-accent-green" /> : <Unlock size={14} className="text-navy-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">{t('editUserModal.twoFATitle', 'Two-factor auth')}</div>
              <div className="text-[11px] text-navy-400">{form.twoFAEnabled ? t('editUserModal.twoFAEnabled', 'Enabled') : t('editUserModal.twoFADisabled', 'Not enabled — user can enable in Security')}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={() => setShowRemove(true)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium text-accent-red hover:bg-accent-red/10 cursor-pointer">
            <Trash2 size={14} /> {t('editUserModal.remove', 'Remove')}
          </button>
          <button onClick={() => onSave(form)} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-blue text-white hover:opacity-90 cursor-pointer">
            <Check size={14} /> {t('editUserModal.save', 'Save')}
          </button>
        </div>
        <AnimatePresence>
          {showRemove && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-navy-950/90 backdrop-blur-sm flex items-center justify-center p-6"
              onClick={() => setShowRemove(false)}>
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} onClick={(e) => e.stopPropagation()}
                className="bg-navy-900 border border-accent-red/40 rounded-xl p-5 max-w-sm w-full text-center">
                <div className="w-12 h-12 rounded-full bg-accent-red/15 flex items-center justify-center mx-auto mb-3"><AlertTriangle size={22} className="text-accent-red" /></div>
                <h4 className="text-base font-semibold text-white mb-1">{t('editUserModal.confirmRemoveTitleFmt', { name: user.name, defaultValue: `Remove ${user.name}?` })}</h4>
                <p className="text-xs text-navy-400 mb-4">{t('editUserModal.confirmRemoveBody', 'User will lose all access immediately. Historical actions are kept.')}</p>
                <div className="flex gap-2">
                  <button onClick={() => setShowRemove(false)} className="flex-1 px-4 py-2.5 rounded-lg border border-navy-600 text-navy-300 text-sm hover:bg-navy-800 cursor-pointer">{t('editUserModal.cancel', 'Cancel')}</button>
                  <button onClick={() => onRemove(user.id)} className="flex-1 px-4 py-2.5 rounded-lg bg-accent-red text-white text-sm font-semibold hover:opacity-90 cursor-pointer">{t('editUserModal.confirmRemove', 'Remove')}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Tab: Invitations — token-based onboarding for new users
// ============================================================
function InvitationsTab({ user }) {
  const { t } = useTranslation('admin');
  const [invs, setInvs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invitationsApi.list();
      setInvs(res.items || []);
    } catch (err) {
      setError(err instanceof APIError ? (err.detail || `HTTP ${err.status}`) : err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = async (inv) => {
    try {
      await navigator.clipboard.writeText(inv.acceptUrl);
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // older browsers — fall back to a prompt
      window.prompt(t('invitations.copyManualPrompt', 'Copy the invitation link:'), inv.acceptUrl);
    }
  };

  const handleResend = async (inv) => {
    try {
      await invitationsApi.resend(inv.id);
      await reload();
    } catch (err) {
      alert(t('invitations.resendFailedFmt', { error: err.detail || err.message, defaultValue: `Resend failed: ${err.detail || err.message}` }));
    }
  };

  const handleRevoke = async (inv) => {
    if (!window.confirm(t('invitations.confirmRevokeFmt', { email: inv.email, defaultValue: `Revoke invitation for ${inv.email}? They will not be able to use the link.` }))) return;
    try {
      await invitationsApi.revoke(inv.id);
      await reload();
    } catch (err) {
      alert(t('invitations.revokeFailedFmt', { error: err.detail || err.message, defaultValue: `Revoke failed: ${err.detail || err.message}` }));
    }
  };

  const pending = invs.filter((i) => i.status === 'pending').length;
  const accepted = invs.filter((i) => i.status === 'accepted').length;

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
            <Mail size={16} className="text-accent-blue" />
            {t('invitations.heading', 'Invitations')}
          </h3>
          <p className="text-xs text-navy-400 max-w-xl">
            {user.role === 'site_admin'
              ? t('invitations.subtitleSiteAdmin', "Invite new DSP owners, vendors, or technicians. They get an email with a one-click link to set up their account. If SMTP isn't configured yet, copy the invite link manually from the row below.")
              : user.role === 'vendor_admin'
                ? t('invitations.subtitleVendor', "Invite new admins or technicians for your shop. They get an email with a one-click link to set up their account. If SMTP isn't configured yet, copy the invite link manually from the row below.")
                : t('invitations.subtitleDsp', "Invite new co-owners for your DSP. They get an email with a one-click link to set up their account. If SMTP isn't configured yet, copy the invite link manually from the row below.")}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:opacity-90 cursor-pointer shrink-0">
          <Plus size={14} /> {t('invitations.newInvitation', 'New invitation')}
        </button>
      </div>

      {/* Counts */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <Badge variant="gold">{t('invitations.pendingFmt', { count: pending, defaultValue: `${pending} pending` })}</Badge>
        <Badge variant="green">{t('invitations.acceptedFmt', { count: accepted, defaultValue: `${accepted} accepted` })}</Badge>
        <span className="text-navy-500">{t('invitations.totalFmt', { count: invs.length, defaultValue: `${invs.length} total` })}</span>
      </div>

      {error && (
        <div className="px-3 py-2.5 rounded-lg bg-accent-red/10 border border-accent-red/30 text-xs text-accent-red flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* List */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-navy-400 text-sm">
            <Loader2 size={16} className="animate-spin mr-2" /> {t('invitations.loading', 'Loading…')}
          </div>
        ) : invs.length === 0 ? (
          <div className="text-center py-10 text-navy-400 text-sm">
            {t('invitations.emptyPart1', 'No invitations yet. Click')} <span className="text-accent-blue">{t('invitations.newInvitation', 'New invitation')}</span> {t('invitations.emptyPart2', 'to send one.')}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-navy-950/50">
              <tr className="text-navy-400 text-[10px] uppercase tracking-wide">
                <th className="text-left px-3 py-2 font-semibold">{t('invitations.table.invitee', 'Invitee')}</th>
                <th className="text-left px-3 py-2 font-semibold">{t('invitations.table.role', 'Role')}</th>
                <th className="text-left px-3 py-2 font-semibold">{t('invitations.table.organization', 'Organization')}</th>
                <th className="text-left px-3 py-2 font-semibold">{t('invitations.table.status', 'Status')}</th>
                <th className="text-left px-3 py-2 font-semibold">{t('invitations.table.expires', 'Expires')}</th>
                <th className="text-right px-3 py-2 font-semibold">{t('invitations.table.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {invs.map((inv) => {
                const expired = new Date(inv.expiresAt) < new Date();
                const isPending = inv.status === 'pending' && !expired;
                return (
                  <tr key={inv.id} className="border-t border-navy-800/50 hover:bg-navy-800/30">
                    <td className="px-3 py-2.5">
                      <div className="text-sm text-white">{inv.fullName || '—'}</div>
                      <div className="text-[11px] text-navy-400 font-mono">{inv.email}</div>
                    </td>
                    <td className="px-3 py-2.5 text-navy-200">
                      {t(`roles.${inv.role}`, ROLE_LABELS[inv.role] || inv.role)}
                    </td>
                    <td className="px-3 py-2.5 text-navy-200">
                      {inv.orgName || '—'}
                      {inv.orgId && <div className="text-[10px] text-navy-500 font-mono">{inv.orgId}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={
                        inv.status === 'accepted' ? 'green'
                        : inv.status === 'revoked' ? 'gray'
                        : expired ? 'red' : 'gold'
                      }>
                        {expired && inv.status === 'pending'
                          ? t('invitations.statusBadge.expired', 'expired')
                          : t(`invitations.statusBadge.${inv.status}`, inv.status)}
                      </Badge>
                      {!inv.smtpDelivered && inv.status === 'pending' && (
                        <div className="text-[10px] text-accent-orange mt-0.5">{t('invitations.smtpNotConfigured', 'SMTP not configured — copy link')}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-navy-300 whitespace-nowrap">
                      {new Date(inv.expiresAt).toLocaleDateString(undefined, {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {isPending && (
                          <>
                            <button onClick={() => handleCopy(inv)}
                              title={t('invitations.copyLinkTitle', 'Copy invite link')}
                              className={`p-1.5 rounded ${copiedId === inv.id ? 'bg-accent-green/20 text-accent-green' : 'text-navy-400 hover:text-white hover:bg-navy-800'}`}>
                              {copiedId === inv.id ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                            <button onClick={() => handleResend(inv)}
                              title={t('invitations.resendTitle', 'Re-send email + bump expiry')}
                              className="p-1.5 rounded text-navy-400 hover:text-white hover:bg-navy-800">
                              <RotateCw size={13} />
                            </button>
                            <button onClick={() => handleRevoke(inv)}
                              title={t('invitations.revokeTitle', 'Revoke invitation')}
                              className="p-1.5 rounded text-navy-400 hover:text-accent-red hover:bg-accent-red/10">
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                        {!isPending && inv.status === 'pending' && (
                          // expired but not accepted — allow resend
                          <button onClick={() => handleResend(inv)}
                            title={t('invitations.resendResetTitle', 'Re-send + reset expiry')}
                            className="p-1.5 rounded text-navy-400 hover:text-white hover:bg-navy-800">
                            <RotateCw size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateInvitationModal
          user={user}
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await reload(); }}
        />
      )}
    </div>
  );
}

// Friendly labels for the 9 V2.2 user roles. Mirrors apps/api/app/services/
// permissions.py — keep both files in sync.
const ROLE_LABELS = {
  // DSP
  dsp_owner:      'DSP Owner',
  dsp_manager:    'DSP Manager',
  dsp_inspector:  'DSP Inspector',
  dsp_viewer:     'DSP Viewer',
  // Vendor
  vendor_admin:   'Vendor Admin',
  service_writer: 'Service Writer',
  technician:     'Technician',
  vendor_viewer:  'Vendor Viewer',
  // Platform
  site_admin:     'Site Admin',
};

// Description shown next to each role in the picker so the inviter knows
// what the new user will be able to do.
const ROLE_DESCRIPTIONS = {
  dsp_owner:      'Full admin: billing, users, fleet, inspections, work orders.',
  dsp_manager:    'Manages fleet + WOs. Cannot manage users or billing.',
  dsp_inspector:  'Runs DVIC inspections + reports defects. Read-only on WOs.',
  dsp_viewer:     'Read-only across the DSP.',
  vendor_admin:   'Full admin: billing, users, WO acceptance, technician assignment.',
  service_writer: 'Receives WOs, assigns technicians, talks with the DSP.',
  technician:     'Picks up assigned WOs, marks progress, completes work.',
  vendor_viewer:  'Read-only across the vendor.',
  site_admin:     'Nova Fora team — full system access.',
};

// Mirrors `_INVITE_MATRIX` in apps/api/app/services/permissions.py. Keep
// them aligned — the backend enforces this; the UI just hides what the
// backend would reject.
const INVITE_MATRIX = {
  site_admin: [
    'dsp_owner', 'dsp_manager', 'dsp_inspector', 'dsp_viewer',
    'vendor_admin', 'service_writer', 'technician', 'vendor_viewer',
    'site_admin',
  ],
  dsp_owner:      ['dsp_owner', 'dsp_manager', 'dsp_inspector', 'dsp_viewer'],
  dsp_manager:    ['dsp_inspector', 'dsp_viewer'],
  vendor_admin:   ['vendor_admin', 'service_writer', 'technician', 'vendor_viewer'],
  service_writer: ['technician', 'vendor_viewer'],
  // Inspectors / techs / viewers cannot invite — empty
  dsp_inspector:  [],
  dsp_viewer:     [],
  technician:     [],
  vendor_viewer:  [],
};

// Used for the new-org case (site admin only). Determines the org_type
// when creating a fresh organization based on the role family.
const DSP_ROLES = new Set(['dsp_owner', 'dsp_manager', 'dsp_inspector', 'dsp_viewer']);
const VENDOR_ROLES = new Set(['vendor_admin', 'service_writer', 'technician', 'vendor_viewer']);

function CreateInvitationModal({ user, onClose, onCreated }) {
  const { t } = useTranslation('admin');
  const isSiteAdmin = user?.role === 'site_admin';

  // Pull the allowed targets from the central matrix so a permission change
  // on the backend automatically narrows the picker too.
  const allowedRoles = INVITE_MATRIX[user?.role] || [];
  const roleOptions = allowedRoles
    // Hide site_admin from non-platform inviters even if they somehow appear
    // (defensive — site_admin entries in the matrix are platform-only)
    .filter((r) => r !== 'site_admin' || user?.orgType === 'platform')
    .map((value) => ({
      value,
      label: t(`roles.${value}`, ROLE_LABELS[value] || value),
      desc: t(`roleDescriptions.${value}`, ROLE_DESCRIPTIONS[value] || ''),
    }));

  // Site admins can create new orgs OR add to existing one (theirs).
  // Org owners can only invite to their own org (existing).
  const canCreateNewOrg = isSiteAdmin;

  const [form, setForm] = useState({
    email: '',
    fullName: '',
    role: roleOptions[0]?.value || '',
    target: canCreateNewOrg ? 'new' : 'own',  // 'new' = new org, 'own' = inviter's own org
    orgType: 'dsp',
    orgName: '',
    // Vendor workshop bundle (PR 10): when creating a new vendor org,
    // the admin picks the repair_types the auto-created workshop will
    // handle, plus the status tracking mode. Backend ignores these on
    // non-vendor / existing-org invites; we mirror that with `isVendorNew`.
    vendorRepairTypes: [],                              // ['mechanical', ...]
    vendorStatusTrackingMode: 'external',               // 'external' | 'internal'
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Auto-derive orgType from role family when creating a new org. Keeps the
  // UI honest: pick "DSP Manager" → org_type locks to "dsp".
  useEffect(() => {
    if (form.target === 'new' && form.role) {
      const nextType = DSP_ROLES.has(form.role) ? 'dsp'
              : VENDOR_ROLES.has(form.role) ? 'vendor'
              : form.orgType;
      if (nextType !== form.orgType) setForm((f) => ({ ...f, orgType: nextType }));
    }
  }, [form.role, form.target]);  // eslint-disable-line

  const update = (k, v) => { setForm({ ...form, [k]: v }); if (error) setError(null); };

  // True when we're inviting a vendor *and* creating their org (so the
  // backend will accept vendor_repair_types). On existing-org or DSP
  // invites the workshop fields stay hidden + are stripped at submit time.
  const isVendorNew = form.target === 'new' && form.orgType === 'vendor';

  const toggleRepairType = (rt) => {
    setForm((f) => ({
      ...f,
      vendorRepairTypes: f.vendorRepairTypes.includes(rt)
        ? f.vendorRepairTypes.filter((x) => x !== rt)
        : [...f.vendorRepairTypes, rt],
    }));
    if (error) setError(null);
  };

  const valid = form.email.includes('@')
    && form.role
    && (form.target === 'own' || (form.orgName.trim().length >= 2))
    // Vendor new-org invites must pick at least one repair_type — keeps
    // the demo coherent (every workshop has a routing bucket).
    && (!isVendorNew || form.vendorRepairTypes.length > 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);

    const payload = {
      email: form.email.trim().toLowerCase(),
      fullName: form.fullName.trim() || undefined,
      role: form.role,
    };
    if (form.target === 'own') {
      payload.orgId = parseOrgIntId(user?.orgId);
    } else {
      payload.orgType = form.orgType;
      payload.orgName = form.orgName.trim();
      // Bundle the vendor workshop fields ONLY for vendor new-org invites.
      // (Backend rejects them otherwise via validator.)
      if (form.orgType === 'vendor') {
        payload.vendorRepairTypes = form.vendorRepairTypes;
        payload.vendorStatusTrackingMode = form.vendorStatusTrackingMode;
      }
    }

    try {
      await invitationsApi.create(payload);
      await onCreated();
    } catch (err) {
      const detail = err instanceof APIError ? (err.detail || `HTTP ${err.status}`) : err.message;
      setError(typeof detail === 'string' ? detail : JSON.stringify(detail));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-navy-900 border border-navy-700 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-navy-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send size={16} className="text-accent-blue" />
            <h3 className="text-sm font-semibold text-white">{t('createInvitationModal.title', 'New invitation')}</h3>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-1 -mr-1"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/30 text-xs text-accent-red flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}

          <Field label={t('createInvitationModal.roleLabel', 'Role *')}>
            {roleOptions.length === 0 ? (
              <div className="px-3 py-2.5 rounded-md bg-navy-800 border border-navy-700 text-xs text-navy-400">
                {t('createInvitationModal.noPermission', "Your role doesn't have permission to invite anyone.")}
              </div>
            ) : (
              <>
                <select value={form.role} onChange={(e) => update('role', e.target.value)}
                  className="w-full px-3 py-2.5 rounded-md bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue text-sm cursor-pointer">
                  {roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {form.role && (
                  <p className="text-[11px] text-navy-400 mt-1.5 leading-snug">
                    {t(`roleDescriptions.${form.role}`, ROLE_DESCRIPTIONS[form.role])}
                  </p>
                )}
              </>
            )}
          </Field>

          <Field label={t('createInvitationModal.emailLabel', 'Email *')}>
            <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)}
              placeholder="ana@example.com"
              className="w-full px-3 py-2.5 rounded-md bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue text-sm" required />
          </Field>

          <Field label={t('createInvitationModal.fullNameLabel', 'Their name (optional)')}>
            <input type="text" value={form.fullName} onChange={(e) => update('fullName', e.target.value)}
              placeholder="Ana López"
              className="w-full px-3 py-2.5 rounded-md bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue text-sm" />
          </Field>

          {/* New-org vs own-org picker (site admin only) */}
          {canCreateNewOrg && (
            <Field label={t('createInvitationModal.organizationLabel', 'Organization')}>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className={`flex items-center justify-center px-3 py-2.5 rounded-md border cursor-pointer ${
                  form.target === 'new' ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-navy-700 bg-navy-800 text-navy-300'
                }`}>
                  <input type="radio" name="target" value="new" checked={form.target === 'new'}
                    onChange={(e) => update('target', e.target.value)} className="hidden" />
                  {t('createInvitationModal.createNewOrg', 'Create new org')}
                </label>
                <label className={`flex items-center justify-center px-3 py-2.5 rounded-md border cursor-pointer ${
                  form.target === 'own' ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-navy-700 bg-navy-800 text-navy-300'
                }`}>
                  <input type="radio" name="target" value="own" checked={form.target === 'own'}
                    onChange={(e) => update('target', e.target.value)} className="hidden" />
                  {t('createInvitationModal.addToOrgFmt', { org: user.org, defaultValue: `Add to ${user.org}` })}
                </label>
              </div>
            </Field>
          )}

          {form.target === 'new' && (
            <>
              <Field label={t('createInvitationModal.orgTypeLabel', 'Organization type *')}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[{ v: 'dsp', l: t('createInvitationModal.orgType.dsp', 'DSP') }, { v: 'vendor', l: t('createInvitationModal.orgType.vendor', 'Vendor') }].map((opt) => (
                    <label key={opt.v} className={`flex items-center justify-center px-3 py-2.5 rounded-md border cursor-pointer ${
                      form.orgType === opt.v ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-navy-700 bg-navy-800 text-navy-300'
                    }`}>
                      <input type="radio" name="orgType" value={opt.v} checked={form.orgType === opt.v}
                        onChange={(e) => update('orgType', e.target.value)} className="hidden" />
                      {opt.l}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label={t('createInvitationModal.orgNameLabel', 'Organization name *')}>
                <input type="text" value={form.orgName} onChange={(e) => update('orgName', e.target.value)}
                  placeholder={form.orgType === 'dsp' ? t('createInvitationModal.orgNamePlaceholderDsp', 'Sunshine Logistics LLC') : t('createInvitationModal.orgNamePlaceholderVendor', 'Carlos Auto Repair')}
                  className="w-full px-3 py-2.5 rounded-md bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue text-sm" required />
              </Field>

              {/* Vendor workshop bundle — only when org_type=vendor. The
                  backend auto-creates a VendorWorkshop with these settings
                  on accept, so the new vendor is immediately routable. */}
              {isVendorNew && (
                <>
                  <Field label={t('createInvitationModal.repairTypesLabel', 'Repair types *')}>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { v: 'mechanical', l: t('createInvitationModal.repairType.mechanical', 'Mechanical') },
                        { v: 'body',       l: t('createInvitationModal.repairType.body', 'Body') },
                        { v: 'tires',      l: t('createInvitationModal.repairType.tires', 'Tires') },
                        { v: 'pm',         l: t('createInvitationModal.repairType.pm', 'PM') },
                        { v: 'cnmr',       l: t('createInvitationModal.repairType.cnmr', 'CNMR') },
                        { v: 'detailing',  l: t('createInvitationModal.repairType.detailing', 'Detailing') },
                        { v: 'netradyne',  l: t('createInvitationModal.repairType.netradyne', 'Netradyne') },
                      ].map((opt) => {
                        const checked = form.vendorRepairTypes.includes(opt.v);
                        return (
                          <label key={opt.v} className={`flex items-center gap-2 px-2.5 py-2 rounded-md border text-xs cursor-pointer ${
                            checked ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-navy-700 bg-navy-800 text-navy-300'
                          }`}>
                            <input type="checkbox" checked={checked}
                              onChange={() => toggleRepairType(opt.v)}
                              className="accent-accent-blue cursor-pointer" />
                            {opt.l}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-navy-400 mt-1.5 leading-snug">
                      {t('createInvitationModal.repairTypesHint',
                        'Pick all the work this shop handles. The router uses this to place defects automatically.')}
                    </p>
                  </Field>

                  <Field label={t('createInvitationModal.statusTrackingLabel', 'Status tracking mode')}>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { v: 'external', l: t('createInvitationModal.tracking.external', 'External') },
                        { v: 'internal', l: t('createInvitationModal.tracking.internal', 'Internal') },
                      ].map((opt) => (
                        <label key={opt.v} className={`flex items-center justify-center px-3 py-2.5 rounded-md border cursor-pointer ${
                          form.vendorStatusTrackingMode === opt.v ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-navy-700 bg-navy-800 text-navy-300'
                        }`}>
                          <input type="radio" name="vendorStatusTrackingMode" value={opt.v}
                            checked={form.vendorStatusTrackingMode === opt.v}
                            onChange={(e) => update('vendorStatusTrackingMode', e.target.value)} className="hidden" />
                          {opt.l}
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-navy-400 mt-1.5 leading-snug">
                      {form.vendorStatusTrackingMode === 'external'
                        ? t('createInvitationModal.trackingHintExternal',
                            'External: shop syncs status from its own RO Writer (Midas, etc.). Requires an RO# at WO acceptance.')
                        : t('createInvitationModal.trackingHintInternal',
                            'Internal: shop manages the WO inside Nova Fora.')}
                    </p>
                  </Field>
                </>
              )}
            </>
          )}

          {form.target === 'own' && (
            <div className="px-3 py-2 rounded-lg bg-navy-800/60 border border-navy-700 text-xs text-navy-300">
              {t('createInvitationModal.willBeAddedPart1', 'Will be added to')} <strong className="text-white">{user.org}</strong>.
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-md text-xs font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">
              {t('createInvitationModal.cancel', 'Cancel')}
            </button>
            <button type="submit" disabled={!valid || submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-blue text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
              {submitting ? <><Loader2 size={12} className="animate-spin" /> {t('createInvitationModal.sending', 'Sending…')}</> : <><Send size={12} /> {t('createInvitationModal.sendInvitation', 'Send invitation')}</>}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

// Strip "DSP-0001" / "V-001" / "NF-001" → 1
function parseOrgIntId(orgId) {
  if (typeof orgId === 'number') return orgId;
  const m = String(orgId || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}


// ============================================================
// Tab: Security
// ============================================================
function SecurityTab({ user }) {
  const { t } = useTranslation('admin');
  const [show2FA, setShow2FA] = useState(false);
  const [twoFAEnabled, setTwoFAEnabled] = useState(user.role === 'dsp_owner' || user.role === 'vendor_admin');
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [showCurrent, setShowCurrent] = useState(false);

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Change password */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-accent-blue/15 flex items-center justify-center"><Key size={18} className="text-accent-blue" /></div>
          <div>
            <h3 className="text-base font-semibold text-white">{t('security.changePassword.title', 'Change password')}</h3>
            <p className="text-[11px] text-navy-400">{t('security.changePassword.subtitle', 'Use at least 12 characters, mix of letters and numbers')}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('security.changePassword.current', 'Current password')}</label>
            <div className="relative">
              <input type={showCurrent ? 'text' : 'password'} value={passwordForm.current} onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                className="w-full rounded-lg pl-3 pr-10 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
              <button onClick={() => setShowCurrent(!showCurrent)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-navy-400 hover:text-white cursor-pointer">
                {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('security.changePassword.next', 'New password')}</label>
            <input type="password" value={passwordForm.next} onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('security.changePassword.confirm', 'Confirm new password')}</label>
            <input type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
          </div>
          <button className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:opacity-90 cursor-pointer">
            <Check size={14} /> {t('security.changePassword.update', 'Update Password')}
          </button>
        </div>
      </div>

      {/* Two-factor auth */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${twoFAEnabled ? 'bg-accent-green/15' : 'bg-navy-800'}`}>
              {twoFAEnabled ? <Lock size={18} className="text-accent-green" /> : <Unlock size={18} className="text-navy-400" />}
            </div>
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                {t('security.twoFA.title', 'Two-factor authentication')}
                {twoFAEnabled && <Badge variant="green">{t('security.twoFA.enabledBadge', 'Enabled')}</Badge>}
              </h3>
              <p className="text-[11px] text-navy-400">{t('security.twoFA.subtitle', 'Add an extra layer of security with TOTP (Google Authenticator, Authy, 1Password)')}</p>
            </div>
          </div>
        </div>
        {twoFAEnabled ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setTwoFAEnabled(false)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-accent-red/40 bg-accent-red/10 text-accent-red text-sm font-semibold hover:bg-accent-red/20 cursor-pointer">
              <Unlock size={14} /> {t('security.twoFA.disable', 'Disable 2FA')}
            </button>
            <span className="text-[11px] text-navy-400">{t('security.twoFA.backupHint', 'Backup codes available in account')}</span>
          </div>
        ) : (
          <button onClick={() => setShow2FA(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-green text-white text-sm font-semibold hover:opacity-90 cursor-pointer">
            <Smartphone size={14} /> {t('security.twoFA.enable', 'Enable 2FA')}
          </button>
        )}
      </div>

      {/* Active sessions */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-accent-gold/15 flex items-center justify-center"><Clock size={18} className="text-accent-gold" /></div>
          <div>
            <h3 className="text-base font-semibold text-white">{t('security.sessions.title', 'Active sessions')}</h3>
            <p className="text-[11px] text-navy-400">{t('security.sessions.subtitle', 'Devices currently signed in to your account')}</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 rounded-lg bg-accent-green/5 border border-accent-green/30">
            <div><div className="text-sm font-semibold text-white">Chrome on Windows <Badge variant="green">{t('security.sessions.currentBadge', 'Current')}</Badge></div><div className="text-[11px] text-navy-400">Seattle, WA · {t('security.sessions.activeNow', 'Active now')}</div></div>
            <Check size={14} className="text-accent-green" />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-navy-800/40 border border-navy-700/40">
            <div><div className="text-sm font-semibold text-white">Safari on iPhone</div><div className="text-[11px] text-navy-400">Seattle, WA · {t('security.sessions.hoursAgoFmt', { count: 2, defaultValue: '2 hours ago' })}</div></div>
            <button className="text-[11px] text-accent-red hover:underline">{t('security.sessions.signOut', 'Sign out')}</button>
          </div>
        </div>
        <button className="mt-3 text-sm text-accent-red hover:underline">{t('security.sessions.signOutAllOthers', 'Sign out of all other devices')}</button>
      </div>

      <AnimatePresence>
        {show2FA && <Setup2FAModal onClose={() => setShow2FA(false)} onEnable={() => { setTwoFAEnabled(true); setShow2FA(false); }} />}
      </AnimatePresence>
    </div>
  );
}

function Setup2FAModal({ onClose, onEnable }) {
  const { t } = useTranslation('admin');
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const secretKey = 'ABCD EFGH IJKL MNOP QRST UVWX';
  const [copied, setCopied] = useState(false);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-green/15 flex items-center justify-center"><Smartphone size={16} className="text-accent-green" /></div>
            <div><h3 className="text-base font-semibold text-white">{t('setup2FA.title', 'Enable 2FA')}</h3><p className="text-[11px] text-navy-400">{t('setup2FA.stepFmt', { step, defaultValue: `Step ${step} of 2` })}</p></div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1">
          {step === 1 ? (
            <div className="space-y-4">
              <div className="text-sm text-navy-200">{t('setup2FA.step1Intro', 'Scan this QR code with your authenticator app, or enter the secret key manually.')}</div>
              <div className="bg-white rounded-xl p-5 mx-auto w-fit">
                <div className="w-40 h-40 grid grid-cols-8 grid-rows-8 gap-0.5">
                  {Array.from({ length: 64 }).map((_, i) => (
                    <div key={i} className={`${Math.random() > 0.5 ? 'bg-black' : 'bg-white'}`} />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-navy-400 mb-1">{t('setup2FA.manualKeyHint', 'Or enter this secret key manually:')}</div>
                <div className="flex items-center gap-2 rounded-lg bg-navy-800 border border-navy-700 px-3 py-2.5">
                  <span className="flex-1 text-sm font-mono text-white tracking-wider">{secretKey}</span>
                  <button onClick={() => { navigator.clipboard?.writeText(secretKey.replace(/ /g, '')); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                    className="text-accent-blue text-xs font-semibold hover:underline">
                    {copied ? <><Check size={12} className="inline mr-0.5" /> {t('setup2FA.copied', 'Copied')}</> : <><Copy size={12} className="inline mr-0.5" /> {t('setup2FA.copy', 'Copy')}</>}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-navy-200">{t('setup2FA.step2Intro', 'Enter the 6-digit code from your authenticator app:')}</div>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" inputMode="numeric" maxLength={6}
                className="w-full rounded-lg px-4 py-4 text-2xl font-mono text-center tracking-widest bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green" autoFocus />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={step === 1 ? onClose : () => setStep(1)} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">
            {step === 1 ? t('setup2FA.cancel', 'Cancel') : t('setup2FA.back', 'Back')}
          </button>
          <button onClick={step === 1 ? () => setStep(2) : onEnable} disabled={step === 2 && code.length !== 6}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {step === 1 ? <>{t('setup2FA.next', 'Next')} <ChevronRight size={14} /></> : <>{t('setup2FA.enable', 'Enable 2FA')} <Check size={14} /></>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Account Manager contact card shown on the Organization tab — gives the
// customer a direct line to their Nova Fora rep (Ask a question / Schedule time).
function AccountManagerCard() {
  const { t } = useTranslation('admin');
  const am = {
    name: 'Jorge Escalona',
    title: 'Account Manager',
    email: 'jorge@novafora.com',
    schedulingUrl: 'https://cal.com/nova-fora/jorge',
  };
  return (
    <div className="lg:col-span-1 bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center font-bold text-white shrink-0">
          {am.name.split(' ').map((p) => p[0]).join('')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-white truncate">{am.name}</div>
          <div className="text-[11px] text-navy-400">Account Manager</div>
        </div>
      </div>
      <div className="pt-3 border-t border-navy-800 space-y-3">
        <a href={`mailto:${am.email}?subject=Question%20from%20a%20Nova%20Fora%20customer`}
          className="flex items-center justify-between gap-2 text-sm text-white hover:text-accent-blue group">
          <span className="flex items-center gap-2">
            <MessageSquare size={14} className="text-accent-blue" />
            <span className="underline decoration-navy-600 underline-offset-4 group-hover:decoration-accent-blue">{t('accountManager.askQuestion', 'Ask a question')}</span>
          </span>
          <ExternalLink size={12} className="text-navy-500 group-hover:text-accent-blue" />
        </a>
        <a href={am.schedulingUrl} target="_blank" rel="noreferrer"
          className="flex items-center justify-between gap-2 text-sm text-white hover:text-accent-blue group">
          <span className="flex items-center gap-2">
            <Calendar size={14} className="text-accent-blue" />
            <span className="underline decoration-navy-600 underline-offset-4 group-hover:decoration-accent-blue">{t('accountManager.scheduleTime', 'Schedule time with me!')}</span>
          </span>
          <ExternalLink size={12} className="text-navy-500 group-hover:text-accent-blue" />
        </a>
      </div>
    </div>
  );
}

// ============================================================
// Tab: Organization
// ============================================================
function OrganizationTab({ user }) {
  // 2026-06-05 Jorge — the SMS + key drop + preferred-vendors blocks
  // below are DSP-side coordination tools (telling vendors when keys
  // are ready, where to drop them, who to route AMR work to). A body
  // repair vendor org has none of those concerns. Skip the block list
  // entirely for them — only the Business details card + Account
  // Manager surface stays visible.
  const isBodyRepairVendor = user?.orgType === 'body_repair_vendor';
  const { t } = useTranslation('admin');
  const isDsp = user.role === 'dsp_owner';
  const isVendor = user.role === 'vendor_admin';
  const [form, setForm] = useState({
    name: user.org,
    phone: '(206) 555-0142',
    smsPhone: '(206) 555-0142',
    address: isDsp ? '13420 NE 20th St, Bellevue WA 98005' : '2200 Alaskan Way, Seattle WA 98121',
    lotLocation: 'Back lot, Gate B · 4827',
    inspectionImpossibleSMS: true,
    eveningReminder: true,
    eveningReminderTime: '19:00',
    keyReturnInfo: true,
    keyReturnText: 'Front office lockbox, code 4827. Drop keys in the blue bin after hours.',
    preferredVendors: true,
    preferredVendorSelections: { AMR: 'ProFleet Auto Care', Body: 'Evergreen Body Works', Detailing: 'Spotless Mobile Detail', 'Flex Fleet': 'Flex Fleet West' },
    slackIntegration: false,
    slackChannel: '#fleet-ops',
    servicesOffered: isVendor ? ['mechanical', 'electrical', 'body', 'windshield', 'pm'] : [],
  });

  const toggleService = (s) => setForm({ ...form, servicesOffered: form.servicesOffered.includes(s) ? form.servicesOffered.filter((x) => x !== s) : [...form.servicesOffered, s] });

  return (
    <div className="space-y-4">
      {/* Top row: Business details (2/3) + Account Manager card (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Business details */}
        <div className="lg:col-span-2 bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-accent-blue/15 flex items-center justify-center"><Building2 size={18} className="text-accent-blue" /></div>
            <div><h3 className="text-base font-semibold text-white">{t('organization.businessDetails.title', 'Business details')}</h3><p className="text-[11px] text-navy-400">{t('organization.businessDetails.subtitle', 'Shown to partners and on invoices')}</p></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('organization.businessDetails.orgName', 'Organization name')}</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
            <div><label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('organization.businessDetails.phone', 'Business phone')}</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
            <div><label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('organization.businessDetails.smsPhone', 'SMS phone')}</label><input value={form.smsPhone} onChange={(e) => setForm({ ...form, smsPhone: e.target.value })} className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
            <div><label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('organization.businessDetails.lotLocation', 'Default lot location')}</label><input value={form.lotLocation} onChange={(e) => setForm({ ...form, lotLocation: e.target.value })} className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
            <div className="sm:col-span-2"><label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('organization.businessDetails.address', 'Business address')}</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
          </div>
        </div>

        {/* Account Manager card */}
        <AccountManagerCard />
      </div>

      {/* DSP-side coordination blocks — hidden for body repair vendors.
          See OrganizationTab() header comment for why. */}
      {!isBodyRepairVendor && (
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.inspectionImpossibleSMS} onChange={() => setForm({ ...form, inspectionImpossibleSMS: !form.inspectionImpossibleSMS })} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><MessageSquare size={14} className="text-accent-blue" /><span className="text-sm font-semibold text-white">{t('organization.smsOptIn.title', 'Inspection Impossible SMS')}</span></div>
            <div className="text-[11px] text-navy-400">{t('organization.smsOptIn.subtitle', 'Notify via SMS when an inspector cannot complete an inspection (keys missing, vehicle not found, etc.)')}</div>
          </div>
        </label>
      </div>
      )}

      {/* Evening reminder text */}
      {!isBodyRepairVendor && (
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.eveningReminder} onChange={() => setForm({ ...form, eveningReminder: !form.eveningReminder })} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Clock size={14} className="text-accent-blue" />
              <span className="text-sm font-semibold text-white">{t('organization.eveningReminder.title', 'Set evening reminder text for keys and/or scheduled repairs')}</span>
            </div>
            <div className="text-[11px] text-accent-orange font-semibold">{t('organization.eveningReminder.warning', 'Vendors will not dispatch without confirmation of readiness')}</div>
            <AnimatePresence initial={false}>
              {form.eveningReminder && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-navy-400">{t('organization.eveningReminder.sendAt', 'Send at')}</span>
                    <input type="time" value={form.eveningReminderTime} onChange={(e) => setForm({ ...form, eveningReminderTime: e.target.value })}
                      className="rounded-lg px-3 py-1.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                    <span className="text-[11px] text-navy-400">{t('organization.eveningReminder.toSmsPhone', 'to the DSP SMS phone')}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </label>
      </div>
      )}

      {/* Key return info */}
      {!isBodyRepairVendor && (
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.keyReturnInfo} onChange={() => setForm({ ...form, keyReturnInfo: !form.keyReturnInfo })} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><Key size={14} className="text-accent-gold" /><span className="text-sm font-semibold text-white">{t('organization.keyReturn.title', 'Key(s) return time, location, lockbox code, etc.')}</span></div>
            <div className="text-[11px] text-navy-400">{t('organization.keyReturn.subtitle', 'Shared with vendors so drivers know where to drop keys after overnight repairs')}</div>
            <AnimatePresence initial={false}>
              {form.keyReturnInfo && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-3">
                  <textarea value={form.keyReturnText} onChange={(e) => setForm({ ...form, keyReturnText: e.target.value })} rows={2}
                    placeholder={t('organization.keyReturn.placeholder', 'e.g. Front office lockbox, code 4827. Drop keys in the blue bin after hours.')}
                    className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-gold resize-none" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </label>
      </div>
      )}

      {/* Preferred Vendors */}
      {!isBodyRepairVendor && (
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.preferredVendors} onChange={() => setForm({ ...form, preferredVendors: !form.preferredVendors })} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><Building2 size={14} className="text-accent-purple" /><span className="text-sm font-semibold text-white">{t('organization.preferredVendors.title', 'Preferred Vendors (AMR, Body, Detailing, and Flex Fleet)')}</span></div>
            <div className="text-[11px] text-navy-400">{t('organization.preferredVendors.subtitle', 'Auto-route work orders to your preferred vendor for each category')}</div>
            <AnimatePresence initial={false}>
              {form.preferredVendors && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {['AMR', 'Body', 'Detailing', 'Flex Fleet'].map((cat) => (
                      <div key={cat}>
                        <label className="text-[10px] font-semibold text-navy-300 mb-1 block uppercase tracking-wide">{cat}</label>
                        <input value={form.preferredVendorSelections[cat] || ''} onChange={(e) => setForm({ ...form, preferredVendorSelections: { ...form.preferredVendorSelections, [cat]: e.target.value } })}
                          className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-purple" />
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </label>
      </div>
      )}

      {/* Slack Integration */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.slackIntegration} onChange={() => setForm({ ...form, slackIntegration: !form.slackIntegration })} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><MessageSquare size={14} className="text-accent-green" /><span className="text-sm font-semibold text-white">{t('organization.slack.title', 'Slack Integration')}</span></div>
            <div className="text-[11px] text-navy-400">{t('organization.slack.subtitle', 'Mirror priority alerts (Rush Orders, Grounded Vehicles, Completions) into a Slack channel')}</div>
            <AnimatePresence initial={false}>
              {form.slackIntegration && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-navy-400 shrink-0">{t('organization.slack.channelLabel', 'Channel')}</label>
                    <input value={form.slackChannel} onChange={(e) => setForm({ ...form, slackChannel: e.target.value })} placeholder="#fleet-ops"
                      className="flex-1 rounded-lg px-3 py-1.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green font-mono" />
                  </div>
                  <button className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent-green/15 border border-accent-green/40 text-accent-green text-xs font-semibold hover:bg-accent-green/25 cursor-pointer">
                    <Check size={12} /> {t('organization.slack.connectButton', 'Connect Slack workspace')}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </label>
      </div>

      {/* Vendor services (vendor only) */}
      {isVendor && (
        <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-accent-purple/15 flex items-center justify-center"><WrenchIcon size={18} className="text-accent-purple" /></div>
            <div><h3 className="text-base font-semibold text-white">{t('organization.vendorServices.title', 'Services offered')}</h3><p className="text-[11px] text-navy-400">{t('organization.vendorServices.subtitle', 'DSPs match to vendors based on these capabilities')}</p></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {VENDOR_SERVICES.map((s) => {
              const active = form.servicesOffered.includes(s.id);
              return (
                <button key={s.id} onClick={() => toggleService(s.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-all cursor-pointer min-h-[48px] ${
                    active ? 'bg-accent-purple/15 border-accent-purple/50 text-white' : 'bg-navy-800/40 border-navy-700 text-navy-300 hover:border-navy-600'
                  }`}>
                  <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${active ? 'bg-accent-purple border-accent-purple' : 'border-navy-600'}`}>
                    {active && <Check size={12} className="text-white" />}
                  </div>
                  <span className="text-xs font-semibold">{s.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] text-navy-400">
            {t('organization.vendorServices.selectedCountFmt', { count: form.servicesOffered.length, defaultValue: `${form.servicesOffered.length} service${form.servicesOffered.length !== 1 ? 's' : ''} selected` })}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:opacity-90 cursor-pointer">
          <Check size={14} /> {t('organization.saveChanges', 'Save Changes')}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Tab: Preventive Maintenance
// ============================================================
function PMTab({ user }) {
  const { t } = useTranslation('admin');
  const isDsp = user.role === 'dsp_owner';
  const jobs = isDsp ? preventiveMaintenanceJobs.filter((j) => j.dspId === user.orgId) : preventiveMaintenanceJobs;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StatBox label={t('pm.stat.upcoming', 'Upcoming')} value={jobs.filter((j) => j.status === 'upcoming').length} color="text-accent-gold" />
        <StatBox label={t('pm.stat.scheduled', 'Scheduled')} value={jobs.filter((j) => j.status === 'scheduled').length} color="text-accent-blue" />
        <StatBox label={t('pm.stat.total', 'Total')} value={jobs.length} color="text-white" />
      </div>

      {/* Two-column: Upcoming PMs (left) + PM Intervals by Vehicle Type (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Upcoming PMs */}
        <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-800 bg-navy-950/40 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{t('pm.upcomingPMs', 'Upcoming PMs')}</h3>
            <button className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-green text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
              <Plus size={12} /> {t('pm.schedulePM', 'Schedule PM')}
            </button>
          </div>
          <div className="divide-y divide-navy-800/60 max-h-[560px] overflow-y-auto">
            {jobs.map((j) => {
              const progressPct = j.triggerType === 'mileage' && j.currentValue
                ? Math.round((j.currentValue / j.triggerAt) * 100)
                : null;
              const daysUntil = j.dueAt ? Math.ceil((new Date(j.dueAt) - new Date()) / (1000 * 60 * 60 * 24)) : null;
              return (
                <div key={j.id} className="px-4 py-3 hover:bg-navy-800/40 transition-colors">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-semibold text-white">{j.type}</span>
                        <Badge variant="gray">{j.vehicleId}</Badge>
                        <Badge variant={j.status === 'upcoming' ? 'gold' : 'blue'}>{j.status === 'upcoming' ? t('pm.statusBadge.upcoming', 'Upcoming') : t('pm.statusBadge.scheduled', 'Scheduled')}</Badge>
                      </div>
                      <div className="text-[11px] text-navy-400">{t('pm.vendorLabel', 'Vendor:')} <span className="text-white">{j.vendor}</span></div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-navy-400">{t('pm.dueLabel', 'Due')}</div>
                      <div className="text-xs text-white font-semibold">{j.dueAt}</div>
                      {daysUntil !== null && <div className={`text-[10px] ${daysUntil <= 3 ? 'text-accent-red' : daysUntil <= 7 ? 'text-accent-gold' : 'text-navy-500'}`}>{t('pm.daysFmt', { count: daysUntil, defaultValue: `${daysUntil} days` })}</div>}
                    </div>
                  </div>
                  {progressPct !== null && (
                    <div>
                      <div className="flex justify-between text-[10px] text-navy-400 mb-1">
                        <span>{j.currentValue?.toLocaleString()} {t('pm.milesShort', 'mi')}</span>
                        <span>{t('pm.triggerFmt', { miles: j.triggerAt.toLocaleString(), defaultValue: `Trigger: ${j.triggerAt.toLocaleString()} mi` })}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-navy-800 overflow-hidden">
                        <motion.div className={`h-full rounded-full ${progressPct >= 95 ? 'bg-accent-red' : progressPct >= 85 ? 'bg-accent-orange' : 'bg-accent-green'}`}
                          initial={{ width: 0 }} animate={{ width: `${Math.min(progressPct, 100)}%` }} transition={{ duration: 0.8 }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {jobs.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-navy-400">{t('pm.noPMs', 'No PM jobs scheduled.')}</div>
            )}
          </div>
        </div>

        {/* RIGHT: PM Intervals by Vehicle Type */}
        <PMIntervalsPanel />
      </div>
    </div>
  );
}

// ============================================================
// PM Intervals by Vehicle Type — editable except for Branded
// ============================================================
function PMIntervalsPanel() {
  const { t } = useTranslation('admin');
  // Local editable copy so the customer can tweak non-branded intervals in demo
  const [groups, setGroups] = useState(() =>
    pmIntervalsByVehicleType.map((g) => ({ ...g, intervals: g.intervals.map((i) => ({ ...i, milesList: i.milesList ? [...i.milesList] : undefined })) }))
  );
  const [editingGroup, setEditingGroup] = useState(null);

  const saveInterval = (typeIdx, intervalId, patch) => {
    setGroups((prev) => prev.map((g, i) => {
      if (i !== typeIdx) return g;
      return { ...g, intervals: g.intervals.map((it) => (it.id === intervalId ? { ...it, ...patch } : it)) };
    }));
  };

  return (
    <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-navy-800 bg-navy-950/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge size={14} className="text-accent-blue" />
          <h3 className="text-sm font-semibold text-white">{t('pm.intervals.title', 'PM Intervals by Vehicle Type')}</h3>
        </div>
        <span className="text-[11px] text-navy-400">{t('pm.intervals.typesCountFmt', { count: groups.length, defaultValue: `${groups.length} types` })}</span>
      </div>
      <div className="divide-y divide-navy-800/60 max-h-[560px] overflow-y-auto">
        {groups.map((g, typeIdx) => {
          const isEditing = editingGroup === g.type;
          return (
            <div key={g.type} className="px-4 py-3">
              {/* Type header */}
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant={g.type === 'Rental' ? 'purple' : g.type === 'Owned' ? 'blue' : g.type === 'Step Van' ? 'gold' : 'gray'} size="md">{g.type}</Badge>
                  {g.locked ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-navy-400">
                      <Lock size={10} /> {t('pm.intervals.readOnly', 'Read-only')}
                    </span>
                  ) : (
                    <span className="text-[10px] text-navy-500">{t('pm.intervals.intervalsCountFmt', { count: g.intervals.length, defaultValue: `${g.intervals.length} intervals` })}</span>
                  )}
                </div>
                {!g.locked && (
                  <button
                    onClick={() => setEditingGroup(isEditing ? null : g.type)}
                    className={`text-[11px] font-semibold cursor-pointer ${isEditing ? 'text-accent-green' : 'text-accent-blue hover:underline'}`}>
                    {isEditing ? <><Check size={11} className="inline mr-0.5" /> {t('pm.intervals.done', 'Done')}</> : <><Edit3 size={10} className="inline mr-0.5" /> {t('pm.intervals.edit', 'Edit intervals')}</>}
                  </button>
                )}
              </div>

              {g.locked && g.lockReason && (
                <div className="flex items-start gap-1.5 text-[10px] text-navy-400 mb-2 italic">
                  <Info size={10} className="text-navy-500 mt-0.5 shrink-0" />
                  {g.lockReason}
                </div>
              )}

              {/* Interval rows */}
              <div className="space-y-1">
                {g.intervals.map((i) => (
                  <IntervalRow key={i.id} interval={i} editable={!g.locked && isEditing}
                    onChange={(patch) => saveInterval(typeIdx, i.id, patch)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IntervalRow({ interval, editable, onChange }) {
  const { t } = useTranslation('admin');
  const [localMiles, setLocalMiles] = useState(interval.miles ?? interval.milesList?.join(', ') ?? '');

  const handleSave = () => {
    if (interval.mode === 'every') {
      const n = parseInt(localMiles.toString().replace(/,/g, ''), 10);
      if (!isNaN(n)) onChange({ miles: n });
    } else if (interval.mode === 'at') {
      const list = localMiles.toString().split(',').map((s) => parseInt(s.trim().replace(/,/g, ''), 10)).filter((n) => !isNaN(n));
      if (list.length > 0) onChange({ milesList: list });
    }
  };

  const displayValue = interval.mode === 'every'
    ? t('pm.intervals.dueEveryFmt', { miles: interval.miles?.toLocaleString(), defaultValue: `Due every ${interval.miles?.toLocaleString()} miles` })
    : t('pm.intervals.dueAtFmt', { list: interval.milesList?.map((n) => n.toLocaleString()).join('; '), defaultValue: `Due at ${interval.milesList?.map((n) => n.toLocaleString()).join('; ')} miles` });

  return (
    <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs ${
      editable ? 'bg-navy-800/60 border border-navy-700' : 'hover:bg-navy-800/30'
    }`}>
      <span className="text-white truncate">{interval.service}</span>
      {editable ? (
        <div className="flex items-center gap-1 shrink-0">
          {interval.mode === 'every' ? <span className="text-[10px] text-navy-400">{t('pm.intervals.everyLabel', 'every')}</span> : <span className="text-[10px] text-navy-400">{t('pm.intervals.atLabel', 'at')}</span>}
          <input value={localMiles} onChange={(e) => setLocalMiles(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            className="w-24 text-right rounded-md px-2 py-0.5 text-xs font-mono bg-navy-900 border border-navy-700 text-white outline-none focus:border-accent-blue" />
          <span className="text-[10px] text-navy-400">{t('pm.milesShort', 'mi')}</span>
        </div>
      ) : (
        <span className="text-navy-300 text-right truncate">{displayValue}</span>
      )}
    </div>
  );
}

// ============================================================
// DVIC Defect Catalog — inspection items per vehicle template
// (Amazon items read-only; DSP/Vendor custom items added by the customer
// but Group/Class/Line/Response Type are filled by DFS admins)
// ============================================================
const SOURCE_VARIANT = {
  Amazon: { bg: 'bg-accent-gold/15',   border: 'border-accent-gold/40',   text: 'text-accent-gold'   },
  DSP:    { bg: 'bg-accent-blue/15',   border: 'border-accent-blue/40',   text: 'text-accent-blue'   },
  Vendor: { bg: 'bg-accent-purple/15', border: 'border-accent-purple/40', text: 'text-accent-purple' },
};

function DvicDefectCatalog() {
  const { t } = useTranslation('admin');
  // Active vehicle_class tab. Defaults to the most common one (Branded Cargo Van).
  const [activeTemplate, setActiveTemplate] = useState('regular_cargo_van');
  // Cache of fetched rules per vehicle_class so flipping tabs doesn't re-fetch.
  const [rulesByClass, setRulesByClass] = useState({});
  const [loadingClass, setLoadingClass] = useState(null);
  const [errorByClass, setErrorByClass] = useState({});
  const [showAddDefect, setShowAddDefect] = useState(false);

  // Fetch rules for a vehicle_class. Cached in `rulesByClass`. The first
  // tab loads on mount; switching tabs triggers a fresh fetch only if not
  // already cached. After creating a custom rule we invalidate the cache
  // for every vehicle_class the rule touched so the UI refreshes.
  const fetchRulesFor = useCallback(async (vc, { force = false } = {}) => {
    if (!force && rulesByClass[vc] !== undefined) return;
    setLoadingClass(vc);
    setErrorByClass((m) => { const n = { ...m }; delete n[vc]; return n; });
    try {
      const res = await inspectionRulesApi.list({ vehicleClass: vc });
      setRulesByClass((cur) => ({ ...cur, [vc]: res.rules || [] }));
    } catch (err) {
      const msg = err instanceof APIError ? (err.detail || 'Load failed') : (err.message || 'Network error');
      setErrorByClass((m) => ({ ...m, [vc]: typeof msg === 'string' ? msg : 'Load failed' }));
    } finally {
      setLoadingClass((c) => (c === vc ? null : c));
    }
  }, [rulesByClass]);

  useEffect(() => { fetchRulesFor(activeTemplate); }, [activeTemplate, fetchRulesFor]);

  const currentItems = rulesByClass[activeTemplate] || [];
  const isLoading = loadingClass === activeTemplate && currentItems.length === 0;
  const fetchError = errorByClass[activeTemplate] || null;

  const amazonCount = currentItems.filter((i) => i.source === 'Amazon').length;
  const customCount = currentItems.length - amazonCount;

  // After a successful create, the rule's `vehicle_class` array tells us
  // which tabs to invalidate so the row appears across all relevant tabs.
  const handleCreatedRule = (createdRule) => {
    const classesToRefresh = createdRule.vehicle_class || [activeTemplate];
    classesToRefresh.forEach((vc) => fetchRulesFor(vc, { force: true }));
    setShowAddDefect(false);
  };

  return (
    <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-navy-800 bg-navy-950/40">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ClipboardCheck size={14} className="text-accent-blue" />
              <h3 className="text-sm font-semibold text-white">{t('dvicCatalog.title', 'Defect Catalog')}</h3>
              <Badge variant="gold"><Lock size={9} className="inline mr-0.5" /> {t('dvicCatalog.amazonLocked', 'Amazon rules locked')}</Badge>
            </div>
            <p className="text-[11px] text-navy-400">{t('dvicCatalog.subtitlePart1', 'Items the inspector checks for this vehicle template. Amazon rules cannot be modified; add your own custom items with')} <span className="text-white font-medium">{t('dvicCatalog.subtitlePart2', '+ Custom Defect')}</span>{t('dvicCatalog.subtitlePart3', '.')}</p>
          </div>
          <button onClick={() => setShowAddDefect(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-green text-white text-xs font-semibold hover:opacity-90 cursor-pointer shrink-0">
            <Plus size={12} /> {t('dvicCatalog.customDefectButton', 'Custom Defect')}
          </button>
        </div>

        {/* Template sub-tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {DVIC_TEMPLATES.map((tpl) => {
            const active = activeTemplate === tpl.id;
            const count = (rulesByClass[tpl.id] || []).length;
            const known = rulesByClass[tpl.id] !== undefined;
            return (
              <button key={tpl.id} onClick={() => setActiveTemplate(tpl.id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  active ? 'bg-accent-blue/15 border border-accent-blue/50 text-accent-blue' : 'bg-navy-800 border border-navy-700 text-navy-300 hover:text-white'
                }`}>
                {tpl.label}
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${active ? 'bg-accent-blue/20' : 'bg-navy-700/50 text-navy-400'}`}>
                  {known ? count : '…'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 text-[11px] text-navy-400">
          <span className="text-accent-gold font-semibold">{amazonCount}</span> {t('dvicCatalog.amazonRulesLabel', 'Amazon rules')} &middot;{' '}
          <span className="text-accent-blue font-semibold">{customCount}</span> {t('dvicCatalog.customRulesLabel', 'custom')}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800 bg-navy-950/30">
              <th className="text-left px-3 py-2 font-semibold">{t('dvicCatalog.table.source', 'Source')}</th>
              <th className="text-left px-3 py-2 font-semibold">{t('dvicCatalog.table.section', 'Section')}</th>
              <th className="text-left px-3 py-2 font-semibold">{t('dvicCatalog.table.part', 'Part')}</th>
              <th className="text-left px-3 py-2 font-semibold">{t('dvicCatalog.table.defect', 'Defect')}</th>
              <th className="text-left px-3 py-2 font-semibold">{t('dvicCatalog.table.group', 'Group')}</th>
              <th className="text-left px-3 py-2 font-semibold">{t('dvicCatalog.table.class', 'Class')}</th>
              <th className="text-left px-3 py-2 font-semibold">{t('dvicCatalog.table.line', 'Line')}</th>
              <th className="text-left px-3 py-2 font-semibold">{t('dvicCatalog.table.targets', 'Targets')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-sm text-navy-400">
                <Loader2 size={16} className="inline mr-2 animate-spin" /> {t('dvicCatalog.loading', 'Loading inspection rules…')}
              </td></tr>
            )}
            {!isLoading && fetchError && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-accent-red">
                <AlertTriangle size={14} className="inline mr-1.5" />
                {fetchError}
              </td></tr>
            )}
            {!isLoading && !fetchError && currentItems.map((d) => {
              const sv = SOURCE_VARIANT[d.source] || SOURCE_VARIANT.DSP;
              const isAmazon = d.source === 'Amazon';
              const partsDisplay = (d.parts || []).join(', ') || '—';
              const targetsDisplay = (d.targets || [])
                .map((target) => `${target.part}/${target.defect_type}`)
                .join(', ');
              return (
                <tr key={d.id} className={`border-b border-navy-800/50 last:border-b-0 ${isAmazon ? 'bg-accent-gold/[0.03]' : 'hover:bg-navy-800/30'}`}>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold ${sv.bg} ${sv.border} ${sv.text}`}>
                      {isAmazon && <Lock size={8} />}
                      {d.source}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-white">{SECTION_LABEL[d.section] || d.section || '—'}</td>
                  <td className="px-3 py-2.5 text-white whitespace-nowrap">{partsDisplay}</td>
                  <td className="px-3 py-2.5 text-navy-200 max-w-md">
                    <div className="line-clamp-2">{d.defect_text}</div>
                  </td>
                  <td className="px-3 py-2.5 text-navy-300">
                    {d.group || <span className="text-accent-gold italic">{t('dvicCatalog.pending', 'Pending')}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-navy-300">
                    {d.classification || <span className="text-accent-gold italic">{t('dvicCatalog.pending', 'Pending')}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-navy-300">
                    {d.line || <span className="text-accent-gold italic">{t('dvicCatalog.pending', 'Pending')}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-navy-400 font-mono text-[10px] max-w-[180px]">
                    <div className="line-clamp-2" title={targetsDisplay}>{targetsDisplay || '—'}</div>
                  </td>
                </tr>
              );
            })}
            {!isLoading && !fetchError && currentItems.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-navy-400">{t('dvicCatalog.noDefects', 'No defects configured for this template.')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2.5 border-t border-navy-800 bg-navy-950/30 text-[11px] text-navy-400 flex items-start gap-1.5">
        <Info size={11} className="text-navy-500 mt-0.5 shrink-0" />
        <span>
          {t('dvicCatalog.controlHintPart1', 'You control')} <strong className="text-white">{t('dvicCatalog.controlHintSection', 'Section')}</strong>, <strong className="text-white">{t('dvicCatalog.controlHintPart', 'Part')}</strong> {t('dvicCatalog.controlHintMid1', 'text for custom items, plus the')} <strong className="text-white">{t('dvicCatalog.controlHintTuple', 'target tuple')}</strong> {t('dvicCatalog.controlHintMid2', '(which catalog rule it maps to). Your DFS Account Manager curates')} <strong className="text-white">{t('dvicCatalog.controlHintClass', 'Class')}</strong>, <strong className="text-white">{t('dvicCatalog.controlHintGroup', 'Group')}</strong>, <strong className="text-white">{t('dvicCatalog.controlHintLine', 'Line')}</strong> {t('dvicCatalog.controlHintEnd', 'for analytics consistency.')}
        </span>
      </div>

      <AnimatePresence>
        {showAddDefect && (
          <AddCustomDefectModal
            defaultVehicleClass={activeTemplate}
            onCreated={handleCreatedRule}
            onClose={() => setShowAddDefect(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// AddCustomDefectModal — POSTs to /inspection-rules.
// The user picks a (part, defect_type) tuple from the V2.2 catalog so the
// new rule is fully wired into the wizard's allow-list and routing logic.
// Targets are constrained to the catalog the active vehicle_class loads,
// since cross-class rules don't make sense as a "custom" addition.
// ============================================================
function AddCustomDefectModal({ defaultVehicleClass, onCreated, onClose }) {
  const { t } = useTranslation('admin');
  const [form, setForm] = useState({
    defectText: '',
    section: 'general',
    part: '',
    defectType: '',
    classification: '',
    group: '',
    line: '',
    rsi: false,
    vsa: false,
    vehicleClasses: [defaultVehicleClass],
    addToWizard: true,
    wizardPartCategory: 'DSP custom checks',
    wizardPhotoRequired: true,
    wizardRequiresBranding: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Catalog for the picker (cascading part → defect_type). We load the
  // catalog of the FIRST checked vehicle_class — picks across classes get
  // mapped at create time.
  const cascadeClass = form.vehicleClasses[0] || defaultVehicleClass;
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setCatalogError(null);
    setCatalog(null);
    defectCatalogApi.load(cascadeClass)
      .then((res) => { if (!cancelled) setCatalog(res); })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof APIError ? (err.detail || 'Load failed') : (err.message || 'Network error');
        setCatalogError(typeof msg === 'string' ? msg : 'Load failed');
      });
    return () => { cancelled = true; };
  }, [cascadeClass]);

  // Build the part list + per-part defect_type list from the catalog
  // response shape (tolerant — the endpoint hands back nested objects).
  const partOptions = useMemo(() => {
    if (!catalog) return [];
    const set = new Map();   // part_value → label
    const visit = (node) => {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (typeof node === 'object') {
        if (node.part && typeof node.part === 'string') {
          const lbl = node.partLabel || node.label || node.part;
          if (!set.has(node.part)) set.set(node.part, lbl);
        }
        if (node.parts && Array.isArray(node.parts)) {
          node.parts.forEach((p) => {
            const v = p.id || p.part || p.value;
            const l = p.label || p.partLabel || v;
            if (v && !set.has(v)) set.set(v, l);
          });
        }
        Object.values(node).forEach(visit);
      }
    };
    visit(catalog);
    return Array.from(set.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog]);

  // Defect types available for the selected part (from catalog). We always
  // show ALL DefectType values when the catalog can't tell us — simpler
  // fallback for less-common combos.
  const ALL_DEFECT_TYPES = useMemo(() => [
    'not_working', 'intermittent', 'flickering', 'on_or_flashing', 'no_cold_air',
    'no_heat', 'missing', 'damaged', 'cracked', 'broken', 'bent', 'frayed',
    'torn', 'rusted', 'leaking', 'cover_cracked', 'cover_missing', 'loose',
    'hanging', 'unsecured', 'zip_tied_or_taped', 'off_track', 'off_center',
    'misaligned', 'disconnected', 'stuck', 'wont_open', 'wont_close',
    'wont_lock', 'wont_unlock', 'wont_latch', 'wont_retract', 'flat',
    'low_tread', 'sidewall_damage', 'object_embedded', 'exposed_wire', 'bulge',
    'stud_broken', 'hub_cap_missing', 'low_fluid', 'empty', 'expired',
    'illegible', 'wrong_vehicle', 'needs_adjustment', 'needs_grease',
    'needs_diagnostic', 'needs_replacement', 'pulls_left', 'pulls_right',
    'vibration', 'noise', 'dirty', 'has_loose_objects', 'mount_damaged',
    'over_pressure', 'non_approved', 'obstructed', 'paint_chip',
    'not_adjustable', 'odor', 'other_damage',
  ], []);
  const defectTypeOptions = ALL_DEFECT_TYPES;

  const valid =
    form.defectText.trim().length >= 5
    && form.part
    && form.defectType
    && form.vehicleClasses.length > 0
    && (!form.addToWizard || form.wizardPartCategory.trim().length > 0);

  const toggleClass = (id) => {
    setForm((f) => {
      const has = f.vehicleClasses.includes(id);
      const next = has
        ? f.vehicleClasses.filter((x) => x !== id)
        : [...f.vehicleClasses, id];
      return { ...f, vehicleClasses: next.length ? next : [id] };
    });
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await inspectionRulesApi.create({
        defectText: form.defectText.trim(),
        source: 'DSP',
        section: form.section || null,
        parts: [form.part],
        classification: form.classification || null,
        group: form.group || null,
        line: form.line || null,
        rsi: form.rsi,
        vsa: form.vsa,
        vehicleClass: form.vehicleClasses,
        targets: [{ part: form.part, defect_type: form.defectType }],
        addToWizard: form.addToWizard,
        wizardPartCategory: form.addToWizard ? form.wizardPartCategory.trim() : null,
        wizardPhotoRequired: form.wizardPhotoRequired,
        wizardRequiresBranding: form.wizardRequiresBranding,
      });
      onCreated?.(created);
    } catch (err) {
      const detail = err?.detail || err?.message || 'Save failed';
      setSubmitError(typeof detail === 'string' ? detail : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-green/15 border border-accent-green/40 flex items-center justify-center">
              <Plus size={16} className="text-accent-green" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{t('addCustomDefect.title', 'Add Custom Defect')}</h3>
              <p className="text-[11px] text-navy-400">{t('addCustomDefect.subtitle', 'DSP-source rule, persisted to the V2.2 catalog')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-[11px] text-navy-200">
            <Info size={12} className="text-accent-blue mt-0.5 shrink-0" />
            <div>{t('addCustomDefect.infoBanner', 'The new rule references an existing (part, defect_type) tuple from the V2.2 catalog so it inherits the validation and routing wiring. Tick "Show in wizard" if inspectors should see it during walkarounds.')}</div>
          </div>

          {submitError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/10 border border-accent-red/30 text-xs text-accent-red">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div className="whitespace-pre-line">{submitError}</div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('addCustomDefect.vehicleClassesLabel', 'Vehicle classes *')}</label>
            <div className="flex flex-wrap gap-1.5">
              {DVIC_TEMPLATES.map((tpl) => {
                const checked = form.vehicleClasses.includes(tpl.id);
                return (
                  <button key={tpl.id} type="button" onClick={() => toggleClass(tpl.id)}
                    className={`px-3 py-1.5 rounded-md border text-xs font-semibold cursor-pointer transition-all ${
                      checked
                        ? 'bg-accent-blue/15 border-accent-blue/50 text-accent-blue'
                        : 'bg-navy-800 border-navy-700 text-navy-300 hover:text-white'
                    }`}>
                    {checked && <Check size={11} className="inline mr-1" />}
                    {tpl.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('addCustomDefect.sectionLabel', 'Section')}</label>
              <select value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })}
                className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green cursor-pointer">
                {DVIC_SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-navy-300 mb-1.5 block">
                {t('addCustomDefect.partLabel', 'Part *')}
                {catalogError && <span className="ml-1 text-accent-red">{t('addCustomDefect.catalogLoadFailed', '(catalog load failed)')}</span>}
              </label>
              <select value={form.part} onChange={(e) => setForm({ ...form, part: e.target.value })}
                className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green cursor-pointer">
                <option value="">{catalog ? t('addCustomDefect.selectPart', 'Select a part…') : t('addCustomDefect.loading', 'Loading…')}</option>
                {partOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('addCustomDefect.defectTypeLabel', 'Defect type *')}</label>
            <select value={form.defectType} onChange={(e) => setForm({ ...form, defectType: e.target.value })}
              className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green cursor-pointer">
              <option value="">{t('addCustomDefect.selectDefectType', 'Select a defect type…')}</option>
              {defectTypeOptions.map((dt) => <option key={dt} value={dt}>{dt.replace(/_/g, ' ')}</option>)}
            </select>
            <p className="text-[10px] text-navy-500 mt-1">{t('addCustomDefect.defectTypeHint', "Backend rejects (part, defect_type) pairs that aren't in the V2.2 catalog.")}</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('addCustomDefect.defectTextLabel', 'Defect description *')}</label>
            <textarea value={form.defectText} onChange={(e) => setForm({ ...form, defectText: e.target.value })} rows={2}
              placeholder={t('addCustomDefect.defectTextPlaceholder', 'What the inspector sees on the form — verbatim.')}
              className="w-full rounded-lg px-3 py-2.5 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green resize-none" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-navy-400 mb-1 block uppercase tracking-wide">{t('addCustomDefect.classLabel', 'Class')}</label>
              <select value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })}
                className="w-full rounded-md px-2 py-2 text-xs bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green cursor-pointer">
                <option value="">—</option>
                {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-navy-400 mb-1 block uppercase tracking-wide">{t('addCustomDefect.groupLabel', 'Group')}</label>
              <select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })}
                className="w-full rounded-md px-2 py-2 text-xs bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green cursor-pointer">
                <option value="">—</option>
                {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-navy-400 mb-1 block uppercase tracking-wide">{t('addCustomDefect.lineLabel', 'Line')}</label>
              <select value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })}
                className="w-full rounded-md px-2 py-2 text-xs bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green cursor-pointer">
                <option value="">—</option>
                {LINES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <div className="pt-2 border-t border-navy-800 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={form.addToWizard}
                onChange={(e) => setForm({ ...form, addToWizard: e.target.checked })}
                className="mt-0.5 w-4 h-4 accent-accent-green" />
              <div>
                <div className="text-xs font-semibold text-white">{t('addCustomDefect.showInWizard', 'Show in inspector wizard')}</div>
                <div className="text-[10px] text-navy-400">
                  {t('addCustomDefect.showInWizardHint', 'Adds this rule as a checklist item the inspector sees during walkarounds. Off if the rule is admin-only / for reporting.')}
                </div>
              </div>
            </label>
            {form.addToWizard && (
              <div className="ml-6 space-y-2">
                <div>
                  <label className="text-[10px] font-semibold text-navy-400 mb-1 block uppercase tracking-wide">{t('addCustomDefect.wizardCategoryLabel', 'Wizard part category *')}</label>
                  <input value={form.wizardPartCategory}
                    onChange={(e) => setForm({ ...form, wizardPartCategory: e.target.value })}
                    placeholder={t('addCustomDefect.wizardCategoryPlaceholder', 'DSP custom checks')}
                    className="w-full rounded-md px-3 py-2 text-xs bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green" />
                  <p className="text-[10px] text-navy-500 mt-0.5">{t('addCustomDefect.wizardCategoryHint', 'Header label inside the section the inspector sees.')}</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.wizardPhotoRequired}
                    onChange={(e) => setForm({ ...form, wizardPhotoRequired: e.target.checked })}
                    className="w-3.5 h-3.5 accent-accent-green" />
                  <span className="text-[11px] text-navy-200">{t('addCustomDefect.photoRequired', 'Photo required (off for sensory defects: odor, brake noise, etc.)')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.wizardRequiresBranding}
                    onChange={(e) => setForm({ ...form, wizardRequiresBranding: e.target.checked })}
                    className="w-3.5 h-3.5 accent-accent-green" />
                  <span className="text-[11px] text-navy-200">{t('addCustomDefect.brandedOnly', 'Branded only (Amazon DOT / Prime decals — hides for Owner/Rental vans)')}</span>
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">{t('addCustomDefect.cancel', 'Cancel')}</button>
          <button onClick={submit} disabled={!valid || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {submitting ? <><Loader2 size={14} className="animate-spin" /> {t('addCustomDefect.saving', 'Saving…')}</> : <><Check size={14} /> {t('addCustomDefect.addDefect', 'Add Defect')}</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Tab: Defect Rules — Auto-approval by category (DSP Owner only)
// ============================================================
function DefectRulesTab({ user }) {
  const { t } = useTranslation('admin');
  // State: for each category, rule is { enabled: bool, maxCost: number|null }
  const [rules, setRules] = useState(() => {
    const out = {};
    DEFECT_CATEGORIES.forEach((c) => {
      out[c.id] = {
        enabled: c.defaultOn,
        maxCost: null,
      };
    });
    return out;
  });
  const [maxCostEnabled, setMaxCostEnabled] = useState(true);
  const [globalMaxCost, setGlobalMaxCost] = useState(500);
  const [notifyEnabled, setNotifyEnabled] = useState(true);

  const updateRule = (catId, changes) => {
    setRules({ ...rules, [catId]: { ...rules[catId], ...changes } });
  };

  const autoApprovedCount = Object.values(rules).filter((r) => r.enabled).length;
  const totalCategories = DEFECT_CATEGORIES.length;

  // Quick presets — scoped to different vehicle-class cohorts
  const applyPreset = (preset) => {
    const next = { ...rules };
    DEFECT_CATEGORIES.forEach((c) => {
      if (preset === 'conservative') {
        // Branded ULCs only — Amazon-managed fleet, lowest-risk categories only
        const safe = ['wipers', 'emergency', 'fluids'].includes(c.id);
        next[c.id] = { enabled: safe, maxCost: null };
      } else if (preset === 'balanced') {
        // All AMR — mechanical repair scope under the primary AMR vendor
        next[c.id] = { enabled: c.defaultOn, maxCost: null };
      } else if (preset === 'comprehensive') {
        // Branded & Rentals — broadest auto-approval; only the heaviest body/glass jobs stay manual
        const major = ['body', 'windshield'].includes(c.id);
        next[c.id] = { enabled: !major, maxCost: null };
      }
    });
    setRules(next);
  };

  return (
    <div className="space-y-4 max-w-5xl">
      {/* DVIC Defect Catalog — inspection items per vehicle type */}
      <DvicDefectCatalog />

      {/* Explanation */}
      <div className="rounded-xl border border-accent-green/30 bg-accent-green/5 p-4 sm:p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-accent-green/15 border border-accent-green/40 flex items-center justify-center shrink-0">
            <CheckCheck size={18} className="text-accent-green" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-white mb-1">{t('defectRules.explanation.title', 'Defect Auto-Approval Rules')}</h3>
            <p className="text-xs text-navy-300">
              {t('defectRules.explanation.bodyPart1', 'Normally, every reported defect requires your manual approval before a work order is created.')}
              <strong className="text-white"> {t('defectRules.explanation.bodyPart2', 'Auto-approval rules let you skip that step')}</strong> {t('defectRules.explanation.bodyPart3', 'for routine, low-risk categories so vendors can start working immediately.')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent-green/15 border border-accent-green/40 text-accent-green font-semibold">
            <CheckCheck size={11} /> {t('defectRules.explanation.autoApprovedFmt', { count: autoApprovedCount, defaultValue: `${autoApprovedCount} auto-approved` })}
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-navy-800 border border-navy-700 text-navy-300 font-semibold">
            <Ban size={11} /> {t('defectRules.explanation.manualFmt', { count: totalCategories - autoApprovedCount, defaultValue: `${totalCategories - autoApprovedCount} manual` })}
          </div>
          <span className="text-navy-400">{t('defectRules.explanation.ofCategoriesFmt', { count: totalCategories, defaultValue: `of ${totalCategories} categories` })}</span>
        </div>
      </div>

      {/* Quick presets */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <ZapIcon size={14} className="text-accent-gold" />
          <h4 className="text-sm font-semibold text-white">{t('defectRules.presets.title', 'Quick presets')}</h4>
          <span className="text-[11px] text-navy-400">{t('defectRules.presets.subtitle', '— click to apply, then fine-tune below')}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button onClick={() => applyPreset('conservative')}
            className="text-left p-3 rounded-lg border border-navy-700 bg-navy-800/40 hover:border-accent-blue/40 hover:bg-accent-blue/5 cursor-pointer transition-all">
            <div className="flex items-center gap-2 mb-1">
              <Shield size={14} className="text-accent-blue" />
              <span className="text-sm font-semibold text-white">{t('defectRules.presets.conservative', 'Conservative')}</span>
            </div>
            <div className="text-[11px] text-white font-semibold">{t('defectRules.presets.conservativeScope', '*Branded ULCs only')}</div>
            <div className="text-[11px] text-navy-400 mt-0.5">{t('defectRules.presets.conservativeDesc', 'Lowest-risk scope — only Amazon-managed fleet, safe categories')}</div>
          </button>
          <button onClick={() => applyPreset('balanced')}
            className="text-left p-3 rounded-lg border border-navy-700 bg-navy-800/40 hover:border-accent-gold/40 hover:bg-accent-gold/5 cursor-pointer transition-all">
            <div className="flex items-center gap-2 mb-1">
              <Gauge size={14} className="text-accent-gold" />
              <span className="text-sm font-semibold text-white">{t('defectRules.presets.balanced', 'Balanced')}</span>
              <Badge variant="gold">{t('defectRules.presets.balancedRecommended', 'Recommended')}</Badge>
            </div>
            <div className="text-[11px] text-white font-semibold">{t('defectRules.presets.balancedScope', '*All AMR')}</div>
            <div className="text-[11px] text-navy-400 mt-0.5">{t('defectRules.presets.balancedDesc', 'Everything your primary AMR vendor covers — routine maintenance auto-approved')}</div>
          </button>
          <button onClick={() => applyPreset('comprehensive')}
            className="text-left p-3 rounded-lg border border-navy-700 bg-navy-800/40 hover:border-accent-green/40 hover:bg-accent-green/5 cursor-pointer transition-all">
            <div className="flex items-center gap-2 mb-1">
              <ZapIcon size={14} className="text-accent-green" />
              <span className="text-sm font-semibold text-white">{t('defectRules.presets.comprehensive', 'Comprehensive')}</span>
            </div>
            <div className="text-[11px] text-white font-semibold">{t('defectRules.presets.comprehensiveScope', 'Branded & Rentals')}</div>
            <div className="text-[11px] text-navy-400 mt-0.5">{t('defectRules.presets.comprehensiveDesc', 'Broadest reach — everything except heavy body and windshield work')}</div>
          </button>
        </div>
      </div>

      {/* Global max-cost safety net */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer mb-3">
          <input type="checkbox" checked={maxCostEnabled} onChange={() => setMaxCostEnabled(!maxCostEnabled)} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><Ban size={14} className="text-accent-orange" /><span className="text-sm font-semibold text-white">{t('defectRules.globalCap.title', 'Global cost cap')}</span></div>
            <div className="text-[11px] text-navy-400">{t('defectRules.globalCap.subtitle', 'Any repair estimate above this value still requires manual approval, regardless of category rules.')}</div>
          </div>
        </label>
        {maxCostEnabled && (
          <div className="pl-8 flex items-center gap-2">
            <span className="text-sm text-navy-300">{t('defectRules.globalCap.capAt', 'Cap repairs at')}</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400 text-sm">$</span>
              <input type="number" step="50" value={globalMaxCost} onChange={(e) => setGlobalMaxCost(parseInt(e.target.value) || 0)}
                className="w-32 rounded-lg pl-7 pr-3 py-2 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-orange" />
            </div>
            <span className="text-sm text-navy-400">{t('defectRules.globalCap.perWO', 'per WO')}</span>
          </div>
        )}
      </div>

      {/* Notify-on-auto-approval */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={notifyEnabled} onChange={() => setNotifyEnabled(!notifyEnabled)} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><MessageSquare size={14} className="text-accent-blue" /><span className="text-sm font-semibold text-white">{t('defectRules.notify.title', 'Notify me on auto-approvals')}</span></div>
            <div className="text-[11px] text-navy-400">{t('defectRules.notify.subtitle', 'Send a notification whenever an auto-approval fires so you have full visibility, even without needing to click approve.')}</div>
          </div>
        </label>
      </div>

      {/* Category rules list */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-navy-800 bg-navy-950/40">
          <h4 className="text-sm font-semibold text-white">{t('defectRules.categoryRules.title', 'Category-by-category rules')}</h4>
          <p className="text-[11px] text-navy-400">{t('defectRules.categoryRules.subtitle', 'Toggle auto-approval per defect category')}</p>
        </div>
        <div className="divide-y divide-navy-800/60">
          {DEFECT_CATEGORIES.map((cat) => {
            const rule = rules[cat.id];
            const Icon = DEFECT_CATEGORY_ICONS[cat.iconKey] || HelpCircle;
            return (
              <div key={cat.id} className={`px-4 py-3 transition-colors ${rule.enabled ? 'bg-accent-green/5' : ''}`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                      rule.enabled ? 'bg-accent-green/15 border-accent-green/40 text-accent-green' : 'bg-navy-800 border-navy-700 text-navy-400'
                    }`}>
                      <Icon size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-sm font-semibold text-white">{cat.label}</span>
                        {rule.enabled && (
                          <Badge variant="green"><CheckCheck size={9} className="inline mr-0.5" /> {t('defectRules.categoryRules.autoBadge', 'Auto')}</Badge>
                        )}
                        {!rule.enabled && <Badge variant="gray">{t('defectRules.categoryRules.manualBadge', 'Manual')}</Badge>}
                      </div>
                      <div className="text-[11px] text-navy-400">{cat.description}</div>
                      <div className="text-[10px] text-navy-500 mt-0.5">{t('defectRules.categoryRules.typicalCostFmt', { cost: cat.typicalCost, defaultValue: `Typical cost: ${cat.typicalCost}` })}</div>
                    </div>
                  </div>
                  {/* Toggle switch */}
                  <button
                    onClick={() => updateRule(cat.id, { enabled: !rule.enabled })}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                      rule.enabled ? 'bg-accent-green' : 'bg-navy-700'
                    }`}
                  >
                    <motion.div layout
                      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-colors ${
                        rule.enabled ? 'right-0.5' : 'left-0.5'
                      }`} />
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      </div>

      {/* Summary + save */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs text-navy-400">
          <span className="text-accent-green font-semibold">{autoApprovedCount}</span> {t('defectRules.summary.categoriesAutoLabel', 'categories set to auto-approve')}
          {maxCostEnabled && <> · {t('defectRules.summary.capLabel', 'cap')} <span className="text-white font-semibold">${globalMaxCost.toLocaleString()}</span></>}
        </div>
        <button className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-green text-white text-sm font-semibold hover:opacity-90 cursor-pointer">
          <Check size={14} /> {t('defectRules.saveRules', 'Save Rules')}
        </button>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div className="rounded-lg bg-navy-900/60 border border-navy-700/40 p-3 text-center">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-navy-400 uppercase tracking-wide">{label}</div>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================
export default function AdminPanel({ user }) {
  const { t } = useTranslation('admin');
  const isSiteAdmin = user?.role === 'site_admin';
  const isDspOwner = user?.role === 'dsp_owner';
  // Org admins (owners + managers + service_writers + site_admin) get the
  // Users / Invitations / Org / PM tabs. Defect Rules stays gated to the
  // top of each org type (DSP owner / site admin) until we add per-role
  // permissions for catalog editing.
  const isOrgAdmin = isOrgAdminRole(user);

  const isVendor = isVendorRole(user);
  // 2026-06-05 Jorge — body repair vendors don't run the mechanical
  // PM cycle and don't earn AMR rewards. Hide both tabs for that
  // org type even though the role-based gate would otherwise show
  // them (role=vendor_admin passes both isOrgAdmin and isVendor).
  const isBodyRepairVendor = user?.orgType === 'body_repair_vendor';
  const tabs = [
    { id: 'users',       label: t('tabs.users', 'Users'),               icon: Users,        available: isOrgAdmin },
    { id: 'invitations', label: t('tabs.invitations', 'Invitations'),   icon: Mail,         available: isOrgAdmin },
    { id: 'security',    label: t('tabs.security', 'Security'),         icon: Shield,       available: true },
    { id: 'org',         label: t('tabs.organization', 'Organization'), icon: Building2,    available: isOrgAdmin },
    { id: 'pm',          label: t('tabs.pm', 'Preventive Maintenance'), icon: RefreshCw,    available: isOrgAdmin && !isBodyRepairVendor },
    { id: 'rewards',     label: t('tabs.rewards', 'Rewards'),           icon: Gift,         available: (isVendor || isSiteAdmin) && !isBodyRepairVendor },
    { id: 'inspectors',  label: t('tabs.inspectors', 'Inspector Performance'), icon: Shield, available: isDspOwner || isSiteAdmin },
    { id: 'defects',     label: t('tabs.defects', 'Defect Rules'),      icon: CheckCheck,   available: isDspOwner || isSiteAdmin },
    { id: 'audit',       label: t('tabs.audit', 'Audit Log'),           icon: ScrollText,   available: isSiteAdmin },
  ].filter((tab) => tab.available);

  const [activeTab, setActiveTab] = useState(tabs[0]?.id || 'security');

  // Users filtered by org
  const [users, setUsers] = useState(() =>
    isSiteAdmin ? orgUsers : orgUsers.filter((u) => u.dspId === user?.orgId)
  );

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">{t('shell.heading', 'Administration')}</h2>
        <p className="text-navy-400 text-sm">
          {t('shell.subtitleFmt', { count: users.length, org: user.org, defaultValue: `${user.org} · ${users.length} ${users.length === 1 ? 'user' : 'users'}` })}
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex items-center gap-1 mb-4 sm:mb-6 border-b border-navy-800 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                active ? 'text-white' : 'text-navy-400 hover:text-white'
              }`}>
              <Icon size={14} />
              {tab.label}
              {active && (
                <motion.div layoutId="adminTabIndicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-accent-blue to-accent-purple"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
          {activeTab === 'users' && <UsersTab user={user} users={users} onUpdateUsers={setUsers} />}
          {activeTab === 'invitations' && <InvitationsTab user={user} />}
          {activeTab === 'security' && <SecurityTab user={user} />}
          {activeTab === 'org' && <OrganizationTab user={user} />}
          {activeTab === 'pm' && <PMTab user={user} />}
          {activeTab === 'rewards' && <RewardsTab user={user} />}
          {activeTab === 'inspectors' && <InspectorPerformanceTab />}
          {activeTab === 'defects' && <DefectRulesTab user={user} />}
          {activeTab === 'audit' && <AuditLogTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
