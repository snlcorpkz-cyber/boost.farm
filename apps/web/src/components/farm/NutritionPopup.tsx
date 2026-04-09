import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { UI } from '../../lib/assets';

interface NutritionPopupProps {
  open: boolean;
  onClose: () => void;
  currentLevel: number;
}

const TIERS = [
  { min: 0, max: 0, label: '0', speed: '×1.0', descKey: 'nutrition.speed_normal' },
  { min: 1, max: 44, label: '1 – 44', speed: '×1.5', descKey: 'nutrition.speed_fast' },
  { min: 45, max: Infinity, label: '45+', speed: '×2.0', descKey: 'nutrition.speed_max' },
];

function getActiveTier(level: number) {
  if (level <= 0) return 0;
  if (level < 45) return 1;
  return 2;
}

export default function NutritionPopup({ open, onClose, currentLevel }: NutritionPopupProps) {
  const { t } = useTranslation();
  const activeTier = getActiveTier(currentLevel);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="fixed inset-0 z-[90] bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-[95] flex items-center justify-center pointer-events-none px-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
          >
            <div
              className="pointer-events-auto w-full max-w-[300px] bg-white rounded-3xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center shadow border-2 border-white/60">
                  <img src={UI.fertilizer} alt="" className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-gray-900">{t('nutrition.title')}</p>
                  <p className="text-xs text-gray-500">{t('nutrition.current', { level: currentLevel })}</p>
                </div>
              </div>

              {/* Tiers table */}
              <div className="px-4 pt-1 pb-2">
                <div className="rounded-2xl border border-gray-100 overflow-hidden">
                  {TIERS.map((tier, i) => {
                    const isActive = activeTier === i;
                    return (
                      <div
                        key={i}
                        className={`flex items-center px-3 py-2.5 ${
                          i > 0 ? 'border-t border-gray-100' : ''
                        } ${isActive ? 'bg-amber-50' : ''}`}
                      >
                        <span className={`text-xs w-[52px] font-semibold tabular-nums ${isActive ? 'text-amber-700' : 'text-gray-400'}`}>
                          {tier.label}
                        </span>
                        <span className="text-[10px] text-gray-400 mx-1">→</span>
                        <div className="flex-1">
                          <span className={`text-sm font-extrabold ${isActive ? 'text-amber-700' : 'text-gray-400'}`}>
                            {tier.speed}
                          </span>
                          <span className={`text-[10px] ml-1 ${isActive ? 'text-amber-600' : 'text-gray-300'}`}>
                            {t(tier.descKey)}
                          </span>
                        </div>
                        {isActive && (
                          <span className="text-[8px] font-bold uppercase tracking-wider text-white bg-green-500 px-1.5 py-0.5 rounded-full leading-none">
                            now
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Motivational text */}
              <p className="text-[11px] text-gray-400 text-center px-5 pb-4 leading-relaxed">
                {t('nutrition.hint')}
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
