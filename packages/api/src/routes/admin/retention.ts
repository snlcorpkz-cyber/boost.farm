import { Router } from 'express';
import { query } from '../../lib/db.js';
import { REPORTING_TZ } from '../../lib/reporting-tz.js';
import { UUID_RE, parseSourceFilter, sourceFilterSql } from './filters.js';

export const adminRetentionRouter = Router();

/**
 * Cohort retention analysis.
 *
 * Query params:
 *   - weeks:         number of cohorts to analyze (default 14, max 365)
 *   - offsets:       comma-separated day offsets to check (default "1,3,7,14,30")
 *   - group_by:      'day' | 'week' (default 'day')
 *   - source_filter: 'all' | 'paid' | 'organic' (default 'all')
 *   - country, platform, rank, utm_source: cohort filters
 *   - partner_id:    'organic' | 'any' | <uuid> — split paid (partner) vs
 *                    organic traffic in the cohort. Critical once affiliate
 *                    networks (TimeBucks, etc.) start mixing into the funnel.
 *
 * The cost / CPI / ROAS overlay that used to live here was removed
 * together with its UI (commit 9a55001, "remove CPI/ROAS") — the
 * numbers were unreliable and the per-cohort lookups made the page
 * O(cohorts × offsets) in SQL round-trips. Everything below is
 * computed in three set-based queries regardless of cohort count.
 */
interface CohortRow {
  cohort_start: string;
  cohort_size: number;
}

interface RetentionCell {
  count: number;
  pct: number;
  /**
   * Cumulative ad.requested events from the cohort up to and
   * including this offset day.
   */
  ads_requested: number;
  /**
   * Cumulative DISTINCT (user_id, offer_id) plays sourced from
   * `offer_completions`. One entry per "unique game per user"
   * regardless of how many milestones they hit on it.
   */
  offer_plays: number;
}

interface CohortOut {
  cohort_start: string;
  cohort_size: number;
  retention: Record<number, RetentionCell | null>;
}

adminRetentionRouter.get('/cohorts', async (req, res) => {
  try {
    // Up to 365 buckets — operator's choice. For group_by=day that's
    // a full year of cohorts; for group_by=week it covers 7 years
    // (effectively "show everything we have"). The actual number of
    // cohorts returned is naturally capped by how much history is
    // in `users` — if there are only 30 days of data, weeks=365
    // returns 30 cohorts, not 365 empty rows.
    const weeks = Math.min(365, Math.max(1, parseInt(req.query.weeks as string) || 14));
    const groupBy = (req.query.group_by as string) === 'week' ? 'week' : 'day';
    const sourceFilter = parseSourceFilter(req.query.source_filter);
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

    const partnerIdRaw = String(req.query.partner_id ?? '').trim().toLowerCase();
    if (partnerIdRaw === 'organic') {
      filters.push('u.partner_id IS NULL');
    } else if (partnerIdRaw === 'any') {
      filters.push('u.partner_id IS NOT NULL');
    } else if (partnerIdRaw) {
      if (!UUID_RE.test(partnerIdRaw)) {
        res.status(400).json({ error: 'Invalid partner_id (expected UUID, "organic", or "any")' });
        return;
      }
      pi++;
      filters.push(`u.partner_id = $${pi}::uuid`);
      params.push(partnerIdRaw);
    }

    const whereUser = filters.length ? `AND ${filters.join(' AND ')}` : '';

    // For rank filter we need the current farm rank
    let rankFilter = '';
    if (req.query.rank) {
      pi++;
      rankFilter = `AND EXISTS (SELECT 1 FROM farms f WHERE f.user_id = u.id AND f.rank_id = $${pi})`;
      params.push(req.query.rank);
    }

    const sourceFilterFragment = sourceFilterSql(sourceFilter);

    const dateTrunc = groupBy === 'week' ? 'week' : 'day';
    const intervalExpr = groupBy === 'week' ? `($${pi + 1} || ' weeks')::interval` : `($${pi + 1} || ' days')::interval`;

    // Get cohorts: group users by their registration date bucket
    // IN REPORTING_TZ. Why TZ matters here: the operator compares
    // these numbers daily against Facebook Ads Manager / AppsFlyer
    // dashboard, both of which bucket on the AF account TZ. If we
    // bucketed in UTC instead, a user registering at 22:00 Almaty
    // (= 17:00 UTC) would land on the "wrong" calendar date
    // relative to FB and we'd chase a phantom 30%+ daily drift.
    //
    // The TZ is injected as a literal because PG's `AT TIME ZONE`
    // takes a literal name, not a runtime expression. The value
    // comes from REPORTING_TIMEZONE env var (default Asia/Almaty)
    // and is read once at boot — no SQL-injection surface.
    //
    // We cast cohort_start to ::text so node-postgres returns
    // 'YYYY-MM-DD' verbatim instead of parsing it into a JS Date
    // (where `String(d).slice(0,10)` yields garbage like
    // "Thu Apr 23"). Downstream `$::date` casts accept the string.
    const cohortBucket = `date_trunc('${dateTrunc}', u.created_at AT TIME ZONE '${REPORTING_TZ}')::date`;
    const cohortWhere = `
      WHERE u.created_at >= now() - ${intervalExpr}
      ${whereUser}
      ${rankFilter}
      ${sourceFilterFragment}`;

    const cohortsQuery = `
      SELECT
        ${cohortBucket}::text AS cohort_start,
        count(*)::int AS cohort_size
      FROM users u
      ${cohortWhere}
      GROUP BY cohort_start
      ORDER BY cohort_start DESC
    `;

    const cohorts = await query<CohortRow>(cohortsQuery, [...params, weeks]);

    // ── Set-based lookups ─────────────────────────────────────
    // One query each for retained counts, cumulative ad.requested
    // and cumulative offer plays — covering EVERY cohort × offset
    // pair in a single round-trip. The previous implementation
    // looped per cohort (and per offset for retention); at
    // weeks=365 × 10 offsets that meant thousands of SQL queries
    // per page render.
    const unit = groupBy === 'week' ? 7 : 1;
    const offsetsParam = `$${pi + 2}::int[]`;
    const lookupParams = [...params, weeks, offsets];
    const eventDay = `(e.created_at AT TIME ZONE '${REPORTING_TZ}')::date`;
    // Sargable timestamp guards: the calendar predicates below are
    // expressions Postgres can't use an index for, so every join also
    // carries a raw created_at range (with slop for TZ shift and the
    // week-bucket floor). Correctness comes from the calendar
    // predicate; the range only prunes the scan.
    const lowerSlop = groupBy === 'week' ? `interval '9 days'` : `interval '2 days'`;

    // Calendar-day (or calendar-week) retention: a user is retained on
    // day/week N if they have any event whose date_trunc matches the
    // cohort's date_trunc + N units. Using strict >=N*24h / <(N+1)*24h
    // intervals was wrong — someone who registers at 22:00 and returns
    // at 09:00 the next morning would be missed entirely despite being
    // a textbook D1-retained user. Industry standard (GA / Amplitude /
    // Mixpanel) is calendar-bucket based.
    const retentionPred = groupBy === 'week'
      ? `date_trunc('week', e.created_at AT TIME ZONE '${REPORTING_TZ}')::date = ${cohortBucket} + (o.offset_day * 7)`
      : `${eventDay} = ${cohortBucket} + o.offset_day`;

    // Synthetic events filter (`retention.%`, `system.%`):
    // server-side rollups emit milestone events on the user's
    // behalf (analytics-rollup.ts → retention.dN_return). Letting
    // those count as "real activity" creates a self-fulfilling
    // loop — a D3 retention event on day register+3 would mark
    // its own user as D3-retained even when nothing else
    // happened that day. Filter them out so the heatmap reflects
    // genuine product engagement only.
    const retainedByKey = new Map<string, number>();
    const rowsRetained = await query<{ cohort_start: string; offset_day: number; c: number }>(
      `SELECT ${cohortBucket}::text AS cohort_start,
              o.offset_day,
              count(DISTINCT e.user_id)::int AS c
         FROM users u
         CROSS JOIN unnest(${offsetsParam}) AS o(offset_day)
         JOIN events e
           ON e.user_id = u.id
          AND e.event_name NOT LIKE 'retention.%'
          AND e.event_name NOT LIKE 'system.%'
          AND e.created_at >= u.created_at - ${lowerSlop}
          AND e.created_at < u.created_at + (((o.offset_day * ${unit}) + ${unit} + 2) * interval '1 day')
          AND ${retentionPred}
        ${cohortWhere}
        GROUP BY 1, 2`,
      lookupParams,
    );
    for (const r of rowsRetained) retainedByKey.set(`${r.cohort_start}|${r.offset_day}`, r.c);

    // Cumulative ad.requested per (cohort, offset) — "ads through
    // end of day N", not "ads on day N specifically". INNER JOIN:
    // pairs with zero ads simply produce no row and default to 0.
    // Defensive try/catch: a failure here degrades the Ads column
    // to zeros instead of 500-ing the whole page.
    const adsByKey = new Map<string, number>();
    try {
      const rowsAds = await query<{ cohort_start: string; offset_day: number; ads: number }>(
        `SELECT ${cohortBucket}::text AS cohort_start,
                o.offset_day,
                count(*)::int AS ads
           FROM users u
           CROSS JOIN unnest(${offsetsParam}) AS o(offset_day)
           JOIN events e
             ON e.user_id = u.id
            AND e.event_name = 'ad.requested'
            AND e.created_at >= u.created_at - ${lowerSlop}
            AND e.created_at < u.created_at + (((o.offset_day * ${unit}) + 2) * interval '1 day')
            AND ${eventDay} <= ${cohortBucket} + (o.offset_day * ${unit})
          ${cohortWhere}
          GROUP BY 1, 2`,
        lookupParams,
      );
      for (const r of rowsAds) adsByKey.set(`${r.cohort_start}|${r.offset_day}`, r.ads);
    } catch (adsErr) {
      console.warn('[admin/retention/cohorts] ads lookup failed:', (adsErr as Error).message);
    }

    // Cumulative DISTINCT (user_id, offer_id) plays per (cohort,
    // offset) from `offer_completions`. The DISTINCT pair collapses
    // multiple-milestone completions on the same offer by the same
    // user into ONE "play". Table comes from migration 012_offers.sql;
    // if missing (fresh dev DB), the catch logs and the page renders.
    const playsByKey = new Map<string, number>();
    try {
      const rowsPlays = await query<{ cohort_start: string; offset_day: number; plays: number }>(
        `SELECT ${cohortBucket}::text AS cohort_start,
                o.offset_day,
                count(DISTINCT (oc.user_id, oc.offer_id))::int AS plays
           FROM users u
           CROSS JOIN unnest(${offsetsParam}) AS o(offset_day)
           JOIN offer_completions oc
             ON oc.user_id = u.id
            AND oc.created_at >= u.created_at - ${lowerSlop}
            AND oc.created_at < u.created_at + (((o.offset_day * ${unit}) + 2) * interval '1 day')
            AND (oc.created_at AT TIME ZONE '${REPORTING_TZ}')::date <= ${cohortBucket} + (o.offset_day * ${unit})
          ${cohortWhere}
          GROUP BY 1, 2`,
        lookupParams,
      );
      for (const r of rowsPlays) playsByKey.set(`${r.cohort_start}|${r.offset_day}`, r.plays);
    } catch (playsErr) {
      console.warn('[admin/retention/cohorts] offer plays lookup failed:', (playsErr as Error).message);
    }

    const result: CohortOut[] = cohorts.map((cohort) => {
      const out: CohortOut = {
        cohort_start: cohort.cohort_start,
        cohort_size: cohort.cohort_size,
        retention: {},
      };
      for (const offset of offsets) {
        const key = `${cohort.cohort_start}|${offset}`;
        const retained = retainedByKey.get(key) ?? 0;
        out.retention[offset] = {
          count: retained,
          pct: cohort.cohort_size > 0 ? Math.round((retained / cohort.cohort_size) * 1000) / 10 : 0,
          ads_requested: adsByKey.get(key) ?? 0,
          offer_plays: playsByKey.get(key) ?? 0,
        };
      }
      return out;
    });

    res.json({
      group_by: groupBy,
      offsets,
      source_filter: sourceFilter,
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
    // All date_trunc'd in REPORTING_TZ so admin /summary numbers
    // mirror the /cohorts heatmap and the AppsFlyer dashboard.
    // Synthetic retention.* / system.* events excluded so the
    // returned counts reflect real user activity (see Phase A
    // defense-in-depth in retention bug fix).
    const rows = await query(
      `SELECT
        date_trunc('day', u.created_at AT TIME ZONE '${REPORTING_TZ}')::date AS day,
        count(*)::int AS new_users,
        count(DISTINCT CASE WHEN (e.created_at AT TIME ZONE '${REPORTING_TZ}')::date = (u.created_at AT TIME ZONE '${REPORTING_TZ}')::date + 1 THEN e.user_id END)::int AS d1,
        count(DISTINCT CASE WHEN (e.created_at AT TIME ZONE '${REPORTING_TZ}')::date = (u.created_at AT TIME ZONE '${REPORTING_TZ}')::date + 7 THEN e.user_id END)::int AS d7,
        count(DISTINCT CASE WHEN (e.created_at AT TIME ZONE '${REPORTING_TZ}')::date = (u.created_at AT TIME ZONE '${REPORTING_TZ}')::date + 30 THEN e.user_id END)::int AS d30
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id
        AND e.event_name NOT LIKE 'retention.%'
        AND e.event_name NOT LIKE 'system.%'
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
 * Drill-down for a single cohort cell on the retention table.
 *
 * Returns the list of users that make up a cohort bucket, optionally
 * narrowed to those retained on a specific day/week offset. Powers the
 * "click a retention cell, see who's counted" UX.
 *
 * Query params:
 *   - date       (required) ISO date (YYYY-MM-DD) — the cohort's start date.
 *                For group_by=day it's the calendar day; for group_by=week
 *                it's the week's Monday (Postgres date_trunc convention).
 *   - offset     (optional) integer. If omitted, returns every user in the
 *                cohort regardless of retention ("Users" column click).
 *                If provided, only users whose N-th day/week after
 *                registration has ≥1 event.
 *   - group_by   'day' | 'week' (default 'day'). Must match the retention
 *                view the user was looking at, otherwise we'd pull a
 *                different cohort than the cell they clicked.
 *   - country, platform, rank, utm_source — same cohort filters as
 *                /cohorts so the drill mirrors the filtered view.
 */
adminRetentionRouter.get('/cohort-users', async (req, res) => {
  try {
    const date = (req.query.date as string)?.trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid or missing `date` (expected YYYY-MM-DD)' });
      return;
    }
    const groupBy = (req.query.group_by as string) === 'week' ? 'week' : 'day';
    const rawOffset = req.query.offset;
    let offset: number | null = null;
    if (rawOffset !== undefined && rawOffset !== '' && rawOffset !== 'all') {
      const parsed = parseInt(String(rawOffset), 10);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 365) {
        res.status(400).json({ error: 'Invalid `offset` (0-365 or omit for all)' });
        return;
      }
      offset = parsed;
    }

    const params: any[] = [date];
    // Same TZ-aware bucketing as /cohorts so click-through from a
    // cohort row lands on the same calendar bucket the operator
    // saw — without TZ alignment a user clicked at "Apr 30" cell
    // could surface users with `created_at` 22:00 UTC Apr 30
    // (= 03:00 May 1 Almaty) who actually belong to May 1.
    const filters: string[] = [`date_trunc('${groupBy}', u.created_at AT TIME ZONE '${REPORTING_TZ}')::date = $1::date`];
    let pi = 1;

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
    if (req.query.rank) {
      pi++;
      filters.push(`EXISTS (SELECT 1 FROM farms rf WHERE rf.user_id = u.id AND rf.rank_id = $${pi})`);
      params.push(req.query.rank);
    }
    const partnerIdRaw = String(req.query.partner_id ?? '').trim().toLowerCase();
    if (partnerIdRaw === 'organic') {
      filters.push('u.partner_id IS NULL');
    } else if (partnerIdRaw === 'any') {
      filters.push('u.partner_id IS NOT NULL');
    } else if (partnerIdRaw) {
      if (!UUID_RE.test(partnerIdRaw)) {
        res.status(400).json({ error: 'Invalid partner_id (expected UUID, "organic", or "any")' });
        return;
      }
      pi++;
      filters.push(`u.partner_id = $${pi}::uuid`);
      params.push(partnerIdRaw);
    }

    // Retention-day predicate. Same calendar-bucket logic as /cohorts.
    let retentionJoin = '';
    let retentionWhere = '';
    if (offset !== null) {
      pi++;
      params.push(offset);
      const retentionPred = groupBy === 'week'
        ? `date_trunc('week', e.created_at AT TIME ZONE '${REPORTING_TZ}')::date = date_trunc('week', u.created_at AT TIME ZONE '${REPORTING_TZ}')::date + ($${pi}::int * 7)`
        : `(e.created_at AT TIME ZONE '${REPORTING_TZ}')::date = (u.created_at AT TIME ZONE '${REPORTING_TZ}')::date + $${pi}::int`;
      // Aggregate events-per-user on the retention day so we can both
      // filter (retained only) and show a signal of "how actively they
      // came back" in the UI.
      //
      // Synthetic events (`retention.%`, `system.%`) are excluded so
      // the drill-down user list matches the cohort heatmap count
      // exactly — without the filter we'd surface users who only
      // "appear" retained because the rollup wrote a milestone event
      // for them on D-N.
      retentionJoin = `
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS events_on_day,
                 min(e.created_at) AS first_event_on_day,
                 max(e.created_at) AS last_event_on_day
          FROM events e
          WHERE e.user_id = u.id
            AND e.event_name NOT LIKE 'retention.%'
            AND e.event_name NOT LIKE 'system.%'
            AND ${retentionPred}
        ) ev ON true`;
      retentionWhere = 'AND ev.events_on_day > 0';
    }

    // Scalar subquery for rank_id keeps the main query 1-row-per-user
    // regardless of how many farms a user has (schema doesn't enforce
    // UNIQUE(user_id) on farms).
    const rows = await query<any>(
      `SELECT
         u.id,
         u.nickname,
         u.email,
         u.country,
         u.device_platform,
         u.utm_source,
         u.partner_id,
         p.slug AS partner_slug,
         p.name AS partner_name,
         u.created_at,
         u.last_active_at,
         (SELECT rank_id FROM farms WHERE user_id = u.id LIMIT 1) AS rank_id,
         ${offset !== null
           ? 'ev.events_on_day, ev.first_event_on_day, ev.last_event_on_day'
           : 'NULL::int AS events_on_day, NULL::timestamptz AS first_event_on_day, NULL::timestamptz AS last_event_on_day'}
       FROM users u
       LEFT JOIN partners p ON p.id = u.partner_id
       ${retentionJoin}
       WHERE ${filters.join(' AND ')}
       ${retentionWhere}
       ORDER BY ${offset !== null ? 'ev.events_on_day DESC NULLS LAST,' : ''} u.created_at DESC
       LIMIT 500`,
      params,
    );

    res.json({
      date,
      group_by: groupBy,
      offset,
      total: rows.length,
      users: rows,
    });
  } catch (err) {
    console.error('[admin/retention/cohort-users]', err);
    res.status(500).json({ error: 'Failed', details: (err as Error).message });
  }
});

/**
 * Segment breakdown: compare retention across different segments.
 *
 * Supports `dimension=partner` which groups by attribution partner
 * (organic vs each named partner). This is the cleanest way to spot
 * if affiliate traffic — TimeBucks etc. — has materially different
 * retention than our paid Meta / AppsFlyer cohorts. The grouping
 * uses partners.name (falls back to slug, then 'organic') so admins
 * see "TimeBucks" rather than a UUID.
 */
adminRetentionRouter.get('/segments', async (req, res) => {
  try {
    const dimension = (req.query.dimension as string) || 'country';
    // Simple-column dimensions live on `users` directly. The 'partner'
    // dimension needs a JOIN, so we handle it as a separate branch below.
    const simpleDims: Record<string, string> = {
      country: 'u.country',
      platform: 'u.device_platform',
      utm_source: 'u.utm_source',
    };

    if (dimension === 'partner') {
      // TZ-bucketed + synthetic-event filter to match the simple-dim
      // branch below (and the cohort heatmap). Without this the
      // partner segment view would over-count "retained" users by
      // including retention.dN_return rollup events.
      const rows = await query(
        `SELECT
          coalesce(p.name, p.slug, 'organic') AS segment,
          count(DISTINCT u.id)::int AS total_users,
          count(DISTINCT CASE
            WHEN (e.created_at AT TIME ZONE '${REPORTING_TZ}')::date = (u.created_at AT TIME ZONE '${REPORTING_TZ}')::date + 1
            THEN u.id END)::int AS d1,
          count(DISTINCT CASE
            WHEN (e.created_at AT TIME ZONE '${REPORTING_TZ}')::date = (u.created_at AT TIME ZONE '${REPORTING_TZ}')::date + 7
            THEN u.id END)::int AS d7
         FROM users u
         LEFT JOIN partners p ON p.id = u.partner_id
         LEFT JOIN events e ON e.user_id = u.id
          AND e.event_name NOT LIKE 'retention.%'
          AND e.event_name NOT LIKE 'system.%'
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
      return;
    }

    const col = simpleDims[dimension];
    if (!col) {
      res.status(400).json({ error: 'Invalid dimension. Allowed: country, platform, utm_source, partner' });
      return;
    }

    // TZ-bucketed in REPORTING_TZ to match /cohorts + /summary,
    // and synthetic events excluded so D1/D7 reflect real return
    // visits (not the rollup writing milestones on the user's
    // behalf). Without these two filters /segments would disagree
    // with the cohort table on the same dataset.
    const rows = await query(
      `SELECT
        coalesce(${col}, 'unknown') AS segment,
        count(DISTINCT u.id)::int AS total_users,
        count(DISTINCT CASE
          WHEN (e.created_at AT TIME ZONE '${REPORTING_TZ}')::date = (u.created_at AT TIME ZONE '${REPORTING_TZ}')::date + 1
          THEN u.id END)::int AS d1,
        count(DISTINCT CASE
          WHEN (e.created_at AT TIME ZONE '${REPORTING_TZ}')::date = (u.created_at AT TIME ZONE '${REPORTING_TZ}')::date + 7
          THEN u.id END)::int AS d7
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id
        AND e.event_name NOT LIKE 'retention.%'
        AND e.event_name NOT LIKE 'system.%'
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
