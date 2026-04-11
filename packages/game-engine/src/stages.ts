import { StageConfig } from './types.js';
import { DIFFICULTY_MULTIPLIERS } from './constants.js';

/**
 * Base percent-per-watering at x1.0 nutrition multiplier for a ★1 (easiest) crop.
 * Kauche-style non-linear progression: early stages fast, late stages grind.
 *
 * Calibrated so that a ★1 crop at x2.0 nutrition takes ~2,100 waterings
 * (~21,000g water, ~21 days at 1000g/day).
 *
 * ★2 crops (DIFF_MULT 1.65) → ~3,450 waterings, ~35 days
 * ★3 crops (DIFF_MULT 2.40) → ~5,000 waterings, ~50 days
 */
const BASE_STAGE_CONFIG: StageConfig[] = [
  { stageNumber: 1, percentPerWateringX1: 2.10 },
  { stageNumber: 2, percentPerWateringX1: 0.56 },
  { stageNumber: 3, percentPerWateringX1: 0.10 },
  { stageNumber: 4, percentPerWateringX1: 0.027 },
  { stageNumber: 5, percentPerWateringX1: 0.015 },
  { stageNumber: 6, percentPerWateringX1: 0.0075 },
];

/**
 * Stage boundaries as cumulative percent thresholds.
 * Stage 1: 0% → stage1_end%, Stage 2: stage1_end% → stage2_end%, etc.
 */
function computeStageBoundaries(configs: StageConfig[]): number[] {
  const boundaries: number[] = [0];
  let accumulated = 0;
  const totalStages = configs.length;

  for (let i = 0; i < totalStages - 1; i++) {
    const portionOfTotal = 100 / totalStages;
    accumulated += portionOfTotal;
    boundaries.push(parseFloat(accumulated.toFixed(3)));
  }
  boundaries.push(100);
  return boundaries;
}

const STAGE_BOUNDARIES = computeStageBoundaries(BASE_STAGE_CONFIG);

export function getStageForPercent(percent: number): number {
  for (let i = STAGE_BOUNDARIES.length - 1; i >= 1; i--) {
    if (percent >= STAGE_BOUNDARIES[i]) {
      return Math.min(i + 1, 6);
    }
  }
  return 1;
}

export function getStageBoundaries(): number[] {
  return [...STAGE_BOUNDARIES];
}

export function getPercentPerWatering(
  stage: number,
  difficultyStars: number
): number {
  const config = BASE_STAGE_CONFIG.find((s) => s.stageNumber === stage);
  if (!config) return 0;

  const diffMultiplier = DIFFICULTY_MULTIPLIERS[difficultyStars] ?? 1.0;
  return config.percentPerWateringX1 / diffMultiplier;
}

export function getStageConfigs(): StageConfig[] {
  return [...BASE_STAGE_CONFIG];
}
