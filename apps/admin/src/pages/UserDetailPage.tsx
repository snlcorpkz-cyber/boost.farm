import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '@/lib/api';

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [grantType, setGrantType] = useState<'water' | 'nutrition'>('water');
  const [grantAmount, setGrantAmount] = useState('100');

  const { data: user, isPending } = useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: () => api(`/users/${id}`),
    enabled: !!id,
  });

  const grant = useMutation({
    mutationFn: () => api(`/users/${id}/grant`, { method: 'POST', body: { type: grantType, amount: Number(grantAmount) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'user', id] }); },
  });

  const toggleAdmin = useMutation({
    mutationFn: () => api(`/users/${id}/toggle-admin`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'user', id] }); },
  });

  if (isPending) return <div className="text-gray-500">Loading user...</div>;
  if (!user) return <div className="text-red-600">User not found</div>;

  return (
    <div>
      <Link to="/users" className="text-sm text-blue-600 hover:underline mb-4 inline-block">&larr; Back to Users</Link>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center text-2xl font-bold text-gray-500">
          {(user.nickname || '?')[0].toUpperCase()}
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{user.nickname}</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
          <p className="text-xs text-gray-400 font-mono">{user.id}</p>
        </div>
        {user.is_admin && <span className="bg-red-100 text-red-600 text-xs font-bold rounded px-2 py-1">ADMIN</span>}
      </div>

      {/* Info grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <InfoCard label="Rank" value={user.rank_id || 'novice'} />
        <InfoCard label="Stage" value={user.current_stage || '-'} />
        <InfoCard label="Growth" value={user.growth_percent != null ? `${Math.round(user.growth_percent)}%` : '-'} />
        <InfoCard label="Water in Can" value={user.water_in_can != null ? `${Math.round(user.water_in_can)}g` : '-'} />
        <InfoCard label="Nutrition" value={user.nutrition ?? '-'} />
        <InfoCard label="Water This Month" value={user.total_water_this_month != null ? `${Math.round(user.total_water_this_month)}g` : '-'} />
        <InfoCard label="Product" value={user.product_name || '-'} />
        <InfoCard label="Platform" value={user.device_platform || 'unknown'} />
        <InfoCard label="Country" value={user.country || 'unknown'} />
        <InfoCard label="Joined" value={new Date(user.created_at).toLocaleString()} />
        <InfoCard label="Last Login" value={user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '-'} />
        <InfoCard label="Last Active" value={user.last_active_at ? new Date(user.last_active_at).toLocaleString() : '-'} />
      </div>

      {/* Admin actions */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Admin Actions</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <select value={grantType} onChange={e => setGrantType(e.target.value as any)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              <option value="water">Water</option>
              <option value="nutrition">Nutrition</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
            <input type="number" value={grantAmount} onChange={e => setGrantAmount(e.target.value)} className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <button
            onClick={() => grant.mutate()}
            disabled={grant.isPending}
            className="bg-green-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {grant.isPending ? '...' : 'Grant'}
          </button>
          <button
            onClick={() => { if (confirm('Toggle admin status?')) toggleAdmin.mutate(); }}
            className="bg-gray-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-gray-700"
          >
            {user.is_admin ? 'Remove Admin' : 'Make Admin'}
          </button>
        </div>
      </div>

      {/* Friends */}
      {user.friends?.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Friends ({user.friends.length})</h3>
          <div className="flex flex-wrap gap-2">
            {user.friends.map((f: any) => (
              <Link key={f.id} to={`/users/${f.id}`} className="text-xs bg-blue-50 text-blue-700 rounded-lg px-2.5 py-1.5 hover:bg-blue-100 font-medium">
                {f.nickname}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Push Tokens */}
      {user.pushTokens?.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Push Tokens ({user.pushTokens.length})</h3>
          {user.pushTokens.map((t: any, i: number) => (
            <div key={i} className="text-xs text-gray-500 font-mono truncate">{t.platform}: {t.token.slice(0, 40)}...</div>
          ))}
        </div>
      )}

      {/* Recent Events */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Events</h3>
        {(!user.recentEvents || user.recentEvents.length === 0) ? (
          <p className="text-sm text-gray-400">No events tracked yet</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {user.recentEvents.map((e: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-50">
                <span className="bg-gray-100 text-gray-600 font-mono rounded px-1.5 py-0.5">{e.event_name}</span>
                <span className="text-gray-400 shrink-0">{new Date(e.created_at).toLocaleString()}</span>
                <span className="text-gray-500 truncate">{JSON.stringify(e.properties)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}
