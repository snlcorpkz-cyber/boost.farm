import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { UI } from '../../lib/assets';
import { sounds } from '../../lib/sounds';

interface WateringCanProps {
  waterAmount: number;
  onWater: (times: 1 | 5 | 20) => void;
  isWatering: boolean;
  canWater: boolean;
  shaking: boolean;
}

const BATCH_OPTIONS = [1, 5, 20] as const;
type BatchSize = (typeof BATCH_OPTIONS)[number];

export default function WateringCan({ waterAmount, onWater, isWatering, canWater, shaking }: WateringCanProps) {
  const { t } = useTranslation();
  const [selectedBatch, setSelectedBatch] = useState<BatchSize>(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const requiredWater = selectedBatch * 10;
  const canDoSelected = canWater && waterAmount >= requiredWater && !isWatering;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  return (
    <div className="flex flex-col items-center">
      {/* Batch selector — single pill with dropdown */}
      <div className="relative mb-1.5 z-20" ref={menuRef}>
        <button
          className="px-3.5 py-1 rounded-full text-[10px] font-extrabold bg-gradient-to-b from-blue-400 to-blue-600 text-white shadow-md active:scale-95 transition-transform flex items-center gap-1"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span>{t('farm.water_x', { count: selectedBatch })}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}>
            <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="absolute top-full right-0 mt-1.5 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden min-w-[120px]"
              initial={{ opacity: 0, y: -4, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.92 }}
              transition={{ duration: 0.12 }}
            >
              {BATCH_OPTIONS.map((size) => {
                const enough = waterAmount >= size * 10;
                const isActive = selectedBatch === size;
                return (
                  <button
                    key={size}
                    className={`w-full px-5 py-2 text-[11px] font-bold whitespace-nowrap transition-colors flex items-center justify-between gap-4 ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : enough
                          ? 'text-gray-700 active:bg-gray-50'
                          : 'text-gray-300'
                    }`}
                    onClick={() => {
                      if (enough) {
                        setSelectedBatch(size);
                        setMenuOpen(false);
                      }
                    }}
                    disabled={!enough}
                  >
                    <span>{t('farm.water_x', { count: size })}</span>
                    <span className={`text-[9px] font-semibold ${isActive ? 'text-blue-400' : 'text-gray-400'}`}>
                      {size * 10}g
                    </span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Can — tap to water */}
      <motion.button
        className="relative w-[96px] h-[96px] rounded-full bg-blue-100/80 backdrop-blur-sm flex items-center justify-center shadow-md border-2 border-white/60"
        whileTap={canDoSelected ? { scale: 0.88 } : {}}
        onClick={() => { if (canDoSelected) { sounds.waterDrip(); onWater(selectedBatch); } }}
        disabled={!canDoSelected}
        animate={
          shaking
            ? { x: [0, -3, 3, -2, 2, 0], rotate: [0, -2, 2, -1, 1, 0] }
            : {}
        }
        transition={{ duration: 0.5 }}
      >
        <AnimatePresence mode="wait">
          {isWatering ? (
            <motion.div
              key="pour"
              className="absolute inset-0 flex items-center justify-center z-[60]"
              initial={{ y: 0, rotate: 0, x: 0 }}
              animate={{ y: -260, rotate: -40, x: -110 }}
              exit={{ y: 0, rotate: 0, x: 0 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
            >
              <img
                src={UI.wateringCan}
                alt=""
                className="w-[72px] h-[72px] object-contain"
                draggable={false}
              />
              {[0, 1, 2, 3, 4].map((i) => (
                <motion.img
                  key={`drop-${i}`}
                  src={UI.waterDrop}
                  alt=""
                  className="absolute w-4 h-4 pointer-events-none"
                  style={{ left: -2, top: 44, rotate: '40deg' }}
                  initial={{ x: 0, y: 0, opacity: 0 }}
                  animate={{
                    x: [0, -52],
                    y: [0, 62],
                    opacity: [0.85, 0],
                    scale: [1, 0.5],
                  }}
                  transition={{
                    duration: 0.45,
                    delay: 0.5 + i * 0.15,
                    repeat: Infinity,
                    ease: 'easeIn',
                  }}
                />
              ))}
            </motion.div>
          ) : (
            <motion.img
              key="rest"
              src={UI.wateringCan}
              alt=""
              className="w-[72px] h-[72px] object-contain"
              draggable={false}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />
          )}
        </AnimatePresence>
      </motion.button>

      {/* Water amount label */}
      <motion.div
        className="-mt-2.5 bg-blue-100/90 rounded-full px-3 py-0.5 shadow-sm relative z-[1]"
        animate={
          shaking
            ? { scale: [1, 1.15, 1], color: ['#1d4ed8', '#16a34a', '#1d4ed8'] }
            : {}
        }
        transition={{ duration: 0.6 }}
      >
        <span className="text-[11px] font-extrabold text-blue-700 tabular-nums">
          {waterAmount.toFixed(0)}g
        </span>
      </motion.div>
    </div>
  );
}
