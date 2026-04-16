import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';
import { queryOne } from '../lib/db.js';

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    req.user = payload;

    const user = await queryOne(
      `SELECT is_admin FROM users WHERE id = $1`,
      [payload.userId]
    );

    if (!user?.is_admin) {
      res.status(403).json({ error: 'Forbidden: admin access required' });
      return;
    }

    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
