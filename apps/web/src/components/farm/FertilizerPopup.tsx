import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { AVATAR_IMAGES, UI } from '../../lib/assets';
import { sounds } from '../../lib/sounds';
import MockAdModal from '../MockAdModal';
import { useRewardToast } from '../RewardToast';
import { useRewardedAd } from '../../hooks/useRewardedAd';

interface FertilizerPopupProps {
  open: boolean;
  onClose: () => void;
}

type Page = 'main' | 'invite' | 'friends';

const AD_FERT_REWARD = 8;
const CHECKIN_FERT_REWARD = 5;
const INVITE_FERT_REWARD = 100;
const WATER_FRIEND_FERT_REWARD = 2;

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

export default function FertilizerPopup({ open, onClose }: FertilizerPopupProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  const [page, setPage] = useState<Page>('main');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const ad = useRewardedAd({
    placement: 'fert_popup',
    rewardType: 'nutrition',
    rewardAmount: AD_FERT_REWARD,
    onError: (msg) => { setMutationError(msg); setTimeout(() => setMutationError(null), 3000); },
  });

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
    const fertQuest = questsData?.quests?.find((q: any) => q.quest_key === 'checkin_fert');
    return fertQuest ? fertQuest.isCompleted : false;
  })();

  const claimCheckin = useMutation({
    mutationFn: () => api('/quests/checkin', {
      method: 'POST',
      body: JSON.stringify({ type: 'nutrition' }),
    }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      qc.invalidateQueries({ queryKey: ['quests'] });
      showReward('fertilizer', data?.rewardAmount ?? CHECKIN_FERT_REWARD);
      try { sounds.rewardChime(); } catch { /* audio context may not be initialized */ }
    },
    onError: (err: any) => {
      qc.invalidateQueries({ queryKey: ['quests'] });
      const msg = err?.error?.message || err?.message || 'Check-in failed';
      setMutationError(msg);
      setTimeout(() => setMutationError(null), 3000);
    },
  });

  const handleClose = () => {
    onClose();
    setTimeout(() => { setPage('main'); }, 300);
  };

  const handleSelectFriend = (f: any) => {
    handleClose();
    navigate(`/friends/${f.id}`);
  };

  const goBack = () => setPage('main');

  const pageTitle = (() => {
    switch (page) {
      case 'main': return t('farm.get_fertilizer');
      case 'invite': return 'Invite Friends';
      case 'friends': return t('popup.friends');
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
              transition={{ duration: 0.15 }}
              onClick={handleClose}
            />
            <motion.div
              className="fixed bottom-0 inset-x-0 mx-auto w-full max-w-[430px] z-[95] rounded-t-[28px] overflow-hidden flex flex-col max-h-[85vh]"
              style={{
                background: 'linear-gradient(180deg, #FFF5DC 0%, #FAECC8 30%, #F5E1B0 100%)',
                boxShadow: '0 -4px 30px rgba(120,80,20,0.25), inset 0 1px 0 rgba(255,255,255,0.6)',
                willChange: 'transform',
              }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
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
                    <img src={UI.fertilizer} alt="" className="w-5 h-5" />
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
                      <RewardBadge amount={CHECKIN_FERT_REWARD} color="text-amber-700" />
                      {checkinClaimed ? (
                        <FarmBtn variant="disabled" disabled>Done</FarmBtn>
                      ) : (
                        <FarmBtn variant="green" onClick={() => {
                          if (busyRef.current) return;
                          busyRef.current = true;
                          setMutationError(null);
                          claimCheckin.mutate(undefined, { onSettled: () => { busyRef.current = false; } });
                        }} disabled={claimCheckin.isPending}>
                          {claimCheckin.isPending ? '...' : 'Claim'}
                        </FarmBtn>
                      )}
                    </TaskCard>

                    {/* 2. Invite Friends */}
                    <button
                      className="w-full active:scale-[0.98] transition-transform text-left"
                      onClick={() => setPage('invite')}
                    >
                      <TaskCard>
                        <TaskIcon gradient="bg-gradient-to-br from-pink-400 to-rose-600">
                          <span className="text-xl">🤝</span>
                        </TaskIcon>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-amber-900">Invite Friends</p>
                          <p className="text-[10px] text-amber-700/60 font-medium">+{INVITE_FERT_REWARD} for both!</p>
                        </div>
                        <RewardBadge amount={INVITE_FERT_REWARD} color="text-amber-700" />
                        <FarmBtn variant="pink">Invite</FarmBtn>
                      </TaskCard>
                    </button>

                    {/* 3. Water Friends */}
                    <button
                      className="w-full active:scale-[0.98] transition-transform text-left"
                      onClick={() => setPage('friends')}
                    >
                      <TaskCard>
                        <TaskIcon gradient="bg-gradient-to-br from-sky-400 to-blue-600">
                          <img src={UI.waterDrop} alt="" className="w-6 h-6" />
                        </TaskIcon>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-amber-900">Water Friends</p>
                          <p className="text-[10px] text-amber-700/60 font-medium">Water friends' plants</p>
                        </div>
                        <RewardBadge amount={WATER_FRIEND_FERT_REWARD} color="text-amber-700" />
                        <ChevronRight />
                      </TaskCard>
                    </button>

                    {/* 4. Watch Ad */}
                    <TaskCard>
                      <TaskIcon gradient="bg-gradient-to-br from-violet-400 to-purple-600">
                        <span className="text-xl">📺</span>
                      </TaskIcon>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-amber-900">Watch Ad</p>
                        <p className="text-[10px] text-amber-700/60 font-medium">Watch a short video</p>
                      </div>
                      <RewardBadge amount={AD_FERT_REWARD} color="text-amber-700" />
                      <FarmBtn variant="green" onClick={ad.requestAd} disabled={ad.pending}>
                        {ad.pending ? '...' : 'Watch'}
                      </FarmBtn>
                    </TaskCard>

                    {/* 5. Quests — disabled */}
                    <TaskCard disabled>
                      <TaskIcon gradient="bg-gradient-to-br from-amber-400 to-orange-600">
                        <span className="text-xl">📋</span>
                      </TaskIcon>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-amber-900">Quests</p>
                        <p className="text-[10px] text-amber-700/60 font-medium">Complete tasks for fertilizer</p>
                        <p className="text-[9px] text-amber-500 font-semibold">up to 2,000</p>
                      </div>
                      <FarmBtn variant="disabled" disabled>Soon</FarmBtn>
                    </TaskCard>

                    {/* 6. Games — disabled */}
                    <TaskCard disabled>
                      <TaskIcon gradient="bg-gradient-to-br from-indigo-400 to-violet-600">
                        <span className="text-xl">🎮</span>
                      </TaskIcon>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-amber-900">Games</p>
                        <p className="text-[10px] text-amber-700/60 font-medium">Play games for fertilizer</p>
                        <p className="text-[9px] text-amber-500 font-semibold">up to 2,000</p>
                      </div>
                      <FarmBtn variant="disabled" disabled>Soon</FarmBtn>
                    </TaskCard>
                  </div>
                )}

                {page === 'invite' && <InviteSection t={t} />}

                {page === 'friends' && (
                  <FriendWaterList
                    friends={friendsData?.friends || []}
                    onSelectFriend={handleSelectFriend}
                    t={t}
                  />
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <MockAdModal
        open={ad.showFallbackAd}
        onClose={ad.closeFallback}
        rewardAmount={AD_FERT_REWARD}
        onComplete={ad.handleFallbackComplete}
      />
    </>
  );
}

/* ─── Invite Section ─── */
function InviteSection({ t }: { t: any }) {
  const [copiedField, setCopiedField] = useState<'link' | 'code' | null>(null);
  const { data: inviteData } = useQuery({
    queryKey: ['invite-code'],
    queryFn: () => api<{ code: string; link: string }>('/friends/invite-code'),
  });

  const copyToClipboard = async (text: string, field: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 bg-amber-100/80 rounded-xl px-3 py-2.5 border border-amber-300/40">
        <span className="text-lg">🎁</span>
        <span className="text-xs text-amber-800 font-bold">
          Both you and your friend get +{INVITE_FERT_REWARD} fertilizer!
        </span>
      </div>

      {inviteData && (
        <>
          <div>
            <p className="text-[10px] font-bold text-amber-700/70 uppercase tracking-wider mb-1">{t('ref.your_link')}</p>
            <div className="flex items-center gap-2 bg-white/70 rounded-xl px-3 py-2 border border-amber-200/50">
              <span className="flex-1 text-xs text-amber-900 truncate font-mono">{inviteData.link}</span>
              <button
                className="shrink-0 bg-gradient-to-b from-[#78D44B] to-[#3F9922] text-white text-[10px] font-bold px-3 py-1.5 rounded-lg shadow-[0_2px_0_#2D7A15] active:translate-y-[1px] active:shadow-[0_1px_0_#2D7A15] transition-all"
                onClick={() => copyToClipboard(inviteData.link, 'link')}
              >
                {copiedField === 'link' ? t('ref.copied') : t('ref.copy_link')}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-amber-300/40" />
            <span className="text-[10px] text-amber-600/60 font-medium">{t('ref.or_share_code')}</span>
            <div className="flex-1 h-px bg-amber-300/40" />
          </div>

          <div className="flex items-center gap-2 bg-white/70 rounded-xl px-3 py-2 border border-amber-200/50">
            <span className="flex-1 text-center text-base font-mono font-extrabold text-green-700 tracking-widest">{inviteData.code}</span>
            <button
              className="shrink-0 bg-gradient-to-b from-[#78D44B] to-[#3F9922] text-white text-[10px] font-bold px-3 py-1.5 rounded-lg shadow-[0_2px_0_#2D7A15] active:translate-y-[1px] active:shadow-[0_1px_0_#2D7A15] transition-all"
              onClick={() => copyToClipboard(inviteData.code, 'code')}
            >
              {copiedField === 'code' ? t('ref.copied') : t('ref.copy_code')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Friend Water List ─── */
function FriendWaterList({ friends, onSelectFriend, t }: any) {
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
      <div className="bg-amber-100/80 rounded-xl px-3 py-2 mb-2 border border-amber-300/40">
        <p className="text-[11px] text-amber-800 font-bold">
          Water a friend's plant to earn +{WATER_FRIEND_FERT_REWARD} fertilizer
        </p>
      </div>

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
