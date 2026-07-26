const BASE = '/api/admin';

function getToken(): string | null {
  return localStorage.getItem('admin_token');
}

export function setToken(token: string) {
  localStorage.setItem('admin_token', token);
}

export function clearToken() {
  localStorage.removeItem('admin_token');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export async function api<T = any>(path: string, opts?: { method?: string; body?: any; headers?: Record<string, string> }): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    // Avoid browser HTTP caching + conditional GET (If-None-Match). Express
    // sets weak ETags on JSON; unchanged bodies → 304. For 304, `res.ok` is
    // false, so our handler below would treat success as failure and break
    // React Query refetches (e.g. af-cost-pull/status polling every 30s).
    cache: 'no-store',
    headers: { ...headers, ...(opts?.headers as Record<string, string> || {}) },
    body: opts?.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts?.body,
  });

  if (res.status === 401 || res.status === 403) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }

  if (res.status === 304) {
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error('Not Modified');
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }

  return res.json();
}

export async function apiUpload<T = any>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (res.status === 401 || res.status === 403) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }

  if (res.status === 304) {
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error('Not Modified');
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }

  return res.json();
}
