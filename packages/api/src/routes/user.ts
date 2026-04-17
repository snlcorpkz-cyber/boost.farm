import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne, execute } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { activityTracker } from '../middleware/activity.js';
import { sendPush } from '../lib/push.js';
import { endSession } from '../lib/analytics.js';

export const userRouter = Router();
userRouter.use(requireAuth);
userRouter.use(activityTracker);

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

userRouter.post('/push-opened', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { campaignId } = req.body || {};
  if (!campaignId) {
    res.status(400).json({ success: false, error: { code: 'INVALID', message: 'campaignId is required' } });
    return;
  }
  try {
    // H-5: only bump the campaign "opened" counter if the recipient row
    // transitions from non-opened to opened. Prevents inflated analytics when
    // users tap the same push multiple times or reopen the app.
    const updated = await execute(
      `UPDATE push_campaign_recipients SET status = 'opened', opened_at = now()
       WHERE campaign_id = $1 AND user_id = $2 AND status != 'opened'`,
      [campaignId, userId]
    );
    if (updated > 0) {
      await execute(
        `UPDATE push_campaigns SET opened = opened + 1 WHERE id = $1`,
        [campaignId]
      );
    }
  } catch { /* non-critical */ }
  res.json({ success: true });
});

userRouter.delete('/account', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const sid = req.user?.sessionId;

  // Close the analytics session before cascading the user row away, so we
  // don't lose duration info for the final session.
  if (sid) await endSession(sid).catch(() => {});

  // We rely on ON DELETE CASCADE for most tables; however friends has two FKs
  // to users, and some tables (e.g., referrals) may not cascade invitee-side
  // correctly. Do a best-effort clean first.
  await execute(`DELETE FROM friends WHERE user_id = $1 OR friend_id = $1`, [userId]);
  await execute(`DELETE FROM push_tokens WHERE user_id = $1`, [userId]);
  await execute(`DELETE FROM users WHERE id = $1`, [userId]);

  res.json({ success: true, data: { message: 'Account deleted' } });
});

/**
 * Explicit logout — closes the analytics session so we get an exact duration.
 * Client should call this on the Logout button. We also invalidate server-side
 * session by bumping session_id, forcing any still-valid JWT to be rejected.
 */
userRouter.post('/logout', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const sid = req.user?.sessionId;
  if (sid) await endSession(sid).catch(() => {});
  await execute(`UPDATE users SET session_id = NULL WHERE id = $1`, [userId]).catch(() => {});
  res.json({ success: true });
});

/**
 * Session heartbeat — called by the web client every ~60s while the app is
 * foregrounded. Keeps the session "alive" so the inactivity cron doesn't
 * close it prematurely. Cheap (single UPDATE), safe to call often.
 */
userRouter.post('/session-heartbeat', async (req: Request, res: Response) => {
  const sid = req.user?.sessionId;
  if (!sid) { res.json({ success: true }); return; }
  await execute(
    `UPDATE sessions SET ended_at = now() WHERE id = $1 AND duration_sec IS NULL`,
    [sid],
  ).catch(() => {});
  res.json({ success: true });
});
