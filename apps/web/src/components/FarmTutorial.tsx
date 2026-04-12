import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const STEPS = [
  {
    target: 'bucket',
    text: 'Water passively fills from the well. Tap the bucket to pour water into your watering can.',
    position: 'right' as const,
  },
  {
    target: 'watering-can',
    text: 'Tap the watering can to water your vegetable and help it grow.',
    position: 'top' as const,
  },
  {
    target: 'nutrition',
    text: 'To grow your vegetable faster, keep the fertilizer level high.',
    position: 'right' as const,
  },
  {
    target: 'water-btn',
    text: 'Find different ways to get more water faster.',
    position: 'top' as const,
  },
  {
    target: 'fert-btn',
    text: 'Find different ways to get more fertilizer.',
    position: 'top' as const,
  },
  {
    target: 'pet-btn',
    text: 'Unlock pets — they give you various bonuses!',
    position: 'top' as const,
  },
  {
    target: 'invite-btn',
    text: 'Invite friends and water their garden. It helps your vegetable grow faster!',
    position: 'top' as const,
  },
];

const STORAGE_KEY = 'farm_tutorial_done';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function FarmTutorial() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, []);

  const measure = useCallback(() => {
    const el = document.querySelector(`[data-tutorial="${STEPS[step].target}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 6;
    setRect({
      top: r.top - pad,
      left: r.left - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    });
  }, [step]);

  useEffect(() => {
    if (!visible) return;
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      cancelAnimationFrame(rafRef.current);
    };
  }, [visible, measure]);

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      localStorage.setItem(STORAGE_KEY, '1');
      setVisible(false);
    }
  }, [step]);

  const skip = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }, []);

  if (!visible || !rect) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const tooltip = getTooltipPosition(rect, current.position);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[200]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* Dark overlay with cutout */}
          <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
            <defs>
              <mask id="spotlight-mask">
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={rect.left}
                  y={rect.top}
                  width={rect.width}
                  height={rect.height}
                  rx={12}
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.72)"
              mask="url(#spotlight-mask)"
              style={{ pointerEvents: 'auto' }}
              onClick={next}
            />
          </svg>

          {/* Glowing border around target */}
          <div
            className="absolute rounded-xl pointer-events-none"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              boxShadow: '0 0 0 3px rgba(255,255,255,0.7), 0 0 20px rgba(255,255,255,0.3)',
            }}
          />

          {/* Tooltip */}
          <motion.div
            key={step}
            className="absolute z-[201] max-w-[260px]"
            style={{ top: tooltip.top, left: tooltip.left }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2, delay: 0.05 }}
          >
            <div className="bg-white rounded-2xl shadow-2xl px-4 py-3 border border-white/50">
              <p className="text-[13px] font-semibold text-gray-800 leading-snug mb-3">
                {current.text}
              </p>
              <div className="flex items-center justify-between">
                <button
                  className="text-[11px] text-gray-400 font-medium"
                  onClick={skip}
                >
                  Skip
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 font-medium tabular-nums">
                    {step + 1}/{STEPS.length}
                  </span>
                  <button
                    className="bg-gradient-to-b from-blue-400 to-blue-600 text-white text-[12px] font-bold px-4 py-1.5 rounded-xl shadow-sm active:scale-95 transition-transform"
                    onClick={next}
                  >
                    {isLast ? 'Got it!' : 'Next'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function getTooltipPosition(
  rect: Rect,
  preferred: 'top' | 'right' | 'bottom' | 'left'
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tooltipW = 260;
  const tooltipH = 120;
  const gap = 12;

  let top = 0;
  let left = 0;

  switch (preferred) {
    case 'top':
      top = rect.top - tooltipH - gap;
      left = rect.left + rect.width / 2 - tooltipW / 2;
      break;
    case 'bottom':
      top = rect.top + rect.height + gap;
      left = rect.left + rect.width / 2 - tooltipW / 2;
      break;
    case 'right':
      top = rect.top + rect.height / 2 - tooltipH / 2;
      left = rect.left + rect.width + gap;
      break;
    case 'left':
      top = rect.top + rect.height / 2 - tooltipH / 2;
      left = rect.left - tooltipW - gap;
      break;
  }

  if (top < 8) top = 8;
  if (top + tooltipH > vh - 8) top = vh - tooltipH - 8;
  if (left < 8) left = 8;
  if (left + tooltipW > vw - 8) left = vw - tooltipW - 8;

  return { top, left };
}
