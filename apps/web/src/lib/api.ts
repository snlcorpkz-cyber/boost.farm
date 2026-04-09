import { mockApi } from './mock-api';

const API_BASE = '/api';

let accessToken: string | null = localStorage.getItem('eco_token');
let useMock = false;
const MOCK_FALLBACK_ENABLED = true;

export function setToken(token: string | null) {
  accessToken = token;
  if (token) {
    localStorage.setItem('eco_token', token);
  } else {
    localStorage.removeItem('eco_token');
  }
}

export function getToken(): string | null {
  return accessToken;
}

export function isUsingMock(): boolean {
  return useMock;
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (useMock) {
    return mockApi(path, options) as T;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Timezone-Offset': String(new Date().getTimezoneOffset()),
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
    if (MOCK_FALLBACK_ENABLED) {
      console.warn('[api] Backend unavailable, switching to mock mode');
      useMock = true;
      return mockApi(path, options) as T;
    }
    throw new ApiError('NETWORK', 'Backend unavailable', 0);
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    if (MOCK_FALLBACK_ENABLED) {
      console.warn('[api] Invalid JSON response, switching to mock mode');
      useMock = true;
      return mockApi(path, options) as T;
    }
    throw new ApiError('PARSE', 'Invalid response', res.status);
  }

  if (!res.ok) {
    if ((json?.error?.code === 'INTERNAL_ERROR' || res.status >= 500) && MOCK_FALLBACK_ENABLED) {
      console.warn('[api] Server error, switching to mock mode');
      useMock = true;
      return mockApi(path, options) as T;
    }
    throw new ApiError(json.error?.code || 'UNKNOWN', json.error?.message || 'Request failed', res.status);
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
