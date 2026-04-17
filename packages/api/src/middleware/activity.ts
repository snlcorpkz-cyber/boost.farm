import { Request, Response, NextFunction } from 'express';
import { trackEvent, updateLastActive, pingSession } from '../lib/analytics.js';

/**
 * Records an event for every successful state-changing request (POST/PUT/DELETE)
 * and pings the analytics session so admin sees live activity. GET requests are
 * deliberately ignored to keep the events table sane — they're just reads.
 *
 * Per-route identifiers are derived from `req.baseUrl + req.path` so
 * "/farm/water" becomes event "farm.water", "/friends/:id/greet" becomes
 * "friends.greet" (after stripping param values).
 *
 * Properties captured:
 *   - request body (minus obvious secrets like refreshToken/idToken/code)
 *   - query params
 *   - response status code (added on finish)
 */

const SENSITIVE_BODY_KEYS = new Set([
  'refreshToken',
  'idToken',
  'code',
  'initData',
  'password',
  'token',
]);

function scrubBody(body: any): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE_BODY_KEYS.has(k)) continue;
    // Keep payloads small — truncate long strings and skip binary.
    if (typeof v === 'string' && v.length > 256) out[k] = v.slice(0, 256) + '…';
    else if (typeof v === 'object' && v !== null) out[k] = v;
    else out[k] = v;
  }
  return out;
}

function buildEventName(req: Request): string {
  const base = (req.baseUrl || '').replace(/^\/+|\/+$/g, '');
  // Remove leading `api/` if someone mounted it that way.
  const baseClean = base.replace(/^api\//, '');
  const pathClean = req.route?.path
    ? req.route.path.replace(/^\/+|\/+$/g, '').replace(/:([a-zA-Z0-9_]+)/g, '$1')
    : (req.path || '').replace(/^\/+|\/+$/g, '').replace(/[0-9a-f-]{8,}/gi, 'id');
  const segments = [baseClean, pathClean].filter(Boolean).join('/');
  const cleaned = segments.replace(/\//g, '.').replace(/\.+/g, '.');
  return cleaned || 'http.unknown';
}

export function activityTracker(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user?.userId;
  if (!userId) return next();

  // Keep lastActive + session heartbeat up to date for ALL authenticated calls.
  updateLastActive(userId);
  if (req.user?.sessionId) pingSession(req.user.sessionId);

  // Only log mutating requests as events — reads would flood the table.
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const props = {
    ...scrubBody(req.body),
    query: req.query && Object.keys(req.query).length ? req.query : undefined,
    method: req.method,
  };

  const origJson = res.json.bind(res);
  let logged = false;

  res.json = function (body: any) {
    if (!logged) {
      logged = true;
      // Only log successful state changes. Errors are captured separately by
      // the Express error handler if needed.
      if (res.statusCode < 400) {
        trackEvent(userId, buildEventName(req), props, req, req.user?.sessionId).catch(() => {});
      }
    }
    return origJson(body);
  };

  // Fallback — in case the handler uses res.send() or res.end() without json().
  res.on('finish', () => {
    if (!logged && res.statusCode < 400) {
      logged = true;
      trackEvent(userId, buildEventName(req), props, req, req.user?.sessionId).catch(() => {});
    }
  });

  next();
}
