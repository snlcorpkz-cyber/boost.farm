import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api, apiUpload } from '@/lib/api';

interface Milestone {
  event_name: string;
  everflow_event_id: string;
  reward_amount: number;
  sort_order: number;
}

export function OfferEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rewardType, setRewardType] = useState<'water' | 'nutrition'>('water');
  const [efOfferId, setEfOfferId] = useState('');
  const [trackingLink, setTrackingLink] = useState('');
  const [storeUrl, setStoreUrl] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [payoutCents, setPayoutCents] = useState(0);
  const [active, setActive] = useState(true);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [iconUrl, setIconUrl] = useState('');
  const [error, setError] = useState('');

  const { data: existing } = useQuery({
    queryKey: ['admin', 'offer', id],
    queryFn: () => api(`/offers/${id}`),
    enabled: !!id,
  });

  useEffect(() => {
    if (existing) {
      setName(existing.name || '');
      setDescription(existing.description || '');
      setRewardType(existing.reward_type || 'water');
      setEfOfferId(existing.everflow_offer_id || '');
      setTrackingLink(existing.tracking_link_template || '');
      setStoreUrl(existing.store_url || '');
      setSortOrder(existing.sort_order || 0);
      setPayoutCents(existing.payout_cents || 0);
      setActive(existing.active ?? true);
      setIconUrl(existing.icon_url || '');
      if (existing.milestones?.length) {
        setMilestones(existing.milestones.map((m: any) => ({
          event_name: m.event_name,
          everflow_event_id: m.everflow_event_id,
          reward_amount: m.reward_amount,
          sort_order: m.sort_order,
        })));
      }
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { name, description, reward_type: rewardType, everflow_offer_id: efOfferId, tracking_link_template: trackingLink, store_url: storeUrl, sort_order: sortOrder, payout_cents: payoutCents, active, milestones };
      if (isNew) {
        return api('/offers', { method: 'POST', body });
      }
      return api(`/offers/${id}`, { method: 'PUT', body });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin', 'offers'] });
      navigate(isNew ? `/offers/${data.id}` : '/offers');
    },
    onError: (err: any) => setError(err.message),
  });

  const uploadIcon = async (file: File) => {
    const fd = new FormData();
    fd.append('icon', file);
    try {
      const res = await apiUpload(`/offers/${id}/icon`, fd);
      setIconUrl(res.icon_url);
      qc.invalidateQueries({ queryKey: ['admin', 'offer', id] });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const addMilestone = () => {
    setMilestones([...milestones, { event_name: '', everflow_event_id: '', reward_amount: 0, sort_order: milestones.length }]);
  };

  const updateMilestone = (idx: number, field: keyof Milestone, value: string | number) => {
    const updated = [...milestones];
    (updated[idx] as any)[field] = value;
    setMilestones(updated);
  };

  const removeMilestone = (idx: number) => {
    setMilestones(milestones.filter((_, i) => i !== idx));
  };

  return (
    <div className="max-w-4xl">
      <button onClick={() => navigate('/offers')} className="text-sm text-blue-600 hover:underline mb-4">&larr; Back to Offers</button>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">{isNew ? 'New Offer' : 'Edit Offer'}</h1>

      {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Form */}
        <div className="space-y-5">
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Basic Info</h3>

            <Field label="Game Name" value={name} onChange={setName} />
            <Field label="Description" value={description} onChange={setDescription} />
            <Field label="Store URL" value={storeUrl} onChange={setStoreUrl} placeholder="https://play.google.com/store/apps/details?id=..." />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Reward Type</label>
                <select value={rewardType} onChange={e => setRewardType(e.target.value as any)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="water">Water</option>
                  <option value="nutrition">Nutrition (Fertilizer)</option>
                </select>
              </div>
              <Field label="Everflow Offer ID" value={efOfferId} onChange={setEfOfferId} />
            </div>

            <Field label="Tracking Link Template" value={trackingLink} onChange={setTrackingLink} placeholder="https://www.xxx.com/FNX4R/..." />

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Sort Order</label>
                <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Payout (cents)</label>
                <input type="number" value={payoutCents} onChange={e => setPayoutCents(Number(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="rounded" />
                  Active
                </label>
              </div>
            </div>
          </div>

          {/* Milestones */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Milestones (Events)</h3>
              <button onClick={addMilestone} className="text-xs bg-blue-50 text-blue-600 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-100">
                + Add Milestone
              </button>
            </div>

            {milestones.length === 0 ? (
              <p className="text-sm text-gray-400">No milestones yet. Add events like "Install", "Reach Level 10", etc.</p>
            ) : (
              <div className="space-y-3">
                {milestones.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
                    <span className="text-xs text-gray-400 w-5">{i + 1}</span>
                    <input
                      placeholder="Event name (e.g. Install)"
                      value={m.event_name}
                      onChange={e => updateMilestone(i, 'event_name', e.target.value)}
                      className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <input
                      placeholder="EF Event ID"
                      value={m.everflow_event_id}
                      onChange={e => updateMilestone(i, 'everflow_event_id', e.target.value)}
                      className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        placeholder="Reward"
                        value={m.reward_amount}
                        onChange={e => updateMilestone(i, 'reward_amount', Number(e.target.value))}
                        className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                      />
                      <span className="text-xs text-gray-400">{rewardType === 'water' ? 'g' : 'fert'}</span>
                    </div>
                    <button onClick={() => removeMilestone(i)} className="text-red-400 hover:text-red-600 text-lg px-1">&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !name || !efOfferId}
            className="bg-blue-600 text-white font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {save.isPending ? 'Saving...' : isNew ? 'Create Offer' : 'Save Changes'}
          </button>
        </div>

        {/* Preview sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Preview</h3>
            <div className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-3">
              <div className="flex items-center gap-3 mb-3">
                {iconUrl ? (
                  <img src={iconUrl} alt="" className="w-12 h-12 rounded-xl border border-gray-200 object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-gray-200 flex items-center justify-center text-xl">🎮</div>
                )}
                <div>
                  <p className="text-sm font-bold text-gray-900">{name || 'Game Name'}</p>
                  <p className="text-[10px] text-gray-500">{description || 'Description'}</p>
                </div>
              </div>
              {milestones.length > 0 && (
                <div className="space-y-1.5">
                  {milestones.map((m, i) => (
                    <div key={i} className="flex justify-between items-center bg-white rounded-lg px-2.5 py-1.5 text-xs border border-amber-100">
                      <span className="text-gray-700">{m.event_name || '...'}</span>
                      <span className="font-bold text-blue-600">+{m.reward_amount}{rewardType === 'water' ? 'g' : ' fert'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Icon upload (only for existing offers) */}
          {!isNew && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Icon</h3>
              {iconUrl && <img src={iconUrl} alt="" className="w-20 h-20 rounded-xl mb-3 border border-gray-200 object-cover" />}
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                onChange={e => { if (e.target.files?.[0]) uploadIcon(e.target.files[0]); }}
                className="text-xs"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}
