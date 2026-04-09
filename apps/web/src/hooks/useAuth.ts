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
    if (getToken()) {
      api('/user/profile')
        .then((data) => {
          globalAuthState = { user: data.user, isAuthenticated: true, isLoading: false };
          notify();
        })
        .catch(() => {
          setToken(null);
          globalAuthState = { user: null, isAuthenticated: false, isLoading: false };
          notify();
        });
    } else {
      globalAuthState = { user: null, isAuthenticated: false, isLoading: false };
      notify();
    }
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
