import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne, execute, withTransaction } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { trackEvent, updateLastActive } from '../lib/analytics.js';
import {
  computeBucketWater,
  collectBucket,
  performWatering,
  getMultiplier,
  getRankForWater,
  getCurrentPhase,
  QUEST_LIMITS,
  FREE_BUCKET_COLLECTS_PER_DAY,
  STAGE_UP_BONUS,
} from '@eco-farm/game-engine';
import { notify } from '../lib/notify.js';
import { incrementActivityQuest } from './quests.js';

export const farmRouter = Router();
farmRouter.use(requireAuth);
farmRouter.use((req, res, next) => {
  if (req.user?.userId) updateLastActive(req.user.userId);
  if (req.method === 'POST') {
    const origJson = res.json.bind(res);
    res.json = function(body: any) {
      if (res.statusCode < 400 && req.user?.userId) {
        const route = req.path.replace(/^\//, '').replace(/\//g, '_') || 'unknown';
        trackEvent(req.user.userId, `farm.${route}`, { ...req.body }, req).catch(() => {});
      }
      return origJson(body);
    };
  }
  next();
});

const waterSchema = z.object({
  times: z.union([z.literal(1), z.literal(5), z.literal(20)]),
  idempotencyKey: z.string().uuid(),
});

const newCropSchema = z.object({
  productId: z.string().uuid(),
});

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

farmRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const now = new Date();

  const farm = await queryOne(
    `SELECT f.*, row_to_json(p.*) AS products
     FROM farms f JOIN products p ON f.product_id = p.id
     WHERE f.user_id = $1 AND f.harvested = false`,
    [userId]
  );

  if (!farm) {
    res.json({ success: true, data: { farm: null, needsCropSelection: true } });
    return;
  }

  const activePetRow = await queryOne(
    `SELECT pet_id FROM user_pets WHERE user_id = $1 AND is_active = true`,
    [userId]
  );
  const activePet = activePetRow?.pet_id || 'hamster';

  const bucketWater = computeBucketWater(new Date(farm.bucket_last_collected_at), now, activePet);
  const multiplier = getMultiplier(farm.nutrition);
  const rank = getRankForWater(farm.total_water_last_month ?? 0);

  const today = todayStr();
  const resetDate = farm.bucket_collects_reset_date
    ? new Date(farm.bucket_collects_reset_date).toISOString().slice(0, 10)
    : '';
  const freeUsed = resetDate === today ? (farm.bucket_free_collects_today ?? 0) : 0;
  const bucketAdFree = rank.id === 'master' || freeUsed < FREE_BUCKET_COLLECTS_PER_DAY;

  res.json({
    success: true,
    data: {
      farm: {
        ...farm,
        computed_bucket_water: bucketWater,
        multiplier,
        active_pet: activePet,
      },
      rank: rank.id,
      rankDef: rank,
      bucketAdRequired: !bucketAdFree,
      freeCollectsRemaining: rank.id === 'master' ? Infinity : Math.max(0, FREE_BUCKET_COLLECTS_PER_DAY - freeUsed),
      needsCropSelection: false,
    },
  });
});

farmRouter.post('/collect-bucket', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const now = new Date();
  const today = todayStr();
  const adWatched = req.body?.adWatched === true;
  // M-6: attach real collected amount to the trackEvent body so analytics isn't empty.
  const eventProps = req.body as Record<string, unknown>;

  const farm = await queryOne(
    `SELECT * FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );

  if (!farm) {
    res.status(404).json({ success: false, error: { code: 'NO_FARM', message: 'No active farm' } });
    return;
  }

  const rank = getRankForWater(farm.total_water_last_month ?? 0);
  const resetDate = farm.bucket_collects_reset_date
    ? new Date(farm.bucket_collects_reset_date).toISOString().slice(0, 10)
    : '';
  const freeUsed = resetDate === today ? (farm.bucket_free_collects_today ?? 0) : 0;
  const isFreeCollect = rank.id === 'master' || freeUsed < FREE_BUCKET_COLLECTS_PER_DAY;

  if (!isFreeCollect && !adWatched) {
    res.status(402).json({ success: false, error: { code: 'AD_REQUIRED', message: 'Watch ad to collect bucket' } });
    return;
  }

  const activePetRow = await queryOne(
    `SELECT pet_id FROM user_pets WHERE user_id = $1 AND is_active = true`,
    [userId]
  );
  const activePet = activePetRow?.pet_id || 'hamster';

  const result = collectBucket(
    {
      ...farm,
      bucketLastCollectedAt: new Date(farm.bucket_last_collected_at),
      waterInCan: farm.water_in_can,
      waterInBucket: farm.water_in_bucket,
      growthPercent: farm.growth_percent,
      currentStage: farm.current_stage,
      totalWateringsToday: farm.total_waterings_today,
      dayResetAt: new Date(farm.day_reset_at),
      userId: farm.user_id,
      productId: farm.product_id,
    },
    now,
    activePet
  );

  const currentMonth = new Date().toISOString().slice(0, 7);
  const newFreeUsed = isFreeCollect ? freeUsed + 1 : freeUsed;

  try {
    const updated = await execute(
      `UPDATE farms SET water_in_can = $1, water_in_bucket = 0, bucket_last_collected_at = $2,
       total_water_this_month = CASE WHEN water_month = $5 THEN total_water_this_month + $6 ELSE $6 END,
       water_month = $5,
       bucket_free_collects_today = $8,
       bucket_collects_reset_date = $7::date
       WHERE id = $3 AND date_trunc('milliseconds', bucket_last_collected_at) = date_trunc('milliseconds', $4::timestamptz)`,
      [result.newWaterInCan, now.toISOString(), farm.id, farm.bucket_last_collected_at, currentMonth, result.collected, today, newFreeUsed]
    );

    if (updated === 0) {
      res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Bucket already collected' } });
      return;
    }
  } catch (err) {
    console.error('[collect-bucket] SQL error, falling back:', err);
    const updated = await execute(
      `UPDATE farms SET water_in_can = $1, water_in_bucket = 0, bucket_last_collected_at = $2,
       total_water_this_month = CASE WHEN water_month = $5 THEN total_water_this_month + $6 ELSE $6 END,
       water_month = $5
       WHERE id = $3 AND date_trunc('milliseconds', bucket_last_collected_at) = date_trunc('milliseconds', $4::timestamptz)`,
      [result.newWaterInCan, now.toISOString(), farm.id, farm.bucket_last_collected_at, currentMonth, result.collected]
    );
    if (updated === 0) {
      res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Bucket already collected' } });
      return;
    }
  }

  if (result.collected > 0) {
    await notify(userId, 'bucket', 'notif.bucket_collected', { amount: Math.round(result.collected) });
  }

  // M-6: enrich the auto-tracked event payload.
  eventProps.collected = Math.round(result.collected);
  eventProps.isFreeCollect = isFreeCollect;

  const nextFreeRemaining = rank.id === 'master' ? Infinity : Math.max(0, FREE_BUCKET_COLLECTS_PER_DAY - newFreeUsed);
  res.json({
    success: true,
    data: {
      collected: result.collected,
      waterInCan: result.newWaterInCan,
      bucketAdRequired: rank.id !== 'master' && nextFreeRemaining <= 0,
      freeCollectsRemaining: nextFreeRemaining,
    },
  });
});

farmRouter.post(
  '/water',
  rateLimit(5, 1000),
  async (req: Request, res: Response) => {
    const userId = req.user!.userId;

    let body;
    try {
      body = waterSchema.parse(req.body);
    } catch (err) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid request' } });
      return;
    }

    try {
      const result = await withTransaction(async (txQuery, txQueryOne, txExecute) => {
        const existing = await txQueryOne(
          `SELECT key FROM idempotency_keys WHERE key = $1`,
          [body.idempotencyKey]
        );

        if (existing) {
          return { duplicate: true } as const;
        }

        const farm = await txQueryOne(
          `SELECT f.*, row_to_json(p.*) AS products
           FROM farms f JOIN products p ON f.product_id = p.id
           WHERE f.user_id = $1 AND f.harvested = false
           FOR UPDATE OF f`,
          [userId]
        );

        if (!farm) {
          return { noFarm: true } as const;
        }

        const activePetRow = await txQueryOne(
          `SELECT pet_id FROM user_pets WHERE user_id = $1 AND is_active = true`,
          [userId]
        );
        const activePet = activePetRow?.pet_id || 'hamster';

        const today = todayStr();
        const dayResetDate = farm.day_reset_at ? new Date(farm.day_reset_at).toISOString().slice(0, 10) : '';
        const waterings = dayResetDate === today ? farm.total_waterings_today : 0;

        const waterResult = performWatering(
          {
            ...farm,
            bucketLastCollectedAt: new Date(farm.bucket_last_collected_at),
            waterInCan: farm.water_in_can,
            waterInBucket: farm.water_in_bucket,
            growthPercent: farm.growth_percent,
            currentStage: farm.current_stage,
            totalWateringsToday: waterings,
            dayResetAt: new Date(farm.day_reset_at),
            userId: farm.user_id,
            productId: farm.product_id,
          },
          body.times,
          farm.products.difficulty_stars,
          activePet
        );

        await txExecute(
          `INSERT INTO idempotency_keys (key, user_id) VALUES ($1, $2)`,
          [body.idempotencyKey, userId]
        );

        const newWateringCount = waterings + body.times;

        // M-1: fold stage-up bonus into the same TX to avoid half-applied rewards.
        const stageUp = waterResult.newStage > farm.current_stage;
        const stageUpBonus = stageUp ? STAGE_UP_BONUS : 0;
        const waterInCanAfter = waterResult.newWaterInCan + stageUpBonus;
        const mo = new Date().toISOString().slice(0, 7);

        await txExecute(
          `UPDATE farms SET growth_percent = $1, current_stage = $2, water_in_can = $3,
           nutrition = $4, total_waterings_today = $5, harvested = $6,
           total_water_this_month = CASE WHEN water_month = $8 THEN total_water_this_month + $9 ELSE $9 END,
           water_month = $8,
           day_reset_at = CASE WHEN day_reset_at::date < CURRENT_DATE THEN CURRENT_DATE ELSE day_reset_at END
           WHERE id = $7`,
          [waterResult.newGrowthPercent, waterResult.newStage, waterInCanAfter,
           waterResult.newNutrition, newWateringCount, waterResult.harvested,
           farm.id, mo, stageUpBonus]
        );

        // M-1: daily challenge progress in same TX (reuse today from above)
        const rank = getRankForWater(farm.total_water_last_month ?? 0);
        let challenge = await txQueryOne(
          `SELECT id, water_given FROM daily_challenges WHERE user_id = $1 AND challenge_date = $2`,
          [userId, today]
        );
        if (!challenge) {
          challenge = await txQueryOne(
            `INSERT INTO daily_challenges (user_id, challenge_date, water_given, required, completed, reward_claimed, reward_amount)
             VALUES ($1, $2, 0, $3, false, false, $4)
             ON CONFLICT (user_id, challenge_date) DO UPDATE SET water_given = daily_challenges.water_given
             RETURNING id, water_given`,
            [userId, today, rank.dailyChallengeWaterReq, rank.dailyChallengeReward]
          );
        }
        const newWaterGiven = (challenge!.water_given || 0) + waterResult.waterConsumed;
        const isCompleted = newWaterGiven >= rank.dailyChallengeWaterReq;
        await txExecute(
          `UPDATE daily_challenges SET water_given = $1, completed = $2 WHERE id = $3`,
          [newWaterGiven, isCompleted, challenge!.id]
        );

        return { waterResult, farm, stageUpBonus } as const;
      });

      if ('duplicate' in result) {
        res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'Already processed' } });
        return;
      }

      if ('noFarm' in result) {
        res.status(404).json({ success: false, error: { code: 'NO_FARM', message: 'No active farm' } });
        return;
      }

      const { waterResult, farm, stageUpBonus } = result;

      if (stageUpBonus > 0) {
        await notify(userId, 'stage', 'notif.stage_up', { stage: waterResult.newStage, bonus: stageUpBonus });
      }

      if (waterResult.harvested) {
        const couponCode = `ECO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const expiresAt = new Date(Date.now() + farm.products.coupon_validity_days * 24 * 60 * 60 * 1000);

        await execute(
          `INSERT INTO coupons (user_id, product_id, code, expires_at) VALUES ($1, $2, $3, $4)`,
          [userId, farm.product_id, couponCode, expiresAt.toISOString()]
        );

        await notify(userId, 'harvest', 'notif.harvest_complete', { product: farm.products.name_key });
      }

      res.json({ success: true, data: { ...waterResult, stageUpBonus } });
    } catch (err: any) {
      if (err.message === 'NOT_ENOUGH_WATER') {
        res.status(400).json({ success: false, error: { code: 'NOT_ENOUGH_WATER', message: 'Not enough water in can' } });
        return;
      }
      throw err;
    }
  }
);

farmRouter.post('/fertilize', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  let body;
  try {
    body = z.object({ amount: z.number().int().positive().max(1000) }).parse(req.body);
  } catch {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid amount' } });
    return;
  }

  const farm = await queryOne(
    `SELECT * FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );

  if (!farm) {
    res.status(404).json({ success: false, error: { code: 'NO_FARM', message: 'No active farm' } });
    return;
  }

  const MAX_NUTRITION = 10000;
  const newNutrition = Math.min(MAX_NUTRITION, farm.nutrition + body.amount);
  await execute(`UPDATE farms SET nutrition = $1 WHERE id = $2`, [newNutrition, farm.id]);

  res.json({ success: true, data: { nutrition: newNutrition, multiplier: getMultiplier(newNutrition) } });
});

farmRouter.post('/new-crop', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  let body;
  try {
    body = newCropSchema.parse(req.body);
  } catch {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid product' } });
    return;
  }

  const activeFarm = await queryOne(
    `SELECT id FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );

  if (activeFarm) {
    res.status(400).json({ success: false, error: { code: 'ACTIVE_FARM', message: 'Already have active farm' } });
    return;
  }

  const product = await queryOne(
    `SELECT * FROM products WHERE id = $1 AND active = true`,
    [body.productId]
  );

  if (!product) {
    res.status(404).json({ success: false, error: { code: 'INVALID_PRODUCT', message: 'Product not found' } });
    return;
  }

  // C-5: drain any referral bonus stashed on the user account while their farm
  // did not yet exist. Start the new farm with it baked in, then clear.
  const pending = await queryOne(
    `SELECT pending_nutrition_bonus, pending_water_bonus FROM users WHERE id = $1`,
    [userId]
  );
  const baseNutrition = 50;
  const baseWater = 100;
  const MAX_NUTRITION = 10000;
  const startingNutrition = Math.min(
    MAX_NUTRITION,
    baseNutrition + (pending?.pending_nutrition_bonus ?? 0),
  );
  const startingWater = baseWater + (pending?.pending_water_bonus ?? 0);

  let farm;
  try {
    farm = await queryOne(
      `INSERT INTO farms (user_id, product_id, growth_percent, current_stage, water_in_can,
       water_in_bucket, nutrition, bucket_last_collected_at, total_waterings_today, day_reset_at)
       VALUES ($1, $2, 0, 1, $3, 0, $4, NOW(), 0, NOW()) RETURNING *`,
      [userId, body.productId, startingWater, startingNutrition]
    );
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(400).json({ success: false, error: { code: 'ACTIVE_FARM', message: 'Already have active farm' } });
      return;
    }
    throw err;
  }

  if ((pending?.pending_nutrition_bonus ?? 0) > 0 || (pending?.pending_water_bonus ?? 0) > 0) {
    await execute(
      `UPDATE users SET pending_nutrition_bonus = 0, pending_water_bonus = 0 WHERE id = $1`,
      [userId]
    );
  }

  res.json({ success: true, data: { farm: { ...farm, products: product } } });
});

farmRouter.post('/harvest', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const farm = await queryOne(
    `SELECT f.*, row_to_json(p.*) AS products
     FROM farms f JOIN products p ON f.product_id = p.id
     WHERE f.user_id = $1 AND f.harvested = true AND f.growth_percent = 100`,
    [userId]
  );

  if (!farm) {
    res.status(400).json({ success: false, error: { code: 'NOT_READY', message: 'Farm not ready for harvest' } });
    return;
  }

  const coupon = await queryOne(
    `SELECT * FROM coupons WHERE user_id = $1 AND product_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [userId, farm.product_id]
  );

  res.json({ success: true, data: { coupon, product: farm.products } });
});

farmRouter.get('/ad-limits', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;
  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = new Date().toISOString().slice(0, 10);
  const limit = QUEST_LIMITS.ADS_PER_PHASE;

  const rows = await query(
    `SELECT ad_type, count FROM ad_views
     WHERE user_id = $1 AND phase = $2 AND view_date = $3
       AND ad_type IN ('water', 'nutrition')`,
    [userId, phase, today]
  );

  const used: Record<string, number> = { water: 0, nutrition: 0 };
  for (const r of rows) used[r.ad_type] = r.count;

  res.json({
    success: true,
    data: {
      phase,
      limit,
      water: { used: used.water, remaining: Math.max(0, limit - used.water) },
      nutrition: { used: used.nutrition, remaining: Math.max(0, limit - used.nutrition) },
    },
  });
});

farmRouter.post(
  '/ad-reward',
  rateLimit(3, 10000),
  async (req: Request, res: Response) => {
    const userId = req.user!.userId;

    // SECURITY (C-1): Server authoritatively decides reward amount based on
    // the user's rank. Client is not trusted to send amount/placement payout.
    let body;
    try {
      body = z.object({
        type: z.enum(['water', 'nutrition']),
        placement: z.string().min(1).max(64).optional(),
        idempotencyKey: z.string().uuid().optional(),
      }).parse(req.body);
    } catch {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid request' } });
      return;
    }

    if (body.idempotencyKey) {
      const existing = await queryOne(
        `SELECT key FROM idempotency_keys WHERE key = $1`,
        [body.idempotencyKey]
      );
      if (existing) {
        res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'Already credited' } });
        return;
      }
    }

    const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;
    const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
    const phase = getCurrentPhase(localHour);
    const today = new Date().toISOString().slice(0, 10);

    const adView = await queryOne(
      `INSERT INTO ad_views (user_id, ad_type, phase, view_date, count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (user_id, ad_type, phase, view_date)
       DO UPDATE SET count = ad_views.count + 1
       WHERE ad_views.count < $5
       RETURNING count`,
      [userId, body.type, phase, today, QUEST_LIMITS.ADS_PER_PHASE]
    );

    if (!adView) {
      res.status(400).json({ success: false, error: { code: 'AD_LIMIT', message: 'Ad limit reached for this phase' } });
      return;
    }

    const farm = await queryOne(
      `SELECT id, total_water_last_month FROM farms WHERE user_id = $1 AND harvested = false`,
      [userId]
    );

    if (!farm) {
      res.status(404).json({ success: false, error: { code: 'NO_FARM', message: 'No active farm' } });
      return;
    }

    const rank = getRankForWater(farm.total_water_last_month ?? 0);
    const amount = body.type === 'water' ? rank.adWater : rank.adFertilizer;

    if (body.idempotencyKey) {
      try {
        await execute(
          `INSERT INTO idempotency_keys (key, user_id) VALUES ($1, $2)`,
          [body.idempotencyKey, userId]
        );
      } catch (e: any) {
        if (e.code === '23505') {
          res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'Already credited' } });
          return;
        }
        throw e;
      }
    }

    if (body.type === 'water') {
      const mo = new Date().toISOString().slice(0, 7);
      await execute(
        `UPDATE farms SET water_in_can = water_in_can + $1,
         total_water_this_month = CASE WHEN water_month = $3 THEN total_water_this_month + $1 ELSE $1 END,
         water_month = $3
         WHERE id = $2`,
        [amount, farm.id, mo]
      );
    } else {
      await execute(
        `UPDATE farms SET nutrition = LEAST(10000, nutrition + $1) WHERE id = $2`,
        [amount, farm.id]
      );
    }

    // H-1: advance watch_ad activity quest counter.
    await incrementActivityQuest(userId, 'watch_ad', phase, today).catch(() => {});

    res.json({ success: true, data: { type: body.type, amount } });
  }
);
