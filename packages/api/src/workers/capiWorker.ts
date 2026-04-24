/**
 * Meta Conversions API dispatcher.
 *
 * Runs on the main API process (same pattern as `push-cron` and
 * `analytics-rollup`) — no Redis / BullMQ dependency. The `events`
 * table is already the queue: we scan for rows with
 * `meta_capi_sent_at IS NULL` whose `event_name` is mappable to a Meta
 * standard event and POST them to Meta Graph API in small batches.
 *
 * Key invariants:
 *  - Strictly idempotent: we send `event_id = events.id` so Meta
 *    dedupes on its side. Re-running the worker is safe.
 *  - Permanent failures (4xx) are deadlettered to `fb_capi_errors` AND
 *    stamped with `meta_capi_sent_at = now()` so they don't keep
 *    getting picked up. Transient failures (5xx, timeouts) leave the
 *    row NULL so the next tick retries naturally.
 *  - Users without email still get attributed via `external_id` (our
 *    hashed UUID) — Meta falls back to that match key.
 *  - When CAPI is disabled (missing creds / `META_CAPI_ENABLED=false`)
 *    the worker tick no-ops immediately. Safe to leave scheduled in
 *    dev.
 */

import { query, execute } from '../lib/db.js';
import {
  mapInternalToMetaEvent,
  sendAppEventsBatch,
  type MetaEventName,
  type SendAppEventInput,
} from '../meta/capi.js';
import { isCapiEnabled } from '../meta/env.js';

/**
 * Event names we are WILLING to forward to Meta. Kept as a SQL-friendly
 * array so the main sweep stays an indexed search instead of a table
 * scan + regex. Keep this in sync with `mapInternalToMetaEvent`.
 */
const DISPATCHABLE_EVENT_NAMES: readonly string[] = [
  'auth.register',
  'onboarding.tutorial_finished',
  'EngagedD0',
  'econ.offer_completed',
  'econ.purchase',
  'ad.revenue',
  'ad.rewarded',
  'ad.server_granted',
];

/** Max events per HTTP POST. Meta allows 1000; 500 gives us payload headroom. */
const BATCH_SIZE = 500;

/** Per-tick ceiling so one run can't monopolise the event loop. */
const MAX_EVENTS_PER_TICK = 2000;

/** How far back we look. Meta rejects events older than 7 days. */
const MAX_EVENT_AGE_DAYS = 6;

interface EventRow {
  id: string;
  user_id: string;
  event_name: string;
  properties: Record<string, unknown> | null;
  device: Record<string, unknown> | null;
  geo: Record<string, unknown> | null;
  ip: string | null;
  platform: string | null;
  app_version: string | null;
  revenue_cents: number | null;
  created_at: string;
  utm_source: string | null;
  utm_campaign: string | null;
  email: string | null;
  country: string | null;
  acquisition_source: Record<string, unknown> | null;
}

interface BatchedGroup {
  metaEventName: MetaEventName;
  inputs: Array<{ eventId: string; input: SendAppEventInput }>;
}

function toUnixSec(iso: string): number {
  const t = new Date(iso).getTime();
  return Math.floor(t / 1000);
}

/**
 * Converts an internal `events` row into the Meta-facing shape. Returns
 * null if we decide the row is not worth sending (e.g. missing mapping,
 * event older than the 7-day cutoff, skip_ad_revenue_currency).
 */
function buildInputFromRow(row: EventRow): { input: SendAppEventInput; metaEventName: MetaEventName } | null {
  const metaEventName = mapInternalToMetaEvent(row.event_name);
  if (!metaEventName) return null;

  const eventTime = toUnixSec(row.created_at);
  const ageDays = (Date.now() / 1000 - eventTime) / 86400;
  if (ageDays > MAX_EVENT_AGE_DAYS) return null;

  const props = (row.properties ?? {}) as Record<string, any>;
  const device = (row.device ?? {}) as Record<string, any>;
  const acq = (row.acquisition_source ?? {}) as Record<string, any>;

  // Pull campaign ids (preferred) from acquisition_source; fall back to
  // event properties which is where trackClient stashes UTM on the web.
  //
  // acquisition_source is populated by `saveAcquisitionSource` in
  // routes/auth.ts from the Play Install Referrer snapshot — which
  // uses camelCase keys (fbAdId / fbAdsetId / fbCampaignId). Event
  // properties use the snake_case shape that trackEvent stamps when
  // /auth/verify-code writes `auth.register`. We read BOTH so we
  // don't miss attribution if either pipeline changes later.
  const fbAdId: string | null =
    acq.fbAdId ?? acq.fb_ad_id ?? props.fb_ad_id ?? null;
  const fbAdsetId: string | null =
    acq.fbAdsetId ?? acq.fb_adset_id ?? props.fb_adset_id ?? null;
  const fbCampaignId: string | null =
    acq.fbCampaignId ?? acq.fb_campaign_id ?? props.fb_campaign_id ?? null;

  // Platform normalisation — our events store 'android' / 'web',
  // Meta expects the same strings.
  const platform =
    row.platform === 'android' || row.platform === 'ios' || row.platform === 'web'
      ? row.platform
      : null;

  // custom_data per event type. Meta uses `currency` + `value` for
  // Purchase; AdImpression has no canonical fields. Engaged/Tutorial
  // carry our internal content ids so ad-manager breakdowns can
  // segment on them.
  const customData: Record<string, unknown> = {};
  if (metaEventName === 'Purchase') {
    const valueUsd =
      typeof row.revenue_cents === 'number' && row.revenue_cents > 0
        ? row.revenue_cents / 100
        : typeof props.revenue_usd === 'number'
          ? props.revenue_usd
          : typeof props.value === 'number'
            ? props.value
            : 0;
    customData.currency = (props.currency as string) ?? 'USD';
    customData.value = Number(valueUsd.toFixed(4));
  }
  if (metaEventName === 'EngagedD0') {
    customData.value = 1;
    customData.currency = 'USD';
  }
  if (row.utm_campaign) customData.campaign_name = row.utm_campaign;
  if (row.utm_source) customData.source = row.utm_source;

  const input: SendAppEventInput = {
    eventName: metaEventName,
    eventId: row.id,
    eventTime,
    userId: row.user_id,
    email: row.email ?? null,
    platform,
    clientIpAddress: row.ip ?? null,
    clientUserAgent: (device.userAgent as string) ?? null,
    country: row.country ?? null,
    madid: (device.gaid as string) ?? null,
    fbp: (props.fbp as string) ?? null,
    fbc: (props.fbc as string) ?? null,
    fbAdId,
    fbAdsetId,
    fbCampaignId,
    customData: Object.keys(customData).length > 0 ? customData : undefined,
  };
  return { input, metaEventName };
}

async function fetchPendingEvents(limit: number): Promise<EventRow[]> {
  // JOIN users for email + acquisition_source so we don't N+1 the worker.
  // Users without email still emit (email becomes NULL; Meta falls back
  // to external_id).
  const rows = await query<EventRow>(
    `SELECT e.id,
            e.user_id,
            e.event_name,
            e.properties,
            e.device,
            e.geo,
            e.ip::text AS ip,
            e.platform,
            e.app_version,
            e.revenue_cents,
            e.created_at,
            e.utm_source,
            e.utm_campaign,
            u.email,
            u.country,
            u.acquisition_source
       FROM events e
       JOIN users u ON u.id = e.user_id
      WHERE e.meta_capi_sent_at IS NULL
        AND e.event_name = ANY($1::text[])
        AND e.created_at > now() - ($2 || ' days')::interval
      ORDER BY e.created_at ASC
      LIMIT $3`,
    [DISPATCHABLE_EVENT_NAMES, String(MAX_EVENT_AGE_DAYS), limit],
  );
  return rows;
}

async function markSent(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await execute(
    `UPDATE events SET meta_capi_sent_at = now() WHERE id = ANY($1::uuid[])`,
    [eventIds],
  );
}

async function recordError(
  eventId: string,
  eventName: string,
  metaEventName: string,
  statusCode: number | undefined,
  reason: string,
  payload: unknown,
): Promise<void> {
  try {
    await execute(
      `INSERT INTO fb_capi_errors (event_id, event_name, meta_event_name, status_code, reason, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [eventId, eventName, metaEventName, statusCode ?? null, reason, JSON.stringify(payload)],
    );
  } catch (err) {
    console.error('[capi-worker] failed to record error', (err as Error).message);
  }
}

/**
 * Group events by Meta event name — the API accepts mixed batches, so
 * we don't STRICTLY need this, but it makes logs far easier to read
 * and isolates a bad event type from poisoning a whole batch.
 */
function groupByMetaEvent(
  rows: EventRow[],
): { groups: BatchedGroup[]; skipped: EventRow[] } {
  const skipped: EventRow[] = [];
  const grouped = new Map<MetaEventName, BatchedGroup>();
  for (const row of rows) {
    const built = buildInputFromRow(row);
    if (!built) {
      skipped.push(row);
      continue;
    }
    const existing = grouped.get(built.metaEventName);
    if (existing) {
      existing.inputs.push({ eventId: row.id, input: built.input });
    } else {
      grouped.set(built.metaEventName, {
        metaEventName: built.metaEventName,
        inputs: [{ eventId: row.id, input: built.input }],
      });
    }
  }
  return { groups: Array.from(grouped.values()), skipped };
}

/**
 * Public entry point. Reuses the same "hand-written cron" shape as
 * runPushCron so wiring in index.ts stays symmetric.
 */
export async function runCapiDispatch(): Promise<{ sent: number; failed: number }> {
  if (!isCapiEnabled()) return { sent: 0, failed: 0 };

  const pending = await fetchPendingEvents(MAX_EVENTS_PER_TICK);
  if (pending.length === 0) return { sent: 0, failed: 0 };

  const { groups, skipped } = groupByMetaEvent(pending);

  // Skipped rows (unmappable / too old) should NOT stay in the queue —
  // they'll be fetched again on the next tick forever. Mark them sent.
  if (skipped.length > 0) {
    await markSent(skipped.map((r) => r.id));
  }

  let sent = 0;
  let failed = 0;

  for (const group of groups) {
    // Split each group into BATCH_SIZE chunks — Meta caps at 1000 and we
    // want to keep individual POSTs small enough for sub-2s p95.
    for (let i = 0; i < group.inputs.length; i += BATCH_SIZE) {
      const slice = group.inputs.slice(i, i + BATCH_SIZE);
      const inputs = slice.map((s) => s.input);
      const result = await sendAppEventsBatch(inputs);
      if (result.ok) {
        await markSent(slice.map((s) => s.eventId));
        sent += slice.length;
        continue;
      }

      if (!result.retryable) {
        // Permanent failure. Deadletter each event and mark sent so the
        // row drops out of the queue. Reason is copied to every row —
        // ops can still tell them apart via event_id.
        for (const item of slice) {
          await recordError(
            item.eventId,
            group.metaEventName,
            group.metaEventName,
            result.statusCode,
            result.reason ?? 'unknown',
            item.input,
          );
        }
        await markSent(slice.map((s) => s.eventId));
        failed += slice.length;
        continue;
      }

      // Retryable: leave meta_capi_sent_at = NULL so we pick up on the
      // next tick. We don't deadletter OR stamp — the next run will try
      // the same batch again. Log once so ops see something is wrong.
      console.warn(
        `[capi-worker] retryable failure on ${group.metaEventName} batch`,
        {
          statusCode: result.statusCode,
          reason: result.reason?.slice(0, 200),
          batchSize: slice.length,
        },
      );
      failed += slice.length;
    }
  }

  return { sent, failed };
}
