import { createHmac, timingSafeEqual } from 'crypto';

const MAX_AUTH_AGE_SEC = 86400;

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export function verifyTelegramInitData(initData: string, botToken: string): boolean {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  const authDateRaw = params.get('auth_date');
  if (authDateRaw) {
    const authDate = parseInt(authDateRaw, 10);
    if (!Number.isFinite(authDate)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > MAX_AUTH_AGE_SEC) return false;
  }

  params.delete('hash');
  const pairs = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  try {
    const a = Buffer.from(calculated, 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseTelegramUser(initData: string): TelegramWebAppUser | null {
  const params = new URLSearchParams(initData);
  const raw = params.get('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TelegramWebAppUser;
  } catch {
    return null;
  }
}

export function syntheticTelegramEmail(telegramId: number): string {
  return `tg${telegramId}@telegram.boostfarm`;
}
