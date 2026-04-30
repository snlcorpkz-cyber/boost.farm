import { Router } from 'express';
import { query } from '../../lib/db.js';

export const adminRetentionRouter = Router();

/**
 * Cohort retention analysis with cost & ROAS overlay.
 *
 * Query params:
 *   - weeks:         number of cohorts to analyze (default 8, max 20)
 *   - offsets:       comma-separated day offsets to check (default "1,3,7,14,30")
 *   - group_by:      'day' | 'week' (default 'day')
 *   - source_filter: 'all' | 'paid' | 'organic' (default 'all')
 *   - country, platform, rank, utm_source: cohort filters
 *
 * Cost / CPI / ROAS:
 *   When source_filter='paid' we narrow the cohort to users whose
 *   acquisition_source carries an AppsFlyer media_source other
 *   than "Organic" (or a Facebook campaign id from the legacy
 *   Install Referrer path). Cost for that cohort comes from
 *   `ad_costs.spend_micros` summed across cohort_start day(s).
 *   ROAS at offset N = cumulative revenue_cents from events
 *   (event_name in 'ad.revenue', 'econ.offer_completed',
 *   'econ.purchase') up to and including day cohort_start + N,
 *   divided by cost. Returns null when cost_cents=0 to avoid
 *   division by zero (UI renders "—").
 */
type SourceFilter = 'all' | 'paid' | 'organic';

function parseSourceFilter(raw: unknown): SourceFilter {
  if (raw === 'paid' || raw === 'organic' || raw === 'all') return raw;
  return 'all';
}

/**
 * Predicate for paid users. We treat a user as paid when their
 * acquisition_source carries an AppsFlyer media_source other
 * than "Organic", or a Facebook campaign id (legacy Install
 * Referrer path before AF was wired up). Empty / null
 * acquisition_source = organic.
 *
 * Returns the SQL fragment plus a flag so the caller can decide
 * whether to JOIN at all (saves a sequential scan on the rare
 * "all" path).
 */
function sourceFilterSql(filter: SourceFilter): string {
  if (filter === 'paid') {
    return `AND u.acquisition_source IS NOT NULL
            AND (
              (u.acquisition_source ? 'afMediaSource'
                AND COALESCE(u.acquisition_source ->> 'afMediaSource', '') NOT IN ('', 'Organic'))
              OR u.acquisition_source ? 'fbCampaignId'
              OR u.acquisition_source ? 'utmCampaign'
            )`;
  }
  if (filter === 'organic') {
    return `AND (
              u.acquisition_source IS NULL
              OR (
                NOT (u.acquisition_source ? 'fbCampaignId')
                AND NOT (u.acquisition_source ? 'utmCampaign')
                AND COALESCE(u.acquisition_source ->> 'afMediaSource', 'Organic') IN ('', 'Organic')
              )
            )`;
  }
  return '';
}

interface CohortRow {
  cohort_start: string;
  cohort_size: number;
  user_ids: string[];
}

interface RetentionCell {
  count: number;
  pct: number;
  rev_cents: number;
  roas_pct: number | null;
  /**
   * Cumulative ad.requested events from the cohort up to and
   * including this offset day. Drives the "Theoretical mode"
   * revenue projection on the client (ads/1000 × CPM input).
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
  cost_cents: number;
  cpi_cents: number | null;
  retention: Record<number, RetentionCell | null>;
}

adminRetentionRouter.get('/cohorts', async (req, res) => {
  try {
    const weeks = Math.min(20, Math.max(1, parseInt(req.query.weeks as string) || 8));
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
    const cohortsQuery = `
      SELECT
        date_trunc('${dateTrunc}', u.created_at)::date AS cohort_start,
        count(*)::int AS cohort_size,
        array_agg(u.id) AS user_ids
      FROM users u
      WHERE u.created_at >= now() - ${intervalExpr}
      ${whereUser}
      ${rankFilter}
      ${sourceFilterFragment}
      GROUP BY cohort_start
      ORDER BY cohort_start DESC
    `;

    const cohorts = await query<CohortRow>(cohortsQuery, [...params, weeks]);

    // ── Cost lookup ───────────────────────────────────────────
    // Single batched query for ALL cohort dates so the cost overlay
    // costs one round-trip per page render no matter how many
    // cohorts. For week grouping we sum the 7 days that make up
    // the week; date_trunc('week', cost_date) groups them
    // identically to the cohort bucketing above.
    //
    // When source_filter='paid' we don't restrict ad_costs further
    // — Facebook Ads / googleadwords_int are inherently paid, and
    // organic spend is $0 by definition, so summing every media
    // source still gives the right number for paid cohorts.
    // When source_filter='organic' we report cost=0 (organic
    // cohorts have no spend attributable).
    //
    // Wrapped in try/catch so the retention table continues to
    // work even when migration 026 (ad_costs) hasn't been applied
    // yet — the only consequence is empty CPI/ROAS columns. We'd
    // rather show partial data than 500 the entire page.
    const costByCohort = new Map<string, number>();
    if (sourceFilter !== 'organic' && cohorts.length > 0) {
      try {
        const cohortDates = cohorts.map((c) => c.cohort_start);
        const costRows = await query<{ cohort_start: string; spend_micros: string }>(
          groupBy === 'week'
            ? `SELECT date_trunc('week', cost_date)::date::text AS cohort_start,
                      sum(spend_micros)::bigint::text AS spend_micros
                 FROM ad_costs
                 WHERE date_trunc('week', cost_date)::date = ANY($1::date[])
                 GROUP BY cohort_start`
            : `SELECT cost_date::text AS cohort_start,
                      sum(spend_micros)::bigint::text AS spend_micros
                 FROM ad_costs
                 WHERE cost_date = ANY($1::date[])
                 GROUP BY cost_date`,
          [cohortDates],
        );
        for (const r of costRows) {
          // spend_micros (USD micros) → cents: divide by 10_000.
          costByCohort.set(r.cohort_start, Number(BigInt(r.spend_micros) / 10000n));
        }
      } catch (costErr) {
        const msg = (costErr as Error).message ?? '';
        if (/relation .*ad_costs.* does not exist/i.test(msg)) {
          console.warn('[admin/retention/cohorts] ad_costs table missing — apply migration 026. CPI/ROAS will be empty.');
        } else {
          console.warn('[admin/retention/cohorts] cost lookup failed:', msg);
        }
      }
    }

    // ── Per-cohort retention + cumulative revenue ─────────────
    const result: CohortOut[] = [];

    for (const cohort of cohorts) {
      const userIds: string[] = cohort.user_ids;
      const cohortStartIso = String(cohort.cohort_start).slice(0, 10);
      const costCents = costByCohort.get(cohortStartIso) ?? 0;
      const cpiCents = cohort.cohort_size > 0 && costCents > 0
        ? Math.round(costCents / cohort.cohort_size)
        : null;

      const out: CohortOut = {
        cohort_start: cohort.cohort_start,
        cohort_size: cohort.cohort_size,
        cost_cents: costCents,
        cpi_cents: cpiCents,
        retention: {},
      };

      // Pull cumulative revenue for ALL offsets in one query so we
      // don't fan out N+1 SQL per cohort × per offset. The lateral
      // unnest builds a virtual offset table, the LEFT JOIN on
      // events filters by "<= cohort_start + offset_day" so each
      // row is a cumulative figure (D3 includes everything up to
      // and including D3, not just D3 events).
      //
      // Defensive: any failure here (e.g. unexpected event_name
      // filter, missing column) falls through to "no revenue
      // overlay" rather than 500-ing the entire retention page.
      const revByOffset = new Map<number, number>();
      try {
        const revRows = await query<{ offset_day: number; rev_cents: string | null }>(
          `SELECT o.offset_day,
                  COALESCE(sum(e.revenue_cents), 0)::bigint::text AS rev_cents
             FROM unnest($2::int[]) AS o(offset_day)
             LEFT JOIN events e
               ON e.user_id = ANY($1::uuid[])
              AND e.event_name IN ('ad.revenue', 'econ.offer_completed', 'econ.purchase')
              AND e.revenue_cents IS NOT NULL
              AND e.created_at::date <= ($3::date + (o.offset_day * ${groupBy === 'week' ? 7 : 1}))
             GROUP BY o.offset_day
             ORDER BY o.offset_day`,
          [userIds, offsets, cohortStartIso],
        );
        for (const r of revRows) {
          revByOffset.set(r.offset_day, Number(r.rev_cents ?? '0'));
        }
      } catch (revErr) {
        console.warn('[admin/retention/cohorts] revenue lookup failed for cohort', cohortStartIso, ':', (revErr as Error).message);
      }

      // Cumulative ad.requested events per offset. Drives the
      // Theoretical mode revenue projection on the client
      // (ads / 1000 * CPM input). Same lateral-unnest shape as the
      // revenue query above so D-N is "ads through end of day N",
      // not "ads on D-N specifically".
      //
      // Defensive: a missing column / malformed properties shape
      // falls back to a zero map so the rest of the page renders.
      const adsByOffset = new Map<number, number>();
      try {
        const adsRows = await query<{ offset_day: number; ads: number }>(
          `SELECT o.offset_day,
                  COUNT(*)::int AS ads
             FROM unnest($2::int[]) AS o(offset_day)
             LEFT JOIN events e
               ON e.user_id = ANY($1::uuid[])
              AND e.event_name = 'ad.requested'
              AND e.created_at::date <= ($3::date + (o.offset_day * ${groupBy === 'week' ? 7 : 1}))
             GROUP BY o.offset_day
             ORDER BY o.offset_day`,
          [userIds, offsets, cohortStartIso],
        );
        for (const r of adsRows) {
          adsByOffset.set(r.offset_day, r.ads ?? 0);
        }
      } catch (adsErr) {
        console.warn('[admin/retention/cohorts] ads lookup failed for cohort', cohortStartIso, ':', (adsErr as Error).message);
      }

      // Cumulative DISTINCT (user_id, offer_id) plays per offset
      // sourced from `offer_completions`. The DISTINCT pair
      // collapses multiple-milestone completions on the same offer
      // by the same user into ONE "play" — matching the user's
      // requested "unique games per cohort" semantics ("не в кол-во
      // постбеков, а уникальных игр").
      //
      // The table is created in migration 012_offers.sql; if it's
      // missing (e.g. fresh dev DB without the offer system), the
      // catch logs once and the page still renders.
      const offerPlaysByOffset = new Map<number, number>();
      try {
        const playsRows = await query<{ offset_day: number; plays: number }>(
          `SELECT o.offset_day,
                  COUNT(DISTINCT (oc.user_id, oc.offer_id))::int AS plays
             FROM unnest($2::int[]) AS o(offset_day)
             LEFT JOIN offer_completions oc
               ON oc.user_id = ANY($1::uuid[])
              AND oc.created_at::date <= ($3::date + (o.offset_day * ${groupBy === 'week' ? 7 : 1}))
             GROUP BY o.offset_day
             ORDER BY o.offset_day`,
          [userIds, offsets, cohortStartIso],
        );
        for (const r of playsRows) {
          offerPlaysByOffset.set(r.offset_day, r.plays ?? 0);
        }
      } catch (playsErr) {
        console.warn('[admin/retention/cohorts] offer plays lookup failed for cohort', cohortStartIso, ':', (playsErr as Error).message);
      }

      for (const offset of offsets) {
        // Calendar-day (or calendar-week) retention: a user is retained on
        // day/week N if they have any event whose date_trunc matches the
        // cohort's date_trunc + N units. Using strict >=N*24h / <(N+1)*24h
        // intervals was wrong — someone who registers at 22:00 and returns
        // at 09:00 the next morning would be missed entirely despite being
        // a textbook D1-retained user. Industry standard (GA / Amplitude /
        // Mixpanel) is calendar-bucket based.
        //
        // Synthetic events filter (`retention.%`, `system.%`):
        // server-side rollups emit milestone events on the user's
        // behalf (analytics-rollup.ts → retention.dN_return). Letting
        // those count as "real activity" creates a self-fulfilling
        // loop — a D3 retention event on day register+3 would mark
        // its own user as D3-retained even when nothing else
        // happened that day. Filter them out so the heatmap reflects
        // genuine product engagement only.
        const retainedRow = await query<{ c: number }>(
          groupBy === 'week'
            ? `SELECT count(DISTINCT e.user_id)::int AS c
               FROM events e
               JOIN users u ON u.id = e.user_id
               WHERE e.user_id = ANY($1::uuid[])
                 AND e.event_name NOT LIKE 'retention.%'
                 AND e.event_name NOT LIKE 'system.%'
                 AND date_trunc('week', e.created_at)::date
                     = date_trunc('week', u.created_at)::date + ($2::int * 7)`
            : `SELECT count(DISTINCT e.user_id)::int AS c
               FROM events e
               JOIN users u ON u.id = e.user_id
               WHERE e.user_id = ANY($1::uuid[])
                 AND e.event_name NOT LIKE 'retention.%'
                 AND e.event_name NOT LIKE 'system.%'
                 AND e.created_at::date = u.created_at::date + $2::int`,
          [userIds, offset]
        );
        const retained = retainedRow[0]?.c || 0;
        const revCents = revByOffset.get(offset) ?? 0;
        // ROAS = revenue / cost. Null when cost is missing — UI
        // renders "—" so analysts don't mistake "no spend data"
        // for "0% return".
        const roasPct = costCents > 0 ? Math.round((revCents / costCents) * 1000) / 10 : null;
        out.retention[offset] = {
          count: retained,
          pct: cohort.cohort_size > 0 ? Math.round((retained / cohort.cohort_size) * 1000) / 10 : 0,
          rev_cents: revCents,
          roas_pct: roasPct,
          ads_requested: adsByOffset.get(offset) ?? 0,
          offer_plays: offerPlaysByOffset.get(offset) ?? 0,
        };
      }

      result.push(out);
    }

    res.json({
      group_by: groupBy,
      offsets,
      source_filter: sourceFilter,
      currency: 'USD',
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
    const filters: string[] = [`date_trunc('${groupBy}', u.created_at)::date = $1::date`];
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

    // Retention-day predicate. Same calendar-bucket logic as /cohorts.
    let retentionJoin = '';
    let retentionWhere = '';
    if (offset !== null) {
      pi++;
      params.push(offset);
      const retentionPred = groupBy === 'week'
        ? `date_trunc('week', e.created_at)::date = date_trunc('week', u.created_at)::date + ($${pi}::int * 7)`
        : `e.created_at::date = u.created_at::date + $${pi}::int`;
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
         u.created_at,
         u.last_active_at,
         (SELECT rank_id FROM farms WHERE user_id = u.id LIMIT 1) AS rank_id,
         ${offset !== null
           ? 'ev.events_on_day, ev.first_event_on_day, ev.last_event_on_day'
           : 'NULL::int AS events_on_day, NULL::timestamptz AS first_event_on_day, NULL::timestamptz AS last_event_on_day'}
       FROM users u
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
