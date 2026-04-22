import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { sounds } from '../lib/sounds';
import { useRewardToast } from '../components/RewardToast';
import { requestRewardedAdNative, isAndroid, isRewardFallbackEligible } from '../lib/native';
import { trackClient } from '../lib/track';

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
      trackClient('ad.server_granted', { type: rewardType, amount: res?.amount ?? 0, idempotencyKey }, { placement });
      const amount = res?.amount ?? rewardAmount ?? 0;
      if (amount > 0) {
        showReward(rewardType === 'water' ? 'water' : 'fertilizer', amount);
      }
    } catch (err: any) {
      trackClient('ad.failed', { stage: 'server_grant', error_message: err?.message ?? 'unknown' }, { placement });
      onError?.(err?.message || 'Failed to credit ad reward');
    }
  }, [rewardType, rewardAmount, placement, qc, showReward, onError]);

  const requestAd = useCallback(() => {
    if (pending) return;

    setPending(true);
    trackClient('ad.requested', { ad_unit: 'rewarded', type: rewardType, has_native: isAndroid() }, { placement });

    const reqId = requestRewardedAdNative(placement, (result) => {
      setPending(false);
      if (result.placement === placement && result.success) {
        creditReward();
        return;
      }
      // Granular cause (no_fill / failed / closed_unrewarded) is emitted by
      // the native bridge via the ad-event forwarder in lib/native.ts — we
      // just log the terminal outcome here for completeness.
      trackClient('ad.closed', { rewarded: false, reason: result.reason ?? null }, { placement });

      if (isRewardFallbackEligible(result.reason)) {
        // The ad network simply couldn't serve an ad (SDK still initialising,
        // ironSource account pending review, offline, no fill). Users are
        // not at fault — transparently fall back to the mock-ad flow so
        // they still get their reward.
        trackClient(
          'ad.fallback_shown',
          { reason: result.reason ?? 'unavailable', trigger: 'native_unavailable' },
          { placement },
        );
        setShowFallbackAd(true);
      } else if (result.reason === 'concurrent') {
        onError?.('Another ad is already loading. Please try again.');
      }
      // `closed_unrewarded` is a deliberate skip — no reward, no toast.
    });

    if (reqId === null) {
      // No native bridge — use the fallback popup.
      setPending(false);
      trackClient('ad.no_fill', { reason: 'no_native_bridge' }, { placement });
      setShowFallbackAd(true);
    }
  }, [placement, pending, creditReward, onError, rewardType]);

  const handleFallbackComplete = useCallback(async (r: { amount: number }) => {
    if (r.amount) {
      trackClient('ad.rewarded', { fallback: true, reward_amount: r.amount }, { placement });
      await creditReward();
    } else {
      trackClient('ad.closed', { fallback: true, rewarded: false }, { placement });
    }
  }, [creditReward, placement]);

  const closeFallback = useCallback(() => setShowFallbackAd(false), []);

  return {
    requestAd,
    pending,
    showFallbackAd,
    closeFallback,
    handleFallbackComplete,
  };
}
