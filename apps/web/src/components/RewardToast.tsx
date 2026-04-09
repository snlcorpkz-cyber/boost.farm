import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { UI } from '../lib/assets';

type RewardType = 'water' | 'fertilizer';

interface RewardEntry {
  id: number;
  type: RewardType;
  amount: number;
}

interface RewardToastCtx {
  showReward: (type: RewardType, amount: number) => void;
}

const Ctx = createContext<RewardToastCtx>({ showReward: () => {} });

export const useRewardToast = () => useContext(Ctx);

export function RewardToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<RewardEntry[]>([]);
  const idRef = useRef(0);

  const showReward = useCallback((type: RewardType, amount: number) => {
    const id = ++idRef.current;
    setQueue((prev) => [...prev, { id, type, amount }]);
    setTimeout(() => {
      setQueue((prev) => prev.filter((r) => r.id !== id));
    }, 1400);
  }, []);

  return (
    <Ctx.Provider value={{ showReward }}>
      {children}
      <AnimatePresence>
        {queue.map((r) => (
          <RewardModal key={r.id} type={r.type} amount={r.amount} />
        ))}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

function RewardModal({ type, amount }: { type: RewardType; amount: number }) {
  const { t } = useTranslation();

  const isWater = type === 'water';
  const headerBg = isWater
    ? 'bg-gradient-to-r from-green-400 to-emerald-500'
    : 'bg-gradient-to-r from-amber-400 to-orange-500';
  const headerText = isWater ? t('reward.water_received') : t('reward.fert_received');
  const icon = isWater ? UI.waterDrop : UI.fertilizer;
  const amountText = isWater ? `${amount}g` : `${amount}`;
  const amountColor = isWater ? 'text-blue-600' : 'text-amber-600';

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="pointer-events-auto rounded-2xl overflow-hidden shadow-2xl bg-white w-[180px]"
        initial={{ scale: 0.5, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: -10 }}
        transition={{ type: 'spring', damping: 20, stiffness: 400 }}
      >
        <div className={`${headerBg} py-2 px-3 text-center`}>
          <span className="text-white text-xs font-bold tracking-wide">{headerText}</span>
        </div>
        <div className="flex flex-col items-center py-4 gap-1">
          <img src={icon} alt="" className="w-10 h-10 object-contain" />
          <span className={`text-2xl font-extrabold ${amountColor}`}>{amountText}</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
