import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { AVATAR_IMAGES, CROP_STAGES, UI } from '../lib/assets';

interface Notification {
  id: string;
  type: string;
  message_key: string;
  params: Record<string, string | number>;
  created_at: string;
  read: boolean;
}

const NOTIF_IMG: Record<string, string> = {
  greet: UI.greetHand,
  water: UI.waterDrop,
  quest: UI.gift,
  invite: UI.greetHand,
  gift: UI.gift,
};

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'es', label: 'Español' },
];

function timeAgo(iso: string, t: (k: string, p?: any) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('notif.just_now');
  if (m < 60) return t('notif.minutes_ago', { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('notif.hours_ago', { h });
  return t('notif.days_ago', { d: Math.floor(h / 24) });
}

export default function NotificationsPopup({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState<'list' | 'settings'>('list');
  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: Notification[]; unreadCount: number }>('/user/notifications'),
    refetchInterval: open ? 5000 : false,
  });

  const markRead = useMutation({
    mutationFn: (ids: string[]) =>
      api('/user/notifications/mark-read', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const pendingIds = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushMarkRead = useCallback(() => {
    if (pendingIds.current.size === 0) return;
    const ids = Array.from(pendingIds.current);
    pendingIds.current.clear();
    markRead.mutate(ids);
  }, [markRead]);

  useEffect(() => {
    if (!open || page !== 'list') return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.notifId;
            if (id) pendingIds.current.add(id);
          }
        }
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(flushMarkRead, 800);
      },
      { root: scrollRef.current, threshold: 0.5 }
    );

    const items = scrollRef.current?.querySelectorAll('[data-notif-id]');
    items?.forEach((el) => observerRef.current?.observe(el));

    return () => {
      observerRef.current?.disconnect();
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushMarkRead();
      }
    };
  }, [open, page, data?.notifications, flushMarkRead]);

  useEffect(() => {
    if (!open) {
      setPage('list');
      if (pendingIds.current.size > 0) flushMarkRead();
    }
  }, [open, flushMarkRead]);

  const notifications = data?.notifications ?? [];

  const handleLangChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('eco_lang', lang);
    api('/user/profile', {
      method: 'PATCH',
      body: JSON.stringify({ locale: lang }),
    });
  };

  const renderNotifIcon = (n: Notification) => {
    if (n.type === 'stage') {
      const stage = Number(n.params.stage) || 1;
      const cropImg = CROP_STAGES['product.potato']?.[stage]?.open;
      if (cropImg) return <img src={cropImg} alt="" className="w-7 h-7 object-contain" />;
    }
    const src = NOTIF_IMG[n.type] ?? UI.bell;
    return <img src={src} alt="" className="w-6 h-6 object-contain" />;
  };

  const translateParams = (n: Notification) => {
    const p = { ...n.params };
    if (p.unit === 'water') p.unit = t('notif.unit_water');
    else if (p.unit === 'nutrition') p.unit = t('notif.unit_nutrition');
    return p;
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 z-[90]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed top-0 inset-x-0 mx-auto max-w-[390px] z-[91] max-h-[85dvh] flex flex-col bg-white rounded-b-3xl shadow-2xl overflow-hidden"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 bg-white border-b border-gray-100">
              <div className="flex items-center gap-2">
                {page === 'settings' && (
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
                    onClick={() => setPage('list')}
                  >
                    <span className="text-gray-500 text-sm">←</span>
                  </button>
                )}
                <h2 className="text-base font-extrabold text-gray-800">
                  {page === 'list' ? t('notif.title') : t('notif.settings')}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {page === 'list' && (
                  <button
                    className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                    onClick={() => setPage('settings')}
                  >
                    <span className="text-gray-500 text-sm">⚙️</span>
                  </button>
                )}
                <button
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                  onClick={onClose}
                >
                  <span className="text-gray-400 text-sm font-bold">✕</span>
                </button>
              </div>
            </div>

            {/* Content */}
            {page === 'list' ? (
              <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <img src={UI.bell} alt="" className="w-10 h-10 opacity-30 mb-3" />
                    <p className="text-sm">{t('notif.empty')}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        data-notif-id={n.read ? undefined : n.id}
                        className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                          n.read ? 'bg-white' : 'bg-blue-50/50'
                        }`}
                      >
                        <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          {renderNotifIcon(n)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm leading-snug ${n.read ? 'text-gray-600' : 'text-gray-800 font-medium'}`}>
                            {t(n.message_key, translateParams(n))}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {timeAgo(n.created_at, t)}
                          </p>
                        </div>
                        {!n.read && (
                          <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
                {/* User info */}
                <div className="bg-gray-50 rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-green-200 to-green-300 flex items-center justify-center border-2 border-white shadow-md overflow-hidden">
                    <img src={AVATAR_IMAGES[user?.avatar_id ?? 'bear'] || AVATAR_IMAGES.bear} alt="" className="w-12 h-12 object-contain" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-gray-800">{user?.nickname}</p>
                    <p className="text-xs text-gray-400">{user?.email}</p>
                  </div>
                </div>

                {/* Language */}
                <div className="bg-gray-50 rounded-2xl p-4">
                  <p className="text-sm font-bold text-gray-700 mb-3">{t('profile.language')}</p>
                  <div className="flex gap-2">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
                          i18n.language === lang.code
                            ? 'bg-green-500 text-white shadow-sm'
                            : 'bg-white text-gray-600 border border-gray-200'
                        }`}
                        onClick={() => handleLangChange(lang.code)}
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Logout */}
                <button
                  className="w-full bg-gray-50 rounded-2xl p-4 text-left text-sm font-semibold text-red-500 hover:bg-red-50 transition-colors"
                  onClick={() => { logout(); onClose(); }}
                >
                  {t('profile.logout')} →
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
