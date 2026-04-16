import { Request } from 'express';
import { execute, queryOne } from './db.js';

interface DeviceInfo {
  platform?: string;
  screen?: string;
  language?: string;
  userAgent?: string;
}

interface GeoInfo {
  country?: string;
  city?: string;
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

function parseGeo(_req: Request): GeoInfo {
  return {};
}

function getIp(req: Request): string | null {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || null;
}

export async function trackEvent(
  userId: string,
  eventName: string,
  properties: Record<string, any> = {},
  req?: Request,
  sessionId?: string,
): Promise<void> {
  try {
    const device = req ? parseDeviceInfo(req) : {};
    const geo = req ? parseGeo(req) : {};
    const ip = req ? getIp(req) : null;

    await execute(
      `INSERT INTO events (user_id, event_name, properties, device, geo, session_id, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7::inet)`,
      [userId, eventName, JSON.stringify(properties), JSON.stringify(device), JSON.stringify(geo), sessionId || null, ip]
    );
  } catch (err) {
    console.error('[analytics] trackEvent error:', (err as Error).message);
  }
}

export async function updateLastActive(userId: string): Promise<void> {
  try {
    await execute(
      `UPDATE users SET last_active_at = now() WHERE id = $1`,
      [userId]
    );
  } catch { /* non-critical */ }
}
