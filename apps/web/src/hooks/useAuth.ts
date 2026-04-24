import { useState, useEffect, useCallback } from 'react';
import { api, setToken, setRefreshToken, getToken } from '../lib/api';
import { getInstallReferrer, type InstallReferrer } from './../lib/native';

/**
 * Collects campaign attribution from two sources:
 *   1. Native Play Install Referrer (only present inside the Android
 *      WebView and only for installs that came via a Play Store ad).
 *   2. URL params in the current web session (fallback for web-to-app
 *      flows, shared web links, or users who landed on the web build).
 * The native side wins — it's the canonical source of truth for the
 * Android install flow. Web URL params only fill fields that aren't
 * already populated from native.
 */
function collectAcquisition(): Record<string, string | number> | undefined {
  const out: Record<string, string | number> = {};

  const native: InstallReferrer | null = getInstallReferrer();
  if (native) {
    if (native.utmSource) out.utmSource = native.utmSource;
    if (native.utmMedium) out.utmMedium = native.utmMedium;
    if (native.utmCampaign) out.utmCampaign = native.utmCampaign;
    if (native.utmContent) out.utmContent = native.utmContent;
    if (native.fbAdId) out.fbAdId = native.fbAdId;
    if (native.fbAdsetId) out.fbAdsetId = native.fbAdsetId;
    if (native.fbCampaignId) out.fbCampaignId = native.fbCampaignId;
    if (native.raw) out.raw = native.raw;
    if (native.clickTs && native.clickTs > 0) out.clickTs = native.clickTs;
    if (native.installTs && native.installTs > 0) out.installTs = native.installTs;
  }

  try {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const pick = (k: string, target: string) => {
        if (out[target] !== undefined) return;
        const v = params.get(k);
        if (v && v.trim()) out[target] = v.trim();
      };
      pick('utm_source', 'utmSource');
      pick('utm_medium', 'utmMedium');
      pick('utm_campaign', 'utmCampaign');
      pick('utm_content', 'utmContent');
      pick('fb_ad_id', 'fbAdId');
      pick('fb_adset_id', 'fbAdsetId');
      pick('fb_campaign_id', 'fbCampaignId');
    }
  } catch {
    // ignore — attribution is best-effort
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function registerPushToken() {
  try {
    const bridge = (window as any).EcoFarmAndroid;
    if (!bridge?.getFcmToken) return;
    const token = bridge.getFcmToken();
    if (!token) {
      window.addEventListener('fcm-token', ((e: CustomEvent) => {
        if (e.detail) {
          api('/user/push-token', {
            method: 'POST',
            body: JSON.stringify({ token: e.detail, platform: 'android' }),
          }).catch(() => {});
        }
      }) as EventListener, { once: true });
      return;
    }
    api('/user/push-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform: 'android' }),
    }).catch(() => {});
  } catch { /* not in Android WebView */ }
}

interface User {
  id: string;
  email: string;
  nickname: string;
  avatar_id: string;
  locale: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

let globalAuthState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
};

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function useAuth() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const tgInit =
        typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : undefined;

      if (getToken()) {
        try {
          const data = await api<{ user: User }>('/user/profile');
          if (cancelled) return;
          globalAuthState = { user: data.user, isAuthenticated: true, isLoading: false };
          notify();
          registerPushToken();
          return;
        } catch {
          setToken(null);
          setRefreshToken(null);
        }
      }

      if (tgInit) {
        try {
          const data = await api<{
            accessToken: string;
            refreshToken: string;
            user: User;
          }>('/auth/telegram', {
            method: 'POST',
            body: JSON.stringify({ initData: tgInit }),
          });
          if (cancelled) return;
          setToken(data.accessToken);
          setRefreshToken(data.refreshToken);
          globalAuthState = { user: data.user, isAuthenticated: true, isLoading: false };
          notify();
          registerPushToken();
          return;
        } catch (e) {
          console.warn('[auth] Telegram Mini App login failed', e);
        }
      }

      if (cancelled) return;
      globalAuthState = { user: null, isAuthenticated: false, isLoading: false };
      notify();
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, code: string, refCode?: string) => {
    const acquisition = collectAcquisition();
    const data = await api('/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({
        email,
        code,
        refCode,
        ...(acquisition ? { acquisition } : {}),
      }),
    });
    setToken(data.accessToken);
    setRefreshToken(data.refreshToken);
    globalAuthState = { user: data.user, isAuthenticated: true, isLoading: false };
    notify();
    registerPushToken();
    return data;
  }, []);

  const sendCode = useCallback(async (email: string) => {
    await api('/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setRefreshToken(null);
    globalAuthState = { user: null, isAuthenticated: false, isLoading: false };
    notify();
  }, []);

  return {
    ...globalAuthState,
    login,
    sendCode,
    logout,
  };
}
