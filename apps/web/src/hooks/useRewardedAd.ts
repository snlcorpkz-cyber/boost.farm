import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { sounds } from '../lib/sounds';
import { useRewardToast } from '../components/RewardToast';
import { requestRewardedAdNative } from '../lib/native';

type RewardType = 'water' | 'nutrition';

interface UseRewardedAdOptions {
  placement: string;
  rewardType: RewardType;
  // rewardAmount is only used for the fallback toast / UI hint. The server
  // always decides the real reward amount (C-1).
  rewardAmount?: number;
  onError?: (msg: string) => void;
}

export function useRewardedAd({ placement, rewardType, rewardAmount, onError }: UseRewardedAdOptions) {
  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  const [showFallbackAd, setShowFallbackAd] = useState(false);
  const [pending, setPending] = useState(false);
  const creditedKeyRef = useRef<string | null>(null);

  const creditReward = useCallback(async () => {
    // H-3/C-1: server authoritative, idempotent per request.
    const idempotencyKey = crypto.randomUUID();
    if (creditedKeyRef.current === idempotencyKey) return;
    creditedKeyRef.current = idempotencyKey;
    try {
      const res = await api<{ amount: number }>('/farm/ad-reward', {
        method: 'POST',
        body: JSON.stringify({ type: rewardType, placement, idempotencyKey }),
      });
      qc.invalidateQueries({ queryKey: ['farm'] });
      qc.invalidateQueries({ queryKey: ['ad-limits'] });
      sounds.rewardChime();
      const amount = res?.amount ?? rewardAmount ?? 0;
      if (amount > 0) {
        showReward(rewardType === 'water' ? 'water' : 'fertilizer', amount);
      }
    } catch (err: any) {
      onError?.(err?.message || 'Failed to credit ad reward');
    }
  }, [rewardType, rewardAmount, placement, qc, showReward, onError]);

  const requestAd = useCallback(() => {
    if (pending) return;

    setPending(true);

    const reqId = requestRewardedAdNative(placement, (result) => {
      setPending(false);
      if (result.placement === placement && result.success) {
        creditReward();
      } else {
        onError?.('Ad not available, please try again');
      }
    });

    if (reqId === null) {
      // No native bridge — use the fallback popup.
      setPending(false);
      setShowFallbackAd(true);
    }
  }, [placement, pending, creditReward, onError]);

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
