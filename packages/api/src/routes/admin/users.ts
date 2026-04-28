import { Router } from 'express';
import { query, queryOne, execute } from '../../lib/db.js';
import { recordPartnerConversion } from '../../lib/partner-conversions.js';
import { loadUserPartnerAttribution } from '../../lib/partner-attribution.js';

export const adminUsersRouter = Router();

/**
 * Sortable columns whitelist. We build the ORDER BY clause from the client
 * value, so hardcoding the allowed expressions is required to prevent
 * SQL injection. The values are the actual SQL expressions used in SELECT.
 */
const USERS_SORT_COLUMNS: Record<string, string> = {
  created_at: 'u.created_at',
  last_login_at: 'u.last_login_at',
  last_active_at: 'u.last_active_at',
  total_ad_views: 'total_ad_views',
  offers_completed: 'offers_completed',
  friends_count: 'friends_count',
  growth_percent: 'f.growth_percent',
  current_stage: 'f.current_stage',
  total_water_this_month: 'f.total_water_this_month',
};

adminUsersRouter.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset = (page - 1) * limit;
    const search = (req.query.search as string || '').trim();
    const rank = req.query.rank as string || '';
    const platform = req.query.platform as string || '';
    const country = req.query.country as string || '';
    const activeWithin = parseInt(req.query.activeWithin as string) || 0;
    const hasAds = req.query.hasAds === '1' || req.query.hasAds === 'true';
    const hasOffers = req.query.hasOffers === '1' || req.query.hasOffers === 'true';

    const sortByRaw = (req.query.sortBy as string) || 'created_at';
    const sortColumn = USERS_SORT_COLUMNS[sortByRaw] ?? USERS_SORT_COLUMNS.created_at;
    const sortDir = (req.query.sortDir as string) === 'asc' ? 'ASC' : 'DESC';

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let pi = 0;

    if (search) {
      pi++;
      where += ` AND (u.email ILIKE $${pi} OR u.nickname ILIKE $${pi} OR u.id::text ILIKE $${pi})`;
      params.push(`%${search}%`);
    }
    if (rank) {
      pi++;
      where += ` AND f.rank_id = $${pi}`;
      params.push(rank);
    }
    if (platform) {
      pi++;
      where += ` AND u.device_platform = $${pi}`;
      params.push(platform);
    }
    if (country) {
      pi++;
      where += ` AND u.country = $${pi}`;
      params.push(country);
    }
    if (activeWithin > 0 && activeWithin <= 365) {
      pi++;
      where += ` AND u.last_active_at >= now() - ($${pi} || ' days')::interval`;
      params.push(String(activeWithin));
    }
    if (hasAds) {
      where += ` AND EXISTS (SELECT 1 FROM ad_views av2 WHERE av2.user_id = u.id)`;
    }
    if (hasOffers) {
      where += ` AND EXISTS (SELECT 1 FROM offer_completions oc2 WHERE oc2.user_id = u.id)`;
    }

    const countRow = await queryOne(
      `SELECT count(*)::int AS c FROM users u LEFT JOIN farms f ON f.user_id = u.id AND f.harvested = false ${where}`,
      params
    );

    // Aliases used in SELECT are visible to ORDER BY in Postgres, which lets
    // us sort by computed columns like `total_ad_views` without wrapping in
    // a subquery. `NULLS LAST` keeps users with no activity at the bottom on
    // DESC sorts, which matches what admins expect.
    const rows = await query(
      `SELECT
        u.id, u.nickname, u.email, u.avatar_id, u.is_admin,
        u.created_at, u.last_login_at, u.last_active_at,
        u.registration_source, u.device_platform, u.country,
        u.telegram_id,
        f.rank_id, f.current_stage, f.growth_percent, f.water_in_can,
        f.nutrition, f.total_water_this_month,
        (SELECT count(*)::int FROM friends fr WHERE fr.user_id = u.id) AS friends_count,
        (SELECT coalesce(sum(count), 0)::int FROM ad_views av WHERE av.user_id = u.id) AS total_ad_views,
        (SELECT count(*)::int FROM offer_completions oc WHERE oc.user_id = u.id) AS offers_completed,
        (SELECT max(started_at) FROM sessions s WHERE s.user_id = u.id) AS last_session_at
       FROM users u
       LEFT JOIN farms f ON f.user_id = u.id AND f.harvested = false
       ${where}
       ORDER BY ${sortColumn} ${sortDir} NULLS LAST, u.id ${sortDir}
       LIMIT $${pi + 1} OFFSET $${pi + 2}`,
      [...params, limit, offset]
    );

    res.json({
      users: rows,
      total: countRow?.c || 0,
      page,
      limit,
      sortBy: sortByRaw in USERS_SORT_COLUMNS ? sortByRaw : 'created_at',
      sortDir: sortDir.toLowerCase(),
    });
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

adminUsersRouter.get('/:id', async (req, res) => {
  try {
    const user = await queryOne(
      `SELECT u.*, f.rank_id, f.current_stage, f.growth_percent, f.water_in_can,
              f.nutrition, f.total_water_this_month, f.total_water_last_month,
              f.product_id, p.name_key AS product_name, f.harvested,
              f.bucket_last_collected_at, f.water_in_bucket
       FROM users u
       LEFT JOIN farms f ON f.user_id = u.id AND f.harvested = false
       LEFT JOIN products p ON p.id = f.product_id
       WHERE u.id = $1`,
      [req.params.id]
    );
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const [friends, recentEvents, referrals, pushTokens] = await Promise.all([
      query(
        `SELECT u.id, u.nickname, u.avatar_id FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = $1`,
        [req.params.id]
      ),
      query(
        `SELECT event_name, properties, created_at FROM events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.params.id]
      ),
      query(
        `SELECT r.invite_code, r.completed, r.created_at,
                inv.nickname AS invitee_nickname, inv.email AS invitee_email
         FROM referrals r LEFT JOIN users inv ON inv.id = r.invitee_id
         WHERE r.inviter_id = $1 ORDER BY r.created_at DESC`,
        [req.params.id]
      ),
      query(
        `SELECT token, platform, created_at FROM push_tokens WHERE user_id = $1`,
        [req.params.id]
      ),
    ]);

    res.json({ ...user, friends, recentEvents, referrals, pushTokens });
  } catch (err) {
    console.error('[admin/users/:id]', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

adminUsersRouter.post('/:id/grant', async (req, res) => {
  try {
    const { type, amount } = req.body;
    if (!['water', 'nutrition'].includes(type) || !amount || amount <= 0) {
      res.status(400).json({ error: 'Invalid type or amount' });
      return;
    }

    const col = type === 'water' ? 'water_in_can' : 'nutrition';
    const cap = type === 'nutrition' ? 'LEAST(nutrition + $2, 10000)' : `${col} + $2`;
    await execute(
      `UPDATE farms SET ${col} = ${cap} WHERE user_id = $1 AND harvested = false`,
      [req.params.id, amount]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[admin/users/grant]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Paginated, filterable event log for a single user. This is the audit trail —
 * every POST/DELETE the user made gets recorded here with full properties,
 * device info, geo, IP, and session id. Filters: ?eventName=&from=&to=&limit=.
 */
adminUsersRouter.get('/:id/events', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(10, parseInt(req.query.limit as string) || 100));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const eventName = (req.query.eventName as string || '').trim();
    const from = (req.query.from as string || '').trim();
    const to = (req.query.to as string || '').trim();

    const where: string[] = [`user_id = $1`];
    const params: any[] = [req.params.id];
    let pi = 1;
    if (eventName) { pi++; where.push(`event_name = $${pi}`); params.push(eventName); }
    if (from)      { pi++; where.push(`created_at >= $${pi}`); params.push(from); }
    if (to)        { pi++; where.push(`created_at <= $${pi}`); params.push(to); }

    const rows = await query(
      `SELECT id, event_name, properties, device, geo, session_id,
              ip::text AS ip, created_at
       FROM events
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${pi + 1} OFFSET $${pi + 2}`,
      [...params, limit, offset]
    );
    const countRow = await queryOne(
      `SELECT count(*)::int AS c FROM events WHERE ${where.join(' AND ')}`,
      params
    );
    res.json({ events: rows, total: countRow?.c || 0, limit, offset });
  } catch (err) {
    console.error('[admin/users/events]', err);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

/**
 * List *usage* sessions for a user.
 *
 * IMPORTANT — we intentionally do NOT read from the `sessions` table here.
 * That table only gets a row on explicit login (see `createSession` in
 * auth.ts) and refresh-token flow reuses the same session id, so a mobile
 * user who logs in once and uses the app for weeks would show up as a
 * single, eternally "active" session — which is useless for admins trying
 * to understand engagement.
 *
 * Instead we derive behavioral sessions from the `events` table by
 * clustering consecutive events with a gap ≥ `SESSION_GAP_MINUTES` (30).
 * That matches the standard product-analytics definition of a session
 * (Google Analytics, Mixpanel, Amplitude all use the same 30-minute rule).
 *
 * Scope: last 90 days of events per user — avoids window-function scans
 * over full history on heavy users while still covering all admin use
 * cases.
 */
adminUsersRouter.get('/:id/sessions', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string) || 50));
    const SESSION_GAP_MINUTES = 30;
    const LOOKBACK_DAYS = 90;

    // Single CTE — PostgreSQL window functions mark "new session" where the
    // gap from the previous event is > 30 min, then a running sum turns
    // those markers into stable session numbers. We join the first event's
    // device / geo / ip to each session via DISTINCT ON.
    const rows = await query(
      `WITH gapped AS (
         SELECT
           id, user_id, device, geo, ip, created_at,
           CASE
             WHEN lag(created_at) OVER w IS NULL
               OR created_at - lag(created_at) OVER w > interval '${SESSION_GAP_MINUTES} minutes'
             THEN 1 ELSE 0
           END AS is_new
         FROM events
         WHERE user_id = $1
           AND created_at >= now() - interval '${LOOKBACK_DAYS} days'
         WINDOW w AS (ORDER BY created_at)
       ),
       sessionized AS (
         SELECT g.*,
           sum(is_new) OVER (ORDER BY created_at) AS session_num
         FROM gapped g
       ),
       agg AS (
         SELECT
           session_num,
           min(created_at) AS started_at,
           max(created_at) AS ended_at,
           count(*)::int   AS events_count,
           GREATEST(0, EXTRACT(EPOCH FROM (max(created_at) - min(created_at)))::int) AS duration_sec
         FROM sessionized
         GROUP BY session_num
       ),
       first_event AS (
         SELECT DISTINCT ON (session_num)
           session_num, device, geo, ip::text AS ip
         FROM sessionized
         ORDER BY session_num, created_at ASC
       )
       SELECT
         ('s-' || a.session_num::text)                         AS id,
         a.started_at, a.ended_at,
         a.events_count,
         a.duration_sec,
         f.device, f.geo, f.ip,
         (a.ended_at > now() - interval '${SESSION_GAP_MINUTES} minutes') AS is_active
       FROM agg a
       LEFT JOIN first_event f USING (session_num)
       ORDER BY a.started_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );

    // Totals computed across ALL (not just first N) sessions in the lookback
    // window so the header stays accurate even when the list is truncated.
    const agg = await queryOne(
      `WITH gapped AS (
         SELECT created_at,
           CASE
             WHEN lag(created_at) OVER (ORDER BY created_at) IS NULL
               OR created_at - lag(created_at) OVER (ORDER BY created_at) > interval '${SESSION_GAP_MINUTES} minutes'
             THEN 1 ELSE 0
           END AS is_new
         FROM events
         WHERE user_id = $1
           AND created_at >= now() - interval '${LOOKBACK_DAYS} days'
       ),
       sessionized AS (
         SELECT created_at,
           sum(is_new) OVER (ORDER BY created_at) AS session_num
         FROM gapped
       ),
       agg AS (
         SELECT session_num,
           GREATEST(0, EXTRACT(EPOCH FROM (max(created_at) - min(created_at)))::int) AS duration_sec
         FROM sessionized
         GROUP BY session_num
       )
       SELECT
         count(*)::int                        AS total_sessions,
         COALESCE(sum(duration_sec), 0)::int  AS total_seconds,
         COALESCE(avg(duration_sec), 0)::int  AS avg_seconds
       FROM agg`,
      [req.params.id]
    );

    res.json({ sessions: rows, totals: agg });
  } catch (err) {
    console.error('[admin/users/sessions]', err);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

/**
 * Ad-views and offer activity for a single user. This is the debug view
 * admins use to diagnose "why didn't this user get a reward" or "which
 * offers did they play". Pulls from three tables in parallel:
 *   - ad_views            (daily per-phase counters)
 *   - offer_completions   (credited milestones)
 *   - offer_postback_log  (raw Everflow callbacks)
 */
adminUsersRouter.get('/:id/offers', async (req, res) => {
  try {
    const userId = req.params.id;

    const [completions, postbacks, adDaily, adByPhase] = await Promise.all([
      query(
        `SELECT oc.id, oc.offer_id, oc.milestone_id, oc.everflow_transaction_id,
                oc.credited_at,
                o.name AS offer_name, o.reward_type,
                m.event_name AS milestone_event, m.reward_amount
           FROM offer_completions oc
           JOIN offers o ON o.id = oc.offer_id
           JOIN offer_milestones m ON m.id = oc.milestone_id
          WHERE oc.user_id = $1
          ORDER BY oc.credited_at DESC
          LIMIT 100`,
        [userId]
      ),
      query(
        `SELECT pl.id, pl.everflow_offer_id, pl.everflow_event_id,
                pl.transaction_id, pl.status, pl.error_message, pl.created_at,
                pl.raw_query,
                o.name AS offer_name
           FROM offer_postback_log pl
           LEFT JOIN offers o ON o.everflow_offer_id = pl.everflow_offer_id
          WHERE pl.user_id = $1
          ORDER BY pl.created_at DESC
          LIMIT 100`,
        [userId]
      ),
      query(
        `SELECT ad_type, phase, view_date, count
           FROM ad_views
          WHERE user_id = $1
          ORDER BY view_date DESC, ad_type, phase
          LIMIT 120`,
        [userId]
      ),
      query(
        `SELECT ad_type, phase, sum(count)::int AS total,
                max(view_date) AS last_date
           FROM ad_views
          WHERE user_id = $1
          GROUP BY ad_type, phase
          ORDER BY total DESC`,
        [userId]
      ),
    ]);

    res.json({
      completions,
      postbacks,
      adsByDay: adDaily,
      adsByPhase: adByPhase,
    });
  } catch (err) {
    console.error('[admin/users/:id/offers]', err);
    res.status(500).json({ error: 'Failed to load user offers/ads activity' });
  }
});

adminUsersRouter.post('/:id/toggle-admin', async (req, res) => {
  try {
    const user = await queryOne(`SELECT is_admin FROM users WHERE id = $1`, [req.params.id]);
    if (!user) { res.status(404).json({ error: 'Not found' }); return; }

    await execute(`UPDATE users SET is_admin = $2 WHERE id = $1`, [req.params.id, !user.is_admin]);
    res.json({ is_admin: !user.is_admin });
  } catch (err) {
    console.error('[admin/users/toggle-admin]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Force-harvest sandbox endpoint.
 *
 * Designed for partner end-to-end integration tests. A real harvest
 * takes ~40 days at 1× nutrition; partners would never see live
 * postbacks during onboarding without this. Pushes the user's active
 * farm to 100 % growth, stage 6, and `harvested=true`, then fires the
 * `stage_4` (if the user hadn't already crossed it) and `harvest`
 * partner conversions in the standard pipeline.
 *
 * Hard guards (any one fails → 403):
 *   1. The user must have `partner_click_id` starting with `tb_test_`,
 *      OR the env var `FORCE_HARVEST_ENABLED=true` is set (dev only).
 *   2. The user must have an active (non-harvested) farm.
 *
 * The first guard is the production gate: TimeBucks register a small
 * set of `tb_test_*` clickids on their side; we register installs from
 * those clicks as test traffic; admin then fires this endpoint to make
 * the user "win" instantly. No real user can be force-harvested by
 * accident because they can't have a `tb_test_` clickid.
 */
adminUsersRouter.post('/:id/force-harvest', async (req, res) => {
  try {
    const userId = req.params.id;
    const envOverride = String(process.env.FORCE_HARVEST_ENABLED || '').trim() === 'true';

    const user = await queryOne<{
      id: string;
      partner_id: string | null;
      partner_click_id: string | null;
    }>(
      `SELECT id, partner_id, partner_click_id FROM users WHERE id = $1`,
      [userId],
    );
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const isTestClick = user.partner_click_id?.startsWith('tb_test_') ?? false;
    if (!isTestClick && !envOverride) {
      res.status(403).json({
        error:
          'force-harvest is restricted to users with a tb_test_* click_id (or FORCE_HARVEST_ENABLED=true in dev). Refusing to mutate a real production farm.',
      });
      return;
    }

    const farm = await queryOne<{
      id: string;
      product_id: string;
      current_stage: number;
      growth_percent: number;
      harvested: boolean;
    }>(
      `SELECT id, product_id, current_stage, growth_percent, harvested
         FROM farms
        WHERE user_id = $1 AND harvested = false
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId],
    );
    if (!farm) {
      res.status(404).json({ error: 'No active farm to force-harvest' });
      return;
    }

    const stageWasBelow4 = farm.current_stage < 4;

    await execute(
      `UPDATE farms
          SET growth_percent = 100,
              current_stage  = 6,
              harvested      = true
        WHERE id = $1`,
      [farm.id],
    );

    // Mirror /water's coupon side-effect so the user lands in the
    // same end-state a real harvest produces. Skipped silently if
    // products row is gone (shouldn't happen but defensive).
    const product = await queryOne<{ coupon_validity_days: number }>(
      `SELECT coupon_validity_days FROM products WHERE id = $1`,
      [farm.product_id],
    );
    if (product) {
      const couponCode = `TEST-${Date.now().toString(36).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + product.coupon_validity_days * 24 * 60 * 60 * 1000);
      await execute(
        `INSERT INTO coupons (user_id, product_id, code, expires_at) VALUES ($1, $2, $3, $4)`,
        [userId, farm.product_id, couponCode, expiresAt.toISOString()],
      );
    }

    // Fire the partner conversions through the same pipeline a real
    // harvest would. recordPartnerConversion is a no-op if the user
    // is organic, the partner is in 'draft', or the event isn't in
    // the partner's allow-list — exactly what we want.
    const attr = await loadUserPartnerAttribution(userId);
    let stageRecorded: { recorded: boolean; skippedReason?: string } | null = null;
    let harvestRecorded: { recorded: boolean; skippedReason?: string } | null = null;
    if (attr) {
      if (stageWasBelow4) {
        stageRecorded = await recordPartnerConversion({
          partnerId: attr.partnerId,
          userId,
          clickId: attr.clickId,
          eventType: 'stage_4',
          countryCode: attr.country,
          metadata: { source: 'force-harvest', product_id: farm.product_id },
        });
      }
      harvestRecorded = await recordPartnerConversion({
        partnerId: attr.partnerId,
        userId,
        clickId: attr.clickId,
        eventType: 'harvest',
        countryCode: attr.country,
        metadata: { source: 'force-harvest', product_id: farm.product_id },
      });
    }

    res.json({
      ok: true,
      farmId: farm.id,
      partnerAttributed: !!attr,
      stageConversion: stageRecorded,
      harvestConversion: harvestRecorded,
      note: attr
        ? 'Postbacks will be queued and delivered by the partner-postback-cron worker within 30 seconds.'
        : 'User has no partner attribution; nothing was sent to TimeBucks. Farm was force-completed locally.',
    });
  } catch (err) {
    console.error('[admin/users/force-harvest]', err);
    res.status(500).json({ error: 'Failed to force-harvest' });
  }
});
