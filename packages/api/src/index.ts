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

app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));

/** Load / stress tests from one IP: set LOAD_TEST_SECRET and send X-Load-Test-Secret header */
app.use((req, _res, next) => {
  const secret = (process.env.LOAD_TEST_SECRET || '').trim();
  const header = (req.get('x-load-test-secret') || '').trim();
  if (secret && header && header === secret) {
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
