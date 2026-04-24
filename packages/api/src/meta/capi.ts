/**
 * Meta Conversions API (CAPI) client.
 *
 * Sends server-side app events to the Meta Graph API so Meta Ads Manager
 * can optimise campaigns on high-quality signals (CompletedRegistration,
 * EngagedD0, Purchase) that NEVER reach the mobile SDK — either because
 * they fire post-login (SDK only sees install / app_open) or because
 * we want Meta to match via hashed email + external_id for higher match
 * quality than a GAID-only device event.
 *
 * Architecture:
 *  - Everything user-sensitive (email, phone, GAID) is SHA-256 hashed
 *    before leaving the server, per Meta's policy.
 *  - `external_id` is our internal user UUID, also hashed. This is the
 *    strongest match key Meta supports when the user is signed in to
 *    a Meta property on the same device at attribution time.
 *  - `event_id` guarantees idempotency. Meta dedupes any (event_name,
 *    event_id) pair received within 48h — which makes double-sends
 *    safe after transient failures.
 *  - `appsecret_proof` is the HMAC-SHA256 of `accessToken` keyed with
 *    `appSecret`. Required when using a long-lived system-user token.
 *  - Retries live one layer up in the worker (see workers/capiWorker.ts);
 *    this module's `sendAppEvent` returns `{ ok, retryable, reason }`
 *    and lets the caller decide. 4xx from Meta is a permanent failure
 *    (bad event shape) and we write it to `fb_capi_errors` — never
 *    retried, because replay would keep failing.
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/conversions-api/app-events
 */

import crypto from 'crypto';
import { metaEnv } from './env.js';

/** Meta Graph API version we pin against. Bump deliberately after a test pass. */
const GRAPH_API_VERSION = 'v19.0';
const GRAPH_HOST = 'https://graph.facebook.com';

/** Default fetch timeout — Meta's p99 is ~2s, anything beyond 10s is stuck. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Standard Meta event names we support. Keep this union aligned with
 * the allow-list in capiWorker so we fail fast on unknown events.
 */
export type MetaEventName =
  | 'fb_mobile_activate_app'
  | 'fb_mobile_first_app_launch'
  | 'fb_mobile_tutorial_completion'
  | 'CompletedRegistration'
  | 'Purchase'
  | 'Subscribe'
  | 'AdImpression'
  | 'AdClick'
  | 'EngagedD0';

export interface SendAppEventInput {
  eventName: MetaEventName;

  /**
   * Stable idempotency key. We use the `events.id` UUID from our Postgres
   * `events` table — that way replaying the same event_name + event_id
   * is a no-op on Meta's side.
   */
  eventId: string;

  /** Unix seconds. Meta rejects events older than 7 days. */
  eventTime: number;

  /**
   * Our internal user UUID. Sent as `external_id` (SHA-256). Meta matches
   * this against anything they've previously seen for the same user —
   * fbp cookies, cross-app logins, device bindings, etc.
   */
  userId: string;

  /** Optional user email. Hashed with SHA-256 before leaving. */
  email?: string | null;

  /** Optional phone in E.164. Hashed with SHA-256 before leaving. */
  phone?: string | null;

  /**
   * `_fbp` browser cookie if captured from web traffic. Leave null on
   * purely mobile installs; CAPI fall back to external_id + email.
   */
  fbp?: string | null;
  fbc?: string | null;

  /**
   * Advertising ID (GAID on Android, IDFA on iOS). Lower-cased, NOT hashed
   * — Meta expects raw strings here because the match system needs to
   * hash them internally with the platform-specific salt.
   */
  madid?: string | null;

  /** `android` | `ios`. Meta uses it to bucket install attribution. */
  platform?: 'android' | 'ios' | 'web' | null;

  /** Client IP — Meta uses it for fuzzy geo+device matching. */
  clientIpAddress?: string | null;

  /** Client User-Agent, same reasoning as IP. */
  clientUserAgent?: string | null;

  /**
   * Country ISO-2 (e.g. "KZ") if we already resolved it. Meta also
   * inspects IP/UA, so this is nice-to-have but not required.
   */
  country?: string | null;

  /** Free-form event payload (currency/value for Purchase, etc). */
  customData?: Record<string, unknown>;

  /** `adid`-like id from Install Referrer for campaign attribution. */
  fbAdId?: string | null;
  fbAdsetId?: string | null;
  fbCampaignId?: string | null;
}

export interface SendAppEventResult {
  ok: boolean;
  /** Whether the caller should retry later (network / 5xx). */
  retryable: boolean;
  /** Meta error code / description for logging into fb_capi_errors. */
  reason?: string;
  /** Raw status code from Meta, when we got an HTTP response. */
  statusCode?: number;
}

// ──────────────────────────────────────────────
// Hashing helpers
// ──────────────────────────────────────────────

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizePhone(raw: string): string {
  // Meta wants digits only, country code included. Strip everything else.
  return raw.replace(/[^0-9]/g, '');
}

function appSecretProof(accessToken: string, appSecret: string): string {
  return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

// ──────────────────────────────────────────────
// Payload builder
// ──────────────────────────────────────────────

interface MetaUserData {
  em?: string[];
  ph?: string[];
  external_id?: string[];
  fbp?: string;
  fbc?: string;
  madid?: string;
  client_ip_address?: string;
  client_user_agent?: string;
  country?: string[];
}

interface MetaAppData {
  advertiser_tracking_enabled: 0 | 1;
  application_tracking_enabled: 0 | 1;
  extinfo?: (string | number)[];
}

interface MetaEvent {
  event_name: string;
  event_id: string;
  event_time: number;
  action_source: 'app';
  user_data: MetaUserData;
  app_data: MetaAppData;
  custom_data?: Record<string, unknown>;
}

function buildUserData(input: SendAppEventInput): MetaUserData {
  const data: MetaUserData = {};

  if (input.email) {
    data.em = [sha256(normalizeEmail(input.email))];
  }
  if (input.phone) {
    data.ph = [sha256(normalizePhone(input.phone))];
  }
  if (input.userId) {
    // Meta accepts external_id hashed OR raw. We hash because some
    // teams mirror CRM data back from Meta and raw UUIDs land there.
    data.external_id = [sha256(input.userId)];
  }
  if (input.fbp) data.fbp = input.fbp;
  if (input.fbc) data.fbc = input.fbc;
  if (input.madid) data.madid = input.madid.toLowerCase();
  if (input.clientIpAddress) data.client_ip_address = input.clientIpAddress;
  if (input.clientUserAgent) data.client_user_agent = input.clientUserAgent;
  if (input.country) data.country = [sha256(input.country.trim().toLowerCase())];

  return data;
}

function buildAppData(input: SendAppEventInput): MetaAppData {
  // LDU mode on the SDK side does not affect CAPI — we use ad-tracking
  // flags here to let Meta know whether the user is in a region we
  // accept personalised ads for. Mirroring the SDK policy keeps the
  // signals consistent. Flip to 0 once we have per-user consent flags.
  //
  // Note on fb_ad_id / fb_adset_id / fb_campaign_id: those are NOT
  // `app_data` fields in CAPI for App Events (an earlier iteration of
  // this module pretended they were and serialised a `campaign_ids`
  // string — Meta ignored it silently). The ad triplet belongs in
  // `custom_data` per the official payload schema, and is attached
  // there by buildMetaEventPayload below.
  return {
    advertiser_tracking_enabled: 1,
    application_tracking_enabled: 1,
  };
}

export function buildMetaEventPayload(input: SendAppEventInput): MetaEvent {
  // Merge campaign attribution into custom_data. These three keys are
  // what Ads Manager breakdowns expect when grouping custom events by
  // ad / ad set / campaign — they are the only way to answer "which
  // creative converted this user to EngagedD0" from within Meta's UI.
  const customData: Record<string, unknown> = { ...(input.customData ?? {}) };
  if (input.fbAdId) customData.fb_ad_id = input.fbAdId;
  if (input.fbAdsetId) customData.fb_adset_id = input.fbAdsetId;
  if (input.fbCampaignId) customData.fb_campaign_id = input.fbCampaignId;

  return {
    event_name: input.eventName,
    event_id: input.eventId,
    event_time: input.eventTime,
    action_source: 'app',
    user_data: buildUserData(input),
    app_data: buildAppData(input),
    ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
  };
}

// ──────────────────────────────────────────────
// Transport
// ──────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one event to Meta. Safe to call in a tight loop — the transport
 * uses keep-alive via Node's global fetch agent. For batches larger
 * than a single event, prefer `sendAppEventsBatch` below.
 */
export async function sendAppEvent(
  input: SendAppEventInput,
): Promise<SendAppEventResult> {
  const env = metaEnv();
  if (!env.enabled) {
    return { ok: false, retryable: false, reason: 'disabled' };
  }

  return sendAppEventsBatch([input]);
}

/**
 * Batch variant. Meta allows up to 1000 events per request — the worker
 * hands us 500 at a time (headroom for payload size).
 */
export async function sendAppEventsBatch(
  inputs: SendAppEventInput[],
): Promise<SendAppEventResult> {
  const env = metaEnv();
  if (!env.enabled) {
    return { ok: false, retryable: false, reason: 'disabled' };
  }
  if (inputs.length === 0) {
    return { ok: true, retryable: false };
  }

  const events = inputs.map(buildMetaEventPayload);
  const body: Record<string, unknown> = {
    data: events,
    // Raw access token in query string OR body — spec allows both. Body
    // keeps the token out of server access logs.
    access_token: env.accessToken,
    appsecret_proof: appSecretProof(env.accessToken, env.appSecret),
  };
  if (env.testEventCode) body.test_event_code = env.testEventCode;

  const url = `${GRAPH_HOST}/${GRAPH_API_VERSION}/${env.appId}/activities`;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      FETCH_TIMEOUT_MS,
    );
  } catch (err) {
    const reason = (err as Error).name === 'AbortError' ? 'timeout' : (err as Error).message;
    return { ok: false, retryable: true, reason };
  }

  if (response.ok) {
    return { ok: true, retryable: false, statusCode: response.status };
  }

  let errorText: string;
  try {
    errorText = await response.text();
  } catch {
    errorText = `status ${response.status}`;
  }

  // 4xx → stop retrying. Either bad payload shape or invalid credentials
  // — replaying won't help and we want the error in fb_capi_errors so
  // ops can act.
  const retryable = response.status >= 500;
  return {
    ok: false,
    retryable,
    reason: errorText.slice(0, 2000),
    statusCode: response.status,
  };
}

// ──────────────────────────────────────────────
// Event-name mapping — our registry → Meta
// ──────────────────────────────────────────────

/**
 * Maps our internal event names to Meta standard names. Returning null
 * means "do NOT send to Meta". Keep this in sync with the SQL allow-list
 * inside capiWorker.ts.
 */
export function mapInternalToMetaEvent(eventName: string): MetaEventName | null {
  switch (eventName) {
    case 'auth.register':
      return 'CompletedRegistration';
    case 'onboarding.tutorial_finished':
      return 'fb_mobile_tutorial_completion';
    case 'EngagedD0':
      return 'EngagedD0';
    case 'econ.offer_completed':
    case 'econ.purchase':
      return 'Purchase';
    case 'ad.revenue':
      return 'Purchase'; // Meta doesn't have AdRevenue; Purchase + currency is canonical
    case 'ad.rewarded':
    case 'ad.server_granted':
      return 'AdImpression';
    default:
      return null;
  }
}
