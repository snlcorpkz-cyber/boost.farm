import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  computeBucketWater,
  collectBucket,
  performWatering,
  getMultiplier,
  BUCKET_CAPACITY,
  WATERING_BATCH_SIZES,
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

farmRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const now = new Date();

  const { data: farm } = await supabase
    .from('farms')
    .select('*, products(*)')
    .eq('user_id', userId)
    .eq('harvested', false)
    .single();

  if (!farm) {
    res.json({ success: true, data: { farm: null, needsCropSelection: true } });
    return;
  }

  const bucketWater = computeBucketWater(new Date(farm.bucket_last_collected_at), now);
  const multiplier = getMultiplier(farm.nutrition);

  res.json({
    success: true,
    data: {
      farm: {
        ...farm,
        computed_bucket_water: bucketWater,
        multiplier,
      },
      needsCropSelection: false,
    },
  });
});

farmRouter.post('/collect-bucket', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const now = new Date();

  const { data: farm } = await supabase
    .from('farms')
    .select('*')
    .eq('user_id', userId)
    .eq('harvested', false)
    .single();

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

  await supabase
    .from('farms')
    .update({
      water_in_can: result.newWaterInCan,
      water_in_bucket: 0,
      bucket_last_collected_at: now.toISOString(),
    })
    .eq('id', farm.id);

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

    const { data: existing } = await supabase
      .from('idempotency_keys')
      .select('key')
      .eq('key', body.idempotencyKey)
      .single();

    if (existing) {
      res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'Already processed' } });
      return;
    }

    const { data: farm } = await supabase
      .from('farms')
      .select('*, products(*)')
      .eq('user_id', userId)
      .eq('harvested', false)
      .single();

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

      await supabase
        .from('idempotency_keys')
        .insert({ key: body.idempotencyKey, user_id: userId });

      await supabase
        .from('farms')
        .update({
          growth_percent: result.newGrowthPercent,
          current_stage: result.newStage,
          water_in_can: result.newWaterInCan,
          nutrition: result.newNutrition,
          total_waterings_today: farm.total_waterings_today + body.times,
          harvested: result.harvested,
        })
        .eq('id', farm.id);

      if (result.harvested) {
        const couponCode = `ECO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const expiresAt = new Date(Date.now() + farm.products.coupon_validity_days * 24 * 60 * 60 * 1000);

        await supabase.from('coupons').insert({
          user_id: userId,
          product_id: farm.product_id,
          code: couponCode,
          expires_at: expiresAt.toISOString(),
        });
      }

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

  const { data: farm } = await supabase
    .from('farms')
    .select('*')
    .eq('user_id', userId)
    .eq('harvested', false)
    .single();

  if (!farm) {
    res.status(404).json({ success: false, error: { code: 'NO_FARM', message: 'No active farm' } });
    return;
  }

  const newNutrition = farm.nutrition + amount;

  await supabase
    .from('farms')
    .update({ nutrition: newNutrition })
    .eq('id', farm.id);

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

  const { data: activeFarm } = await supabase
    .from('farms')
    .select('id')
    .eq('user_id', userId)
    .eq('harvested', false)
    .single();

  if (activeFarm) {
    res.status(400).json({ success: false, error: { code: 'ACTIVE_FARM', message: 'Already have active farm' } });
    return;
  }

  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', body.productId)
    .eq('active', true)
    .single();

  if (!product) {
    res.status(404).json({ success: false, error: { code: 'INVALID_PRODUCT', message: 'Product not found' } });
    return;
  }

  const { data: farm } = await supabase
    .from('farms')
    .insert({
      user_id: userId,
      product_id: body.productId,
      growth_percent: 0,
      current_stage: 1,
      water_in_can: 0,
      water_in_bucket: 0,
      nutrition: 0,
      bucket_last_collected_at: new Date().toISOString(),
      total_waterings_today: 0,
      day_reset_at: new Date().toISOString(),
    })
    .select('*, products(*)')
    .single();

  res.json({ success: true, data: { farm } });
});

farmRouter.post('/harvest', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const { data: farm } = await supabase
    .from('farms')
    .select('*, products(*)')
    .eq('user_id', userId)
    .eq('harvested', true)
    .eq('growth_percent', 100)
    .single();

  if (!farm) {
    res.status(400).json({ success: false, error: { code: 'NOT_READY', message: 'Farm not ready for harvest' } });
    return;
  }

  const { data: coupon } = await supabase
    .from('coupons')
    .select('*')
    .eq('user_id', userId)
    .eq('product_id', farm.product_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  res.json({ success: true, data: { coupon, product: farm.products } });
});
