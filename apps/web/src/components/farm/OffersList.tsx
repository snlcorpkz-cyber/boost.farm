import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

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

  return (
    <div className="space-y-2.5">
      {offers.map((offer) => (
        <OfferCard key={offer.id} offer={offer} />
      ))}
    </div>
  );
}

function OfferCard({ offer }: { offer: Offer }) {
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState(false);

  const completedCount = offer.milestones.filter((m) => m.completed).length;
  const totalCount = offer.milestones.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const unit = offer.reward_type === 'water' ? 'g' : '';

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
    } catch {
      /* ignore */
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-[#FFFDF5] to-[#FFF8E7] rounded-2xl border-2 border-amber-200/70 shadow-[0_2px_8px_rgba(180,130,50,0.1)] overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {offer.icon_url ? (
          <img
            src={offer.icon_url}
            alt=""
            className="w-11 h-11 rounded-xl object-cover shrink-0 shadow-md border border-white/30"
          />
        ) : (
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-600 flex items-center justify-center shrink-0 shadow-md border border-white/30">
            <span className="text-xl">🎮</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-amber-900 truncate">{offer.name}</p>
          <p className="text-[10px] text-amber-700/60 font-medium truncate">{offer.description}</p>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-amber-200/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[9px] font-bold text-amber-700/60 shrink-0">
              {completedCount}/{totalCount}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[11px] font-extrabold bg-white/60 rounded-lg px-1.5 py-0.5 ${offer.reward_type === 'water' ? 'text-blue-600' : 'text-amber-700'}`}>
            +{offer.total_reward}{unit}
          </span>
          {offer.all_completed ? (
            <span className="text-[10px] font-bold text-green-600 bg-green-50 rounded-lg px-2 py-0.5">Done</span>
          ) : (
            <button
              className="text-white font-extrabold text-[10px] px-3 py-1 rounded-xl bg-gradient-to-b from-[#78D44B] via-[#5DBB36] to-[#3F9922] shadow-[0_2px_0_0_#2D7A15] active:shadow-[0_1px_0_0_#2D7A15] active:translate-y-[1px] transition-all"
              onClick={(e) => { e.stopPropagation(); handlePlay(); }}
              disabled={opening}
            >
              {opening ? '...' : 'Play'}
            </button>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3.5 pb-3 space-y-1.5">
          <div className="h-px bg-amber-200/50" />
          {offer.milestones.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${m.completed ? 'bg-green-500 text-white' : 'bg-amber-200/60 text-amber-500'}`}>
                {m.completed ? '✓' : '○'}
              </div>
              <span className={`text-[11px] flex-1 ${m.completed ? 'text-green-700 font-bold' : 'text-amber-800 font-medium'}`}>
                {m.event_name}
              </span>
              <span className={`text-[10px] font-bold ${m.completed ? 'text-green-600' : 'text-amber-600/60'}`}>
                +{m.reward_amount}{unit}
              </span>
            </div>
          ))}
          {offer.earned_reward > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-amber-200/30">
              <span className="text-[10px] font-bold text-amber-800">Earned so far</span>
              <span className={`text-[11px] font-extrabold ${offer.reward_type === 'water' ? 'text-blue-600' : 'text-amber-700'}`}>
                {offer.earned_reward}{unit} / {offer.total_reward}{unit}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
