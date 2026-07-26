import { Router } from 'express';
import { query, queryOne } from '../../lib/db.js';
import { tzExpr, REPORTING_TZ } from '../../lib/reporting-tz.js';

export const adminAdsRouter = Router();

// Calendar-day bucketing in REPORTING_TZ — same axis as /admin/retention.
const DAY = (col: string) => `${tzExpr(col)}::date`;
const TODAY = `(now() AT TIME ZONE '${REPORTING_TZ}')::date`;

/**
 * Window helpers. Every endpoint accepts `?days=N` (default 7, max 90)
 * so the admin UI can pivot without needing separate endpoints per range.
 */
function parseDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 7;
  return Math.max(1, Math.min(90, Math.round(n)));
}

/**
 * Honest rewarded-ad funnel — one stage per distinct user intent.
 *
 * The numbers in the admin used to mismatch (shown > requested, rewarded
 * > shown) because multiple emitters fire for the same user intent and
 * we were blind-counting raw events. This query imposes the following
 * explicit contract on every stage:
 *
 *   attempts         — user intent. Exactly one per button tap.
 *                      Source: `ad.requested` events carrying
 *                      `properties.has_native` (the marker the web
 *                      layer stamps to distinguish a real tap from
 *                      the Android bridge's internal request echo).
 *
 *   loaded           — how many times the SDK reported a filled
 *                      waterfall (`ad.loaded`). Purely informational —
 *                      the SDK emits this on auto-cache refresh too
 *                      so loaded can exceed attempts; we keep it as
 *                      a diagnostic, not part of the funnel maths.
 *
 *   no_fill          — attempts where mediation returned nothing.
 *                      We intentionally drop `ad.no_fill` events
 *                      whose `placement` is NULL because those come
 *                      from ironSource's *global* onAdUnavailable
 *                      callback, which fires on network-wide fill
 *                      changes without any placement context.
 *
 *   sdk_impressions  — real ironSource ad actually played
 *                      (`ad.shown`, fired by LevelPlay onAdOpened).
 *
 *   mock_impressions — our fallback mock-ad modal presented when the
 *                      SDK had no fill (`ad.fallback_shown`). Kept
 *                      separate so admins can see how often we're
 *                      papering over a lack of inventory.
 *
 *   impressions      — sdk_impressions + mock_impressions.
 *
 *   completions      — user finished the ad and was *reward-eligible*.
 *                      Source: `ad.rewarded`. Note: this is still
 *                      client-side, so a flaky network may drop the
 *                      event even though the reward was credited —
 *                      hence why we keep `rewards_paid` separate.
 *
 *   rewards_paid     — authoritative, server-side acknowledgement
 *                      that water / fertiliser was actually credited
 *                      to the user's balance (`ad.server_granted`).
 *                      Driven by an idempotency key on the API so
 *                      double-credits are impossible. This is the
 *                      only number the CFO should trust.
 *
 *   sdk_errors       — `ad.failed` (SDK exploded mid-show). Should
 *                      be near-zero in steady state.
 *
 * Derived rates (computed on the fly by the UI, not here):
 *
 *     fill_rate      = (sdk_impressions + no_fill backfilled via mock
 *                       — i.e. anything that reached a slot) / attempts
 *     watch_through  = completions / impressions
 *     payout_rate    = rewards_paid / completions   (should be ~100%)
 *
 * The `placement IN ('', 'unknown')` rows were noise — they came from
 * old APK builds that sent events without a placement — so we drop
 * them in HAVING to keep the table focused.
 */
adminAdsRouter.get('/funnel', async (req, res) => {
  try {
    const days = parseDays(req.query.days);

    // IMPORTANT: GROUP BY ordinals (1,2,3) rather than aliases — the alias
    // names `platform` / `placement` collide with real columns on `events`
    // (added in migration 020). Postgres would silently resolve the alias
    // to the column and leave the JSON-fallback branch un-aggregated,
    // throwing 42803.
    const rows = await query<any>(
      `SELECT
         ${DAY('e.created_at')}::text AS stat_date,
         coalesce(e.platform, e.device->>'platform', 'unknown') AS platform,
         coalesce(nullif(e.placement, ''), 'unknown') AS placement,
         'rewarded'::text AS ad_unit,
         count(*) FILTER (
           WHERE e.event_name = 'ad.requested'
             AND e.properties ? 'has_native'
         )::int AS attempts,
         count(*) FILTER (WHERE e.event_name = 'ad.loaded')::int AS loaded,
         count(*) FILTER (
           WHERE e.event_name = 'ad.no_fill'
             AND e.placement IS NOT NULL
         )::int AS no_fill,
         count(*) FILTER (WHERE e.event_name = 'ad.shown')::int          AS sdk_impressions,
         count(*) FILTER (WHERE e.event_name = 'ad.fallback_shown')::int AS mock_impressions,
         count(*) FILTER (WHERE e.event_name = 'ad.rewarded')::int       AS completions,
         count(*) FILTER (WHERE e.event_name = 'ad.server_granted')::int AS rewards_paid,
         count(*) FILTER (WHERE e.event_name = 'ad.failed')::int         AS sdk_errors,
         count(DISTINCT e.user_id)::int AS unique_users,
         (${DAY('e.created_at')} = ${TODAY}) AS today
       FROM events e
       WHERE e.event_name LIKE 'ad.%'
         AND e.created_at >= now() - (($1::int + 1) || ' days')::interval
         AND ${DAY('e.created_at')} > ${TODAY} - ($1::int + 1)
       GROUP BY 1, 2, 3, today
       HAVING coalesce(nullif(e.placement, ''), 'unknown') <> 'unknown'
          AND count(*) FILTER (
                WHERE e.event_name IN (
                        'ad.requested','ad.loaded','ad.no_fill',
                        'ad.shown','ad.fallback_shown',
                        'ad.rewarded','ad.server_granted',
                        'ad.failed','ad.closed')
                  AND ( e.event_name <> 'ad.requested' OR e.properties ? 'has_native' )
                  AND ( e.event_name <> 'ad.no_fill'   OR e.placement IS NOT NULL )
              ) > 0
       ORDER BY stat_date DESC, placement`,
      [days],
    );

    // Enriched rows: add impressions = sdk + mock so the UI can render
    // a single "Impressions" bar while still showing the split.
    const enriched = rows.map((r) => ({
      ...r,
      impressions: (r.sdk_impressions || 0) + (r.mock_impressions || 0),
    }));

    res.json({ days, rows: enriched });
  } catch (err) {
    console.error('[admin/ads/funnel]', err);
    res.status(500).json({ error: 'Failed to build ads funnel' });
  }
});

/**
 * GET /admin/ads/placements
 * Per-placement totals over `days` — same stage vocabulary as /funnel so
 * columns stay consistent across tabs.
 *
 * Revenue is joined in live from `events` (where ad.revenue impressions
 * land via the ILRD listener on Android) because `ad_funnel_daily`
 * intentionally does not carry money — keeping the rollup schema stable
 * means we can add revenue dimensions later without a migration.
 */
adminAdsRouter.get('/placements', async (req, res) => {
  try {
    const days = parseDays(req.query.days);
    const funnelRows = await query<any>(
      `SELECT
         coalesce(nullif(e.placement, ''), 'unknown') AS placement,
         count(*) FILTER (
           WHERE e.event_name = 'ad.requested'
             AND e.properties ? 'has_native'
         )::int AS attempts,
         count(*) FILTER (WHERE e.event_name = 'ad.shown')::int          AS sdk_impressions,
         count(*) FILTER (WHERE e.event_name = 'ad.fallback_shown')::int AS mock_impressions,
         count(*) FILTER (WHERE e.event_name = 'ad.rewarded')::int       AS completions,
         count(*) FILTER (WHERE e.event_name = 'ad.server_granted')::int AS rewards_paid,
         count(*) FILTER (WHERE e.event_name = 'ad.failed')::int         AS sdk_errors,
         count(*) FILTER (
           WHERE e.event_name = 'ad.no_fill'
             AND e.placement IS NOT NULL
         )::int AS no_fill,
         count(DISTINCT e.user_id)::int AS unique_users
       FROM events e
       WHERE e.event_name LIKE 'ad.%'
         AND e.created_at >= now() - ($1 || ' days')::interval
       GROUP BY coalesce(nullif(e.placement, ''), 'unknown')`,
      [days],
    );
    const revenueRows = await query<{ placement: string; impressions: number; revenue_cents: number }>(
      `SELECT
         coalesce(nullif(placement, ''), 'unknown') AS placement,
         count(*)::int AS impressions,
         coalesce(sum(revenue_cents), 0)::bigint AS revenue_cents
       FROM events
       WHERE event_name = 'ad.revenue'
         AND created_at >= now() - ($1 || ' days')::interval
       GROUP BY placement`,
      [days],
    );
    const revenueByPlacement = new Map(
      revenueRows.map((r) => [r.placement, { impressions: r.impressions, revenue_cents: Number(r.revenue_cents) }]),
    );
    const placementsSet = new Set<string>([
      ...funnelRows.map((r) => r.placement),
      ...revenueRows.map((r) => r.placement),
    ]);
    const rows = Array.from(placementsSet)
      .filter((p) => p && p !== 'unknown')
      .map((placement) => {
        const f = funnelRows.find((r) => r.placement === placement) ?? {
          placement,
          attempts: 0,
          sdk_impressions: 0,
          mock_impressions: 0,
          completions: 0,
          rewards_paid: 0,
          sdk_errors: 0,
          no_fill: 0,
          unique_users: 0,
        };
        const rev = revenueByPlacement.get(placement) ?? { impressions: 0, revenue_cents: 0 };
        return {
          ...f,
          impressions: (f.sdk_impressions || 0) + (f.mock_impressions || 0),
          revenue_impressions: rev.impressions,
          revenue_cents: rev.revenue_cents,
        };
      });
    rows.sort(
      (a, b) =>
        (b.revenue_cents || 0) - (a.revenue_cents || 0) || (b.attempts || 0) - (a.attempts || 0),
    );
    res.json({ days, rows });
  } catch (err) {
    console.error('[admin/ads/placements]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * GET /admin/ads/revenue
 * Product revenue breakdown over `days`. All figures come from raw
 * `events` rows where `event_name = 'ad.revenue'` (ILRD), so the data is
 * always live (no cron dependency).
 *
 * Response:
 *   totals: { impressions, revenue_cents, dau_with_ads, arpdau_cents, ecpm_cents }
 *   daily:  [{ stat_date, impressions, revenue_cents }]
 *   by_network:  [{ network, impressions, revenue_cents, share_pct }]
 *   by_country:  [{ country, impressions, revenue_cents }]
 *   by_placement: [{ placement, impressions, revenue_cents }]
 *   top_users:   [{ user_id, email, impressions, revenue_cents }]
 */
adminAdsRouter.get('/revenue', async (req, res) => {
  try {
    const days = parseDays(req.query.days);

    const [totalsRow, daily, byNetwork, byCountry, byPlacement, topUsers] = await Promise.all([
      queryOne<{
        impressions: number;
        revenue_cents: number;
        dau_with_ads: number;
      }>(
        `SELECT
           count(*)::int AS impressions,
           coalesce(sum(revenue_cents), 0)::bigint AS revenue_cents,
           count(DISTINCT user_id)::int AS dau_with_ads
         FROM events
         WHERE event_name = 'ad.revenue'
           AND created_at >= now() - ($1 || ' days')::interval`,
        [days],
      ),
      query<{ stat_date: string; impressions: number; revenue_cents: number }>(
        `SELECT
           ${DAY('created_at')}::text AS stat_date,
           count(*)::int AS impressions,
           coalesce(sum(revenue_cents), 0)::bigint AS revenue_cents
         FROM events
         WHERE event_name = 'ad.revenue'
           AND created_at >= now() - ($1 || ' days')::interval
         GROUP BY stat_date
         ORDER BY stat_date ASC`,
        [days],
      ),
      query<{ network: string; impressions: number; revenue_cents: number }>(
        `SELECT
           coalesce(properties->>'network', 'unknown') AS network,
           count(*)::int AS impressions,
           coalesce(sum(revenue_cents), 0)::bigint AS revenue_cents
         FROM events
         WHERE event_name = 'ad.revenue'
           AND created_at >= now() - ($1 || ' days')::interval
         GROUP BY network
         ORDER BY revenue_cents DESC
         LIMIT 25`,
        [days],
      ),
      query<{ country: string; impressions: number; revenue_cents: number }>(
        `SELECT
           coalesce(nullif(properties->>'country', ''), 'unknown') AS country,
           count(*)::int AS impressions,
           coalesce(sum(revenue_cents), 0)::bigint AS revenue_cents
         FROM events
         WHERE event_name = 'ad.revenue'
           AND created_at >= now() - ($1 || ' days')::interval
         GROUP BY country
         ORDER BY revenue_cents DESC
         LIMIT 25`,
        [days],
      ),
      query<{ placement: string; impressions: number; revenue_cents: number }>(
        `SELECT
           coalesce(placement, 'unknown') AS placement,
           count(*)::int AS impressions,
           coalesce(sum(revenue_cents), 0)::bigint AS revenue_cents
         FROM events
         WHERE event_name = 'ad.revenue'
           AND created_at >= now() - ($1 || ' days')::interval
         GROUP BY placement
         ORDER BY revenue_cents DESC`,
        [days],
      ),
      query<{ user_id: string; email: string | null; impressions: number; revenue_cents: number }>(
        `SELECT
           e.user_id,
           u.email,
           count(*)::int AS impressions,
           coalesce(sum(e.revenue_cents), 0)::bigint AS revenue_cents
         FROM events e
         LEFT JOIN users u ON u.id = e.user_id
         WHERE e.event_name = 'ad.revenue'
           AND e.created_at >= now() - ($1 || ' days')::interval
         GROUP BY e.user_id, u.email
         ORDER BY revenue_cents DESC
         LIMIT 25`,
        [days],
      ),
    ]);

    const impressions = totalsRow?.impressions ?? 0;
    const revenue_cents = Number(totalsRow?.revenue_cents ?? 0);
    const dau_with_ads = totalsRow?.dau_with_ads ?? 0;
    const arpdau_cents = dau_with_ads > 0 ? Math.round(revenue_cents / dau_with_ads) : 0;
    // eCPM = revenue / impressions * 1000, expressed in cents.
    const ecpm_cents = impressions > 0 ? Math.round((revenue_cents / impressions) * 1000) : 0;

    // Mixpanel-style "share %" for the network table.
    const netTotal = byNetwork.reduce((s, r) => s + Number(r.revenue_cents), 0);
    const by_network = byNetwork.map((r) => ({
      network: r.network,
      impressions: r.impressions,
      revenue_cents: Number(r.revenue_cents),
      share_pct: netTotal > 0 ? Math.round((Number(r.revenue_cents) / netTotal) * 1000) / 10 : 0,
    }));

    res.json({
      days,
      totals: {
        impressions,
        revenue_cents,
        dau_with_ads,
        arpdau_cents,
        ecpm_cents,
      },
      daily: daily.map((d) => ({
        stat_date: d.stat_date,
        impressions: d.impressions,
        revenue_cents: Number(d.revenue_cents),
      })),
      by_network,
      by_country: byCountry.map((r) => ({ ...r, revenue_cents: Number(r.revenue_cents) })),
      by_placement: byPlacement.map((r) => ({ ...r, revenue_cents: Number(r.revenue_cents) })),
      top_users: topUsers.map((r) => ({ ...r, revenue_cents: Number(r.revenue_cents) })),
    });
  } catch (err) {
    console.error('[admin/ads/revenue]', err);
    res.status(500).json({ error: 'Failed to build ads revenue report' });
  }
});

/**
 * GET /admin/ads/errors
 * Groups recent `ad.failed` / `ad.no_fill` events by error code/reason so
 * admins can see "why ads aren't filling" without exporting raw events.
 */
adminAdsRouter.get('/errors', async (req, res) => {
  try {
    const days = parseDays(req.query.days);
    const rows = await query<any>(
      `SELECT
         event_name,
         coalesce(properties->>'error_code', properties->>'reason', 'unknown') AS code,
         coalesce(properties->>'error_message', properties->>'reason', '') AS message,
         coalesce(placement, 'unknown') AS placement,
         count(*)::int AS c,
         max(created_at) AS last_seen
       FROM events
       WHERE event_name IN ('ad.failed','ad.no_fill')
         AND created_at >= now() - ($1 || ' days')::interval
       GROUP BY event_name, code, message, placement
       ORDER BY c DESC
       LIMIT 50`,
      [days],
    );
    res.json({ days, rows });
  } catch (err) {
    console.error('[admin/ads/errors]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * GET /admin/ads/status
 * Lightweight heartbeat for the ops dashboard. Uses the same stage
 * vocabulary as /funnel so the UI can share formatting helpers.
 */
adminAdsRouter.get('/status', async (_req, res) => {
  try {
    const byName = await query<any>(
      `SELECT event_name, max(created_at) AS last_at, count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS last_hour
       FROM events
       WHERE event_name LIKE 'ad.%'
       GROUP BY event_name`,
    );
    const hourly = await queryOne<any>(
      `SELECT
         count(*) FILTER (
           WHERE event_name = 'ad.requested'
             AND properties ? 'has_native'
         )::int AS attempts,
         count(*) FILTER (WHERE event_name = 'ad.shown')::int          AS sdk_impressions,
         count(*) FILTER (WHERE event_name = 'ad.fallback_shown')::int AS mock_impressions,
         count(*) FILTER (WHERE event_name = 'ad.rewarded')::int       AS completions,
         count(*) FILTER (WHERE event_name = 'ad.server_granted')::int AS rewards_paid,
         count(*) FILTER (WHERE event_name = 'ad.revenue')::int        AS revenue_impressions,
         coalesce(sum(revenue_cents) FILTER (WHERE event_name = 'ad.revenue'), 0)::bigint AS revenue_cents
       FROM events
       WHERE event_name LIKE 'ad.%'
         AND created_at > now() - interval '1 hour'`,
    );
    const attempts = hourly?.attempts || 0;
    const sdk_impressions = hourly?.sdk_impressions || 0;
    const mock_impressions = hourly?.mock_impressions || 0;
    const impressions = sdk_impressions + mock_impressions;
    const completions = hourly?.completions || 0;
    const rewards_paid = hourly?.rewards_paid || 0;
    const revenue_impressions = hourly?.revenue_impressions || 0;
    const revenue_cents = Number(hourly?.revenue_cents || 0);
    // Fill rate = how often we served *something* (SDK or mock) for an attempt.
    const fill_rate_1h = attempts > 0 ? Math.round((impressions / attempts) * 1000) / 10 : null;
    // Payout rate = how often a completion was actually credited on the server.
    const payout_rate_1h =
      completions > 0 ? Math.round((rewards_paid / completions) * 1000) / 10 : null;

    res.json({
      levelplay_configured: ['true', '1', 'yes'].includes(
        (process.env.LEVELPLAY_CONFIGURED ?? '').toLowerCase(),
      ),
      by_event: byName,
      last_hour: {
        attempts,
        sdk_impressions,
        mock_impressions,
        impressions,
        completions,
        rewards_paid,
        fill_rate_1h,
        payout_rate_1h,
        revenue_impressions,
        revenue_cents,
      },
    });
  } catch (err) {
    console.error('[admin/ads/status]', err);
    res.status(500).json({ error: 'Failed' });
  }
});
