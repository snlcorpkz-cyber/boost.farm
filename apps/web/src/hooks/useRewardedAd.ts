import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { sounds } from '../lib/sounds';
import { useRewardToast } from '../components/RewardToast';
import { requestRewardedAdNative, isAndroid, isRewardFallbackEligible } from '../lib/native';
import { trackClient } from '../lib/track';
import { reportAdWatchedRewarded } from '../lib/marketing';

type RewardType = 'water' | 'nutrition';

interface UseRewardedAdOptions {
  placement: string;
  rewardType: RewardType;
  // rewardAmount is only used for the fallback toast / UI hint. The server
  // always decides the real reward amount (C-1).
  rewardAmount?: number;
  onError?: (msg: string) => void;
}

function newAttemptId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function useRewardedAd({ placement, rewardType, rewardAmount, onError }: UseRewardedAdOptions) {
  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  const [showFallbackAd, setShowFallbackAd] = useState(false);
  const [pending, setPending] = useState(false);
  // Each user click gets a fresh attempt_id that we stamp into every
  // ad.* event, so the admin funnel can correlate stages via
  // `count(DISTINCT properties->>'attempt_id')` instead of counting raw
  // emissions (which inflate when the same event fires twice).
  const attemptIdRef = useRef<string | null>(null);
  // Guard ref that ensures ad.rewarded fires at most once per attempt,
  // even if the mock modal's completion callback is invoked twice (e.g.
  // fast double-tap or a re-render racing the close animation).
  const rewardedFiredRef = useRef<string | null>(null);
  const creditedKeyRef = useRef<string | null>(null);

  const creditReward = useCallback(async () => {
    const attemptId = attemptIdRef.current ?? newAttemptId();
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
      trackClient(
        'ad.server_granted',
        { type: rewardType, amount: res?.amount ?? 0, idempotencyKey, attempt_id: attemptId },
        { placement },
      );
      // Mirror the server-confirmed reward to AppsFlyer. We deliberately
      // wait for the server-grant (not the SDK rewarded callback) so AF
      // and our backend agree on what counts as a real ad watch — the
      // SDK can fire `rewarded` for fallback flows that the server later
      // rejects as ineligible.
      reportAdWatchedRewarded({
        placement,
        attemptId,
        rewardType,
        amount: res?.amount ?? 0,
      });
      const amount = res?.amount ?? rewardAmount ?? 0;
      if (amount > 0) {
        showReward(rewardType === 'water' ? 'water' : 'fertilizer', amount);
      }
    } catch (err: any) {
      trackClient(
        'ad.failed',
        { stage: 'server_grant', error_message: err?.message ?? 'unknown', attempt_id: attemptId },
        { placement },
      );
      onError?.(err?.message || 'Failed to credit ad reward');
    }
  }, [rewardType, rewardAmount, placement, qc, showReward, onError]);

  const requestAd = useCallback(() => {
    if (pending) return;

    setPending(true);
    const attemptId = newAttemptId();
    attemptIdRef.current = attemptId;
    rewardedFiredRef.current = null;
    trackClient(
      'ad.requested',
      {
        ad_unit: 'rewarded',
        type: rewardType,
        has_native: isAndroid(),
        attempt_id: attemptId,
      },
      { placement },
    );

    const reqId = requestRewardedAdNative(placement, (result) => {
      setPending(false);
      if (result.placement === placement && result.success) {
        creditReward();
        return;
      }
      // Granular cause (no_fill / failed / closed_unrewarded) is emitted by
      // the native bridge via the ad-event forwarder in lib/native.ts — we
      // just log the terminal outcome here for completeness.
      trackClient(
        'ad.closed',
        { rewarded: false, reason: result.reason ?? null, attempt_id: attemptId },
        { placement },
      );

      if (isRewardFallbackEligible(result.reason)) {
        // The ad network simply couldn't serve an ad (SDK still initialising,
        // ironSource account pending review, offline, no fill). Users are
        // not at fault — transparently fall back to the mock-ad flow so
        // they still get their reward.
        trackClient(
          'ad.fallback_shown',
          {
            reason: result.reason ?? 'unavailable',
            trigger: 'native_unavailable',
            attempt_id: attemptId,
          },
          { placement },
        );
        setShowFallbackAd(true);
      } else if (result.reason === 'concurrent') {
        onError?.('Another ad is already loading. Please try again.');
      }
      // `closed_unrewarded` is a deliberate skip — no reward, no toast.
    }, { attemptId });

    if (reqId === null) {
      // No native bridge — use the fallback popup.
      setPending(false);
      trackClient(
        'ad.no_fill',
        { reason: 'no_native_bridge', attempt_id: attemptId },
        { placement },
      );
      trackClient(
        'ad.fallback_shown',
        { reason: 'no_native_bridge', trigger: 'web_only', attempt_id: attemptId },
        { placement },
      );
      setShowFallbackAd(true);
    }
  }, [placement, pending, creditReward, onError, rewardType]);

  const handleFallbackComplete = useCallback(
    async (r: { amount: number }) => {
      const attemptId = attemptIdRef.current;
      if (r.amount) {
        // Guard: the mock modal may re-invoke onComplete if the user
        // double-taps the "collect" button before it unmounts. Only let
        // ad.rewarded + the server credit fire once per attempt.
        if (attemptId && rewardedFiredRef.current === attemptId) return;
        if (attemptId) rewardedFiredRef.current = attemptId;
        trackClient(
          'ad.rewarded',
          { fallback: true, reward_amount: r.amount, attempt_id: attemptId },
          { placement },
        );
        await creditReward();
      } else {
        trackClient(
          'ad.closed',
          { fallback: true, rewarded: false, attempt_id: attemptId },
          { placement },
        );
      }
    },
    [creditReward, placement],
  );

  const closeFallback = useCallback(() => setShowFallbackAd(false), []);

  return {
    requestAd,
    pending,
    showFallbackAd,
    closeFallback,
    handleFallbackComplete,
  };
}
