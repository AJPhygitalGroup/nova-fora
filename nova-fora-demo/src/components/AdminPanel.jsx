import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, Users, Shield, Building2, ClipboardCheck, Plus, X, Check, CheckCircle2,
  Mail, Key, Lock, Unlock, Smartphone, Trash2, Edit3, AlertTriangle, Info,
  ChevronDown, ChevronRight, Phone, MapPin, MessageSquare, Wrench as WrenchIcon,
  Clock, Calendar, RefreshCw, QrCode, Eye, EyeOff, Copy, Package, Sparkles,
  Armchair, Paintbrush, Car, Zap, Circle, Search, Lightbulb, Droplet, Wind,
  LifeBuoy, Gauge, MonitorSmartphone, ThermometerSun, HelpCircle, Zap as ZapIcon,
  Ban, CheckCheck, ExternalLink, UserCircle
} from 'lucide-react';
import { orgUsers, AVAILABLE_ROLES, rolesAssignableBy, preventiveMaintenanceJobs, pmIntervalsByVehicleType, VENDOR_SERVICES, DEFECT_CATEGORIES, SEVERITY_THRESHOLDS, fleetSnapshotVans, VENDOR_ASSIGNABLE_DSPS, dvicDefectCatalog, DVIC_TEMPLATES } from '../data/mockData';
import Badge from './ui/Badge';

const DEFECT_CATEGORY_ICONS = {
  Circle, Lightbulb, Droplet, Wind, LifeBuoy, Eye, Gauge, Car, Shield, MonitorSmartphone, ThermometerSun, HelpCircle,
};

const SERVICE_ICONS = { WrenchIcon, Zap, Car, Paintbrush, Shield, Armchair, Sparkles, ClipboardCheck, Circle, Package };

// ============================================================
// Reusable DSP picker — multi-select with "All" quick action
// ============================================================
function DspAssignmentPicker({ selected, onChange, color = 'accent-blue' }) {
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
            ? <span className="text-accent-orange font-semibold">No DSPs assigned — this user won't see any WOs</span>
            : allSelected
              ? <span className="text-white font-semibold">All DSPs selected</span>
              : <><span className="text-white font-semibold">{selected.length}</span> of {allIds.length} DSPs selected</>}
        </div>
        <button onClick={selectAll} className="text-[11px] text-accent-blue hover:underline font-medium">
          {allSelected ? 'Clear all' : 'Select all'}
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
                <div className="text-[10px] text-navy-400">Station {d.station} · {d.vanCount} vans</div>
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
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…"
            className="w-full rounded-lg pl-9 pr-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue" />
        </div>
        <button onClick={() => setShowInvite(true)}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-accent-green text-white text-sm font-semibold hover:bg-accent-green/80 cursor-pointer">
          <Plus size={14} /> Invite User
        </button>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-navy-800 bg-navy-950/40">
              <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">User</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Roles</th>
              {isVendorOrg && <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">DSPs Assigned</th>}
              <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Status</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">2FA</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-navy-400 font-semibold px-4 py-3">Last login</th>
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
                      <span className="text-[11px] text-accent-orange">None</span>
                    ) : (u.assignedDsps || []).length === VENDOR_ASSIGNABLE_DSPS.length ? (
                      <Badge variant="green">All ({VENDOR_ASSIGNABLE_DSPS.length})</Badge>
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
                  {u.status === 'active' && <Badge variant="green">Active</Badge>}
                  {u.status === 'pending' && <Badge variant="gold">Pending</Badge>}
                  {u.status === 'invited' && <Badge variant="purple">Invited</Badge>}
                </td>
                <td className="px-4 py-3">
                  {u.twoFAEnabled ? <Lock size={14} className="text-accent-green" /> : <Unlock size={14} className="text-navy-500" />}
                </td>
                <td className="px-4 py-3 text-xs text-navy-300">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : <span className="text-navy-500">Never</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <Edit3 size={14} className="text-navy-400" />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={isVendorOrg ? 7 : 6} className="px-4 py-10 text-center text-sm text-navy-400">No users match your search.</td></tr>
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
                {u.status === 'active' && <Badge variant="green">Active</Badge>}
                {u.status === 'pending' && <Badge variant="gold">Pending</Badge>}
                {u.status === 'invited' && <Badge variant="purple">Invited</Badge>}
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
                <div className="text-[10px] text-navy-400 uppercase tracking-wide mb-1 flex items-center gap-1"><Building2 size={9} /> DSPs assigned</div>
                {(u.assignedDsps || []).length === 0 ? (
                  <span className="text-[11px] text-accent-orange">None — user won't see any WOs</span>
                ) : (u.assignedDsps || []).length === VENDOR_ASSIGNABLE_DSPS.length ? (
                  <Badge variant="green">All {VENDOR_ASSIGNABLE_DSPS.length} DSPs</Badge>
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
            <div><h3 className="text-base font-semibold text-white">Invite User</h3><p className="text-[11px] text-navy-400">They'll receive an email to set their password</p></div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Full name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Jose Pérez"
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green" />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jose@example.com"
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green" />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Roles</label>
            <p className="text-[11px] text-navy-400 mb-2">
              {isVendorOrg
                ? 'Only vendor roles are available — you can\'t grant DSP or platform roles from here.'
                : adminOrgType === 'dsp'
                  ? 'Only DSP roles are available for your organization.'
                  : 'Assign any platform role.'}
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
                <Building2 size={12} className="text-accent-blue" /> DSP Assignments
              </label>
              <p className="text-[11px] text-navy-400 mb-2">Choose which DSPs this user will handle. They'll only see WOs and vehicles from the DSPs selected here.</p>
              <DspAssignmentPicker selected={form.assignedDsps} onChange={(v) => setForm({ ...form, assignedDsps: v })} color="accent-green" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Cancel</button>
          <button onClick={submit} disabled={!valid || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {submitting ? 'Sending…' : <>Send Invite <Mail size={14} /></>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function EditUserModal({ user, onClose, onSave, onRemove, isVendorOrg = false, adminOrgType }) {
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
            <div><h3 className="text-base font-semibold text-white">Edit User</h3><p className="text-[11px] text-navy-400">{user.email}</p></div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div><label className="text-xs font-semibold text-navy-300 mb-1.5 block">Full name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Roles</label>
            <p className="text-[11px] text-navy-400 mb-2">
              {isVendorOrg
                ? 'Only vendor roles are available — you can\'t grant DSP or platform roles from here.'
                : adminOrgType === 'dsp'
                  ? 'Only DSP roles are available for your organization.'
                  : 'Any role can be granted.'}
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
                <Building2 size={12} className="text-accent-blue" /> DSP Assignments
              </label>
              <p className="text-[11px] text-navy-400 mb-2">Pick which DSPs this user will handle. Each user only sees WOs and vehicles from the assigned DSPs.</p>
              <DspAssignmentPicker selected={form.assignedDsps} onChange={(v) => setForm({ ...form, assignedDsps: v })} color="accent-blue" />
            </div>
          )}

          <div className="flex items-center gap-2 p-3 rounded-lg bg-navy-800/40 border border-navy-700/40">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${form.twoFAEnabled ? 'bg-accent-green/15' : 'bg-navy-700'}`}>
              {form.twoFAEnabled ? <Lock size={14} className="text-accent-green" /> : <Unlock size={14} className="text-navy-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">Two-factor auth</div>
              <div className="text-[11px] text-navy-400">{form.twoFAEnabled ? 'Enabled' : 'Not enabled — user can enable in Security'}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={() => setShowRemove(true)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium text-accent-red hover:bg-accent-red/10 cursor-pointer">
            <Trash2 size={14} /> Remove
          </button>
          <button onClick={() => onSave(form)} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-blue text-white hover:opacity-90 cursor-pointer">
            <Check size={14} /> Save
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
                <h4 className="text-base font-semibold text-white mb-1">Remove {user.name}?</h4>
                <p className="text-xs text-navy-400 mb-4">User will lose all access immediately. Historical actions are kept.</p>
                <div className="flex gap-2">
                  <button onClick={() => setShowRemove(false)} className="flex-1 px-4 py-2.5 rounded-lg border border-navy-600 text-navy-300 text-sm hover:bg-navy-800 cursor-pointer">Cancel</button>
                  <button onClick={() => onRemove(user.id)} className="flex-1 px-4 py-2.5 rounded-lg bg-accent-red text-white text-sm font-semibold hover:opacity-90 cursor-pointer">Remove</button>
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
// Tab: Security
// ============================================================
function SecurityTab({ user }) {
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
            <h3 className="text-base font-semibold text-white">Change password</h3>
            <p className="text-[11px] text-navy-400">Use at least 12 characters, mix of letters and numbers</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Current password</label>
            <div className="relative">
              <input type={showCurrent ? 'text' : 'password'} value={passwordForm.current} onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                className="w-full rounded-lg pl-3 pr-10 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
              <button onClick={() => setShowCurrent(!showCurrent)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-navy-400 hover:text-white cursor-pointer">
                {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">New password</label>
            <input type="password" value={passwordForm.next} onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Confirm new password</label>
            <input type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
          </div>
          <button className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:opacity-90 cursor-pointer">
            <Check size={14} /> Update Password
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
                Two-factor authentication
                {twoFAEnabled && <Badge variant="green">Enabled</Badge>}
              </h3>
              <p className="text-[11px] text-navy-400">Add an extra layer of security with TOTP (Google Authenticator, Authy, 1Password)</p>
            </div>
          </div>
        </div>
        {twoFAEnabled ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setTwoFAEnabled(false)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-accent-red/40 bg-accent-red/10 text-accent-red text-sm font-semibold hover:bg-accent-red/20 cursor-pointer">
              <Unlock size={14} /> Disable 2FA
            </button>
            <span className="text-[11px] text-navy-400">Backup codes available in account</span>
          </div>
        ) : (
          <button onClick={() => setShow2FA(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-green text-white text-sm font-semibold hover:opacity-90 cursor-pointer">
            <Smartphone size={14} /> Enable 2FA
          </button>
        )}
      </div>

      {/* Active sessions */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-accent-gold/15 flex items-center justify-center"><Clock size={18} className="text-accent-gold" /></div>
          <div>
            <h3 className="text-base font-semibold text-white">Active sessions</h3>
            <p className="text-[11px] text-navy-400">Devices currently signed in to your account</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 rounded-lg bg-accent-green/5 border border-accent-green/30">
            <div><div className="text-sm font-semibold text-white">Chrome on Windows <Badge variant="green">Current</Badge></div><div className="text-[11px] text-navy-400">Seattle, WA · Active now</div></div>
            <Check size={14} className="text-accent-green" />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-navy-800/40 border border-navy-700/40">
            <div><div className="text-sm font-semibold text-white">Safari on iPhone</div><div className="text-[11px] text-navy-400">Seattle, WA · 2 hours ago</div></div>
            <button className="text-[11px] text-accent-red hover:underline">Sign out</button>
          </div>
        </div>
        <button className="mt-3 text-sm text-accent-red hover:underline">Sign out of all other devices</button>
      </div>

      <AnimatePresence>
        {show2FA && <Setup2FAModal onClose={() => setShow2FA(false)} onEnable={() => { setTwoFAEnabled(true); setShow2FA(false); }} />}
      </AnimatePresence>
    </div>
  );
}

function Setup2FAModal({ onClose, onEnable }) {
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
            <div><h3 className="text-base font-semibold text-white">Enable 2FA</h3><p className="text-[11px] text-navy-400">Step {step} of 2</p></div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1">
          {step === 1 ? (
            <div className="space-y-4">
              <div className="text-sm text-navy-200">Scan this QR code with your authenticator app, or enter the secret key manually.</div>
              <div className="bg-white rounded-xl p-5 mx-auto w-fit">
                <div className="w-40 h-40 grid grid-cols-8 grid-rows-8 gap-0.5">
                  {Array.from({ length: 64 }).map((_, i) => (
                    <div key={i} className={`${Math.random() > 0.5 ? 'bg-black' : 'bg-white'}`} />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-navy-400 mb-1">Or enter this secret key manually:</div>
                <div className="flex items-center gap-2 rounded-lg bg-navy-800 border border-navy-700 px-3 py-2.5">
                  <span className="flex-1 text-sm font-mono text-white tracking-wider">{secretKey}</span>
                  <button onClick={() => { navigator.clipboard?.writeText(secretKey.replace(/ /g, '')); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                    className="text-accent-blue text-xs font-semibold hover:underline">
                    {copied ? <><Check size={12} className="inline mr-0.5" /> Copied</> : <><Copy size={12} className="inline mr-0.5" /> Copy</>}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-navy-200">Enter the 6-digit code from your authenticator app:</div>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" inputMode="numeric" maxLength={6}
                className="w-full rounded-lg px-4 py-4 text-2xl font-mono text-center tracking-widest bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green" autoFocus />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={step === 1 ? onClose : () => setStep(1)} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          <button onClick={step === 1 ? () => setStep(2) : onEnable} disabled={step === 2 && code.length !== 6}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {step === 1 ? <>Next <ChevronRight size={14} /></> : <>Enable 2FA <Check size={14} /></>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Account Manager contact card shown on the Organization tab — gives the
// customer a direct line to their Nova Fora rep (Ask a question / Schedule time).
function AccountManagerCard() {
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
          <div className="text-[11px] text-navy-400">{am.title}</div>
        </div>
      </div>
      <div className="pt-3 border-t border-navy-800 space-y-3">
        <a href={`mailto:${am.email}?subject=Question%20from%20a%20Nova%20Fora%20customer`}
          className="flex items-center justify-between gap-2 text-sm text-white hover:text-accent-blue group">
          <span className="flex items-center gap-2">
            <MessageSquare size={14} className="text-accent-blue" />
            <span className="underline decoration-navy-600 underline-offset-4 group-hover:decoration-accent-blue">Ask a question</span>
          </span>
          <ExternalLink size={12} className="text-navy-500 group-hover:text-accent-blue" />
        </a>
        <a href={am.schedulingUrl} target="_blank" rel="noreferrer"
          className="flex items-center justify-between gap-2 text-sm text-white hover:text-accent-blue group">
          <span className="flex items-center gap-2">
            <Calendar size={14} className="text-accent-blue" />
            <span className="underline decoration-navy-600 underline-offset-4 group-hover:decoration-accent-blue">Schedule time with me!</span>
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
            <div><h3 className="text-base font-semibold text-white">Business details</h3><p className="text-[11px] text-navy-400">Shown to partners and on invoices</p></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-xs font-semibold text-navy-300 mb-1.5 block">Organization name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
            <div><label className="text-xs font-semibold text-navy-300 mb-1.5 block">Business phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
            <div><label className="text-xs font-semibold text-navy-300 mb-1.5 block">SMS phone</label><input value={form.smsPhone} onChange={(e) => setForm({ ...form, smsPhone: e.target.value })} className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
            <div><label className="text-xs font-semibold text-navy-300 mb-1.5 block">Default lot location</label><input value={form.lotLocation} onChange={(e) => setForm({ ...form, lotLocation: e.target.value })} className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
            <div className="sm:col-span-2"><label className="text-xs font-semibold text-navy-300 mb-1.5 block">Business address</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg px-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" /></div>
          </div>
        </div>

        {/* Account Manager card */}
        <AccountManagerCard />
      </div>

      {/* SMS opt-in */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.inspectionImpossibleSMS} onChange={() => setForm({ ...form, inspectionImpossibleSMS: !form.inspectionImpossibleSMS })} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><MessageSquare size={14} className="text-accent-blue" /><span className="text-sm font-semibold text-white">Inspection Impossible SMS</span></div>
            <div className="text-[11px] text-navy-400">Notify via SMS when an inspector cannot complete an inspection (keys missing, vehicle not found, etc.)</div>
          </div>
        </label>
      </div>

      {/* Evening reminder text */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.eveningReminder} onChange={() => setForm({ ...form, eveningReminder: !form.eveningReminder })} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Clock size={14} className="text-accent-blue" />
              <span className="text-sm font-semibold text-white">Set evening reminder text for keys and/or scheduled repairs</span>
            </div>
            <div className="text-[11px] text-accent-orange font-semibold">Vendors will not dispatch without confirmation of readiness</div>
            <AnimatePresence initial={false}>
              {form.eveningReminder && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-navy-400">Send at</span>
                    <input type="time" value={form.eveningReminderTime} onChange={(e) => setForm({ ...form, eveningReminderTime: e.target.value })}
                      className="rounded-lg px-3 py-1.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-blue" />
                    <span className="text-[11px] text-navy-400">to the DSP SMS phone</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </label>
      </div>

      {/* Key return info */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.keyReturnInfo} onChange={() => setForm({ ...form, keyReturnInfo: !form.keyReturnInfo })} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><Key size={14} className="text-accent-gold" /><span className="text-sm font-semibold text-white">Key(s) return time, location, lockbox code, etc.</span></div>
            <div className="text-[11px] text-navy-400">Shared with vendors so drivers know where to drop keys after overnight repairs</div>
            <AnimatePresence initial={false}>
              {form.keyReturnInfo && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-3">
                  <textarea value={form.keyReturnText} onChange={(e) => setForm({ ...form, keyReturnText: e.target.value })} rows={2}
                    placeholder="e.g. Front office lockbox, code 4827. Drop keys in the blue bin after hours."
                    className="w-full rounded-lg px-3 py-2 text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-gold resize-none" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </label>
      </div>

      {/* Preferred Vendors */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.preferredVendors} onChange={() => setForm({ ...form, preferredVendors: !form.preferredVendors })} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><Building2 size={14} className="text-accent-purple" /><span className="text-sm font-semibold text-white">Preferred Vendors (AMR, Body, Detailing, and Flex Fleet)</span></div>
            <div className="text-[11px] text-navy-400">Auto-route work orders to your preferred vendor for each category</div>
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

      {/* Slack Integration */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.slackIntegration} onChange={() => setForm({ ...form, slackIntegration: !form.slackIntegration })} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><MessageSquare size={14} className="text-accent-green" /><span className="text-sm font-semibold text-white">Slack Integration</span></div>
            <div className="text-[11px] text-navy-400">Mirror critical alerts (Rush Orders, Grounded Vehicles, Completions) into a Slack channel</div>
            <AnimatePresence initial={false}>
              {form.slackIntegration && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-navy-400 shrink-0">Channel</label>
                    <input value={form.slackChannel} onChange={(e) => setForm({ ...form, slackChannel: e.target.value })} placeholder="#fleet-ops"
                      className="flex-1 rounded-lg px-3 py-1.5 text-sm bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green font-mono" />
                  </div>
                  <button className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent-green/15 border border-accent-green/40 text-accent-green text-xs font-semibold hover:bg-accent-green/25 cursor-pointer">
                    <Check size={12} /> Connect Slack workspace
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
            <div><h3 className="text-base font-semibold text-white">Services offered</h3><p className="text-[11px] text-navy-400">DSPs match to vendors based on these capabilities</p></div>
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
            <span className="text-white font-semibold">{form.servicesOffered.length}</span> service{form.servicesOffered.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:opacity-90 cursor-pointer">
          <Check size={14} /> Save Changes
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Tab: Preventive Maintenance
// ============================================================
function PMTab({ user }) {
  const isDsp = user.role === 'dsp_owner';
  const jobs = isDsp ? preventiveMaintenanceJobs.filter((j) => j.dspId === user.orgId) : preventiveMaintenanceJobs;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StatBox label="Upcoming" value={jobs.filter((j) => j.status === 'upcoming').length} color="text-accent-gold" />
        <StatBox label="Scheduled" value={jobs.filter((j) => j.status === 'scheduled').length} color="text-accent-blue" />
        <StatBox label="Total" value={jobs.length} color="text-white" />
      </div>

      {/* Two-column: Upcoming PMs (left) + PM Intervals by Vehicle Type (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Upcoming PMs */}
        <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-800 bg-navy-950/40 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Upcoming PMs</h3>
            <button className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-green text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
              <Plus size={12} /> Schedule PM
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
                        <Badge variant={j.status === 'upcoming' ? 'gold' : 'blue'}>{j.status === 'upcoming' ? 'Upcoming' : 'Scheduled'}</Badge>
                      </div>
                      <div className="text-[11px] text-navy-400">Vendor: <span className="text-white">{j.vendor}</span></div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-navy-400">Due</div>
                      <div className="text-xs text-white font-semibold">{j.dueAt}</div>
                      {daysUntil !== null && <div className={`text-[10px] ${daysUntil <= 3 ? 'text-accent-red' : daysUntil <= 7 ? 'text-accent-gold' : 'text-navy-500'}`}>{daysUntil} days</div>}
                    </div>
                  </div>
                  {progressPct !== null && (
                    <div>
                      <div className="flex justify-between text-[10px] text-navy-400 mb-1">
                        <span>{j.currentValue?.toLocaleString()} mi</span>
                        <span>Trigger: {j.triggerAt.toLocaleString()} mi</span>
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
              <div className="px-4 py-10 text-center text-sm text-navy-400">No PM jobs scheduled.</div>
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
          <h3 className="text-sm font-semibold text-white">PM Intervals by Vehicle Type</h3>
        </div>
        <span className="text-[11px] text-navy-400">{groups.length} types</span>
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
                      <Lock size={10} /> Read-only
                    </span>
                  ) : (
                    <span className="text-[10px] text-navy-500">{g.intervals.length} intervals</span>
                  )}
                </div>
                {!g.locked && (
                  <button
                    onClick={() => setEditingGroup(isEditing ? null : g.type)}
                    className={`text-[11px] font-semibold cursor-pointer ${isEditing ? 'text-accent-green' : 'text-accent-blue hover:underline'}`}>
                    {isEditing ? <><Check size={11} className="inline mr-0.5" /> Done</> : <><Edit3 size={10} className="inline mr-0.5" /> Edit intervals</>}
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
    ? `Due every ${interval.miles?.toLocaleString()} miles`
    : `Due at ${interval.milesList?.map((n) => n.toLocaleString()).join('; ')} miles`;

  return (
    <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs ${
      editable ? 'bg-navy-800/60 border border-navy-700' : 'hover:bg-navy-800/30'
    }`}>
      <span className="text-white truncate">{interval.service}</span>
      {editable ? (
        <div className="flex items-center gap-1 shrink-0">
          {interval.mode === 'every' ? <span className="text-[10px] text-navy-400">every</span> : <span className="text-[10px] text-navy-400">at</span>}
          <input value={localMiles} onChange={(e) => setLocalMiles(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            className="w-24 text-right rounded-md px-2 py-0.5 text-xs font-mono bg-navy-900 border border-navy-700 text-white outline-none focus:border-accent-blue" />
          <span className="text-[10px] text-navy-400">mi</span>
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
  const [activeTemplate, setActiveTemplate] = useState('cargo');
  const [catalog, setCatalog] = useState(() => ({
    cargo: [...dvicDefectCatalog.cargo],
    dot: [...dvicDefectCatalog.dot],
    ev: [...dvicDefectCatalog.ev],
  }));
  const [showAddDefect, setShowAddDefect] = useState(false);

  const currentItems = catalog[activeTemplate] || [];
  const addCustomDefect = (defect) => {
    setCatalog({ ...catalog, [activeTemplate]: [{ ...defect, id: `d-custom-${Date.now()}`, source: 'DSP', group: 'Pending', class: 'Pending', line: 'Pending', responseType: 'Yes/No' }, ...currentItems] });
  };

  const amazonCount = currentItems.filter((i) => i.source === 'Amazon').length;
  const customCount = currentItems.length - amazonCount;

  return (
    <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-navy-800 bg-navy-950/40">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ClipboardCheck size={14} className="text-accent-blue" />
              <h3 className="text-sm font-semibold text-white">Defect Catalog</h3>
              <Badge variant="gold"><Lock size={9} className="inline mr-0.5" /> Amazon rules locked</Badge>
            </div>
            <p className="text-[11px] text-navy-400">Items the inspector checks for this vehicle template. Amazon rules cannot be modified; add your own custom items with <span className="text-white font-medium">+ Custom Defect</span>.</p>
          </div>
          <button onClick={() => setShowAddDefect(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-green text-white text-xs font-semibold hover:opacity-90 cursor-pointer shrink-0">
            <Plus size={12} /> Custom Defect
          </button>
        </div>

        {/* Template sub-tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {DVIC_TEMPLATES.map((t) => {
            const active = activeTemplate === t.id;
            const count = catalog[t.id]?.length || 0;
            return (
              <button key={t.id} onClick={() => setActiveTemplate(t.id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  active ? 'bg-accent-blue/15 border border-accent-blue/50 text-accent-blue' : 'bg-navy-800 border border-navy-700 text-navy-300 hover:text-white'
                }`}>
                {t.label}
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${active ? 'bg-accent-blue/20' : 'bg-navy-700/50 text-navy-400'}`}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 text-[11px] text-navy-400">
          <span className="text-accent-gold font-semibold">{amazonCount}</span> Amazon rules &middot;{' '}
          <span className="text-accent-blue font-semibold">{customCount}</span> custom
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-navy-400 text-[10px] uppercase tracking-wide border-b border-navy-800 bg-navy-950/30">
              <th className="text-left px-3 py-2 font-semibold">Source</th>
              <th className="text-left px-3 py-2 font-semibold">Section</th>
              <th className="text-left px-3 py-2 font-semibold">Part</th>
              <th className="text-left px-3 py-2 font-semibold">Defect</th>
              <th className="text-left px-3 py-2 font-semibold">Group</th>
              <th className="text-left px-3 py-2 font-semibold">Class</th>
              <th className="text-left px-3 py-2 font-semibold">Line</th>
              <th className="text-left px-3 py-2 font-semibold">Response</th>
            </tr>
          </thead>
          <tbody>
            {currentItems.map((d) => {
              const sv = SOURCE_VARIANT[d.source] || SOURCE_VARIANT.DSP;
              const isAmazon = d.source === 'Amazon';
              return (
                <tr key={d.id} className={`border-b border-navy-800/50 last:border-b-0 ${isAmazon ? 'bg-accent-gold/[0.03]' : 'hover:bg-navy-800/30'}`}>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold ${sv.bg} ${sv.border} ${sv.text}`}>
                      {isAmazon && <Lock size={8} />}
                      {d.source}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-white">{d.section}</td>
                  <td className="px-3 py-2.5 text-white">{d.part}</td>
                  <td className="px-3 py-2.5 text-navy-200">{d.defect}</td>
                  <td className="px-3 py-2.5 text-navy-300">{d.group}</td>
                  <td className="px-3 py-2.5 text-navy-300">
                    {d.class === 'Pending' ? <span className="text-accent-gold italic">Pending DFS</span> : d.class}
                  </td>
                  <td className="px-3 py-2.5 text-navy-300">
                    {d.line === 'Pending' ? <span className="text-accent-gold italic">Pending DFS</span> : d.line}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={d.responseType === 'Numeric' ? 'blue' : 'gray'}>{d.responseType}</Badge>
                  </td>
                </tr>
              );
            })}
            {currentItems.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-navy-400">No defects configured for this template.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2.5 border-t border-navy-800 bg-navy-950/30 text-[11px] text-navy-400 flex items-start gap-1.5">
        <Info size={11} className="text-navy-500 mt-0.5 shrink-0" />
        <span>
          You control <strong className="text-white">Section</strong>, <strong className="text-white">Part</strong> and <strong className="text-white">Defect</strong> for custom items.
          Your DFS Account Manager fills in <strong className="text-white">Group</strong>, <strong className="text-white">Class</strong>, <strong className="text-white">Line</strong> and <strong className="text-white">Response Type</strong> so routing + analytics stay consistent.
        </span>
      </div>

      <AnimatePresence>
        {showAddDefect && <AddCustomDefectModal template={activeTemplate} onSubmit={addCustomDefect} onClose={() => setShowAddDefect(false)} />}
      </AnimatePresence>
    </div>
  );
}

const DVIC_SECTIONS = ['General', 'Front', 'Driver Side', 'Passenger Side', 'Back Side', 'In-Cab'];

function AddCustomDefectModal({ template, onSubmit, onClose }) {
  const [form, setForm] = useState({ section: '', part: '', defect: '' });
  const [submitting, setSubmitting] = useState(false);
  const valid = form.section && form.part && form.defect.length > 4;

  const submit = () => {
    setSubmitting(true);
    setTimeout(() => {
      onSubmit(form);
      onClose();
    }, 500);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="bg-navy-900 border border-navy-700 rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-green/15 border border-accent-green/40 flex items-center justify-center">
              <Plus size={16} className="text-accent-green" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Add Custom Defect</h3>
              <p className="text-[11px] text-navy-400">Will be added to the <span className="text-white font-semibold">{DVIC_TEMPLATES.find((t) => t.id === template)?.label}</span> template</p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-[11px] text-navy-200">
            <Info size={12} className="text-accent-blue mt-0.5 shrink-0" />
            <div>Enter Section, Part and Defect. Your DFS Account Manager will review and fill in Group / Class / Line / Response Type before the item is activated for inspectors.</div>
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Section *</label>
            <select value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })}
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-green cursor-pointer">
              <option value="">Select a section…</option>
              {DVIC_SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Part *</label>
            <input value={form.part} onChange={(e) => setForm({ ...form, part: e.target.value })}
              placeholder="e.g. Windshield, Side mirror, Brake pads"
              className="w-full rounded-lg px-3 py-3 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green" />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy-300 mb-1.5 block">Defect description *</label>
            <textarea value={form.defect} onChange={(e) => setForm({ ...form, defect: e.target.value })} rows={3}
              placeholder="e.g. Windshield cracked larger than 6 inches"
              className="w-full rounded-lg px-3 py-2.5 text-base bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-green resize-none" />
          </div>
          <div className="pt-2 border-t border-navy-800">
            <div className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-2">DFS review fields (filled later)</div>
            <div className="grid grid-cols-2 gap-2">
              {['Group', 'Class', 'Line', 'Response Type'].map((f) => (
                <div key={f} className="px-3 py-2 rounded-lg bg-navy-800/40 border border-dashed border-navy-700 text-[11px]">
                  <div className="text-navy-500">{f}</div>
                  <div className="text-accent-gold italic text-xs">Pending DFS</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-navy-800 bg-navy-900/80">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:text-white hover:bg-navy-800 cursor-pointer">Cancel</button>
          <button onClick={submit} disabled={!valid || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent-green text-white hover:opacity-90 disabled:opacity-40 cursor-pointer">
            {submitting ? 'Adding…' : <><Check size={14} /> Add Defect</>}
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
  // State: for each category, rule is { enabled: bool, threshold: 'none'|'low'|'low_medium'|'all', maxCost: number|null }
  const [rules, setRules] = useState(() => {
    const out = {};
    DEFECT_CATEGORIES.forEach((c) => {
      out[c.id] = {
        enabled: c.defaultOn,
        threshold: c.defaultThreshold,
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

  const autoApprovedCount = Object.values(rules).filter((r) => r.enabled && r.threshold !== 'none').length;
  const totalCategories = DEFECT_CATEGORIES.length;

  // Quick presets — scoped to different vehicle-class cohorts
  const applyPreset = (preset) => {
    const next = { ...rules };
    DEFECT_CATEGORIES.forEach((c) => {
      if (preset === 'conservative') {
        // Branded ULCs only — Amazon-managed fleet, lowest-risk categories only
        const safe = ['wipers', 'emergency', 'fluids'].includes(c.id);
        next[c.id] = { enabled: safe, threshold: safe ? 'low' : 'none', maxCost: null };
      } else if (preset === 'balanced') {
        // All AMR — mechanical repair scope under the primary AMR vendor
        next[c.id] = { enabled: c.defaultOn, threshold: c.defaultThreshold, maxCost: null };
      } else if (preset === 'comprehensive') {
        // Branded & Rentals — broadest auto-approval; only the heaviest body/glass jobs stay manual
        const major = ['body', 'windshield'].includes(c.id);
        next[c.id] = { enabled: !major, threshold: major ? 'none' : 'low_medium', maxCost: null };
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
            <h3 className="text-base font-semibold text-white mb-1">Defect Auto-Approval Rules</h3>
            <p className="text-xs text-navy-300">
              Normally, every reported defect requires your manual approval before a work order is created.
              <strong className="text-white"> Auto-approval rules let you skip that step</strong> for routine, low-risk categories
              so vendors can start working immediately.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent-green/15 border border-accent-green/40 text-accent-green font-semibold">
            <CheckCheck size={11} /> {autoApprovedCount} auto-approved
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-navy-800 border border-navy-700 text-navy-300 font-semibold">
            <Ban size={11} /> {totalCategories - autoApprovedCount} manual
          </div>
          <span className="text-navy-400">of {totalCategories} categories</span>
        </div>
      </div>

      {/* Quick presets */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <ZapIcon size={14} className="text-accent-gold" />
          <h4 className="text-sm font-semibold text-white">Quick presets</h4>
          <span className="text-[11px] text-navy-400">— click to apply, then fine-tune below</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button onClick={() => applyPreset('conservative')}
            className="text-left p-3 rounded-lg border border-navy-700 bg-navy-800/40 hover:border-accent-blue/40 hover:bg-accent-blue/5 cursor-pointer transition-all">
            <div className="flex items-center gap-2 mb-1">
              <Shield size={14} className="text-accent-blue" />
              <span className="text-sm font-semibold text-white">Conservative</span>
            </div>
            <div className="text-[11px] text-white font-semibold">*Branded ULCs only</div>
            <div className="text-[11px] text-navy-400 mt-0.5">Lowest-risk scope — only Amazon-managed fleet, safe categories</div>
          </button>
          <button onClick={() => applyPreset('balanced')}
            className="text-left p-3 rounded-lg border border-navy-700 bg-navy-800/40 hover:border-accent-gold/40 hover:bg-accent-gold/5 cursor-pointer transition-all">
            <div className="flex items-center gap-2 mb-1">
              <Gauge size={14} className="text-accent-gold" />
              <span className="text-sm font-semibold text-white">Balanced</span>
              <Badge variant="gold">Recommended</Badge>
            </div>
            <div className="text-[11px] text-white font-semibold">*All AMR</div>
            <div className="text-[11px] text-navy-400 mt-0.5">Everything your primary AMR vendor covers — routine maintenance auto-approved</div>
          </button>
          <button onClick={() => applyPreset('comprehensive')}
            className="text-left p-3 rounded-lg border border-navy-700 bg-navy-800/40 hover:border-accent-green/40 hover:bg-accent-green/5 cursor-pointer transition-all">
            <div className="flex items-center gap-2 mb-1">
              <ZapIcon size={14} className="text-accent-green" />
              <span className="text-sm font-semibold text-white">Comprehensive</span>
            </div>
            <div className="text-[11px] text-white font-semibold">Branded &amp; Rentals</div>
            <div className="text-[11px] text-navy-400 mt-0.5">Broadest reach — everything except heavy body and windshield work</div>
          </button>
        </div>
      </div>

      {/* Global max-cost safety net */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer mb-3">
          <input type="checkbox" checked={maxCostEnabled} onChange={() => setMaxCostEnabled(!maxCostEnabled)} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><Ban size={14} className="text-accent-orange" /><span className="text-sm font-semibold text-white">Global cost cap</span></div>
            <div className="text-[11px] text-navy-400">Any repair estimate above this value still requires manual approval, regardless of category rules.</div>
          </div>
        </label>
        {maxCostEnabled && (
          <div className="pl-8 flex items-center gap-2">
            <span className="text-sm text-navy-300">Cap repairs at</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400 text-sm">$</span>
              <input type="number" step="50" value={globalMaxCost} onChange={(e) => setGlobalMaxCost(parseInt(e.target.value) || 0)}
                className="w-32 rounded-lg pl-7 pr-3 py-2 text-base bg-navy-800 border border-navy-700 text-white outline-none focus:border-accent-orange" />
            </div>
            <span className="text-sm text-navy-400">per WO</span>
          </div>
        )}
      </div>

      {/* Notify-on-auto-approval */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={notifyEnabled} onChange={() => setNotifyEnabled(!notifyEnabled)} className="mt-1 w-5 h-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1"><MessageSquare size={14} className="text-accent-blue" /><span className="text-sm font-semibold text-white">Notify me on auto-approvals</span></div>
            <div className="text-[11px] text-navy-400">Send a notification whenever an auto-approval fires so you have full visibility, even without needing to click approve.</div>
          </div>
        </label>
      </div>

      {/* Category rules list */}
      <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-navy-800 bg-navy-950/40">
          <h4 className="text-sm font-semibold text-white">Category-by-category rules</h4>
          <p className="text-[11px] text-navy-400">Toggle auto-approval + choose severity threshold per category</p>
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
                        {rule.enabled && rule.threshold !== 'none' && (
                          <Badge variant="green"><CheckCheck size={9} className="inline mr-0.5" /> Auto</Badge>
                        )}
                        {!rule.enabled && <Badge variant="gray">Manual</Badge>}
                      </div>
                      <div className="text-[11px] text-navy-400">{cat.description}</div>
                      <div className="text-[10px] text-navy-500 mt-0.5">Typical cost: {cat.typicalCost}</div>
                    </div>
                  </div>
                  {/* Toggle switch */}
                  <button
                    onClick={() => updateRule(cat.id, { enabled: !rule.enabled, threshold: !rule.enabled ? (cat.defaultThreshold === 'none' ? 'low' : cat.defaultThreshold) : 'none' })}
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

                {/* Severity threshold + cost — only when enabled */}
                <AnimatePresence>
                  {rule.enabled && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="pl-12 overflow-hidden">
                      <div className="flex items-center gap-1.5 flex-wrap pt-2">
                        {SEVERITY_THRESHOLDS.filter((t) => t.id !== 'none').map((t) => {
                          const active = rule.threshold === t.id;
                          return (
                            <button key={t.id} onClick={() => updateRule(cat.id, { threshold: t.id })}
                              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${
                                active
                                  ? 'bg-accent-green/20 border-accent-green/50 text-accent-green'
                                  : 'bg-navy-800 border-navy-700 text-navy-300 hover:border-navy-600 hover:text-white'
                              }`}
                              title={t.description}
                            >
                              {active && <Check size={10} className="inline mr-0.5" />}
                              {t.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-2 text-[10px] text-navy-400">
                        {SEVERITY_THRESHOLDS.find((t) => t.id === rule.threshold)?.description}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary + save */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs text-navy-400">
          <span className="text-accent-green font-semibold">{autoApprovedCount}</span> categories set to auto-approve
          {maxCostEnabled && <> · cap <span className="text-white font-semibold">${globalMaxCost.toLocaleString()}</span></>}
        </div>
        <button className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-green text-white text-sm font-semibold hover:opacity-90 cursor-pointer">
          <Check size={14} /> Save Rules
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
  const isSiteAdmin = user?.role === 'site_admin';
  const isDspOwner = user?.role === 'dsp_owner';
  const isOrgAdmin = isDspOwner || user?.role === 'vendor_admin' || isSiteAdmin;

  const tabs = [
    { id: 'users',    label: 'Users',         icon: Users,           available: isOrgAdmin },
    { id: 'security', label: 'Security',      icon: Shield,          available: true },
    { id: 'org',      label: 'Organization',  icon: Building2,       available: isOrgAdmin },
    { id: 'pm',       label: 'Preventive Maintenance', icon: RefreshCw, available: isOrgAdmin },
    { id: 'defects',  label: 'Defect Rules',  icon: CheckCheck,      available: isDspOwner || isSiteAdmin },
  ].filter((t) => t.available);

  const [activeTab, setActiveTab] = useState(tabs[0]?.id || 'security');

  // Users filtered by org
  const [users, setUsers] = useState(() =>
    isSiteAdmin ? orgUsers : orgUsers.filter((u) => u.dspId === user?.orgId)
  );

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">Administration</h2>
        <p className="text-navy-400 text-sm">
          {user.org} &middot; <span className="text-white font-medium">{users.length}</span> {users.length === 1 ? 'user' : 'users'}
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex items-center gap-1 mb-4 sm:mb-6 border-b border-navy-800 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`relative flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                active ? 'text-white' : 'text-navy-400 hover:text-white'
              }`}>
              <Icon size={14} />
              {t.label}
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
          {activeTab === 'security' && <SecurityTab user={user} />}
          {activeTab === 'org' && <OrganizationTab user={user} />}
          {activeTab === 'pm' && <PMTab user={user} />}
          {activeTab === 'defects' && <DefectRulesTab user={user} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
