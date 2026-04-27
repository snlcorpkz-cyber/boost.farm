/**
 * AppsFlyer Server-to-Server (S2S) in-app event sender.
 *
 * Mirrors what the mobile SDK does in `AppsFlyerLib.logEvent(...)` —
 * but from our backend. Events POSTed here are routed by AppsFlyer
 * to every connected partner (Meta / Google / TikTok / …) the same
 * way as SDK-originated events.
 *
 * Used by the worker in `workers/appsflyerS2SWorker.ts` for events
 * that:
 *   1. ONLY exist server-side (e.g. Everflow offerwall postbacks
 *      that credit users while the app is in background — the SDK
 *      can't fire `af_offer_completed` because the app isn't open).
 *   2. Need redundancy because the SDK might have failed (network
 *      drop, OS-killed background process, app uninstalled before
 *      the SDK flushed its queue).
 *
 * API reference (current as of 2026-04):
 *   POST https://api3.appsflyer.com/inappevent/<app_id>
 *   Headers:
 *     authentication: <DEV_KEY>            ← NOT "Authorization"
 *     Content-Type:   application/json
 *   Body (JSON):
 *     {
 *       "customer_user_id": "<our user id>",
 *       "appsflyer_id":     "<af UID, optional>",
 *       "ip":               "<client ip>",
 *       "eventName":        "af_complete_registration",
 *       "eventValue":       "{\"af_registration_method\":\"email\"}",
 *       "eventTime":        "2026-04-21 12:34:56.789",
 *       "eventCurrency":    "USD",
 *       "bundleId":         "io.boostfarm.app"
 *     }
 *
 * Auth uses the SAME dev key the mobile SDK uses (lives in
 * keystore.properties on the Android side, env var on the server
 * side). We pin it to a NEW env var instead of reusing
 * `APPSFLYER_DEV_KEY` because the dev key is a high-trust secret
 * — anyone with it can post arbitrary events to our AF dashboard
 * — and the same string showing up in two different env contexts
 * (server-only vs Android-only) makes secret rotation easier to
 * reason about.
 *
 * Dedup behaviour:
 *   AppsFlyer dedupes by (bundleId, customer_user_id, eventName,
 *   eventTime) inside a ~30-minute window. We always stamp
 *   eventTime from `events.created_at`, never from `now()`, so
 *   re-running the worker against the same row produces the SAME
 *   eventTime and AF rejects the duplicate cleanly. That's why
 *   marking `af_s2s_sent_at` after a 200 response is safe even
 *   when the network reply was actually delayed past our timeout.
 */

const ENDPOINT_BASE = 'https://api3.appsflyer.com/inappevent';

export interface AfS2SEnv {
  enabled: boolean;
  devKey: string;
  appId: string;
  /** Comma-separated allow-list of internal event_name values. */
  eventNamesAllowList: string[];
}

/**
 * Reads + validates the env. We do this at module-import time
 * via lazy memoisation so the first event never pays the parse
 * cost twice.
 */
let cachedEnv: AfS2SEnv | null = null;
export function getAfS2SEnv(): AfS2SEnv {
  if (cachedEnv) return cachedEnv;
  const devKey = (process.env.APPSFLYER_S2S_DEV_KEY || process.env.APPSFLYER_DEV_KEY || '').trim();
  const appId = (process.env.APPSFLYER_APP_ID || 'io.boostfarm.app').trim();
  const explicit = (process.env.APPSFLYER_S2S_ENABLED || '').trim().toLowerCase();
  const allowList = (process.env.APPSFLYER_S2S_EVENT_NAMES || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const enabled =
    explicit === 'true' &&
    devKey.length > 0 &&
    appId.length > 0 &&
    allowList.length > 0;

  cachedEnv = {
    enabled,
    devKey,
    appId,
    eventNamesAllowList: allowList,
  };
  return cachedEnv;
}

/** Test-only escape hatch — clears the memoised env. */
export function _resetAfS2SEnvCache(): void {
  cachedEnv = null;
}

export interface SendAfEventInput {
  /** AppsFlyer event name, MUST start with `af_` for canonical events. */
  eventName: string;
  /** Our internal user UUID — used as AF's customer_user_id. */
  customerUserId: string;
  /** AppsFlyer Unique ID, if known. Boosts attribution accuracy. */
  appsflyerId?: string | null;
  /** Client IP at the time the event was generated. */
  ip?: string | null;
  /** Event-specific params (af_revenue / af_currency / …). */
  eventValue?: Record<string, string | number | boolean>;
  /** Event timestamp — we stamp it from `events.created_at`. */
  eventTime: Date;
  /** ISO 4217 currency for revenue events. */
  eventCurrency?: string | null;
}

export interface SendAfEventResult {
  ok: boolean;
  /** HTTP status code, undefined if the request never landed. */
  statusCode?: number;
  /** Truncated server response body for diagnostics. */
  reason?: string;
  /** When false, the worker leaves the row in the queue for the next tick. */
  retryable: boolean;
}

/**
 * Format AppsFlyer expects for `eventTime`: "yyyy-MM-dd HH:mm:ss.SSS"
 * in UTC. ISO timestamps (with `T` and `Z`) are accepted by some
 * endpoints but rejected by others — we always normalise.
 */
function formatAfEventTime(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const yyyy = d.getUTCFullYear();
  const MM = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  const ms = pad(d.getUTCMilliseconds(), 3);
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}.${ms}`;
}

const HTTP_TIMEOUT_MS = 8_000;

/**
 * Sends ONE event to AppsFlyer S2S. Each event = one HTTP request —
 * the API does not support batching for the in-app events endpoint
 * (per AF docs). The worker calls this in a small concurrency-bounded
 * fan-out so a single tick can drain a queue of ~50 events comfortably.
 */
export async function sendAfS2SEvent(input: SendAfEventInput): Promise<SendAfEventResult> {
  const env = getAfS2SEnv();
  if (!env.enabled) {
    return { ok: false, retryable: false, reason: 'AF_S2S disabled' };
  }
  if (!input.customerUserId) {
    return { ok: false, retryable: false, reason: 'missing customer_user_id' };
  }

  const url = `${ENDPOINT_BASE}/${encodeURIComponent(env.appId)}`;
  const eventValue = input.eventValue && Object.keys(input.eventValue).length > 0
    ? JSON.stringify(input.eventValue)
    : ''; // empty string is the AF-documented "no params" value

  const body = {
    customer_user_id: input.customerUserId,
    ...(input.appsflyerId ? { appsflyer_id: input.appsflyerId } : {}),
    ...(input.ip ? { ip: input.ip } : {}),
    eventName: input.eventName,
    eventValue,
    eventTime: formatAfEventTime(input.eventTime),
    ...(input.eventCurrency ? { eventCurrency: input.eventCurrency } : {}),
    bundleId: env.appId,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // AF S2S uses a non-standard `authentication` header (lower-case).
        // Don't be tempted to swap it for `Authorization` — AF rejects
        // those payloads without a useful error message.
        authentication: env.devKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      return { ok: true, statusCode: res.status, retryable: false };
    }

    // Read response text best-effort for diagnostics. AF returns
    // tiny error envelopes — capping at 500 chars is plenty.
    let reason = '';
    try { reason = (await res.text()).slice(0, 500); } catch { /* ignore */ }

    const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
    return { ok: false, statusCode: res.status, reason, retryable };
  } catch (err: any) {
    clearTimeout(timer);
    const reason =
      err?.name === 'AbortError' ? 'timeout' : err?.message ? String(err.message).slice(0, 500) : 'network';
    // Network / timeout / DNS — always retryable.
    return { ok: false, reason, retryable: true };
  }
}

/**
 * Mapping internal event_name → AppsFlyer event name + a builder
 * function that derives `eventValue` from the event row's properties
 * + revenue. Only events listed here can be S2S-dispatched, even if
 * the env allow-list mentions others — defense in depth.
 *
 * Add a new mapping here AND list the internal name in
 * APPSFLYER_S2S_EVENT_NAMES to enable.
 */
export interface InternalEventLike {
  event_name: string;
  properties: Record<string, any> | null;
  revenue_cents: number | null;
}

export interface MappedAfEvent {
  afEventName: string;
  eventValue: Record<string, string | number | boolean>;
  eventCurrency?: string;
}

const MAPPINGS: Record<string, (e: InternalEventLike) => MappedAfEvent | null> = {
  'auth.register': () => ({
    afEventName: 'af_complete_registration',
    eventValue: { af_registration_method: 'email' },
  }),
  'onboarding.tutorial_finished': () => ({
    afEventName: 'af_tutorial_completion',
    eventValue: {},
  }),
  EngagedD0: () => ({
    afEventName: 'af_engaged_d0',
    eventValue: {},
  }),
  // Server-confirmed offerwall reward. Most likely event for S2S to
  // matter — Everflow postbacks fire while the app is in the
  // background, so the SDK can't reliably log this client-side.
  'econ.offer_completed': (e) => {
    const props = e.properties ?? {};
    const revenueUsd =
      typeof e.revenue_cents === 'number' && e.revenue_cents > 0
        ? e.revenue_cents / 100
        : typeof props.revenue_usd === 'number'
          ? props.revenue_usd
          : 0;
    const value: Record<string, string | number | boolean> = {
      af_revenue: Number(revenueUsd.toFixed(4)),
      af_currency: 'USD',
    };
    if (props.offer_id != null) value.offer_id = String(props.offer_id);
    return {
      afEventName: 'af_offer_completed',
      eventValue: value,
      eventCurrency: 'USD',
    };
  },
  // Future IAP. Mapped now so enabling it later is just an env-var flip.
  'econ.purchase': (e) => {
    const props = e.properties ?? {};
    const revenueUsd =
      typeof e.revenue_cents === 'number' && e.revenue_cents > 0
        ? e.revenue_cents / 100
        : typeof props.revenue_usd === 'number'
          ? props.revenue_usd
          : 0;
    const value: Record<string, string | number | boolean> = {
      af_revenue: Number(revenueUsd.toFixed(4)),
      af_currency: (props.currency as string) || 'USD',
    };
    if (props.product_id) value.af_content_id = String(props.product_id);
    return {
      afEventName: 'af_purchase',
      eventValue: value,
      eventCurrency: (props.currency as string) || 'USD',
    };
  },
};

/** Pre-flight check: will the worker accept this event_name? */
export function isS2SDispatchable(eventName: string): boolean {
  return Object.prototype.hasOwnProperty.call(MAPPINGS, eventName);
}

/** Map an events-table row into the AF S2S shape, or null if unmappable. */
export function mapInternalToAfEvent(e: InternalEventLike): MappedAfEvent | null {
  const fn = MAPPINGS[e.event_name];
  if (!fn) return null;
  try {
    return fn(e);
  } catch {
    return null;
  }
}
