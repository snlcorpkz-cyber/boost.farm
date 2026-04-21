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
 * Returns aggregated daily funnel rows from `ad_funnel_daily`. Dashboards
 * derive fill rate = shown / requested, show rate, reward rate.
 *
 * We also compute a "today" row on the fly from the live `events` table so
 * the page isn't stale until the nightly cron catches up — it's clearly
 * labeled `today: true` in the response.
 */
adminAdsRouter.get('/funnel', async (req, res) => {
  try {
    const days = parseDays(req.query.days);

    const history = await query<any>(
      `SELECT stat_date::text AS stat_date, platform, placement, ad_unit,
              requested, loaded, no_fill, shown, rewarded, failed, closed,
              unique_users
       FROM ad_funnel_daily
       WHERE stat_date >= (current_date - ($1 || ' days')::interval)::date
       ORDER BY stat_date DESC, placement`,
      [days],
    );

    const todayByDim = await query<any>(
      `SELECT
         coalesce(e.platform, e.device->>'platform', 'unknown') AS platform,
         coalesce(e.placement, 'unknown') AS placement,
         coalesce(e.properties->>'ad_unit', 'rewarded') AS ad_unit,
         count(*) FILTER (WHERE e.event_name = 'ad.requested')::int AS requested,
         count(*) FILTER (WHERE e.event_name = 'ad.loaded')::int    AS loaded,
         count(*) FILTER (WHERE e.event_name = 'ad.no_fill')::int   AS no_fill,
         count(*) FILTER (WHERE e.event_name = 'ad.shown')::int     AS shown,
         count(*) FILTER (WHERE e.event_name IN ('ad.rewarded','ad.server_granted'))::int AS rewarded,
         count(*) FILTER (WHERE e.event_name = 'ad.failed')::int    AS failed,
         count(*) FILTER (WHERE e.event_name = 'ad.closed')::int    AS closed,
         count(DISTINCT e.user_id)::int AS unique_users
       FROM events e
       WHERE e.event_name LIKE 'ad.%'
         AND e.created_at::date = current_date
       GROUP BY platform, placement, ad_unit`,
    );

    const todayRows = todayByDim.map((r) => ({
      stat_date: new Date().toISOString().slice(0, 10),
      today: true,
      ...r,
    }));

    res.json({
      days,
      rows: [...todayRows, ...history.map((r) => ({ ...r, today: false }))],
    });
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
    const funnelRows = await query<any>(
      `SELECT
         coalesce(placement, 'unknown') AS placement,
         sum(requested)::int   AS requested,
         sum(shown)::int       AS shown,
         sum(rewarded)::int    AS rewarded,
         sum(failed)::int      AS failed,
         sum(no_fill)::int     AS no_fill,
         sum(unique_users)::int AS unique_users
       FROM ad_funnel_daily
       WHERE stat_date >= (current_date - ($1 || ' days')::interval)::date
       GROUP BY placement`,
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
    const hourly = await queryOne<any>(
      `SELECT
         count(*) FILTER (WHERE event_name = 'ad.requested')::int AS requested,
         count(*) FILTER (WHERE event_name = 'ad.shown')::int     AS shown,
         count(*) FILTER (WHERE event_name IN ('ad.rewarded','ad.server_granted'))::int AS rewarded,
         count(*) FILTER (WHERE event_name = 'ad.revenue')::int   AS impressions,
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
