import {
  BUCKET_CAPACITY,
  BUCKET_FILL_RATE,
  WATER_PER_CLICK,
  NUTRITION_PER_WATERING,
  MULTIPLIER_THRESHOLDS,
  MAX_GROWTH_PERCENT,
  Phase,
} from './constants.js';
import { FarmState, WateringResult, BucketCollectResult, PhaseInfo } from './types.js';
import { getPercentPerWatering, getStageForPercent } from './stages.js';
import {
  PetId,
  getEffectiveBucketCapacity,
  getEffectiveFillRate,
  getGrowthBonus,
} from './pets.js';

export function getMultiplier(nutrition: number): number {
  if (nutrition >= MULTIPLIER_THRESHOLDS.HIGH.min) return MULTIPLIER_THRESHOLDS.HIGH.multiplier;
  if (nutrition >= MULTIPLIER_THRESHOLDS.MEDIUM.min) return MULTIPLIER_THRESHOLDS.MEDIUM.multiplier;
  return MULTIPLIER_THRESHOLDS.BASE.multiplier;
}

export function computeBucketWater(
  lastCollectedAt: Date,
  now: Date,
  activePet?: PetId | null
): number {
  const capacity = getEffectiveBucketCapacity(activePet);
  const fillRate = getEffectiveFillRate(activePet);
  const elapsedMs = now.getTime() - lastCollectedAt.getTime();
  const elapsedMinutes = Math.max(0, elapsedMs / 60000);
  return Math.min(capacity, parseFloat((elapsedMinutes * fillRate).toFixed(2)));
}

export function collectBucket(
  farm: FarmState,
  now: Date,
  activePet?: PetId | null
): BucketCollectResult {
  const collected = computeBucketWater(farm.bucketLastCollectedAt, now, activePet);
  return {
    collected,
    newWaterInCan: parseFloat((farm.waterInCan + collected).toFixed(2)),
    newBucketLevel: 0,
  };
}

export function performWatering(
  farm: FarmState,
  times: number,
  difficultyStars: number,
  activePet?: PetId | null
): WateringResult {
  const totalWaterCost = WATER_PER_CLICK * times;
  const totalNutritionCost = NUTRITION_PER_WATERING * times;

  if (farm.waterInCan < totalWaterCost) {
    throw new Error('NOT_ENOUGH_WATER');
  }

  const petGrowthBonus = getGrowthBonus(activePet);

  let currentPercent = farm.growthPercent;
  let currentNutrition = farm.nutrition;
  let currentStage = farm.currentStage;
  const startStage = currentStage;

  for (let i = 0; i < times; i++) {
    const multiplier = getMultiplier(currentNutrition);
    const basePercent = getPercentPerWatering(currentStage, difficultyStars);
    const growth = parseFloat((basePercent * multiplier * petGrowthBonus).toFixed(3));

    currentPercent = parseFloat(Math.min(MAX_GROWTH_PERCENT, currentPercent + growth).toFixed(3));
    currentNutrition = Math.max(0, currentNutrition - NUTRITION_PER_WATERING);

    const newStage = getStageForPercent(currentPercent);
    if (newStage > currentStage) {
      currentStage = newStage;
    }
  }

  const harvested = currentPercent >= MAX_GROWTH_PERCENT;

  return {
    newGrowthPercent: currentPercent,
    newStage: currentStage,
    newWaterInCan: parseFloat((farm.waterInCan - totalWaterCost).toFixed(2)),
    newNutrition: currentNutrition,
    stageChanged: currentStage !== startStage,
    harvested,
    waterConsumed: totalWaterCost,
    nutritionConsumed: Math.min(farm.nutrition, totalNutritionCost),
  };
}

export function getCurrentPhase(localHour: number): Phase {
  if (localHour >= 4 && localHour <= 10) return 'morning';
  if (localHour >= 11 && localHour <= 16) return 'afternoon';
  return 'evening';
}

export function getPhaseInfo(localHour: number): PhaseInfo {
  const phase = getCurrentPhase(localHour);

  let hoursRemaining: number;
  switch (phase) {
    case 'morning':
      hoursRemaining = 10 - localHour;
      break;
    case 'afternoon':
      hoursRemaining = 16 - localHour;
      break;
    case 'evening':
      hoursRemaining = localHour >= 17 ? (24 - localHour + 4) : (4 - localHour);
      break;
  }

  return { phase, hoursRemaining };
}
