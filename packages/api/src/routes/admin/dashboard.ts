import { Router } from 'express';
import { query, queryOne } from '../../lib/db.js';
import { tzExpr, REPORTING_TZ } from '../../lib/reporting-tz.js';

export const adminDashboardRouter = Router();

// All calendar-day bucketing below uses REPORTING_TZ (same axis as
// /admin/retention) so the dashboard and cohort pages agree on "today".
const DAY = (col: string) => `${tzExpr(col)}::date`;
const TODAY = `(now() AT TIME ZONE '${REPORTING_TZ}')::date`;

adminDashboardRouter.get('/stats', async (_req, res) => {
  try {
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
      queryOne(`SELECT count(*)::int AS c FROM users WHERE ${DAY('created_at')} = ${TODAY}`),
      queryOne(`SELECT count(*)::int AS c FROM farms WHERE harvested = false`),
      queryOne(`SELECT count(DISTINCT user_id)::int AS c FROM events WHERE ${DAY('created_at')} = ${TODAY}`),
      queryOne(`SELECT count(DISTINCT user_id)::int AS c FROM events WHERE ${DAY('created_at')} >= ${TODAY} - 6`),
      queryOne(`SELECT count(DISTINCT user_id)::int AS c FROM events WHERE ${DAY('created_at')} >= ${TODAY} - 29`),
      // ad_views.view_date is written as a UTC date by farm.ts (it backs the
      // per-phase gameplay limit, not reporting) — compare on the same axis.
      queryOne(`SELECT coalesce(sum(count), 0)::int AS c FROM ad_views WHERE view_date = (now() AT TIME ZONE 'UTC')::date`),
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
      const r = await queryOne(`SELECT count(DISTINCT user_id)::int AS c FROM events WHERE ${DAY('created_at')} = ${TODAY} - 1`);
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
      `SELECT ${DAY('created_at')}::text AS day, count(DISTINCT user_id)::int AS dau
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
      `SELECT ${DAY('created_at')}::text AS day, count(*)::int AS new_users
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
