import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { UI } from '../lib/assets';

interface EventEntry {
  id: number;
  type: 'invite' | 'water' | 'greet';
  name: string;
}

interface EventToastCtx {
  showEvent: (type: EventEntry['type'], name: string) => void;
}

const Ctx = createContext<EventToastCtx>({ showEvent: () => {} });

export const useEventToast = () => useContext(Ctx);

const EVENT_CONFIG: Record<string, { icon: string; bgFrom: string; bgTo: string; i18nKey: string }> = {
  invite: { icon: '🎉', bgFrom: '#FF9800', bgTo: '#F57C00', i18nKey: 'event.friend_joined' },
  water: { icon: '💧', bgFrom: '#29B6F6', bgTo: '#0288D1', i18nKey: 'event.friend_watered' },
  greet: { icon: '👋', bgFrom: '#66BB6A', bgTo: '#388E3C', i18nKey: 'event.friend_greeted' },
};

export function EventToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<EventEntry[]>([]);
  const idRef = useRef(0);

  const showEvent = useCallback((type: EventEntry['type'], name: string) => {
    const id = ++idRef.current;
    setQueue((prev) => [...prev.slice(-2), { id, type, name }]);
    setTimeout(() => {
      setQueue((prev) => prev.filter((e) => e.id !== id));
    }, 2500);
  }, []);

  return (
    <Ctx.Provider value={{ showEvent }}>
      {children}
      <div className="fixed top-[max(0.5rem,env(safe-area-inset-top))] inset-x-0 z-[300] flex flex-col items-center gap-2 pointer-events-none">
        <AnimatePresence>
          {queue.map((e) => (
            <EventToastItem key={e.id} entry={e} />
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

function EventToastItem({ entry }: { entry: EventEntry }) {
  const { t } = useTranslation();
  const cfg = EVENT_CONFIG[entry.type] ?? EVENT_CONFIG.greet;

  return (
    <motion.div
      className="pointer-events-auto rounded-2xl px-4 py-3 mx-4 flex items-center gap-3 shadow-lg max-w-[360px] w-full"
      style={{
        background: `linear-gradient(135deg, ${cfg.bgFrom}, ${cfg.bgTo})`,
      }}
      initial={{ y: -60, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -40, opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', damping: 25, stiffness: 350 }}
    >
      <span className="text-2xl">{cfg.icon}</span>
      <p className="text-white text-sm font-bold flex-1">
        {t(cfg.i18nKey, { name: entry.name })}
      </p>
    </motion.div>
  );
}
