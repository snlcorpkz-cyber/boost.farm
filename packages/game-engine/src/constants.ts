export const BUCKET_CAPACITY = 30;
export const BUCKET_FILL_RATE = 0.6; // grams per minute (30g in 50 min)
export const WATER_PER_CLICK = 20;
export const NUTRITION_PER_WATERING = 1;

export const MULTIPLIER_THRESHOLDS = {
  BASE: { min: 0, max: 0, multiplier: 1.0 },
  MEDIUM: { min: 1, max: 44, multiplier: 1.5 },
  HIGH: { min: 45, max: Infinity, multiplier: 2.0 },
} as const;

export const GROWTH_STAGES = 6;
export const MAX_GROWTH_PERCENT = 100;

export const PHASES = {
  MORNING: { start: 4, end: 10, key: 'morning' },
  AFTERNOON: { start: 11, end: 16, key: 'afternoon' },
  EVENING: { start: 17, end: 3, key: 'evening' },
} as const;

export type Phase = 'morning' | 'afternoon' | 'evening';

export const QUEST_LIMITS = {
  GREET_PER_PHASE: 10,
  WATER_FRIEND_PER_PHASE: 10,
  ADS_PER_PHASE: 3,
  CHECKIN_PER_PHASE: 1,
  REFERRAL_REWARDS_PER_DAY: 3,
} as const;

export const REFERRAL_REWARDS = {
  NUTRITION: 100,
} as const;

export const FRIEND_WATERING_COST = 20;
export const WATERING_BATCH_SIZES = [1, 5, 20] as const;

// ── Rank system ──
export type RankId = 'novice' | 'amateur' | 'farmer' | 'master';

export interface RankDef {
  id: RankId;
  minWaterLastMonth: number;
  loginWater: number;
  loginFertilizer: number;
  greetWater: number;
  waterFriendFert: number;
  adWater: number;
  adFertilizer: number;
  dailyChallengeWaterReq: number;
  dailyChallengeReward: number;
}

export const RANKS: RankDef[] = [
  { id: 'novice',  minWaterLastMonth: 0,     loginWater: 15, loginFertilizer: 3, greetWater: 8,  waterFriendFert: 1, adWater: 25, adFertilizer: 5, dailyChallengeWaterReq: 100, dailyChallengeReward: 20 },
  { id: 'amateur', minWaterLastMonth: 5000,  loginWater: 25, loginFertilizer: 5, greetWater: 12, waterFriendFert: 2, adWater: 35, adFertilizer: 7, dailyChallengeWaterReq: 150, dailyChallengeReward: 30 },
  { id: 'farmer',  minWaterLastMonth: 17000, loginWater: 35, loginFertilizer: 7, greetWater: 15, waterFriendFert: 2, adWater: 45, adFertilizer: 8, dailyChallengeWaterReq: 200, dailyChallengeReward: 40 },
  { id: 'master',  minWaterLastMonth: 35000, loginWater: 50, loginFertilizer: 7, greetWater: 15, waterFriendFert: 3, adWater: 55, adFertilizer: 8, dailyChallengeWaterReq: 400, dailyChallengeReward: 80 },
];

export function getRankForWater(waterLastMonth: number): RankDef {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (waterLastMonth >= RANKS[i].minWaterLastMonth) return RANKS[i];
  }
  return RANKS[0];
}

export const DIFFICULTY_MULTIPLIERS: Record<number, number> = {
  1: 1.0,
  2: 1.5,
  3: 2.2,
};
