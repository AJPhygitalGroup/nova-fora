import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, X, CheckCheck, AlertTriangle, Flame, CheckCircle2, Clock, Wrench,
  Lock, Briefcase, Inbox, MailOpen, Filter, PlayCircle
} from 'lucide-react';
import { notificationsSeed } from '../data/mockData';

const NOTIF_ICONS = {
  wo_completed:     { Icon: CheckCircle2, label: 'Work order completed' },
  wo_pending:       { Icon: Clock,        label: 'New work order' },
  wo_assigned:      { Icon: PlayCircle,   label: 'WO assigned' },
  wo_stale:         { Icon: Clock,        label: 'Stale WO' },
  defect_reported:  { Icon: AlertTriangle, label: 'New defect' },
  rush_order:       { Icon: Flame,        label: 'Rush order' },
  grounded:         { Icon: Lock,         label: 'Vehicle grounded' },
  pm_due:           { Icon: Wrench,       label: 'PM due' },
  fmc_approval:     { Icon: Briefcase,    label: 'FMC approval pending' },
  quote_request:    { Icon: MailOpen,     label: 'Quote request' },
};

const COLOR_CLASSES = {
  'accent-green':  'bg-accent-green/15 border-accent-green/40 text-accent-green',
  'accent-blue':   'bg-accent-blue/15 border-accent-blue/40 text-accent-blue',
  'accent-red':    'bg-accent-red/15 border-accent-red/40 text-accent-red',
  'accent-gold':   'bg-accent-gold/15 border-accent-gold/40 text-accent-gold',
  'accent-orange': 'bg-accent-orange/15 border-accent-orange/40 text-accent-orange',
  'accent-purple': 'bg-accent-purple/15 border-accent-purple/40 text-accent-purple',
};

function formatRelative(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotificationsPanel({ user, open, onClose }) {
  const [notifs, setNotifs] = useState(() => notificationsSeed.filter((n) => n.userId === user?.id));
  const [filter, setFilter] = useState('all'); // all | unread

  const visible = useMemo(() => {
    let list = notifs;
    if (filter === 'unread') list = list.filter((n) => !n.read);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [notifs, filter]);

  const unreadCount = notifs.filter((n) => !n.read).length;

  const markAllAsRead = () => setNotifs(notifs.map((n) => ({ ...n, read: true })));
  const markAsRead = (id) => setNotifs(notifs.map((n) => (n.id === id ? { ...n, read: true } : n)));
  const dismissAll = () => setNotifs([]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 280 }}
            className="fixed top-0 right-0 bottom-0 w-full sm:w-[420px] bg-navy-900 border-l border-navy-700 z-50 flex flex-col shadow-2xl">

            {/* Header */}
            <div className="px-4 sm:px-5 py-4 border-b border-navy-800 bg-navy-950/40">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-accent-blue/15 border border-accent-blue/40 flex items-center justify-center shrink-0">
                    <Bell size={16} className="text-accent-blue" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">Notifications</h3>
                    <p className="text-[11px] text-navy-400">
                      {unreadCount > 0 ? <><span className="text-white font-semibold">{unreadCount}</span> unread of {notifs.length}</> : 'All caught up'}
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="text-navy-400 hover:text-white p-2 -mr-2"><X size={20} /></button>
              </div>

              {/* Filters + bulk actions */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 rounded-lg bg-navy-800 border border-navy-700 p-0.5">
                  <button onClick={() => setFilter('all')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${filter === 'all' ? 'bg-navy-700 text-white' : 'text-navy-400 hover:text-white'}`}>
                    All ({notifs.length})
                  </button>
                  <button onClick={() => setFilter('unread')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${filter === 'unread' ? 'bg-navy-700 text-white' : 'text-navy-400 hover:text-white'}`}>
                    Unread ({unreadCount})
                  </button>
                </div>
                {notifs.length > 0 && (
                  <div className="flex items-center gap-1">
                    {unreadCount > 0 && (
                      <button onClick={markAllAsRead}
                        className="text-[11px] text-accent-blue hover:underline font-medium px-2 py-1 cursor-pointer">
                        Mark all read
                      </button>
                    )}
                    <button onClick={dismissAll}
                      className="text-[11px] text-accent-red hover:underline font-medium px-2 py-1 cursor-pointer">
                      Clear all
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <div className="text-center py-20 px-6">
                  <Inbox size={40} className="text-navy-600 mx-auto mb-3" />
                  <h4 className="text-sm font-semibold text-white mb-1">
                    {filter === 'unread' ? 'No unread notifications' : 'You\'re all caught up'}
                  </h4>
                  <p className="text-xs text-navy-400">
                    {filter === 'unread' ? 'Switch to "All" to see previous notifications' : 'New events will appear here'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-navy-800/60">
                  {visible.map((n) => {
                    const meta = NOTIF_ICONS[n.type] || { Icon: Bell, label: 'Notification' };
                    const Icon = meta.Icon;
                    const colorClass = COLOR_CLASSES[n.iconColor] || COLOR_CLASSES['accent-blue'];
                    return (
                      <motion.div
                        key={n.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        onClick={() => !n.read && markAsRead(n.id)}
                        className={`relative px-4 sm:px-5 py-3 transition-colors cursor-pointer ${
                          n.read ? 'hover:bg-navy-800/30' : 'bg-navy-800/20 hover:bg-navy-800/50'
                        }`}>
                        {!n.read && <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-accent-blue" />}
                        <div className="flex items-start gap-3">
                          <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${colorClass}`}>
                            <Icon size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-semibold mb-0.5 ${n.read ? 'text-navy-300' : 'text-white'}`}>
                              {n.title}
                            </div>
                            <p className={`text-xs ${n.read ? 'text-navy-500' : 'text-navy-300'} line-clamp-2`}>
                              {n.message}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-navy-500">
                              <span>{formatRelative(n.createdAt)}</span>
                              {n.relatedId && <><span>·</span><span className="font-mono text-accent-blue">{n.relatedId}</span></>}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            {notifs.length > 0 && (
              <div className="px-4 sm:px-5 py-3 border-t border-navy-800 bg-navy-950/40 text-center">
                <span className="text-[11px] text-navy-400">
                  Nova Fora delivers notifications in real time via WebSocket
                </span>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
