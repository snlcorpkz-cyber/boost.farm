import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { usePhase } from '../hooks/usePhase';
import { api } from '../lib/api';
import { UI } from '../lib/assets';
import BottomNav from '../components/farm/BottomNav';
import MockAdModal from '../components/MockAdModal';

const QUEST_ICONS: Record<string, string> = {
  checkin: '📋',
  greet_friend: '👋',
  watch_ad: '📺',
  view_product: '🔍',
  water_friend: '💧',
  daily_challenge: '🎁',
};

// H-1: quests that can only progress from real in-app actions (not by clicking
// the Claim button on this page). For these we disable the button and show the
// user where to go instead of calling /quests/:id/complete.
const REQUIRES_REAL_ACTION = new Set(['greet_friend', 'water_friend', 'view_product']);

export default function QuestsPage() {
  const { t } = useTranslation();
  const { phase } = usePhase();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['quests', phase],
    queryFn: () => api('/quests'),
  });

  const { data: dailyChallenge } = useQuery({
    queryKey: ['daily-challenge'],
    queryFn: () => api('/quests/daily-challenge'),
  });

  const [questError, setQuestError] = useState<string | null>(null);

  const completeQuest = useMutation({
    mutationFn: (questId: string) => api(`/quests/${questId}/complete`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quests'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
      setQuestError(null);
    },
    onError: (err: any) => {
      const msg = err?.error?.message || err?.message || 'Quest failed';
      setQuestError(msg);
      setTimeout(() => setQuestError(null), 3000);
    },
  });

  // H-1: for watch_ad quests we credit via /farm/ad-reward (server authoritative,
  // rank-based amount). That endpoint also auto-increments the watch_ad quest
  // counter via incrementActivityQuest — single source of truth.
  const creditAdReward = useMutation({
    mutationFn: (vars: { type: 'water' | 'nutrition' }) =>
      api('/farm/ad-reward', {
        method: 'POST',
        body: JSON.stringify({ type: vars.type, placement: 'quest', idempotencyKey: crypto.randomUUID() }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quests'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
      qc.invalidateQueries({ queryKey: ['ad-limits'] });
    },
    onError: (err: any) => {
      const msg = err?.error?.message || err?.message || 'Ad reward failed';
      setQuestError(msg);
      setTimeout(() => setQuestError(null), 3000);
    },
  });

  const [adOpen, setAdOpen] = useState(false);
  const [adQuest, setAdQuest] = useState<any | null>(null);

  const quests = data?.quests || [];
  const waterQuests = quests.filter((q: any) => q.reward_type === 'water');
  const nutritionQuests = quests.filter((q: any) => q.reward_type === 'nutrition');

  const handleQuestAction = (quest: any) => {
    const key = quest.quest_key;
    if (key === 'watch_ad') {
      setAdQuest(quest);
      setAdOpen(true);
      return;
    }
    if (key === 'greet_friend' || key === 'water_friend') {
      navigate('/friends');
      return;
    }
    if (key === 'view_product') {
      // Offers are shown on the farm page; send the user there.
      navigate('/');
      return;
    }
    completeQuest.mutate(quest.id);
  };

  const handleAdComplete = () => {
    if (adQuest) {
      const type: 'water' | 'nutrition' = adQuest.reward_type === 'nutrition' ? 'nutrition' : 'water';
      creditAdReward.mutate({ type });
      setAdQuest(null);
    }
    setAdOpen(false);
  };

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-blue-50 to-white pb-20">
      <MockAdModal
        open={adOpen}
        onClose={() => setAdOpen(false)}
        onComplete={handleAdComplete}
        rewardAmount={40}
      />
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md px-4 pt-4 pb-3 shadow-sm">
        <h1 className="text-xl font-extrabold text-gray-800">{t('quests.title')}</h1>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-xs bg-farm-green/10 text-farm-green font-semibold px-2 py-0.5 rounded-full">
            {t('phase.' + phase)}
          </span>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-4">
        {questError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 font-medium text-center">
            {questError}
          </div>
        )}
        {/* Daily Challenge */}
        {dailyChallenge && (
          <motion.div
            className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-4 border border-amber-200"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <img src={UI.gift} alt="gift" className="w-7 h-7 object-contain" />
                <span className="font-bold text-sm text-gray-800">{t('quests.daily_challenge')}</span>
              </div>
              {dailyChallenge.completed && (
                <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full font-bold">
                  {t('quests.completed')}
                </span>
              )}
            </div>
            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-orange-400 rounded-full transition-all"
                style={{ width: `${dailyChallenge.progress * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {t('quests.waterings_today', {
                current: Math.round(dailyChallenge.waterGiven ?? 0),
                required: dailyChallenge.required,
              })}
            </p>
          </motion.div>
        )}

        {/* Water quests */}
        <div>
          <h2 className="text-sm font-bold text-blue-700 mb-2 flex items-center gap-1.5">
            💧 {t('quests.water_quests')}
          </h2>
          <div className="space-y-2">
            {waterQuests.map((quest: any) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                onComplete={() => handleQuestAction(quest)}
                isLoading={completeQuest.isPending || creditAdReward.isPending}
              />
            ))}
          </div>
        </div>

        {/* Fertilizer quests */}
        <div>
          <h2 className="text-sm font-bold text-amber-700 mb-2 flex items-center gap-1.5">
            🌿 {t('quests.fertilizer_quests')}
          </h2>
          <div className="space-y-2">
            {nutritionQuests.map((quest: any) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                onComplete={() => handleQuestAction(quest)}
                isLoading={completeQuest.isPending || creditAdReward.isPending}
              />
            ))}
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}

function QuestCard({
  quest,
  onComplete,
  isLoading,
}: {
  quest: any;
  onComplete: () => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const icon = QUEST_ICONS[quest.quest_key] || '📋';
  const isCompleted = quest.isCompleted;
  const requiresRealAction = REQUIRES_REAL_ACTION.has(quest.quest_key);

  let buttonLabel: string;
  if (isCompleted) buttonLabel = t('quests.completed');
  else if (quest.quest_key === 'greet_friend' || quest.quest_key === 'water_friend')
    buttonLabel = t('nav.friends', { defaultValue: 'Friends' });
  else if (quest.quest_key === 'view_product')
    buttonLabel = t('nav.offers', { defaultValue: 'Offers' });
  else buttonLabel = t('quests.available');

  return (
    <motion.div
      className={`flex items-center justify-between bg-white rounded-xl p-3 shadow-sm border ${
        isCompleted ? 'border-gray-200 opacity-60' : 'border-gray-100'
      }`}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-center gap-3">
        {icon === '🎁'
          ? <img src={UI.gift} alt="gift" className="w-7 h-7 object-contain" />
          : <span className="text-2xl">{icon}</span>
        }
        <div>
          <p className="text-sm font-semibold text-gray-800">
            {t(`quests.${quest.quest_key}`)}
          </p>
          <p className="text-xs text-gray-400">
            {quest.reward_type === 'water' ? '💧' : '🌿'} +{quest.reward_amount}
            {quest.reward_type === 'water' ? 'g' : ''}
            {' · '}
            {quest.completedCount}/{quest.limit_per_phase}
          </p>
        </div>
      </div>
      <button
        className={`px-4 py-1.5 rounded-full text-xs font-bold ${
          isCompleted
            ? 'bg-gray-200 text-gray-400'
            : requiresRealAction
              ? 'bg-blue-500 text-white shadow-md'
              : 'bg-farm-green text-white shadow-md'
        }`}
        onClick={onComplete}
        disabled={isCompleted || isLoading}
      >
        {buttonLabel}
      </button>
    </motion.div>
  );
}
