import { motion, AnimatePresence } from 'framer-motion';
import { RANKS, type RankId } from '@eco-farm/game-engine';

interface RankModalProps {
  open: boolean;
  onClose: () => void;
  currentRank: RankId;
  totalWater: number;
}

const RANK_STYLE: Record<string, { gradient: string; glow: string; label: string; emoji: string }> = {
  novice:  { gradient: 'from-gray-400 to-gray-500',   glow: 'shadow-gray-300/40',   label: 'Novice',  emoji: '🌱' },
  amateur: { gradient: 'from-emerald-400 to-green-600', glow: 'shadow-green-400/40',  label: 'Amateur', emoji: '🌿' },
  farmer:  { gradient: 'from-blue-400 to-indigo-600',   glow: 'shadow-blue-400/40',   label: 'Farmer',  emoji: '🌾' },
  master:  { gradient: 'from-amber-400 to-orange-600',  glow: 'shadow-amber-400/40',  label: 'Master',  emoji: '👑' },
};

function fmt(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 1)}kg` : `${g}g`;
}

export default function RankModal({ open, onClose, currentRank, totalWater }: RankModalProps) {
  const currentIdx = RANKS.findIndex(r => r.id === currentRank);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[100] bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-[101] max-h-[85vh] overflow-y-auto rounded-t-3xl"
            style={{ background: 'linear-gradient(180deg, #FFF8ED 0%, #FFF3DC 100%)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="sticky top-0 z-10 px-5 pt-3 pb-3" style={{ background: 'linear-gradient(180deg, #FFF8ED, #FFF8ED)' }}>
              <div className="w-10 h-1 bg-amber-300/60 rounded-full mx-auto mb-3" />
              <h2 className="text-lg font-black text-amber-900 text-center">Rank System</h2>
              <p className="text-[11px] text-amber-700/70 text-center mt-0.5 font-medium">
                Water more each month to rank up and earn bigger rewards
              </p>
            </div>

            <div className="px-4 pt-1 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-3">
              {RANKS.map((rank, idx) => {
                const style = RANK_STYLE[rank.id];
                const isCurrent = rank.id === currentRank;
                const isReached = idx <= currentIdx;
                const isNext = idx === currentIdx + 1;
                const nextRank = idx < RANKS.length - 1 ? RANKS[idx + 1] : null;

                const progressToNext = isCurrent && nextRank
                  ? Math.min(100, (totalWater / nextRank.minWaterLastMonth) * 100)
                  : 0;
                const waterLeft = isCurrent && nextRank
                  ? Math.max(0, nextRank.minWaterLastMonth - totalWater)
                  : 0;

                return (
                  <div
                    key={rank.id}
                    className={`rounded-2xl overflow-hidden transition-all ${
                      isCurrent ? `ring-2 ring-amber-400 shadow-lg ${style.glow}` : ''
                    } ${!isReached ? 'opacity-60' : ''}`}
                    style={{ background: 'linear-gradient(135deg, #FFFDF7 0%, #FFF9EC 100%)' }}
                  >
                    {/* Rank header */}
                    <div className={`flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r ${style.gradient}`}>
                      <span className="text-xl">{style.emoji}</span>
                      <span className="text-[15px] font-black text-white tracking-wide drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                        {style.label}
                      </span>
                      {isCurrent && (
                        <span className="ml-auto bg-white/30 backdrop-blur-sm text-white text-[10px] font-bold rounded-full px-2.5 py-0.5">
                          YOUR RANK
                        </span>
                      )}
                      {!isCurrent && (
                        <span className="ml-auto text-white/80 text-[11px] font-bold">
                          {rank.minWaterLastMonth === 0 ? 'Start' : `${fmt(rank.minWaterLastMonth)}/mo`}
                        </span>
                      )}
                    </div>

                    {/* Benefits */}
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Benefit icon="💧" label="Login" value={`${rank.loginWater}g`} />
                        <Benefit icon="📺" label="Ad" value={`${rank.adWater}g`} />
                        <Benefit icon="🎯" label="Challenge" value={`${rank.dailyChallengeReward}g`} />
                        <Benefit icon="👋" label="Greet" value={`${rank.greetWater}g`} />
                        {rank.id === 'master' && (
                          <Benefit icon="🪣" label="Bucket" value="No ads" highlight />
                        )}
                      </div>

                      {/* Progress bar for current rank */}
                      {isCurrent && nextRank && (
                        <div className="mt-3 pt-3 border-t border-amber-200/50">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-bold text-amber-800">
                              Progress to {RANK_STYLE[nextRank.id].label}
                            </span>
                            <span className="text-[11px] font-bold text-amber-600">
                              {fmt(waterLeft)} left
                            </span>
                          </div>
                          <div className="h-2.5 bg-amber-200/40 rounded-full overflow-hidden">
                            <motion.div
                              className={`h-full rounded-full bg-gradient-to-r ${RANK_STYLE[nextRank.id].gradient}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${progressToNext}%` }}
                              transition={{ duration: 1, ease: 'easeOut' }}
                            />
                          </div>
                          <p className="text-[10px] text-amber-600/70 mt-1 text-center font-medium">
                            {fmt(totalWater)} / {fmt(nextRank.minWaterLastMonth)} this month
                          </p>
                        </div>
                      )}

                      {/* Hint for next rank */}
                      {isNext && (
                        <p className="mt-2 text-[10px] text-amber-600/80 font-semibold text-center">
                          Water {fmt(rank.minWaterLastMonth)} per month to unlock
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Benefit({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold ${
      highlight
        ? 'bg-green-100 text-green-700 border border-green-300/50'
        : 'bg-amber-100/70 text-amber-800 border border-amber-200/50'
    }`}>
      <span className="text-xs">{icon}</span>
      <span className="text-amber-600/70 font-medium">{label}</span>
      <span>{value}</span>
    </div>
  );
}
