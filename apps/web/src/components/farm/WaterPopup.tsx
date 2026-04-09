import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { AVATAR_IMAGES, UI } from '../../lib/assets';
import MockAdModal from '../MockAdModal';
import { useRewardToast } from '../RewardToast';

interface WaterPopupProps {
  open: boolean;
  onClose: () => void;
  waterInCan?: number;
}

type Page = 'main' | 'quests' | 'games' | 'friends' | 'friend-farm' | 'invite';

const WATER_QUESTS = [
  { id: 'q1', key: 'checkin', descKey: null, icon: '🚪', rewardKey: 'dynamic', limitKey: 'quests.checkin_limit', actionKey: 'quests.checkin_action' },
  { id: 'q2', key: 'greet_friend', descKey: null, icon: '😊', rewardKey: 'dynamic', limitKey: 'quests.greet_limit', actionKey: 'quests.greet_action' },
  { id: 'pq1', key: 'crypto_deposit', descKey: 'quests.crypto_deposit_desc', icon: '💰', reward: 200, limitKey: 'quests.one_time', actionKey: 'quests.go' },
  { id: 'pq2', key: 'install_app', descKey: 'quests.install_app_desc', icon: '📱', reward: 100, limitKey: 'quests.one_time', actionKey: 'quests.go' },
];

const WATER_GAMES = [
  { id: 'g1', nameKey: 'games.puzzle_blast', descKey: 'games.puzzle_blast_desc', icon: '🧩', conditionKey: 'games.play_30min', conditionParam: null, reward: 50 },
  { id: 'g2', nameKey: 'games.tower_stack', descKey: 'games.tower_stack_desc', icon: '🏗️', conditionKey: 'games.reach_level', conditionParam: 20, reward: 100 },
];

const AD_WATER_REWARD = 35;

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
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [claimedGames, setClaimedGames] = useState<Set<string>>(new Set());
  const [reward, setReward] = useState<{ amount: number; id: string } | null>(null);
  const [showAd, setShowAd] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data: friendsData } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api('/friends'),
    enabled: open,
  });

  const completeQuest = useMutation({
    mutationFn: (questId: string) => api(`/quests/${questId}/complete`, { method: 'POST' }),
    onSuccess: (_data, questId) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      setCompletedIds((prev) => new Set(prev).add(questId));
      const q = WATER_QUESTS.find((w) => w.id === questId);
      if (q && q.reward) {
        setReward({ amount: q.reward, id: questId });
        setTimeout(() => setReward(null), 1500);
        showReward('water', q.reward);
      }
    },
  });

  const claimGame = useMutation({
    mutationFn: (gameId: string) => api(`/games/${gameId}/claim`, { method: 'POST' }),
    onSuccess: (_data, gameId) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      setClaimedGames((prev) => new Set(prev).add(gameId));
      const g = WATER_GAMES.find((x) => x.id === gameId);
      if (g) {
        setReward({ amount: g.reward, id: gameId });
        setTimeout(() => setReward(null), 1500);
        showReward('water', g.reward);
      }
    },
  });

  const greetFriend = useMutation({
    mutationFn: (friendId: string) => api(`/friends/${friendId}/greet`, { method: 'POST' }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      setToast(t('friendFarm.toast_greet', { amount: data.waterEarned }));
      setTimeout(() => setToast(null), 2000);
      showReward('water', data.waterEarned);
    },
  });

  const waterFriend = useMutation({
    mutationFn: (friendId: string) => api(`/friends/${friendId}/water`, { method: 'POST' }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['farm'] });
      setToast(t('friendFarm.toast_water', { spent: data.waterSpent, nutrition: data.nutritionEarned }));
      setTimeout(() => setToast(null), 2000);
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
      completeQuest.mutate('q3');
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
      case 'quests': return t('popup.quests');
      case 'games': return t('popup.games');
      case 'friends': return t('popup.friends');
      case 'friend-farm': return selectedFriend ? t('popup.friend_farm', { name: selectedFriend.nickname }) : '';
      case 'invite': return t('quests.invite_friend');
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
              className="fixed bottom-0 inset-x-0 mx-auto w-full max-w-[390px] z-[95] rounded-t-3xl bg-gray-50 shadow-xl max-h-[85vh] overflow-hidden flex flex-col"
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
                {page === 'main' && <MainMenu onNavigate={setPage} onShowAd={() => setShowAd(true)} t={t} />}
                {page === 'quests' && (
                  <QuestsList
                    quests={WATER_QUESTS}
                    completedIds={completedIds}
                    reward={reward}
                    isPending={completeQuest.isPending}
                    onAction={(id: string) => completeQuest.mutate(id)}
                    rewardIcon="💧"
                    rewardUnit="г"
                    rewardColor="text-blue-600"
                    t={t}
                  />
                )}
                {page === 'games' && (
                  <GamesList
                    games={WATER_GAMES}
                    claimedGames={claimedGames}
                    reward={reward}
                    isPending={claimGame.isPending}
                    onClaim={(id: string) => claimGame.mutate(id)}
                    rewardIcon="💧"
                    rewardUnit="г"
                    rewardColor="text-blue-600"
                    t={t}
                  />
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
                {page === 'invite' && <InviteInlineSection t={t} />}
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

/* ─── Main Menu ─── */
function MainMenu({ onNavigate, onShowAd, t }: { onNavigate: (p: Page) => void; onShowAd: () => void; t: any }) {
  const cards = [
    { id: 'quests' as Page, icon: '📋', title: t('popup.quests'), desc: t('popup.quests_desc_water'), color: 'from-blue-500 to-cyan-400' },
    { id: 'games' as Page, icon: '🎮', title: t('popup.games'), desc: t('popup.games_desc_water'), color: 'from-purple-500 to-pink-400' },
    { id: 'friends' as Page, icon: '👥', title: t('popup.friends'), desc: t('popup.friends_desc'), color: 'from-orange-400 to-amber-400' },
    { id: 'invite' as Page, icon: '🤝', title: t('quests.invite_friend'), desc: t('quests.invite_reward'), color: 'from-pink-400 to-rose-500' },
  ];

  return (
    <div className="space-y-3">
      {cards.map((c) => (
        <button
          key={c.id}
          className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3.5 px-4 py-4 active:scale-[0.98] transition-transform text-left"
          onClick={() => onNavigate(c.id)}
        >
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${c.color} flex items-center justify-center shadow-sm shrink-0`}>
            <span className="text-2xl">{c.icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900">{c.title}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{c.desc}</p>
          </div>
          <ChevronRight />
        </button>
      ))}

      {/* Ad card — direct action */}
      <button
        className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3.5 px-4 py-4 active:scale-[0.98] transition-transform text-left"
        onClick={onShowAd}
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-sm shrink-0">
          <span className="text-2xl">📺</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{t('popup.ad')}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{t('popup.ad_desc_water', { amount: 35 })}</p>
        </div>
        <div className="bg-gradient-to-b from-green-400 to-green-600 text-white font-bold text-xs px-4 py-2 rounded-full shrink-0">
          {t('quests.ad_action')}
        </div>
      </button>
    </div>
  );
}

/* ─── Quests List ─── */
function QuestsList({ quests, completedIds, reward, isPending, onAction, rewardIcon, rewardUnit, rewardColor, t }: any) {
  return (
    <div className="space-y-3">
      {quests.map((q: any) => {
        const done = completedIds.has(q.id);
        const justRewarded = reward?.id === q.id;
        return (
          <div key={q.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 px-4 py-3.5">
            <div className="flex flex-col items-center gap-1 shrink-0 w-14">
              <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center">
                <span className="text-2xl">{q.icon}</span>
              </div>
              <div className="flex items-center gap-0.5">
                <span className="text-[10px]">{rewardIcon}</span>
                <span className={`text-[11px] font-bold ${rewardColor}`}>+{q.reward}{rewardUnit}</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 leading-snug">{t(`quests.${q.key}`)}</p>
              {q.descKey && <p className="text-[11px] text-gray-500 mt-0.5">{t(q.descKey)}</p>}
              <p className="text-[10px] text-gray-400 mt-0.5">{t(q.limitKey)}</p>
            </div>
            <div className="shrink-0 relative">
              {done ? (
                <div className="bg-gray-200 text-gray-500 font-bold text-xs px-4 py-2 rounded-full">{t('quests.completed')}</div>
              ) : (
                <button
                  className="bg-gradient-to-b from-green-400 to-green-600 text-white font-extrabold text-xs px-4 py-2 rounded-full shadow-sm active:scale-95 transition-transform disabled:opacity-50"
                  onClick={() => onAction(q.id)}
                  disabled={isPending}
                >
                  {t(q.actionKey)}
                </button>
              )}
              <AnimatePresence>
                {justRewarded && (
                  <motion.div
                    className="absolute -top-5 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                  >
                    +{q.reward}{rewardUnit}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Games List ─── */
function GamesList({ games, claimedGames, reward, isPending, onClaim, rewardIcon, rewardUnit, rewardColor, t }: any) {
  return (
    <div className="space-y-3">
      {games.map((g: any) => {
        const done = claimedGames.has(g.id);
        const justRewarded = reward?.id === g.id;
        const conditionText = g.conditionParam
          ? t(g.conditionKey, { level: g.conditionParam })
          : t(g.conditionKey);

        return (
          <div key={g.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center gap-3.5 px-4 py-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center shrink-0">
                <span className="text-3xl">{g.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">{t(g.nameKey)}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{t(g.descKey)}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{conditionText}</span>
                  <span className="flex items-center gap-0.5">
                    <span className="text-[10px]">{rewardIcon}</span>
                    <span className={`text-[11px] font-bold ${rewardColor}`}>+{g.reward}{rewardUnit}</span>
                  </span>
                </div>
              </div>
              <div className="shrink-0 relative">
                {done ? (
                  <div className="bg-gray-200 text-gray-500 font-bold text-xs px-4 py-2.5 rounded-full">{t('games.completed')}</div>
                ) : (
                  <button
                    className="bg-gradient-to-b from-purple-500 to-indigo-600 text-white font-extrabold text-xs px-5 py-2.5 rounded-full shadow-sm active:scale-95 transition-transform disabled:opacity-50"
                    onClick={() => onClaim(g.id)}
                    disabled={isPending}
                  >
                    {t('games.play')}
                  </button>
                )}
                <AnimatePresence>
                  {justRewarded && (
                    <motion.div
                      className="absolute -top-5 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                    >
                      +{g.reward}{rewardUnit}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        );
      })}
    </div>
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
      {/* Friend info card */}
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

        {/* Progress */}
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

      {/* Water display */}
      <div className="bg-blue-50 rounded-2xl border border-blue-100 px-4 py-3 flex items-center gap-3">
        <img src={UI.wateringCan} alt="" className="w-10 h-10 object-contain" />
        <div>
          <p className="text-xs text-blue-600 font-medium">{t('popup.your_water', { amount: Math.round(waterInCan) })}</p>
        </div>
      </div>

      {/* Action buttons */}
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

      {/* Toast */}
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

/* ─── Invite Inline Section ─── */
function InviteInlineSection({ t }: { t: any }) {
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
    <div className="space-y-3.5">
      <div className="flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2">
        <span className="text-lg">🎁</span>
        <span className="text-xs text-amber-700 font-medium">{t('quests.invite_reward')}</span>
      </div>

      {inviteData && (
        <>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{t('ref.your_link')}</p>
            <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
              <span className="flex-1 text-xs text-gray-600 truncate font-mono">{inviteData.link}</span>
              <button
                className="shrink-0 bg-green-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                onClick={() => copyToClipboard(inviteData.link, 'link')}
              >
                {copiedField === 'link' ? t('ref.copied') : t('ref.copy_link')}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-[10px] text-gray-400">{t('ref.or_share_code')}</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
            <span className="flex-1 text-center text-base font-mono font-extrabold text-green-600 tracking-widest">{inviteData.code}</span>
            <button
              className="shrink-0 bg-green-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
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
