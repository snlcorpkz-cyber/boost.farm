import { Router } from 'express';
import { query } from '../../lib/db.js';

export const adminRetentionRouter = Router();

/**
 * Cohort retention analysis.
 *
 * Query params:
 *   - weeks:      number of cohorts to analyze (default 8, max 20)
 *   - offsets:    comma-separated day offsets to check (default "1,3,7,14,30")
 *   - group_by:   'day' | 'week' (default 'day')
 *   - country:    filter by user country
 *   - platform:   filter by device_platform
 *   - rank:       filter by farm rank_id
 *   - utm_source: filter by utm_source
 */
adminRetentionRouter.get('/cohorts', async (req, res) => {
  try {
    const weeks = Math.min(20, Math.max(1, parseInt(req.query.weeks as string) || 8));
    const groupBy = (req.query.group_by as string) === 'week' ? 'week' : 'day';
    const rawOffsets = (req.query.offsets as string) || '1,3,7,14,30';
    const offsets = rawOffsets.split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n >= 0 && n <= 365)
      .slice(0, 10);

    if (offsets.length === 0) offsets.push(1, 3, 7, 14, 30);

    // Build filters for users in the cohort
    const filters: string[] = [];
    const params: any[] = [];
    let pi = 0;

    if (req.query.country) {
      pi++;
      filters.push(`u.country = $${pi}`);
      params.push(req.query.country);
    }
    if (req.query.platform) {
      pi++;
      filters.push(`u.device_platform = $${pi}`);
      params.push(req.query.platform);
    }
    if (req.query.utm_source) {
      pi++;
      filters.push(`u.utm_source = $${pi}`);
      params.push(req.query.utm_source);
    }

    const whereUser = filters.length ? `AND ${filters.join(' AND ')}` : '';

    // For rank filter we need the current farm rank
    let rankFilter = '';
    if (req.query.rank) {
      pi++;
      rankFilter = `AND EXISTS (SELECT 1 FROM farms f WHERE f.user_id = u.id AND f.rank_id = $${pi})`;
      params.push(req.query.rank);
    }

    const dateTrunc = groupBy === 'week' ? 'week' : 'day';
    const intervalExpr = groupBy === 'week' ? `($${pi + 1} || ' weeks')::interval` : `($${pi + 1} || ' days')::interval`;
    const periodParamIdx = pi + 1;

    // Get cohorts: group users by their registration date bucket
    const cohortsQuery = `
      SELECT
        date_trunc('${dateTrunc}', u.created_at)::date AS cohort_start,
        count(*)::int AS cohort_size,
        array_agg(u.id) AS user_ids
      FROM users u
      WHERE u.created_at >= now() - ${intervalExpr}
      ${whereUser}
      ${rankFilter}
      GROUP BY cohort_start
      ORDER BY cohort_start DESC
    `;

    const cohorts = await query(cohortsQuery, [...params, weeks]);

    // For each cohort, for each offset, calculate retained count
    const result = [];

    for (const cohort of cohorts) {
      const userIds: string[] = cohort.user_ids;
      const row: any = {
        cohort_start: cohort.cohort_start,
        cohort_size: cohort.cohort_size,
        retention: {},
      };

      for (const offset of offsets) {
        // Calendar-day (or calendar-week) retention: a user is retained on
        // day/week N if they have any event whose date_trunc matches the
        // cohort's date_trunc + N units. Using strict >=N*24h / <(N+1)*24h
        // intervals was wrong — someone who registers at 22:00 and returns
        // at 09:00 the next morning would be missed entirely despite being
        // a textbook D1-retained user. Industry standard (GA / Amplitude /
        // Mixpanel) is calendar-bucket based.
        const retainedRow = await query(
          groupBy === 'week'
            ? `SELECT count(DISTINCT e.user_id)::int AS c
               FROM events e
               JOIN users u ON u.id = e.user_id
               WHERE e.user_id = ANY($1::uuid[])
                 AND date_trunc('week', e.created_at)::date
                     = date_trunc('week', u.created_at)::date + ($2::int * 7)`
            : `SELECT count(DISTINCT e.user_id)::int AS c
               FROM events e
               JOIN users u ON u.id = e.user_id
               WHERE e.user_id = ANY($1::uuid[])
                 AND e.created_at::date = u.created_at::date + $2::int`,
          [userIds, offset]
        );
        const retained = retainedRow[0]?.c || 0;
        row.retention[offset] = {
          count: retained,
          pct: cohort.cohort_size > 0 ? Math.round((retained / cohort.cohort_size) * 1000) / 10 : 0,
        };
      }

      delete cohort.user_ids;
      result.push(row);
    }

    res.json({
      group_by: groupBy,
      offsets,
      cohorts: result,
    });
  } catch (err) {
    console.error('[admin/retention/cohorts]', err);
    res.status(500).json({ error: 'Failed to build cohorts', details: (err as Error).message });
  }
});

/**
 * Retention summary: rolling DxN retention over the last 30 days.
 * Each day shows: % of users registered on that day who returned on D+1, D+7, D+30.
 */
adminRetentionRouter.get('/summary', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT
        date_trunc('day', u.created_at)::date AS day,
        count(*)::int AS new_users,
        count(DISTINCT CASE WHEN e.created_at::date = (u.created_at + interval '1 day')::date THEN e.user_id END)::int AS d1,
        count(DISTINCT CASE WHEN e.created_at::date = (u.created_at + interval '7 days')::date THEN e.user_id END)::int AS d7,
        count(DISTINCT CASE WHEN e.created_at::date = (u.created_at + interval '30 days')::date THEN e.user_id END)::int AS d30
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id
       WHERE u.created_at >= now() - interval '30 days'
       GROUP BY day
       ORDER BY day DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin/retention/summary]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Segment breakdown: compare retention across different segments.
 */
adminRetentionRouter.get('/segments', async (req, res) => {
  try {
    const dimension = (req.query.dimension as string) || 'country';
    const allowedDims: Record<string, string> = {
      country: 'u.country',
      platform: 'u.device_platform',
      utm_source: 'u.utm_source',
    };
    const col = allowedDims[dimension];
    if (!col) {
      res.status(400).json({ error: 'Invalid dimension. Allowed: country, platform, utm_source' });
      return;
    }

    const rows = await query(
      `SELECT
        coalesce(${col}, 'unknown') AS segment,
        count(DISTINCT u.id)::int AS total_users,
        count(DISTINCT CASE
          WHEN e.created_at::date = u.created_at::date + 1
          THEN u.id END)::int AS d1,
        count(DISTINCT CASE
          WHEN e.created_at::date = u.created_at::date + 7
          THEN u.id END)::int AS d7
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id
       WHERE u.created_at >= now() - interval '30 days'
       GROUP BY segment
       ORDER BY total_users DESC
       LIMIT 20`
    );

    const result = rows.map((r: any) => ({
      segment: r.segment,
      total_users: r.total_users,
      d1_count: r.d1,
      d7_count: r.d7,
      d1_pct: r.total_users > 0 ? Math.round((r.d1 / r.total_users) * 1000) / 10 : 0,
      d7_pct: r.total_users > 0 ? Math.round((r.d7 / r.total_users) * 1000) / 10 : 0,
    }));

    res.json({ dimension, segments: result });
  } catch (err) {
    console.error('[admin/retention/segments]', err);
    res.status(500).json({ error: 'Failed' });
  }
});
