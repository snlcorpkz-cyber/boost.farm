// Mirrors the live `products` table after migration 008_rebalance_products.sql
// (two difficulty tiers: ★1 Easy = 40,420g, ★2 Hard = 62,500g) and seed.sql.
// The DB is the runtime source of truth — keep this in sync when rebalancing.
export const PRODUCTS_SEED = [
  {
    nameKey: 'product.potato',
    difficultyStars: 1,
    baseWaterRequired: 40420,
    couponValueCents: 150,
    couponValidityDays: 60,
  },
  {
    nameKey: 'product.carrot',
    difficultyStars: 1,
    baseWaterRequired: 40420,
    couponValueCents: 150,
    couponValidityDays: 60,
  },
  {
    nameKey: 'product.onion',
    difficultyStars: 1,
    baseWaterRequired: 40420,
    couponValueCents: 300,
    couponValidityDays: 60,
  },
  {
    nameKey: 'product.cucumber',
    difficultyStars: 2,
    baseWaterRequired: 62500,
    couponValueCents: 350,
    couponValidityDays: 60,
  },
  {
    nameKey: 'product.tomato',
    difficultyStars: 2,
    baseWaterRequired: 62500,
    couponValueCents: 500,
    couponValidityDays: 60,
  },
] as const;
