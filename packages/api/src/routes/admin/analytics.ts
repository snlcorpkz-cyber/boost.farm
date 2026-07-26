import { Router } from 'express';
import { query, queryOne } from '../../lib/db.js';
import { tzExpr, REPORTING_TZ } from '../../lib/reporting-tz.js';

export const adminAnalyticsRouter = Router();

// Calendar-day bucketing in REPORTING_TZ — same axis as /admin/retention.
const DAY = (col: string) => `${tzExpr(col)}::date`;
const TODAY = `(now() AT TIME ZONE '${REPORTING_TZ}')::date`;

function parseDays(raw: unknown, def = 30): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(180, Math.round(n)));
}

/**
 * GET /admin/analytics/stickiness
 * Returns DAU / MAU and the stickiness ratio (DAU/MAU) for the last
 * `days` days. 20%+ is healthy for casual gaming apps.
 */
adminAnalyticsRouter.get('/stickiness', async (req, res) => {
  try {
    const days = parseDays(req.query.days, 30);
    const rows = await query<any>(
      `WITH day_series AS (
         SELECT generate_series(
           (${TODAY} - ($1 || ' days')::interval)::date,
           ${TODAY},
           interval '1 day'
         )::date AS day
       )
       SELECT
         ds.day::text AS day,
         (SELECT count(DISTINCT user_id)::int
            FROM events e
           WHERE ${DAY('e.created_at')} = ds.day) AS dau,
         (SELECT count(DISTINCT user_id)::int
            FROM events e
           WHERE ${DAY('e.created_at')} > ds.day - 30
             AND ${DAY('e.created_at')} <= ds.day) AS mau
       FROM day_series ds
       ORDER BY ds.day`,
      [days],
    );
    res.json(
      rows.map((r) => ({
        day: r.day,
        dau: r.dau,
        mau: r.mau,
        stickiness: r.mau > 0 ? Math.round((r.dau / r.mau) * 1000) / 10 : 0,
      })),
    );
  } catch (err) {
    console.error('[admin/analytics/stickiness]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * GET /admin/analytics/session-length
 * Histogram + mean/median of session duration for the last `days` days.
 */
adminAnalyticsRouter.get('/session-length', async (req, res) => {
  try {
    const days = parseDays(req.query.days, 7);
    const summary = await queryOne<any>(
      `SELECT
         count(*)::int AS total_sessions,
         coalesce(avg(duration_sec), 0)::int AS mean_sec,
         coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_sec), 0)::int AS p50_sec,
         coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_sec), 0)::int AS p95_sec
       FROM sessions
       WHERE duration_sec IS NOT NULL
         AND started_at >= now() - ($1 || ' days')::interval`,
      [days],
    );

    // Simple histogram buckets in seconds.
    const buckets = [30, 60, 120, 300, 600, 1800, 3600];
    const histogram = await query<any>(
      `SELECT bucket_max::int AS bucket_max, count(*)::int AS c
         FROM (
           SELECT CASE
             WHEN duration_sec <= 30    THEN 30
             WHEN duration_sec <= 60    THEN 60
             WHEN duration_sec <= 120   THEN 120
             WHEN duration_sec <= 300   THEN 300
             WHEN duration_sec <= 600   THEN 600
             WHEN duration_sec <= 1800  THEN 1800
             WHEN duration_sec <= 3600  THEN 3600
             ELSE 99999
           END AS bucket_max
           FROM sessions
           WHERE duration_sec IS NOT NULL
             AND started_at >= now() - ($1 || ' days')::interval
         ) t
       GROUP BY bucket_max
       ORDER BY bucket_max`,
      [days],
    );

    res.json({
      days,
      summary: summary ?? { total_sessions: 0, mean_sec: 0, p50_sec: 0, p95_sec: 0 },
      histogram,
      bucket_labels: buckets,
    });
  } catch (err) {
    console.error('[admin/analytics/session-length]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * GET /admin/analytics/new-users-by-source
 * Who's arriving — grouped by utm_source, device_platform, country.
 */
adminAnalyticsRouter.get('/new-users-by-source', async (req, res) => {
  try {
    const days = parseDays(req.query.days, 30);
    const [byUtm, byPlatform, byCountry] = await Promise.all([
      query<any>(
        `SELECT coalesce(utm_source, 'organic') AS src, count(*)::int AS c
           FROM users
          WHERE created_at >= now() - ($1 || ' days')::interval
          GROUP BY src
          ORDER BY c DESC LIMIT 25`,
        [days],
      ),
      query<any>(
        `SELECT coalesce(device_platform, 'unknown') AS platform, count(*)::int AS c
           FROM users
          WHERE created_at >= now() - ($1 || ' days')::interval
          GROUP BY platform
          ORDER BY c DESC`,
        [days],
      ),
      query<any>(
        `SELECT coalesce(country, 'unknown') AS country, count(*)::int AS c
           FROM users
          WHERE created_at >= now() - ($1 || ' days')::interval
          GROUP BY country
          ORDER BY c DESC LIMIT 25`,
        [days],
      ),
    ]);
    res.json({ days, by_utm: byUtm, by_platform: byPlatform, by_country: byCountry });
  } catch (err) {
    console.error('[admin/analytics/new-users-by-source]', err);
    res.status(500).json({ error: 'Failed' });
  }
});
