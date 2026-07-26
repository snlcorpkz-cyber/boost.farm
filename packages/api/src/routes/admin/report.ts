import { Router } from 'express';
import type { Request, Response } from 'express';
import { query, queryOne } from '../../lib/db.js';
import { REPORTING_TZ } from '../../lib/reporting-tz.js';
import { UUID_RE, parseSourceFilter, sourceFilterSql, type SourceFilter } from './filters.js';

/**
 * Deep product report ("Insights") — the data source for the
 * board-facing presentation page in the admin SPA.
 *
 * Every endpoint accepts the same audience filters so the entire
 * page pivots together:
 *   - days:          activity/cohort window (default 30; 0 = full history)
 *   - country:       ISO country code from users.country
 *   - platform:      users.device_platform (android | web | ios)
 *   - source_filter: all | paid | organic (acquisition_source heuristic)
 *   - partner_id:    '' | organic | any | <uuid> (affiliate attribution)
 *
 * Conventions shared with /admin/retention:
 *   - calendar days are bucketed in REPORTING_TZ (Asia/Almaty default),
 *   - synthetic rollup events (retention.%, system.%) never count as
 *     real user activity,
 *   - dates leave SQL as ::text so node-postgres can't mangle them
 *     into JS Dates.
 */
export const adminReportRouter = Router();

const DAY = (col: string) => `(${col} AT TIME ZONE '${REPORTING_TZ}')::date`;
const TODAY = `(now() AT TIME ZONE '${REPORTING_TZ}')::date`;
const REAL_EVENTS = `e.event_name NOT LIKE 'retention.%' AND e.event_name NOT LIKE 'system.%'`;
// Plumbing events: they signal an open app but not a user decision.
// Excluded from "what do users actually do" breakdowns (hourly shape,
// action mix); still counted for session clustering & DAU (presence).
const NOISE_EVENTS = `e.event_name NOT IN ('user.session-heartbeat', 'user.push-token', 'user.notifications.mark-read')`;

interface Audience {
  days: number; // 0 = full history
  params: any[];
  /** `AND …` fragments against alias `u` (users). May be ''. */
  cond: string;
  sourceFilter: SourceFilter;
}

function buildAudience(req: Request, res: Response): Audience | null {
  const daysRaw = parseInt(String(req.query.days ?? '30'), 10);
  const days = Number.isFinite(daysRaw) ? Math.max(0, Math.min(3650, daysRaw)) : 30;

  const params: any[] = [];
  const conds: string[] = [];

  const country = String(req.query.country ?? '').trim();
  if (country) {
    params.push(country.toUpperCase());
    conds.push(`u.country = $${params.length}`);
  }
  const platform = String(req.query.platform ?? '').trim();
  if (platform) {
    params.push(platform);
    conds.push(`u.device_platform = $${params.length}`);
  }
  const partnerIdRaw = String(req.query.partner_id ?? '').trim().toLowerCase();
  if (partnerIdRaw === 'organic') {
    conds.push('u.partner_id IS NULL');
  } else if (partnerIdRaw === 'any') {
    conds.push('u.partner_id IS NOT NULL');
  } else if (partnerIdRaw) {
    if (!UUID_RE.test(partnerIdRaw)) {
      res.status(400).json({ error: 'Invalid partner_id (expected UUID, "organic", or "any")' });
      return null;
    }
    params.push(partnerIdRaw);
    conds.push(`u.partner_id = $${params.length}::uuid`);
  }

  const sourceFilter = parseSourceFilter(req.query.source_filter);
  const cond = [
    conds.length ? `AND ${conds.join(' AND ')}` : '',
    sourceFilterSql(sourceFilter),
  ].filter(Boolean).join('\n');

  return { days, params, cond, sourceFilter };
}

/**
 * Per-query param helper: clones the audience params so each SQL
 * statement owns its placeholder numbering, then appends extras.
 */
function withParams(a: Audience) {
  const p = [...a.params];
  const add = (v: any): string => {
    p.push(v);
    return `$${p.length}`;
  };
  /**
   * Window predicate: the last `days` full calendar days in
   * REPORTING_TZ, today included. The rolling `now() - interval`
   * pre-filter is sargable (lets Postgres range-scan on created_at);
   * the calendar floor trims the partial extra day the rolling cut
   * would otherwise leave at the start of every daily series.
   * Returns '' for full history (days=0).
   */
  const period = (col: string): string => {
    if (a.days <= 0) return '';
    const ph = add(a.days);
    return `AND ${col} >= now() - ((${ph}::int + 1) || ' days')::interval
            AND ${DAY(col)} >= ${TODAY} - (${ph}::int - 1)`;
  };
  return { p, add, period };
}

/**
 * Behavioral session CTE: clusters a user's events with a 30-minute
 * inactivity gap — the same definition admin/users.ts uses for the
 * per-user session view. We deliberately do NOT read the `sessions`
 * table (refresh-token logins keep one eternal row there).
 * Heartbeats stay in: they represent real app-open presence and are
 * what gives sessions their duration.
 */
function sessionsCte(a: Audience, period: string): string {
  return `
    ev AS (
      SELECT e.user_id, e.created_at
      FROM events e
      JOIN users u ON u.id = e.user_id
      ${a.cond}
      WHERE ${REAL_EVENTS}
      ${period}
    ),
    marked AS (
      SELECT user_id, created_at,
             CASE WHEN lag(created_at) OVER w IS NULL
                    OR created_at - lag(created_at) OVER w > interval '30 minutes'
                  THEN 1 ELSE 0 END AS is_new
      FROM ev
      WINDOW w AS (PARTITION BY user_id ORDER BY created_at)
    ),
    numbered AS (
      SELECT user_id, created_at,
             sum(is_new) OVER (PARTITION BY user_id ORDER BY created_at
                               ROWS UNBOUNDED PRECEDING) AS seq
      FROM marked
    ),
    sessions AS (
      SELECT user_id, seq,
             min(created_at) AS started_at,
             ${DAY('min(created_at)')} AS day,
             extract(epoch FROM max(created_at) - min(created_at))::float AS dur_sec
      FROM numbered
      GROUP BY user_id, seq
    )`;
}

// ── Overview ────────────────────────────────────────────────────

adminReportRouter.get('/overview', async (req, res) => {
  const a = buildAudience(req, res);
  if (!a) return;
  try {
    // 1. Audience totals + farm progress + coupons.
    const totalsQ = (() => {
      const { p, add } = withParams(a);
      const newPeriod = a.days > 0
        ? `count(*) FILTER (WHERE u.created_at >= now() - (${add(a.days)} || ' days')::interval)::int`
        : `count(*)::int`;
      const sql = `
        SELECT
          count(*)::int AS total_users,
          ${newPeriod} AS new_users_period,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM farms f WHERE f.user_id = u.id AND f.harvested = true
          ))::int AS harvest_users
        FROM users u
        WHERE 1=1 ${a.cond}`;
      return { sql, p };
    })();

    const couponsQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT
          count(*)::int AS issued,
          coalesce(sum(pr.coupon_value_cents), 0)::int AS value_cents,
          count(*) FILTER (WHERE c.redeemed)::int AS redeemed
        FROM coupons c
        JOIN users u ON u.id = c.user_id
        JOIN products pr ON pr.id = c.product_id
        WHERE 1=1 ${a.cond} ${period('c.created_at')}`;
      return { sql, p };
    })();

    // 2a. Audience pulse. DAU/WAU/MAU always run on their own natural
    // windows (today / 7d / 30d) INDEPENDENT of the report window —
    // trimming them by `period` would make a 7-day report show "MAU"
    // that is really WAU and inflate stickiness.
    const pulseQ = (() => {
      const { p } = withParams(a);
      const sql = `
        SELECT
          count(DISTINCT e.user_id) FILTER (WHERE ${DAY('e.created_at')} = ${TODAY})::int AS dau_today,
          count(DISTINCT e.user_id) FILTER (WHERE ${DAY('e.created_at')} = ${TODAY} - 1)::int AS dau_yesterday,
          count(DISTINCT e.user_id) FILTER (WHERE ${DAY('e.created_at')} >= ${TODAY} - 6)::int AS wau,
          count(DISTINCT e.user_id)::int AS mau
        FROM events e
        JOIN users u ON u.id = e.user_id
        ${a.cond}
        WHERE ${REAL_EVENTS}
          AND e.created_at >= now() - interval '31 days'
          AND ${DAY('e.created_at')} >= ${TODAY} - 29`;
      return { sql, p };
    })();

    // 2b. Window activity volume (drives avg DAU, ARPDAU, per-day rates).
    const windowQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT
          count(DISTINCT (e.user_id, ${DAY('e.created_at')}))::int AS active_user_days,
          count(DISTINCT ${DAY('e.created_at')})::int AS days_with_activity
        FROM events e
        JOIN users u ON u.id = e.user_id
        ${a.cond}
        WHERE ${REAL_EVENTS}
        ${period('e.created_at')}`;
      return { sql, p };
    })();

    // 3. Rolling retention D1/D7/D30 over matured cohorts in window.
    const retentionQ = (() => {
      const { p, add, period } = withParams(a);
      const offsetsPh = add([1, 7, 30]);
      const sql = `
        SELECT
          o.offset_day,
          count(DISTINCT u.id) FILTER (
            WHERE ${DAY('u.created_at')} <= ${TODAY} - o.offset_day
          )::int AS eligible,
          count(DISTINCT e.user_id)::int AS retained
        FROM users u
        CROSS JOIN unnest(${offsetsPh}::int[]) AS o(offset_day)
        LEFT JOIN events e
          ON e.user_id = u.id
         AND ${REAL_EVENTS}
         AND e.created_at >= u.created_at - interval '2 days'
         AND e.created_at < u.created_at + ((o.offset_day + 2) * interval '1 day')
         AND ${DAY('e.created_at')} = ${DAY('u.created_at')} + o.offset_day
        WHERE 1=1 ${a.cond} ${period('u.created_at')}
        GROUP BY o.offset_day`;
      return { sql, p };
    })();

    // 4. Behavioral sessions summary.
    const sessionsQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        WITH ${sessionsCte(a, period('e.created_at'))}
        SELECT
          count(*)::int AS sessions_total,
          count(DISTINCT (user_id, day))::int AS active_user_days,
          coalesce(avg(dur_sec), 0)::float AS mean_sec,
          coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur_sec), 0)::float AS p50_sec
        FROM sessions`;
      return { sql, p };
    })();

    // 5. Economy pulse: waterings, rewarded ads, ILRD revenue, offers.
    const economyQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT
          count(*) FILTER (WHERE e.event_name = 'farm.water')::int AS waterings,
          count(*) FILTER (WHERE e.event_name = 'ad.server_granted')::int AS ads_rewarded,
          coalesce(sum(e.revenue_cents) FILTER (WHERE e.event_name = 'ad.revenue'), 0)::int AS ad_revenue_cents,
          count(*) FILTER (WHERE e.event_name = 'ad.shown')::int AS sdk_impressions
        FROM events e
        JOIN users u ON u.id = e.user_id
        ${a.cond}
        WHERE ${REAL_EVENTS}
        ${period('e.created_at')}`;
      return { sql, p };
    })();

    const offersQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT
          count(*)::int AS completions,
          count(DISTINCT oc.user_id)::int AS players
        FROM offer_completions oc
        JOIN users u ON u.id = oc.user_id
        ${a.cond}
        WHERE 1=1 ${period('oc.created_at')}`;
      return { sql, p };
    })();

    const [totals, coupons, pulse, win, retentionRows, sess, economy, offers] = await Promise.all([
      queryOne<any>(totalsQ.sql, totalsQ.p),
      queryOne<any>(couponsQ.sql, couponsQ.p).catch(() => null),
      queryOne<any>(pulseQ.sql, pulseQ.p),
      queryOne<any>(windowQ.sql, windowQ.p),
      query<any>(retentionQ.sql, retentionQ.p),
      queryOne<any>(sessionsQ.sql, sessionsQ.p),
      queryOne<any>(economyQ.sql, economyQ.p),
      queryOne<any>(offersQ.sql, offersQ.p).catch(() => null),
    ]);

    const ret: Record<string, { eligible: number; retained: number; pct: number }> = {};
    for (const r of retentionRows ?? []) {
      ret[`d${r.offset_day}`] = {
        eligible: r.eligible,
        retained: r.retained,
        pct: r.eligible > 0 ? Math.round((r.retained / r.eligible) * 1000) / 10 : 0,
      };
    }

    const activeUserDays = win?.active_user_days || 0;
    const daysWithActivity = win?.days_with_activity || 0;
    const adRevenue = economy?.ad_revenue_cents || 0;
    const sdkImpressions = economy?.sdk_impressions || 0;

    res.json({
      days: a.days,
      totals: {
        total_users: totals?.total_users || 0,
        new_users_period: totals?.new_users_period || 0,
        harvest_users: totals?.harvest_users || 0,
        coupons_issued: coupons?.issued || 0,
        coupons_value_cents: coupons?.value_cents || 0,
        coupons_redeemed: coupons?.redeemed || 0,
      },
      activity: {
        dau_today: pulse?.dau_today || 0,
        dau_yesterday: pulse?.dau_yesterday || 0,
        avg_dau: daysWithActivity > 0 ? Math.round(activeUserDays / daysWithActivity) : 0,
        wau: pulse?.wau || 0,
        mau: pulse?.mau || 0,
        stickiness_pct: pulse?.mau > 0
          ? Math.round(((daysWithActivity > 0 ? activeUserDays / daysWithActivity : 0) / pulse.mau) * 1000) / 10
          : 0,
      },
      retention: ret,
      sessions: {
        total: sess?.sessions_total || 0,
        per_active_day: sess?.active_user_days > 0
          ? Math.round((sess.sessions_total / sess.active_user_days) * 10) / 10
          : 0,
        mean_minutes: Math.round((sess?.mean_sec || 0) / 6) / 10,
        median_minutes: Math.round((sess?.p50_sec || 0) / 6) / 10,
      },
      economy: {
        waterings: economy?.waterings || 0,
        waterings_per_active_day: activeUserDays > 0
          ? Math.round(((economy?.waterings || 0) / activeUserDays) * 10) / 10
          : 0,
        ads_rewarded: economy?.ads_rewarded || 0,
        ad_revenue_cents: adRevenue,
        arpdau_cents: activeUserDays > 0 ? Math.round((adRevenue / activeUserDays) * 100) / 100 : 0,
        ecpm_cents: sdkImpressions > 0 ? Math.round((adRevenue / sdkImpressions) * 1000) : 0,
        offer_completions: offers?.completions || 0,
        offer_players: offers?.players || 0,
      },
    });
  } catch (err) {
    console.error('[admin/report/overview]', err);
    res.status(500).json({ error: 'Failed', details: (err as Error).message });
  }
});

// ── Growth ──────────────────────────────────────────────────────

adminReportRouter.get('/growth', async (req, res) => {
  const a = buildAudience(req, res);
  if (!a) return;
  try {
    const newUsersQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT
          ${DAY('u.created_at')}::text AS day,
          count(*)::int AS new_users,
          count(*) FILTER (WHERE u.partner_id IS NOT NULL)::int AS partner,
          count(*) FILTER (
            WHERE u.partner_id IS NULL
              AND u.acquisition_source IS NOT NULL
              AND (
                (u.acquisition_source ? 'afMediaSource'
                  AND COALESCE(u.acquisition_source ->> 'afMediaSource', '') NOT IN ('', 'Organic'))
                OR u.acquisition_source ? 'fbCampaignId'
                OR u.acquisition_source ? 'utmCampaign'
              )
          )::int AS paid
        FROM users u
        WHERE 1=1 ${a.cond} ${period('u.created_at')}
        GROUP BY 1
        ORDER BY 1`;
      return { sql, p };
    })();

    const dauQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT ${DAY('e.created_at')}::text AS day,
               count(DISTINCT e.user_id)::int AS dau
        FROM events e
        JOIN users u ON u.id = e.user_id
        ${a.cond}
        WHERE ${REAL_EVENTS}
        ${period('e.created_at')}
        GROUP BY 1
        ORDER BY 1`;
      return { sql, p };
    })();

    // Users registered before the window — the base the cumulative
    // line starts from. For full history there is no base; that
    // branch must bind NO parameters (a cloned audience array would
    // make Postgres reject the parameterless statement).
    const baseQ = (() => {
      if (a.days <= 0) return { sql: `SELECT 0::int AS c`, p: [] as any[] };
      const { p, add } = withParams(a);
      const sql = `SELECT count(*)::int AS c FROM users u
           WHERE ${DAY('u.created_at')} < ${TODAY} - (${add(a.days)}::int - 1) ${a.cond}`;
      return { sql, p };
    })();

    const [newUsers, dau, base] = await Promise.all([
      query<any>(newUsersQ.sql, newUsersQ.p),
      query<any>(dauQ.sql, dauQ.p),
      queryOne<any>(baseQ.sql, baseQ.p),
    ]);

    const byDay = new Map<string, any>();
    for (const r of newUsers) {
      byDay.set(r.day, {
        day: r.day,
        new_users: r.new_users,
        partner: r.partner,
        paid: r.paid,
        organic: r.new_users - r.partner - r.paid,
        dau: 0,
      });
    }
    for (const r of dau) {
      const row = byDay.get(r.day) ?? { day: r.day, new_users: 0, partner: 0, paid: 0, organic: 0, dau: 0 };
      row.dau = r.dau;
      byDay.set(r.day, row);
    }
    const series = [...byDay.values()].sort((x, y) => x.day.localeCompare(y.day));
    let cum = base?.c || 0;
    for (const row of series) {
      cum += row.new_users;
      row.cumulative_users = cum;
    }

    res.json({ days: a.days, base_users: base?.c || 0, series });
  } catch (err) {
    console.error('[admin/report/growth]', err);
    res.status(500).json({ error: 'Failed', details: (err as Error).message });
  }
});

// ── Retention detail ────────────────────────────────────────────

adminReportRouter.get('/retention', async (req, res) => {
  const a = buildAudience(req, res);
  if (!a) return;
  try {
    const CURVE_OFFSETS = [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30];

    const curveQ = (() => {
      const { p, add, period } = withParams(a);
      const offsetsPh = add(CURVE_OFFSETS);
      const sql = `
        SELECT
          o.offset_day,
          count(DISTINCT u.id) FILTER (
            WHERE ${DAY('u.created_at')} <= ${TODAY} - o.offset_day
          )::int AS eligible,
          count(DISTINCT e.user_id)::int AS retained
        FROM users u
        CROSS JOIN unnest(${offsetsPh}::int[]) AS o(offset_day)
        LEFT JOIN events e
          ON e.user_id = u.id
         AND ${REAL_EVENTS}
         -- sargable timestamp range so the planner can range-scan
         -- events instead of full-scanning; the calendar-day equality
         -- below still decides actual membership
         AND e.created_at >= u.created_at - interval '2 days'
         AND e.created_at < u.created_at + ((o.offset_day + 2) * interval '1 day')
         AND ${DAY('e.created_at')} = ${DAY('u.created_at')} + o.offset_day
        WHERE 1=1 ${a.cond} ${period('u.created_at')}
        GROUP BY o.offset_day
        ORDER BY o.offset_day`;
      return { sql, p };
    })();

    // Weekly cohorts (up to 12), D1/D7/D30.
    const weeklyQ = (() => {
      const { p } = withParams(a);
      p.push(Math.min(12, Math.max(4, a.days > 0 ? Math.ceil(a.days / 7) : 12)));
      const weeksPh = `$${p.length}`;
      const sql = `
        SELECT
          date_trunc('week', u.created_at AT TIME ZONE '${REPORTING_TZ}')::date::text AS week,
          min(${TODAY} - date_trunc('week', u.created_at AT TIME ZONE '${REPORTING_TZ}')::date)::int AS age_days,
          count(DISTINCT u.id)::int AS size,
          count(DISTINCT CASE WHEN ${DAY('e.created_at')} = ${DAY('u.created_at')} + 1 THEN u.id END)::int AS d1,
          count(DISTINCT CASE WHEN ${DAY('e.created_at')} = ${DAY('u.created_at')} + 7 THEN u.id END)::int AS d7,
          count(DISTINCT CASE WHEN ${DAY('e.created_at')} = ${DAY('u.created_at')} + 30 THEN u.id END)::int AS d30
        FROM users u
        LEFT JOIN events e ON e.user_id = u.id AND ${REAL_EVENTS}
         AND e.created_at >= u.created_at - interval '2 days'
         AND e.created_at < u.created_at + interval '33 days'
        WHERE u.created_at >= now() - (${weeksPh} || ' weeks')::interval
        ${a.cond}
        GROUP BY 1
        ORDER BY 1 DESC`;
      return { sql, p };
    })();

    // How many distinct days users came back during their first 14
    // days — the "habit depth" histogram. Only users whose first 14
    // days have fully elapsed, so every bucket is comparable.
    const habitQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT active_days, count(*)::int AS users
        FROM (
          SELECT u.id,
                 count(DISTINCT ${DAY('e.created_at')}) FILTER (
                   WHERE ${DAY('e.created_at')} BETWEEN ${DAY('u.created_at')} + 1
                                                    AND ${DAY('u.created_at')} + 14
                 )::int AS active_days
          FROM users u
          LEFT JOIN events e ON e.user_id = u.id AND ${REAL_EVENTS}
           AND e.created_at >= u.created_at - interval '2 days'
           AND e.created_at < u.created_at + interval '17 days'
          WHERE ${DAY('u.created_at')} <= ${TODAY} - 14
          ${a.cond} ${period('u.created_at')}
          GROUP BY u.id
        ) t
        GROUP BY active_days
        ORDER BY active_days`;
      return { sql, p };
    })();

    const [curveRows, weekly, habit] = await Promise.all([
      query<any>(curveQ.sql, curveQ.p),
      query<any>(weeklyQ.sql, weeklyQ.p),
      query<any>(habitQ.sql, habitQ.p),
    ]);

    res.json({
      days: a.days,
      curve: (curveRows ?? []).map((r: any) => ({
        offset: r.offset_day,
        eligible: r.eligible,
        retained: r.retained,
        pct: r.eligible > 0 ? Math.round((r.retained / r.eligible) * 1000) / 10 : 0,
      })),
      // A cohort week is "mature" for offset N only once every member's
      // day-N has passed (last registration day = week start + 6). An
      // immature offset returns null so the UI shows "—" instead of a
      // fake 0% that would read as a retention collapse.
      weekly_cohorts: (weekly ?? []).map((r: any) => {
        const pct = (n: number) => (r.size > 0 ? Math.round((n / r.size) * 1000) / 10 : 0);
        return {
          week: r.week,
          size: r.size,
          d1_pct: r.age_days >= 8 ? pct(r.d1) : null,
          d7_pct: r.age_days >= 14 ? pct(r.d7) : null,
          d30_pct: r.age_days >= 37 ? pct(r.d30) : null,
        };
      }),
      habit_histogram: habit ?? [],
    });
  } catch (err) {
    console.error('[admin/report/retention]', err);
    res.status(500).json({ error: 'Failed', details: (err as Error).message });
  }
});

// ── Engagement ──────────────────────────────────────────────────

adminReportRouter.get('/engagement', async (req, res) => {
  const a = buildAudience(req, res);
  if (!a) return;
  try {
    // Sessions per active user-day (how many times a day people open
    // the game) + duration stats.
    const sessQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        WITH ${sessionsCte(a, period('e.created_at'))},
        per_day AS (
          SELECT user_id, day, count(*)::int AS n
          FROM sessions
          GROUP BY user_id, day
        )
        SELECT
          (SELECT count(*)::int FROM sessions) AS sessions_total,
          (SELECT count(*)::int FROM per_day) AS active_user_days,
          (SELECT coalesce(avg(n), 0)::float FROM per_day) AS avg_sessions_per_day,
          (SELECT coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur_sec), 0)::float FROM sessions) AS p50_sec,
          (SELECT coalesce(avg(dur_sec), 0)::float FROM sessions) AS mean_sec,
          (SELECT coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY dur_sec), 0)::float FROM sessions) AS p95_sec,
          (SELECT coalesce(json_agg(json_build_object('sessions', b, 'user_days', c) ORDER BY b), '[]'::json)
             FROM (SELECT least(n, 5) AS b, count(*)::int AS c FROM per_day GROUP BY 1) h
          ) AS histogram`;
      return { sql, p };
    })();

    // Hour-of-day activity shape (REPORTING_TZ) on deliberate actions.
    const hourlyQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT extract(hour FROM e.created_at AT TIME ZONE '${REPORTING_TZ}')::int AS hour,
               count(*)::int AS events,
               count(DISTINCT e.user_id)::int AS users
        FROM events e
        JOIN users u ON u.id = e.user_id
        ${a.cond}
        WHERE ${REAL_EVENTS} AND ${NOISE_EVENTS}
        ${period('e.created_at')}
        GROUP BY 1
        ORDER BY 1`;
      return { sql, p };
    })();

    // Daily action mix — the loops that make up a day of play.
    const actionsQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT ${DAY('e.created_at')}::text AS day,
          count(*) FILTER (WHERE e.event_name = 'farm.water')::int AS waterings,
          count(*) FILTER (WHERE e.event_name = 'farm.collect-bucket')::int AS bucket_collects,
          count(*) FILTER (WHERE e.event_name = 'quests.checkin')::int AS checkins,
          count(*) FILTER (WHERE e.event_name = 'quests.daily-challenge.claim')::int AS challenge_claims,
          count(*) FILTER (WHERE e.event_name IN ('friends.id.greet', 'friends.id.water'))::int AS friend_actions,
          count(*) FILTER (WHERE e.event_name = 'ad.server_granted')::int AS ads_rewarded
        FROM events e
        JOIN users u ON u.id = e.user_id
        ${a.cond}
        WHERE ${REAL_EVENTS}
        ${period('e.created_at')}
        GROUP BY 1
        ORDER BY 1`;
      return { sql, p };
    })();

    // What share of daily players touches each loop.
    const loopShareQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT
          count(DISTINCT e.user_id)::int AS active_users,
          count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'farm.water')::int AS watered,
          count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'quests.checkin')::int AS checked_in,
          count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'quests.daily-challenge.claim')::int AS challenged,
          count(DISTINCT e.user_id) FILTER (WHERE e.event_name IN ('friends.id.greet', 'friends.id.water'))::int AS social,
          count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'ad.server_granted')::int AS ad_watchers,
          count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'pets.id.gift')::int AS pet_gifts
        FROM events e
        JOIN users u ON u.id = e.user_id
        ${a.cond}
        WHERE ${REAL_EVENTS}
        ${period('e.created_at')}`;
      return { sql, p };
    })();

    const [sess, hourly, actions, loops] = await Promise.all([
      queryOne<any>(sessQ.sql, sessQ.p),
      query<any>(hourlyQ.sql, hourlyQ.p),
      query<any>(actionsQ.sql, actionsQ.p),
      queryOne<any>(loopShareQ.sql, loopShareQ.p),
    ]);

    res.json({
      days: a.days,
      sessions: {
        total: sess?.sessions_total || 0,
        active_user_days: sess?.active_user_days || 0,
        avg_per_day: Math.round((sess?.avg_sessions_per_day || 0) * 10) / 10,
        mean_minutes: Math.round((sess?.mean_sec || 0) / 6) / 10,
        median_minutes: Math.round((sess?.p50_sec || 0) / 6) / 10,
        p95_minutes: Math.round((sess?.p95_sec || 0) / 6) / 10,
        histogram: sess?.histogram ?? [],
      },
      hourly: hourly ?? [],
      daily_actions: actions ?? [],
      loop_share: loops ?? {},
    });
  } catch (err) {
    console.error('[admin/report/engagement]', err);
    res.status(500).json({ error: 'Failed', details: (err as Error).message });
  }
});

// ── Progression funnel ──────────────────────────────────────────

adminReportRouter.get('/funnel', async (req, res) => {
  const a = buildAudience(req, res);
  if (!a) return;
  try {
    const funnelQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        WITH scope AS (
          SELECT u.id, u.created_at,
                 EXISTS (SELECT 1 FROM farms f WHERE f.user_id = u.id AND f.harvested = true) AS harvested,
                 (SELECT max(f.current_stage) FROM farms f WHERE f.user_id = u.id) AS farm_stage
          FROM users u
          WHERE 1=1 ${a.cond} ${period('u.created_at')}
        ),
        agg AS (
          SELECT s.id, s.created_at, s.harvested, s.farm_stage,
            bool_or(e.event_name = 'onboarding.tutorial_finished') AS tutorial,
            bool_or(e.event_name = 'farm.water') AS watered,
            bool_or(e.event_name = 'ad.server_granted') AS watched_ad,
            greatest(
              coalesce(max(CASE WHEN e.event_name = 'farm.stage_reached'
                                THEN (e.properties ->> 'stage')::int END), 1),
              coalesce(s.farm_stage, 1)
            ) AS max_stage,
            min(e.created_at) FILTER (WHERE e.event_name = 'farm.stage_reached'
                                        AND (e.properties ->> 'stage')::int >= 3) AS t_s3,
            min(e.created_at) FILTER (WHERE e.event_name = 'farm.stage_reached'
                                        AND (e.properties ->> 'stage')::int >= 4) AS t_s4,
            min(e.created_at) FILTER (WHERE e.event_name = 'farm.stage_reached'
                                        AND (e.properties ->> 'stage')::int >= 5) AS t_s5,
            min(e.created_at) FILTER (WHERE e.event_name = 'farm.stage_reached'
                                        AND (e.properties ->> 'stage')::int >= 6) AS t_s6,
            min(e.created_at) FILTER (WHERE e.event_name = 'farm.harvested') AS t_harvest
          FROM scope s
          LEFT JOIN events e ON e.user_id = s.id AND ${REAL_EVENTS}
          GROUP BY s.id, s.created_at, s.harvested, s.farm_stage
        )
        SELECT
          count(*)::int AS registered,
          count(*) FILTER (WHERE tutorial)::int AS tutorial_finished,
          count(*) FILTER (WHERE watered)::int AS first_water,
          count(*) FILTER (WHERE watched_ad)::int AS watched_ad,
          count(*) FILTER (WHERE max_stage >= 2)::int AS stage_2,
          count(*) FILTER (WHERE max_stage >= 3)::int AS stage_3,
          count(*) FILTER (WHERE max_stage >= 4)::int AS stage_4,
          count(*) FILTER (WHERE max_stage >= 5)::int AS stage_5,
          count(*) FILTER (WHERE max_stage >= 6)::int AS stage_6,
          count(*) FILTER (WHERE harvested OR t_harvest IS NOT NULL)::int AS harvested,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t_s3 - created_at) / 86400.0)::float AS med_days_s3,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t_s4 - created_at) / 86400.0)::float AS med_days_s4,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t_s5 - created_at) / 86400.0)::float AS med_days_s5,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t_s6 - created_at) / 86400.0)::float AS med_days_s6,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t_harvest - created_at) / 86400.0)::float AS med_days_harvest
        FROM agg`;
      return { sql, p };
    })();

    // Snapshot: where are active (unharvested) farms right now.
    const stagesQ = (() => {
      const { p } = withParams(a);
      const sql = `
        SELECT f.current_stage::int AS stage, count(*)::int AS farms
        FROM farms f
        JOIN users u ON u.id = f.user_id
        ${a.cond}
        WHERE f.harvested = false
        GROUP BY 1
        ORDER BY 1`;
      return { sql, p };
    })();

    const [funnel, stages] = await Promise.all([
      queryOne<any>(funnelQ.sql, funnelQ.p),
      query<any>(stagesQ.sql, stagesQ.p),
    ]);

    res.json({ days: a.days, funnel: funnel ?? {}, active_farm_stages: stages ?? [] });
  } catch (err) {
    console.error('[admin/report/funnel]', err);
    res.status(500).json({ error: 'Failed', details: (err as Error).message });
  }
});

// ── Geo & Sources (shared shape) ────────────────────────────────

/**
 * Grouped audience/quality/economy rollup used by both /geo
 * (dimension = country) and /sources (dimension = media source).
 * Returns rows merged from four grouped queries; the SPA sorts and
 * renders. `dimExpr` must be an expression over users alias `u`.
 */
async function dimensionRollup(a: Audience, dimExpr: string) {
  const usersQ = (() => {
    const { p } = withParams(a);
    let newPeriod = 'count(*)::int';
    if (a.days > 0) {
      p.push(a.days);
      newPeriod = `count(*) FILTER (WHERE u.created_at >= now() - ($${p.length} || ' days')::interval)::int`;
    }
    const sql = `
      SELECT ${dimExpr} AS dim,
             count(*)::int AS users,
             ${newPeriod} AS new_users_period,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM farms f WHERE f.user_id = u.id AND f.harvested = true
             ))::int AS harvest_users
      FROM users u
      WHERE 1=1 ${a.cond}
      GROUP BY 1`;
    return { sql, p };
  })();

  const eventsQ = (() => {
    const { p, period } = withParams(a);
    const sql = `
      SELECT ${dimExpr} AS dim,
             count(DISTINCT e.user_id)::int AS active_users,
             count(*) FILTER (WHERE e.event_name = 'farm.water')::int AS waterings,
             coalesce(sum(e.revenue_cents) FILTER (WHERE e.event_name = 'ad.revenue'), 0)::int AS ad_revenue_cents,
             count(*) FILTER (WHERE e.event_name = 'ad.server_granted')::int AS ads_rewarded,
             count(DISTINCT e.user_id) FILTER (
               WHERE e.event_name = 'farm.stage_reached'
                 AND (e.properties ->> 'stage')::int >= 4
             )::int AS stage4_users,
             count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'EngagedD0')::int AS engaged_d0
      FROM events e
      JOIN users u ON u.id = e.user_id
      ${a.cond}
      WHERE ${REAL_EVENTS}
      ${period('e.created_at')}
      GROUP BY 1`;
    return { sql, p };
  })();

  const d1Q = (() => {
    const { p, period } = withParams(a);
    const sql = `
      SELECT ${dimExpr} AS dim,
             count(DISTINCT u.id) FILTER (
               WHERE ${DAY('u.created_at')} <= ${TODAY} - 1
             )::int AS d1_eligible,
             count(DISTINCT e.user_id)::int AS d1_retained
      FROM users u
      LEFT JOIN events e
        ON e.user_id = u.id
       AND ${REAL_EVENTS}
       AND e.created_at >= u.created_at - interval '2 days'
       AND e.created_at < u.created_at + interval '4 days'
       AND ${DAY('e.created_at')} = ${DAY('u.created_at')} + 1
      WHERE 1=1 ${a.cond} ${period('u.created_at')}
      GROUP BY 1`;
    return { sql, p };
  })();

  const offersQ = (() => {
    const { p, period } = withParams(a);
    const sql = `
      SELECT ${dimExpr} AS dim,
             count(*)::int AS offer_completions,
             count(DISTINCT oc.user_id)::int AS offer_players
      FROM offer_completions oc
      JOIN users u ON u.id = oc.user_id
      ${a.cond}
      WHERE 1=1 ${period('oc.created_at')}
      GROUP BY 1`;
    return { sql, p };
  })();

  const [users, events, d1, offers] = await Promise.all([
    query<any>(usersQ.sql, usersQ.p),
    query<any>(eventsQ.sql, eventsQ.p),
    query<any>(d1Q.sql, d1Q.p),
    query<any>(offersQ.sql, offersQ.p).catch(() => []),
  ]);

  const rows = new Map<string, any>();
  const get = (dim: string) => {
    if (!rows.has(dim)) {
      rows.set(dim, {
        dim,
        users: 0, new_users_period: 0, harvest_users: 0,
        active_users: 0, waterings: 0, ad_revenue_cents: 0, ads_rewarded: 0,
        stage4_users: 0, engaged_d0: 0,
        d1_eligible: 0, d1_retained: 0, d1_pct: 0,
        offer_completions: 0, offer_players: 0,
      });
    }
    return rows.get(dim);
  };
  for (const r of users) Object.assign(get(r.dim), r);
  for (const r of events) Object.assign(get(r.dim), r);
  for (const r of d1) Object.assign(get(r.dim), r);
  for (const r of offers) Object.assign(get(r.dim), r);
  for (const row of rows.values()) {
    row.d1_pct = row.d1_eligible > 0 ? Math.round((row.d1_retained / row.d1_eligible) * 1000) / 10 : 0;
    row.engaged_d0_pct = row.new_users_period > 0
      ? Math.round((row.engaged_d0 / row.new_users_period) * 1000) / 10
      : 0;
  }
  return [...rows.values()].sort((x, y) => y.users - x.users);
}

adminReportRouter.get('/geo', async (req, res) => {
  const a = buildAudience(req, res);
  if (!a) return;
  try {
    const rows = await dimensionRollup(a, `coalesce(u.country, 'unknown')`);
    res.json({ days: a.days, rows });
  } catch (err) {
    console.error('[admin/report/geo]', err);
    res.status(500).json({ error: 'Failed', details: (err as Error).message });
  }
});

adminReportRouter.get('/sources', async (req, res) => {
  const a = buildAudience(req, res);
  if (!a) return;
  try {
    // Same precedence as /admin/acquisition/by-creative: AppsFlyer
    // first, then UTM / legacy columns.
    const srcExpr = `coalesce(
      nullif(u.acquisition_source ->> 'afMediaSource', ''),
      nullif(u.acquisition_source ->> 'utmSource', ''),
      nullif(u.utm_source, ''),
      'organic'
    )`;
    const rows = await dimensionRollup(a, srcExpr);

    // Affiliate partner rollup from the conversion ledger. Audience
    // filters live on `users` and don't apply here, so bind ONLY the
    // window param — a cloned audience array would ship unreferenced
    // bind values and Postgres would reject the statement.
    const partnersQ = (() => {
      const p: any[] = [];
      let periodSql = '';
      if (a.days > 0) {
        p.push(a.days);
        periodSql = `AND pc.created_at >= now() - (($1::int + 1) || ' days')::interval
                     AND ${DAY('pc.created_at')} >= ${TODAY} - ($1::int - 1)`;
      }
      const sql = `
        SELECT p2.id, p2.name, p2.slug, p2.status,
               count(pc.id) FILTER (WHERE pc.event_type = 'install')::int AS installs,
               count(pc.id) FILTER (WHERE pc.event_type = 'stage_4')::int AS stage_4,
               count(pc.id) FILTER (WHERE pc.event_type = 'harvest' AND pc.status <> 'reversed')::int AS harvests,
               count(pc.id) FILTER (WHERE pc.status = 'reversed')::int AS reversed,
               coalesce(sum(pc.payout_cents) FILTER (WHERE pc.status IN ('approved', 'paid')), 0)::int AS payout_cents
        FROM partners p2
        LEFT JOIN partner_conversions pc
          ON pc.partner_id = p2.id
          ${periodSql}
        GROUP BY p2.id, p2.name, p2.slug, p2.status
        ORDER BY installs DESC`;
      return { sql, p };
    })();

    const partners = await query<any>(partnersQ.sql, partnersQ.p).catch(() => []);
    res.json({ days: a.days, rows, partners });
  } catch (err) {
    console.error('[admin/report/sources]', err);
    res.status(500).json({ error: 'Failed', details: (err as Error).message });
  }
});

// ── Monetization ────────────────────────────────────────────────

adminReportRouter.get('/monetization', async (req, res) => {
  const a = buildAudience(req, res);
  if (!a) return;
  try {
    const dailyQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT ${DAY('e.created_at')}::text AS day,
               coalesce(sum(e.revenue_cents) FILTER (WHERE e.event_name = 'ad.revenue'), 0)::int AS revenue_cents,
               count(*) FILTER (WHERE e.event_name = 'ad.revenue')::int AS paid_impressions,
               count(*) FILTER (WHERE e.event_name = 'ad.server_granted')::int AS rewards_paid
        FROM events e
        JOIN users u ON u.id = e.user_id
        ${a.cond}
        WHERE e.event_name IN ('ad.revenue', 'ad.server_granted')
        ${period('e.created_at')}
        GROUP BY 1
        ORDER BY 1`;
      return { sql, p };
    })();

    const funnelQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT
          count(*) FILTER (WHERE e.event_name = 'ad.requested' AND e.properties ? 'has_native')::int AS attempts,
          count(*) FILTER (WHERE e.event_name = 'ad.shown')::int AS sdk_impressions,
          count(*) FILTER (WHERE e.event_name = 'ad.fallback_shown')::int AS mock_impressions,
          count(*) FILTER (WHERE e.event_name = 'ad.rewarded')::int AS completions,
          count(*) FILTER (WHERE e.event_name = 'ad.server_granted')::int AS rewards_paid,
          count(*) FILTER (WHERE e.event_name = 'ad.no_fill' AND e.placement IS NOT NULL)::int AS no_fill
        FROM events e
        JOIN users u ON u.id = e.user_id
        ${a.cond}
        WHERE e.event_name LIKE 'ad.%'
        ${period('e.created_at')}`;
      return { sql, p };
    })();

    const byDim = (dimExpr: string) => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT ${dimExpr} AS dim,
               count(*)::int AS impressions,
               coalesce(sum(e.revenue_cents), 0)::int AS revenue_cents
        FROM events e
        JOIN users u ON u.id = e.user_id
        ${a.cond}
        WHERE e.event_name = 'ad.revenue'
        ${period('e.created_at')}
        GROUP BY 1
        ORDER BY revenue_cents DESC
        LIMIT 6`;
      return { sql, p };
    };
    const networkQ = byDim(`coalesce(e.properties ->> 'network', 'unknown')`);
    const placementQ = byDim(`coalesce(nullif(e.placement, ''), 'unknown')`);

    const offersQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT o.id, o.name,
               count(oc.id)::int AS completions,
               count(DISTINCT oc.user_id)::int AS players
        FROM offer_completions oc
        JOIN offers o ON o.id = oc.offer_id
        JOIN users u ON u.id = oc.user_id
        ${a.cond}
        WHERE 1=1 ${period('oc.created_at')}
        GROUP BY o.id, o.name
        ORDER BY completions DESC
        LIMIT 10`;
      return { sql, p };
    })();

    const couponsQ = (() => {
      const { p, period } = withParams(a);
      const sql = `
        SELECT pr.name_key,
               count(*)::int AS issued,
               coalesce(sum(pr.coupon_value_cents), 0)::int AS value_cents,
               count(*) FILTER (WHERE c.redeemed)::int AS redeemed
        FROM coupons c
        JOIN users u ON u.id = c.user_id
        JOIN products pr ON pr.id = c.product_id
        WHERE 1=1 ${a.cond} ${period('c.created_at')}
        GROUP BY pr.name_key
        ORDER BY issued DESC`;
      return { sql, p };
    })();

    const [daily, funnel, byNetwork, byPlacement, topOffers, coupons] = await Promise.all([
      query<any>(dailyQ.sql, dailyQ.p),
      queryOne<any>(funnelQ.sql, funnelQ.p),
      query<any>(networkQ.sql, networkQ.p),
      query<any>(placementQ.sql, placementQ.p),
      query<any>(offersQ.sql, offersQ.p).catch(() => []),
      query<any>(couponsQ.sql, couponsQ.p).catch(() => []),
    ]);

    res.json({
      days: a.days,
      daily: daily ?? [],
      ad_funnel: funnel ?? {},
      by_network: byNetwork ?? [],
      by_placement: byPlacement ?? [],
      top_offers: topOffers ?? [],
      coupons: coupons ?? [],
    });
  } catch (err) {
    console.error('[admin/report/monetization]', err);
    res.status(500).json({ error: 'Failed', details: (err as Error).message });
  }
});
