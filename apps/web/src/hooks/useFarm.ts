import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useRewardToast } from '../components/RewardToast';
import { haptic } from '../lib/native';
import { reportBucketCollected, reportFirstWater, reportLevelAchieved } from '../lib/marketing';

export function useFarm() {
  return useQuery({
    queryKey: ['farm'],
    queryFn: () => api('/farm'),
    refetchInterval: 10_000,
  });
}

export function useCollectBucket() {
  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  return useMutation({
    mutationFn: (opts?: { adWatched?: boolean }) =>
      api<{ collected: number; bucketAdRequired: boolean; freeCollectsRemaining: number }>(
        '/farm/collect-bucket',
        { method: 'POST', body: JSON.stringify(opts ?? {}) },
      ),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      if (data.collected > 0) {
        showReward('water', data.collected);
        // Bucket payouts split into ad-gated vs free in AF dashboards so
        // ROAS reports can isolate ad-incentivised engagement.
        reportBucketCollected(vars?.adWatched ? 'ad' : 'free');
      }
    },
    onError: () => {
      // Bucket tipped but server rejected — let the thumb know.
      // The Bucket component already fired 'impact' on the tap, so
      // this 'error' creates a clear start→fail contrast rather than
      // a silent no-op.
      haptic('error');
      qc.invalidateQueries({ queryKey: ['farm'] });
    },
  });
}

// H-3: For watering, idempotency must be per *user intent* (one tap = one key),
// not per mutation invocation (which triggers a new key even for retries).
// The caller supplies the key; mutation just forwards it.
export interface WaterPayload {
  times: 1 | 5 | 20;
  idempotencyKey: string;
}

export interface WaterResponse {
  newStage: number;
  newGrowthPercent: number;
  newWaterInCan: number;
  newNutrition: number;
  waterConsumed: number;
  harvested: boolean;
  stageUpBonus: number;
}

export function useWater() {
  const qc = useQueryClient();
  return useMutation<WaterResponse, any, WaterPayload>({
    mutationFn: ({ times, idempotencyKey }) =>
      api<WaterResponse>('/farm/water', {
        method: 'POST',
        body: JSON.stringify({ times, idempotencyKey }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      // First successful water = onboarding-complete-equivalent micro-signal
      // for AppsFlyer; latched in `marketing.ts` so subsequent waters
      // don't re-fire. Pairs with `_markFirstAdWatched` to compose the
      // EngagedD0 signal client-side.
      reportFirstWater();
      // Stage-up analytics for AF level dashboards. The signal is
      // `stageUpBonus > 0` — that's how the server tells us a stage
      // boundary was actually crossed in this call (not just "current
      // stage is N"). Marketing helper latches per-level so a player
      // who replays through a previously-cleared stage doesn't
      // re-fire it.
      if (
        data &&
        typeof data.stageUpBonus === 'number' &&
        data.stageUpBonus > 0 &&
        typeof data.newStage === 'number'
      ) {
        reportLevelAchieved(data.newStage);
      }
    },
  });
}

export function useFertilize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amount: number) =>
      api('/farm/fertilize', {
        method: 'POST',
        body: JSON.stringify({ amount }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['farm'] }),
  });
}

export function useNewCrop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) =>
      api('/farm/new-crop', {
        method: 'POST',
        body: JSON.stringify({ productId }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['farm'], {
        farm: data.farm,
        needsCropSelection: false,
      });
    },
  });
}
