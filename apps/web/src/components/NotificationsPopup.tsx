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

interface NotifResponse {
  notifications: Notification[];
  unreadCount: number;
  hasMore: boolean;
  nextOffset: number;
}

const PAGE_SIZE = 20;

const NOTIF_ICON: Record<string, { src: string; bg: string }> = {
  greet: { src: UI.greetHand, bg: 'bg-amber-100' },
  water: { src: UI.waterDrop, bg: 'bg-blue-100' },
  bucket: { src: UI.bucket, bg: 'bg-blue-50' },
  stage: { src: UI.rainbow, bg: 'bg-green-100' },
  harvest: { src: UI.coupon, bg: 'bg-yellow-100' },
  quest: { src: UI.gift, bg: 'bg-purple-100' },
  invite: { src: UI.greetHand, bg: 'bg-pink-100' },
  gift: { src: UI.gift, bg: 'bg-orange-100' },
  game: { src: UI.gift, bg: 'bg-indigo-100' },
  campaign: { src: UI.bell, bg: 'bg-amber-50' },
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
  const [tab, setTab] = useState<'list' | 'settings'>('list');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api('/user/account', { method: 'DELETE' });
    } finally {
      logout();
      onClose();
    }
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [allNotifications, setAllNotifications] = useState<Notification[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 0],
    queryFn: () => api<NotifResponse>(`/user/notifications?limit=${PAGE_SIZE}&offset=0`),
    enabled: open,
    refetchInterval: open ? 10000 : false,
  });

  useEffect(() => {
    if (data) {
      setAllNotifications(data.notifications);
      setHasMore(data.hasMore);
      setNextOffset(data.nextOffset);
      setUnreadCount(data.unreadCount);
    }
  }, [data]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const resp = await api<NotifResponse>(`/user/notifications?limit=${PAGE_SIZE}&offset=${nextOffset}`);
      setAllNotifications((prev) => [...prev, ...resp.notifications]);
      setHasMore(resp.hasMore);
      setNextOffset(resp.nextOffset);
      setUnreadCount(resp.unreadCount);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, nextOffset]);

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
    if (!open || tab !== 'list') return;

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
  }, [open, tab, allNotifications.length, flushMarkRead]);

  useEffect(() => {
    if (!open) {
      setTab('list');
      if (pendingIds.current.size > 0) flushMarkRead();
    }
  }, [open, flushMarkRead]);

  const handleLangChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('eco_lang', lang);
    api('/user/profile', {
      method: 'PATCH',
      body: JSON.stringify({ locale: lang }),
    });
  };

  const translateParams = (n: Notification) => {
    const p = { ...n.params };
    if (p.unit === 'water') p.unit = t('notif.unit_water');
    else if (p.unit === 'nutrition') p.unit = t('notif.unit_nutrition');
    return p;
  };

  const getIcon = (n: Notification) => {
    const info = NOTIF_ICON[n.type] ?? { src: UI.bell, bg: 'bg-gray-100' };
    if (n.type === 'stage') {
      const stage = Number(n.params.stage) || 1;
      const cropImg = CROP_STAGES['product.potato']?.[stage]?.open;
      if (cropImg) {
        return (
          <div className={`w-10 h-10 rounded-full ${info.bg} flex items-center justify-center flex-shrink-0 border-2 border-white shadow-sm`}>
            <img src={cropImg} alt="" className="w-7 h-7 object-contain" />
          </div>
        );
      }
    }
    return (
      <div className={`w-10 h-10 rounded-full ${info.bg} flex items-center justify-center flex-shrink-0 border-2 border-white shadow-sm`}>
        <img src={info.src} alt="" className="w-5 h-5 object-contain" />
      </div>
    );
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
            className="fixed top-0 inset-x-0 mx-auto max-w-[430px] z-[91] max-h-[85dvh] flex flex-col rounded-b-3xl shadow-2xl overflow-hidden"
            style={{
              background: 'linear-gradient(180deg, #FFF8E7 0%, #FAECC8 30%, #F5E1B0 100%)',
              boxShadow: '0 8px 32px rgba(120,80,20,0.18), 0 2px 8px rgba(120,80,20,0.10)',
            }}
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5"
              style={{
                background: 'linear-gradient(180deg, #A0784A 0%, #7B5C35 50%, #6B4E2C 100%)',
                boxShadow: '0 2px 6px rgba(80,50,10,0.3)',
              }}
            >
              <div className="flex items-center gap-2.5">
                {tab === 'settings' && (
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                    onClick={() => setTab('list')}
                  >
                    <span className="text-white text-sm font-bold">←</span>
                  </button>
                )}
                <img src={UI.bell} alt="" className="w-5 h-5 opacity-90" />
                <h2
                  className="text-base font-extrabold text-white"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}
                >
                  {tab === 'list' ? t('notif.title') : t('notif.settings')}
                </h2>
                {tab === 'list' && unreadCount > 0 && (
                  <span className="ml-1 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold shadow-sm">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {tab === 'list' && (
                  <button
                    className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
                    onClick={() => setTab('settings')}
                  >
                    <span className="text-white text-sm">⚙️</span>
                  </button>
                )}
                <button
                  className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
                  onClick={onClose}
                >
                  <span className="text-white text-sm font-bold">✕</span>
                </button>
              </div>
            </div>

            {/* Content */}
            {tab === 'list' ? (
              <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
                {allNotifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-amber-700/50">
                    <img src={UI.bell} alt="" className="w-12 h-12 opacity-30 mb-3" />
                    <p className="text-sm font-medium">{t('notif.empty')}</p>
                  </div>
                ) : (
                  <>
                    <div className="px-2 py-2 space-y-1.5">
                      {allNotifications.map((n) => (
                        <div
                          key={n.id}
                          data-notif-id={n.read ? undefined : n.id}
                          className={`flex items-start gap-3 px-3 py-2.5 rounded-2xl transition-colors ${
                            n.read
                              ? 'bg-white/40'
                              : 'bg-white/80 shadow-sm'
                          }`}
                          style={{
                            border: n.read ? '1px solid rgba(200,170,120,0.15)' : '1px solid rgba(200,170,120,0.3)',
                          }}
                        >
                          {getIcon(n)}
                          <div className="flex-1 min-w-0">
                            {/* Admin-broadcast campaigns carry raw title/body
                                from the dashboard — render them verbatim and
                                skip the i18n lookup (the key is filler). */}
                            {n.type === 'campaign' && (n.params.title || n.params.body) ? (
                              <>
                                {n.params.title && (
                                  <p className={`text-sm leading-snug ${n.read ? 'text-amber-800/70' : 'text-amber-900 font-semibold'}`}>
                                    {String(n.params.title)}
                                  </p>
                                )}
                                {n.params.body && (
                                  <p className={`text-xs leading-snug mt-0.5 ${n.read ? 'text-amber-700/60' : 'text-amber-800/80'}`}>
                                    {String(n.params.body)}
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className={`text-sm leading-snug ${n.read ? 'text-amber-800/70' : 'text-amber-900 font-semibold'}`}>
                                {t(n.message_key, translateParams(n))}
                              </p>
                            )}
                            <p className="text-[10px] text-amber-600/60 mt-0.5">
                              {timeAgo(n.created_at, t)}
                            </p>
                          </div>
                          {!n.read && (
                            <div className="w-2.5 h-2.5 rounded-full bg-green-500 mt-2 flex-shrink-0 shadow-sm" />
                          )}
                        </div>
                      ))}
                    </div>

                    {hasMore && (
                      <div className="flex justify-center py-3 pb-4">
                        <button
                          onClick={loadMore}
                          disabled={loadingMore}
                          className="px-5 py-2 rounded-full text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
                          style={{
                            background: 'linear-gradient(180deg, #8BC34A 0%, #689F38 100%)',
                            boxShadow: '0 3px 8px rgba(104,159,56,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                          }}
                        >
                          {loadingMore ? '...' : t('notif.load_more')}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3">
                {/* User info */}
                <div className="bg-white/60 rounded-2xl p-4 flex items-center gap-4" style={{ border: '1px solid rgba(200,170,120,0.2)' }}>
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-green-200 to-green-300 flex items-center justify-center border-2 border-white shadow-md overflow-hidden">
                    <img src={AVATAR_IMAGES[user?.avatar_id ?? 'bear'] || AVATAR_IMAGES.bear} alt="" className="w-12 h-12 object-contain" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-amber-900">{user?.nickname}</p>
                    <p className="text-xs text-amber-700/60">{user?.email}</p>
                  </div>
                </div>

                {/* Language */}
                <div className="bg-white/60 rounded-2xl p-4" style={{ border: '1px solid rgba(200,170,120,0.2)' }}>
                  <p className="text-sm font-bold text-amber-900 mb-3">{t('profile.language')}</p>
                  <div className="flex gap-2">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                          i18n.language === lang.code
                            ? 'text-white shadow-sm'
                            : 'bg-white/80 text-amber-800 border border-amber-200'
                        }`}
                        style={i18n.language === lang.code ? {
                          background: 'linear-gradient(180deg, #8BC34A 0%, #689F38 100%)',
                        } : undefined}
                        onClick={() => handleLangChange(lang.code)}
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Account actions — Logout sits above Delete Account in the
                    same visual group. Delete is intentionally muted (no red,
                    smaller text) so casual users don't tap it by accident,
                    but it's still discoverable right where Play Store policy
                    expects it. Confirmation happens in a centered modal. */}
                <div
                  className="bg-white/60 rounded-2xl overflow-hidden"
                  style={{ border: '1px solid rgba(200,170,120,0.2)' }}
                >
                  <button
                    className="w-full p-4 text-left text-sm font-semibold text-red-500 hover:bg-red-50/60 transition-colors active:scale-[0.98]"
                    onClick={() => { logout(); onClose(); }}
                  >
                    {t('profile.logout')} →
                  </button>
                  <div className="border-t" style={{ borderColor: 'rgba(200,170,120,0.25)' }} />
                  <button
                    className="w-full p-4 text-left text-sm text-amber-800/70 hover:bg-amber-50/60 transition-colors active:scale-[0.98]"
                    onClick={() => setShowDelete(true)}
                  >
                    {t('profile.delete_account')}
                  </button>
                </div>
              </div>
            )}
          </motion.div>

          {/* Delete-account confirmation modal. Sits above the Settings
              popup (z-[110]) so it captures all taps. Buttons are gray
              (not red) to match the low-pressure tone the user asked for —
              this is destructive, but it shouldn't look scary. */}
          <AnimatePresence>
            {showDelete && (
              <>
                <motion.div
                  className="fixed inset-0 bg-black/50 z-[110]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => !deleting && setShowDelete(false)}
                />
                <motion.div
                  className="fixed inset-0 z-[111] flex items-center justify-center px-6 pointer-events-none"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.div
                    className="bg-white rounded-3xl shadow-2xl w-full max-w-[340px] p-6 pointer-events-auto"
                    initial={{ scale: 0.9, y: 16 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, y: 16 }}
                    transition={{ type: 'spring', damping: 24, stiffness: 340 }}
                  >
                    <h3 className="text-base font-bold text-gray-800 text-center mb-2">
                      {t('profile.delete_confirm_title', 'Delete account?')}
                    </h3>
                    <p className="text-sm text-gray-500 text-center mb-5 leading-relaxed">
                      {t(
                        'profile.delete_confirm_body',
                        'Your account, farm progress, friends and push subscriptions will be permanently removed. This cannot be undone.',
                      )}
                    </p>
                    <div className="flex gap-2">
                      <button
                        className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50"
                        onClick={() => setShowDelete(false)}
                        disabled={deleting}
                      >
                        {t('profile.delete_no', 'No')}
                      </button>
                      <button
                        className="flex-1 py-2.5 rounded-xl bg-gray-700 text-white text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
                        onClick={handleDelete}
                        disabled={deleting}
                      >
                        {deleting ? '…' : t('profile.delete_yes', 'Yes')}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}
