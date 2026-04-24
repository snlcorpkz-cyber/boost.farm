/**
 * Typed accessor for the Meta / Facebook marketing env vars.
 *
 * Design notes:
 * 1. We DO NOT throw when values are missing. The worker and endpoints
 *    that rely on CAPI short-circuit gracefully so the rest of the API
 *    boots cleanly in dev / CI without a Business Manager account.
 * 2. `isCapiEnabled()` is the single switch every CAPI call-site must
 *    consult before doing HTTP work. A missing value OR an explicit
 *    `META_CAPI_ENABLED=false` both disable the integration — handy
 *    for staging rollouts.
 * 3. Reads are done per-call (not cached) on purpose so env changes
 *    applied through `pm2 restart --update-env` or `docker compose up`
 *    take effect without a full rebuild cycle.
 */

export interface MetaEnv {
  appId: string;
  appSecret: string;
  accessToken: string;
  testEventCode: string | null;
  enabled: boolean;
}

export function metaEnv(): MetaEnv {
  const appId = (process.env.META_APP_ID ?? '').trim();
  const appSecret = (process.env.META_APP_SECRET ?? '').trim();
  const accessToken = (process.env.META_CAPI_ACCESS_TOKEN ?? '').trim();
  const rawTestCode = (process.env.META_TEST_EVENT_CODE ?? '').trim();
  const rawEnabled = (process.env.META_CAPI_ENABLED ?? '').trim().toLowerCase();

  const credentialsPresent =
    appId.length > 0 && appSecret.length > 0 && accessToken.length > 0;
  const flagEnabled = rawEnabled === 'true' || rawEnabled === '1' || rawEnabled === 'yes';

  return {
    appId,
    appSecret,
    accessToken,
    testEventCode: rawTestCode || null,
    enabled: credentialsPresent && flagEnabled,
  };
}

export function isCapiEnabled(): boolean {
  return metaEnv().enabled;
}
