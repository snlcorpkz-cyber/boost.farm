/**
 * AppsFlyer S2S dispatch worker.
 *
 * Mirrors `capiWorker.ts` (Meta CAPI) — same "events table is the
 * queue" pattern. Each tick:
 *   1. Reads the env config (memoised). Exits early if disabled.
 *   2. Selects a small batch of unsent + dispatchable events.
 *   3. POSTs each to AppsFlyer's in-app event endpoint with bounded
 *      concurrency. AppsFlyer S2S has no batch endpoint, so each
 *      event = one HTTP call.
 *   4. Marks successful rows with af_s2s_sent_at = now(). 4xx
 *      responses are deadlettered into `af_s2s_errors` AND stamped
 *      so they don't loop forever. 5xx / network errors leave the
 *      row NULL so the next tick retries naturally.
 *
 * Off-by-default. Three pieces of env have to be set for the worker
 * to do anything (see `appsflyer/s2s.ts → getAfS2SEnv()`):
 *   • APPSFLYER_S2S_ENABLED=true
 *   • APPSFLYER_S2S_DEV_KEY (or APPSFLYER_DEV_KEY) — same key as the
 *     mobile SDK uses; lives in keystore.properties for Android.
 *   • APPSFLYER_S2S_EVENT_NAMES=auth.register,EngagedD0,econ.offer_completed
 *     — comma-separated allow-list. Start with ONE event, verify in
 *     the AF dashboard, add more.
 *
 * Why an allow-list (not auto-dispatch every supported event):
 *   • The mobile SDK already fires most of these from the client.
 *     Without the allow-list we'd double-count. AppsFlyer dedupes
 *     by (bundleId, customer_user_id, eventName, eventTime) within
 *     a 30-min window — but only when the eventTime exactly matches.
 *     Server vs client clocks drift; one happens 4 seconds after the
 *     other; AF treats them as two events. The allow-list lets ops
 *     enable S2S only for events the SDK is KNOWN not to fire
 *     (server-only signals like Everflow postbacks).
 */

import { query, execute } from '../lib/db.js';
import {
  getAfS2SEnv,
  isS2SDispatchable,
  mapInternalToAfEvent,
  sendAfS2SEvent,
} from '../appsflyer/s2s.js';

/** Per-tick ceiling so a backlog can't monopolise the event loop. */
const MAX_EVENTS_PER_TICK = 200;

/** Bounded HTTP concurrency — AF doesn't publish a hard rate limit. */
const HTTP_CONCURRENCY = 4;

/** Skip events older than this. AF is pickier than Meta — 7d is the doc'd limit. */
const MAX_EVENT_AGE_DAYS = 6;

interface EventRow {
  id: string;
  user_id: string;
  event_name: string;
  properties: Record<string, unknown> | null;
  revenue_cents: number | null;
  created_at: string;
  ip: string | null;
  customer_user_id: string;
  acquisition_source: Record<string, unknown> | null;
}

async function fetchPendingEvents(allowList: string[], limit: number): Promise<EventRow[]> {
  if (allowList.length === 0) return [];
  // JOIN users so we can pull customer_user_id (= our internal user id)
  // + acquisition_source (for the cached AppsFlyer UID).
  return query<EventRow>(
    `SELECT e.id,
            e.user_id,
            e.event_name,
            e.properties,
            e.revenue_cents,
            e.created_at,
            e.ip::text   AS ip,
            u.id::text   AS customer_user_id,
            u.acquisition_source
       FROM events e
       JOIN users u ON u.id = e.user_id
      WHERE e.af_s2s_sent_at IS NULL
        AND e.event_name = ANY($1::text[])
        AND e.created_at > now() - ($2 || ' days')::interval
      ORDER BY e.created_at ASC
      LIMIT $3`,
    [allowList, String(MAX_EVENT_AGE_DAYS), limit],
  );
}

async function markSent(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await execute(
    `UPDATE events SET af_s2s_sent_at = now() WHERE id = ANY($1::uuid[])`,
    [eventIds],
  );
}

async function recordError(
  eventId: string,
  eventName: string,
  afEventName: string,
  statusCode: number | undefined,
  reason: string,
  payload: unknown,
): Promise<void> {
  try {
    await execute(
      `INSERT INTO af_s2s_errors (event_id, event_name, af_event_name, status_code, reason, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [eventId, eventName, afEventName, statusCode ?? null, reason, JSON.stringify(payload)],
    );
  } catch (err) {
    console.error('[af-s2s] failed to record error', (err as Error).message);
  }
}

/**
 * Dispatch a single event row through the S2S sender. Returns the
 * outcome shape the runner uses to decide mark-sent vs deadletter.
 */
async function dispatchOne(row: EventRow): Promise<
  | { kind: 'sent'; eventId: string }
  | { kind: 'failed_permanent'; eventId: string; afEventName: string; statusCode?: number; reason: string; payload: unknown }
  | { kind: 'failed_retry'; eventId: string; reason: string }
  | { kind: 'skipped'; eventId: string }
> {
  if (!isS2SDispatchable(row.event_name)) {
    return { kind: 'skipped', eventId: row.id };
  }
  const mapped = mapInternalToAfEvent({
    event_name: row.event_name,
    properties: row.properties,
    revenue_cents: row.revenue_cents,
  });
  if (!mapped) return { kind: 'skipped', eventId: row.id };

  const acq = row.acquisition_source ?? {};
  const appsflyerId = (acq as any).afAppsflyerId as string | undefined;

  const result = await sendAfS2SEvent({
    eventName: mapped.afEventName,
    customerUserId: row.customer_user_id,
    appsflyerId: appsflyerId ?? null,
    ip: row.ip,
    eventValue: mapped.eventValue,
    eventTime: new Date(row.created_at),
    eventCurrency: mapped.eventCurrency ?? null,
  });

  if (result.ok) return { kind: 'sent', eventId: row.id };

  const payload = {
    eventName: mapped.afEventName,
    customer_user_id: row.customer_user_id,
    eventValue: mapped.eventValue,
  };
  if (!result.retryable) {
    return {
      kind: 'failed_permanent',
      eventId: row.id,
      afEventName: mapped.afEventName,
      statusCode: result.statusCode,
      reason: result.reason ?? 'unknown',
      payload,
    };
  }
  return { kind: 'failed_retry', eventId: row.id, reason: result.reason ?? 'retry' };
}

/**
 * Public entry point. Same shape as `runCapiDispatch` so wiring in
 * `index.ts` looks symmetric.
 */
export async function runAppsFlyerS2SDispatch(): Promise<{ sent: number; failed: number }> {
  const env = getAfS2SEnv();
  if (!env.enabled) return { sent: 0, failed: 0 };

  const pending = await fetchPendingEvents(env.eventNamesAllowList, MAX_EVENTS_PER_TICK);
  if (pending.length === 0) return { sent: 0, failed: 0 };

  const sentIds: string[] = [];
  const skippedIds: string[] = [];
  const permanentFailures: Array<{
    eventId: string; eventName: string; afEventName: string;
    statusCode?: number; reason: string; payload: unknown;
  }> = [];
  let retried = 0;

  // Bounded concurrency loop — sliced fan-out so we never have more
  // than HTTP_CONCURRENCY in-flight HTTPs at once.
  for (let i = 0; i < pending.length; i += HTTP_CONCURRENCY) {
    const slice = pending.slice(i, i + HTTP_CONCURRENCY);
    const outcomes = await Promise.all(slice.map((row) => dispatchOne(row).then((o) => ({ row, o }))));
    for (const { row, o } of outcomes) {
      switch (o.kind) {
        case 'sent': sentIds.push(o.eventId); break;
        case 'skipped': skippedIds.push(o.eventId); break;
        case 'failed_permanent':
          permanentFailures.push({
            eventId: o.eventId,
            eventName: row.event_name,
            afEventName: o.afEventName,
            statusCode: o.statusCode,
            reason: o.reason,
            payload: o.payload,
          });
          break;
        case 'failed_retry':
          retried += 1;
          // Leave af_s2s_sent_at = NULL — next tick retries.
          break;
      }
    }
  }

  // Skipped rows would otherwise be re-fetched on every tick forever.
  // Stamp them sent so they drop out of the queue.
  await markSent([...sentIds, ...skippedIds]);

  // Deadletter permanent failures one at a time (4xx happens rarely
  // enough that a per-row INSERT is cheaper than batching).
  for (const f of permanentFailures) {
    await recordError(f.eventId, f.eventName, f.afEventName, f.statusCode, f.reason, f.payload);
  }
  if (permanentFailures.length > 0) {
    await markSent(permanentFailures.map((f) => f.eventId));
  }

  if (retried > 0) {
    console.warn(`[af-s2s] retryable failures: ${retried} (left in queue for next tick)`);
  }

  return { sent: sentIds.length, failed: permanentFailures.length };
}
