import { Router } from 'express';
import { query, queryOne } from '../../lib/db.js';

export const adminAdsRouter = Router();

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
 * GET /admin/ads/funnel
 * Per-day / per-placement funnel built directly from the raw `events`
 * table so admins can see *exactly* what happened, with no rollup skew.
 *
 * Counting rules — these are the answer to "why do the numbers in the
 * table actually add up now" (see below for each column):
 *
 *   requested  — the web layer always emits `ad.requested` on user
 *                intent, and the Kotlin LevelPlay bridge ALSO emits one
 *                moments later from `showRewarded`. Web-emitted events
 *                carry `has_native` in `properties`; the Kotlin path
 *                does not. Filtering on `properties ? 'has_native'`
 *                keeps exactly one row per real user intent.
 *
 *   loaded     — `ad.loaded` from the SDK listener. No dedup needed.
 *
 *   no_fill    — we drop events that came from the SDK's **global**
 *                `onAdUnavailable` callback, because that one fires on
 *                network-wide fill-rate changes (no placement context)
 *                and was showing up as an inflated "unknown" row in
 *                admin. Keeping only `ad.no_fill` events with a real
 *                `placement` gives one row per failed user intent.
 *
 *   shown      — union of `ad.shown` (native ironSource impression)
 *                and `ad.fallback_shown` (mock-ad modal presented when
 *                the SDK had no fill). Admins want "did the user see
 *                something?", not "did the mediation pipeline serve?".
 *
 *   rewarded   — `ad.rewarded` only. `ad.server_granted` is the
 *                server-side acknowledgement of the SAME reward and
 *                was double-counting water/fert popup payouts.
 *
 *   failed / closed — unchanged, one event each.
 *
 *   unique_users — distinct `user_id` across ALL ad.* events in the
 *                bucket (good proxy for "people who touched an ad
 *                slot for this placement that day").
 *
 * Performance: we rely on `idx_events_name (event_name, created_at)`
 * from migration 016 plus `idx_events_placement` from 020. Up to
 * `days=90` the full scan is still bounded to the "ad.%" prefix and
 * runs in well under a second for our data volume.
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
         e.created_at::date::text AS stat_date,
         coalesce(e.platform, e.device->>'platform', 'unknown') AS platform,
         coalesce(e.placement, 'unknown') AS placement,
         'rewarded'::text AS ad_unit,
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
         (e.created_at::date = current_date) AS today
       FROM events e
       WHERE e.event_name LIKE 'ad.%'
         AND e.created_at >= (current_date - ($1 || ' days')::interval)::date
       GROUP BY 1, 2, 3, today
       -- Drop buckets where every counting column came out zero after the
       -- dedup rules above (e.g. an 'unknown' placement row whose only
       -- contributions were global onAdUnavailable emits, which we now
       -- exclude from no_fill). Such rows are noise, not signal.
       HAVING count(*) FILTER (
                WHERE e.event_name IN ('ad.requested','ad.loaded','ad.no_fill',
                                        'ad.shown','ad.fallback_shown','ad.rewarded',
                                        'ad.failed','ad.closed')
                  AND ( e.event_name <> 'ad.requested' OR e.properties ? 'has_native' )
                  AND ( e.event_name <> 'ad.no_fill'   OR e.placement IS NOT NULL )
              ) > 0
       ORDER BY stat_date DESC, placement`,
      [days],
    );

    res.json({ days, rows });
  } catch (err) {
    console.error('[admin/ads/funnel]', err);
    res.status(500).json({ error: 'Failed to build ads funnel' });
  }
});

/**
 * GET /admin/ads/placements
 * Per-placement totals over `days`. Useful for the "По слотам" tab.
 *
 * Revenue is joined in live from `events` (where ad.revenue impressions land
 * via the ILRD listener on Android) because `ad_funnel_daily` intentionally
 * does not carry money — keeping the rollup schema stable means we can add
 * revenue dimensions later without a migration.
 */
adminAdsRouter.get('/placements', async (req, res) => {
  try {
    const days = parseDays(req.query.days);
    // Read directly from events to apply the same dedup rules as the
    // Funnel endpoint (see /funnel docblock for why each filter exists).
    const funnelRows = await query<any>(
      `SELECT
         coalesce(e.placement, 'unknown') AS placement,
         count(*) FILTER (
           WHERE e.event_name = 'ad.requested'
             AND e.properties ? 'has_native'
         )::int AS requested,
         count(*) FILTER (
           WHERE e.event_name IN ('ad.shown', 'ad.fallback_shown')
         )::int AS shown,
         count(*) FILTER (WHERE e.event_name = 'ad.rewarded')::int AS rewarded,
         count(*) FILTER (WHERE e.event_name = 'ad.failed')::int AS failed,
         count(*) FILTER (
           WHERE e.event_name = 'ad.no_fill'
             AND e.placement IS NOT NULL
         )::int AS no_fill,
         count(DISTINCT e.user_id)::int AS unique_users
       FROM events e
       WHERE e.event_name LIKE 'ad.%'
         AND e.created_at >= now() - ($1 || ' days')::interval
       GROUP BY coalesce(e.placement, 'unknown')`,
      [days],
    );
    const revenueRows = await query<{ placement: string; impressions: number; revenue_cents: number }>(
      `SELECT
         coalesce(placement, 'unknown') AS placement,
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
    const placements = new Set<string>([
      ...funnelRows.map((r) => r.placement),
      ...revenueRows.map((r) => r.placement),
    ]);
    const rows = Array.from(placements).map((placement) => {
      const f = funnelRows.find((r) => r.placement === placement) ?? {
        placement,
        requested: 0,
        shown: 0,
        rewarded: 0,
        failed: 0,
        no_fill: 0,
        unique_users: 0,
      };
      const rev = revenueByPlacement.get(placement) ?? { impressions: 0, revenue_cents: 0 };
      return {
        ...f,
        impressions: rev.impressions,
        revenue_cents: rev.revenue_cents,
      };
    });
    rows.sort((a, b) => (b.revenue_cents || 0) - (a.revenue_cents || 0) || (b.requested || 0) - (a.requested || 0));
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
           created_at::date::text AS stat_date,
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
 * Lightweight heartbeat for the ops dashboard. Tells us:
 *   - when the ad pipeline last produced any event of each kind;
 *   - the last-5-minute fill rate (if any requested events in the last hour);
 *   - the current configured-flag from env for LevelPlay.
 */
adminAdsRouter.get('/status', async (_req, res) => {
  try {
    const byName = await query<any>(
      `SELECT event_name, max(created_at) AS last_at, count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS last_hour
       FROM events
       WHERE event_name LIKE 'ad.%'
       GROUP BY event_name`,
    );
    // Same dedup rules as /funnel — see that endpoint's docblock.
    const hourly = await queryOne<any>(
      `SELECT
         count(*) FILTER (
           WHERE event_name = 'ad.requested'
             AND properties ? 'has_native'
         )::int AS requested,
         count(*) FILTER (
           WHERE event_name IN ('ad.shown', 'ad.fallback_shown')
         )::int AS shown,
         count(*) FILTER (WHERE event_name = 'ad.rewarded')::int AS rewarded,
         count(*) FILTER (WHERE event_name = 'ad.revenue')::int  AS impressions,
         coalesce(sum(revenue_cents) FILTER (WHERE event_name = 'ad.revenue'), 0)::bigint AS revenue_cents
       FROM events
       WHERE event_name LIKE 'ad.%'
         AND created_at > now() - interval '1 hour'`,
    );
    const requested = hourly?.requested || 0;
    const shown = hourly?.shown || 0;
    const rewarded = hourly?.rewarded || 0;
    const impressions_1h = hourly?.impressions || 0;
    const revenue_cents_1h = Number(hourly?.revenue_cents || 0);
    const fill_rate_1h = requested > 0 ? Math.round((shown / requested) * 1000) / 10 : null;
    const reward_rate_1h = shown > 0 ? Math.round((rewarded / shown) * 1000) / 10 : null;

    res.json({
      levelplay_configured: ['true', '1', 'yes'].includes(
        (process.env.LEVELPLAY_CONFIGURED ?? '').toLowerCase(),
      ),
      by_event: byName,
      last_hour: {
        requested,
        shown,
        rewarded,
        fill_rate_1h,
        reward_rate_1h,
        impressions: impressions_1h,
        revenue_cents: revenue_cents_1h,
      },
    });
  } catch (err) {
    console.error('[admin/ads/status]', err);
    res.status(500).json({ error: 'Failed' });
  }
});
