import { StageConfig } from './types.js';
import { DIFFICULTY_MULTIPLIERS } from './constants.js';

/**
 * Base percent-per-watering at x1.0 multiplier for a ★1 (easiest) crop.
 * Kauche-style non-linear progression: early stages fly, late stages grind.
 *
 * At x2.0 multiplier, the values double. The total waterings to reach 100%
 * for a ★1 crop at x2.0 is ~4000 waterings ≈ 40,000g water.
 */
const BASE_STAGE_CONFIG: StageConfig[] = [
  { stageNumber: 1, percentPerWateringX1: 8.4 },
  { stageNumber: 2, percentPerWateringX1: 1.65 },
  { stageNumber: 3, percentPerWateringX1: 0.31 },
  { stageNumber: 4, percentPerWateringX1: 0.079 },
  { stageNumber: 5, percentPerWateringX1: 0.044 },
  { stageNumber: 6, percentPerWateringX1: 0.026 },
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
