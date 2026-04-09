import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne, execute } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  computeBucketWater,
  collectBucket,
  performWatering,
  getMultiplier,
  getRankForWater,
} from '@eco-farm/game-engine';

export const farmRouter = Router();
farmRouter.use(requireAuth);

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

  const bucketWater = computeBucketWater(new Date(farm.bucket_last_collected_at), now);
  const multiplier = getMultiplier(farm.nutrition);
  const rank = getRankForWater(farm.total_water_last_month ?? 0);

  res.json({
    success: true,
    data: {
      farm: {
        ...farm,
        computed_bucket_water: bucketWater,
        multiplier,
        active_pet: 'hamster',
      },
      rank: rank.id,
      rankDef: rank,
      needsCropSelection: false,
    },
  });
});

farmRouter.post('/collect-bucket', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const now = new Date();

  const farm = await queryOne(
    `SELECT * FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );

  if (!farm) {
    res.status(404).json({ success: false, error: { code: 'NO_FARM', message: 'No active farm' } });
    return;
  }

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
    now
  );

  await execute(
    `UPDATE farms SET water_in_can = $1, water_in_bucket = 0, bucket_last_collected_at = $2
     WHERE id = $3`,
    [result.newWaterInCan, now.toISOString(), farm.id]
  );

  res.json({ success: true, data: { collected: result.collected, waterInCan: result.newWaterInCan } });
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

    const existing = await queryOne(
      `SELECT key FROM idempotency_keys WHERE key = $1`,
      [body.idempotencyKey]
    );

    if (existing) {
      res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'Already processed' } });
      return;
    }

    const farm = await queryOne(
      `SELECT f.*, row_to_json(p.*) AS products
       FROM farms f JOIN products p ON f.product_id = p.id
       WHERE f.user_id = $1 AND f.harvested = false`,
      [userId]
    );

    if (!farm) {
      res.status(404).json({ success: false, error: { code: 'NO_FARM', message: 'No active farm' } });
      return;
    }

    try {
      const result = performWatering(
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
        body.times,
        farm.products.difficulty_stars
      );

      await execute(
        `INSERT INTO idempotency_keys (key, user_id) VALUES ($1, $2)`,
        [body.idempotencyKey, userId]
      );

      await execute(
        `UPDATE farms SET growth_percent = $1, current_stage = $2, water_in_can = $3,
         nutrition = $4, total_waterings_today = $5, harvested = $6
         WHERE id = $7`,
        [result.newGrowthPercent, result.newStage, result.newWaterInCan,
         result.newNutrition, farm.total_waterings_today + body.times, result.harvested, farm.id]
      );

      if (result.harvested) {
        const couponCode = `ECO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const expiresAt = new Date(Date.now() + farm.products.coupon_validity_days * 24 * 60 * 60 * 1000);

        await execute(
          `INSERT INTO coupons (user_id, product_id, code, expires_at) VALUES ($1, $2, $3, $4)`,
          [userId, farm.product_id, couponCode, expiresAt.toISOString()]
        );
      }

      const today = todayStr();
      const rank = getRankForWater(farm.total_water_last_month ?? 0);

      let challenge = await queryOne(
        `SELECT * FROM daily_challenges WHERE user_id = $1 AND challenge_date = $2`,
        [userId, today]
      );

      if (!challenge) {
        challenge = await queryOne(
          `INSERT INTO daily_challenges (user_id, challenge_date, water_given, required, completed, reward_claimed, reward_amount)
           VALUES ($1, $2, 0, $3, false, false, $4) RETURNING *`,
          [userId, today, rank.dailyChallengeWaterReq, rank.dailyChallengeReward]
        );
      }

      const newWaterGiven = (challenge!.water_given || 0) + result.waterConsumed;
      const isCompleted = newWaterGiven >= rank.dailyChallengeWaterReq;

      await execute(
        `UPDATE daily_challenges SET water_given = $1, completed = $2 WHERE id = $3`,
        [newWaterGiven, isCompleted, challenge!.id]
      );

      res.json({ success: true, data: result });
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
  const { amount } = z.object({ amount: z.number().int().positive() }).parse(req.body);

  const farm = await queryOne(
    `SELECT * FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );

  if (!farm) {
    res.status(404).json({ success: false, error: { code: 'NO_FARM', message: 'No active farm' } });
    return;
  }

  const newNutrition = farm.nutrition + amount;
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

  const farm = await queryOne(
    `INSERT INTO farms (user_id, product_id, growth_percent, current_stage, water_in_can,
     water_in_bucket, nutrition, bucket_last_collected_at, total_waterings_today, day_reset_at)
     VALUES ($1, $2, 0, 1, 100, 0, 50, NOW(), 0, NOW()) RETURNING *`,
    [userId, body.productId]
  );

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
