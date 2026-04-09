import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const NAV_ITEMS = [
  { path: '/', icon: '🏡', labelKey: 'nav.farm' },
  { path: '/quests', icon: '📋', labelKey: 'nav.quests' },
  { path: '/friends', icon: '👥', labelKey: 'nav.friends' },
  { path: '/profile', icon: '⚙️', labelKey: 'nav.profile' },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white/90 backdrop-blur-md border-t border-gray-200 z-50">
      <div className="flex justify-around items-center py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              className={`flex flex-col items-center gap-0.5 px-4 py-1 rounded-xl transition-colors ${
                isActive ? 'text-farm-green' : 'text-gray-400'
              }`}
              onClick={() => navigate(item.path)}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-[10px] font-semibold">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
