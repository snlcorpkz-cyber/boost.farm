import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function PushCreatePage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetType, setTargetType] = useState<'all' | 'segment' | 'users'>('all');
  const [country, setCountry] = useState('');
  const [platform, setPlatform] = useState('');
  const [rank, setRank] = useState('');
  const [activeDays, setActiveDays] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [estimated, setEstimated] = useState<number | null>(null);
  const [error, setError] = useState('');

  const { data: existing } = useQuery({
    queryKey: ['admin', 'push-campaign', id],
    queryFn: () => api(`/push/${id}`),
    enabled: !!id,
  });

  useEffect(() => {
    if (existing) {
      setTitle(existing.title || '');
      setBody(existing.body || '');
      setTargetType(existing.target_type || 'all');
      if (existing.target_filter) {
        setCountry(existing.target_filter.country || '');
        setPlatform(existing.target_filter.platform || '');
        setRank(existing.target_filter.rank || '');
        setActiveDays(existing.target_filter.active_days?.toString() || '');
      }
      setSelectedUserIds(existing.target_user_ids || []);
    }
  }, [existing]);

  const isSent = existing?.status === 'sent' || existing?.status === 'sending';

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title, body,
        target_type: targetType,
        target_filter: targetType === 'segment' ? {
          ...(country ? { country } : {}),
          ...(platform ? { platform } : {}),
          ...(rank ? { rank } : {}),
          ...(activeDays ? { active_days: Number(activeDays) } : {}),
        } : {},
        target_user_ids: targetType === 'users' ? selectedUserIds : null,
      };
      if (isNew) return api('/push', { method: 'POST', body: payload });
      return api(`/push/${id}`, { method: 'PUT', body: payload });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin', 'push'] });
      if (isNew) navigate(`/push/${data.id}`);
    },
    onError: (err: any) => setError(err.message),
  });

  const send = useMutation({
    mutationFn: () => api(`/push/${id}/send`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'push'] });
      qc.invalidateQueries({ queryKey: ['admin', 'push-campaign', id] });
    },
    onError: (err: any) => setError(err.message),
  });

  const estimate = async () => {
    try {
      const filter = targetType === 'segment' ? {
        ...(country ? { country } : {}),
        ...(platform ? { platform } : {}),
        ...(rank ? { rank } : {}),
        ...(activeDays ? { active_days: Number(activeDays) } : {}),
      } : {};
      const res = await api('/push/estimate', {
        method: 'POST',
        body: { target_type: targetType, target_filter: filter, target_user_ids: targetType === 'users' ? selectedUserIds : null },
      });
      setEstimated(res.estimated);
    } catch { /* ignore */ }
  };

  const openRate = existing && existing.delivered > 0 ? Math.round((existing.opened / existing.delivered) * 100) : null;

  return (
    <div className="max-w-3xl">
      <button onClick={() => navigate('/push')} className="text-sm text-blue-600 hover:underline mb-4">&larr; Back to Campaigns</button>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">{isNew ? 'New Push Campaign' : isSent ? 'Campaign Details' : 'Edit Campaign'}</h1>

      {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">{error}</div>}

      {/* Stats for sent campaigns */}
      {isSent && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Stat label="Recipients" value={existing.total_recipients} />
          <Stat label="Delivered" value={existing.delivered} />
          <Stat label="Opened" value={existing.opened} />
          <Stat label="Open Rate" value={openRate != null ? `${openRate}%` : '-'} />
        </div>
      )}

      <div className="space-y-5">
        {/* Message */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Message</h3>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Title (max 50 chars)</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)} maxLength={50} disabled={isSent}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Body (max 200 chars)</label>
            <textarea
              value={body} onChange={e => setBody(e.target.value)} maxLength={200} rows={3} disabled={isSent}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none disabled:bg-gray-50"
            />
          </div>

          {/* Preview */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Preview</label>
            <div className="bg-gray-900 rounded-xl p-4 text-white max-w-xs">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-5 h-5 rounded bg-green-500 flex items-center justify-center text-[8px] font-bold">BF</div>
                <span className="text-[10px] text-gray-400">BoostFarm</span>
              </div>
              <p className="text-sm font-semibold">{title || 'Title'}</p>
              <p className="text-xs text-gray-300 mt-0.5">{body || 'Message body'}</p>
            </div>
          </div>
        </div>

        {/* Targeting */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Targeting</h3>

          <div className="flex gap-3">
            {(['all', 'segment', 'users'] as const).map(t => (
              <button
                key={t}
                onClick={() => { setTargetType(t); setEstimated(null); }}
                disabled={isSent}
                className={`text-sm font-medium px-4 py-2 rounded-lg border transition ${
                  targetType === t ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                } disabled:opacity-60`}
              >
                {t === 'all' ? 'All Users' : t === 'segment' ? 'By Segment' : 'Specific Users'}
              </button>
            ))}
          </div>

          {targetType === 'segment' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Country</label>
                <input value={country} onChange={e => setCountry(e.target.value)} disabled={isSent}
                  placeholder="e.g. KZ" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Platform</label>
                <select value={platform} onChange={e => setPlatform(e.target.value)} disabled={isSent}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Any</option>
                  <option value="android">Android</option>
                  <option value="web">Web</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Rank</label>
                <select value={rank} onChange={e => setRank(e.target.value)} disabled={isSent}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Any</option>
                  <option value="novice">Novice</option>
                  <option value="amateur">Amateur</option>
                  <option value="farmer">Farmer</option>
                  <option value="master">Master</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Active in last N days</label>
                <input type="number" value={activeDays} onChange={e => setActiveDays(e.target.value)} disabled={isSent}
                  placeholder="e.g. 7" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </div>
          )}

          {targetType === 'users' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">User IDs (comma separated)</label>
              <textarea
                value={selectedUserIds.join(', ')}
                onChange={e => setSelectedUserIds(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                disabled={isSent}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono resize-none"
                placeholder="user-uuid-1, user-uuid-2, ..."
              />
            </div>
          )}

          {!isSent && (
            <div className="flex items-center gap-3">
              <button
                onClick={estimate}
                className="text-sm bg-gray-100 text-gray-700 font-medium px-4 py-2 rounded-lg hover:bg-gray-200"
              >
                Estimate Recipients
              </button>
              {estimated != null && (
                <span className="text-sm font-bold text-blue-600">{estimated} users with push tokens</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {!isSent && (
          <div className="flex gap-3">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !title || !body}
              className="bg-gray-600 text-white font-medium px-5 py-2.5 rounded-lg hover:bg-gray-700 disabled:opacity-50"
            >
              {save.isPending ? 'Saving...' : 'Save Draft'}
            </button>
            {!isNew && existing?.status === 'draft' && (
              <button
                onClick={() => {
                  const msg = estimated != null ? `Send to ${estimated} users?` : 'Send this campaign?';
                  if (confirm(msg)) send.mutate();
                }}
                disabled={send.isPending || !title || !body}
                className="bg-blue-600 text-white font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {send.isPending ? 'Sending...' : 'Send Now'}
              </button>
            )}
          </div>
        )}

        {/* Recipients table for sent campaigns */}
        {isSent && existing?.recipients?.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Recipients ({existing.recipients.length})</h3>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">User</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Status</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Sent</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Opened</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {existing.recipients.map((r: any) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-gray-700">{r.nickname} ({r.email})</td>
                      <td className="px-3 py-2">
                        <span className={`font-bold ${r.status === 'opened' ? 'text-green-600' : r.status === 'sent' ? 'text-blue-600' : r.status === 'failed' ? 'text-red-500' : 'text-gray-400'}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-400">{r.sent_at ? new Date(r.sent_at).toLocaleString() : '-'}</td>
                      <td className="px-3 py-2 text-gray-400">{r.opened_at ? new Date(r.opened_at).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
