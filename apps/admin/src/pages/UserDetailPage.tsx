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

  const [eventFilter, setEventFilter] = useState('');
  const { data: eventsData } = useQuery({
    queryKey: ['admin', 'user', id, 'events', eventFilter],
    queryFn: () =>
      api(
        `/users/${id}/events?limit=200${eventFilter ? `&eventName=${encodeURIComponent(eventFilter)}` : ''}`,
      ),
    enabled: !!id,
  });

  const { data: sessionsData } = useQuery({
    queryKey: ['admin', 'user', id, 'sessions'],
    queryFn: () => api(`/users/${id}/sessions?limit=50`),
    enabled: !!id,
  });

  const { data: offersData } = useQuery<any>({
    queryKey: ['admin', 'user', id, 'offers'],
    queryFn: () => api(`/users/${id}/offers`),
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

  const forceHarvest = useMutation({
    mutationFn: () => api(`/users/${id}/force-harvest`, { method: 'POST' }),
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
        <InfoCard
          label="Growth"
          value={user.growth_percent != null ? `${Number(user.growth_percent).toFixed(2)}%` : '-'}
        />
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

      {/* Partner attribution */}
      {user.partner_id && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Partner attribution</h3>
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Partner</p>
              <Link to={`/partners/${user.partner_id}`} className="text-blue-600 hover:underline font-mono text-xs break-all">
                {user.partner_id}
              </Link>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Click ID</p>
              <p className="font-mono text-xs text-gray-700 break-all">
                {user.partner_click_id ?? <span className="text-gray-400">organic</span>}
              </p>
              {user.partner_click_id?.startsWith('tb_test_') && (
                <span className="inline-block mt-1 text-xs font-bold rounded px-1.5 py-0.5 bg-amber-100 text-amber-700">
                  SANDBOX
                </span>
              )}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Attributed at</p>
              <p className="text-xs text-gray-700">
                {user.partner_attributed_at ? new Date(user.partner_attributed_at).toLocaleString() : '—'}
              </p>
            </div>
          </div>

          {(user.partner_click_id?.startsWith('tb_test_') || import.meta.env.DEV) && !user.harvested && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">
                Sandbox testing: instantly complete this user's farm and fire stage_4 + harvest postbacks
                through the standard pipeline. Restricted to <span className="font-mono">tb_test_*</span> click_ids
                in production.
              </p>
              <button
                onClick={() => {
                  if (confirm('Force-harvest this user? This is irreversible — only use on sandbox accounts.')) {
                    forceHarvest.mutate();
                  }
                }}
                disabled={forceHarvest.isPending}
                className="bg-amber-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {forceHarvest.isPending ? 'Harvesting…' : '⚡ Force harvest (sandbox)'}
              </button>
              {forceHarvest.isSuccess && (
                <p className="mt-2 text-xs text-emerald-700">
                  Harvested. Postbacks are queued; check the partner's "Outbound postback log".
                </p>
              )}
              {forceHarvest.isError && (
                <p className="mt-2 text-xs text-rose-700">{(forceHarvest.error as Error).message}</p>
              )}
            </div>
          )}
        </div>
      )}

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

      {/* Sessions */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Sessions</h3>
          {sessionsData?.totals && (
            <div className="text-xs text-gray-500">
              Total: {sessionsData.totals.total_sessions} · Avg: {formatDuration(sessionsData.totals.avg_seconds)} · Sum: {formatDuration(sessionsData.totals.total_seconds)}
            </div>
          )}
        </div>
        {(!sessionsData?.sessions || sessionsData.sessions.length === 0) ? (
          <p className="text-sm text-gray-400">No sessions recorded yet</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {sessionsData.sessions.map((s: any) => (
              <div key={s.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-50">
                <span className={`font-mono rounded px-1.5 py-0.5 ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                  {s.is_active ? 'ACTIVE' : 'CLOSED'}
                </span>
                <span className="text-gray-700 shrink-0 w-44">{new Date(s.started_at).toLocaleString()}</span>
                <span className="text-gray-700 font-medium">{formatDuration(s.duration_sec)}</span>
                <span className="text-gray-500">· {s.events_count} events</span>
                <span className="text-gray-400 truncate">
                  {s.device?.platform || 'web'}
                  {s.geo?.country ? ` · ${s.geo.country}` : ''}
                  {s.geo?.city ? `, ${s.geo.city}` : ''}
                  {s.ip ? ` · ${s.ip}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ads & Offers activity — debug view for missing rewards and
          which games / offers the user engaged with. */}
      <div id="offers" className="rounded-xl border border-gray-200 bg-white p-5 mb-6 scroll-mt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Ads &amp; Offers activity</h3>
          <div className="flex gap-4 text-xs">
            <span>
              <span className="text-gray-400">Ad views total:</span>{' '}
              <span className="font-semibold text-purple-700">
                {(offersData?.adsByPhase ?? []).reduce((s: number, r: any) => s + (r.total || 0), 0)}
              </span>
            </span>
            <span>
              <span className="text-gray-400">Offers completed:</span>{' '}
              <span className="font-semibold text-emerald-700">{offersData?.completions?.length ?? 0}</span>
            </span>
            <span>
              <span className="text-gray-400">Postbacks logged:</span>{' '}
              <span className="font-semibold text-blue-700">{offersData?.postbacks?.length ?? 0}</span>
            </span>
          </div>
        </div>

        {/* Ads by phase */}
        <div className="mb-5">
          <p className="text-xs font-medium text-gray-500 mb-1">Ad views breakdown</p>
          {(!offersData?.adsByPhase || offersData.adsByPhase.length === 0) ? (
            <p className="text-xs text-gray-400">No ad views recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Type</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Phase</th>
                    <th className="text-right py-1.5 px-2 font-medium text-gray-500">Total</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Last date</th>
                  </tr>
                </thead>
                <tbody>
                  {offersData.adsByPhase.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5 px-2 font-mono">{r.ad_type}</td>
                      <td className="py-1.5 px-2 text-gray-700">{r.phase}</td>
                      <td className="py-1.5 px-2 text-right font-medium">{r.total}</td>
                      <td className="py-1.5 px-2 text-gray-500">
                        {r.last_date ? new Date(r.last_date).toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Offer completions */}
        <div className="mb-5">
          <p className="text-xs font-medium text-gray-500 mb-1">Offer completions</p>
          {(!offersData?.completions || offersData.completions.length === 0) ? (
            <p className="text-xs text-gray-400">User hasn't completed any offer milestones yet.</p>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Offer</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Milestone</th>
                    <th className="text-right py-1.5 px-2 font-medium text-gray-500">Reward</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Transaction</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Credited</th>
                  </tr>
                </thead>
                <tbody>
                  {offersData.completions.map((c: any) => (
                    <tr key={c.id} className="border-b border-gray-50">
                      <td className="py-1.5 px-2">
                        <Link to={`/offers/${c.offer_id}`} className="font-medium text-blue-600 hover:underline">
                          {c.offer_name}
                        </Link>
                        <span className="ml-1 text-gray-400">({c.reward_type})</span>
                      </td>
                      <td className="py-1.5 px-2 text-gray-700 font-mono">{c.milestone_event}</td>
                      <td className="py-1.5 px-2 text-right font-medium text-emerald-700">{c.reward_amount}</td>
                      <td className="py-1.5 px-2 text-gray-500 font-mono truncate max-w-[10rem]" title={c.everflow_transaction_id}>
                        {c.everflow_transaction_id || '-'}
                      </td>
                      <td className="py-1.5 px-2 text-gray-500">{new Date(c.credited_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Postback log for this user */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Postback log (this user)</p>
          {(!offersData?.postbacks || offersData.postbacks.length === 0) ? (
            <p className="text-xs text-gray-400">No postbacks were matched to this user.</p>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Offer</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Event</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Status</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Error</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Transaction</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {offersData.postbacks.map((p: any) => (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="py-1.5 px-2">{p.offer_name || <span className="text-gray-400">#{p.everflow_offer_id}</span>}</td>
                      <td className="py-1.5 px-2 font-mono text-gray-700">{p.everflow_event_id || '-'}</td>
                      <td className="py-1.5 px-2">
                        <span className={`rounded px-1.5 py-0.5 font-mono ${
                          p.status === 'success'
                            ? 'bg-emerald-100 text-emerald-700'
                            : p.status === 'received'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-red-100 text-red-700'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-red-600 truncate max-w-[14rem]" title={p.error_message || ''}>
                        {p.error_message || '-'}
                      </td>
                      <td className="py-1.5 px-2 text-gray-500 font-mono truncate max-w-[10rem]" title={p.transaction_id}>
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

      {/* Full event log */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between mb-3 gap-3">
          <h3 className="text-sm font-semibold text-gray-700">Activity Log {eventsData?.total != null && (<span className="text-gray-400 font-normal">({eventsData.total})</span>)}</h3>
          <input
            value={eventFilter}
            onChange={e => setEventFilter(e.target.value)}
            placeholder="Filter: e.g. farm.water"
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs w-56"
          />
        </div>
        {(!eventsData?.events || eventsData.events.length === 0) ? (
          <p className="text-sm text-gray-400">No events match this filter</p>
        ) : (
          <div className="space-y-1 max-h-[28rem] overflow-y-auto">
            {eventsData.events.map((e: any) => (
              <div key={e.id} className="flex items-start gap-3 text-xs py-1.5 border-b border-gray-50">
                <span className="bg-gray-100 text-gray-700 font-mono rounded px-1.5 py-0.5 shrink-0">{e.event_name}</span>
                <span className="text-gray-400 shrink-0 w-36">{new Date(e.created_at).toLocaleString()}</span>
                <span className="text-gray-500 truncate flex-1" title={JSON.stringify(e.properties)}>
                  {JSON.stringify(e.properties)}
                </span>
                <span className="text-gray-400 shrink-0">
                  {e.geo?.country || '—'}{e.ip ? ` · ${e.ip}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function InfoCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}
