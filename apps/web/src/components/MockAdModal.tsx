import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';

export interface MockAdModalProps {
  open: boolean;
  onClose: () => void;
  rewardAmount?: number;
  onComplete: (reward: { amount: number }) => void;
}

const COUNTDOWN_START = 10;

export default function MockAdModal({
  open,
  onClose,
  rewardAmount = 10,
  onComplete,
}: MockAdModalProps) {
  const { t } = useTranslation();
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_START);

  useEffect(() => {
    if (!open) return;
    setSecondsLeft(COUNTDOWN_START);
    let remaining = COUNTDOWN_START;
    const id = window.setInterval(() => {
      remaining -= 1;
      setSecondsLeft(Math.max(0, remaining));
      if (remaining <= 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const progress = secondsLeft / COUNTDOWN_START;
  const canClose = secondsLeft === 0;

  const handleClaim = () => {
    if (!canClose) return;
    onComplete({ amount: rewardAmount });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" aria-hidden />

          <div className="relative flex flex-1 flex-col min-h-0">
            <div className="shrink-0 h-1.5 bg-white/20 mx-4 mt-4 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400"
                initial={false}
                animate={{ width: `${progress * 100}%` }}
                transition={{ type: 'tween', duration: 0.35 }}
              />
            </div>

            <div className="flex-1 flex items-center justify-center p-6">
              <motion.div
                className="relative w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl border border-white/10"
                initial={{ scale: 0.92, y: 24, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.95, y: 16, opacity: 0 }}
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              >
                <div className="aspect-[4/5] bg-gradient-to-br from-violet-600 via-fuchsia-500 to-amber-400 flex flex-col items-center justify-center gap-4 p-8 text-center">
                  <p className="text-white/90 text-sm font-semibold tracking-wide uppercase">
                    {t('ad.watching')}
                  </p>
                  <p className="text-7xl drop-shadow-lg" aria-hidden>
                    🧴
                  </p>
                  <p className="text-white text-2xl font-extrabold drop-shadow-md">
                    Ad Placeholder
                  </p>
                  <p className="text-white/80 text-sm font-medium">
                    {t('ad.reward', { amount: rewardAmount })}
                  </p>
                  {!canClose && (
                    <div
                      className="mt-2 text-5xl font-black tabular-nums text-white drop-shadow-lg"
                      aria-live="polite"
                    >
                      {secondsLeft}
                    </div>
                  )}
                </div>
              </motion.div>
            </div>

            <div className="shrink-0 p-6 pb-8 flex justify-center">
              {canClose && (
                <motion.button
                  type="button"
                  className="w-full max-w-sm rounded-2xl bg-farm-green text-white font-bold py-3.5 px-6 shadow-lg"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={handleClaim}
                >
                  {t('ad.close')}
                </motion.button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
