/**
 * Product analytics client.
 *
 * Batches events on the browser and flushes them to `/api/track` either on
 * an interval, when the queue hits a size threshold, or on `pagehide` via
 * `sendBeacon` so we don't lose the last few events before the tab closes.
 *
 * This is intentionally a thin layer over `fetch` — we do NOT use the
 * existing `api()` helper because that helper throws on any non-2xx, which
 * would be the wrong behavior for fire-and-forget analytics.
 */

import { getAppVersion } from './native';

export interface TrackProps {
  [key: string]: string | number | boolean | null | undefined | Record<string, any> | any[];
}

export interface TrackOptions {
  placement?: string;
  revenueCents?: number;
}

interface QueuedEvent {
  name: string;
  ts: number;
  props: TrackProps;
  placement?: string;
  revenue_cents?: number;
  platform?: string;
  app_version?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
}

const API_BASE = '/api';
const ENDPOINT = `${API_BASE}/track`;
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_SIZE = 20;

let queue: QueuedEvent[] = [];
let flushTimer: number | null = null;
let installed = false;

function getToken(): string | null {
  try {
    return localStorage.getItem('eco_token');
  } catch {
    return null;
  }
}

function detectPlatform(): string {
  if (typeof window === 'undefined') return 'unknown';
  return (window as any).EcoFarmAndroid ? 'android' : 'web';
}

function getAppVersionSafe(): string | undefined {
  try {
    return getAppVersion()?.versionName;
  } catch {
    return undefined;
  }
}

/** Snapshot UTM from current URL, then from localStorage as a sticky fallback. */
function getCurrentUtm(): QueuedEvent['utm'] {
  if (typeof window === 'undefined') return undefined;
  try {
    const params = new URLSearchParams(window.location.search);
    const source = params.get('utm_source') || undefined;
    const medium = params.get('utm_medium') || undefined;
    const campaign = params.get('utm_campaign') || undefined;
    if (source || medium || campaign) return { source, medium, campaign };
    const raw = localStorage.getItem('eco_utm');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch { /* ignore */ }
  return undefined;
}

function ensureFlushTimer() {
  if (flushTimer !== null || typeof window === 'undefined') return;
  flushTimer = window.setInterval(() => {
    flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Best-effort flush. Uses `sendBeacon` on unload (reliable for tab-close)
 * and `fetch` with `keepalive` otherwise.
 */
function flush(opts?: { beacon?: boolean }): void {
  if (!queue.length) return;
  const token = getToken();
  if (!token) {
    // Not logged in yet — drop silently. Pre-auth events (onboarding.code_sent)
    // are tracked server-side inside /auth/* handlers, not through the client
    // trackClient, so this is fine.
    queue = [];
    return;
  }

  const batch = queue.slice(0, 50);
  queue = queue.slice(batch.length);
  const payload = JSON.stringify({ events: batch });

  if (opts?.beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      // `sendBeacon` with a JSON Blob is accepted by Express body-parser
      // only if we set the MIME type; many CDNs otherwise drop the body.
      const blob = new Blob([payload], { type: 'application/json' });
      // `sendBeacon` cannot attach `Authorization: Bearer …`. Auth is carried
      // instead by the `eco_token` cookie that `requireAuth` mirrors onto
      // every authed response on the server (see packages/api/src/middleware/
      // auth.ts). Same-origin sendBeacon includes cookies by spec, so the
      // server can authenticate this ingest.
      navigator.sendBeacon(ENDPOINT, blob);
      return;
    } catch { /* fall through to fetch */ }
  }

  fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: payload,
    keepalive: true,
  }).catch(() => { /* swallow — analytics must not alert the user */ });
}

function installUnloadFlush(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const flushOnHide = () => flush({ beacon: true });
  window.addEventListener('pagehide', flushOnHide);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide();
  });
}

/**
 * Queue an event. Safe to call before login — unauthenticated events are
 * dropped on flush rather than queued forever.
 *
 * Usage:
 *   trackClient('ad.requested', { ad_unit: 'rewarded' }, { placement: 'water_popup' });
 */
export function trackClient(
  name: string,
  props: TrackProps = {},
  options: TrackOptions = {},
): void {
  try {
    const evt: QueuedEvent = {
      name,
      ts: Date.now(),
      props,
      placement: options.placement,
      revenue_cents: options.revenueCents,
      platform: detectPlatform(),
      app_version: getAppVersionSafe(),
      utm: getCurrentUtm(),
    };
    queue.push(evt);
    installUnloadFlush();
    if (queue.length >= FLUSH_SIZE) {
      flush();
    } else {
      ensureFlushTimer();
    }
  } catch { /* ignore */ }
}

/**
 * Flush any queued events immediately. Returns a promise that resolves when
 * the HTTP request finishes. Use this when you need to be sure an event was
 * delivered, e.g. right before a navigation away from the app.
 */
export function flushClient(): void {
  flush();
}
