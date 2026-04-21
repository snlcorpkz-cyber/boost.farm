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
app.use('/offers', offersRouter);
app.use('/track', trackRouter);

app.use(errorHandler);

import { runPushCron } from './cron/push-cron.js';
import { runAnalyticsRollup } from './cron/analytics-rollup.js';

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
});

export default app;
