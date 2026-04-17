import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { AVATAR_IMAGES } from '../lib/assets';
import { RANKS, type RankId } from '@eco-farm/game-engine';
import BottomNav from '../components/farm/BottomNav';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'es', label: 'Español' },
];

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: farmData } = useQuery({
    queryKey: ['farm'],
    queryFn: () => api<{ rank: RankId; rankDef: any; farm: { total_water_this_month?: number } }>('/farm'),
  });

  const handleLangChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('eco_lang', lang);
    api('/user/profile', {
      method: 'PATCH',
      body: JSON.stringify({ locale: lang }),
    });
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api('/user/account', { method: 'DELETE' });
    } finally {
      logout();
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-gray-50 to-white pb-20">
      <div className="bg-white/80 backdrop-blur-md px-4 pt-4 pb-3 shadow-sm">
        <h1 className="text-xl font-extrabold text-gray-800">{t('profile.title')}</h1>
      </div>

      <div className="px-4 mt-4 space-y-4">
        {/* User info */}
        <div className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-200 to-green-300 flex items-center justify-center border-3 border-white shadow-lg overflow-hidden">
            <img src={AVATAR_IMAGES[user?.avatar_id ?? 'bear'] || AVATAR_IMAGES.bear} alt="" className="w-14 h-14 object-contain" />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-800">{user?.nickname}</p>
            <p className="text-xs text-gray-400">{user?.email}</p>
          </div>
        </div>

        {/* Rank */}
        {farmData && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-700 mb-2">Rank</p>
            {(() => {
              const currentRank = RANKS.find((r) => r.id === farmData.rank) || RANKS[0];
              const currentIdx = RANKS.findIndex((r) => r.id === farmData.rank);
              const nextRank = currentIdx < RANKS.length - 1 ? RANKS[currentIdx + 1] : null;
              const totalWater = farmData.farm?.total_water_this_month ?? 0;
              const progressPct = nextRank
                ? Math.min(100, ((totalWater - currentRank.minWaterLastMonth) / (nextRank.minWaterLastMonth - currentRank.minWaterLastMonth)) * 100)
                : 100;

              const rankColors: Record<string, string> = {
                novice: 'from-gray-300 to-gray-400',
                amateur: 'from-green-400 to-green-600',
                farmer: 'from-blue-400 to-blue-600',
                master: 'from-yellow-400 to-amber-500',
              };

              return (
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`rounded-full px-3 py-1 bg-gradient-to-r ${rankColors[currentRank.id] || rankColors.novice} text-white text-xs font-extrabold shadow`}>
                      {currentRank.id.charAt(0).toUpperCase() + currentRank.id.slice(1)}
                    </div>
                    <span className="text-xs text-gray-500">
                      {Math.round(totalWater)}g this month
                    </span>
                  </div>
                  {nextRank && (
                    <div>
                      <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r ${rankColors[currentRank.id] || rankColors.novice} rounded-full transition-all`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {Math.round(nextRank.minWaterLastMonth - totalWater)}g to {nextRank.id.charAt(0).toUpperCase() + nextRank.id.slice(1)}
                      </p>
                    </div>
                  )}
                  {!nextRank && (
                    <p className="text-[10px] text-amber-600 font-bold mt-1">Max rank reached!</p>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Language */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700 mb-3">{t('profile.language')}</p>
          <div className="flex gap-2">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  i18n.language === lang.code
                    ? 'bg-farm-green text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
                onClick={() => handleLangChange(lang.code)}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* Account actions — Logout and Delete Account live side-by-side in
            the same settings card so users can find both in the obvious
            place. Delete sits BELOW logout with a muted look (no red, smaller
            text) so accidental taps are unlikely, but it's still findable
            (required by Play Store policy). */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <button
            className="w-full p-4 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            onClick={logout}
          >
            {t('profile.logout')} →
          </button>
          <div className="border-t border-gray-100" />
          <button
            className="w-full p-4 text-left text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            onClick={() => setShowDelete(true)}
          >
            {t('profile.delete_account')}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showDelete && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 z-[90]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !deleting && setShowDelete(false)}
            />
            <motion.div
              className="fixed inset-0 z-[91] flex items-center justify-center px-6 pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="bg-white rounded-3xl shadow-2xl w-full max-w-[340px] p-6 pointer-events-auto"
                initial={{ scale: 0.9, y: 16 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 16 }}
                transition={{ type: 'spring', damping: 24, stiffness: 340 }}
              >
                <h3 className="text-base font-bold text-gray-800 text-center mb-2">
                  {t('profile.delete_confirm_title', 'Delete account?')}
                </h3>
                <p className="text-sm text-gray-500 text-center mb-5 leading-relaxed">
                  {t(
                    'profile.delete_confirm_body',
                    'Your account, farm progress, friends and push subscriptions will be permanently removed. This cannot be undone.',
                  )}
                </p>
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50"
                    onClick={() => setShowDelete(false)}
                    disabled={deleting}
                  >
                    {t('profile.delete_no', 'No')}
                  </button>
                  <button
                    className="flex-1 py-2.5 rounded-xl bg-gray-700 text-white text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? '…' : t('profile.delete_yes', 'Yes')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <BottomNav />
    </div>
  );
}
