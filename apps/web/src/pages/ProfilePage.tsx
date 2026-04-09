import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { AVATAR_IMAGES } from '../lib/assets';
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

  const handleLangChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('eco_lang', lang);
    api('/user/profile', {
      method: 'PATCH',
      body: JSON.stringify({ locale: lang }),
    });
  };

  const handleDelete = async () => {
    await api('/user/account', { method: 'DELETE' });
    logout();
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

        {/* Logout */}
        <button
          className="w-full bg-white rounded-2xl p-4 shadow-sm text-left text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
          onClick={logout}
        >
          {t('profile.logout')} →
        </button>

        {/* Danger zone - buried deep */}
        <div className="mt-8 pt-8 border-t border-gray-100">
          <button
            className="text-xs text-gray-300 hover:text-red-400 transition-colors"
            onClick={() => setShowDelete(!showDelete)}
          >
            {t('profile.delete_account')}
          </button>
          {showDelete && (
            <div className="mt-3 bg-red-50 rounded-xl p-3 border border-red-200">
              <p className="text-xs text-red-600 mb-2">This action is irreversible.</p>
              <button
                className="bg-red-500 text-white text-xs font-bold px-4 py-2 rounded-lg"
                onClick={handleDelete}
              >
                Confirm Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
