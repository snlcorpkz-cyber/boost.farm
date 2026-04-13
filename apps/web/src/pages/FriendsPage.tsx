import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { AVATAR_IMAGES, UI } from '../lib/assets';
import { useRewardToast } from '../components/RewardToast';
import BottomNav from '../components/farm/BottomNav';

export default function FriendsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showReward } = useRewardToast();
  const [copied, setCopied] = useState(false);

  const { data } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api('/friends'),
  });

  const { data: inviteData } = useQuery({
    queryKey: ['invite-code'],
    queryFn: () => api<{ code: string }>('/friends/invite-code'),
  });

  const greetFriend = useMutation({
    mutationFn: (friendId: string) =>
      api(`/friends/${friendId}/greet`, { method: 'POST' }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
      showReward('water', data.waterEarned);
    },
  });

  const waterFriend = useMutation({
    mutationFn: (friendId: string) =>
      api(`/friends/${friendId}/water`, { method: 'POST' }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
      showReward('fertilizer', data.nutritionEarned);
    },
  });

  const copyCode = async () => {
    if (!inviteData?.code) return;
    try {
      await navigator.clipboard.writeText(inviteData.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const friends = data?.friends || [];

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-purple-50 to-white pb-20">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md px-4 pt-4 pb-3 shadow-sm">
        <h1 className="text-xl font-extrabold text-gray-800">{t('friends.title')}</h1>
      </div>

      <div className="px-4 mt-4 space-y-3">
        {/* Invite section */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-2">
            <img src={UI.gift} alt="" className="w-5 h-5 object-contain" />
            <span className="text-xs text-amber-700 font-medium">{t('ref.reward_hint')}</span>
          </div>

          {inviteData && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{t('friends.invite_code')}</p>
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <span className="flex-1 text-center text-lg font-mono font-extrabold text-green-600 tracking-widest">{inviteData.code}</span>
                <button
                  className="shrink-0 bg-green-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                  onClick={copyCode}
                >
                  {copied ? t('ref.copied') : t('ref.copy_code')}
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Friends list */}
        {friends.length === 0 ? (
          <div className="text-center py-12">
            <img src={UI.greetHand} alt="" className="w-12 h-12 mx-auto opacity-40 mb-2" />
            <p className="text-sm text-gray-400">{t('friends.empty')}</p>
          </div>
        ) : (
          friends.map((friend: any) => {
            const avatarSrc = AVATAR_IMAGES[friend.avatar_id] || AVATAR_IMAGES.bear;
            return (
              <motion.div
                key={friend.id}
                role="button"
                tabIndex={0}
                className="flex items-center gap-3 bg-white rounded-xl p-3 shadow-sm cursor-pointer active:scale-[0.99]"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => navigate(`/friends/${friend.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/friends/${friend.id}`);
                  }
                }}
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-200 to-green-300 flex items-center justify-center border-2 border-white shadow overflow-hidden">
                  <img src={avatarSrc} alt="" className="w-10 h-10 object-contain" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">{friend.nickname}</p>
                  {friend.farm && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-[80px]">
                        <div
                          className="h-full bg-green-500 rounded-full"
                          style={{ width: `${friend.farm.growth_percent}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400">
                        {friend.farm.growth_percent?.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="bg-amber-100 text-amber-700 px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-50"
                    onClick={() => greetFriend.mutate(friend.id)}
                    disabled={greetFriend.isPending}
                  >
                    {t('friends.greet')}
                  </button>
                  <button
                    type="button"
                    className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-50"
                    onClick={() => waterFriend.mutate(friend.id)}
                    disabled={waterFriend.isPending}
                  >
                    {t('friends.water')}
                  </button>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      <BottomNav />
    </div>
  );
}
