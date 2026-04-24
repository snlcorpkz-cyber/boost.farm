import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api, apiUpload } from '@/lib/api';

interface Milestone {
  event_name: string;
  everflow_event_id: string;
  reward_amount: number;
  sort_order: number;
}

type OfferTab = 'form' | 'analytics';

export function OfferEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<OfferTab>('form');

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

      <h1 className="text-2xl font-bold text-gray-900 mb-4">{isNew ? 'New Offer' : 'Edit Offer'}</h1>

      {/* Tab bar — Analytics is disabled for brand-new offers since there is
          nothing to analyze until the offer has been saved at least once. */}
      <div className="mb-6 border-b border-gray-200 flex gap-1">
        <button
          onClick={() => setTab('form')}
          className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
            tab === 'form'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Form
        </button>
        <button
          onClick={() => !isNew && setTab('analytics')}
          disabled={isNew}
          title={isNew ? 'Save the offer first' : ''}
          className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
            tab === 'analytics'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          Analytics
        </button>
      </div>

      {tab === 'analytics' && id && <OfferAnalyticsTab offerId={id} />}
      {tab === 'analytics' && !id && (
        <p className="text-sm text-gray-500">Save the offer first to see analytics.</p>
      )}
      {tab === 'form' && (<>

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

          {/* Icon upload. Disabled until the offer has an id because the
              upload endpoint is POST /offers/:id/icon — we need a saved
              offer to attach the file to. On a brand-new offer we show the
              field anyway so the admin isn't left wondering if icons are
              supported. */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Icon</h3>
            {iconUrl ? (
              <img src={iconUrl} alt="" className="w-20 h-20 rounded-xl mb-3 border border-gray-200 object-cover" />
            ) : (
              <div className="w-20 h-20 rounded-xl mb-3 border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-2xl text-gray-400">
                🎮
              </div>
            )}
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              disabled={isNew}
              onChange={e => { if (e.target.files?.[0]) uploadIcon(e.target.files[0]); }}
              className="text-xs disabled:cursor-not-allowed disabled:opacity-50"
            />
            {isNew ? (
              <p className="mt-2 text-[11px] text-amber-600">
                Save the offer first — then you can upload an icon.
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-gray-500">
                PNG / JPG / WebP, up to 2 MB.
              </p>
            )}
          </div>
        </div>
      </div>

      </>)}
    </div>
  );
}

/**
 * Analytics tab for a single offer. Shows the raw completion funnel,
 * postback status distribution, and the two most useful debug lists
 * (recent completions + recent postbacks with error_message) plus a
 * top-users leaderboard.
 */
function OfferAnalyticsTab({ offerId }: { offerId: string }) {
  const [days, setDays] = useState(30);
  const { data, isPending } = useQuery<any>({
    queryKey: ['admin', 'offer', offerId, 'analytics', days],
    queryFn: () => api(`/offers/${offerId}/analytics?days=${days}`),
  });

  if (isPending) return <div className="text-sm text-gray-500">Loading analytics…</div>;
  if (!data) return <div className="text-sm text-red-600">Failed to load analytics.</div>;

  const s = data.summary || {};

  return (
    <div className="space-y-6">
      {/* Window switch */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          Window:&nbsp;
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`ml-1 rounded px-2 py-0.5 ${
                days === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        <div className="text-xs text-gray-400">
          Everflow ID: <span className="font-mono">{data.offer?.everflow_offer_id || '—'}</span>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Completions total" value={s.completions_total} />
        <Tile label={`Completions (${days}d)`} value={s.completions_in_window} accent="blue" />
        <Tile label={`Unique users (${days}d)`} value={s.unique_users} accent="emerald" />
        <Tile label={`Postbacks OK (${days}d)`} value={s.postbacks_ok} accent="emerald" />
        <Tile label={`Postbacks errors (${days}d)`} value={s.postbacks_errors} accent="red" />
        <Tile
          label="Payout total"
          value={`$${((s.payout_total_cents || 0) / 100).toFixed(2)}`}
          sub={`$${((s.payout_window_cents || 0) / 100).toFixed(2)} in window`}
        />
      </div>

      {/* Milestones funnel */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Milestones funnel</h3>
        {(!data.milestones || data.milestones.length === 0) ? (
          <p className="text-xs text-gray-400">No milestones configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="py-1.5 px-2">Event</th>
                  <th className="py-1.5 px-2">EF ID</th>
                  <th className="py-1.5 px-2 text-right">Reward</th>
                  <th className="py-1.5 px-2 text-right">Completions (all)</th>
                  <th className="py-1.5 px-2 text-right">Completions ({days}d)</th>
                  <th className="py-1.5 px-2 text-right">Unique users ({days}d)</th>
                </tr>
              </thead>
              <tbody>
                {data.milestones.map((m: any) => (
                  <tr key={m.id} className="border-b border-gray-50">
                    <td className="py-1.5 px-2 font-medium text-gray-800">{m.event_name}</td>
                    <td className="py-1.5 px-2 font-mono text-gray-500">{m.everflow_event_id}</td>
                    <td className="py-1.5 px-2 text-right font-medium text-emerald-700">{m.reward_amount}</td>
                    <td className="py-1.5 px-2 text-right">{m.completions_total}</td>
                    <td className="py-1.5 px-2 text-right font-medium text-blue-700">{m.completions_window}</td>
                    <td className="py-1.5 px-2 text-right">{m.unique_users_window}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Postback status breakdown */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Postback status ({days}d)</h3>
        {(!data.postback_status || data.postback_status.length === 0) ? (
          <p className="text-xs text-gray-400">No postbacks received for this offer in the window.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.postback_status.map((s: any) => (
              <span
                key={s.status}
                className={`text-xs rounded-full px-3 py-1 font-medium ${
                  s.status === 'success'
                    ? 'bg-emerald-100 text-emerald-700'
                    : s.status === 'received'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-red-100 text-red-700'
                }`}
              >
                {s.status}: {s.c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Two-column: recent completions + recent postbacks */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent completions</h3>
          {(!data.recent_completions || data.recent_completions.length === 0) ? (
            <p className="text-xs text-gray-400">No completions yet.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="text-left text-gray-500">
                    <th className="py-1.5 px-2">User</th>
                    <th className="py-1.5 px-2">Milestone</th>
                    <th className="py-1.5 px-2 text-right">Reward</th>
                    <th className="py-1.5 px-2">Credited</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_completions.map((c: any) => (
                    <tr key={c.id} className="border-b border-gray-50">
                      <td className="py-1.5 px-2">
                        <Link to={`/users/${c.user_id}`} className="text-blue-600 hover:underline font-medium">
                          {c.nickname || c.email || c.user_id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="py-1.5 px-2 font-mono text-gray-700">{c.milestone_event}</td>
                      <td className="py-1.5 px-2 text-right font-medium text-emerald-700">{c.reward_amount}</td>
                      <td className="py-1.5 px-2 text-gray-500">{new Date(c.credited_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent postbacks</h3>
          {(!data.recent_postbacks || data.recent_postbacks.length === 0) ? (
            <p className="text-xs text-gray-400">No postbacks logged.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="text-left text-gray-500">
                    <th className="py-1.5 px-2">Status</th>
                    <th className="py-1.5 px-2">Event</th>
                    <th className="py-1.5 px-2">Transaction</th>
                    <th className="py-1.5 px-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_postbacks.map((p: any) => (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="py-1.5 px-2">
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono ${
                            p.status === 'success'
                              ? 'bg-emerald-100 text-emerald-700'
                              : p.status === 'received'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-red-100 text-red-700'
                          }`}
                          title={p.error_message || ''}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 font-mono text-gray-700">{p.everflow_event_id || '-'}</td>
                      <td className="py-1.5 px-2 font-mono text-gray-500 truncate max-w-[10rem]" title={p.transaction_id}>
                        {p.transaction_id || '-'}
                      </td>
                      <td className="py-1.5 px-2 text-gray-500">{new Date(p.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Top users */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Top users (all time)</h3>
        {(!data.top_users || data.top_users.length === 0) ? (
          <p className="text-xs text-gray-400">Nobody has completed this offer yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="py-1.5 px-2">User</th>
                  <th className="py-1.5 px-2 text-right">Completions</th>
                  <th className="py-1.5 px-2 text-right">Reward total</th>
                </tr>
              </thead>
              <tbody>
                {data.top_users.map((u: any) => (
                  <tr key={u.user_id} className="border-b border-gray-50">
                    <td className="py-1.5 px-2">
                      <Link to={`/users/${u.user_id}`} className="text-blue-600 hover:underline font-medium">
                        {u.nickname || u.email || u.user_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-1.5 px-2 text-right font-medium">{u.completions}</td>
                    <td className="py-1.5 px-2 text-right text-emerald-700">{u.reward_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'blue' | 'emerald' | 'red';
}) {
  const cls =
    accent === 'blue'
      ? 'text-blue-700'
      : accent === 'emerald'
        ? 'text-emerald-700'
        : accent === 'red'
          ? 'text-red-700'
          : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${cls}`}>{value ?? '—'}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
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
