/**
 * Reporting timezone — single source of truth for "what calendar
 * day did this happen on?" decisions across the analytics surface
 * (retention cohorts, AppsFlyer cost ingest, segment rollups).
 *
 * Why we don't use UTC:
 *   The admin team operates out of Asia/Almaty and compares our
 *   numbers cell-by-cell against Facebook Ads Manager every day.
 *   FB and AppsFlyer both report in the AF account's configured
 *   timezone (Almaty). If our backend bucketed in UTC, a user
 *   registering at 23:00 Almaty (= 18:00 UTC) would land on the
 *   "wrong" date relative to FB and the operator would chase a
 *   ghost discrepancy. Aligning everything to a single business-
 *   facing timezone makes the numbers comparable at a glance.
 *
 * Why we don't hardcode 'Asia/Almaty':
 *   If we ever expand to a market in another region the operator
 *   should be able to flip the reporting TZ without a code change.
 *   Override via REPORTING_TIMEZONE env var (any IANA tz id works:
 *   'Asia/Almaty', 'Europe/Moscow', 'America/New_York', 'UTC', …).
 *
 * Validation:
 *   We trust the env var is a real IANA name. PostgreSQL will
 *   surface an error like `invalid time zone "Foo/Bar"` on the
 *   first query if it isn't, and that's noisy enough that ops
 *   will catch it on deploy.
 */
export const REPORTING_TZ = (process.env.REPORTING_TIMEZONE || 'Asia/Almaty').trim();

/**
 * Convenience wrapper for inline-injecting the TZ into SQL. We
 * use string interpolation (not parameter binding) because PG's
 * parser treats `AT TIME ZONE` as taking a literal name, not a
 * runtime expression. The TZ string is read once at boot from
 * env so there's no user-controlled value reaching this code.
 */
export function tzExpr(column: string): string {
  return `(${column} AT TIME ZONE '${REPORTING_TZ}')`;
}
