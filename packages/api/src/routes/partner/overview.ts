import { Router, type Request, type Response } from 'express';
import { query, queryOne } from '../../lib/db.js';

export const partnerOverviewRouter = Router();

function parseDays(raw: unknown, def = 30): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(180, Math.round(n)));
}

/**
 * GET /partner/overview?days=30
 *
 * Single "hero" endpoint for the landing page of the portal — returns
 * KPIs, funnel and a daily timeseries in one round-trip. Empty states
 * are handled gracefully: on a fresh partner with no traffic yet every
 * count returns 0 and the funnel is still rendered (so the page doesn't
 * look broken before the first user installs).
 */
partnerOverviewRouter.get('/', async (req: Request, res: Response) => {
  const partnerId = req.partner!.partnerId;
  const days = parseDays(req.query.days);

  const partner = await queryOne<{
    slug: string;
    name: string;
    status: string;
    default_payout_cents: number;
    postback_configured: boolean;
  }>(
    `SELECT slug, name, status, default_payout_cents,
            (postback_url_template IS NOT NULL AND postback_url_template <> '') AS postback_configured
     FROM partners WHERE id = $1`,
    [partnerId],
  );

  if (!partner) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Partner not found' } });
    return;
  }

  // ── Totals (fast, single round-trip) ──
  const totals = await queryOne<{
    attributed_users: number;
    conversions: number;
    harvests: number;
    payout_pending: number;
    payout_approved: number;
    payout_paid: number;
  }>(
    `WITH conv AS (
       SELECT * FROM partner_conversions
       WHERE partner_id = $1
         AND created_at >= now() - ($2 || ' days')::interval
     ), users_in_window AS (
       SELECT id FROM users
       WHERE partner_id = $1
         AND created_at >= now() - ($2 || ' days')::interval
     )
     SELECT
       (SELECT count(*)::int FROM users_in_window)                                       AS attributed_users,
       (SELECT count(*)::int FROM conv)                                                  AS conversions,
       (SELECT count(*)::int FROM conv WHERE event_type = 'harvest')                     AS harvests,
       (SELECT coalesce(sum(payout_cents), 0)::int FROM conv WHERE status = 'pending')   AS payout_pending,
       (SELECT coalesce(sum(payout_cents), 0)::int FROM conv WHERE status = 'approved')  AS payout_approved,
       (SELECT coalesce(sum(payout_cents), 0)::int FROM conv WHERE status = 'paid')      AS payout_paid`,
    [partnerId, days],
  );

  // ── Daily breakdown for the chart ──
  const daily = await query<{ date: string; installs: number; harvests: number; payout_cents: number }>(
    `WITH days AS (
       SELECT generate_series(
         (now() - ($2 || ' days')::interval)::date,
         now()::date,
         '1 day'::interval
       )::date AS d
     )
     SELECT
       to_char(d.d, 'YYYY-MM-DD')                                                         AS date,
       coalesce(inst.n, 0)::int                                                           AS installs,
       coalesce(harv.n, 0)::int                                                           AS harvests,
       coalesce(harv.payout, 0)::int                                                      AS payout_cents
     FROM days d
     LEFT JOIN (
       SELECT created_at::date AS d, count(*) AS n
       FROM users WHERE partner_id = $1
       GROUP BY 1
     ) inst ON inst.d = d.d
     LEFT JOIN (
       SELECT created_at::date AS d,
              count(*) FILTER (WHERE event_type = 'harvest') AS n,
              sum(payout_cents) FILTER (WHERE event_type = 'harvest') AS payout
       FROM partner_conversions WHERE partner_id = $1
       GROUP BY 1
     ) harv ON harv.d = d.d
     ORDER BY d.d`,
    [partnerId, days],
  );

  // ── Funnel: counts of distinct attributed users who reached each step ──
  // Full progression: install → register → tutorial → first_play →
  // engaged_d0 → d1_return → stage_2..6 → harvest → harvest_x3.
  // Steps with zero users still render (UI wants a uniform bar chart),
  // so we LEFT JOIN on a static step list. Each `farm.stage_reached`
  // row carries the stage in `properties->>'stage'`; we count DISTINCT
  // users per stage threshold so the funnel shows monotonic dropoff
  // (a user who reached stage_5 also counts toward stage_2..4).
  const funnel = await query<{ step: string; users: number }>(
    `WITH
      attributed AS (
        SELECT id, created_at FROM users
        WHERE partner_id = $1
          AND created_at >= now() - ($2 || ' days')::interval
      ),
      evt AS (
        SELECT e.user_id, e.event_name, (e.properties->>'stage')::int AS stage
        FROM events e
        JOIN attributed a ON a.id = e.user_id
      ),
      per_step AS (
        SELECT 'install'         AS step, count(*)::int AS users FROM attributed
        UNION ALL
        SELECT 'register',        count(DISTINCT user_id)::int FROM evt WHERE event_name = 'auth.register'
        UNION ALL
        SELECT 'tutorial',        count(DISTINCT user_id)::int FROM evt WHERE event_name = 'onboarding.tutorial_finished'
        UNION ALL
        SELECT 'first_play',      count(DISTINCT user_id)::int FROM evt WHERE event_name = 'onboarding.first_farm_tick'
        UNION ALL
        SELECT 'engaged_d0',      count(DISTINCT user_id)::int FROM evt WHERE event_name = 'EngagedD0'
        UNION ALL
        SELECT 'd1_return',       count(DISTINCT user_id)::int FROM evt WHERE event_name = 'retention.d1_return'
        UNION ALL
        SELECT 'stage_2',         count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.stage_reached' AND stage >= 2
        UNION ALL
        SELECT 'stage_3',         count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.stage_reached' AND stage >= 3
        UNION ALL
        SELECT 'stage_4',         count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.stage_reached' AND stage >= 4
        UNION ALL
        SELECT 'stage_5',         count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.stage_reached' AND stage >= 5
        UNION ALL
        SELECT 'stage_6',         count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.stage_reached' AND stage >= 6
        UNION ALL
        SELECT 'harvest',         count(DISTINCT user_id)::int FROM (
          SELECT user_id FROM evt WHERE event_name = 'farm.harvested'
          UNION
          SELECT user_id FROM partner_conversions
            WHERE partner_id = $1 AND event_type = 'harvest'
              AND created_at >= now() - ($2 || ' days')::interval
        ) h
        UNION ALL
        SELECT 'harvest_x3',      count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.harvest_x3'
      )
      SELECT step, users FROM per_step`,
    [partnerId, days],
  );

  const stepOrder = [
    'install',
    'register',
    'tutorial',
    'first_play',
    'engaged_d0',
    'd1_return',
    'stage_2',
    'stage_3',
    'stage_4',
    'stage_5',
    'stage_6',
    'harvest',
    'harvest_x3',
  ];
  const byStep = new Map(funnel.map((r) => [r.step, r.users] as const));
  const installs = byStep.get('install') ?? 0;
  const funnelOrdered = stepOrder.map((step) => {
    const users = byStep.get(step) ?? 0;
    return {
      step,
      users,
      pct: installs > 0 ? Math.round((users / installs) * 1000) / 10 : 0,
    };
  });

  res.json({
    success: true,
    data: {
      partner: {
        slug: partner.slug,
        name: partner.name,
        status: partner.status,
        defaultPayoutCents: partner.default_payout_cents,
        postbackConfigured: partner.postback_configured,
      },
      range: { days },
      totals: {
        attributedUsers: totals?.attributed_users ?? 0,
        conversions: totals?.conversions ?? 0,
        harvests: totals?.harvests ?? 0,
        payoutPendingCents: totals?.payout_pending ?? 0,
        payoutApprovedCents: totals?.payout_approved ?? 0,
        payoutPaidCents: totals?.payout_paid ?? 0,
      },
      funnel: funnelOrdered,
      daily: daily.map((r) => ({
        date: r.date,
        installs: r.installs,
        harvests: r.harvests,
        payoutCents: r.payout_cents,
      })),
    },
  });
});
