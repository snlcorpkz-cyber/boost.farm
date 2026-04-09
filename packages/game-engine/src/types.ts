export interface FarmState {
  id: string;
  userId: string;
  productId: string;
  growthPercent: number;
  currentStage: number;
  waterInCan: number;
  waterInBucket: number;
  nutrition: number;
  bucketLastCollectedAt: Date;
  totalWateringsToday: number;
  dayResetAt: Date;
  harvested: boolean;
  createdAt: Date;
}

export interface Product {
  id: string;
  nameKey: string;
  difficultyStars: number;
  baseWaterRequired: number;
  imageUrl: string;
  active: boolean;
  couponValidityDays: number;
}

export interface StageConfig {
  stageNumber: number;
  percentPerWateringX1: number;
}

export interface WateringResult {
  newGrowthPercent: number;
  newStage: number;
  newWaterInCan: number;
  newNutrition: number;
  stageChanged: boolean;
  harvested: boolean;
  waterConsumed: number;
  nutritionConsumed: number;
}

export interface BucketCollectResult {
  collected: number;
  newWaterInCan: number;
  newBucketLevel: number;
}

export interface PhaseInfo {
  phase: 'morning' | 'afternoon' | 'evening';
  hoursRemaining: number;
}
