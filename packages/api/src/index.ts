import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '../../.env') });
import express, { type Request } from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { farmRouter } from './routes/farm.js';
import { userRouter } from './routes/user.js';
import { friendsRouter } from './routes/friends.js';
import { questsRouter } from './routes/quests.js';
import { gamesRouter } from './routes/games.js';
import { petsRouter } from './routes/pets.js';
import { productsRouter } from './routes/products.js';
import { offersRouter } from './routes/offers.js';
import { trackRouter } from './routes/track.js';
import { adminRouter } from './routes/admin/index.js';
import { partnerRouter } from './routes/partner/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { globalRateLimit } from './middleware/rate-limit.js';

const app = express();
const PORT = process.env.PORT || 3001;

// We run behind multiple proxies in production: Cloudflare → nginx → api
// container (the api is `expose: 3001` only, never `ports:` — so the
// internet cannot bypass the proxy chain). With `trust proxy: 1` Express
// strips only the rightmost X-Forwarded-For entry (added by nginx), and
// `req.ip` ends up being the *Cloudflare edge IP*, not the user. Result:
// every user routed through the same Cloudflare datacenter shares one
// rate-limit bucket, and during a real Meta campaign that bucket fills
// in seconds — the next /auth/verify-code request gets a silent 429 and
// the user sees "Authentication failed" even though they typed the
// correct code. `true` walks the entire X-Forwarded-For chain back to
// the original client (this is safe here because the api port isn't
// reachable from the public internet).
app.set('trust proxy', true);

// CORS — we accept a comma-separated allow-list via CLIENT_URL plus
// always allow our production hosts (boostfarm.io and any subdomain).
// Same-origin requests from the WebView (https://boostfarm.io →
// https://boostfarm.io/api/...) don't fire CORS at all, but tools like
// curl, server-side fetches, and admin panels on different subdomains
// do — and the previous single-origin config (`localhost:3000`) was
// silently blocking every non-localhost browser-based call.
const ALLOWED_ORIGINS = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (/^https?:\/\/(.+\.)?boostfarm\.(io|com)$/.test(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '256kb' }));

/**
 * Bypass the global per-IP rate limiter for endpoints that:
 *   1. cannot share a bucket with authed in-game traffic — anonymous users
 *      hitting /auth/send-code & /auth/verify-code never have a userId,
 *      so they all key on `req.ip`. If even one in-game user behind the
 *      same NAT/CDN datacenter fills the 120/min budget, the next
 *      registration silently 429's. These endpoints have their own
 *      stricter route-level limiters (10/min) so we're not opening abuse.
 *   2. are health/uptime probes that must NEVER be throttled (otherwise
 *      orchestrators mark the container unhealthy and restart it under
 *      load — making the user-facing problem worse).
 *   3. carry an explicit load-test secret (existing /opt-in path).
 */
app.use((req, _res, next) => {
  const secret = (process.env.LOAD_TEST_SECRET || '').trim();
  const header = (req.get('x-load-test-secret') || '').trim();
  const isLoadTest = secret && header && header === secret;
  const isAuthPath = req.path.startsWith('/auth/');
  const isHealthPath = req.path === '/health';
  if (isLoadTest || isAuthPath || isHealthPath) {
    (req as Request & { skipGlobalRateLimit?: boolean }).skipGlobalRateLimit = true;
  }
  next();
});

app.use(globalRateLimit(120));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRouter);
app.use('/farm', farmRouter);
app.use('/user', userRouter);
app.use('/friends', friendsRouter);
app.use('/quests', questsRouter);
app.use('/games', gamesRouter);
app.use('/pets', petsRouter);
app.use('/admin/products', productsRouter);
app.use('/admin', adminRouter);
app.use('/partner', partnerRouter);
app.use('/offers', offersRouter);
app.use('/track', trackRouter);

app.use(errorHandler);

import { runPushCron } from './cron/push-cron.js';
import { runAnalyticsRollup } from './cron/analytics-rollup.js';
import { runPartnerPostbackCron } from './cron/partner-postback-cron.js';
import { runCapiDispatch } from './workers/capiWorker.js';
import { isCapiEnabled } from './meta/env.js';
import { runAppsFlyerS2SDispatch } from './workers/appsflyerS2SWorker.js';
import { getAfS2SEnv } from './appsflyer/s2s.js';
import { runAppsFlyerCostPull, getAfCostPullEnv } from './workers/afCostPullWorker.js';

app.listen(PORT, () => {
  console.log(`[API] Running on http://localhost:${PORT}`);

  const PUSH_CRON_INTERVAL = 15 * 60 * 1000;
  runPushCron().catch((err) => console.error('[push-cron] initial run error:', err));
  setInterval(() => {
    runPushCron().catch((err) => console.error('[push-cron]', err));
  }, PUSH_CRON_INTERVAL);
  console.log('[push-cron] Running now + every 15 min');

  // Analytics rollup — once an hour is plenty since we only rebuild
  // "yesterday". First run is deferred by 2 minutes so the server has time
  // to warm up and accept traffic before this burst of DB writes.
  const ROLLUP_INTERVAL = 60 * 60 * 1000;
  setTimeout(() => {
    runAnalyticsRollup().catch((err) =>
      console.error('[analytics-rollup] initial run error:', err),
    );
    setInterval(() => {
      runAnalyticsRollup().catch((err) => console.error('[analytics-rollup]', err));
    }, ROLLUP_INTERVAL);
  }, 2 * 60 * 1000);
  console.log('[analytics-rollup] Scheduled hourly (first run in 2 min)');

  // Meta Conversions API dispatcher. Polls the `events` table for
  // unsent rows, batches them, and POSTs to Meta Graph API. Safe
  // to schedule always — when credentials are missing or the
  // feature flag is off, each tick no-ops immediately and costs
  // exactly one boolean check.
  //
  // 30-second cadence gives us real-time-ish dispatch without
  // hammering Postgres. The worker itself self-caps at
  // MAX_EVENTS_PER_TICK per run so a backlog can't monopolise
  // the event loop.
  const CAPI_INTERVAL = 30 * 1000;
  if (isCapiEnabled()) {
    setTimeout(() => {
      runCapiDispatch()
        .then(({ sent, failed }) => {
          if (sent > 0 || failed > 0) {
            console.log(`[capi-worker] first run: sent=${sent} failed=${failed}`);
          }
        })
        .catch((err) => console.error('[capi-worker] initial run error:', err));
      setInterval(() => {
        runCapiDispatch().catch((err) => console.error('[capi-worker]', err));
      }, CAPI_INTERVAL);
    }, 3 * 60 * 1000);
    console.log('[capi-worker] Scheduled every 30s (first run in 3 min)');
  } else {
    console.log('[capi-worker] Disabled (META_CAPI_ENABLED=false or creds missing)');
  }

  // AppsFlyer Server-to-Server dispatcher. Same shape as the CAPI
  // worker: scans `events` for unsent rows whose internal name is in
  // the env allow-list (APPSFLYER_S2S_EVENT_NAMES), POSTs them to
  // api3.appsflyer.com one-at-a-time (no batch endpoint), marks
  // success.
  //
  // Off-by-default: if the dev key, app id, or allow-list are missing
  // each tick no-ops. Same defensive design as CAPI — safe to leave
  // scheduled in dev and staging.
  const AF_S2S_INTERVAL = 30 * 1000;
  const afEnv = getAfS2SEnv();
  if (afEnv.enabled) {
    setTimeout(() => {
      runAppsFlyerS2SDispatch()
        .then(({ sent, failed }) => {
          if (sent > 0 || failed > 0) {
            console.log(`[af-s2s] first run: sent=${sent} failed=${failed}`);
          }
        })
        .catch((err) => console.error('[af-s2s] initial run error:', err));
      setInterval(() => {
        runAppsFlyerS2SDispatch().catch((err) => console.error('[af-s2s]', err));
      }, AF_S2S_INTERVAL);
    }, 3 * 60 * 1000);
    console.log(
      `[af-s2s] Scheduled every 30s (first run in 3 min). Allow-list: ${afEnv.eventNamesAllowList.join(', ')}`,
    );
  } else {
    console.log('[af-s2s] Disabled (APPSFLYER_S2S_ENABLED!=true or creds/allow-list missing)');
  }

  // AppsFlyer cost pull. Daily snapshot of the last 14 days of
  // partner spend (Cost / Impressions / Clicks / Installs) into
  // `ad_costs`. AF's aggregated Pull API rate-limits this report at
  // 24 calls/day for 3+ day ranges, so anything tighter than daily
  // risks the 400 CallLimit wall — daily gives us 24× headroom even
  // accounting for one retry on transient failure.
  //
  // Off-by-default. AF_COST_PULL_ENABLED + APPSFLYER_PULL_API_TOKEN
  // must be set; without them this scheduler block is a no-op log
  // and the retention page falls back to "—" CPI/ROAS columns.
  const AF_COST_PULL_INTERVAL = 24 * 60 * 60 * 1000;
  const afCostEnv = getAfCostPullEnv();
  if (afCostEnv.enabled) {
    // First run is deferred 4 minutes — give the DB pool a chance
    // to warm up and other initial workers a head-start, since this
    // run will issue ~1 request and a small batch of upserts.
    setTimeout(() => {
      runAppsFlyerCostPull().catch((err) =>
        console.error('[af-cost-pull] initial run error:', err),
      );
      setInterval(() => {
        runAppsFlyerCostPull().catch((err) => console.error('[af-cost-pull]', err));
      }, AF_COST_PULL_INTERVAL);
    }, 4 * 60 * 1000);
    console.log('[af-cost-pull] Scheduled daily (first run in 4 min)');
  } else {
    console.log('[af-cost-pull] Disabled (AF_COST_PULL_ENABLED!=true or APPSFLYER_PULL_API_TOKEN missing)');
  }

  // Partner postback dispatcher. Drains `partner_postbacks_out` every
  // 30 seconds with exponential backoff per row. Always-on: when no
  // partners are active or there's nothing queued, the tick is a
  // single indexed SELECT that returns zero rows.
  const PARTNER_POSTBACK_INTERVAL = 30 * 1000;
  setTimeout(() => {
    runPartnerPostbackCron().catch((err) =>
      console.error('[partner-postback-cron] initial run error:', err),
    );
    setInterval(() => {
      runPartnerPostbackCron().catch((err) => console.error('[partner-postback-cron]', err));
    }, PARTNER_POSTBACK_INTERVAL);
  }, 60 * 1000);
  console.log('[partner-postback-cron] Scheduled every 30s (first run in 60s)');
});

export default app;
