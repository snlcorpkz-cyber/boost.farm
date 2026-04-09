import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne, execute } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';

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

  const updates = updateProfileSchema.parse(req.body);
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

  const notifications = await query(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );

  const unreadCount = notifications.filter((n: any) => !n.read).length;

  res.json({ success: true, data: { notifications, unreadCount } });
});

userRouter.post('/notifications/mark-read', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);

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

userRouter.delete('/account', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  await execute(`DELETE FROM farms WHERE user_id = $1`, [userId]);
  await execute(`DELETE FROM friends WHERE user_id = $1 OR friend_id = $1`, [userId]);
  await execute(`DELETE FROM users WHERE id = $1`, [userId]);

  res.json({ success: true, data: { message: 'Account deleted' } });
});
