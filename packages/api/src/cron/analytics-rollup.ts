import { execute, query } from '../lib/db.js';

/**
 * Nightly analytics rollup jobs.
 *
 * Design notes:
 *   - All rollups are idempotent (DELETE-then-INSERT by natural key). A rerun
 *     fixes data if it was partially populated earlier.
 *   - We roll up "yesterday" UTC because if we run at 02:00 UTC the day in
 *     progress is incomplete — the dashboard would show a dip.
 *   - Keep the set of dimensions small: `platform`, `country`, `utm_source`.
 *     More dimensions explode `daily_stats` fast.
 */

const PLATFORM_DIMS = ['all', 'android', 'web', 'ios'] as const;

/**
 * Extract the platform field from `events.platform` with a fallback to
 * `events.device->>'platform'` for rows written before migration 020.
 */
const PLATFORM_EXPR = `coalesce(e.platform, e.device->>'platform', 'unknown')`;

async function upsertDailyStat(
  date: string,
  metric: string,
  dimension: string,
  value: number,
): Promise<void> {
  await execute(
    `INSERT INTO daily_stats (stat_date, metric, dimension, value)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (stat_date, metric, dimension)
     DO UPDATE SET value = EXCLUDED.value`,
    [date, metric, dimension, value],
  );
}

/**
 * DAU / new_users / avg_session_sec per day, sliced by platform, country, utm.
 * Runs for the last 2 completed UTC days so a rerun fixes yesterday if the
 * previous night's cron was skipped (e.g. server restart).
 */
export async function rollupDailyStats(): Promise<void> {
  const startedAt = Date.now();
  try {
    const targetDays = await query<{ stat_date: string }>(
      `SELECT generate_series(
         (current_date - interval '2 days')::date,
         (current_date - interval '1 day')::date,
         interval '1 day'
       )::date::text AS stat_date`,
    );

    for (const { stat_date } of targetDays) {
      // DAU — platform dimension
      for (const platform of PLATFORM_DIMS) {
        const filter =
          platform === 'all' ? '' : `AND ${PLATFORM_EXPR} = $2`;
        const paramList: any[] = [stat_date];
        if (platform !== 'all') paramList.push(platform);
        const row = await query<{ c: number }>(
          `SELECT count(DISTINCT e.user_id)::int AS c
           FROM events e
           WHERE e.created_at::date = $1 ${filter}`,
          paramList,
        );
        await upsertDailyStat(stat_date, 'dau', platform, row[0]?.c ?? 0);
      }

      // New users per day — platform dimension.
      for (const platform of PLATFORM_DIMS) {
        const filter =
          platform === 'all' ? '' : `AND coalesce(u.device_platform, 'unknown') = $2`;
        const paramList: any[] = [stat_date];
        if (platform !== 'all') paramList.push(platform);
        const row = await query<{ c: number }>(
          `SELECT count(*)::int AS c
           FROM users u
           WHERE u.created_at::date = $1 ${filter}`,
          paramList,
        );
        await upsertDailyStat(stat_date, 'new_users', platform, row[0]?.c ?? 0);
      }

      // Session counts + avg duration (all platforms).
      const sess = await query<{ sessions: number; avg_sec: number | null }>(
        `SELECT
           count(*)::int AS sessions,
           coalesce(avg(duration_sec), 0)::int AS avg_sec
         FROM sessions
         WHERE started_at::date = $1 AND duration_sec IS NOT NULL`,
        [stat_date],
      );
      await upsertDailyStat(stat_date, 'sessions', 'all', sess[0]?.sessions ?? 0);
      await upsertDailyStat(stat_date, 'avg_session_sec', 'all', sess[0]?.avg_sec ?? 0);

      // New users by country (top 25 only — keeps daily_stats size bounded).
      const byCountry = await query<{ country: string; c: number }>(
        `SELECT coalesce(u.country, 'unknown') AS country, count(*)::int AS c
         FROM users u
         WHERE u.created_at::date = $1
         GROUP BY country
         ORDER BY c DESC
         LIMIT 25`,
        [stat_date],
      );
      for (const row of byCountry) {
        await upsertDailyStat(stat_date, 'new_users_country', row.country, row.c);
      }

      // New users by utm_source (top 25).
      const byUtm = await query<{ src: string; c: number }>(
        `SELECT coalesce(u.utm_source, 'organic') AS src, count(*)::int AS c
         FROM users u
         WHERE u.created_at::date = $1
         GROUP BY src
         ORDER BY c DESC
         LIMIT 25`,
        [stat_date],
      );
      for (const row of byUtm) {
        await upsertDailyStat(stat_date, 'new_users_utm', row.src, row.c);
      }
    }

    console.log(
      `[analytics-rollup] rollupDailyStats done in ${Date.now() - startedAt}ms (${targetDays.length} days)`,
    );
  } catch (err) {
    console.error('[analytics-rollup] rollupDailyStats failed:', (err as Error).message);
  }
}

/**
 * Build `ad_funnel_daily` from the `events` table. Idempotent per
 * (date, platform, placement, ad_unit): we delete existing rows for the
 * target dates first, then reinsert aggregated counts.
 */
export async function aggregateAdFunnel(): Promise<void> {
  const startedAt = Date.now();
  try {
    // Wipe the last 2 days so we can safely re-aggregate.
    await execute(
      `DELETE FROM ad_funnel_daily
       WHERE stat_date >= (current_date - interval '2 days')::date
         AND stat_date <= (current_date - interval '1 day')::date`,
    );

    // Counting rules mirror /admin/ads/funnel (see that endpoint's
    // docblock for the rationale):
    //   - `requested` is deduped to web-only via properties ? 'has_native'
    //     because the Kotlin bridge also emits one per show_rewarded;
    //   - `no_fill` ignores the global onAdUnavailable SDK callback
    //     (those events have NULL placement);
    //   - `shown` counts both native impressions and fallback modals;
    //   - `rewarded` counts `ad.rewarded` only — `ad.server_granted` is
    //     a downstream ack of the same payout and was double-counting.
    await execute(
      `INSERT INTO ad_funnel_daily (
         stat_date, platform, placement, ad_unit,
         requested, loaded, no_fill, shown, rewarded, failed, closed,
         unique_users, updated_at
       )
       SELECT
         e.created_at::date AS stat_date,
         ${PLATFORM_EXPR}    AS platform,
         coalesce(e.placement, 'unknown') AS placement,
         'rewarded' AS ad_unit,
         count(*) FILTER (
           WHERE e.event_name = 'ad.requested'
             AND e.properties ? 'has_native'
         )::int AS requested,
         count(*) FILTER (WHERE e.event_name = 'ad.loaded')::int AS loaded,
         count(*) FILTER (
           WHERE e.event_name = 'ad.no_fill'
             AND e.placement IS NOT NULL
         )::int AS no_fill,
         count(*) FILTER (
           WHERE e.event_name IN ('ad.shown', 'ad.fallback_shown')
         )::int AS shown,
         count(*) FILTER (WHERE e.event_name = 'ad.rewarded')::int AS rewarded,
         count(*) FILTER (WHERE e.event_name = 'ad.failed')::int AS failed,
         count(*) FILTER (WHERE e.event_name = 'ad.closed')::int AS closed,
         count(DISTINCT e.user_id)::int AS unique_users,
         now() AS updated_at
       FROM events e
       WHERE e.event_name LIKE 'ad.%'
         AND e.created_at >= (current_date - interval '2 days')::date
         AND e.created_at  < current_date
       -- GROUP BY ordinals instead of aliases: the alias names platform
       -- and placement collide with real columns on events (migration
       -- 020), and Postgres resolves to the column, not the alias, which
       -- leaves the JSON-fallback branch un-aggregated and throws 42803.
       GROUP BY 1, 2, 3, 4`,
    );

    console.log(
      `[analytics-rollup] aggregateAdFunnel done in ${Date.now() - startedAt}ms`,
    );
  } catch (err) {
    console.error('[analytics-rollup] aggregateAdFunnel failed:', (err as Error).message);
  }
}

/**
 * Top-level entry point registered next to `runPushCron` in src/index.ts.
 */
export async function runAnalyticsRollup(): Promise<void> {
  console.log('[analytics-rollup] start');
  await rollupDailyStats();
  await aggregateAdFunnel();
  console.log('[analytics-rollup] end');
}
