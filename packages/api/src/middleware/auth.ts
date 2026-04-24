import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../lib/jwt.js';
import { queryOne } from '../lib/db.js';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

const sessionCache = new Map<string, { sessionId: string; ts: number }>();
const CACHE_TTL = 60_000;

/**
 * Cookie name used to mirror the Bearer JWT for `navigator.sendBeacon`
 * requests, which cannot attach Authorization headers. Setting it on every
 * authenticated response means analytics flushes that happen on WebView
 * `visibilitychange → hidden` (e.g. when a rewarded ad opens fullscreen)
 * still authenticate correctly — otherwise up to ~70% of ad telemetry
 * silently 401s and never lands in `events`.
 *
 * - HttpOnly: avoids XSS token leaks; JS on the page never needs it.
 * - SameSite=Lax: enough for same-origin sendBeacon + standard nav.
 * - Secure: set when the request came in over HTTPS (behind a TLS proxy
 *   we trust `x-forwarded-proto` because `app.set('trust proxy', 1)`).
 * - 7-day sliding window: refreshed on every authed request via
 *   `refreshEcoTokenCookie`, so as long as the user is active we never
 *   fall back to "needs re-login for analytics".
 */
const ECO_TOKEN_COOKIE = 'eco_token';
const ECO_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  // Minimal manual parser — avoids pulling in cookie-parser just for
  // a single cookie read. Cookie header: "a=1; b=2; eco_token=eyJ…".
  const parts = header.split(';');
  for (const raw of parts) {
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    const k = raw.slice(0, eq).trim();
    if (k !== name) continue;
    const v = raw.slice(eq + 1).trim();
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

function refreshEcoTokenCookie(req: Request, res: Response, token: string): void {
  if (res.headersSent) return;
  const secure =
    req.secure || (req.get('x-forwarded-proto') ?? '').toLowerCase() === 'https';
  const attrs = [
    `${ECO_TOKEN_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${ECO_TOKEN_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attrs.push('Secure');
  // Don't clobber Set-Cookie on endpoints that may already issue their
  // own cookies (we don't today, but future-proof) — append instead.
  const prev = res.getHeader('Set-Cookie');
  const value = attrs.join('; ');
  if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev, value]);
  } else if (typeof prev === 'string') {
    res.setHeader('Set-Cookie', [prev, value]);
  } else {
    res.setHeader('Set-Cookie', value);
  }
}

/**
 * Resolve the caller's JWT from either the `Authorization: Bearer …` header
 * or the `eco_token` cookie. The header wins when both are present so legacy
 * (or malicious) cookies can't be used to impersonate a fresher Bearer.
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return readCookie(req, ECO_TOKEN_COOKIE);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;

    // Mirror the Bearer token into `eco_token` cookie on every authed
    // response. This is what unlocks sendBeacon-based analytics without
    // shipping a new bundle / APK — the next visibility-change flush on
    // the same session will carry this cookie and authenticate fine.
    refreshEcoTokenCookie(req, res, token);

    if (payload.sessionId) {
      const cached = sessionCache.get(payload.userId);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        if (cached.sessionId !== payload.sessionId) {
          res.status(401).json({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Logged in on another device' } });
          return;
        }
        next();
        return;
      }

      queryOne(`SELECT session_id FROM users WHERE id = $1`, [payload.userId])
        .then((user) => {
          if (user?.session_id) {
            sessionCache.set(payload.userId, { sessionId: user.session_id, ts: Date.now() });
            if (user.session_id !== payload.sessionId) {
              res.status(401).json({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Logged in on another device' } });
              return;
            }
          }
          next();
        })
        .catch(() => {
          next();
        });
      return;
    }

    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Invalid or expired token' } });
  }
}
