import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { haptic } from '../../lib/native';

interface Milestone {
  id: string;
  event_name: string;
  reward_amount: number;
  completed: boolean;
}

interface Offer {
  id: string;
  name: string;
  description: string;
  icon_url: string;
  reward_type: 'water' | 'nutrition';
  milestones: Milestone[];
  total_reward: number;
  earned_reward: number;
  all_completed: boolean;
}

interface OffersListProps {
  rewardType: 'water' | 'nutrition';
  open: boolean;
}

export default function OffersList({ rewardType, open }: OffersListProps) {
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['offers'],
    queryFn: () => api<{ offers: Offer[] }>('/offers'),
    enabled: open,
  });

  const offers = (data?.offers || []).filter((o) => o.reward_type === rewardType);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!offers.length) return null;

  if (selectedOffer) {
    return (
      <OfferDetail
        offer={selectedOffer}
        onBack={() => setSelectedOffer(null)}
      />
    );
  }

  return (
    <div className="space-y-2">
      {offers.map((offer) => (
        <OfferListItem
          key={offer.id}
          offer={offer}
          onSelect={() => setSelectedOffer(offer)}
        />
      ))}
    </div>
  );
}

/* ─── Game list item ─── */
function OfferListItem({ offer, onSelect }: { offer: Offer; onSelect: () => void }) {
  const completedCount = offer.milestones.filter((m) => m.completed).length;
  const totalCount = offer.milestones.length;
  const unit = offer.reward_type === 'water' ? 'g' : '';

  return (
    <button
      className="w-full active:scale-[0.98] transition-transform text-left"
      onClick={() => { haptic('tap'); onSelect(); }}
    >
      <div className="bg-gradient-to-br from-[#FFFDF5] to-[#FFF8E7] rounded-2xl border-2 border-amber-200/70 shadow-[0_2px_8px_rgba(180,130,50,0.1)] flex items-center gap-3 px-3.5 py-3">
        {offer.icon_url ? (
          <img
            src={offer.icon_url}
            alt=""
            className="w-12 h-12 rounded-xl object-cover shrink-0 shadow-md border border-white/30"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-600 flex items-center justify-center shrink-0 shadow-md border border-white/30">
            <span className="text-xl">🎮</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-amber-900 truncate">{offer.name}</p>
          <p className="text-[10px] text-amber-700/60 font-medium truncate">{offer.description}</p>
          {totalCount > 0 && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-amber-600/70">{completedCount}/{totalCount}</span>
              <div className="flex-1 h-1.5 rounded-full bg-amber-200/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-500"
                  style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[11px] font-extrabold bg-white/60 rounded-lg px-1.5 py-0.5 ${offer.reward_type === 'water' ? 'text-blue-600' : 'text-amber-700'}`}>
            +{offer.total_reward}{unit}
          </span>
          {offer.all_completed ? (
            <span className="text-[9px] font-bold text-green-600">Done</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-amber-400 shrink-0">
              <path d="M7 4l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>
    </button>
  );
}

/* ─── Offer detail page (Rewards / Details tabs) ─── */
function OfferDetail({ offer, onBack }: { offer: Offer; onBack: () => void }) {
  const [tab, setTab] = useState<'rewards' | 'details'>('rewards');
  const [opening, setOpening] = useState(false);
  const unit = offer.reward_type === 'water' ? 'g' : '';
  const unitLabel = offer.reward_type === 'water' ? 'water' : 'fertilizer';

  const handlePlay = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const res = await api<{ url: string }>(`/offers/${offer.id}/link`);
      const bridge = (window as any).EcoFarmAndroid;
      if (bridge?.openExternalUrl) {
        bridge.openExternalUrl(res.url);
      } else {
        window.open(res.url, '_blank');
      }
    } catch { /* */ }
    finally { setOpening(false); }
  };

  return (
    <div className="space-y-3">
      {/* Back button */}
      <button onClick={() => { haptic('tap'); onBack(); }} className="flex items-center gap-1 text-amber-700 font-bold text-[12px] -ml-0.5">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
          <path d="M13 4L7 10l6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        All Games
      </button>

      {/* Game header card */}
      <div className="bg-gradient-to-br from-[#1A1A2E] to-[#16213E] rounded-2xl overflow-hidden border border-white/10 shadow-lg">
        {/* Game banner */}
        <div className="relative h-36 bg-gradient-to-br from-purple-900/50 to-indigo-900/50 flex items-center justify-center overflow-hidden">
          {offer.icon_url ? (
            <img src={offer.icon_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-5xl">🎮</span>
          )}
        </div>

        {/* Info section */}
        <div className="px-4 py-3">
          <h3 className="text-[15px] font-black text-white">{offer.name}</h3>
          <div className="flex items-center justify-between mt-1">
            <span className={`text-lg font-black ${offer.reward_type === 'water' ? 'text-blue-400' : 'text-amber-400'}`}>
              +{offer.total_reward}{unit} {unitLabel}
            </span>
          </div>

          {/* Play button */}
          <button
            className={`w-full mt-3 py-3 rounded-xl font-extrabold text-sm text-white transition-all
              ${offer.all_completed
                ? 'bg-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-500 to-green-500 shadow-[0_3px_0_0_#166534] active:shadow-[0_1px_0_0_#166534] active:translate-y-[2px]'
              }`}
            onClick={offer.all_completed ? undefined : () => { haptic('impact'); handlePlay(); }}
            disabled={offer.all_completed || opening}
          >
            {offer.all_completed
              ? 'Completed!'
              : opening
                ? 'Opening...'
                : `Play and Earn +${offer.total_reward - offer.earned_reward}${unit}`}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b-2 border-amber-200/50">
        <button
          className={`flex-1 py-2 text-[13px] font-bold text-center transition-all ${tab === 'rewards' ? 'text-amber-900 border-b-2 border-amber-600 -mb-[2px]' : 'text-amber-600/50'}`}
          onClick={() => { if (tab !== 'rewards') haptic('select'); setTab('rewards'); }}
        >
          Rewards
        </button>
        <button
          className={`flex-1 py-2 text-[13px] font-bold text-center transition-all ${tab === 'details' ? 'text-amber-900 border-b-2 border-amber-600 -mb-[2px]' : 'text-amber-600/50'}`}
          onClick={() => { if (tab !== 'details') haptic('select'); setTab('details'); }}
        >
          Details
        </button>
      </div>

      <AnimatePresence mode="wait">
        {tab === 'rewards' ? (
          <motion.div
            key="rewards"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.15 }}
          >
            <RewardsTab offer={offer} unit={unit} />
          </motion.div>
        ) : (
          <motion.div
            key="details"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15 }}
          >
            <DetailsTab offer={offer} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Rewards tab ─── */
function RewardsTab({ offer, unit }: { offer: Offer; unit: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-1 mb-2">
        <span className="text-[12px] font-bold text-amber-800">Main Rewards</span>
      </div>
      {offer.milestones.map((m) => (
        <div
          key={m.id}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
            m.completed
              ? 'bg-green-50 border border-green-200/60'
              : 'bg-gradient-to-br from-[#FFFDF5] to-[#FFF8E7] border border-amber-200/50'
          }`}
        >
          <span
            className={`text-[11px] font-extrabold rounded-lg px-2 py-0.5 shrink-0 min-w-[48px] text-center ${
              m.completed
                ? 'bg-green-500 text-white'
                : `bg-white/80 border border-amber-200/50 ${offer.reward_type === 'water' ? 'text-blue-600' : 'text-amber-700'}`
            }`}
          >
            {m.completed ? '✓' : `+${m.reward_amount}${unit}`}
          </span>
          <span className={`text-[12px] font-medium flex-1 ${m.completed ? 'text-green-700 line-through opacity-70' : 'text-amber-900'}`}>
            {m.event_name}
          </span>
          {m.completed && (
            <span className="text-[9px] font-bold text-green-600 bg-green-100 rounded-full px-2 py-0.5">Done</span>
          )}
        </div>
      ))}

      {offer.earned_reward > 0 && (
        <div className="mt-3 bg-amber-50 border border-amber-200/50 rounded-xl px-3 py-2 flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-800">Earned so far</span>
          <span className={`text-[13px] font-extrabold ${offer.reward_type === 'water' ? 'text-blue-600' : 'text-amber-700'}`}>
            {offer.earned_reward}{unit} / {offer.total_reward}{unit}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Details tab ─── */
function DetailsTab({ offer }: { offer: Offer }) {
  return (
    <div className="space-y-3">
      <div className="bg-gradient-to-br from-[#FFFDF5] to-[#FFF8E7] rounded-xl border border-amber-200/50 px-3.5 py-3 space-y-3">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-sm">🔄</span>
          </div>
          <div>
            <p className="text-[12px] font-bold text-amber-900">Task Order Flexibility</p>
            <p className="text-[10px] text-amber-700/60 font-medium leading-relaxed">
              You don't need to complete the steps in any particular order.
            </p>
          </div>
        </div>

        <div className="h-px bg-amber-200/40" />

        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-sm">👤</span>
          </div>
          <div>
            <p className="text-[12px] font-bold text-amber-900">New Users Only</p>
            <p className="text-[10px] text-amber-700/60 font-medium leading-relaxed">
              Only new users who haven't installed "{offer.name}" on their device before are eligible to earn rewards.
            </p>
          </div>
        </div>
      </div>

      {offer.description && (
        <div className="bg-gradient-to-br from-[#FFFDF5] to-[#FFF8E7] rounded-xl border border-amber-200/50 px-3.5 py-3">
          <p className="text-[12px] font-bold text-amber-900 mb-1">Description</p>
          <p className="text-[11px] text-amber-700/80 font-medium leading-relaxed">{offer.description}</p>
        </div>
      )}

      <div className="bg-gradient-to-br from-[#FFFDF5] to-[#FFF8E7] rounded-xl border border-amber-200/50 px-3.5 py-3">
        <p className="text-[12px] font-bold text-amber-900 mb-1">Steps</p>
        <p className="text-[11px] text-amber-700/80 font-medium leading-relaxed">
          Must be installing {offer.name} for the first time. Complete milestones to earn rewards.
        </p>
      </div>
    </div>
  );
}
