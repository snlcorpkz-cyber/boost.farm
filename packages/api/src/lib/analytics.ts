import { Request } from 'express';
import { execute, queryOne } from './db.js';
import geoip from 'geoip-lite';

interface DeviceInfo {
  platform?: string;
  screen?: string;
  language?: string;
  userAgent?: string;
}

export interface GeoInfo {
  country?: string; // ISO-3166-1 alpha-2, e.g. "US", "RU", "KZ"
  region?: string;  // subdivision code, e.g. "CA"
  city?: string;
  timezone?: string;
}

function parseDeviceInfo(req: Request): DeviceInfo {
  try {
    const raw = req.get('x-device-info');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    userAgent: req.get('user-agent') || '',
    platform: req.get('user-agent')?.includes('Android') ? 'android' : 'web',
  };
}

/**
 * Resolve IP → country/city. We prefer trusted CDN headers first (Cloudflare
 * sets `cf-ipcountry`), then fall back to the offline MaxMind GeoLite2 DB via
 * `geoip-lite`. Both are best-effort; we never block the request on this.
 */
export function resolveGeo(req: Request): GeoInfo {
  const cfCountry = req.get('cf-ipcountry');
  const cfRegion = req.get('cf-region-code');
  const cfCity = req.get('cf-ipcity');
  if (cfCountry && cfCountry !== 'XX') {
    return {
      country: cfCountry.toUpperCase(),
      region: cfRegion || undefined,
      city: cfCity || undefined,
    };
  }

  const ip = getIp(req);
  if (!ip) return {};

  try {
    const lookup = geoip.lookup(ip);
    if (!lookup) return {};
    return {
      country: lookup.country,
      region: lookup.region,
      city: lookup.city,
      timezone: lookup.timezone,
    };
  } catch {
    return {};
  }
}

export function getIp(req: Request): string | null {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  // Cloudflare-specific; more reliable than x-forwarded-for
  const cfIp = req.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  return req.ip || null;
}

/**
 * Record a generic user event. Auto-fills device/geo/ip/session when a request
 * object is provided. Never throws — analytics must not break the user flow.
 */
export async function trackEvent(
  userId: string,
  eventName: string,
  properties: Record<string, any> = {},
  req?: Request,
  sessionId?: string,
): Promise<void> {
  try {
    const device = req ? parseDeviceInfo(req) : {};
    const geo = req ? resolveGeo(req) : {};
    const ip = req ? getIp(req) : null;
    const sid = sessionId || (req as any)?.user?.sessionId || null;

    await execute(
      `INSERT INTO events (user_id, event_name, properties, device, geo, session_id, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7::inet)`,
      [
        userId,
        eventName,
        JSON.stringify(properties),
        JSON.stringify(device),
        JSON.stringify(geo),
        sid,
        ip,
      ],
    );

    // Keep the session row fresh so admin can see "X events, still active".
    if (sid) {
      await execute(
        `UPDATE sessions SET events_count = events_count + 1, ended_at = now()
         WHERE id = $1`,
        [sid],
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[analytics] trackEvent error:', (err as Error).message);
  }
}

export async function updateLastActive(userId: string): Promise<void> {
  try {
    await execute(
      `UPDATE users SET last_active_at = now() WHERE id = $1`,
      [userId],
    );
  } catch { /* non-critical */ }
}

/**
 * Create a new analytics session row. Called on each login. We also store
 * this session id inside the JWT so every subsequent `trackEvent` can stitch
 * back to it — giving us accurate session duration.
 */
export async function startSession(
  userId: string,
  sessionId: string,
  req?: Request,
): Promise<void> {
  try {
    const device = req ? parseDeviceInfo(req) : {};
    const geo = req ? resolveGeo(req) : {};
    const ip = req ? getIp(req) : null;
    await execute(
      `INSERT INTO sessions (id, user_id, device, geo, ip, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5::inet, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [sessionId, userId, JSON.stringify(device), JSON.stringify(geo), ip],
    );
  } catch (err) {
    console.error('[analytics] startSession error:', (err as Error).message);
  }
}

/**
 * Mark the session as ended and compute duration. Called on explicit logout
 * or by the cron when it hits inactivity timeout.
 */
export async function endSession(sessionId: string): Promise<void> {
  try {
    await execute(
      `UPDATE sessions
       SET ended_at = COALESCE(ended_at, now()),
           duration_sec = GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))::int)
       WHERE id = $1 AND duration_sec IS NULL`,
      [sessionId],
    );
  } catch (err) {
    console.error('[analytics] endSession error:', (err as Error).message);
  }
}

/**
 * Heartbeat from client — extends the session's "last seen" marker. We don't
 * close the session here; that's done by the cron after inactivity timeout.
 */
export async function pingSession(sessionId: string): Promise<void> {
  try {
    await execute(
      `UPDATE sessions SET ended_at = now() WHERE id = $1 AND duration_sec IS NULL`,
      [sessionId],
    );
  } catch { /* non-critical */ }
}

/**
 * One-shot backfill for user.country / user.device_platform on first request
 * after login. Safe to call repeatedly — we only set it when still empty so
 * we don't flip the cohort if a user travels.
 */
export async function enrichUserProfile(userId: string, req: Request): Promise<void> {
  try {
    const geo = resolveGeo(req);
    const device = parseDeviceInfo(req);
    if (!geo.country && !device.platform) return;
    await execute(
      `UPDATE users SET
         country = COALESCE(country, $2),
         device_platform = COALESCE(device_platform, $3),
         last_active_at = now()
       WHERE id = $1`,
      [userId, geo.country || null, device.platform || null],
    );
  } catch { /* non-critical */ }
}

// Swallow lint for unused import
export { queryOne };
