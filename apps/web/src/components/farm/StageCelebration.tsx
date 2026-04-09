import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { UI } from '../../lib/assets';

interface StageCelebrationProps {
  active: boolean;
  stage: number;
  onDismiss: () => void;
}

const NUM_BUTTERFLIES = 7;
const GLOW_DURATION = 3;
const EFFECTS_DURATION = 2000;
const MODAL_DURATION = 2000;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function ButterflyAnim({ index, active }: { index: number; active: boolean }) {
  const path = useMemo(() => {
    const startX = randomBetween(-40, 40);
    const startY = randomBetween(-20, 30);
    const midX1 = randomBetween(-120, 120);
    const midY1 = randomBetween(-100, 60);
    const midX2 = randomBetween(-100, 100);
    const midY2 = randomBetween(-80, 40);
    const endX = randomBetween(-50, 50);
    const endY = randomBetween(-30, 20);
    return { startX, startY, midX1, midY1, midX2, midY2, endX, endY };
  }, [index]);

  const duration = randomBetween(3, 5);
  const delay = randomBetween(0, 1.2);
  const size = randomBetween(22, 38);
  const flipDir = Math.random() > 0.5 ? 1 : -1;

  if (!active) return null;

  return (
    <motion.img
      src={UI.butterfly}
      alt=""
      className="absolute pointer-events-none"
      style={{
        width: size,
        height: size,
        left: '50%',
        top: '35%',
        scaleX: flipDir,
      }}
      initial={{ x: path.startX, y: path.startY, opacity: 0, rotate: 0 }}
      animate={{
        x: [path.startX, path.midX1, path.midX2, path.endX, path.startX],
        y: [path.startY, path.midY1, path.midY2, path.endY, path.startY],
        opacity: [0, 1, 1, 1, 0.8],
        rotate: [0, randomBetween(-20, 20), randomBetween(-15, 15), randomBetween(-10, 10), 0],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  );
}

function Sparkle({ index }: { index: number }) {
  const x = randomBetween(10, 90);
  const y = randomBetween(10, 75);
  const size = randomBetween(3, 7);
  const dur = randomBetween(0.6, 1.4);
  const del = randomBetween(0, 2);

  return (
    <motion.div
      className="absolute rounded-full bg-yellow-200 pointer-events-none"
      style={{ left: `${x}%`, top: `${y}%`, width: size, height: size }}
      animate={{
        opacity: [0, 1, 0],
        scale: [0.3, 1.2, 0.3],
      }}
      transition={{ duration: dur, delay: del, repeat: Infinity }}
    />
  );
}

export default function StageCelebration({ active, stage, onDismiss }: StageCelebrationProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'idle' | 'effects' | 'modal'>('idle');

  useEffect(() => {
    if (!active) {
      setPhase('idle');
      return;
    }
    setPhase('effects');
    const modalTimer = setTimeout(() => setPhase('modal'), EFFECTS_DURATION);
    return () => clearTimeout(modalTimer);
  }, [active]);

  useEffect(() => {
    if (phase !== 'modal') return;
    const closeTimer = setTimeout(() => {
      setPhase('idle');
      onDismiss();
    }, MODAL_DURATION);
    return () => clearTimeout(closeTimer);
  }, [phase, onDismiss]);

  return (
    <AnimatePresence>
      {phase === 'effects' && (
        <>
          {/* Golden glow overlay */}
          <motion.div
            className="absolute inset-0 z-[25] pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
            transition={{ duration: 0.6 }}
          >
            <motion.div
              className="w-full h-full"
              style={{
                background: 'radial-gradient(ellipse at 50% 60%, rgba(255,223,100,0.45) 0%, rgba(255,200,50,0.15) 40%, transparent 70%)',
              }}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: GLOW_DURATION, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>

          {/* Rainbow */}
          <motion.img
            src={UI.rainbow}
            alt=""
            className="absolute left-1/2 z-[26] pointer-events-none"
            style={{ width: 280, marginLeft: -140, top: '8%' }}
            initial={{ opacity: 0, scale: 0.4, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />

          {/* Butterflies */}
          <div className="absolute inset-0 z-[27] pointer-events-none overflow-hidden">
            {Array.from({ length: NUM_BUTTERFLIES }).map((_, i) => (
              <ButterflyAnim key={i} index={i} active />
            ))}
          </div>

          {/* Sparkle particles */}
          <div className="absolute inset-0 z-[26] pointer-events-none overflow-hidden">
            {Array.from({ length: 18 }).map((_, i) => (
              <Sparkle key={i} index={i} />
            ))}
          </div>
        </>
      )}

      {phase === 'modal' && (
        <>
          <motion.div
            className="fixed inset-0 z-[98] bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="fixed inset-0 z-[99] flex items-center justify-center px-4"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          >
            <div className="bg-white rounded-3xl shadow-2xl overflow-hidden text-center max-w-[340px] w-full">
              <div className="bg-gradient-to-br from-yellow-300 via-amber-400 to-orange-400 px-6 pt-8 pb-5">
                <motion.div
                  className="text-6xl mb-2"
                  animate={{ rotate: [0, -8, 8, -5, 5, 0], scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  🎉
                </motion.div>
                <h2 className="text-2xl font-black text-white drop-shadow">
                  {t('coupon.congrats')}
                </h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-lg font-bold text-gray-800 mb-1">
                  {t('farm.stage', { current: stage })}
                </p>
                <p className="text-sm text-gray-500">
                  {stage < 6
                    ? t('farm.until_next_stage', { percent: '0' })
                    : t('farm.harvested')}
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
