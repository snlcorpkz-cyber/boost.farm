import { useState, useEffect, useCallback } from 'react';
import { api, setToken, setRefreshToken, getToken } from '../lib/api';

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
    const data = await api('/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email, code, refCode }),
    });
    setToken(data.accessToken);
    setRefreshToken(data.refreshToken);
    globalAuthState = { user: data.user, isAuthenticated: true, isLoading: false };
    notify();
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
