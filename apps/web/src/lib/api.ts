import { mockApi } from './mock-api';

const USE_MOCK = true; // Set to false when real backend is ready
const API_BASE = '/api';

let accessToken: string | null = localStorage.getItem('eco_token');

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

export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (USE_MOCK) {
    return mockApi(path, options) as Promise<T>;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Timezone-Offset': String(new Date().getTimezoneOffset()),
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const json = await res.json();

  if (!res.ok) {
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
