import { Router } from 'express';
import { query, queryOne } from '../../lib/db.js';

export const adminDashboardRouter = Router();

adminDashboardRouter.get('/stats', async (_req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const [
      totalUsers,
      newUsersToday,
      activeFarms,
      dauRow,
      wauRow,
      mauRow,
      adViewsToday,
      totalAdViews,
      avgWater,
      rankDist,
      stageDist,
      recentUsers,
    ] = await Promise.all([
      queryOne(`SELECT count(*)::int AS c FROM users`),
      queryOne(`SELECT count(*)::int AS c FROM users WHERE created_at::date = $1`, [today]),
      queryOne(`SELECT count(*)::int AS c FROM farms WHERE harvested = false`),
      queryOne(`SELECT count(DISTINCT user_id)::int AS c FROM events WHERE created_at::date = $1`, [today]),
      queryOne(`SELECT count(DISTINCT user_id)::int AS c FROM events WHERE created_at >= $1`, [weekAgo]),
      queryOne(`SELECT count(DISTINCT user_id)::int AS c FROM events WHERE created_at >= $1`, [monthAgo]),
      queryOne(`SELECT coalesce(sum(count), 0)::int AS c FROM ad_views WHERE view_date = $1`, [today]),
      queryOne(`SELECT coalesce(sum(count), 0)::int AS c FROM ad_views`),
      queryOne(`SELECT coalesce(avg(water_in_can), 0)::float AS v FROM farms WHERE harvested = false`),
      query(`SELECT rank_id, count(*)::int AS c FROM farms WHERE harvested = false GROUP BY rank_id ORDER BY c DESC`),
      query(`SELECT current_stage, count(*)::int AS c FROM farms WHERE harvested = false GROUP BY current_stage ORDER BY current_stage`),
      query(`SELECT id, nickname, email, avatar_id, created_at FROM users ORDER BY created_at DESC LIMIT 10`),
    ]);

    const dauFallback = dauRow?.c || 0;
    const wauFallback = wauRow?.c || 0;
    const mauFallback = mauRow?.c || 0;

    let dauYesterday = 0;
    try {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const r = await queryOne(`SELECT count(DISTINCT user_id)::int AS c FROM events WHERE created_at::date = $1`, [yesterday]);
      dauYesterday = r?.c || 0;
    } catch { /* events table may be empty */ }

    res.json({
      totalUsers: totalUsers?.c || 0,
      newUsersToday: newUsersToday?.c || 0,
      activeFarms: activeFarms?.c || 0,
      dau: dauFallback,
      wau: wauFallback,
      mau: mauFallback,
      dauYesterday,
      adViewsToday: adViewsToday?.c || 0,
      totalAdViews: totalAdViews?.c || 0,
      avgWaterInCan: Math.round((avgWater?.v || 0) * 10) / 10,
      rankDistribution: rankDist || [],
      stageDistribution: stageDist || [],
      recentUsers: recentUsers || [],
    });
  } catch (err) {
    console.error('[admin/dashboard]', err);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

adminDashboardRouter.get('/chart/dau', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const rows = await query(
      `SELECT created_at::date AS day, count(DISTINCT user_id)::int AS dau
       FROM events
       WHERE created_at >= now() - ($1 || ' days')::interval
       GROUP BY day ORDER BY day`,
      [days]
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin/chart/dau]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminDashboardRouter.get('/chart/new-users', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const rows = await query(
      `SELECT created_at::date AS day, count(*)::int AS new_users
       FROM users
       WHERE created_at >= now() - ($1 || ' days')::interval
       GROUP BY day ORDER BY day`,
      [days]
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin/chart/new-users]', err);
    res.status(500).json({ error: 'Failed' });
  }
});
