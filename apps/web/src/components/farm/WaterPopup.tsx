import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { AVATAR_IMAGES, UI } from '../../lib/assets';
import { sounds } from '../../lib/sounds';
import MockAdModal from '../MockAdModal';
import { useRewardToast } from '../RewardToast';

interface WaterPopupProps {
  open: boolean;
  onClose: () => void;
  waterInCan?: number;
}

type Page = 'main' | 'friends' | 'friend-farm';

const AD_WATER_REWARD = 35;
const CHECKIN_WATER_REWARD = 20;

function BackArrow({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-800 -ml-1">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M13 4L7 10l6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-gray-300 shrink-0">
      <path d="M7 4l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function WaterPopup({ open, onClose, waterInCan = 0 }: WaterPopupProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  const [page, setPage] = useState<Page>('main');
  const [selectedFriend, setSelectedFriend] = useState<any>(null);
  const [checkinClaimed, setCheckinClaimed] = useState(false);
  const [showAd, setShowAd] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data: friendsData } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api('/friends'),
    enabled: open,
  });

  const claimCheckin = useMutation({
    mutationFn: () => api('/quests/q1/complete', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      setCheckinClaimed(true);
      sounds.rewardChime();
      showReward('water', CHECKIN_WATER_REWARD);
    },
  });

  const greetFriend = useMutation({
    mutationFn: (friendId: string) => api(`/friends/${friendId}/greet`, { method: 'POST' }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      setToast(t('friendFarm.toast_greet', { amount: data.waterEarned }));
      setTimeout(() => setToast(null), 2000);
      sounds.rewardChime();
      showReward('water', data.waterEarned);
    },
  });

  const waterFriend = useMutation({
    mutationFn: (friendId: string) => api(`/friends/${friendId}/water`, { method: 'POST' }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      setToast(t('friendFarm.toast_water', { spent: data.waterSpent, nutrition: data.nutritionEarned }));
      setTimeout(() => setToast(null), 2000);
      sounds.rewardChime();
      showReward('fertilizer', data.nutritionEarned);
    },
  });

  const handleClose = () => {
    onClose();
    setTimeout(() => {
      setPage('main');
      setSelectedFriend(null);
    }, 300);
  };

  const handleAdComplete = (r: { amount: number }) => {
    if (r.amount) {
      qc.invalidateQueries({ queryKey: ['farm'] });
      sounds.rewardChime();
      showReward('water', r.amount);
    }
  };

  const goBack = () => {
    if (page === 'friend-farm') {
      setPage('friends');
      setSelectedFriend(null);
    } else {
      setPage('main');
    }
  };

  const pageTitle = (() => {
    switch (page) {
      case 'main': return t('farm.get_water');
      case 'friends': return t('popup.friends');
      case 'friend-farm': return selectedFriend ? selectedFriend.nickname : '';
    }
  })();

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              className="fixed inset-0 z-[90] bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
            />
            <motion.div
              className="fixed bottom-0 inset-x-0 mx-auto w-full max-w-[430px] z-[95] rounded-t-3xl bg-gray-50 shadow-xl max-h-[85vh] overflow-hidden flex flex-col"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            >
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-200 shrink-0" />

              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
                {page !== 'main' ? <BackArrow onClick={goBack} /> : <div className="w-8" />}
                <h3 className="text-base font-extrabold text-gray-900 truncate">{pageTitle}</h3>
                <CloseBtn onClick={handleClose} />
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-4 pb-8">
                {page === 'main' && (
                  <div className="space-y-2.5">
                    {/* 1. Check-in */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 px-4 py-3.5">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shrink-0">
                        <span className="text-xl">🚪</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900">Check-in</p>
                        <p className="text-[11px] text-gray-500">Daily login reward</p>
                      </div>
                      <span className="text-xs font-bold text-blue-600 mr-1">+{CHECKIN_WATER_REWARD}g</span>
                      {checkinClaimed ? (
                        <div className="bg-gray-200 text-gray-500 font-bold text-[11px] px-3.5 py-1.5 rounded-full">Done</div>
                      ) : (
                        <button
                          className="bg-gradient-to-b from-green-400 to-green-600 text-white font-extrabold text-[11px] px-3.5 py-1.5 rounded-full shadow-sm active:scale-95 transition-transform disabled:opacity-50"
                          onClick={() => claimCheckin.mutate()}
                          disabled={claimCheckin.isPending}
                        >
                          Claim
                        </button>
                      )}
                    </div>

                    {/* 2. Greet Friends */}
                    <button
                      className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 px-4 py-3.5 active:scale-[0.98] transition-transform text-left"
                      onClick={() => setPage('friends')}
                    >
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-amber-400 flex items-center justify-center shrink-0">
                        <span className="text-xl">👋</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900">Greet Friends</p>
                        <p className="text-[11px] text-gray-500">Visit and greet your friends</p>
                      </div>
                      <ChevronRight />
                    </button>

                    {/* 3. Watch Ad */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 px-4 py-3.5">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center shrink-0">
                        <span className="text-xl">📺</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900">Watch Ad</p>
                        <p className="text-[11px] text-gray-500">Watch a short video</p>
                      </div>
                      <span className="text-xs font-bold text-blue-600 mr-1">+{AD_WATER_REWARD}g</span>
                      <button
                        className="bg-gradient-to-b from-green-400 to-green-600 text-white font-extrabold text-[11px] px-3.5 py-1.5 rounded-full shadow-sm active:scale-95 transition-transform"
                        onClick={() => setShowAd(true)}
                      >
                        Watch
                      </button>
                    </div>

                    {/* 4. Quests — disabled */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 px-4 py-3.5 opacity-60">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-cyan-400 flex items-center justify-center shrink-0">
                        <span className="text-xl">📋</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900">Quests</p>
                        <p className="text-[11px] text-gray-500">Complete tasks for water</p>
                      </div>
                      <span className="text-[11px] font-bold text-blue-600 mr-1">10-200g</span>
                      <div className="bg-gray-300 text-gray-500 font-bold text-[11px] px-3.5 py-1.5 rounded-full cursor-not-allowed">
                        Soon
                      </div>
                    </div>

                    {/* 5. Games — disabled */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 px-4 py-3.5 opacity-60">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center shrink-0">
                        <span className="text-xl">🎮</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900">Games</p>
                        <p className="text-[11px] text-gray-500">Play games for water</p>
                      </div>
                      <span className="text-[11px] font-bold text-blue-600 mr-1">10-100g</span>
                      <div className="bg-gray-300 text-gray-500 font-bold text-[11px] px-3.5 py-1.5 rounded-full cursor-not-allowed">
                        Soon
                      </div>
                    </div>
                  </div>
                )}

                {page === 'friends' && (
                  <FriendsList
                    friends={friendsData?.friends || []}
                    onSelectFriend={(f: any) => { setSelectedFriend(f); setPage('friend-farm'); }}
                    t={t}
                  />
                )}

                {page === 'friend-farm' && selectedFriend && (
                  <FriendFarmView
                    friend={selectedFriend}
                    waterInCan={waterInCan}
                    toast={toast}
                    onGreet={() => greetFriend.mutate(selectedFriend.id)}
                    onWater={() => waterFriend.mutate(selectedFriend.id)}
                    greetPending={greetFriend.isPending}
                    waterPending={waterFriend.isPending}
                    t={t}
                  />
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <MockAdModal
        open={showAd}
        onClose={() => setShowAd(false)}
        rewardAmount={AD_WATER_REWARD}
        onComplete={handleAdComplete}
      />
    </>
  );
}

/* ─── Friends List ─── */
function FriendsList({ friends, onSelectFriend, t }: { friends: any[]; onSelectFriend: (f: any) => void; t: any }) {
  if (!friends.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <span className="text-4xl mb-2">👥</span>
        <p className="text-sm">{t('friends.empty')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {friends.map((f: any) => {
        const avatarKey = f.avatar_id || f.avatarId || 'bear';
        const avatarSrc = AVATAR_IMAGES[avatarKey];
        const crop = f.farm?.products?.name_key ? t(f.farm.products.name_key) : '—';
        const progress = f.farm?.growth_percent ? `${Math.round(f.farm.growth_percent)}%` : '0%';

        return (
          <button
            key={f.id}
            className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 px-4 py-3 active:scale-[0.98] transition-transform text-left"
            onClick={() => onSelectFriend(f)}
          >
            <div className="w-11 h-11 rounded-full bg-amber-50 flex items-center justify-center overflow-hidden border-2 border-white shadow-sm shrink-0">
              <img src={avatarSrc || AVATAR_IMAGES.bear} alt="" className="w-8 h-8 object-contain" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{f.nickname}</p>
              <p className="text-[11px] text-gray-500">{crop} — {progress}</p>
            </div>
            <ChevronRight />
          </button>
        );
      })}
    </div>
  );
}

/* ─── Friend Farm View ─── */
function FriendFarmView({ friend, waterInCan, toast, onGreet, onWater, greetPending, waterPending, t }: any) {
  const avatarKey = friend.avatar_id || friend.avatarId || 'bear';
  const avatarSrc = AVATAR_IMAGES[avatarKey];
  const crop = friend.farm?.products?.name_key ? t(friend.farm.products.name_key) : '—';
  const stage = friend.farm?.current_stage || 1;
  const percent = friend.farm?.growth_percent ? Math.round(friend.farm.growth_percent) : 0;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center overflow-hidden border-2 border-white shadow-sm">
            <img src={avatarSrc || AVATAR_IMAGES.bear} alt="" className="w-10 h-10 object-contain" />
          </div>
          <div>
            <p className="text-base font-bold text-gray-900">{friend.nickname}</p>
            <p className="text-xs text-gray-500">{crop}</p>
          </div>
        </div>

        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-700">
            {t('friendFarm.stage_progress', { stage, percent })}
          </span>
        </div>
        <div className="w-full h-3 rounded-full bg-gray-100 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      </div>

      <div className="bg-blue-50 rounded-2xl border border-blue-100 px-4 py-3 flex items-center gap-3">
        <img src={UI.wateringCan} alt="" className="w-10 h-10 object-contain" />
        <div>
          <p className="text-xs text-blue-600 font-medium">{t('popup.your_water', { amount: Math.round(waterInCan) })}</p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          className="flex-1 bg-gradient-to-b from-amber-400 to-orange-500 text-white font-bold py-3.5 rounded-2xl shadow-sm active:scale-[0.97] transition-transform disabled:opacity-50 text-sm"
          onClick={onGreet}
          disabled={greetPending}
        >
          {t('popup.greet_btn')}
        </button>
        <button
          className="flex-1 bg-gradient-to-b from-blue-400 to-blue-600 text-white font-bold py-3.5 rounded-2xl shadow-sm active:scale-[0.97] transition-transform disabled:opacity-50 text-sm"
          onClick={onWater}
          disabled={waterPending}
        >
          {t('popup.water_btn')}
        </button>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            className="bg-green-500 text-white text-sm font-bold text-center py-2.5 px-4 rounded-xl"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
