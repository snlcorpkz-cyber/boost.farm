/**
 * Event Registry — single source of truth for product analytics taxonomy.
 *
 * Every event name that can legitimately land in the `events` table should be
 * listed here. The registry is consumed by:
 *   - `/api/track` to validate incoming client events (unknown names are still
 *     accepted but with a lower trust flag so we can spot typos in admin logs).
 *   - `/admin/logs/events/names` fallback when the live table is empty (new env).
 *   - future: admin funnel-builder autocomplete.
 *
 * Rules:
 *   - snake_case, `domain.action`.
 *   - keep `props` descriptive — this is what future-you reads when debugging.
 *   - if a field contains user PII (email, name) do NOT put it in props.
 */

export type EventCategory =
  | 'ads'
  | 'onboarding'
  | 'attribution'
  | 'social'
  | 'economy'
  | 'session'
  | 'quest';

export interface EventSpec {
  name: string;
  category: EventCategory;
  description: string;
  /** Human-readable listing of expected top-level props — informational. */
  props?: string[];
}

export const EVENT_REGISTRY: readonly EventSpec[] = [
  // ── Ads funnel (critical for fill rate / potential views) ───────
  {
    name: 'ad.requested',
    category: 'ads',
    description: 'User tapped "watch ad" — we asked the SDK for a rewarded video.',
    props: ['placement', 'ad_unit', 'platform'],
  },
  {
    name: 'ad.loaded',
    category: 'ads',
    description: 'SDK confirmed an ad is cached and ready to show.',
    props: ['placement', 'ad_unit', 'load_ms', 'network'],
  },
  {
    name: 'ad.no_fill',
    category: 'ads',
    description: 'SDK could not fill the request — no ad available from any network.',
    props: ['placement', 'ad_unit', 'error'],
  },
  {
    name: 'ad.shown',
    category: 'ads',
    description: 'Ad started playing (LevelPlay onAdOpened).',
    props: ['placement', 'ad_unit', 'network'],
  },
  {
    name: 'ad.failed',
    category: 'ads',
    description: 'Ad show failed mid-flight (LevelPlay onAdShowFailed).',
    props: ['placement', 'error_code', 'error_message'],
  },
  {
    name: 'ad.closed',
    category: 'ads',
    description: 'User dismissed the ad UI (with or without reward).',
    props: ['placement', 'watched_ms', 'rewarded'],
  },
  {
    name: 'ad.rewarded',
    category: 'ads',
    description: 'User completed the ad and the SDK granted a reward.',
    props: ['placement', 'reward_name', 'reward_amount'],
  },
  {
    name: 'ad.server_granted',
    category: 'ads',
    description: 'Server successfully credited the reward in response to /farm/ad-reward or collect-bucket.',
    props: ['placement', 'type', 'amount', 'idempotencyKey'],
  },

  // ── Onboarding funnel ───────────────────────────────────────────
  {
    name: 'onboarding.code_sent',
    category: 'onboarding',
    description: 'User requested an email verification code.',
    props: ['has_ref_code'],
  },
  {
    name: 'onboarding.code_verified',
    category: 'onboarding',
    description: 'Email code accepted — user account created or logged in.',
    props: ['has_ref_code', 'is_new'],
  },
  {
    name: 'onboarding.profile_filled',
    category: 'onboarding',
    description: 'User picked nickname/avatar (first write after signup).',
  },
  {
    name: 'onboarding.first_farm_tick',
    category: 'onboarding',
    description: 'First interaction with the farm (water / fertilize / collect).',
    props: ['action'],
  },

  // ── Attribution ─────────────────────────────────────────────────
  {
    name: 'install.referrer_captured',
    category: 'attribution',
    description: 'Android Play Install Referrer was read natively and forwarded.',
    props: ['utmSource', 'utmMedium', 'utmCampaign', 'hasRefCode'],
  },
  {
    name: 'utm.captured',
    category: 'attribution',
    description: 'UTM params captured from the current page URL on first visit.',
    props: ['utm_source', 'utm_medium', 'utm_campaign'],
  },

  // ── Social ──────────────────────────────────────────────────────
  {
    name: 'invite.link_shared',
    category: 'social',
    description: 'Referral link copied / shared from the Invite popup.',
    props: ['method'],
  },

  // ── Economy (informational — bulk of econ events come from middleware) ─
  {
    name: 'econ.offer_clicked',
    category: 'economy',
    description: 'User tapped an offer card.',
    props: ['offer_id', 'placement'],
  },

  // ── Session ─────────────────────────────────────────────────────
  {
    name: 'session.heartbeat',
    category: 'session',
    description: 'Foreground heartbeat ping (extends session duration).',
  },

  // ── Quests ──────────────────────────────────────────────────────
  {
    name: 'quest.ad_watched',
    category: 'quest',
    description: 'User completed the watch-ad quest step.',
    props: ['quest_key'],
  },
] as const;

const byName = new Map(EVENT_REGISTRY.map((e) => [e.name, e] as const));

export function lookupEvent(name: string): EventSpec | undefined {
  return byName.get(name);
}

export function isKnownEvent(name: string): boolean {
  return byName.has(name);
}

/** List of event names grouped by category — used in admin UI dropdowns. */
export function listEventNames(): string[] {
  return EVENT_REGISTRY.map((e) => e.name);
}
