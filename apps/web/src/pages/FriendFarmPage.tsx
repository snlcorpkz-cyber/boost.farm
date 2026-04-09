import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import type { PetId } from '@eco-farm/game-engine';
import { usePhase } from '../hooks/usePhase';
import { useFarm } from '../hooks/useFarm';
import { api } from '../lib/api';
import Background from '../components/farm/Background';
import Plant, { getPlantLayout } from '../components/farm/Plant';
import ProgressBar from '../components/farm/ProgressBar';
import WateringCan from '../components/farm/WateringCan';
import { AVATAR_IMAGES, PET_IMAGES, UI, getCropBase } from '../lib/assets';
import { useRewardToast } from '../components/RewardToast';

interface FriendFarm {
  growth_percent: number;
  current_stage: number;
  product_id: string;
  products?: { name_key: string };
}

interface Friend {
  id: string;
  nickname: string;
  avatar_id: string;
  active_pet?: PetId;
  bucket_fill_percent?: number;
  farm: FriendFarm | null;
}

interface FriendsResponse { friends: Friend[] }
interface GreetResponse { waterEarned: number }
interface WaterFriendResponse { waterSpent: number; nutritionEarned: number }

export default function FriendFarmPage() {
  const { friendId } = useParams<{ friendId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  const { phase } = usePhase();
  const hour = new Date().getHours();
  const isNight = hour >= 22 || hour < 4;
  const isDark = phase !== 'afternoon' || isNight;

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isWatering, setIsWatering] = useState(false);
  const [canShaking, setCanShaking] = useState(false);

  const { data: friendsData, isLoading } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api<FriendsResponse>('/friends'),
  });

  const { data: myFarmData } = useFarm();
  const myWater = myFarmData?.farm?.water_in_can ?? 0;
  const myMonthlyWater = myFarmData?.farm?.total_water_this_month ?? 0;

  const friend = useMemo(
    () => friendsData?.friends?.find((f) => f.id === friendId) ?? null,
    [friendsData?.friends, friendId]
  );

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), 3200);
  }, []);

  const greetMutation = useMutation({
    mutationFn: () => {
      if (!friendId) throw new Error('Missing friend id');
      return api<GreetResponse>(`/friends/${friendId}/greet`, { method: 'POST' });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
      showToast(t('friendFarm.toast_greet', { amount: res.waterEarned }));
      showReward('water', res.waterEarned);
    },
  });

  const waterMutation = useMutation({
    mutationFn: () => {
      if (!friendId) throw new Error('Missing friend id');
      return api<WaterFriendResponse>(`/friends/${friendId}/water`, { method: 'POST' });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
      showToast(t('friendFarm.toast_water', { spent: res.waterSpent, nutrition: res.nutritionEarned }));
      showReward('fertilizer', res.nutritionEarned);
    },
  });

  const handleWater = useCallback(
    (_times: 1 | 5) => {
      setIsWatering(true);
      waterMutation.mutate(undefined, {
        onSettled: () => {
          setTimeout(() => setIsWatering(false), 1200);
        },
      });
    },
    [waterMutation]
  );

  if (!friendId || isLoading) {
    return (
      <Background>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-bounce text-6xl">🌱</div>
        </div>
      </Background>
    );
  }

  if (!friend) {
    return (
      <Background>
        <div className="flex flex-col min-h-screen px-4 pt-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="self-start mb-4 text-sm font-bold text-gray-800 bg-white/60 backdrop-blur-sm rounded-full px-3 py-1.5"
          >
            ← {t('friendFarm.back')}
          </button>
          <p className="text-center text-gray-600 mt-12">{t('friendFarm.not_found')}</p>
        </div>
      </Background>
    );
  }

  const farm = friend.farm;
  const nameKey = farm?.products?.name_key ?? '';
  const avatarSrc = AVATAR_IMAGES[friend.avatar_id];
  const friendPetImage = PET_IMAGES[friend.active_pet || 'hamster'];
  const friendBucketFill = friend.bucket_fill_percent ?? 30;
  const friendBucketSrc = friendBucketFill > 66 ? UI.bucketFull : UI.bucket;

  const layout = getPlantLayout();

  return (
    <Background>
      <div className="flex flex-col h-[100dvh]">
        {/* ═══ TOP BAR — same height as FarmPage ═══ */}
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-full bg-white/70 backdrop-blur-sm flex items-center justify-center shadow-sm border border-white/50"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M11 4L6 9l5 5" stroke="#374151" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="flex items-center gap-1 bg-white/50 backdrop-blur-sm rounded-full px-2.5 py-1 shadow-sm">
            <img src={UI.waterDrop} alt="" className="w-3 h-3" />
            <span className="text-[10px] font-bold text-blue-700 tabular-nums">
              {myMonthlyWater.toFixed(0)}g
            </span>
            <span className="text-[8px] text-gray-500 ml-0.5">
              in {new Date().toLocaleString(undefined, { month: 'long' })}
            </span>
          </div>

          <div className="flex items-center gap-1.5 bg-white/60 backdrop-blur-sm rounded-full pl-1 pr-2.5 py-0.5 shadow-sm border border-white/50">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center overflow-hidden border border-white">
              <img src={avatarSrc || AVATAR_IMAGES.bear} alt="" className="w-5 h-5 object-contain" />
            </div>
            <span className="text-[10px] font-bold text-gray-800 max-w-[80px] truncate">
              {friend.nickname}
            </span>
          </div>
        </div>

        {/* ═══ MAIN FARM AREA — pixel-identical to FarmPage ═══ */}
        <div className="flex-1 relative z-0">
          {/* Water drops raining when watering */}
          <AnimatePresence>
            {isWatering && (
              <motion.div
                className="absolute left-1/2 -translate-x-1/2 pointer-events-none z-20"
                style={{ bottom: '30%' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {[...Array(12)].map((_, i) => (
                  <motion.img
                    key={i}
                    src={UI.waterDrop}
                    alt=""
                    className="absolute w-3 h-3"
                    style={{ left: `${-20 + Math.random() * 40}px` }}
                    animate={{
                      y: [-40, 30 + Math.random() * 20],
                      opacity: [0.9, 0],
                      scale: [1, 0.3],
                    }}
                    transition={{
                      duration: 0.5 + Math.random() * 0.3,
                      delay: i * 0.07,
                      repeat: Infinity,
                      repeatDelay: 0.1,
                    }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {farm ? (() => {
            const earthBottomPx = 16;
            const earthCenterFromBottom = earthBottomPx + layout.earthHeight / 2;

            return (
              <>
                {/* ── Layer 1: Earth base (z-5) ── */}
                <img
                  src={getCropBase(nameKey)}
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

                {/* ── Layer 2: Friend's pet (z-15) — visual only ── */}
                <div className="absolute right-[20%] bottom-[24%] z-[15] pointer-events-none">
                  <img
                    src={friendPetImage}
                    alt=""
                    className="w-12 h-12 object-contain drop-shadow"
                    draggable={false}
                  />
                </div>

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
                    productNameKey={nameKey}
                    isWatering={isWatering}
                    showEarth={false}
                  />
                </div>

                {/* ── Progress bar — below earth circle ── */}
                <div
                  className="absolute left-1/2 z-[20] pointer-events-none"
                  style={{
                    bottom: -6,
                    marginLeft: -(layout.baseWidth * 0.7 / 2),
                    width: layout.baseWidth * 0.7,
                  }}
                >
                  <ProgressBar
                    percent={farm.growth_percent}
                    stage={farm.current_stage}
                    baseWidth={layout.baseWidth}
                    isDark={isDark}
                  />
                </div>
              </>
            );
          })() : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 text-sm">{t('friendFarm.no_crop')}</p>
            </div>
          )}

          {/* ── Layer 4: Friend's Well + Bucket (z-22) — visual only ── */}
          <div className="absolute left-0 -bottom-4 z-[22] pointer-events-none">
            <div className="relative" style={{ width: 110, height: 140 }}>
              <img
                src={UI.well}
                alt=""
                className="absolute top-0 left-0 object-contain"
                style={{ width: 96, height: 96 }}
                draggable={false}
              />
              {/* Drops from spout into bucket */}
              <div className="absolute" style={{ left: 62, top: 44, width: 8, height: 28 }}>
                {[0, 1, 2].map((i) => (
                  <motion.img
                    key={i}
                    src={UI.waterDrop}
                    alt=""
                    className="absolute w-2.5 h-2.5"
                    animate={{
                      y: [0, 24],
                      opacity: [1, 0],
                      scale: [0.7, 0.3],
                    }}
                    transition={{
                      duration: 1,
                      delay: i * 0.33,
                      repeat: Infinity,
                      ease: 'easeIn',
                    }}
                  />
                ))}
              </div>
              <div className="absolute" style={{ left: 48, top: 74, width: 40, height: 40 }}>
                <img
                  src={friendBucketSrc}
                  alt=""
                  className="w-full h-full object-contain"
                  draggable={false}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ═══ BOTTOM CONTROL BAR — matches FarmPage 4-column layout height ═══ */}
        <div className="px-2 pb-1 pt-1 relative z-30">
          <div className="flex items-end justify-between">
            {/* Greet hand button */}
            <div className="flex flex-col items-center">
              <motion.button
                className="w-[80px] h-[80px] rounded-full bg-amber-100/80 backdrop-blur-sm flex items-center justify-center shadow-sm border-2 border-white/50 disabled:opacity-50"
                whileTap={{ scale: 0.92 }}
                onClick={() => greetMutation.mutate()}
                disabled={greetMutation.isPending || waterMutation.isPending}
              >
                <img src={UI.greetHand} alt="greet" className="w-16 h-16 object-contain" />
              </motion.button>
              <div className="-mt-2.5 bg-amber-100/90 rounded-full px-2.5 py-0.5 relative z-[1]">
                <span className="text-[9px] font-bold text-amber-700">{t('friends.greet')}</span>
              </div>
            </div>

            {/* Spacer — occupies space of FarmPage's middle 2 buttons */}
            <div className="w-[80px]" />
            <div className="w-[80px]" />

            {/* Watering Can */}
            <WateringCan
              waterAmount={myWater}
              onWater={handleWater}
              isWatering={isWatering}
              canWater={!!farm}
              shaking={canShaking}
            />
          </div>
        </div>

        {/* ═══ FRIENDS STRIP SPACER — matches FarmPage friends strip height ═══ */}
        <div className="bg-white/40 backdrop-blur-sm px-3 py-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="h-[36px]" />
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            role="status"
            className="fixed bottom-8 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-2xl bg-gray-900/92 text-white text-sm font-semibold px-4 py-3 shadow-lg"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25 }}
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </Background>
  );
}
