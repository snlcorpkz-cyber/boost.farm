import { BUCKET_CAPACITY, BUCKET_FILL_RATE } from './constants.js';

export type PetId = 'hamster' | 'rabbit' | 'monkey';

export const PET_IDS: readonly PetId[] = ['hamster', 'rabbit', 'monkey'] as const;

export interface PetBonus {
  giftAmount?: number;
  giftCooldownMs?: number;
  bucketCapacity?: number;
  growthMultiplier?: number;
}

export const PET_BONUSES: Record<PetId, PetBonus> = {
  hamster: {
    giftAmount: 10,
    giftCooldownMs: 24 * 60 * 60 * 1000,
  },
  rabbit: {
    bucketCapacity: 50,
  },
  monkey: {
    growthMultiplier: 1.15,
  },
};

export const PET_UNLOCK_CONDITIONS = {
  hamster: { type: 'free' as const },
  rabbit: { type: 'referrals' as const, required: 3 },
  monkey: { type: 'quests' as const, required: 30 },
};

export function getEffectiveBucketCapacity(activePet?: PetId | null): number {
  if (activePet && PET_BONUSES[activePet]?.bucketCapacity) {
    return PET_BONUSES[activePet].bucketCapacity!;
  }
  return BUCKET_CAPACITY;
}

export function getEffectiveFillRate(_activePet?: PetId | null): number {
  return BUCKET_FILL_RATE;
}

export function getGrowthBonus(activePet?: PetId | null): number {
  if (activePet && PET_BONUSES[activePet]?.growthMultiplier) {
    return PET_BONUSES[activePet].growthMultiplier!;
  }
  return 1.0;
}

export function getHamsterGiftAmount(): number {
  return PET_BONUSES.hamster.giftAmount!;
}
