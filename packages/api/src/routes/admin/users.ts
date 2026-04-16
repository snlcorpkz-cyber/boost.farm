import { Router } from 'express';
import { query, queryOne, execute } from '../../lib/db.js';

export const adminUsersRouter = Router();

adminUsersRouter.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset = (page - 1) * limit;
    const search = (req.query.search as string || '').trim();
    const rank = req.query.rank as string || '';
    const platform = req.query.platform as string || '';
    const country = req.query.country as string || '';

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let pi = 0;

    if (search) {
      pi++;
      where += ` AND (u.email ILIKE $${pi} OR u.nickname ILIKE $${pi} OR u.id::text ILIKE $${pi})`;
      params.push(`%${search}%`);
    }
    if (rank) {
      pi++;
      where += ` AND f.rank_id = $${pi}`;
      params.push(rank);
    }
    if (platform) {
      pi++;
      where += ` AND u.device_platform = $${pi}`;
      params.push(platform);
    }
    if (country) {
      pi++;
      where += ` AND u.country = $${pi}`;
      params.push(country);
    }

    const countRow = await queryOne(
      `SELECT count(*)::int AS c FROM users u LEFT JOIN farms f ON f.user_id = u.id AND f.harvested = false ${where}`,
      params
    );

    const rows = await query(
      `SELECT
        u.id, u.nickname, u.email, u.avatar_id, u.is_admin,
        u.created_at, u.last_login_at, u.last_active_at,
        u.registration_source, u.device_platform, u.country,
        u.telegram_id,
        f.rank_id, f.current_stage, f.growth_percent, f.water_in_can,
        f.nutrition, f.total_water_this_month,
        (SELECT count(*)::int FROM friends fr WHERE fr.user_id = u.id) AS friends_count,
        (SELECT coalesce(sum(count), 0)::int FROM ad_views av WHERE av.user_id = u.id) AS total_ad_views
       FROM users u
       LEFT JOIN farms f ON f.user_id = u.id AND f.harvested = false
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $${pi + 1} OFFSET $${pi + 2}`,
      [...params, limit, offset]
    );

    res.json({
      users: rows,
      total: countRow?.c || 0,
      page,
      limit,
    });
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

adminUsersRouter.get('/:id', async (req, res) => {
  try {
    const user = await queryOne(
      `SELECT u.*, f.rank_id, f.current_stage, f.growth_percent, f.water_in_can,
              f.nutrition, f.total_water_this_month, f.total_water_last_month,
              f.product_id, p.name_key AS product_name, f.harvested,
              f.bucket_last_collected_at, f.water_in_bucket
       FROM users u
       LEFT JOIN farms f ON f.user_id = u.id AND f.harvested = false
       LEFT JOIN products p ON p.id = f.product_id
       WHERE u.id = $1`,
      [req.params.id]
    );
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const [friends, recentEvents, referrals, pushTokens] = await Promise.all([
      query(
        `SELECT u.id, u.nickname, u.avatar_id FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = $1`,
        [req.params.id]
      ),
      query(
        `SELECT event_name, properties, created_at FROM events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.params.id]
      ),
      query(
        `SELECT r.invite_code, r.completed, r.created_at,
                inv.nickname AS invitee_nickname, inv.email AS invitee_email
         FROM referrals r LEFT JOIN users inv ON inv.id = r.invitee_id
         WHERE r.inviter_id = $1 ORDER BY r.created_at DESC`,
        [req.params.id]
      ),
      query(
        `SELECT token, platform, created_at FROM push_tokens WHERE user_id = $1`,
        [req.params.id]
      ),
    ]);

    res.json({ ...user, friends, recentEvents, referrals, pushTokens });
  } catch (err) {
    console.error('[admin/users/:id]', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

adminUsersRouter.post('/:id/grant', async (req, res) => {
  try {
    const { type, amount } = req.body;
    if (!['water', 'nutrition'].includes(type) || !amount || amount <= 0) {
      res.status(400).json({ error: 'Invalid type or amount' });
      return;
    }

    const col = type === 'water' ? 'water_in_can' : 'nutrition';
    const cap = type === 'nutrition' ? 'LEAST(nutrition + $2, 10000)' : `${col} + $2`;
    await execute(
      `UPDATE farms SET ${col} = ${cap} WHERE user_id = $1 AND harvested = false`,
      [req.params.id, amount]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[admin/users/grant]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminUsersRouter.post('/:id/toggle-admin', async (req, res) => {
  try {
    const user = await queryOne(`SELECT is_admin FROM users WHERE id = $1`, [req.params.id]);
    if (!user) { res.status(404).json({ error: 'Not found' }); return; }

    await execute(`UPDATE users SET is_admin = $2 WHERE id = $1`, [req.params.id, !user.is_admin]);
    res.json({ is_admin: !user.is_admin });
  } catch (err) {
    console.error('[admin/users/toggle-admin]', err);
    res.status(500).json({ error: 'Failed' });
  }
});
