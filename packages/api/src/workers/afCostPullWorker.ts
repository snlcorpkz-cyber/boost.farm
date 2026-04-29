/**
 * AppsFlyer cost pull worker.
 *
 * Pulls partners_by_date_report v5 from AppsFlyer's aggregated
 * Pull API and upserts the rows into `ad_costs`. Runs once a day —
 * AF rate-limits this endpoint at 24 calls/day for 3+-day ranges,
 * so a daily 14-day backfill keeps us at 1/24 of the cap with
 * room for two retries before we'd hit the wall.
 *
 * Idempotency:
 *   ON CONFLICT (cost_date, media_source, campaign_id, adset_id,
 *   ad_id, geo) DO UPDATE — every cell is overwritten with the
 *   latest AF reading. AF restates spend up to ~48h after the day
 *   ends (Meta's API also restates), so the 14-day rolling window
 *   ensures we always carry the most accurate number.
 *
 * Off-by-default:
 *   AF_COST_PULL_ENABLED + APPSFLYER_PULL_API_TOKEN must both be
 *   set. APPSFLYER_APP_ID is reused from the existing S2S worker
 *   (defaults to `io.boostfarm.app`).
 *
 * Failure modes (all degrade gracefully without blocking other workers):
 *   - 401/403 → log once, mark cache-disabled for the rest of the
 *     process lifetime so we don't spam logs every 24h with the
 *     same auth error. Operator must restart after fixing token.
 *   - 404 → wrong app id; same treatment as 401.
 *   - 5xx / network → retried once inside aggReport.ts; if both
 *     attempts fail, we just log and try again tomorrow.
 *   - All-zero cost → log once at INFO level so ops knows the
 *     Meta↔AF cost integration still isn't syncing (API works,
 *     data is empty).
 */

import { execute } from '../lib/db.js';
import {
  AppsFlyerPullError,
  fetchPartnersByDate,
  type CostRow,
} from '../appsflyer/aggReport.js';

export interface AfCostPullEnv {
  enabled: boolean;
  pullApiToken: string;
  appId: string;
}

let cachedEnv: AfCostPullEnv | null = null;
/** Set to true when 401/403/404 lands — silences the worker until the next process restart. */
let authFatalLogged = false;

export function getAfCostPullEnv(): AfCostPullEnv {
  if (cachedEnv) return cachedEnv;
  const explicit = (process.env.AF_COST_PULL_ENABLED || '').trim().toLowerCase();
  const pullApiToken = (process.env.APPSFLYER_PULL_API_TOKEN || '').trim();
  const appId = (process.env.APPSFLYER_APP_ID || 'io.boostfarm.app').trim();
  const enabled = explicit === 'true' && pullApiToken.length > 0 && appId.length > 0;
  cachedEnv = { enabled, pullApiToken, appId };
  return cachedEnv;
}

export function _resetAfCostPullEnvCache(): void {
  cachedEnv = null;
  authFatalLogged = false;
}

/** Days to look back. Larger = more late-attribution capture, but the AF report
 *  size grows roughly linearly with the window. 14 covers Meta's entire spend
 *  reconciliation horizon (Meta normally settles within 72h). */
const BACKFILL_DAYS = 14;

function ymd(d: Date): string {
  // UTC because AF returns dates in the report's configured tz, and we
  // compare cost_date to event timestamps which are stored UTC.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Upsert one CostRow into ad_costs. Uses campaign_name as the
 * surrogate campaign_id since the partners_by_date_report v5
 * doesn't return a real id. When AF starts returning ids in a
 * future schema bump, the upsert key handles it transparently.
 */
async function upsertCostRow(row: CostRow): Promise<void> {
  await execute(
    `INSERT INTO ad_costs (
       cost_date, media_source, campaign_id, campaign_name,
       adset_id, adset_name, ad_id, ad_name, geo,
       currency, spend_micros, impressions, clicks, installs, ingested_at
     ) VALUES (
       $1::date, $2, $3, $4,
       '', '', '', '', '',
       $5, $6, $7, $8, $9,
       now()
     )
     ON CONFLICT (cost_date, media_source, campaign_id, adset_id, ad_id, geo)
     DO UPDATE SET
       campaign_name = EXCLUDED.campaign_name,
       currency      = EXCLUDED.currency,
       spend_micros  = EXCLUDED.spend_micros,
       impressions   = EXCLUDED.impressions,
       clicks        = EXCLUDED.clicks,
       installs      = EXCLUDED.installs,
       ingested_at   = now()`,
    [
      row.date,
      row.media_source,
      // Mirror campaign_name → campaign_id slot for the PK. When AF
      // ships real ids the worker switches over without a migration.
      row.campaign_name,
      row.campaign_name,
      row.currency,
      row.spend_micros,
      row.impressions,
      row.clicks,
      row.installs,
    ],
  );
}

export interface AfCostPullResult {
  fetched: number;
  upserted: number;
  fromDate: string;
  toDate: string;
  zeroCost: boolean;
  /** True when env disabled or fatal auth error already logged. */
  skipped: boolean;
}

export async function runAppsFlyerCostPull(): Promise<AfCostPullResult> {
  const env = getAfCostPullEnv();
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - (BACKFILL_DAYS - 1));
  const fromDate = ymd(from);
  const toDate = ymd(today);

  const skel: AfCostPullResult = {
    fetched: 0,
    upserted: 0,
    fromDate,
    toDate,
    zeroCost: false,
    skipped: true,
  };

  if (!env.enabled) return skel;
  if (authFatalLogged) return skel;

  let rows: CostRow[];
  try {
    rows = await fetchPartnersByDate({
      pullApiToken: env.pullApiToken,
      appId: env.appId,
      fromDate,
      toDate,
      currency: 'USD',
    });
  } catch (err) {
    if (err instanceof AppsFlyerPullError) {
      const fatal = err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 404;
      if (fatal && !authFatalLogged) {
        authFatalLogged = true;
        console.warn(
          `[af-cost-pull] auth/route fatal (${err.statusCode}) — disabling for this process. Body preview: ${err.bodyPreview ?? ''}`,
        );
      } else if (!fatal) {
        console.error(`[af-cost-pull] transient failure: ${err.message}`);
      }
      return skel;
    }
    console.error('[af-cost-pull] unexpected error:', (err as Error).message);
    return skel;
  }

  let upserted = 0;
  // Upsert sequentially. The 14-day window × <10 media sources × few
  // campaigns per source = at most ~200 rows. Sequential keeps the
  // pool occupancy bounded and the SQL log readable.
  for (const row of rows) {
    try {
      await upsertCostRow(row);
      upserted += 1;
    } catch (err) {
      console.error('[af-cost-pull] upsert failed for', row.date, row.media_source, '-', (err as Error).message);
    }
  }

  const zeroCost = rows.length > 0 && rows.every((r) => r.spend_micros === 0);
  if (zeroCost) {
    console.warn(
      `[af-cost-pull] all ${rows.length} rows have spend_micros=0 — verify AF→Meta cost integration sync (Configuration → Integrated Partners → Facebook Ads → Cost section).`,
    );
  } else {
    console.log(
      `[af-cost-pull] ingested ${upserted}/${rows.length} rows for date_range=${fromDate}..${toDate}`,
    );
  }

  return {
    fetched: rows.length,
    upserted,
    fromDate,
    toDate,
    zeroCost,
    skipped: false,
  };
}
