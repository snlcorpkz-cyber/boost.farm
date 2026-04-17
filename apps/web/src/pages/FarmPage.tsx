import { useState, useCallback, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import type { PetId } from '@eco-farm/game-engine';
import { useFarm, useCollectBucket, useWater } from '../hooks/useFarm';
import { useBucketTimer } from '../hooks/useBucketTimer';
import { usePhase } from '../hooks/usePhase';
import { api } from '../lib/api';
import { sounds } from '../lib/sounds';
import { AVATAR_IMAGES, PET_IMAGES, HAMSTER_FRAMES, MONKEY_FRAMES, RABBIT_FRAMES, UI, getCropBase } from '../lib/assets';
import Background from '../components/farm/Background';
import Plant, { getPlantLayout } from '../components/farm/Plant';
import Bucket from '../components/farm/Bucket';
import WateringCan from '../components/farm/WateringCan';
import ProgressBar from '../components/farm/ProgressBar';
import PetsPanel from '../components/PetsPanel';
import WaterPopup from '../components/farm/WaterPopup';
import FertilizerPopup from '../components/farm/FertilizerPopup';
import NutritionPopup from '../components/farm/NutritionPopup';
import StageCelebration from '../components/farm/StageCelebration';
import NotificationsPopup from '../components/NotificationsPopup';
import InvitePopup from '../components/InvitePopup';
import { useRewardToast } from '../components/RewardToast';
import { useEventToast } from '../components/EventToast';
import FarmTutorial from '../components/FarmTutorial';
import MockAdModal from '../components/MockAdModal';
import RankModal from '../components/RankModal';
import BottomNav from '../components/farm/BottomNav';
import { requestRewardedAdNative } from '../lib/native';


export default function FarmPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, error: farmError } = useFarm();
  const { phase } = usePhase();
  const hour = new Date().getHours();
  const isNight = hour >= 22 || hour < 4;
  const isDark = phase !== 'afternoon' || isNight;
  const collectBucket = useCollectBucket();
  const water = useWater();
  const [isWatering, setIsWatering] = useState(false);
  const [showPets, setShowPets] = useState(false);
  const [showWaterPopup, setShowWaterPopup] = useState(false);
  const [showFertPopup, setShowFertPopup] = useState(false);
  const [canShaking, setCanShaking] = useState(false);
  const [showNutritionPopup, setShowNutritionPopup] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationStage, setCelebrationStage] = useState(0);
  const [showNotifPopup, setShowNotifPopup] = useState(false);
  const [showInvitePopup, setShowInvitePopup] = useState(false);
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [challengeRewardAmount, setChallengeRewardAmount] = useState(0);
  const [showRankModal, setShowRankModal] = useState(false);
  const prevStageRef = useRef<number | null>(null);
  const soundEnabled = useSyncExternalStore(
    (cb) => sounds.subscribe(cb),
    () => sounds.enabled,
  );

  useEffect(() => {
    sounds.initBackground();

    if (!sounds.enabled) return;
    const kick = () => {
      sounds.initBackground();
      document.removeEventListener('pointerdown', kick);
      document.removeEventListener('touchstart', kick);
    };
    document.addEventListener('pointerdown', kick, { once: true });
    document.addEventListener('touchstart', kick, { once: true });
    return () => {
      document.removeEventListener('pointerdown', kick);
      document.removeEventListener('touchstart', kick);
    };
  }, []);

  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  const { showEvent } = useEventToast();

  const { data: friendsData } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api('/friends'),
    refetchInterval: 15_000,
  });

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: any[]; unreadCount: number }>('/user/notifications'),
    refetchInterval: 20_000,
  });

  const { data: petsData } = useQuery({
    queryKey: ['pets'],
    queryFn: () => api<{ pets: { id: PetId; is_active: boolean; unlocked: boolean; last_gift_at: string | null }[] }>('/pets'),
  });

  const { data: dailyChallengeData } = useQuery({
    queryKey: ['daily-challenge'],
    queryFn: () => api<{
      waterGiven: number; required: number; completed: boolean; rewardClaimed: boolean;
      reward: number; streakDays: number; progress: number;
      tomorrowReward: number | null;
      pendingReward: { amount: number; date: string; streakDays: number } | null;
    }>('/quests/daily-challenge'),
    refetchInterval: 30_000,
  });

  const claimChallenge = useMutation({
    mutationFn: () => api<{ rewardAmount: number; streakDays: number }>('/quests/daily-challenge/claim', { method: 'POST' }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['daily-challenge'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
      setChallengeRewardAmount(res.rewardAmount);
      setShowChallengeModal(true);
      sounds.rewardChime();
      showReward('water', res.rewardAmount);
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['daily-challenge'] });
    },
  });

  const claimGift = useMutation({
    mutationFn: () => api<{ waterEarned: number }>('/pets/hamster/gift', { method: 'POST' }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['pets'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
      showReward('water', data.waterEarned);
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['pets'] });
    },
  });

  const farm = data?.farm;

  const lastNotifCount = useRef<number | null>(null);
  useEffect(() => {
    if (!notifData) return;
    const current = notifData.unreadCount;
    if (lastNotifCount.current !== null && current > lastNotifCount.current) {
      const notifs = notifData.notifications || [];
      const eventTypes = ['invite', 'water', 'greet'];
      for (const n of notifs.slice(0, current - lastNotifCount.current)) {
        if (!n.read && eventTypes.includes(n.type)) {
          const name = n.params?.name || n.name || 'Someone';
          showEvent(n.type as 'invite' | 'water' | 'greet', String(name));
        }
      }
      qc.invalidateQueries({ queryKey: ['friends'] });
    }
    lastNotifCount.current = current;
  }, [notifData?.unreadCount]);

  const dropOffsets = useRef(
    Array.from({ length: 12 }, () => ({
      left: -20 + Math.random() * 40,
      yEnd: 30 + Math.random() * 20,
      duration: 0.5 + Math.random() * 0.3,
    }))
  );

  const pendingShown = useRef(false);
  useEffect(() => {
    if (!dailyChallengeData?.pendingReward || pendingShown.current) return;
    pendingShown.current = true;
    setShowChallengeModal(true);
    setChallengeRewardAmount(dailyChallengeData.pendingReward.amount);
  }, [dailyChallengeData?.pendingReward]);

  useEffect(() => {
    if (!farm) return;
    const currentStage = farm.current_stage;
    if (prevStageRef.current !== null && currentStage > prevStageRef.current) {
      setCelebrationStage(currentStage);
      setShowCelebration(true);
      // H-9: show the real bonus amount if we just received it from /farm/water,
      // otherwise fall back to the default configured constant (100).
      const bonus = pendingStageBonusRef.current ?? 100;
      pendingStageBonusRef.current = null;
      showReward('water', bonus, 'Level-up bonus!');
    }
    prevStageRef.current = currentStage;
  }, [farm?.current_stage]);

  const activePet: PetId | null = petsData?.pets?.find((p) => p.is_active)?.id ?? (farm?.active_pet as PetId | undefined) ?? null;

  const { bucketLevel, fillPercent, isFull, capacity: bucketCapacity } = useBucketTimer(
    farm?.bucket_last_collected_at || null,
    activePet
  );

  const [showBucketAd, setShowBucketAd] = useState(false);
  const bucketAdPendingRef = useRef(false);
  const [bucketAdPending, setBucketAdPending] = useState(false);

  const handleCollect = useCallback((adWatched?: boolean) => {
    collectBucket.mutate(adWatched ? { adWatched: true } : undefined);
  }, [collectBucket]);

  const handleBucketAdRequest = useCallback(() => {
    if (bucketAdPendingRef.current) return;
    bucketAdPendingRef.current = true;
    setBucketAdPending(true);

    // H-2: use requestId-based routing so this callback never gets clobbered
    // by a concurrent ad (e.g. water/fert popup).
    const reqId = requestRewardedAdNative('bucket_collect', (result) => {
      bucketAdPendingRef.current = false;
      setBucketAdPending(false);
      if (result.success) {
        sounds.bucketCollectToCan();
        handleCollect(true);
      }
    });

    if (reqId === null) {
      bucketAdPendingRef.current = false;
      setBucketAdPending(false);
      setShowBucketAd(true);
    }
  }, [handleCollect]);

  const handleBucketAdComplete = useCallback((r: { amount: number }) => {
    setShowBucketAd(false);
    bucketAdPendingRef.current = false;
    setBucketAdPending(false);
    if (r.amount) {
      sounds.bucketCollectToCan();
      handleCollect(true);
    }
  }, [handleCollect]);

  const triggerCanShake = useCallback(() => {
    setCanShaking(true);
    setTimeout(() => setCanShaking(false), 600);
  }, []);

  const [hamsterFrame, setHamsterFrame] = useState(0);
  const [monkeyFrame, setMonkeyFrame] = useState(0);
  const [rabbitFrame, setRabbitFrame] = useState(0);

  // H-3: one idempotency key per user intent (one tap on a batch button).
  // Even if the network is flaky and the mutation auto-retries, the server
  // will reject duplicates instead of watering twice.
  const handleWater = useCallback(
    (times: 1 | 5 | 20) => {
      setIsWatering(true);
      const idempotencyKey = crypto.randomUUID();
      water.mutate(
        { times, idempotencyKey },
        {
          onSuccess: (res) => {
            // H-9: use the actual server-granted bonus amount.
            if (res?.stageUpBonus && res.stageUpBonus > 0) {
              pendingStageBonusRef.current = res.stageUpBonus;
            }
          },
          onSettled: () => {
            setTimeout(() => setIsWatering(false), 1200);
          },
        }
      );
    },
    [water]
  );

  const pendingStageBonusRef = useRef<number | null>(null);

  const hamsterPet = petsData?.pets?.find((p) => p.id === 'hamster');
  const giftCooldownMs = 24 * 60 * 60 * 1000;
  const hamsterGiftReady = hamsterPet
    ? !hamsterPet.last_gift_at || (Date.now() - new Date(hamsterPet.last_gift_at).getTime() >= giftCooldownMs)
    : false;
  const showGiftOnPet = activePet === 'hamster' && hamsterGiftReady;

  useEffect(() => {
    if (activePet !== 'hamster' && activePet !== null && activePet !== undefined) return;
    if (showGiftOnPet) return;
    const interval = setInterval(() => {
      setHamsterFrame((prev) => (prev + 1) % HAMSTER_FRAMES.length);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [activePet, showGiftOnPet]);

  useEffect(() => {
    if (activePet !== 'monkey') return;
    const interval = setInterval(() => {
      setMonkeyFrame((prev) => (prev + 1) % MONKEY_FRAMES.length);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [activePet]);

  useEffect(() => {
    if (activePet !== 'rabbit') return;
    const interval = setInterval(() => {
      setRabbitFrame((prev) => (prev + 1) % RABBIT_FRAMES.length);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [activePet]);

  const activePetImage = (() => {
    if (!activePet || activePet === 'hamster') {
      if (showGiftOnPet) return PET_IMAGES.hamsterGift;
      return HAMSTER_FRAMES[hamsterFrame];
    }
    if (activePet === 'monkey') {
      return MONKEY_FRAMES[monkeyFrame];
    }
    if (activePet === 'rabbit') {
      return RABBIT_FRAMES[rabbitFrame];
    }
    return PET_IMAGES[activePet];
  })();

  const handlePetClick = () => {
    setShowPets(true);
  };

  const shouldSelectCrop = !isLoading && !farmError && (!farm || data?.needsCropSelection);

  useEffect(() => {
    if (shouldSelectCrop) {
      navigate('/select-crop', { replace: true });
    }
  }, [shouldSelectCrop, navigate]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-green-50">
        <img src="/assets/logo.webp" alt="Boost Farm" className="w-32 h-auto animate-pulse" />
      </div>
    );
  }

  if (farmError) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-green-50 px-6 gap-4">
        <span className="text-5xl">⚠️</span>
        <p className="text-sm text-gray-600 text-center">
          {(farmError as any)?.message || 'Connection error'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-green-500 text-white rounded-xl font-bold text-sm"
        >
          {t('notif.load_more') || 'Retry'}
        </button>
      </div>
    );
  }

  if (shouldSelectCrop) {
    return null;
  }

  const productName = farm.products?.name_key ? t(farm.products.name_key) : 'Plant';
  const fixedLayout = getPlantLayout();
  const baseWidth = fixedLayout.baseWidth;

  return (
    <Background>
      <div className="flex flex-col h-[100dvh]">
        {/* ═══ TOP BAR ═══ */}
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <button
            className="relative w-9 h-9 rounded-full bg-white/70 backdrop-blur-sm flex items-center justify-center shadow-sm border border-white/50"
            onClick={() => setShowNotifPopup(true)}
          >
            <img src={UI.bell} alt="notifications" className="w-5 h-5 object-contain" />
            {(notifData?.unreadCount ?? 0) > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[7px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                {notifData!.unreadCount > 9 ? '9+' : notifData!.unreadCount}
              </span>
            )}
          </button>

          <div className="flex items-center gap-1.5">
            {data?.rank && (
              <button
                onClick={() => setShowRankModal(true)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 shadow-sm text-[10px] font-bold ${
                  data.rank === 'master' ? 'bg-gradient-to-r from-yellow-400 to-amber-500 text-white' :
                  data.rank === 'farmer' ? 'bg-gradient-to-r from-blue-400 to-blue-600 text-white' :
                  data.rank === 'amateur' ? 'bg-gradient-to-r from-green-400 to-green-600 text-white' :
                  'bg-white/50 backdrop-blur-sm text-gray-600'
                }`}
              >
                <span>{data.rank === 'master' ? 'Master' : data.rank === 'farmer' ? 'Farmer' : data.rank === 'amateur' ? 'Amateur' : 'Novice'}</span>
              </button>
            )}
            <div className="flex items-center gap-1 bg-white/50 backdrop-blur-sm rounded-full px-2.5 py-1 shadow-sm">
              <img src={UI.waterDrop} alt="" className="w-3 h-3" />
              <span className="text-[10px] font-bold text-blue-700 tabular-nums">
                {(farm.total_water_this_month ?? 0).toFixed(0)}g
              </span>
              <span className="text-[8px] text-gray-500 ml-0.5">
                {new Date().toLocaleString(i18n.language, { month: 'short' })}
              </span>
            </div>
          </div>

          <button
            className="relative w-9 h-9 rounded-full bg-white/70 backdrop-blur-sm flex items-center justify-center shadow-sm border border-white/50"
            onClick={() => sounds.toggle()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={soundEnabled ? 'text-gray-700' : 'text-gray-400'}>
              {soundEnabled ? (
                <>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </>
              ) : (
                <>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </>
              )}
            </svg>
          </button>
        </div>

        {/* ═══ DAILY CHALLENGE WIDGET ═══ */}
        {dailyChallengeData && (
          <div className="px-3 -mt-0.5">
            {!dailyChallengeData.completed ? (
              <div className="bg-white/60 backdrop-blur-sm rounded-2xl px-3 py-2 shadow-sm border border-white/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-gray-700">
                    Water {dailyChallengeData.required}g today
                  </span>
                  {dailyChallengeData.streakDays > 0 && (
                    <span className="text-[9px] font-bold text-orange-500">
                      {dailyChallengeData.streakDays} day streak
                    </span>
                  )}
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-400 to-orange-400 rounded-full transition-all"
                    style={{ width: `${dailyChallengeData.progress * 100}%` }}
                  />
                </div>
                <p className="text-[8px] text-gray-500 mt-0.5">
                  {Math.max(0, Math.ceil(dailyChallengeData.required - dailyChallengeData.waterGiven))}g remaining
                </p>
              </div>
            ) : dailyChallengeData.tomorrowReward ? (
              <div className="bg-white/70 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-sm inline-flex items-center gap-1.5 leading-none">
                <img src={UI.gift} alt="" className="w-4 h-4 object-contain shrink-0" />
                <span className="text-[11px] font-bold text-green-700 leading-none">Challenge done!</span>
                <span className="text-[11px] text-green-600 leading-none">Reward tomorrow morning</span>
                {dailyChallengeData.streakDays > 0 && (
                  <span className="text-[11px] text-orange-500 font-bold leading-none">
                    {dailyChallengeData.streakDays}d
                  </span>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* ═══ MAIN FARM AREA ═══ */}
        <div className="flex-1 relative z-0">
          {/* Stage celebration: glow + rainbow + butterflies */}
          <StageCelebration
            active={showCelebration}
            stage={celebrationStage}
            onDismiss={() => setShowCelebration(false)}
          />

          {/* Water drops raining on plant center when watering */}
          <AnimatePresence>
            {isWatering && (
              <motion.div
                className="absolute left-1/2 -translate-x-1/2 pointer-events-none z-20"
                style={{ bottom: '30%' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {dropOffsets.current.map((d, i) => (
                  <motion.img
                    key={i}
                    src={UI.waterDrop}
                    alt=""
                    className="absolute w-3 h-3"
                    style={{ left: `${d.left}px` }}
                    animate={{
                      y: [-40, d.yEnd],
                      opacity: [0.9, 0],
                      scale: [1, 0.3],
                    }}
                    transition={{
                      duration: d.duration,
                      delay: i * 0.07,
                      repeat: Infinity,
                      repeatDelay: 0.1,
                    }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {(() => {
            const layout = getPlantLayout(farm.current_stage);
            const earthBottomPx = 16;
            const earthCenterFromBottom = earthBottomPx + layout.earthHeight / 2;
            return (
              <>
                {/* ── Layer 1: Earth base (z-5) ── */}
                <img
                  src={getCropBase(farm.products?.name_key || '')}
                  alt=""
                  className="absolute left-1/2 z-[5] pointer-events-none"
                  style={{
                    width: layout.baseWidth,
                    height: layout.earthHeight,
                    bottom: earthBottomPx,
                    marginLeft: -(layout.baseWidth / 2),
                  }}
                  draggable={false}
                />

                {/* ── Layer 2: Nutrition badge (z-15) ── */}
                <button
                  className="absolute left-[26%] bottom-[38%] z-[15]"
                  onClick={() => setShowNutritionPopup(true)}
                  data-tutorial="nutrition"
                >
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center shadow-lg border-2 border-white/60 active:scale-95 transition-transform">
                    <span className="text-[24px] font-extrabold text-white leading-none">{farm.nutrition}</span>
                  </div>
                </button>

                {/* ── Layer 2: Active pet (z-15) ── */}
                <button
                  className="absolute right-[20%] bottom-[24%] z-[15]"
                  onClick={handlePetClick}
                >
                  <motion.div
                    animate={showGiftOnPet ? { scale: [1, 1.08, 1] } : {}}
                    transition={showGiftOnPet ? { repeat: Infinity, duration: 1.5 } : {}}
                  >
                    <img
                      src={activePetImage}
                      alt=""
                      className="w-12 h-12 object-contain drop-shadow"
                      draggable={false}
                    />
                  </motion.div>
                  {showGiftOnPet && (
                    <motion.div
                      className="absolute -top-4 -right-2 bg-gradient-to-b from-yellow-400 to-orange-500 rounded-full px-2 py-0.5 shadow-lg border border-white/60"
                      animate={{ scale: [1, 1.15, 1], y: [0, -3, 0] }}
                      transition={{ repeat: Infinity, duration: 1, ease: 'easeInOut' }}
                    >
                      <span className="text-white text-[9px] font-extrabold drop-shadow">TAP!</span>
                    </motion.div>
                  )}
                </button>

                {/* ── Layer 3: Plant vegetable (z-20) — bottom edge at earth center ── */}
                <div
                  className="absolute left-1/2 z-[20] pointer-events-none"
                  style={{
                    bottom: earthCenterFromBottom,
                    marginLeft: -(layout.baseWidth / 2),
                    width: layout.baseWidth,
                  }}
                >
                  <Plant
                    stage={farm.current_stage}
                    growthPercent={farm.growth_percent}
                    productNameKey={farm.products?.name_key || ''}
                    isWatering={isWatering}
                    showEarth={false}
                  />
                </div>

                {/* ── Progress bar — below earth circle ── */}
                <div
                  className="absolute left-1/2 z-[20] pointer-events-none"
                  style={{
                    bottom: -6,
                    marginLeft: -(baseWidth * 0.7 / 2),
                    width: baseWidth * 0.7,
                  }}
                >
                  <ProgressBar
                    percent={farm.growth_percent}
                    stage={farm.current_stage}
                    baseWidth={baseWidth}
                    isDark={isDark}
                  />
                </div>
              </>
            );
          })()}

          {/* ── Layer 4: Well + Bucket (z-22) — interactive ── */}
          <div className="absolute left-0 -bottom-4 z-[22]" data-tutorial="bucket">
            <Bucket
              fillPercent={fillPercent}
              isFull={isFull}
              bucketLevel={bucketLevel}
              capacity={bucketCapacity}
              onCollect={handleCollect}
              isCollecting={collectBucket.isPending || bucketAdPending}
              onShakeCan={triggerCanShake}
              isDark={isDark}
              adRequired={data?.bucketAdRequired ?? false}
              onAdRequest={handleBucketAdRequest}
            />
          </div>
        </div>

        {/* ═══ BOTTOM CONTROL BAR — all buttons aligned by bottom edge ═══ */}
        <div className="px-2 pb-1 pt-1 relative z-30">
          <div className="flex items-end justify-between">
            {/* Water */}
            <button
              className="flex flex-col items-center"
              onClick={() => setShowWaterPopup(true)}
              data-tutorial="water-btn"
            >
              <div className="w-[80px] h-[80px] rounded-full bg-blue-100/80 backdrop-blur-sm flex items-center justify-center shadow-sm border-2 border-white/50">
                <img src={UI.waterDrop} alt="" className="w-11 h-11 object-contain" />
              </div>
              <div className="-mt-2.5 bg-blue-100/90 rounded-full px-2.5 py-0.5 relative z-[1]">
                <span className="text-[9px] font-bold text-blue-700">{t('farm.water')}</span>
              </div>
            </button>

            {/* Fertilizer */}
            <button
              className="flex flex-col items-center"
              onClick={() => setShowFertPopup(true)}
              data-tutorial="fert-btn"
            >
              <div className="w-[80px] h-[80px] rounded-full bg-amber-100/80 backdrop-blur-sm flex items-center justify-center shadow-sm border-2 border-white/50">
                <img src={UI.fertilizer} alt="" className="w-11 h-11 object-contain" />
              </div>
              <div className="-mt-2.5 bg-amber-100/90 rounded-full px-2.5 py-0.5 relative z-[1]">
                <span className="text-[9px] font-bold text-amber-700">{t('farm.fertilizer')}</span>
              </div>
            </button>

            {/* Pet */}
            <button
              className="flex flex-col items-center"
              onClick={() => setShowPets(true)}
              data-tutorial="pet-btn"
            >
              <div className="w-[80px] h-[80px] rounded-full bg-pink-100/80 backdrop-blur-sm flex items-center justify-center shadow-sm border-2 border-white/50">
                <img src={PET_IMAGES[activePet || 'hamster']} alt="" className="w-11 h-11 object-contain" />
              </div>
              <div className="-mt-2.5 bg-pink-100/90 rounded-full px-2.5 py-0.5 relative z-[1]">
                <span className="text-[9px] font-bold text-pink-700">{t('farm.characters')}</span>
              </div>
            </button>

            {/* Watering can — bigger, aligned by bottom with others */}
            <WateringCan
              waterAmount={farm.water_in_can}
              onWater={handleWater}
              isWatering={isWatering}
              canWater={!farm.harvested}
              shaking={canShaking}
            />
          </div>
        </div>

        {/* ═══ FRIENDS STRIP ═══ */}
        <div className="bg-white/40 backdrop-blur-sm px-3 py-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            <button
              className="flex-shrink-0 flex flex-col items-center gap-0.5"
              onClick={() => setShowInvitePopup(true)}
              data-tutorial="invite-btn"
            >
              <div className="w-9 h-9 rounded-full bg-white/70 flex items-center justify-center border border-dashed border-gray-300 shadow-sm">
                <span className="text-gray-400 text-sm">+</span>
              </div>
              <span className="text-[8px] text-white font-semibold w-9 text-center truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
                {t('friends.add')}
              </span>
            </button>

            {(friendsData?.friends || []).map((friend: any) => {
              const avatarKey = friend.avatar_id || friend.avatarId || 'bear';
              const avatarSrc = AVATAR_IMAGES[avatarKey];
              return (
                <button
                  key={friend.id}
                  className="flex-shrink-0 flex flex-col items-center gap-0.5"
                  onClick={() => navigate(`/friends/${friend.id}`)}
                >
                  <div className="w-9 h-9 rounded-full bg-white/70 flex items-center justify-center border border-white/50 shadow-sm overflow-hidden">
                    <img src={avatarSrc || AVATAR_IMAGES.bear} alt="" className="w-7 h-7 object-contain" />
                  </div>
                  <span className="text-[8px] text-white font-semibold w-9 text-center truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
                    {friend.nickname}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <PetsPanel open={showPets} onClose={() => setShowPets(false)} />
      <WaterPopup open={showWaterPopup} onClose={() => setShowWaterPopup(false)} />
      <FertilizerPopup open={showFertPopup} onClose={() => setShowFertPopup(false)} />
      <NutritionPopup
        open={showNutritionPopup}
        onClose={() => setShowNutritionPopup(false)}
        currentLevel={farm.nutrition}
      />
      <NotificationsPopup
        open={showNotifPopup}
        onClose={() => setShowNotifPopup(false)}
      />
      <InvitePopup
        open={showInvitePopup}
        onClose={() => setShowInvitePopup(false)}
      />

      <FarmTutorial />

      {/* Yesterday's reward modal */}
      <AnimatePresence>
        {showChallengeModal && dailyChallengeData?.pendingReward && (
          <>
            <motion.div
              className="fixed inset-0 z-[100] bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="fixed inset-0 z-[101] flex items-center justify-center px-6 pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="bg-white rounded-3xl shadow-2xl p-6 max-w-[300px] w-full text-center pointer-events-auto"
                initial={{ scale: 0.7, y: 30 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.7, y: 30 }}
                transition={{ type: 'tween', duration: 0.25 }}
              >
                <img src={UI.gift} alt="" className="w-16 h-16 mx-auto mb-2 object-contain" />
                <h3 className="text-lg font-extrabold text-gray-900 mb-1">Yesterday's Reward!</h3>
                <p className="text-sm text-gray-500 mb-2">
                  You completed yesterday's challenge.
                </p>
                {dailyChallengeData.pendingReward.streakDays > 0 && (
                  <p className="text-xs text-orange-500 font-bold mb-2">
                    Streak: {dailyChallengeData.pendingReward.streakDays} days
                  </p>
                )}
                <p className="text-lg font-extrabold text-blue-600 mb-4">
                  +{challengeRewardAmount}g water
                </p>
                <button
                  className="w-full bg-gradient-to-b from-blue-400 to-blue-600 text-white font-bold py-3 rounded-2xl shadow-sm active:scale-[0.97] transition-transform text-sm disabled:opacity-50"
                  disabled={claimChallenge.isPending}
                  onClick={() => {
                    claimChallenge.mutate();
                    setShowChallengeModal(false);
                  }}
                >
                  {claimChallenge.isPending ? '...' : 'Claim Reward!'}
                </button>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <MockAdModal
        open={showBucketAd}
        onClose={() => setShowBucketAd(false)}
        rewardAmount={1}
        onComplete={handleBucketAdComplete}
      />

      <RankModal
        open={showRankModal}
        onClose={() => setShowRankModal(false)}
        currentRank={data?.rank ?? 'novice'}
        totalWater={farm.total_water_this_month ?? 0}
      />

      {/* H-4: BottomNav on FarmPage so users can reach Quests/Friends/Profile
          without bouncing through the loading screen. */}
      <BottomNav />
    </Background>
  );
}
