import { randomUUID } from 'node:crypto';

export interface ApiClientOptions {
  baseUrl: string;
  loadTestSecret?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.extraHeaders = {};
    if (opts.loadTestSecret) {
      this.extraHeaders['X-Load-Test-Secret'] = opts.loadTestSecret;
    }
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; token?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Timezone-Offset': String(new Date().getTimezoneOffset()),
      ...this.extraHeaders,
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body:
        options.body === undefined
          ? undefined
          : typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body),
    });
    const text = await res.text();
    let parsed: { success?: boolean; data?: T; error?: { code?: string; message?: string } };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(`Non-JSON ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok || parsed.success === false) {
      const msg = parsed.error?.message || parsed.error?.code || res.statusText;
      throw new Error(`${path} → ${res.status} ${msg}`);
    }
    return parsed.data as T;
  }

  verifyCode(email: string, refCode?: string) {
    return this.request<{ accessToken: string; refreshToken: string; user: { id: string } }>(
      '/auth/verify-code',
      { method: 'POST', body: { email, ...(refCode ? { refCode } : {}) } },
    );
  }

  products() {
    return this.request<{ products: { id: string; name_key: string; difficulty_stars: number }[] }>(
      '/admin/products',
    );
  }

  farm(token: string) {
    return this.request<{ farm: Record<string, unknown> | null; needsCropSelection?: boolean }>('/farm', {
      token,
    });
  }

  newCrop(token: string, productId: string) {
    return this.request<{ farm: unknown }>('/farm/new-crop', {
      method: 'POST',
      body: { productId },
      token,
    });
  }

  collectBucket(token: string) {
    return this.request<{ collected: number }>('/farm/collect-bucket', {
      method: 'POST',
      token,
    });
  }

  water(token: string, times: 1 | 5 | 20) {
    return this.request<unknown>('/farm/water', {
      method: 'POST',
      body: { times, idempotencyKey: randomUUID() },
      token,
    });
  }

  adRewardWater(token: string, amount: number) {
    return this.request<unknown>('/farm/ad-reward', {
      method: 'POST',
      body: { type: 'water', amount },
      token,
    });
  }

  hamsterGift(token: string) {
    return this.request<{ waterEarned: number }>('/pets/hamster/gift', {
      method: 'POST',
      token,
    });
  }

  checkinWater(token: string) {
    return this.request<unknown>('/quests/checkin', {
      method: 'POST',
      body: { type: 'water' },
      token,
    });
  }

  friendsList(token: string) {
    return this.request<{ friends: { id: string; nickname: string }[] }>('/friends', { token });
  }

  friendsAdd(token: string, code: string) {
    return this.request<unknown>('/friends/add', {
      method: 'POST',
      body: { code },
      token,
    });
  }

  inviteCode(token: string) {
    return this.request<{ code: string }>('/friends/invite-code', { token });
  }

  greetFriend(token: string, friendId: string) {
    return this.request<unknown>(`/friends/${friendId}/greet`, {
      method: 'POST',
      token,
    });
  }

  waterFriend(token: string, friendId: string) {
    return this.request<unknown>(`/friends/${friendId}/water`, {
      method: 'POST',
      token,
    });
  }

  gamesList(token: string) {
    return this.request<{ games: { id: string; reward_type: string; claimed: boolean }[] }>('/games', {
      token,
    });
  }

  gameClaim(token: string, gameId: string) {
    return this.request<unknown>(`/games/${gameId}/claim`, {
      method: 'POST',
      token,
    });
  }

  petsList(token: string) {
    return this.request<{ pets: unknown[] }>('/pets', { token });
  }
}
