import { motion, AnimatePresence } from 'framer-motion';
import { RANKS, type RankId, FREE_BUCKET_COLLECTS_PER_DAY } from '@eco-farm/game-engine';

interface RankModalProps {
  open: boolean;
  onClose: () => void;
  currentRank: RankId;
  totalWater: number;
}

const RANK_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  novice:  { bg: 'bg-gray-100',   border: 'border-gray-300', text: 'text-gray-600' },
  amateur: { bg: 'bg-green-50',   border: 'border-green-400', text: 'text-green-700' },
  farmer:  { bg: 'bg-blue-50',    border: 'border-blue-400', text: 'text-blue-700' },
  master:  { bg: 'bg-amber-50',   border: 'border-amber-400', text: 'text-amber-700' },
};

const RANK_LABELS: Record<string, string> = {
  novice: 'Novice', amateur: 'Amateur', farmer: 'Farmer', master: 'Master',
};

function formatWater(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(1)}kg` : `${g}g`;
}

export default function RankModal({ open, onClose, currentRank, totalWater }: RankModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[100] bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-[101] max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.3 }}
          >
            <div className="sticky top-0 bg-white z-10 px-5 pt-4 pb-2 border-b border-gray-100">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
              <h2 className="text-lg font-extrabold text-gray-900 text-center">Rank System</h2>
              <p className="text-xs text-gray-500 text-center mt-0.5">
                Water more to level up your rank and unlock better rewards
              </p>
            </div>

            <div className="px-4 py-3 space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {RANKS.map((rank, idx) => {
                const colors = RANK_COLORS[rank.id];
                const isCurrent = rank.id === currentRank;
                const isLocked = idx > RANKS.findIndex(r => r.id === currentRank);
                const nextRank = idx < RANKS.length - 1 ? RANKS[idx + 1] : null;

                return (
                  <div
                    key={rank.id}
                    className={`rounded-2xl border-2 p-3 ${colors.bg} ${isCurrent ? colors.border : 'border-transparent'} ${isCurrent ? 'ring-2 ring-offset-1 ring-' + rank.id : ''}`}
                    style={isCurrent ? { boxShadow: '0 0 0 2px rgba(0,0,0,0.08)' } : undefined}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-extrabold ${colors.text}`}>
                          {RANK_LABELS[rank.id]}
                        </span>
                        {isCurrent && (
                          <span className="text-[9px] bg-black/10 rounded-full px-2 py-0.5 font-bold">YOU</span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-500 font-medium">
                        {rank.minWaterLastMonth === 0 ? 'Start' : `${formatWater(rank.minWaterLastMonth)}/month`}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Login water</span>
                        <span className="font-bold text-gray-700">{rank.loginWater}g</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Login fert.</span>
                        <span className="font-bold text-gray-700">{rank.loginFertilizer}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Ad water</span>
                        <span className="font-bold text-gray-700">{rank.adWater}g</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Ad fert.</span>
                        <span className="font-bold text-gray-700">{rank.adFertilizer}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Greet water</span>
                        <span className="font-bold text-gray-700">{rank.greetWater}g</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Friend fert.</span>
                        <span className="font-bold text-gray-700">{rank.waterFriendFert}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Challenge</span>
                        <span className="font-bold text-gray-700">{rank.dailyChallengeReward}g</span>
                      </div>
                      {rank.id === 'master' && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Bucket ads</span>
                          <span className="font-bold text-green-600">Free</span>
                        </div>
                      )}
                    </div>

                    {isCurrent && nextRank && (
                      <div className="mt-2 pt-2 border-t border-black/5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-black/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full"
                              style={{ width: `${Math.min(100, (totalWater / nextRank.minWaterLastMonth) * 100)}%` }}
                            />
                          </div>
                          <span className="text-[9px] font-bold text-gray-500 whitespace-nowrap">
                            {formatWater(Math.max(0, nextRank.minWaterLastMonth - totalWater))} to {RANK_LABELS[nextRank.id]}
                          </span>
                        </div>
                      </div>
                    )}
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
