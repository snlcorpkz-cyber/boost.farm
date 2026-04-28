/**
 * Partner attribution at signup time.
 *
 * Called from each /auth/* entry point right after we've inserted a new
 * user row. Resolves the install referrer's `utm_source` to a partner,
 * validates the attribution window (default 7 days for TimeBucks), pins
 * `users.partner_id` + `users.partner_click_id`, and records the
 * `install` conversion that the cron worker eventually delivers.
 *
 * Never throws — partner integrations must never block authentication.
 *
 * The attribution itself uses these inputs (in priority order):
 *   1. `acquisition.utmSource` — Play Install Referrer key
 *   2. `acquisition.raw`       — full referrer string, parsed for clickid
 *
 * Click id extraction is a best-effort scan of common parameter names
 * (`clickid`, `click_id`, `click-id`). Partners send us whatever they
 * generate; we just need to round-trip it.
 */
import type { Request } from 'express';
import { execute, queryOne } from './db.js';
import { resolveGeo } from './analytics.js';
import {
  extractClickIdFromReferrer,
  findPartnerByUtmSource,
  recordPartnerConversion,
} from './partner-conversions.js';

export interface AcquisitionInput {
  utmSource?: string | null;
  raw?: string | null;
  clickTs?: number | null;
  installTs?: number | null;
}

/**
 * Attempts to attribute a freshly-registered user to a partner.
 *
 * Safe to call on every signup, including ones with no acquisition
 * data — every branch short-circuits early when the prerequisites
 * aren't met. Cost is one SELECT against `partners` in the worst
 * case for non-partner traffic.
 */
export async function attributePartnerOnSignup(opts: {
  userId: string;
  isNewUser: boolean;
  acquisition: AcquisitionInput | null | undefined;
  req: Request;
}): Promise<void> {
  try {
    if (!opts.isNewUser) return;
    const acq = opts.acquisition;
    if (!acq || !acq.utmSource) return;

    const partner = await findPartnerByUtmSource(acq.utmSource);
    if (!partner) return;

    // Attribution window guard. We use the click timestamp from the
    // install referrer (`acq.clickTs`, milliseconds) when present,
    // otherwise the install timestamp, otherwise we trust the moment
    // of signup (i.e. always within the window). Beyond the window
    // we treat the user as organic.
    const now = Date.now();
    const clickTsMs =
      typeof acq.clickTs === 'number' && acq.clickTs > 0
        ? acq.clickTs
        : typeof acq.installTs === 'number' && acq.installTs > 0
          ? acq.installTs
          : now;
    const ageHours = (now - clickTsMs) / (1000 * 60 * 60);
    if (ageHours > partner.attributionWindowHours) {
      console.log(
        `[partner-attribution] click too old for ${partner.slug}: ${Math.round(ageHours)}h > ${partner.attributionWindowHours}h, treating as organic`,
      );
      return;
    }

    const clickId = extractClickIdFromReferrer(acq.raw);

    await execute(
      `UPDATE users
          SET partner_id            = $2,
              partner_click_id      = $3,
              partner_attributed_at = COALESCE(partner_attributed_at, now())
        WHERE id = $1
          AND partner_id IS NULL`,
      [opts.userId, partner.id, clickId],
    );

    const geo = resolveGeo(opts.req);

    if (geo.country) {
      // Persist country at signup time so /admin/users sees it even
      // before the analytics rollup runs. No-op if column not present
      // (older deploys); we ignore the error in that case.
      await execute(
        `UPDATE users SET country = COALESCE(country, $2) WHERE id = $1`,
        [opts.userId, geo.country],
      ).catch(() => {});
    }

    await recordPartnerConversion({
      partnerId: partner.id,
      userId: opts.userId,
      clickId,
      eventType: 'install',
      countryCode: geo.country ?? null,
      metadata: {
        utm_source: acq.utmSource,
        click_ts: acq.clickTs ?? null,
        install_ts: acq.installTs ?? null,
      },
    });
  } catch (err) {
    console.warn('[partner-attribution] failed:', (err as Error).message);
  }
}

/**
 * Loads partner attribution columns for a user. Used by farm hooks
 * (stage_4 / harvest) to know whether to fire a conversion and which
 * click_id to thread through.
 *
 * Returns `null` when the user is organic or the partner has been
 * archived since attribution.
 */
export async function loadUserPartnerAttribution(userId: string): Promise<{
  partnerId: string;
  partnerSlug: string;
  clickId: string | null;
  country: string | null;
} | null> {
  const row = await queryOne<{
    partner_id: string | null;
    partner_click_id: string | null;
    country: string | null;
    slug: string | null;
    partner_status: string | null;
  }>(
    `SELECT u.partner_id, u.partner_click_id, u.country,
            p.slug, p.status AS partner_status
       FROM users u
  LEFT JOIN partners p ON p.id = u.partner_id
      WHERE u.id = $1`,
    [userId],
  );

  if (!row || !row.partner_id || !row.slug) return null;
  if (row.partner_status === 'archived') return null;

  return {
    partnerId: row.partner_id,
    partnerSlug: row.slug,
    clickId: row.partner_click_id,
    country: row.country,
  };
}
