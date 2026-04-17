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

export const haptics = {
  light: () => vibrate(10),
  medium: () => vibrate(25),
  heavy: () => vibrate(50),
  success: () => vibrate(15),
  error: () => vibrate(80),
};

// ────────────────────────────────────────────────────────────
// H-2: requestId-based routing of rewarded / offerwall callbacks.
// Older bridges (API < 3) don't send requestId — we still support them
// via a "last-callback-wins" fallback for backwards compatibility.
// ────────────────────────────────────────────────────────────

export interface RewardedAdResult {
  placement: string;
  success: boolean;
  requestId?: string;
}

type RewardedCallback = (r: RewardedAdResult) => void;

interface NativeCallbackRegistry {
  onRewardedFinished?: (payload: string | RewardedAdResult) => void;
  onOfferwallFinished?: (payload: string | RewardedAdResult) => void;
  __rewardedHandlers?: Map<string, RewardedCallback>;
  __fallbackRewarded?: RewardedCallback;
}

function registry(): NativeCallbackRegistry {
  if (typeof window === 'undefined') return {};
  const w = window as any;
  return (w.__ecoFarmNative ??= {}) as NativeCallbackRegistry;
}

function installDispatcher(): void {
  const reg = registry();
  if (reg.__rewardedHandlers) return;
  reg.__rewardedHandlers = new Map();
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
 */
export function requestRewardedAdNative(
  placement: string,
  onFinished: RewardedCallback,
  opts?: { timeoutMs?: number },
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
      onFinished({ placement, success: false, requestId });
    }
  }, timeoutMs);

  try {
    b.requestRewardedAd(JSON.stringify({ placement, requestId }));
  } catch {
    window.clearTimeout(timer);
    reg.__rewardedHandlers?.delete(requestId);
    reg.__fallbackRewarded = undefined;
    return null;
  }
  return requestId;
}
