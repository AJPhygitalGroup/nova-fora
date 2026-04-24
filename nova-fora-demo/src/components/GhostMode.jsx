import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Search, AlertTriangle, Check, Clock, User, Building2, Briefcase, Wrench as WrenchIcon, UserCheck } from 'lucide-react';
import { demoAccounts } from '../data/mockData';
import Badge from './ui/Badge';

const roleIcon = {
  dsp_owner: Building2,
  vendor_admin: Briefcase,
  technician: WrenchIcon,
  site_admin: UserCheck,
};

const roleTint = {
  dsp_owner:    { bg: 'bg-accent-green/15',  text: 'text-accent-green',  border: 'border-accent-green/40' },
  vendor_admin: { bg: 'bg-accent-blue/15',   text: 'text-accent-blue',   border: 'border-accent-blue/40' },
  technician:   { bg: 'bg-accent-purple/15', text: 'text-accent-purple', border: 'border-accent-purple/40' },
  site_admin:   { bg: 'bg-accent-gold/15',   text: 'text-accent-gold',   border: 'border-accent-gold/40' },
};

// In a real system this would fetch users from the API. For the demo we use the demo accounts list.
const IMPERSONABLE_USERS = demoAccounts;

export default function GhostMode({ user, onImpersonate }) {
  const [search, setSearch] = useState('');
  const [confirming, setConfirming] = useState(null);

  const filtered = search
    ? IMPERSONABLE_USERS.filter((u) =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.org.toLowerCase().includes(search.toLowerCase())
      )
    : IMPERSONABLE_USERS;

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-2xl font-bold text-white">Ghost Mode</h2>
          <Badge variant="red" size="md"><AlertTriangle size={10} className="inline mr-0.5" /> Restricted</Badge>
        </div>
        <p className="text-navy-400 text-sm">Temporarily impersonate any user to troubleshoot issues or reproduce their view</p>
      </div>

      {/* Audit warning */}
      <div className="mb-4 p-3 rounded-lg bg-accent-red/10 border border-accent-red/30 flex items-start gap-2 text-xs">
        <AlertTriangle size={14} className="text-accent-red mt-0.5 shrink-0" />
        <div>
          <strong className="text-accent-red">All impersonation events are audited.</strong>
          <span className="text-navy-300"> A banner will be visible at the top of the app while you're viewing as another user. All actions taken are logged with your admin ID and the impersonated user ID.</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or organization…"
          className="w-full rounded-lg pl-9 pr-3 py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-red" />
      </div>

      {/* User list */}
      <div className="space-y-2">
        {filtered.map((u) => {
          const Icon = roleIcon[u.role] || User;
          const tint = roleTint[u.role];
          const isMe = user?.id === u.id;
          return (
            <div key={u.id}
              className={`flex items-center gap-3 bg-navy-900/60 border rounded-xl p-3 ${
                isMe ? 'border-accent-gold/40 bg-accent-gold/5' : 'border-navy-700/40 hover:border-navy-600/60'
              }`}>
              <div className={`w-10 h-10 rounded-lg ${tint.bg} border ${tint.border} flex items-center justify-center shrink-0`}>
                <Icon size={16} className={tint.text} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-sm font-semibold text-white truncate">{u.name}</span>
                  {isMe && <Badge variant="gold">You</Badge>}
                </div>
                <div className="text-[11px] text-navy-400 truncate">{u.email}</div>
                <div className="text-[11px] text-navy-500">{u.org} &middot; <span className={tint.text}>{u.roleLabel}</span></div>
              </div>
              {!isMe && (
                <button onClick={() => setConfirming(u)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs font-semibold hover:bg-accent-red/25 cursor-pointer shrink-0">
                  <Eye size={12} /> Impersonate
                </button>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-10 text-center">
            <p className="text-sm text-white mb-1">No users match your search</p>
            <p className="text-xs text-navy-400">Try a different keyword</p>
          </div>
        )}
      </div>

      {/* Confirm modal */}
      <AnimatePresence>
        {confirming && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            onClick={() => setConfirming(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}
              className="bg-navy-900 border border-accent-red/40 rounded-xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}>
              <div className="w-12 h-12 rounded-full bg-accent-red/15 flex items-center justify-center mx-auto mb-3">
                <Eye size={22} className="text-accent-red" />
              </div>
              <h4 className="text-lg font-semibold text-white text-center mb-1">Impersonate {confirming.name}?</h4>
              <p className="text-sm text-navy-400 text-center mb-4">
                You'll see the app exactly as they do. Your admin session will be paused until you exit ghost mode.
              </p>
              <div className="bg-navy-800/60 border border-navy-700/40 rounded-lg p-3 mb-4 text-xs">
                <div className="flex justify-between mb-1"><span className="text-navy-400">User</span><span className="text-white font-semibold">{confirming.name}</span></div>
                <div className="flex justify-between mb-1"><span className="text-navy-400">Organization</span><span className="text-white">{confirming.org}</span></div>
                <div className="flex justify-between"><span className="text-navy-400">Role</span><span className="text-white">{confirming.roleLabel}</span></div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setConfirming(null)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-navy-600 text-navy-300 text-sm hover:bg-navy-800 cursor-pointer">Cancel</button>
                <button onClick={() => { onImpersonate(confirming); setConfirming(null); }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-accent-red text-white text-sm font-semibold hover:opacity-90 cursor-pointer">
                  <Eye size={14} /> Impersonate
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
