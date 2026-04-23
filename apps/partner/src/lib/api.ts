const BASE = '/api/partner';

interface SessionInfo {
  partnerSlug: string;
  partnerName: string;
  email: string;
}

export function getToken(): string | null {
  return localStorage.getItem('partner_token');
}

export function setToken(token: string) {
  localStorage.setItem('partner_token', token);
}

export function clearToken() {
  localStorage.removeItem('partner_token');
  localStorage.removeItem('partner_session');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function getSession(): SessionInfo | null {
  try {
    const raw = localStorage.getItem('partner_session');
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
}

export function setSession(s: SessionInfo) {
  localStorage.setItem('partner_session', JSON.stringify(s));
}

export async function api<T = any>(
  path: string,
  opts?: { method?: string; body?: any; headers?: Record<string, string> },
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts?.headers as Record<string, string> || {}) },
    body: opts?.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts?.body,
  });

  if (res.status === 401 || res.status === 403) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }

  const json = await res.json().catch(() => ({ success: false, error: { message: res.statusText } }));
  if (!res.ok || json.success === false) {
    throw new Error(json.error?.message || res.statusText);
  }
  return json.data as T;
}
