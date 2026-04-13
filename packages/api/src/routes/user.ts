import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne, execute } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendPush } from '../lib/push.js';

export const userRouter = Router();
userRouter.use(requireAuth);

const updateProfileSchema = z.object({
  nickname: z.string().min(2).max(20).optional(),
  avatarId: z.string().optional(),
  locale: z.enum(['en', 'ru', 'es']).optional(),
});

userRouter.get('/profile', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const user = await queryOne(`SELECT * FROM users WHERE id = $1`, [userId]);

  if (!user) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    return;
  }

  res.json({ success: true, data: { user } });
});

userRouter.patch('/profile', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  let updates;
  try {
    updates = updateProfileSchema.parse(req.body);
  } catch {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid profile data' } });
    return;
  }
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  if (updates.nickname) { sets.push(`nickname = $${idx++}`); vals.push(updates.nickname); }
  if (updates.avatarId) { sets.push(`avatar_id = $${idx++}`); vals.push(updates.avatarId); }
  if (updates.locale) { sets.push(`locale = $${idx++}`); vals.push(updates.locale); }

  if (!sets.length) {
    const user = await queryOne(`SELECT * FROM users WHERE id = $1`, [userId]);
    res.json({ success: true, data: { user } });
    return;
  }

  vals.push(userId);
  const user = await queryOne(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  );

  res.json({ success: true, data: { user } });
});

userRouter.get('/notifications', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  const rows = await query(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit + 1, offset]
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const notifications = page.map((n: any) => {
    let payload: Record<string, any> = {};
    try {
      payload = typeof n.payload === 'string' ? JSON.parse(n.payload) : (n.payload || {});
    } catch {
      payload = {};
    }
    const { message_key, ...params } = payload;
    return {
      id: n.id,
      type: n.type,
      message_key: message_key || `notif.${n.type}`,
      params,
      created_at: n.created_at,
      read: n.read,
    };
  });

  const unreadRow = await queryOne(
    `SELECT count(*)::int AS cnt FROM notifications WHERE user_id = $1 AND read = false`,
    [userId]
  );

  res.json({
    success: true,
    data: { notifications, unreadCount: unreadRow?.cnt ?? 0, hasMore, nextOffset: offset + limit },
  });
});

userRouter.post('/notifications/mark-read', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  let ids: string[];
  try {
    ({ ids } = z.object({ ids: z.array(z.string()) }).parse(req.body));
  } catch {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid request' } });
    return;
  }

  await execute(
    `UPDATE notifications SET read = true WHERE user_id = $1 AND id = ANY($2)`,
    [userId, ids]
  );

  const remaining = await query(
    `SELECT id FROM notifications WHERE user_id = $1 AND read = false`,
    [userId]
  );

  res.json({ success: true, data: { unreadCount: remaining.length } });
});

userRouter.post('/push-token', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { token, platform } = req.body || {};
  if (!token || typeof token !== 'string') {
    res.status(400).json({ success: false, error: { code: 'INVALID', message: 'token is required' } });
    return;
  }
  await execute(
    `INSERT INTO push_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, token) DO NOTHING`,
    [userId, token, platform || 'android']
  );
  res.json({ success: true, data: { saved: true } });
});

userRouter.post('/test-push', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const tokens = await query(`SELECT token FROM push_tokens WHERE user_id = $1`, [userId]);
  if (!tokens.length) {
    res.json({ success: false, error: { code: 'NO_TOKEN', message: `No push tokens found for user ${userId}` } });
    return;
  }
  const ok = await sendPush(userId, 'Test Push', 'If you see this, push notifications work!', { type: 'test' });
  res.json({ success: true, data: { sent: ok, tokenCount: tokens.length } });
});

userRouter.delete('/account', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  await execute(`DELETE FROM farms WHERE user_id = $1`, [userId]);
  await execute(`DELETE FROM friends WHERE user_id = $1 OR friend_id = $1`, [userId]);
  await execute(`DELETE FROM users WHERE id = $1`, [userId]);

  res.json({ success: true, data: { message: 'Account deleted' } });
});
