/**
 * Marketing-event helpers — a thin façade over `logAfEvent` (and friends)
 * with built-in idempotency latches for events that must fire AT MOST
 * ONCE per user.
 *
 * WHY a separate module: AppsFlyer (and Meta SDK) do NOT dedupe by event
 * name on their side — calling `logEvent('af_first_water')` ten times
 * results in ten dashboard rows. For events whose semantic is "the
 * first time the user did X", we have to enforce one-shot ourselves.
 *
 * The latches use localStorage with a key prefix `af_latch:` so they're
 * easy to inspect / reset during QA. They are scoped per device (not
 * per user) — that's intentional: AppsFlyer attribution is tied to
 * the install, so "first water on this device" is the right granularity
 * for campaign optimisation. If a user reinstalls the app we do want
 * AF to see the registration + first-water cycle again, because that
 * really is a fresh attributed install.
 *
 * EVENT NAMING & PARAMETERS: see `apps/web/src/lib/native.ts` →
 * `AfEventName` for the canonical list. AF reserved param names:
 *   • af_revenue   (number)
 *   • af_currency  (ISO 4217 string, default USD on AF side)
 *   • af_quantity  (number)
 * Use them for revenue-bearing events to land in ROAS columns.
 */

import { logAfEvent } from './native';

const LATCH_PREFIX = 'af_latch:';

/**
 * One-shot guard. Returns `true` only on the FIRST call for a given key,
 * and false thereafter. Failing localStorage (private mode, quota) is
 * treated as "fire anyway" — a duplicated dashboard event is a much
 * milder failure than a missing first-occurrence event.
 */
function takeLatch(key: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    const k = LATCH_PREFIX + key;
    if (localStorage.getItem(k)) return false;
    localStorage.setItem(k, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

/** Read-only check for whether a one-shot has already fired. */
function isLatched(key: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return Boolean(localStorage.getItem(LATCH_PREFIX + key));
  } catch {
    return false;
  }
}

/**
 * Fires `af_first_water` exactly once per install. Call this from the
 * water mutation's onSuccess.
 *
 * Why first water and not "every water": AppsFlyer charges per-event
 * on paid tiers. Bombarding the SDK with one event per pour adds zero
 * optimisation signal to Meta (Meta already ranks engagement via
 * af_app_open frequency) and inflates the bill at scale.
 */
export function reportFirstWater(): void {
  if (!takeLatch('first_water')) return;
  logAfEvent('af_first_water');
  // Pair with engaged-d0 evaluation while we have a fresh signal.
  maybeReportEngagedD0();
}

/**
 * Fires `af_bucket_collected` every time the server confirms a bucket
 * payout. Not one-shot — the bucket is a recurring engagement signal
 * (multiple per session) and AF's level-1 frequency analytics rely on
 * repeat events to compute "active days" cohorts.
 *
 * `via` distinguishes free collects from ad-gated ones, so ROAS reports
 * can isolate ad-incentivised engagement from organic.
 */
export function reportBucketCollected(via: 'free' | 'ad'): void {
  logAfEvent('af_bucket_collected', { via });
}

/**
 * Fires `af_ad_watched_rewarded` for every server-confirmed rewarded-ad
 * grant. Not latched — repeat ad-watching IS the engagement signal and
 * Meta optimises on frequency. `placement` (water_popup / fert_popup /
 * bucket / quest) lets the AF dashboard slice campaign performance by
 * which ad-slot pulled the user.
 *
 * `attempt_id` is the per-click correlation id we generate in the
 * rewarded-ad hook so every analytics layer (server events table,
 * native LevelPlay listener, AF) can join on the same identifier.
 */
export function reportAdWatchedRewarded(params: {
  placement: string;
  attemptId?: string | null;
  rewardType?: 'water' | 'nutrition' | 'bucket';
  amount?: number;
}): void {
  logAfEvent('af_ad_watched_rewarded', {
    placement: params.placement,
    ...(params.attemptId ? { attempt_id: params.attemptId } : {}),
    ...(params.rewardType ? { reward_type: params.rewardType } : {}),
    ...(typeof params.amount === 'number' ? { amount: params.amount } : {}),
  });
  // Mark the "first rewarded ad watched" milestone — this is one of
  // the two halves of the EngagedD0 composite signal (the other is
  // `first_water` set by reportFirstWater). takeLatch is idempotent
  // so subsequent ad-watches no-op cheaply.
  takeLatch('first_ad_watched');
  maybeReportEngagedD0();
}

/**
 * EngagedD0 is our canonical "quality install" signal: registered AND
 * watered AND watched a rewarded ad within 24h of install. The server
 * tracks the same flag for CAPI dispatch (see packages/api/src/lib/
 * engagedD0.ts), but we mirror it client-side specifically for AF
 * because:
 *   1. AF doesn't see our internal events table; it only sees what we
 *      explicitly log via the SDK.
 *   2. The signal needs to be real-time for Meta optimisation — server
 *      polling adds 30-60s of lag that Meta's auction-bidding cares
 *      about during the learning phase.
 *
 * Detection: latch fires once both `first_water` and `first_ad_watched`
 * latches have been claimed, regardless of order. We don't enforce the
 * 24h window on the client because:
 *   • The user can't physically register, water, watch an ad AND not
 *     fire it within 24h on the same device (the actions are bound
 *     to active session).
 *   • If they did somehow drag it across days, the engagement is
 *     genuine and we want AF to see it.
 */
function maybeReportEngagedD0(): void {
  if (isLatched('engaged_d0')) return;
  if (!isLatched('first_water')) return;
  if (!isLatched('first_ad_watched')) return;
  if (!takeLatch('engaged_d0')) return;
  logAfEvent('af_engaged_d0');
}

/**
 * Fires `af_offer_completed` when the offerwall partner credits a
 * reward (Adsempire postback → notification → user opens app). The
 * server dispatches this via the notifications stream, which we tap
 * client-side once per notification id (latch keyed by notification id).
 *
 * Reserved param names are used so AF dashboards aggregate revenue:
 *   • af_revenue   — payout in USD (number)
 *   • af_currency  — always "USD" for our setup
 *
 * `offer_id` is custom (non-reserved) and gets surfaced in dashboard
 * breakdowns for per-offer ROI analysis.
 */
export function reportOfferCompleted(params: {
  notificationId: string | number;
  offerId: string | number;
  revenueUsd: number;
}): void {
  const key = `offer_done:${params.notificationId}`;
  if (!takeLatch(key)) return;
  logAfEvent('af_offer_completed', {
    af_revenue: Number(params.revenueUsd) || 0,
    af_currency: 'USD',
    offer_id: String(params.offerId),
  });
}

/**
 * Fires `af_withdrawal_initiated` the moment a user submits a payout
 * request. This is our gold-standard quality signal: only users who
 * earned enough genuine value request withdrawal, and they almost
 * always retain at D7+. Not latched — multiple withdrawals across
 * months ARE legitimate repeat behavior we want to optimise toward.
 *
 * `amount` is in USD. AF doesn't auto-aggregate it (we'd need af_revenue
 * for that), but we keep it as a custom field so dashboards can show
 * average withdrawal size by campaign.
 */
export function reportWithdrawalInitiated(params: {
  amount: number;
  method: string;
}): void {
  logAfEvent('af_withdrawal_initiated', {
    amount: Number(params.amount) || 0,
    method: String(params.method || 'unknown'),
  });
}

/**
 * Fires `af_level_achieved` when the active pet (or plant) reaches a
 * new growth stage. Latched per-level so we don't re-fire if the user
 * happens to revisit a save state via mid-stage harvest interaction —
 * AF's level analytics are designed for "highest level reached" so
 * dashboards interpret repeat fires as cheating heuristics noise.
 */
export function reportLevelAchieved(level: number): void {
  if (!Number.isFinite(level) || level <= 0) return;
  const key = `level:${Math.floor(level)}`;
  if (!takeLatch(key)) return;
  logAfEvent('af_level_achieved', { af_level: Math.floor(level) });
}

/**
 * Fires `af_invite` when a user shares a referral link. Latched per
 * surface (session-popup vs profile-share vs settings-share) to capture
 * "user invited from where" without spam. AppsFlyer's predefined invite
 * event auto-maps to Meta's `Invite` standard event for lookalike
 * targeting against high-virality cohorts.
 */
export function reportInvite(params: { source: string; method: 'copy' | 'native' }): void {
  // Latch by surface so the same user clicking "Share to friends" twice
  // in the same popup doesn't double-count, but inviting from two
  // different popups is allowed (genuine separate intents).
  const key = `invite:${params.source}:${params.method}`;
  if (!takeLatch(key)) return;
  logAfEvent('af_invite', {
    af_description: params.source,
    method: params.method,
  });
}
