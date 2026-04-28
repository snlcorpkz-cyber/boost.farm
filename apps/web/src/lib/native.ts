/**
 * Typed wrapper around the EcoFarmAndroid JS bridge.
 * All methods are safe to call on web — they no-op or return sensible defaults.
 */

type AndroidBridge = {
  getFcmToken?: () => string;
  requestRewardedAd?: (json: string) => void;
  requestOfferwall?: (json: string) => void;
  openExternalUrl?: (url: string) => void;
  getAppVersion?: () => string;
  reload?: () => void;
  clearCache?: () => void;
  vibrate?: (ms: number) => void;
  getInstallReferrer?: () => string;
  consumeInstallReferrer?: () => void;
  /** Generic analytics event forwarder (bridge API v5+). */
  track?: (name: string, propsJson: string) => void;
  /** AppsFlyer in-app event logger (bridge API v9+). */
  logAfEvent?: (name: string, paramsJson: string) => void;
  /** AppsFlyer customer-user-id setter (bridge API v9+). */
  setAfCustomerUserId?: (userId: string) => void;
  /** AppsFlyer Unique ID accessor (bridge API v9+). */
  getAppsFlyerId?: () => string;
  /** AppsFlyer cached conversion-data accessor (bridge API v11+). */
  getAfAttribution?: () => string;
  /** AppsFlyer OneLink deep-link payload accessor (bridge API v11+). */
  getAfDeepLink?: () => string;
  /** Drops the cached deep link after the web layer has navigated (v11+). */
  consumeAfDeepLink?: () => void;
};

function bridge(): AndroidBridge | null {
  if (typeof window === 'undefined') return null;
  return ((window as any).EcoFarmAndroid as AndroidBridge) || null;
}

export function isAndroid(): boolean {
  return bridge() !== null;
}

export type AppVersion = {
  versionName: string;
  versionCode: number;
  packageName: string;
  platform: 'android';
  sdkInt: number;
  bridgeApi: number;
};

export function getAppVersion(): AppVersion | null {
  const b = bridge();
  if (!b?.getAppVersion) return null;
  try {
    return JSON.parse(b.getAppVersion()) as AppVersion;
  } catch {
    return null;
  }
}

/** Bridge API version the native app ships with. 0 if native or feature missing. */
export function bridgeApiVersion(): number {
  return getAppVersion()?.bridgeApi ?? 0;
}

/** Hard reload WebView from server (soft update after hot-deploy). Web fallback: location.reload(). */
export function reloadApp(): void {
  const b = bridge();
  if (b?.reload) {
    b.reload();
    return;
  }
  if (typeof window !== 'undefined') window.location.reload();
}

/** Clear WebView cache & history and reload. Web fallback: hard reload. */
export function clearCacheAndReload(): void {
  const b = bridge();
  if (b?.clearCache) {
    b.clearCache();
    return;
  }
  if (typeof window !== 'undefined') window.location.reload();
}

/** Haptic feedback. No-op on web. Clamped to 0..2000 ms on native. */
export function vibrate(ms: number): void {
  const b = bridge();
  if (b?.vibrate) {
    try {
      b.vibrate(Math.max(0, Math.min(2000, Math.round(ms))));
    } catch {
      // ignore
    }
    return;
  }
  // Web Vibration API fallback (desktop browsers ignore it)
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      (navigator as any).vibrate(Math.max(0, Math.min(2000, Math.round(ms))));
    } catch {
      // ignore
    }
  }
}

// ────────────────────────────────────────────────────────────
// Premium haptic design (Duolingo / iOS-native feel)
//
// The philosophy: haptics are *salt*, not gravy. They amplify moments
// that matter, and the second you abuse them they stop feeling premium
// and start feeling cheap — so every style below is deliberately
// quiet. The loudest pulse (`error`) is ~80ms; the most common one
// (`tap`) is 8ms which most users perceive as "responsive click"
// rather than "phone shaking".
//
// Style semantics:
//   tap       — the pedestrian tap on a UI control. Tab switch,
//               open popup, close modal. "Nothing happened yet,
//               I just acknowledged your tap."
//   select    — even lighter than `tap` — for repeated ticks like
//               batch selector rows, pet carousel dots, language row.
//               Use when the user is *choosing between options*.
//   impact    — a physical commit. Pouring water, collecting bucket,
//               claiming a reward button. User just caused state to
//               change; confirm it like a ka-chunk.
//   success   — gentle victory: reward toast appears, challenge
//               claimed, friend greeted. One short satisfying bump.
//   warning   — soft two-beat used for "hey, can't do that" cases
//               like "bucket needs an ad" (the shake animation).
//   error     — single firmer bump for mutation failures, ad load
//               errors, network timeouts. Not panic-level, but
//               clearly distinct from success.
//   celebrate — the "champagne" moment: success pulse, short pause,
//               then a firmer impact. Reserved for stage-up, harvest
//               complete, offer reward credited. Fires at most once
//               per ~2s (enforced by a cheap throttle below) so that
//               a burst of notifications doesn't turn the phone
//               into a tuning fork.
//
// Dispatch order per call:
//   1. Telegram WebApp (works inside TG Mini App on both Android + iOS,
//      uses the OS's native Taptic Engine / Android vibrator)
//   2. iOS WKWebView bridge (when we ship iOS; already named so the
//      Swift side just needs to add a `vibrate` message handler)
//   3. Android bridge (already live — FarmJsBridge.vibrate)
//   4. Web Vibration API fallback (Android Chrome only; iOS Safari
//      ignores it — known WebKit limitation)
// ────────────────────────────────────────────────────────────

export type HapticStyle =
  | 'tap'
  | 'select'
  | 'impact'
  | 'success'
  | 'warning'
  | 'error'
  | 'celebrate';

/**
 * Fallback durations for channels that only accept a ms value
 * (Android bridge + Web Vibration API). `celebrate` and `warning`
 * are handled as multi-step patterns inside `haptic()`.
 */
const DURATION_MS: Record<Exclude<HapticStyle, 'celebrate' | 'warning'>, number> = {
  tap: 8,
  select: 5,
  impact: 22,
  success: 18,
  error: 70,
};

/**
 * Maps our semantic style to Telegram WebApp HapticFeedback. Telegram
 * has three flavors: impactOccurred (physical), notificationOccurred
 * (semantic outcome), and selectionChanged (discrete selection).
 */
type TgHaptic = {
  impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred?: (style: 'error' | 'success' | 'warning') => void;
  selectionChanged?: () => void;
};

function tgHaptic(): TgHaptic | null {
  if (typeof window === 'undefined') return null;
  const h = (window as any).Telegram?.WebApp?.HapticFeedback as TgHaptic | undefined;
  return h && (h.impactOccurred || h.notificationOccurred || h.selectionChanged) ? h : null;
}

type IosBridge = { postMessage?: (body: unknown) => void };

function iosHapticBridge(): IosBridge | null {
  if (typeof window === 'undefined') return null;
  const h = (window as any).webkit?.messageHandlers?.vibrate as IosBridge | undefined;
  return h?.postMessage ? h : null;
}

// Cheap throttle to prevent celebration spam (e.g. two simultaneous
// reward toasts should feel like one moment, not a seizure).
let lastCelebrateAt = 0;
let lastHapticAt = 0;
const HAPTIC_MIN_GAP_MS = 30; // coalesce identical rapid-fire calls

function dispatchSingle(style: Exclude<HapticStyle, 'celebrate' | 'warning'>): void {
  // 1) Telegram Mini App
  const tg = tgHaptic();
  if (tg) {
    try {
      if (style === 'success' || style === 'error') {
        tg.notificationOccurred?.(style);
      } else if (style === 'select') {
        tg.selectionChanged?.();
      } else if (style === 'tap') {
        tg.impactOccurred?.('light');
      } else if (style === 'impact') {
        tg.impactOccurred?.('medium');
      }
      return;
    } catch { /* fall through */ }
  }

  // 2) iOS WKWebView bridge (ready for when we ship iOS)
  const ios = iosHapticBridge();
  if (ios) {
    try {
      ios.postMessage!(style);
      return;
    } catch { /* fall through */ }
  }

  // 3) Android bridge + 4) Web Vibration API (handled inside `vibrate`)
  vibrate(DURATION_MS[style]);
}

/**
 * Fire a semantic haptic. Safe on every platform — silently no-ops
 * where hardware/API is missing (desktop, iOS Safari without bridge,
 * devices with vibrator disabled).
 */
export function haptic(style: HapticStyle): void {
  const now = Date.now();

  if (style === 'celebrate') {
    // One celebration per ~1.5s regardless of how many toasts collide.
    if (now - lastCelebrateAt < 1500) return;
    lastCelebrateAt = now;
    lastHapticAt = now;
    dispatchSingle('success');
    // Short gap between pulses reads as one combined "pop" rather than
    // two distinct taps — this is the specific rhythm that feels
    // "celebratory" vs "malfunction".
    setTimeout(() => dispatchSingle('impact'), 130);
    return;
  }

  if (style === 'warning') {
    if (now - lastHapticAt < HAPTIC_MIN_GAP_MS) return;
    lastHapticAt = now;
    // Telegram has a dedicated 'warning' notification — use it when
    // available, otherwise synthesize a soft two-beat.
    const tg = tgHaptic();
    if (tg?.notificationOccurred) {
      try { tg.notificationOccurred('warning'); return; } catch { /* fall through */ }
    }
    dispatchSingle('tap');
    setTimeout(() => dispatchSingle('tap'), 90);
    return;
  }

  // Coalesce identical calls that can fire inside the same tick
  // (e.g. React StrictMode double-invokes in dev, or two onClicks on
  // nested buttons). 30ms is well under human perception.
  if (now - lastHapticAt < HAPTIC_MIN_GAP_MS) return;
  lastHapticAt = now;
  dispatchSingle(style);
}

/**
 * Legacy duration-based API. Kept for backwards compatibility with any
 * code still calling `haptics.light()`. New call sites should use
 * `haptic('tap')` etc. directly — the semantic names survive platform
 * differences and map to OS-native taptic engines where possible.
 */
export const haptics = {
  light: () => haptic('tap'),
  medium: () => haptic('impact'),
  heavy: () => haptic('impact'),
  success: () => haptic('success'),
  error: () => haptic('error'),
};

// ────────────────────────────────────────────────────────────
// AppsFlyer (MMP) — primary attribution + event-routing path.
//
// WHY APPSFLYER, not direct CAPI: AppsFlyer holds partner-level
// integrations with Meta / Google / TikTok / Unity Ads / ironSource
// (already in our stack). One SDK + one event taxonomy = all networks
// receive the postbacks they need to optimise our campaigns. We keep
// the FB SDK + server CAPI worker alive in parallel as redundant
// signal carriers — but AppsFlyer is the system of record.
//
// EVENT NAMING:
//   • Predefined `af_*` events (af_complete_registration,
//     af_tutorial_completion, af_level_achieved, af_purchase, af_invite)
//     map automatically to standard partner events on the network side.
//     Always prefer them when an equivalent semantic exists.
//   • Custom `af_*` events (af_engaged_d0, af_offer_completed,
//     af_withdrawal_initiated, af_bucket_collected, af_first_water,
//     af_ad_watched_rewarded) are configured once in the AppsFlyer
//     dashboard, then surfaced to partners that explicitly map them.
//
// RESERVED PARAM NAMES (aggregated specially in AF dashboards):
//   • af_revenue   (number) → ROAS / revenue columns
//   • af_currency  (string, ISO 4217) → defaults to USD if omitted
//   • af_quantity  (number)
// Use them for revenue-bearing events (af_purchase, af_offer_completed).
// ────────────────────────────────────────────────────────────

/**
 * Strict allow-list of AppsFlyer event names we emit. Keeps callers
 * honest: a typo in `af_engaged_d0` becomes a TypeScript error instead
 * of a silently-misfiring event you only catch when looking at empty
 * dashboard columns weeks later.
 */
export type AfEventName =
  // Predefined AF events (auto-mapped to partner standards):
  | 'af_complete_registration'
  | 'af_tutorial_completion'
  | 'af_level_achieved'
  | 'af_invite'
  | 'af_purchase'
  // Custom BoostFarm events (configured in AF dashboard):
  | 'af_first_water'
  | 'af_bucket_collected'
  | 'af_ad_watched_rewarded'
  | 'af_offer_completed'
  | 'af_engaged_d0'
  | 'af_withdrawal_initiated'
  // Stage-specific funnel events. These exist on top of the
  // aggregate `af_level_achieved` so Meta / agency partners can
  // optimise on a SPECIFIC depth of progression, not just "any
  // level". The aggregate alone collapses to a single column in
  // Meta's UI; the per-stage events get their own conversion
  // counts and ML-training signal. Stages 1 is implicit (the
  // user starts there at install) — we only emit 2..6.
  | 'af_stage_2_reached'
  | 'af_stage_3_reached'
  | 'af_stage_4_reached'
  | 'af_stage_5_reached'
  | 'af_stage_6_reached'
  // Harvest funnel — the gold-standard deep conversion signal
  // an agency would optimise on. `af_harvest_completed` fires
  // on every harvest; `af_harvest_x3` fires once per user when
  // they cross 3 harvests (loyalty / repeat-LTV cohort).
  | 'af_harvest_completed'
  | 'af_harvest_x3'
  // Retention milestones, server-emitted via cron from the
  // appsflyer S2S worker. The web-side type listing them keeps
  // the s2s mapping table type-safe even though the web layer
  // does NOT call them directly.
  | 'af_d1_return'
  | 'af_d3_return'
  | 'af_d7_return';

/**
 * AppsFlyer accepts string / number / boolean parameter values. Anything
 * else (objects, arrays, null) is silently dropped on the native side,
 * so we encode the limit in the type.
 */
export type AfEventParams = Record<string, string | number | boolean>;

/**
 * Fire an in-app event through the AppsFlyer SDK. No-op on web, older
 * bridges (< v9), and whenever the native side swallows an exception.
 *
 * Idempotency: AppsFlyer does NOT dedupe by name — calling this twice
 * fires two events. Caller is responsible for one-shot semantics where
 * relevant (e.g. `af_first_water`, `af_engaged_d0`). We use localStorage
 * latches in the call sites to enforce that.
 */
export function logAfEvent(name: AfEventName, params: AfEventParams = {}): void {
  const b = bridge();
  if (!b?.logAfEvent) return;
  try {
    b.logAfEvent(name, JSON.stringify(params));
  } catch {
    // Marketing SDK failures must never reach product code.
  }
}

/**
 * Stamps the AppsFlyer device with the logged-in user's id so events
 * generated on a second device for the same account get correctly
 * tied back to the original install. Safe to call repeatedly — AF
 * de-dupes on identical values.
 */
export function setAfCustomerUserId(userId: string): void {
  const b = bridge();
  if (!b?.setAfCustomerUserId) return;
  try {
    b.setAfCustomerUserId(userId);
  } catch {
    /* ignore */
  }
}

/**
 * Returns the AppsFlyer Unique ID for this install, or null on web /
 * older native bridges. Sent to the server during /verify-code so the
 * `users` table can join AF attribution data without re-querying their
 * API later.
 */
export function getAppsFlyerId(): string | null {
  const b = bridge();
  if (!b?.getAppsFlyerId) return null;
  try {
    const id = b.getAppsFlyerId();
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Cached AppsFlyer conversion-data shape. Mirrors the keys AF returns
 * in `onConversionDataSuccess` — see https://support.appsflyer.com/.
 *
 * Each field is optional because:
 *   • Organic installs only carry `media_source: "organic"`.
 *   • The callback fires async after install (~1-3s) and may not have
 *     completed by the time we read the cache on the very first
 *     /verify-code. Callers must tolerate `null`.
 *   • Older campaigns / view-through paths populate only a subset of
 *     campaign / adset / ad — never assume the full hierarchy is set.
 */
export interface AfAttribution {
  af_status?: string;          // "Non-organic" | "Organic"
  media_source?: string;       // "Facebook Ads" | "googleadwords_int" | …
  campaign?: string;
  campaign_id?: string;
  adset?: string;
  adset_id?: string;
  ad?: string;
  ad_id?: string;
  af_attribution_id?: string;
  is_first_launch?: boolean;
  install_time?: string;
  click_time?: string;
  // Free-form passthrough for any extra keys the SDK includes.
  [key: string]: string | number | boolean | undefined;
}

/** Returns cached AppsFlyer attribution payload, or null on web / pre-v11 bridge. */
export function getAfAttribution(): AfAttribution | null {
  const b = bridge();
  if (!b?.getAfAttribution) return null;
  try {
    const raw = b.getAfAttribution();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AfAttribution;
    return parsed && Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * AppsFlyer OneLink deep-link payload shape. `deep_link_value` is the
 * canonical campaign-set route (e.g. "offer/123" or "withdrawals").
 * `deep_link_sub1..N` are arbitrary string params surfaced from the
 * Meta retargeting URL.
 *
 * `isDeferred` is true ONLY on the very first install from a OneLink
 * ad — useful for distinguishing fresh acquisition retargeting from
 * "user already has the app, just bring them back" flows.
 */
export interface AfDeepLink {
  deepLinkValue?: string;
  isDeferred?: boolean;
  deep_link_value?: string;
  [key: string]: string | number | boolean | undefined;
}

/** Reads the cached OneLink deep-link payload, or null on web / pre-v11 bridge. */
export function getAfDeepLink(): AfDeepLink | null {
  const b = bridge();
  if (!b?.getAfDeepLink) return null;
  try {
    const raw = b.getAfDeepLink();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AfDeepLink;
    return parsed && Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Tells native side to drop the cached deep link after we've navigated. */
export function consumeAfDeepLink(): void {
  const b = bridge();
  try { b?.consumeAfDeepLink?.(); } catch { /* ignore */ }
}

/**
 * Subscribe to LIVE OneLink deep-link events (user taps a retargeting
 * ad while the app is already open). The native side dispatches a
 * `af-deep-link` CustomEvent on `window` with the payload as `detail`.
 *
 * Returns an unsubscribe function. Safe on web — listener never fires.
 */
export function subscribeAfDeepLink(handler: (link: AfDeepLink) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    try {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      handler(typeof detail === 'string' ? JSON.parse(detail) : detail);
    } catch { /* ignore */ }
  };
  window.addEventListener('af-deep-link', listener as EventListener);
  return () => window.removeEventListener('af-deep-link', listener as EventListener);
}

// ────────────────────────────────────────────────────────────
// Google Play Install Referrer (bridge API v4+).
// Captures the `ref` code passed via a Play Store referral link so a fresh
// install is attributed to the inviter without manual code entry.
// ────────────────────────────────────────────────────────────

export interface InstallReferrer {
  refCode?: string;
  raw?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /**
   * Creative identifier set via Meta Ads Manager `{{ad.name}}` macro.
   * Used in admin acquisition reports to break down performance by
   * creative independently of what Meta attributes internally.
   */
  utmContent?: string;
  /** Meta {{ad.id}} — set on Play Store ad URL, captured on install. */
  fbAdId?: string;
  /** Meta {{adset.id}}. */
  fbAdsetId?: string;
  /** Meta {{campaign.id}}. */
  fbCampaignId?: string;
  clickTs?: number;
  installTs?: number;
  processed?: boolean;
}

/** Reads the Play Install Referrer from the native side. Null on web / old bridge. */
export function getInstallReferrer(): InstallReferrer | null {
  const b = bridge();
  if (!b?.getInstallReferrer) return null;
  try {
    const raw = b.getInstallReferrer();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InstallReferrer;
    return parsed && Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Tells native side to clear the stored referrer after the server applied it. */
export function consumeInstallReferrer(): void {
  const b = bridge();
  try { b?.consumeInstallReferrer?.(); } catch { /* ignore */ }
}

// ────────────────────────────────────────────────────────────
// H-2: requestId-based routing of rewarded / offerwall callbacks.
// Older bridges (API < 3) don't send requestId — we still support them
// via a "last-callback-wins" fallback for backwards compatibility.
// ────────────────────────────────────────────────────────────

/**
 * Reason the native side returns when `success === false`. Used by the web
 * layer to decide between:
 *   - offering a fallback flow (MockAdModal) when the SDK couldn't serve an
 *     ad through no fault of the user — e.g. the ironSource account is still
 *     under review, the device is offline, or there is simply no fill right
 *     now (`unavailable` / `show_failed` / `timeout`);
 *   - silently skipping the reward when the user saw a real ad slot and
 *     deliberately closed it before the reward event fired
 *     (`closed_unrewarded`);
 *   - surfacing a generic retry toast when another rewarded ad is already
 *     in flight in the same process (`concurrent`).
 */
export type RewardedFailureReason =
  | 'unavailable'
  | 'show_failed'
  | 'closed_unrewarded'
  | 'concurrent'
  | 'timeout';

export interface RewardedAdResult {
  placement: string;
  success: boolean;
  requestId?: string;
  reason?: RewardedFailureReason;
}

/**
 * Returns true when a failed rewarded call should trigger the mock-ad
 * fallback flow (so users aren't blocked when the network has no fill).
 *
 * We also treat a missing `reason` as fallback-eligible whenever the host
 * app is running an **older** native bridge (API < 6) that predates the
 * `reason` field: those builds always sent `success:false` for any failure
 * and we have to assume the worst common case (no fill / SDK not ready).
 * Once every install has updated to bridge API 6+, the `undefined` branch
 * becomes unreachable and the reason check is strict again — which means
 * we automatically stop granting fallback rewards to users who close real
 * ads on purpose (`closed_unrewarded`).
 */
export function isRewardFallbackEligible(reason: RewardedFailureReason | undefined): boolean {
  if (reason === 'unavailable' || reason === 'show_failed' || reason === 'timeout') {
    return true;
  }
  if (reason === undefined && isAndroid() && bridgeApiVersion() < 6) {
    return true;
  }
  return false;
}

type RewardedCallback = (r: RewardedAdResult) => void;

interface NativeCallbackRegistry {
  onRewardedFinished?: (payload: string | RewardedAdResult) => void;
  onOfferwallFinished?: (payload: string | RewardedAdResult) => void;
  /**
   * Granular ad-funnel event pushed from the native LevelPlay listener. The
   * `state` corresponds to the event names used in the server-side event
   * registry: requested | loaded | no_fill | shown | failed | closed |
   * rewarded. `meta` carries placement, error codes, network, etc.
   */
  onAdEvent?: (payload: string | { state: string; meta?: Record<string, any> }) => void;
  __rewardedHandlers?: Map<string, RewardedCallback>;
  __fallbackRewarded?: RewardedCallback;
  __adEventInstalled?: boolean;
}

function registry(): NativeCallbackRegistry {
  if (typeof window === 'undefined') return {};
  const w = window as any;
  return (w.__ecoFarmNative ??= {}) as NativeCallbackRegistry;
}

/**
 * Lazily registers the granular ad-event forwarder. Safe to call multiple
 * times — the flag on `registry()` makes it idempotent.
 *
 * Note: we do a dynamic require via an async import inside the handler so
 * that we never form a static import cycle with `lib/track` (which imports
 * `getAppVersion` from this module).
 */
export function installAdEventForwarder(): void {
  const reg = registry();
  if (reg.__adEventInstalled) return;
  reg.__adEventInstalled = true;
  reg.onAdEvent = (raw) => {
    try {
      const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!payload || typeof payload.state !== 'string') return;
      const state = payload.state.trim();
      const meta = (payload.meta && typeof payload.meta === 'object' ? payload.meta : {}) as Record<string, any>;
      const placement: string | undefined =
        typeof meta.placement === 'string' ? meta.placement : undefined;
      const { placement: _p, ...rest } = meta;

      // ILRD revenue payload arrives in USD — convert to integer cents so
      // the backend can sum it cheaply in SQL (events.revenue_cents is int).
      // We also keep the original USD number under `revenue_usd` in props
      // for debugging/export.
      let options: { placement?: string; revenueCents?: number } | undefined =
        placement ? { placement } : undefined;
      if (state === 'revenue' && typeof rest.revenue === 'number' && Number.isFinite(rest.revenue)) {
        const cents = Math.round(rest.revenue * 100);
        rest.revenue_usd = rest.revenue;
        rest.revenue_cents = cents;
        delete rest.revenue;
        options = { ...(options ?? {}), revenueCents: cents };
      }

      import('./track').then(({ trackClient }) => {
        trackClient(`ad.${state}`, rest, options);
      }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  };
}

function installDispatcher(): void {
  const reg = registry();
  if (reg.__rewardedHandlers) return;
  reg.__rewardedHandlers = new Map();
  installAdEventForwarder();
  reg.onRewardedFinished = (raw) => {
    let payload: RewardedAdResult;
    try {
      payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    const handlers = reg.__rewardedHandlers!;
    if (payload.requestId && handlers.has(payload.requestId)) {
      const cb = handlers.get(payload.requestId)!;
      handlers.delete(payload.requestId);
      cb(payload);
      return;
    }
    // Fallback for legacy bridge (API v2) without requestId: call the most
    // recently-registered handler.
    if (reg.__fallbackRewarded) {
      const cb = reg.__fallbackRewarded;
      reg.__fallbackRewarded = undefined;
      cb(payload);
    }
  };
}

/**
 * Request a rewarded ad from the native bridge with a caller-isolated callback.
 * Returns the requestId used (also cleaned up on timeout).
 *
 * On web (no bridge) returns null — caller should show a fallback popup.
 *
 * `attemptId` is the user-intent correlation id the web layer stamps
 * into every ad.* event (see useRewardedAd / FarmPage.handleBucketAd).
 * Passing it through to the native side lets the Kotlin LevelPlay
 * adapter tag every downstream `ad.shown` / `ad.rewarded` / `ad.closed`
 * with the same id, so the admin funnel can count distinct intents
 * instead of raw emissions.
 */
export function requestRewardedAdNative(
  placement: string,
  onFinished: RewardedCallback,
  opts?: { timeoutMs?: number; attemptId?: string },
): string | null {
  const b = bridge();
  if (!b?.requestRewardedAd) return null;

  installDispatcher();
  const reg = registry();
  const requestId =
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `rq_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  reg.__rewardedHandlers!.set(requestId, onFinished);
  reg.__fallbackRewarded = onFinished; // legacy path

  const timeoutMs = opts?.timeoutMs ?? 5 * 60 * 1000; // safety net
  const timer = window.setTimeout(() => {
    const h = reg.__rewardedHandlers;
    if (h?.has(requestId)) {
      h.delete(requestId);
      // Native side never reported back — treat as fallback-eligible
      // (likely the SDK is stuck or the ad process crashed).
      onFinished({ placement, success: false, requestId, reason: 'timeout' });
    }
  }, timeoutMs);

  try {
    b.requestRewardedAd(
      JSON.stringify({
        placement,
        requestId,
        ...(opts?.attemptId ? { attemptId: opts.attemptId } : {}),
      }),
    );
  } catch {
    window.clearTimeout(timer);
    reg.__rewardedHandlers?.delete(requestId);
    reg.__fallbackRewarded = undefined;
    return null;
  }
  return requestId;
}
