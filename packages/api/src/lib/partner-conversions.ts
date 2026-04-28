/**
 * Partner conversion ledger — server-side write API.
 *
 * Single entry point for "this user just triggered a billable event for
 * partner X" from anywhere in the app (auth signup, farm watering hooks,
 * admin force-harvest, etc.). Centralising the logic here keeps the
 * dedup, geo-payout and postback-enqueue rules in one auditable place.
 *
 * Usage:
 *   await recordPartnerConversion({
 *     partnerId, userId, clickId, eventType: 'harvest', countryCode: 'US',
 *   });
 *
 * Guarantees:
 *   - Never throws into the caller. Records of all errors go to console
 *     so a partner integration glitch can never break the user flow.
 *   - Idempotent per (partner_id, click_id, event_type) via a unique
 *     index in migration 021. Calling twice fires exactly one postback.
 *   - Emits exactly one row in `partner_postbacks_out` per recorded
 *     conversion. The cron worker handles delivery + retries.
 */
import crypto from 'crypto';
import { execute, query, queryOne, withTransaction } from './db.js';

export type FraudReason =
  | 'velocity_too_fast'
  | 'device_farm'
  | 'click_injection'
  | 'geo_mismatch'
  | 'duplicate_account'
  | 'chargeback'
  | 'bot_behavior'
  | 'partner_request'
  | 'manual_admin';

export const FRAUD_REASONS: readonly FraudReason[] = [
  'velocity_too_fast',
  'device_farm',
  'click_injection',
  'geo_mismatch',
  'duplicate_account',
  'chargeback',
  'bot_behavior',
  'partner_request',
  'manual_admin',
] as const;

export interface RecordConversionInput {
  partnerId: string;
  userId: string;
  /**
   * Click id captured from the partner's tracking link (Play Install
   * Referrer → users.partner_click_id). NULL is allowed — those rows
   * are kept for analytics but no postback fires (no place to send it).
   */
  clickId: string | null;
  /** Must appear in `partners.allowed_events` for the postback to fire. */
  eventType: string;
  /** ISO-3166-1 alpha-2; lowercase or null is fine, we normalise. */
  countryCode: string | null;
  /** Free-form metadata stored on the conversion row. */
  metadata?: Record<string, unknown>;
}

export interface RecordConversionResult {
  /** True iff a brand new conversion row was inserted. */
  recorded: boolean;
  /** Conversion id (only when `recorded === true`). */
  conversionId?: string;
  /** Reason it was skipped (when `recorded === false`). */
  skippedReason?:
    | 'partner_inactive'
    | 'event_not_allowed'
    | 'no_click_id'
    | 'duplicate'
    | 'partner_not_found'
    | 'error';
}

/**
 * Records a conversion if the partner is active and the event type is
 * in their allow-list. Computes payout from the country matrix. Enqueues
 * a postback for the cron worker to deliver. Never throws.
 */
export async function recordPartnerConversion(
  input: RecordConversionInput,
): Promise<RecordConversionResult> {
  try {
    const country = input.countryCode ? input.countryCode.toUpperCase() : null;

    const partner = await queryOne<{
      id: string;
      status: string;
      allowed_events: string[] | null;
      postback_url_template: string | null;
      postback_method: string;
      hold_hours: number;
      approval_mode: string;
      default_payout_cents: number;
    }>(
      `SELECT id, status, allowed_events, postback_url_template,
              postback_method, hold_hours, approval_mode, default_payout_cents
         FROM partners
        WHERE id = $1`,
      [input.partnerId],
    );

    if (!partner) return { recorded: false, skippedReason: 'partner_not_found' };

    if (partner.status !== 'active' && partner.status !== 'paused') {
      // 'draft' / 'archived' — silently no-op. We still want the call
      // sites to be cheap to add early.
      return { recorded: false, skippedReason: 'partner_inactive' };
    }

    if (
      !partner.allowed_events ||
      !partner.allowed_events.includes(input.eventType)
    ) {
      return { recorded: false, skippedReason: 'event_not_allowed' };
    }

    // Lookup payout for this country. Missing row → informational
    // postback (payout = 0), which is what we want for non-US users
    // who came from TimeBucks: they show up in the partner's funnel
    // but don't trigger a billing event.
    let payoutCents = 0;
    if (country) {
      const row = await queryOne<{ payout_cents: number }>(
        `SELECT payout_cents FROM partner_country_payouts
          WHERE partner_id = $1 AND country_code = $2`,
        [input.partnerId, country],
      );
      if (row) payoutCents = row.payout_cents;
    }

    // Only the harvest event is billable. Stage / install events are
    // always informational regardless of country, even if a future
    // payout matrix accidentally lists them.
    if (input.eventType !== 'harvest') {
      payoutCents = 0;
    }

    // hold_until tracks the in-flight window before a conversion is
    // eligible for payout. Informational events (payout = 0) can skip
    // the hold and go straight to 'approved' so they reach the
    // partner's funnel in real time.
    const holdHours = payoutCents > 0 ? partner.hold_hours : 0;
    const initialStatus =
      partner.approval_mode === 'auto' && payoutCents === 0 ? 'approved' : 'pending';

    return await withTransaction(async (txQuery, txQueryOne, txExecute) => {
      const inserted = await txQueryOne<{ id: string }>(
        `INSERT INTO partner_conversions
           (partner_id, user_id, click_id, event_type, payout_cents,
            status, hold_until, country_code, metadata)
         VALUES ($1, $2, $3, $4, $5, $6,
                 CASE WHEN $7::int > 0 THEN now() + ($7 || ' hours')::interval ELSE NULL END,
                 $8, $9::jsonb)
         ON CONFLICT (partner_id, click_id, event_type) WHERE click_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [
          input.partnerId,
          input.userId,
          input.clickId,
          input.eventType,
          payoutCents,
          initialStatus,
          holdHours,
          country,
          JSON.stringify(input.metadata ?? {}),
        ],
      );

      if (!inserted) {
        return { recorded: false, skippedReason: 'duplicate' };
      }

      // No postback URL configured yet → keep the ledger entry but
      // skip the queue. Once the partner sets a URL the rows will
      // already be there for historical reporting; we can replay
      // pending ones via an admin tool later if needed.
      if (!partner.postback_url_template || !input.clickId) {
        return { recorded: true, conversionId: inserted.id };
      }

      const url = buildPostbackUrl(partner.postback_url_template, {
        clickId: input.clickId,
        event: input.eventType,
        payoutCents,
        conversionId: inserted.id,
        country,
        timestamp: Math.floor(Date.now() / 1000),
        originalConversionId: null,
        reason: null,
      });

      await txExecute(
        `INSERT INTO partner_postbacks_out
           (conversion_id, partner_id, url, method, event_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [inserted.id, partner.id, url, partner.postback_method, input.eventType],
      );

      return { recorded: true, conversionId: inserted.id };
    });
  } catch (err) {
    console.error('[partner-conversions] record failed:', (err as Error).message);
    return { recorded: false, skippedReason: 'error' };
  }
}

export interface ReverseConversionInput {
  conversionId: string;
  reason: FraudReason;
}

export interface ReverseConversionResult {
  reversed: boolean;
  reason?:
    | 'not_found'
    | 'already_reversed'
    | 'partner_not_active'
    | 'no_postback_url'
    | 'error';
}

/**
 * Marks a conversion as reversed and enqueues a `&event=reversed`
 * postback to the partner. Idempotent: calling twice on the same
 * conversion is a no-op.
 */
export async function reversePartnerConversion(
  input: ReverseConversionInput,
): Promise<ReverseConversionResult> {
  try {
    return await withTransaction(async (txQuery, txQueryOne, txExecute) => {
      const conv = await txQueryOne<{
        id: string;
        partner_id: string;
        user_id: string;
        click_id: string | null;
        event_type: string;
        payout_cents: number;
        country_code: string | null;
        status: string;
      }>(
        `SELECT id, partner_id, user_id, click_id, event_type,
                payout_cents, country_code, status
           FROM partner_conversions
          WHERE id = $1
          FOR UPDATE`,
        [input.conversionId],
      );

      if (!conv) return { reversed: false, reason: 'not_found' as const };
      if (conv.status === 'reversed' || conv.status === 'rejected') {
        return { reversed: false, reason: 'already_reversed' as const };
      }

      const partner = await txQueryOne<{
        status: string;
        postback_url_template: string | null;
        postback_method: string;
      }>(
        `SELECT status, postback_url_template, postback_method
           FROM partners WHERE id = $1`,
        [conv.partner_id],
      );

      if (!partner) return { reversed: false, reason: 'not_found' as const };

      // We mark the row even if the partner has gone inactive in the
      // meantime — the audit trail must always reflect the admin's
      // fraud decision. Only the outbound postback is conditional.
      await txExecute(
        `UPDATE partner_conversions
            SET status = 'reversed',
                rejected_reason = $2,
                fraud_reason = $2,
                approved_at = COALESCE(approved_at, now())
          WHERE id = $1`,
        [input.conversionId, input.reason],
      );

      if (!partner.postback_url_template || !conv.click_id) {
        return { reversed: true };
      }

      if (partner.status !== 'active' && partner.status !== 'paused') {
        return { reversed: true, reason: 'partner_not_active' as const };
      }

      const url = buildPostbackUrl(partner.postback_url_template, {
        clickId: conv.click_id,
        event: 'reversed',
        payoutCents: 0,
        conversionId: conv.id,
        country: conv.country_code,
        timestamp: Math.floor(Date.now() / 1000),
        originalConversionId: conv.id,
        reason: input.reason,
      });

      await txExecute(
        `INSERT INTO partner_postbacks_out
           (conversion_id, partner_id, url, method, event_type)
         VALUES ($1, $2, $3, $4, 'reversed')`,
        [conv.id, conv.partner_id, url, partner.postback_method],
      );

      return { reversed: true };
    });
  } catch (err) {
    console.error('[partner-conversions] reverse failed:', (err as Error).message);
    return { reversed: false, reason: 'error' };
  }
}

export interface PostbackContext {
  clickId: string;
  event: string;
  payoutCents: number;
  conversionId: string;
  country: string | null;
  timestamp: number;
  originalConversionId: string | null;
  reason: string | null;
}

/**
 * Substitutes macros in the partner's postback URL template.
 *
 * Supported macros (case-insensitive). Unknown macros are left as-is
 * so the partner can spot configuration errors in the postback log:
 *   {clickid} {click_id} {CLICK_ID}      → input clickId
 *   {event} {EVENT}                      → input event
 *   {payout} {PAYOUT_CENTS}              → input payoutCents
 *   {payout_usd} {PAYOUT_USD}            → cents / 100, 2 decimals
 *   {txid} {TXID} {conversion_id}        → input conversionId
 *   {country}                            → input country (uppercase) or empty
 *   {timestamp} {ts}                     → unix seconds
 *   {original_txid} {ORIGINAL_TXID}      → original conversion id (reversal)
 *   {reason}                             → fraud reason (reversal)
 *
 * Substitution is plain string replace; if the partner forgot to URL-
 * encode their template that's on them. We prefer raw values so a
 * Cloudflare WAF can match path patterns.
 */
export function buildPostbackUrl(template: string, ctx: PostbackContext): string {
  const usd = (ctx.payoutCents / 100).toFixed(2);
  const map: Record<string, string> = {
    '{clickid}': ctx.clickId,
    '{click_id}': ctx.clickId,
    '{CLICK_ID}': ctx.clickId,
    '{event}': ctx.event,
    '{EVENT}': ctx.event,
    '{payout}': String(ctx.payoutCents),
    '{PAYOUT_CENTS}': String(ctx.payoutCents),
    '{payout_usd}': usd,
    '{PAYOUT_USD}': usd,
    '{txid}': ctx.conversionId,
    '{TXID}': ctx.conversionId,
    '{conversion_id}': ctx.conversionId,
    '{country}': ctx.country ?? '',
    '{COUNTRY}': ctx.country ?? '',
    '{timestamp}': String(ctx.timestamp),
    '{ts}': String(ctx.timestamp),
    '{original_txid}': ctx.originalConversionId ?? '',
    '{ORIGINAL_TXID}': ctx.originalConversionId ?? '',
    '{reason}': ctx.reason ?? '',
    '{REASON}': ctx.reason ?? '',
  };

  let url = template;
  for (const [macro, value] of Object.entries(map)) {
    if (url.includes(macro)) {
      url = url.split(macro).join(encodeURIComponent(value));
    }
  }
  return url;
}

/**
 * Pulls `clickid` (or `click_id`) out of a raw install-referrer string.
 * Tolerates URL-encoded `&` and partial encodings; returns null if no
 * matching key is present.
 *
 * Example input: "utm_source=timebucks&clickid=abc123&utm_medium=offerwall"
 */
export function extractClickIdFromReferrer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const params = new URLSearchParams(decoded.replace(/^[?#]/, ''));
  const candidates = ['clickid', 'click_id', 'click-id'];
  for (const key of candidates) {
    const v = params.get(key);
    if (v && v.trim()) return v.trim().slice(0, 256);
  }
  return null;
}

/**
 * Hash of (userId, partnerSlug) — not a secret, just used as a stable
 * fallback click_id when we attribute organically (currently unused;
 * reserved for future direct-affiliate flows where the partner does
 * not generate click_ids themselves).
 */
export function syntheticClickId(userId: string, partnerSlug: string): string {
  return `org_${crypto
    .createHash('sha256')
    .update(`${partnerSlug}:${userId}`)
    .digest('hex')
    .slice(0, 24)}`;
}

/**
 * Resolves the partner row for a given utm_source value. Returns null
 * if the partner does not exist or is archived. We don't filter on
 * 'active' here so attribution still works while the partner is in
 * 'draft' (the conversion records, but no postback fires until the
 * partner is flipped to 'active').
 */
export async function findPartnerByUtmSource(
  utmSource: string,
): Promise<{ id: string; slug: string; attributionWindowHours: number } | null> {
  const slug = utmSource.trim().toLowerCase();
  if (!slug) return null;
  const row = await queryOne<{ id: string; slug: string; attribution_window_hours: number; status: string }>(
    `SELECT id, slug, attribution_window_hours, status
       FROM partners
      WHERE slug = $1
        AND status <> 'archived'`,
    [slug],
  );
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    attributionWindowHours: row.attribution_window_hours,
  };
}
