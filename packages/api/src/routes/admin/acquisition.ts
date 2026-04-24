import { Router } from 'express';
import { query } from '../../lib/db.js';

export const adminAcquisitionRouter = Router();

function parseDays(raw: unknown, def = 30): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(180, Math.round(n)));
}

/**
 * GET /admin/acquisition/by-utm
 * Users grouped by (utm_source, utm_medium, utm_campaign) with D1 return
 * rate so CPOs can compare channel quality, not just volume.
 */
adminAcquisitionRouter.get('/by-utm', async (req, res) => {
  try {
    const days = parseDays(req.query.days, 30);
    const rows = await query<any>(
      `SELECT
         coalesce(u.utm_source, 'organic')        AS utm_source,
         coalesce(u.utm_medium, '')               AS utm_medium,
         coalesce(u.utm_campaign, '')             AS utm_campaign,
         count(DISTINCT u.id)::int                AS users,
         count(DISTINCT CASE
           WHEN e.created_at::date = u.created_at::date + 1
           THEN u.id
         END)::int                                AS d1_retained
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id
       WHERE u.created_at >= now() - ($1 || ' days')::interval
       GROUP BY utm_source, utm_medium, utm_campaign
       ORDER BY users DESC
       LIMIT 50`,
      [days],
    );
    res.json({
      days,
      rows: rows.map((r) => ({
        ...r,
        d1_pct: r.users > 0 ? Math.round((r.d1_retained / r.users) * 1000) / 10 : 0,
      })),
    });
  } catch (err) {
    console.error('[admin/acquisition/by-utm]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * GET /admin/acquisition/by-geo
 * New users + D1 retention by country code.
 */
adminAcquisitionRouter.get('/by-geo', async (req, res) => {
  try {
    const days = parseDays(req.query.days, 30);
    const rows = await query<any>(
      `SELECT
         coalesce(u.country, 'unknown') AS country,
         count(DISTINCT u.id)::int      AS users,
         count(DISTINCT CASE
           WHEN e.created_at::date = u.created_at::date + 1
           THEN u.id
         END)::int AS d1_retained
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id
       WHERE u.created_at >= now() - ($1 || ' days')::interval
       GROUP BY country
       ORDER BY users DESC
       LIMIT 50`,
      [days],
    );
    res.json({
      days,
      rows: rows.map((r) => ({
        ...r,
        d1_pct: r.users > 0 ? Math.round((r.d1_retained / r.users) * 1000) / 10 : 0,
      })),
    });
  } catch (err) {
    console.error('[admin/acquisition/by-geo]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * GET /admin/acquisition/by-referrer
 * Play Install Referrer attribution — groups by
 * (utm_source, utm_campaign) captured by `install.referrer_captured` events.
 */
adminAcquisitionRouter.get('/by-referrer', async (req, res) => {
  try {
    const days = parseDays(req.query.days, 30);
    const rows = await query<any>(
      `SELECT
         coalesce(properties->>'utmSource', 'organic') AS utm_source,
         coalesce(properties->>'utmCampaign', '')      AS utm_campaign,
         count(*)::int                                 AS captures,
         count(DISTINCT user_id)::int                  AS unique_users
       FROM events
       WHERE event_name = 'install.referrer_captured'
         AND created_at >= now() - ($1 || ' days')::interval
       GROUP BY utm_source, utm_campaign
       ORDER BY captures DESC
       LIMIT 50`,
      [days],
    );
    res.json({ days, rows });
  } catch (err) {
    console.error('[admin/acquisition/by-referrer]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * GET /admin/acquisition/cohort-quality
 * Weekly cohorts with D1, D3, D7 return rate — a quick "is traffic quality
 * improving" lens. Doesn't replace the full cohort table on /retention.
 */
adminAcquisitionRouter.get('/cohort-quality', async (req, res) => {
  try {
    const weeks = Math.max(1, Math.min(12, parseInt(req.query.weeks as string) || 8));
    const rows = await query<any>(
      `WITH week_users AS (
         SELECT
           date_trunc('week', u.created_at)::date AS cohort_week,
           u.id,
           u.created_at
         FROM users u
         WHERE u.created_at >= now() - ($1 || ' weeks')::interval
       )
       SELECT
         wu.cohort_week::text AS cohort_week,
         count(DISTINCT wu.id)::int AS cohort_size,
         count(DISTINCT CASE
           WHEN e.created_at::date = wu.created_at::date + 1
           THEN wu.id END)::int AS d1,
         count(DISTINCT CASE
           WHEN e.created_at::date = wu.created_at::date + 3
           THEN wu.id END)::int AS d3,
         count(DISTINCT CASE
           WHEN e.created_at::date = wu.created_at::date + 7
           THEN wu.id END)::int AS d7
       FROM week_users wu
       LEFT JOIN events e ON e.user_id = wu.id
       GROUP BY cohort_week
       ORDER BY cohort_week DESC`,
      [weeks],
    );
    res.json(
      rows.map((r) => ({
        cohort_week: r.cohort_week,
        cohort_size: r.cohort_size,
        d1: r.d1,
        d3: r.d3,
        d7: r.d7,
        d1_pct: r.cohort_size > 0 ? Math.round((r.d1 / r.cohort_size) * 1000) / 10 : 0,
        d3_pct: r.cohort_size > 0 ? Math.round((r.d3 / r.cohort_size) * 1000) / 10 : 0,
        d7_pct: r.cohort_size > 0 ? Math.round((r.d7 / r.cohort_size) * 1000) / 10 : 0,
      })),
    );
  } catch (err) {
    console.error('[admin/acquisition/cohort-quality]', err);
    res.status(500).json({ error: 'Failed' });
  }
});
