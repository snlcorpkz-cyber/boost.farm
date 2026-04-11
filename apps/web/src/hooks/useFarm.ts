import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useRewardToast } from '../components/RewardToast';

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
    mutationFn: () => api<{ collected: number }>('/farm/collect-bucket', { method: 'POST' }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      if (data.collected > 0) showReward('water', data.collected);
    },
  });
}

export function useWater() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (times: number) =>
      api('/farm/water', {
        method: 'POST',
        body: JSON.stringify({
          times,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['farm'] }),
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
