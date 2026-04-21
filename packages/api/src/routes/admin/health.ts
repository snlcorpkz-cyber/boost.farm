import { Router } from 'express';
import { queryOne } from '../../lib/db.js';

export const adminHealthRouter = Router();

/**
 * Health / Test Center — one-shot self-check of the critical backend
 * dependencies surfaced in the admin panel. Each probe is wrapped in its
 * own try/catch so a single failing network call can't take the whole
 * page down; the front-end renders per-check status pills.
 *
 * Status semantics:
 *   ok    — healthy or properly configured
 *   warn  — optional or degraded (missing env var, slow response, etc.)
 *   fail  — outright broken — user action required
 */

type HealthStatus = 'ok' | 'warn' | 'fail';

interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
  latencyMs?: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function checkDatabase(): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const row = await withTimeout(
      queryOne<{ one: number }>(`SELECT 1::int AS one`),
      5_000,
      'db',
    );
    const latencyMs = Date.now() - started;
    if (!row || row.one !== 1) {
      return {
        id: 'db',
        label: 'PostgreSQL',
        status: 'fail',
        detail: 'SELECT 1 returned an unexpected value',
        latencyMs,
      };
    }
    return {
      id: 'db',
      label: 'PostgreSQL',
      status: latencyMs > 1500 ? 'warn' : 'ok',
      detail:
        latencyMs > 1500
          ? `Database is slow (${latencyMs}ms) — check pooler / network`
          : `Connected (${latencyMs}ms)`,
      latencyMs,
    };
  } catch (err: any) {
    return {
      id: 'db',
      label: 'PostgreSQL',
      status: 'fail',
      detail: err?.message ?? 'Unable to reach database',
      latencyMs: Date.now() - started,
    };
  }
}

async function checkResend(): Promise<HealthCheck> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return {
      id: 'resend',
      label: 'Resend (email)',
      status: 'warn',
      detail: 'RESEND_API_KEY is not set — outbound email disabled',
    };
  }
  const started = Date.now();
  try {
    const res = await withTimeout(
      fetch('https://api.resend.com/api-keys', {
        headers: { Authorization: `Bearer ${key}` },
      }),
      5_000,
      'resend',
    );
    const latencyMs = Date.now() - started;
    if (res.ok) {
      return {
        id: 'resend',
        label: 'Resend (email)',
        status: 'ok',
        detail: `API key accepted (${res.status})`,
        latencyMs,
      };
    }
    return {
      id: 'resend',
      label: 'Resend (email)',
      status: 'fail',
      detail: `Resend rejected the API key: HTTP ${res.status}`,
      latencyMs,
    };
  } catch (err: any) {
    return {
      id: 'resend',
      label: 'Resend (email)',
      status: 'fail',
      detail: err?.message ?? 'Unable to reach api.resend.com',
      latencyMs: Date.now() - started,
    };
  }
}

async function checkTelegram(): Promise<HealthCheck> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return {
      id: 'telegram',
      label: 'Telegram bot',
      status: 'warn',
      detail: 'TELEGRAM_BOT_TOKEN is not set — Mini App integration disabled',
    };
  }
  const started = Date.now();
  try {
    const res = await withTimeout(
      fetch(`https://api.telegram.org/bot${token}/getMe`),
      5_000,
      'telegram',
    );
    const latencyMs = Date.now() - started;
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; result?: { username?: string }; description?: string }
      | null;
    if (res.ok && body?.ok) {
      const username = body.result?.username ?? 'unknown';
      return {
        id: 'telegram',
        label: 'Telegram bot',
        status: 'ok',
        detail: `getMe ok — @${username}`,
        latencyMs,
      };
    }
    return {
      id: 'telegram',
      label: 'Telegram bot',
      status: 'fail',
      detail: body?.description ?? `HTTP ${res.status}`,
      latencyMs,
    };
  } catch (err: any) {
    return {
      id: 'telegram',
      label: 'Telegram bot',
      status: 'fail',
      detail: err?.message ?? 'Unable to reach api.telegram.org',
      latencyMs: Date.now() - started,
    };
  }
}

function checkGoogleOAuth(): HealthCheck {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return {
      id: 'google_oauth',
      label: 'Google OAuth',
      status: 'warn',
      detail: 'GOOGLE_CLIENT_ID is not set — Sign-in-with-Google is disabled',
    };
  }
  return {
    id: 'google_oauth',
    label: 'Google OAuth',
    status: 'ok',
    detail: `Client ID configured (${clientId.slice(0, 12)}…)`,
  };
}

function checkLevelPlay(): HealthCheck {
  // The LevelPlay dashboard doesn't expose a cheap admin API, so we rely on
  // an explicit env flag the ops team flips after the Android app key has
  // been wired into apps/android/keystore.properties and the app has been
  // rebuilt. Kept as a `warn` until then so the page surfaces the TODO.
  const configured = (process.env.LEVELPLAY_CONFIGURED ?? '').toLowerCase();
  if (configured === 'true' || configured === '1' || configured === 'yes') {
    return {
      id: 'levelplay',
      label: 'LevelPlay (ironSource)',
      status: 'ok',
      detail: 'LEVELPLAY_CONFIGURED=true — dashboard + Android key verified',
    };
  }
  return {
    id: 'levelplay',
    label: 'LevelPlay (ironSource)',
    status: 'warn',
    detail:
      'Set LEVELPLAY_CONFIGURED=true in the server .env once the Android app key and placements (water_popup, fert_popup) are live in the LevelPlay dashboard.',
  };
}

async function checkPushCron(): Promise<HealthCheck> {
  // Cron status is reported without touching Firebase internals — we only
  // look at when the cron last wrote a row. Firebase / FCM health is owned
  // by a parallel branch and intentionally NOT probed here.
  try {
    const row = await withTimeout(
      queryOne<{ last_run: string | null }>(
        `SELECT max(created_at)::text AS last_run FROM push_logs`,
      ),
      3_000,
      'push_cron',
    );
    if (!row?.last_run) {
      return {
        id: 'push_cron',
        label: 'Push cron',
        status: 'warn',
        detail: 'No push_logs rows yet — cron has not executed a campaign',
      };
    }
    const lastRun = new Date(row.last_run);
    const ageMs = Date.now() - lastRun.getTime();
    const hours = Math.round(ageMs / 3_600_000);
    if (hours > 24) {
      return {
        id: 'push_cron',
        label: 'Push cron',
        status: 'warn',
        detail: `Last push_logs entry was ${hours}h ago`,
      };
    }
    return {
      id: 'push_cron',
      label: 'Push cron',
      status: 'ok',
      detail: `Last push_logs entry: ${lastRun.toISOString()}`,
    };
  } catch (err: any) {
    const msg: string = err?.message ?? '';
    // The push_logs table may not exist yet in fresh environments.
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return {
        id: 'push_cron',
        label: 'Push cron',
        status: 'warn',
        detail: 'push_logs table is missing — cron has never been run',
      };
    }
    return {
      id: 'push_cron',
      label: 'Push cron',
      status: 'warn',
      detail: msg || 'Unable to read push_logs',
    };
  }
}

adminHealthRouter.get('/', async (_req, res) => {
  try {
    const [db, resend, telegram, pushCron] = await Promise.all([
      checkDatabase(),
      checkResend(),
      checkTelegram(),
      checkPushCron(),
    ]);

    const checks: HealthCheck[] = [
      db,
      resend,
      telegram,
      checkGoogleOAuth(),
      checkLevelPlay(),
      pushCron,
    ];

    const overall: HealthStatus = checks.some((c) => c.status === 'fail')
      ? 'fail'
      : checks.some((c) => c.status === 'warn')
        ? 'warn'
        : 'ok';

    res.json({
      status: overall,
      checkedAt: new Date().toISOString(),
      checks,
    });
  } catch (err: any) {
    console.error('[admin/health] unexpected error', err);
    res.status(500).json({ error: err?.message ?? 'health check failed' });
  }
});
