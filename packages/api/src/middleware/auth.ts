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

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    req.user = payload;

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
