const API_BASE = '/api';

let accessToken: string | null = localStorage.getItem('eco_token');
let refreshToken: string | null = localStorage.getItem('eco_refresh');
let isRefreshing: Promise<boolean> | null = null;

export function setToken(token: string | null) {
  accessToken = token;
  if (token) {
    localStorage.setItem('eco_token', token);
  } else {
    localStorage.removeItem('eco_token');
  }
}

export function setRefreshToken(token: string | null) {
  refreshToken = token;
  if (token) {
    localStorage.setItem('eco_refresh', token);
  } else {
    localStorage.removeItem('eco_refresh');
  }
}

export function getToken(): string | null {
  return accessToken;
}

export function isUsingMock(): boolean {
  return false;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    if (json.data?.accessToken) {
      setToken(json.data.accessToken);
      setRefreshToken(json.data.refreshToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Timezone-Offset': String(new Date().getTimezoneOffset()),
    'X-Device-Info': JSON.stringify({
      platform: (window as any).EcoFarmAndroid ? 'android' : 'web',
      screen: `${screen.width}x${screen.height}`,
      language: navigator.language,
    }),
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError('NETWORK', 'Backend unavailable', 0);
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('PARSE', 'Invalid response', res.status);
  }

  if (!res.ok) {
    const errorCode = json?.error?.code || 'UNKNOWN';

    if (errorCode === 'SESSION_EXPIRED') {
      setToken(null);
      setRefreshToken(null);
      window.location.reload();
      throw new ApiError('SESSION_EXPIRED', 'Logged in on another device', 401);
    }

    if (res.status === 401 && refreshToken && !path.startsWith('/auth/')) {
      if (!isRefreshing) {
        isRefreshing = tryRefresh().finally(() => { isRefreshing = null; });
      }
      const ok = await isRefreshing;
      if (ok) {
        return api<T>(path, options);
      }
      setToken(null);
      setRefreshToken(null);
    }

    throw new ApiError(
      errorCode,
      json?.error?.message || 'Request failed',
      res.status
    );
  }

  return json.data;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
  }
}
