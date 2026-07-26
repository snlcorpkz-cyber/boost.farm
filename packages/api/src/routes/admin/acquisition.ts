import { Router } from 'express';
import { query } from '../../lib/db.js';
import { tzExpr } from '../../lib/reporting-tz.js';

export const adminAcquisitionRouter = Router();

// Calendar-day bucketing in REPORTING_TZ — same axis as /admin/retention,
// so D1 here matches D1 on the cohort page for the same users.
const DAY = (col: string) => `${tzExpr(col)}::date`;
// Synthetic server-side milestones (analytics-rollup) must never count as
// "real return activity" — mirrors the exclusion in admin/retention.ts.
const REAL_EVENTS = `e.event_name NOT LIKE 'retention.%' AND e.event_name NOT LIKE 'system.%'`;

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
    // Prefer the richer `acquisition_source` JSONB — it's populated
    // from the Play Install Referrer which is the canonical source
    // for mobile installs. Fall back to the flat `utm_*` columns so
    // older users registered before the referrer pipeline was live
    // still appear.
    const rows = await query<any>(
      `SELECT
         coalesce(u.acquisition_source->>'utmSource', u.utm_source, 'organic') AS utm_source,
         coalesce(u.acquisition_source->>'utmMedium', u.utm_medium, '')        AS utm_medium,
         coalesce(u.acquisition_source->>'utmCampaign', u.utm_campaign, '')    AS utm_campaign,
         coalesce(u.acquisition_source->>'utmContent', '')                     AS utm_content,
         count(DISTINCT u.id)::int                AS users,
         count(DISTINCT CASE
           WHEN e.event_name = 'EngagedD0' THEN u.id
         END)::int                                AS engaged_d0,
         count(DISTINCT CASE
           WHEN ${DAY('e.created_at')} = ${DAY('u.created_at')} + 1
           THEN u.id
         END)::int                                AS d1_retained
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id AND ${REAL_EVENTS}
       WHERE u.created_at >= now() - ($1 || ' days')::interval
       GROUP BY utm_source, utm_medium, utm_campaign, utm_content
       ORDER BY users DESC
       LIMIT 100`,
      [days],
    );
    res.json({
      days,
      rows: rows.map((r) => ({
        ...r,
        d1_pct: r.users > 0 ? Math.round((r.d1_retained / r.users) * 1000) / 10 : 0,
        engaged_d0_pct: r.users > 0 ? Math.round((r.engaged_d0 / r.users) * 1000) / 10 : 0,
      })),
    });
  } catch (err) {
    console.error('[admin/acquisition/by-utm]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * GET /admin/acquisition/by-creative
 *
 * Breakdown by creative identifier — utm_content (populated from
 * `{{ad.name}}` in the Meta Ads Manager URL macros) with the raw
 * Meta ad id / campaign id surfaced alongside. This is the view to
 * look at when comparing creative concepts — "which video hook is
 * converting installs into EngagedD0 users".
 *
 * Data path:
 *   acquisition_source → users row, populated by InstallReferrerHelper
 *   via /auth/verify-code at signup. Includes installs that never
 *   clicked our link directly (view-through attribution via
 *   Play Install Referrer).
 */
adminAcquisitionRouter.get('/by-creative', async (req, res) => {
  try {
    const days = parseDays(req.query.days, 30);
    // AppsFlyer fields are PREFERRED over the legacy fb* columns:
    //   • AF carries the de-duped, fraud-filtered view of the same data.
    //   • AF populates `media_source` for non-Meta networks too (Google,
    //     TikTok, ironSource), so the report stays meaningful when we
    //     diversify ad spend.
    //   • The legacy fb* columns only cover Play Install Referrer-flagged
    //     installs; AF's coverage is broader (view-through, deferred
    //     deep links, click-id matching).
    // We fall back to the older paths whenever AF didn't see the install
    // (organic users, devices that crashed before SDK init, etc.).
    const rows = await query<any>(
      `SELECT
         coalesce(u.acquisition_source->>'afMediaSource',
                  u.acquisition_source->>'utmSource',
                  u.utm_source, 'organic')                AS media_source,
         coalesce(u.acquisition_source->>'afCampaign',
                  u.acquisition_source->>'utmCampaign',
                  u.utm_campaign, 'organic')              AS utm_campaign,
         coalesce(u.acquisition_source->>'afAdName',
                  u.acquisition_source->>'utmContent',
                  'no_creative')                          AS utm_content,
         coalesce(u.acquisition_source->>'afCampaignId',
                  u.acquisition_source->>'fbCampaignId', '') AS campaign_id,
         coalesce(u.acquisition_source->>'afAdsetId',
                  u.acquisition_source->>'fbAdsetId', '')    AS adset_id,
         coalesce(u.acquisition_source->>'afAdId',
                  u.acquisition_source->>'fbAdId', '')       AS ad_id,
         count(DISTINCT u.id)::int                        AS users,
         count(DISTINCT CASE
           WHEN e.event_name = 'EngagedD0' THEN u.id
         END)::int                                        AS engaged_d0,
         count(DISTINCT CASE
           WHEN ${DAY('e.created_at')} = ${DAY('u.created_at')} + 1
           THEN u.id
         END)::int                                        AS d1_retained
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id AND ${REAL_EVENTS}
       WHERE u.created_at >= now() - ($1 || ' days')::interval
         AND (u.acquisition_source IS NOT NULL OR u.utm_campaign IS NOT NULL)
       GROUP BY media_source, utm_campaign, utm_content,
                campaign_id, adset_id, ad_id
       ORDER BY users DESC
       LIMIT 200`,
      [days],
    );
    res.json({
      days,
      rows: rows.map((r) => ({
        ...r,
        d1_pct: r.users > 0 ? Math.round((r.d1_retained / r.users) * 1000) / 10 : 0,
        // EngagedD0 rate is the signal Meta Ads Manager optimises on —
        // expose it directly so the CPO can compare creative quality
        // without exporting data.
        engaged_d0_pct: r.users > 0 ? Math.round((r.engaged_d0 / r.users) * 1000) / 10 : 0,
      })),
    });
  } catch (err) {
    console.error('[admin/acquisition/by-creative]', err);
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
           WHEN ${DAY('e.created_at')} = ${DAY('u.created_at')} + 1
           THEN u.id
         END)::int AS d1_retained
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id AND ${REAL_EVENTS}
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
           date_trunc('week', ${tzExpr('u.created_at')})::date AS cohort_week,
           u.id,
           u.created_at
         FROM users u
         WHERE u.created_at >= now() - ($1 || ' weeks')::interval
       )
       SELECT
         wu.cohort_week::text AS cohort_week,
         count(DISTINCT wu.id)::int AS cohort_size,
         count(DISTINCT CASE
           WHEN ${DAY('e.created_at')} = ${DAY('wu.created_at')} + 1
           THEN wu.id END)::int AS d1,
         count(DISTINCT CASE
           WHEN ${DAY('e.created_at')} = ${DAY('wu.created_at')} + 3
           THEN wu.id END)::int AS d3,
         count(DISTINCT CASE
           WHEN ${DAY('e.created_at')} = ${DAY('wu.created_at')} + 7
           THEN wu.id END)::int AS d7
       FROM week_users wu
       LEFT JOIN events e ON e.user_id = wu.id AND ${REAL_EVENTS}
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
