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
const CHECKIN_WATER_REWARD = 40;

/* ─── Shared farm-styled sub-components ─── */

function BackArrow({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-8 h-8 flex items-center justify-center text-amber-800 hover:text-amber-950 -ml-1">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M13 4L7 10l6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-8 h-8 flex items-center justify-center text-amber-700/60 hover:text-amber-900">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-amber-400 shrink-0">
      <path d="M7 4l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FarmBtn({ children, onClick, disabled, variant = 'green' }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'green' | 'orange' | 'pink' | 'blue' | 'disabled' }) {
  const colors: Record<string, string> = {
    green: 'bg-gradient-to-b from-[#78D44B] via-[#5DBB36] to-[#3F9922] shadow-[0_3px_0_0_#2D7A15,0_4px_8px_rgba(0,0,0,0.15)] active:shadow-[0_1px_0_0_#2D7A15] active:translate-y-[2px]',
    orange: 'bg-gradient-to-b from-amber-400 via-amber-500 to-amber-600 shadow-[0_3px_0_0_#B45309,0_4px_8px_rgba(0,0,0,0.15)] active:shadow-[0_1px_0_0_#B45309] active:translate-y-[2px]',
    pink: 'bg-gradient-to-b from-pink-400 via-rose-500 to-rose-600 shadow-[0_3px_0_0_#9F1239,0_4px_8px_rgba(0,0,0,0.15)] active:shadow-[0_1px_0_0_#9F1239] active:translate-y-[2px]',
    blue: 'bg-gradient-to-b from-sky-400 via-blue-500 to-blue-600 shadow-[0_3px_0_0_#1E40AF,0_4px_8px_rgba(0,0,0,0.15)] active:shadow-[0_1px_0_0_#1E40AF] active:translate-y-[2px]',
    disabled: 'bg-gradient-to-b from-stone-300 to-stone-400 shadow-[0_2px_0_0_#78716C] cursor-not-allowed',
  };

  return (
    <button
      className={`text-white font-extrabold text-[11px] px-4 py-1.5 rounded-xl transition-all ${colors[variant]} disabled:opacity-60`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function RewardBadge({ amount, unit, color }: { amount: number | string; unit?: string; color: string }) {
  return (
    <span className={`text-[11px] font-extrabold ${color} bg-white/60 rounded-lg px-1.5 py-0.5 mr-0.5`}>
      +{amount}{unit}
    </span>
  );
}

function TaskCard({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <div className={`bg-gradient-to-br from-[#FFFDF5] to-[#FFF8E7] rounded-2xl border-2 border-amber-200/70 shadow-[0_2px_8px_rgba(180,130,50,0.1)] flex items-center gap-3 px-3.5 py-3 ${disabled ? 'opacity-50' : ''}`}>
      {children}
    </div>
  );
}

function TaskIcon({ children, gradient }: { children: React.ReactNode; gradient: string }) {
  return (
    <div className={`w-11 h-11 rounded-xl ${gradient} flex items-center justify-center shrink-0 shadow-md border border-white/30`}>
      {children}
    </div>
  );
}

export default function WaterPopup({ open, onClose, waterInCan = 0 }: WaterPopupProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  const [page, setPage] = useState<Page>('main');
  const [selectedFriend, setSelectedFriend] = useState<any>(null);
  const [showAd, setShowAd] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const { data: friendsData } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api('/friends'),
    enabled: open,
  });

  const { data: questsData } = useQuery({
    queryKey: ['quests'],
    queryFn: () => api<{ quests: any[] }>('/quests'),
    enabled: open,
  });

  const checkinClaimed = (() => {
    const checkinQuest = questsData?.quests?.find((q: any) => q.quest_key === 'checkin');
    return checkinQuest ? checkinQuest.isCompleted : false;
  })();

  const claimCheckin = useMutation({
    mutationFn: () => api('/quests/checkin', {
      method: 'POST',
      body: JSON.stringify({ type: 'water' }),
    }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      qc.invalidateQueries({ queryKey: ['quests'] });
      showReward('water', data?.rewardAmount ?? CHECKIN_WATER_REWARD);
      try { sounds.rewardChime(); } catch { /* audio context may not be initialized */ }
    },
    onError: (err: any) => {
      qc.invalidateQueries({ queryKey: ['quests'] });
      const msg = err?.error?.message || err?.message || 'Check-in failed';
      setMutationError(msg);
      setTimeout(() => setMutationError(null), 3000);
    },
  });

  const [greetDoneIds, setGreetDoneIds] = useState<Set<string>>(new Set());
  const [waterLimitHit, setWaterLimitHit] = useState(false);

  const greetFriend = useMutation({
    mutationFn: (friendId: string) => api(`/friends/${friendId}/greet`, { method: 'POST' }),
    onSuccess: (data: any, friendId: string) => {
      setGreetDoneIds((s) => new Set(s).add(friendId));
      qc.invalidateQueries({ queryKey: ['farm'] });
      setToast(t('friendFarm.toast_greet', { amount: data.waterEarned }));
      setTimeout(() => setToast(null), 2000);
      showReward('water', data.waterEarned);
      try { sounds.rewardChime(); } catch { /* audio context may not be initialized */ }
    },
    onError: (err: any, friendId: string) => {
      const code = err?.code || err?.error?.code || '';
      if (code === 'ALREADY_GREETED' || code === 'LIMIT_REACHED') {
        setGreetDoneIds((s) => new Set(s).add(friendId));
      }
      const msg = err?.message || 'Greet failed';
      setMutationError(msg);
      setTimeout(() => setMutationError(null), 3000);
    },
  });

  const waterFriend = useMutation({
    mutationFn: (friendId: string) => api(`/friends/${friendId}/water`, { method: 'POST' }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      setToast(t('friendFarm.toast_water', { spent: data.waterSpent, nutrition: data.nutritionEarned }));
      setTimeout(() => setToast(null), 2000);
      showReward('fertilizer', data.nutritionEarned);
      try { sounds.rewardChime(); } catch { /* audio context may not be initialized */ }
    },
    onError: (err: any) => {
      const code = err?.code || err?.error?.code || '';
      if (code === 'LIMIT_REACHED' || code === 'ALREADY_WATERED') setWaterLimitHit(true);
      const msg = err?.message || 'Water failed';
      setMutationError(msg);
      setTimeout(() => setMutationError(null), 3000);
    },
  });

  const handleClose = () => {
    onClose();
    setTimeout(() => { setPage('main'); setSelectedFriend(null); }, 300);
  };

  const handleAdComplete = async (r: { amount: number }) => {
    if (r.amount) {
      try {
        await api('/farm/ad-reward', {
          method: 'POST',
          body: JSON.stringify({ type: 'water', amount: r.amount }),
        });
        qc.invalidateQueries({ queryKey: ['farm'] });
        sounds.rewardChime();
        showReward('water', r.amount);
      } catch (err: any) {
        setMutationError(err?.message || 'Failed to credit ad reward');
        setTimeout(() => setMutationError(null), 3000);
      }
    }
  };

  const goBack = () => {
    if (page === 'friend-farm') { setPage('friends'); setSelectedFriend(null); }
    else setPage('main');
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
              className="fixed inset-0 z-[90] bg-black/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
            />
            <motion.div
              className="fixed bottom-0 inset-x-0 mx-auto w-full max-w-[430px] z-[95] rounded-t-[28px] overflow-hidden flex flex-col max-h-[85vh]"
              style={{
                background: 'linear-gradient(180deg, #FFF5DC 0%, #FAECC8 30%, #F5E1B0 100%)',
                boxShadow: '0 -4px 30px rgba(120,80,20,0.25), inset 0 1px 0 rgba(255,255,255,0.6)',
              }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            >
              {/* Wooden grab handle */}
              <div className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-amber-400/50 shrink-0" />

              {/* Wooden header plank */}
              <div className="mx-3 mt-2 mb-1 rounded-xl overflow-hidden shrink-0"
                style={{ background: 'linear-gradient(180deg, #A0784A 0%, #7B5C35 50%, #6B4E2C 100%)', boxShadow: '0 3px 0 #4A351A, 0 4px 10px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.2)' }}
              >
                <div className="flex items-center justify-between px-3 py-2.5">
                  {page !== 'main' ? <BackArrow onClick={goBack} /> : <div className="w-8" />}
                  <div className="flex items-center gap-2">
                    <img src={UI.waterDrop} alt="" className="w-5 h-5" />
                    <h3 className="text-[15px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)] tracking-wide">{pageTitle}</h3>
                  </div>
                  <CloseBtn onClick={handleClose} />
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-3 pb-6 pt-1">
                {mutationError && (
                  <div className="mb-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 font-medium text-center">
                    {mutationError}
                  </div>
                )}
                {page === 'main' && (
                  <div className="space-y-2.5">
                    {/* 1. Check-in */}
                    <TaskCard>
                      <TaskIcon gradient="bg-gradient-to-br from-green-400 to-emerald-600">
                        <span className="text-xl">🌅</span>
                      </TaskIcon>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-amber-900">Check-in</p>
                        <p className="text-[10px] text-amber-700/60 font-medium">Daily login reward</p>
                      </div>
                      <RewardBadge amount={CHECKIN_WATER_REWARD} unit="g" color="text-blue-600" />
                      {checkinClaimed ? (
                        <FarmBtn variant="disabled" disabled>Done</FarmBtn>
                      ) : (
                        <FarmBtn variant="green" onClick={() => { setMutationError(null); claimCheckin.mutate(); }} disabled={claimCheckin.isPending}>
                          {claimCheckin.isPending ? '...' : 'Claim'}
                        </FarmBtn>
                      )}
                    </TaskCard>

                    {/* 2. Greet Friends */}
                    <button
                      className="w-full active:scale-[0.98] transition-transform text-left"
                      onClick={() => setPage('friends')}
                    >
                      <TaskCard>
                        <TaskIcon gradient="bg-gradient-to-br from-orange-400 to-amber-600">
                          <span className="text-xl">👋</span>
                        </TaskIcon>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-amber-900">Greet Friends</p>
                          <p className="text-[10px] text-amber-700/60 font-medium">Visit and say hello!</p>
                        </div>
                        <ChevronRight />
                      </TaskCard>
                    </button>

                    {/* 3. Watch Ad */}
                    <TaskCard>
                      <TaskIcon gradient="bg-gradient-to-br from-violet-400 to-purple-600">
                        <span className="text-xl">📺</span>
                      </TaskIcon>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-amber-900">Watch Ad</p>
                        <p className="text-[10px] text-amber-700/60 font-medium">Watch a short video</p>
                      </div>
                      <RewardBadge amount={AD_WATER_REWARD} unit="g" color="text-blue-600" />
                      <FarmBtn variant="green" onClick={() => setShowAd(true)}>Watch</FarmBtn>
                    </TaskCard>

                    {/* 4. Quests — disabled */}
                    <TaskCard disabled>
                      <TaskIcon gradient="bg-gradient-to-br from-sky-400 to-cyan-600">
                        <span className="text-xl">📋</span>
                      </TaskIcon>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-amber-900">Quests</p>
                        <p className="text-[10px] text-amber-700/60 font-medium">Complete tasks for water</p>
                        <p className="text-[9px] text-blue-500 font-semibold">up to 50,000g</p>
                      </div>
                      <FarmBtn variant="disabled" disabled>Soon</FarmBtn>
                    </TaskCard>

                    {/* 5. Games — disabled */}
                    <TaskCard disabled>
                      <TaskIcon gradient="bg-gradient-to-br from-pink-400 to-rose-600">
                        <span className="text-xl">🎮</span>
                      </TaskIcon>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-amber-900">Games</p>
                        <p className="text-[10px] text-amber-700/60 font-medium">Play games for water</p>
                        <p className="text-[9px] text-blue-500 font-semibold">up to 50,000g</p>
                      </div>
                      <FarmBtn variant="disabled" disabled>Soon</FarmBtn>
                    </TaskCard>
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
                    greetDone={greetDoneIds.has(selectedFriend.id)}
                    waterLimitHit={waterLimitHit}
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
      <div className="flex flex-col items-center justify-center py-12 text-amber-600/60">
        <span className="text-4xl mb-2">🌾</span>
        <p className="text-sm font-medium">{t('friends.empty')}</p>
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
            className="w-full active:scale-[0.98] transition-transform text-left"
            onClick={() => onSelectFriend(f)}
          >
            <TaskCard>
              <div className="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center overflow-hidden border-2 border-amber-300/50 shadow-sm shrink-0">
                <img src={avatarSrc || AVATAR_IMAGES.bear} alt="" className="w-8 h-8 object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-amber-900 truncate">{f.nickname}</p>
                <p className="text-[10px] text-amber-700/60 font-medium">{crop} — {progress}</p>
              </div>
              <ChevronRight />
            </TaskCard>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Friend Farm View ─── */
function FriendFarmView({ friend, waterInCan, toast, onGreet, onWater, greetPending, waterPending, greetDone, waterLimitHit, t }: any) {
  const avatarKey = friend.avatar_id || friend.avatarId || 'bear';
  const avatarSrc = AVATAR_IMAGES[avatarKey];
  const crop = friend.farm?.products?.name_key ? t(friend.farm.products.name_key) : '—';
  const stage = friend.farm?.current_stage || 1;
  const percent = friend.farm?.growth_percent ? Math.round(friend.farm.growth_percent) : 0;

  const notEnoughWater = waterInCan < 10;
  const waterOff = waterLimitHit || notEnoughWater;

  return (
    <div className="space-y-3">
      <TaskCard>
        <div className="w-full">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center overflow-hidden border-2 border-amber-300/50 shadow-sm">
              <img src={avatarSrc || AVATAR_IMAGES.bear} alt="" className="w-10 h-10 object-contain" />
            </div>
            <div>
              <p className="text-base font-bold text-amber-900">{friend.nickname}</p>
              <p className="text-xs text-amber-700/60">{crop}</p>
            </div>
          </div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-amber-800">
              {t('friendFarm.stage_progress', { stage, percent })}
            </span>
          </div>
          <div className="w-full h-3 rounded-full bg-amber-200/50 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500"
              initial={{ width: 0 }}
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </div>
      </TaskCard>

      <div className="bg-blue-50/80 rounded-2xl border-2 border-blue-200/50 px-4 py-3 flex items-center gap-3">
        <img src={UI.wateringCan} alt="" className="w-10 h-10 object-contain" />
        <p className="text-xs text-blue-700 font-bold">{t('popup.your_water', { amount: Math.round(waterInCan) })}</p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col items-center gap-0.5">
          <FarmBtn
            variant={greetDone ? 'disabled' : 'orange'}
            onClick={greetDone ? undefined : onGreet}
            disabled={greetDone || greetPending}
          >
            <span className="text-sm px-3">{greetDone ? '✓' : ''} {t('popup.greet_btn')}</span>
          </FarmBtn>
          {greetDone && (
            <span className="text-[9px] text-gray-400 font-medium">{t('popup.limit_done', { defaultValue: 'Done' })}</span>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center gap-0.5">
          <FarmBtn
            variant={waterOff ? 'disabled' : 'blue'}
            onClick={waterOff ? undefined : onWater}
            disabled={waterOff || waterPending}
          >
            <span className="text-sm px-3">{t('popup.water_btn')}</span>
          </FarmBtn>
          {waterLimitHit && (
            <span className="text-[9px] text-gray-400 font-medium">{t('popup.limit_done', { defaultValue: 'Limit reached' })}</span>
          )}
          {!waterLimitHit && notEnoughWater && (
            <span className="text-[9px] text-red-400 font-medium">{t('popup.not_enough_water', { defaultValue: 'Not enough water' })}</span>
          )}
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            className="bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm font-bold text-center py-2.5 px-4 rounded-xl shadow-md"
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
