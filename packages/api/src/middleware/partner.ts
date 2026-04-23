import { Request, Response, NextFunction } from 'express';
import { verifyPartnerToken, type PartnerTokenPayload } from '../lib/partner-jwt.js';

declare global {
  namespace Express {
    interface Request {
      partner?: PartnerTokenPayload;
    }
  }
}

/**
 * Authenticates a partner-portal request. On success attaches
 * `req.partner` with the JWT payload. The payload carries `partnerId`
 * which every SQL query in partner routes MUST filter on — there's no
 * implicit isolation, it's per-query discipline.
 */
export function requirePartner(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    return;
  }
  try {
    const token = authHeader.slice(7);
    req.partner = verifyPartnerToken(token);
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Invalid or expired token' } });
  }
}
