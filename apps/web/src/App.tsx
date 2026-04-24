import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from './hooks/useAuth';
import { api } from './lib/api';
import { useRewardToast } from './components/RewardToast';
import FarmPage from './pages/FarmPage';
import AuthPage from './pages/AuthPage';
import OnboardingPage from './pages/OnboardingPage';
import CropSelectPage from './pages/CropSelectPage';
import QuestsPage from './pages/QuestsPage';
import FriendsPage from './pages/FriendsPage';
import FriendFarmPage from './pages/FriendFarmPage';
import ProfilePage from './pages/ProfilePage';
import ReferralLandingPage from './pages/ReferralLandingPage';

const ONBOARDING_KEY = 'eco_onboarding_done';

const REF_KEY = 'eco_ref_code';

function captureRefFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem(REF_KEY, ref);
    window.history.replaceState({}, '', window.location.pathname);
  }
}

const CELEBRATED_OFFERS_KEY = 'eco_celebrated_offers';
const CELEBRATED_OFFERS_MAX = 100;

function loadCelebratedOffers(): Set<string> {
  try {
    const raw = localStorage.getItem(CELEBRATED_OFFERS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch { return new Set(); }
}

function persistCelebratedOffers(set: Set<string>) {
  try {
    const arr = Array.from(set).slice(-CELEBRATED_OFFERS_MAX);
    localStorage.setItem(CELEBRATED_OFFERS_KEY, JSON.stringify(arr));
  } catch { /* ignore quota errors */ }
}

interface CelebrationNotif {
  id: string;
  type: string;
  message_key: string;
  params: Record<string, any>;
  read: boolean;
}

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { showReward } = useRewardToast();
  const refProcessed = useRef(false);
  const celebratedRef = useRef<Set<string>>(loadCelebratedOffers());
  const celebrationBootstrapRef = useRef(false);
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem(ONBOARDING_KEY),
  );

  const finishOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setShowOnboarding(false);
  };

  captureRefFromUrl();

  useEffect(() => {
    if (!isAuthenticated || refProcessed.current) return;
    const code = localStorage.getItem(REF_KEY);
    if (!code) return;

    refProcessed.current = true;
    localStorage.removeItem(REF_KEY);

    api('/friends/add', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }).then(() => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
    }).catch((err: any) => {
      console.warn('[ref] add friend failed:', err.message);
    });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return;
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    tg.ready();
    tg.expand();
  }, [isAuthenticated]);

  // Push open tracking. The native Android layer (MainActivity.kt) fires a
  // `push-opened` CustomEvent on window after the WebView page finishes,
  // carrying the `campaign_id` from the FCM data payload. We POST it back
  // so the admin can see delivery → open conversion per campaign.
  // Events that arrive before this effect mounts are buffered on
  // `window.__pushOpenedQueue` by the native dispatcher (see MainActivity).
  useEffect(() => {
    if (!isAuthenticated) return;

    const report = (campaignId: string) => {
      if (!campaignId) return;
      api('/user/push-opened', {
        method: 'POST',
        body: JSON.stringify({ campaignId }),
      }).catch(() => { /* ignore — best-effort analytics */ });
    };

    const queue = (window as any).__pushOpenedQueue as string[] | undefined;
    if (Array.isArray(queue) && queue.length) {
      queue.splice(0).forEach(report);
    }
    (window as any).__pushOpenedQueue = { push: report } as any;

    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'string') report(detail);
    };
    window.addEventListener('push-opened', onEvent as EventListener);

    return () => {
      window.removeEventListener('push-opened', onEvent as EventListener);
      (window as any).__pushOpenedQueue = undefined;
    };
  }, [isAuthenticated]);

  // Session heartbeat — pings the server every 60s while the app is in the
  // foreground so the analytics session stays open with an accurate duration.
  // We also ping on focus/visibilitychange because WebView throttles setInterval
  // in the background and on mobile browsers intervals can drift.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;

    const ping = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      api('/user/session-heartbeat', { method: 'POST', body: '{}' }).catch(() => {});
    };

    ping();
    const id = window.setInterval(ping, 60_000);
    const onVisible = () => ping();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    // Best-effort logout ping when the tab is closed — not guaranteed but
    // catches most of the "user closed the tab" cases. Uses the same `/api`
    // prefix the rest of the client does (nginx strips it to `/…`) and the
    // correct localStorage key.
    const onBye = () => {
      try {
        const token = localStorage.getItem('eco_token');
        if (!token) return;
        const blob = new Blob(['{}'], { type: 'application/json' });
        navigator.sendBeacon?.(`/api/user/session-heartbeat`, blob);
      } catch { /* ignore */ }
    };
    window.addEventListener('pagehide', onBye);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pagehide', onBye);
    };
  }, [isAuthenticated]);

  // Offer-reward celebration poller. Everflow postbacks credit rewards on
  // the server and create a type='offer' notification. If the user happens
  // to be in the app at that moment we want a visible "toast" moment — the
  // partner spent real money on this conversion, a silent balance bump is
  // a terrible UX. We poll the same /user/notifications endpoint the popup
  // uses (cheap, already indexed) and fire `showReward('offer', …)` once
  // per notification id. The "once" part is persisted in localStorage so
  // reopening the app doesn't re-trigger celebrations for rewards the user
  // has already seen. The very first fetch after login never celebrates —
  // everything it returns is "historical" by definition.
  const { data: celebrationData } = useQuery<{ notifications: CelebrationNotif[] }>({
    queryKey: ['notifications-celebration'],
    queryFn: () => api(`/user/notifications?limit=10&offset=0`),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? 20_000 : false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!celebrationData?.notifications) return;
    const offerNotifs = celebrationData.notifications.filter(
      (n) => n.type === 'offer' && !n.read,
    );
    if (offerNotifs.length === 0) return;

    // First poll after login: seed the "already seen" set without firing
    // toasts. Anything older than 60s at that point is not new enough to
    // celebrate anyway.
    if (!celebrationBootstrapRef.current) {
      celebrationBootstrapRef.current = true;
      for (const n of offerNotifs) celebratedRef.current.add(n.id);
      persistCelebratedOffers(celebratedRef.current);
      return;
    }

    let changed = false;
    for (const n of offerNotifs) {
      if (celebratedRef.current.has(n.id)) continue;
      celebratedRef.current.add(n.id);
      changed = true;

      const reward = Number(n.params?.reward) || 0;
      const game = String(n.params?.game || '');
      const milestone = String(n.params?.milestone || '');
      if (reward <= 0) continue;

      showReward(
        'offer',
        reward,
        game ? `🎁 ${game}` : t('reward.offer_received'),
        milestone || undefined,
      );
    }
    if (changed) {
      persistCelebratedOffers(celebratedRef.current);
      // The server already credited the reward before creating the
      // notification, but the client still has a stale /farm snapshot.
      // Invalidate it so the banner on the farm (water-in-can / nutrition)
      // bumps in sync with the celebration toast.
      qc.invalidateQueries({ queryKey: ['farm'] });
    }
  }, [celebrationData, showReward, t, qc]);

  // Referral landing must work for both authed and unauthed users — and on
  // mobile browsers before the app is even installed. Route it before the
  // auth gate so visitors from a share link always land here.
  const isReferralLanding = /^\/r\//.test(window.location.pathname);

  if (isLoading && !isReferralLanding) {
    return (
      <div className="h-full flex items-center justify-center bg-farm-green/10">
        <img src="/assets/logo.webp" alt="Boost Farm" className="w-40 h-auto animate-pulse" />
      </div>
    );
  }

  if (isReferralLanding) {
    return (
      <Routes>
        <Route path="/r/:code" element={<ReferralLandingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  if (!isAuthenticated) {
    if (showOnboarding) {
      return <OnboardingPage onFinish={finishOnboarding} />;
    }
    return <AuthPage />;
  }

  return (
    <Routes>
      <Route path="/" element={<FarmPage />} />
      <Route path="/select-crop" element={<CropSelectPage />} />
      <Route path="/quests" element={<QuestsPage />} />
      <Route path="/friends/:friendId" element={<FriendFarmPage />} />
      <Route path="/friends" element={<FriendsPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
