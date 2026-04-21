import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { trackEvent, enrichUserProfile } from '../lib/analytics.js';
import { isKnownEvent } from '../analytics/registry.js';

export const trackRouter = Router();

/**
 * POST /api/track
 * Body: { events: Array<TrackedEvent> }
 *
 * Batched client-side analytics ingestion. Called by both the web trackClient
 * and the Android JS bridge forwarder. Never throws — analytics must never
 * take down the user flow. Unknown event names are still accepted (so the
 * client can roll out new events ahead of a server deploy) but we flag them
 * in `properties.__unknown` so ops can spot typos in admin/logs.
 */

interface TrackedEvent {
  name: string;
  ts?: number;          // client timestamp (informational only)
  props?: Record<string, any>;
  placement?: string;
  platform?: string;
  app_version?: string;
  revenue_cents?: number;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
}

const MAX_EVENTS_PER_REQUEST = 50;
const MAX_NAME_LEN = 80;
const MAX_PROP_KEYS = 30;

function coerceProps(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== 'object') return {};
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, MAX_PROP_KEYS);
  const out: Record<string, any> = {};
  for (const [k, v] of entries) {
    if (typeof v === 'string' && v.length > 512) {
      out[k] = v.slice(0, 512) + '…';
    } else if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      v === null
    ) {
      out[k] = v;
    } else if (typeof v === 'object') {
      // Shallow allow — stringify to cap recursion depth.
      try {
        const s = JSON.stringify(v);
        out[k] = s.length > 512 ? s.slice(0, 512) + '…' : JSON.parse(s);
      } catch {
        /* drop non-serializable values */
      }
    }
  }
  return out;
}

trackRouter.post(
  '/',
  requireAuth,
  rateLimit(120, 60_000),
  async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const raw = req.body?.events;
    if (!Array.isArray(raw)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'events must be an array' } });
      return;
    }
    if (raw.length === 0) {
      res.json({ success: true, data: { accepted: 0 } });
      return;
    }
    if (raw.length > MAX_EVENTS_PER_REQUEST) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: `events batch exceeds ${MAX_EVENTS_PER_REQUEST}` } });
      return;
    }

    // Opportunistically fill country/platform/utm on users for attribution
    // dashboards — runs once per request, not once per event.
    enrichUserProfile(userId, req).catch(() => {});

    let accepted = 0;
    await Promise.all(
      (raw as TrackedEvent[]).map(async (evt) => {
        if (!evt || typeof evt.name !== 'string') return;
        const name = evt.name.trim().slice(0, MAX_NAME_LEN);
        if (!name) return;

        const props = coerceProps(evt.props);
        if (!isKnownEvent(name)) {
          // Flag for ops without dropping — helps catch typos.
          props.__unknown = true;
        }

        await trackEvent(
          userId,
          name,
          props,
          req,
          req.user?.sessionId,
          {
            placement: evt.placement ?? null,
            platform: evt.platform ?? null,
            appVersion: evt.app_version ?? null,
            revenueCents:
              typeof evt.revenue_cents === 'number' && Number.isFinite(evt.revenue_cents)
                ? Math.round(evt.revenue_cents)
                : null,
            utm: {
              source: evt.utm?.source ?? null,
              medium: evt.utm?.medium ?? null,
              campaign: evt.utm?.campaign ?? null,
            },
          },
        );
        accepted++;
      }),
    );

    res.json({ success: true, data: { accepted } });
  },
);
