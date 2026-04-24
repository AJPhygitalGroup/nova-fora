import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, LogOut, UserCheck, Building2, Briefcase, Wrench as WrenchIcon, RefreshCw } from 'lucide-react';
import { demoAccounts } from '../../data/mockData';

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

export default function RoleSwitcher({ user, onSwitchRole, onLogout }) {
  const [open, setOpen] = useState(false);
  const tint = roleTint[user.role] || roleTint.dsp_owner;
  const Icon = roleIcon[user.role] || UserCheck;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-navy-700/60 bg-navy-800/60 hover:bg-navy-700/60 transition-all cursor-pointer"
      >
        <div className={`w-7 h-7 rounded-md ${tint.bg} border ${tint.border} flex items-center justify-center font-bold text-[10px] ${tint.text}`}>
          {user.avatar}
        </div>
        <div className="text-left hidden sm:block">
          <div className="text-xs font-semibold text-white leading-tight">{user.name}</div>
          <div className={`text-[10px] font-semibold leading-tight ${tint.text}`}>{user.roleLabel}</div>
        </div>
        <ChevronDown size={12} className={`text-navy-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="absolute top-full right-0 mt-2 w-80 rounded-xl border border-navy-700 bg-navy-900 shadow-2xl z-50 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-navy-800 bg-navy-950/60">
                <div className="flex items-center gap-2 mb-1">
                  <RefreshCw size={10} className="text-accent-orange" />
                  <span className="text-[10px] font-semibold text-accent-orange uppercase tracking-wide">Demo role switcher</span>
                </div>
                <div className="text-[11px] text-navy-400">Try each perspective — nav, permissions and data differ.</div>
              </div>

              <div className="max-h-96 overflow-y-auto">
                {demoAccounts.map((acc) => {
                  const Ico = roleIcon[acc.role];
                  const t = roleTint[acc.role];
                  const isCurrent = user.id === acc.id;
                  return (
                    <button
                      key={acc.id}
                      onClick={() => { onSwitchRole(acc); setOpen(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-navy-800/60 transition-colors border-b border-navy-800/60 last:border-b-0 ${
                        isCurrent ? 'bg-navy-800/40' : ''
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-lg ${t.bg} border ${t.border} flex items-center justify-center shrink-0`}>
                        <Ico size={15} className={t.text} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                          {acc.name}
                          {isCurrent && <Check size={12} className="text-accent-green shrink-0" />}
                        </div>
                        <div className="text-[11px] text-navy-400 truncate">{acc.org} &middot; <span className={t.text}>{acc.roleLabel}</span></div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-navy-800">
                <button
                  onClick={() => { setOpen(false); onLogout(); }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left text-accent-red hover:bg-accent-red/10 transition-colors text-sm font-medium cursor-pointer"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
