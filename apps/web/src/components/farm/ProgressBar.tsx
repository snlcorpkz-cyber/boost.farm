import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { getStageBoundaries } from '@eco-farm/game-engine';

interface ProgressBarProps {
  percent: number;
  stage: number;
  baseWidth: number;
  isDark?: boolean;
}

const BOUNDARIES = getStageBoundaries();

function getStageProgress(percent: number, stage: number) {
  const start = BOUNDARIES[stage - 1] ?? 0;
  const end = BOUNDARIES[stage] ?? 100;
  const range = end - start;
  if (range <= 0) return { stagePercent: 100, stageRemaining: 0 };
  const stagePercent = Math.min(100, ((percent - start) / range) * 100);
  const stageRemaining = Math.max(0, 100 - stagePercent);
  return { stagePercent, stageRemaining };
}

export default function ProgressBar({ percent, stage, baseWidth, isDark = false }: ProgressBarProps) {
  const { t } = useTranslation();
  const { stagePercent, stageRemaining } = getStageProgress(percent, stage);
  const barWidth = baseWidth * 0.7;

  return (
    <div className="flex flex-col items-center" style={{ width: barWidth }}>
      <div className="relative w-full h-1.5 bg-white rounded-full overflow-hidden shadow-sm">
        <motion.div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-green-400 to-green-500 rounded-full"
          animate={{ width: `${stagePercent}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      <div className="mt-0.5 text-center">
        <span className={`text-[11px] font-bold tabular-nums ${isDark ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]' : 'text-gray-900'}`}>
          {t('farm.until_next_level', { percent: stageRemaining.toFixed(3) })}
        </span>
      </div>
    </div>
  );
}
