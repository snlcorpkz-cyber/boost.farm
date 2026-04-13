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

function getBridge() {
  try {
    const b = (window as any).EcoFarmAndroid;
    if (!b || !b.requestRewardedAd) return null;
    return b;
  } catch {
    return null;
  }
}

export function useRewardedAd({ placement, rewardType, rewardAmount, onError }: UseRewardedAdOptions) {
  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  const [showFallbackAd, setShowFallbackAd] = useState(false);
  const [pending, setPending] = useState(false);
  const callbackRef = useRef<((e: any) => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (callbackRef.current) {
        delete (window as any).__ecoFarmNative?.onRewardedFinished;
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
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

    const nativeBridge = getBridge();
    if (!nativeBridge) {
      setShowFallbackAd(true);
      return;
    }

    setPending(true);

    const native = (window as any).__ecoFarmNative ??= {};
    native.onRewardedFinished = (payload: any) => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (p.placement === placement && p.success) {
        creditReward();
        setPending(false);
      } else {
        setPending(false);
        setShowFallbackAd(true);
      }
    };
    callbackRef.current = native.onRewardedFinished;

    timeoutRef.current = setTimeout(() => {
      setPending(false);
      setShowFallbackAd(true);
    }, 8000);

    try {
      nativeBridge.requestRewardedAd(JSON.stringify({ placement }));
    } catch {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
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
