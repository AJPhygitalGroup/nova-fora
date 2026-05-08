import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Shield, Mail, Lock, ArrowRight, Star, UserCheck, Building2, Wrench as WrenchIcon, Briefcase, Info, Moon, Sun, AlertCircle } from 'lucide-react';
import { demoAccounts } from '../data/mockData';
import { auth, APIError } from '../api/client';

const roleIcon = {
  dsp_owner: Building2,
  vendor_admin: Briefcase,
  technician: WrenchIcon,
  site_admin: UserCheck,
};

const roleTint = {
  dsp_owner:    { bg: 'bg-accent-green/15',  border: 'border-accent-green/40',  text: 'text-accent-green',  accent: 'from-accent-green/20' },
  vendor_admin: { bg: 'bg-accent-blue/15',   border: 'border-accent-blue/40',   text: 'text-accent-blue',   accent: 'from-accent-blue/20' },
  technician:   { bg: 'bg-accent-purple/15', border: 'border-accent-purple/40', text: 'text-accent-purple', accent: 'from-accent-purple/20' },
  site_admin:   { bg: 'bg-accent-gold/15',   border: 'border-accent-gold/40',   text: 'text-accent-gold',   accent: 'from-accent-gold/20' },
};

export default function Login({ onLogin, theme, onToggleTheme }) {
  const { t } = useTranslation('auth');
  const [selectedAccount, setSelectedAccount] = useState(demoAccounts[0]);
  const [email, setEmail] = useState(demoAccounts[0].email);
  const [password, setPassword] = useState(demoAccounts[0].password);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSelectAccount = (acc) => {
    setSelectedAccount(acc);
    setEmail(acc.email);
    setPassword(acc.password);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await auth.login(email, password);
      onLogin(user);
    } catch (err) {
      if (err instanceof APIError) {
        if (err.status === 401) {
          setError(t('login.wrongCredentials'));
        } else if (err.status === 403) {
          setError(t('login.userDisabled'));
        } else {
          setError(err.detail || t('login.wrongCredentials'));
        }
      } else {
        setError(t('login.networkError', 'Network error — is the API reachable?'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-navy-950">
      {/* Top right theme toggle */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={onToggleTheme}
          className="w-10 h-10 rounded-lg border border-navy-700/60 bg-navy-800/60 text-navy-200 hover:text-white flex items-center justify-center transition-all cursor-pointer"
        >
          {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} className="text-accent-gold" />}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-3 sm:p-4 py-8 sm:py-4">
        <div className="w-full max-w-5xl grid lg:grid-cols-5 gap-4 sm:gap-6">
          {/* Left: Branding + login form */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-2 bg-navy-900/60 backdrop-blur border border-navy-700/40 rounded-2xl p-5 sm:p-8"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center font-bold text-white">
                NF
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white">Nova Fora</h1>
                <p className="text-xs text-navy-400">Safety First, LLC</p>
              </div>
            </div>

            <div className="mb-6">
              <h2 className="text-xl font-bold text-white mb-1">{t('login.title')}</h2>
              <p className="text-sm text-navy-400">{t('login.subtitle')}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('common:labels.email', 'Email')}</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder')}
                    className="w-full rounded-lg pl-9 pr-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-navy-300 mb-1.5 block">{t('common:labels.password', 'Password')}</label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('login.passwordPlaceholder')}
                    className="w-full rounded-lg pl-9 pr-3 py-3 sm:py-2.5 text-base sm:text-sm bg-navy-800 border border-navy-700 text-white placeholder-navy-500 outline-none focus:border-accent-blue"
                    required
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] text-navy-400 cursor-pointer">
                    <input type="checkbox" className="rounded" defaultChecked />
                    {t('login.rememberMe')}
                  </label>
                  <a href="#" className="text-[11px] text-accent-blue hover:underline">{t('login.forgotPassword')}</a>
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2 p-2.5 rounded-lg bg-accent-red/15 border border-accent-red/40 text-accent-red text-xs"
                >
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </motion.div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-3 sm:py-2.5 rounded-lg bg-gradient-to-r from-accent-blue to-accent-purple text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-all cursor-pointer"
              >
                {submitting ? (
                  <>
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full" />
                    {t('login.submitting')}
                  </>
                ) : (
                  <>
                    {t('login.submit')} <ArrowRight size={14} />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-navy-800 flex items-center justify-center gap-2 text-[11px] text-navy-400">
              <Shield size={11} className="text-accent-green" />
              <span>{t('login.securityHint', "JWT auth — Let's Encrypt SSL")}</span>
            </div>
          </motion.div>

          {/* Right: Demo role selector */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-3 flex flex-col"
          >
            <div className="mb-4">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-orange/15 border border-accent-orange/30 text-accent-orange text-[10px] font-semibold mb-2">
                <Info size={10} />
                {t('login.demoBadge', 'DEMO MODE')}
              </div>
              <h3 className="text-base font-semibold text-white mb-1">{t('login.demoAccountsTitle')}</h3>
              <p className="text-xs text-navy-400">{t('login.demoAccountsHint')}</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 flex-1">
              {demoAccounts.map((acc) => {
                const Icon = roleIcon[acc.role];
                const tint = roleTint[acc.role];
                const isSelected = selectedAccount.id === acc.id;
                return (
                  <button
                    key={acc.id}
                    onClick={() => handleSelectAccount(acc)}
                    className={`relative text-left rounded-xl p-4 border-2 transition-all cursor-pointer overflow-hidden ${
                      isSelected
                        ? `${tint.border} bg-gradient-to-br ${tint.accent} to-transparent`
                        : 'border-navy-700/60 bg-navy-900/60 hover:border-navy-600 hover:bg-navy-900/80'
                    }`}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="selectedAccountBadge"
                        className="absolute top-3 right-3 w-5 h-5 rounded-full bg-accent-green flex items-center justify-center"
                      >
                        <Star size={10} className="text-white fill-white" />
                      </motion.div>
                    )}
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-lg ${tint.bg} flex items-center justify-center shrink-0`}>
                        <Icon size={18} className={tint.text} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-white truncate">{acc.name}</div>
                        <div className="text-[11px] text-navy-400 truncate">{acc.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <div>
                        <div className="text-navy-500">{t('common:labels.organization', 'Organization')}</div>
                        <div className="text-white font-medium">{acc.org}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-navy-500">{t('common:labels.role', 'Role')}</div>
                        <div className={`font-semibold ${tint.text}`}>{acc.roleLabel}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 text-[11px] text-navy-500 text-center">
              {t('login.demoTipPart1', 'Click a card to auto-fill credentials, then click')} <span className="text-white font-medium">{t('login.submit')}</span>.
              {' '}{t('login.demoTipPart2', 'Tip: all demo accounts share password')} <span className="text-white font-mono">nova2026!</span>.
            </div>
          </motion.div>
        </div>
      </div>

      <footer className="border-t border-navy-800 py-4 px-6 text-center text-[11px] text-navy-500">
        {t('login.footer', 'Nova Fora — Customer Preview Demo')}
      </footer>
    </div>
  );
}
