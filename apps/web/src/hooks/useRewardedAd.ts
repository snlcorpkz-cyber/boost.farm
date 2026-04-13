import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { sounds } from '../lib/sounds';
import { useRewardToast } from '../components/RewardToast';

type RewardType = 'water' | 'nutrition';

interface UseRewardedAdOptions {
  placement: string;
  rewardType: RewardType;
  rewardAmount: number;
  onError?: (msg: string) => void;
}

const bridge = () => (window as any).EcoFarmAndroid;
const isNative = () => !!bridge()?.requestRewardedAd;

export function useRewardedAd({ placement, rewardType, rewardAmount, onError }: UseRewardedAdOptions) {
  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  const [showFallbackAd, setShowFallbackAd] = useState(false);
  const [pending, setPending] = useState(false);
  const callbackRef = useRef<((e: any) => void) | null>(null);

  useEffect(() => {
    return () => {
      if (callbackRef.current) {
        delete (window as any).__ecoFarmNative?.onRewardedFinished;
      }
    };
  }, []);

  const creditReward = useCallback(async () => {
    try {
      await api('/farm/ad-reward', {
        method: 'POST',
        body: JSON.stringify({ type: rewardType, amount: rewardAmount }),
      });
      qc.invalidateQueries({ queryKey: ['farm'] });
      sounds.rewardChime();
      showReward(rewardType === 'water' ? 'water' : 'fertilizer', rewardAmount);
    } catch (err: any) {
      onError?.(err?.message || 'Failed to credit ad reward');
    }
  }, [rewardType, rewardAmount, qc, showReward, onError]);

  const requestAd = useCallback(() => {
    if (pending) return;

    if (!isNative()) {
      setShowFallbackAd(true);
      return;
    }

    setPending(true);

    const native = (window as any).__ecoFarmNative ??= {};
    native.onRewardedFinished = (payload: any) => {
      const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (p.placement === placement && p.success) {
        creditReward();
      }
      setPending(false);
    };
    callbackRef.current = native.onRewardedFinished;

    try {
      bridge().requestRewardedAd(JSON.stringify({ placement }));
    } catch {
      setPending(false);
      setShowFallbackAd(true);
    }
  }, [placement, pending, creditReward]);

  const handleFallbackComplete = useCallback(async (r: { amount: number }) => {
    if (r.amount) await creditReward();
  }, [creditReward]);

  const closeFallback = useCallback(() => setShowFallbackAd(false), []);

  return {
    requestAd,
    pending,
    showFallbackAd,
    closeFallback,
    handleFallbackComplete,
  };
}
