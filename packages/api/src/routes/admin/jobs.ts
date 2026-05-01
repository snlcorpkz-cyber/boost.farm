import { Router } from 'express';
import { runAppsFlyerCostPull, getAfCostPullEnv } from '../../workers/afCostPullWorker.js';
import { query } from '../../lib/db.js';

/**
 * Admin job triggers — manual replay of background workers from
 * the dashboard so ops doesn't need shell access for routine
 * troubleshooting (e.g. "today's CPI looks wrong, force a re-pull
 * before the next scheduled cron tick").
 *
 * All endpoints are mounted behind `requireAdmin` (see
 * routes/admin/index.ts). Long-running work runs synchronously —
 * we want the response body to confirm success/failure so the UI
 * can surface real status, and the worker is bounded (≤200 rows
 * per pull, single AF API call).
 */
export const adminJobsRouter = Router();

/**
 * GET /admin/jobs/af-cost-pull/status
 * Returns whether the worker is enabled and the most recent
 * `ingested_at` from `ad_costs` so the UI can show "last sync N
 * minutes ago" without the operator running SQL.
 */
adminJobsRouter.get('/af-cost-pull/status', async (_req, res) => {
  const env = getAfCostPullEnv();
  let lastIngestedAt: string | null = null;
  let totalRows = 0;
  try {
    const rows = await query<{ last_ingested_at: string | null; total_rows: string }>(
      `SELECT max(ingested_at)::text AS last_ingested_at,
              count(*)::text         AS total_rows
         FROM ad_costs`,
    );
    lastIngestedAt = rows[0]?.last_ingested_at ?? null;
    totalRows = Number(rows[0]?.total_rows ?? '0');
  } catch (err) {
    // Likely the migration hasn't been applied. Surface that to
    // the UI rather than 500-ing — operator can read the message
    // and act.
    const msg = (err as Error).message;
    res.json({
      enabled: env.enabled,
      configured: env.pullApiToken.length > 0,
      app_id: env.appId,
      last_ingested_at: null,
      total_rows: 0,
      table_error: msg,
    });
    return;
  }
  res.json({
    enabled: env.enabled,
    configured: env.pullApiToken.length > 0,
    app_id: env.appId,
    last_ingested_at: lastIngestedAt,
    total_rows: totalRows,
  });
});

/**
 * POST /admin/jobs/af-cost-pull
 * Body: { truncate_range?: boolean }
 *
 * Triggers an immediate AppsFlyer Pull API fetch for the standard
 * 14-day rolling window. Set `truncate_range: true` after a TZ
 * change (or any time stale rows might be lingering under a now-
 * invalid `cost_date`) to wipe the window before re-inserting.
 *
 * Returns the structured result from the worker so the UI can
 * show "ingested N rows over date_range=X..Y" directly.
 */
adminJobsRouter.post('/af-cost-pull', async (req, res) => {
  const env = getAfCostPullEnv();
  if (!env.enabled) {
    res.status(409).json({
      ok: false,
      error: 'AF cost pull worker disabled. Set AF_COST_PULL_ENABLED=true and APPSFLYER_PULL_API_TOKEN in env, then restart the API.',
    });
    return;
  }
  const truncateRange = req.body?.truncate_range === true;
  try {
    const result = await runAppsFlyerCostPull({ truncateRange });
    res.json({ ok: true, truncate_range: truncateRange, result });
  } catch (err) {
    const message = (err as Error).message ?? 'unknown error';
    res.status(500).json({ ok: false, error: message });
  }
});
