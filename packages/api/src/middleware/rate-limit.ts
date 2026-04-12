import { Request, Response, NextFunction } from 'express';

const requests = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of requests) {
    if (now > entry.resetAt) requests.delete(key);
  }
}, 60_000);

export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if ((req as Request & { skipGlobalRateLimit?: boolean }).skipGlobalRateLimit) {
      next();
      return;
    }

    const userId = req.user?.userId || req.ip || 'anonymous';
    const key = `${req.path}:${userId}`;
    const now = Date.now();

    const entry = requests.get(key);
    if (!entry || now > entry.resetAt) {
      requests.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });
      return;
    }

    entry.count++;
    next();
  };
}

export function globalRateLimit(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if ((req as Request & { skipGlobalRateLimit?: boolean }).skipGlobalRateLimit) {
      next();
      return;
    }
    const ip = req.ip || 'unknown';
    const key = `global:${ip}`;
    const now = Date.now();

    const entry = requests.get(key);
    if (!entry || now > entry.resetAt) {
      requests.set(key, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }

    if (entry.count >= maxPerMinute) {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });
      return;
    }

    entry.count++;
    next();
  };
}
