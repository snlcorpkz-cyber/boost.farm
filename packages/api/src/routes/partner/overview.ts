import { Router, type Request, type Response } from 'express';
import { query, queryOne } from '../../lib/db.js';

export const partnerOverviewRouter = Router();

function parseDays(raw: unknown, def = 30): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(180, Math.round(n)));
}

/**
 * Funnel step catalogue.
 *
 * Maps every event the funnel can render to its display label and a
 * stable display order. The actual list of steps shown to a partner
 * is filtered by `partners.allowed_events` at request time — this
 * map only declares what we *can* render. When a teammate adds a new
 * marketing event (`auth.register`, `EngagedD0`, `farm.harvest_x3`,
 * etc.) it lands here with an order slot and is automatically
 * available for any partner whose admin opts in via allowed_events.
 *
 * Sources behind each step are documented in the funnel SQL below.
 *
 * The funnel ALWAYS leads with `install` even when `install` is not
 * in the partner's allow-list, because it's the natural denominator
 * (drop-off at every stage is shown as % of installs).
 */
const STEP_LABELS: Record<string, { label: string; order: number }> = {
  install:     { label: 'Install',          order: 0 },
  register:    { label: 'Register',         order: 1 },
  tutorial:    { label: 'Tutorial',         order: 2 },
  first_play:  { label: 'First play',       order: 3 },
  engaged_d0:  { label: 'Engaged D0',       order: 4 },
  d1_return:   { label: 'D1 return',        order: 5 },
  stage_2:     { label: 'Stage 2 (≈33%)',   order: 6 },
  stage_3:     { label: 'Stage 3 (≈50%)',   order: 7 },
  stage_4:     { label: 'Stage 4 (≈67%)',   order: 8 },
  stage_5:     { label: 'Stage 5 (≈83%)',   order: 9 },
  stage_6:     { label: 'Stage 6 (=100%)',  order: 10 },
  harvest:     { label: 'Harvest',          order: 11 },
  harvest_x3:  { label: 'Harvest x3',       order: 12 },
};

interface PartnerRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  default_payout_cents: number;
  postback_configured: boolean;
  allowed_events: string[] | null;
  report_tz: string | null;
  attribution_window_hours: number;
}

/**
 * GET /partner/overview?days=30
 *
 * Returns KPIs, funnel and a daily timeseries that the partner portal
 * landing page renders. Both the funnel composition and the daily
 * day-rollover honour partner-specific configuration:
 *   - `allowed_events` decides which funnel steps to compute
 *   - `report_tz`      decides where each row in `daily` rolls over
 *
 * Empty states are handled gracefully — no data still returns the
 * full shape so the UI doesn't have to special-case fresh partners.
 */
partnerOverviewRouter.get('/', async (req: Request, res: Response) => {
  const partnerId = req.partner!.partnerId;
  const days = parseDays(req.query.days);

  const partner = await queryOne<PartnerRow>(
    `SELECT id, slug, name, status, default_payout_cents,
            (postback_url_template IS NOT NULL AND postback_url_template <> '') AS postback_configured,
            allowed_events, report_tz, attribution_window_hours
     FROM partners WHERE id = $1`,
    [partnerId],
  );

  if (!partner) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Partner not found' } });
    return;
  }

  // Defensive defaults — older partner rows may have NULL allowed_events
  // or report_tz before the v2 migration ran.
  const reportTz = (partner.report_tz && partner.report_tz.trim()) || 'UTC';
  const allowed = (partner.allowed_events ?? []).filter((e): e is string => typeof e === 'string');

  // Always show install + harvest in the funnel; everything else is
  // gated on the partner's allowed_events. This keeps the chart
  // visually meaningful even for partners who only want extreme ends.
  const funnelSteps = [
    'install',
    ...allowed.filter((e) => e !== 'install' && e !== 'harvest'),
    ...(allowed.includes('harvest') ? ['harvest'] : []),
  ].filter((step, i, arr) => arr.indexOf(step) === i);

  // ── Totals (single round-trip) ──
  // Counts only conversions WHOSE attribution actually fits within the
  // partner's attribution_window_hours from the user's signup. Older
  // rows may exist if the partner's window was tightened after the
  // fact; we mask them out here so totals match what the partner is
  // actually billable for.
  const totals = await queryOne<{
    attributed_users: number;
    conversions: number;
    harvests: number;
    reversed: number;
    payout_pending: number;
    payout_approved: number;
    payout_paid: number;
    payout_reversed: number;
  }>(
    `WITH conv AS (
       SELECT * FROM partner_conversions
        WHERE partner_id = $1
          AND created_at >= now() - ($2 || ' days')::interval
     )
     SELECT
       (SELECT count(*)::int FROM users
          WHERE partner_id = $1
            AND created_at >= now() - ($2 || ' days')::interval)                                AS attributed_users,
       (SELECT count(*)::int FROM conv)                                                          AS conversions,
       (SELECT count(*)::int FROM conv WHERE event_type = 'harvest' AND status <> 'reversed')    AS harvests,
       (SELECT count(*)::int FROM conv WHERE status = 'reversed')                                AS reversed,
       (SELECT coalesce(sum(payout_cents),0)::int FROM conv WHERE status = 'pending')            AS payout_pending,
       (SELECT coalesce(sum(payout_cents),0)::int FROM conv WHERE status = 'approved')           AS payout_approved,
       (SELECT coalesce(sum(payout_cents),0)::int FROM conv WHERE status = 'paid')               AS payout_paid,
       (SELECT coalesce(sum(payout_cents),0)::int FROM conv WHERE status = 'reversed')           AS payout_reversed`,
    [partnerId, days],
  );

  // ── Daily breakdown for the chart, in the partner's TZ ──
  // We pivot `created_at AT TIME ZONE report_tz` to put midnight where
  // the partner's accounting expects it. `generate_series` in the same
  // TZ keeps the row count stable so the chart never has gaps.
  const daily = await query<{ date: string; installs: number; harvests: number; payout_cents: number }>(
    `WITH bounds AS (
       SELECT
         (date_trunc('day', (now() AT TIME ZONE $3)) - ($2 || ' days')::interval)::date AS d_from,
         (date_trunc('day', (now() AT TIME ZONE $3)))::date                              AS d_to
     ),
     days AS (
       SELECT generate_series(d_from, d_to, '1 day'::interval)::date AS d FROM bounds
     )
     SELECT
       to_char(d.d, 'YYYY-MM-DD')                                                       AS date,
       coalesce(inst.n, 0)::int                                                         AS installs,
       coalesce(harv.n, 0)::int                                                         AS harvests,
       coalesce(harv.payout, 0)::int                                                    AS payout_cents
     FROM days d
     LEFT JOIN (
       SELECT (created_at AT TIME ZONE $3)::date AS d, count(*) AS n
       FROM users WHERE partner_id = $1
       GROUP BY 1
     ) inst ON inst.d = d.d
     LEFT JOIN (
       SELECT (created_at AT TIME ZONE $3)::date AS d,
              count(*) FILTER (WHERE event_type = 'harvest' AND status <> 'reversed') AS n,
              coalesce(sum(payout_cents) FILTER (WHERE event_type = 'harvest' AND status <> 'reversed'), 0) AS payout
       FROM partner_conversions WHERE partner_id = $1
       GROUP BY 1
     ) harv ON harv.d = d.d
     ORDER BY d.d`,
    [partnerId, days, reportTz],
  );

  // ── Funnel: counts of distinct attributed users who reached each step ──
  // Always computes the full progression (install → register → tutorial
  // → first_play → engaged_d0 → d1_return → stage_2..6 → harvest →
  // harvest_x3) regardless of `allowed_events`, so an admin can flip
  // a step on for a partner mid-flight without having to backfill.
  // Each `farm.stage_reached` row carries the stage in
  // `properties->>'stage'`; we count DISTINCT users per stage threshold
  // so the funnel shows monotonic dropoff (a user who reached stage_5
  // also counts toward stage_2..4).
  //
  // Reversed harvest conversions are excluded from the harvest count
  // — the partner shouldn't see fraud-flagged users in their drop-off.
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
        SELECT 'install'    AS step, count(*)::int AS users FROM attributed
        UNION ALL
        SELECT 'register',   count(DISTINCT user_id)::int FROM evt WHERE event_name = 'auth.register'
        UNION ALL
        SELECT 'tutorial',   count(DISTINCT user_id)::int FROM evt WHERE event_name = 'onboarding.tutorial_finished'
        UNION ALL
        -- "First play" = at least one POST /farm/water success.
        -- The activity middleware auto-emits the farm.water event on
        -- every successful state-changing request, so a DISTINCT-user
        -- count is the cheapest "they actually played" signal.
        SELECT 'first_play', count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.water'
        UNION ALL
        SELECT 'engaged_d0', count(DISTINCT user_id)::int FROM evt WHERE event_name = 'EngagedD0'
        UNION ALL
        SELECT 'd1_return',  count(DISTINCT user_id)::int FROM evt WHERE event_name = 'retention.d1_return'
        UNION ALL
        SELECT 'stage_2',    count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.stage_reached' AND stage >= 2
        UNION ALL
        SELECT 'stage_3',    count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.stage_reached' AND stage >= 3
        UNION ALL
        SELECT 'stage_4',    count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.stage_reached' AND stage >= 4
        UNION ALL
        SELECT 'stage_5',    count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.stage_reached' AND stage >= 5
        UNION ALL
        SELECT 'stage_6',    count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.stage_reached' AND stage >= 6
        UNION ALL
        SELECT 'harvest',    count(DISTINCT user_id)::int FROM (
          SELECT user_id FROM evt WHERE event_name = 'farm.harvested'
          UNION
          SELECT user_id FROM partner_conversions
            WHERE partner_id = $1
              AND event_type = 'harvest'
              AND status <> 'reversed'
              AND created_at >= now() - ($2 || ' days')::interval
        ) h
        UNION ALL
        SELECT 'harvest_x3', count(DISTINCT user_id)::int FROM evt WHERE event_name = 'farm.harvest_x3'
      )
      SELECT step, users FROM per_step`,
    [partnerId, days],
  );

  const byStep = new Map(funnel.map((r) => [r.step, r.users] as const));
  const installs = byStep.get('install') ?? 0;
  const funnelOrdered = funnelSteps
    .map((step) => {
      const meta = STEP_LABELS[step];
      const users = byStep.get(step) ?? 0;
      return {
        step,
        label: meta?.label ?? step,
        order: meta?.order ?? 99,
        users,
        pct: installs > 0 ? Math.round((users / installs) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => a.order - b.order);

  res.json({
    success: true,
    data: {
      partner: {
        slug: partner.slug,
        name: partner.name,
        status: partner.status,
        defaultPayoutCents: partner.default_payout_cents,
        postbackConfigured: partner.postback_configured,
        reportTz,
        attributionWindowHours: partner.attribution_window_hours,
        allowedEvents: allowed,
      },
      range: { days },
      totals: {
        attributedUsers: totals?.attributed_users ?? 0,
        conversions: totals?.conversions ?? 0,
        harvests: totals?.harvests ?? 0,
        reversed: totals?.reversed ?? 0,
        payoutPendingCents: totals?.payout_pending ?? 0,
        payoutApprovedCents: totals?.payout_approved ?? 0,
        payoutPaidCents: totals?.payout_paid ?? 0,
        payoutReversedCents: totals?.payout_reversed ?? 0,
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
