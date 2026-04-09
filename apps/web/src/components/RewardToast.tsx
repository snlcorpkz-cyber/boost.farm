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
    }, 1600);
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
  const headerText = isWater ? t('reward.water_received') : t('reward.fert_received');
  const icon = isWater ? UI.waterDrop : UI.fertilizer;
  const amountText = isWater ? `+${amount}g` : `+${amount}`;
  const amountColor = isWater ? 'text-sky-600' : 'text-amber-700';

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="pointer-events-auto rounded-2xl overflow-hidden w-[190px]"
        style={{
          background: 'linear-gradient(180deg, #FFF8E7 0%, #FAECC8 100%)',
          border: '2.5px solid rgba(180, 130, 50, 0.3)',
          boxShadow: '0 8px 32px rgba(120, 80, 20, 0.3), 0 3px 0 #C9A054, inset 0 1px 0 rgba(255,255,255,0.6)',
        }}
        initial={{ scale: 0.4, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.7, opacity: 0, y: -15 }}
        transition={{ type: 'spring', damping: 18, stiffness: 400 }}
      >
        {/* Wooden header */}
        <div
          className="py-2 px-3 text-center"
          style={{
            background: 'linear-gradient(180deg, #A0784A 0%, #7B5C35 50%, #6B4E2C 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
          }}
        >
          <span className="text-white text-xs font-black tracking-wide drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]">{headerText}</span>
        </div>

        {/* Content */}
        <div className="flex flex-col items-center py-4 gap-1.5">
          <motion.img
            src={icon}
            alt=""
            className="w-12 h-12 object-contain drop-shadow-md"
            animate={{ scale: [1, 1.2, 1], rotate: [0, -5, 5, 0] }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
          <span className={`text-2xl font-black ${amountColor} drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]`}>{amountText}</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
