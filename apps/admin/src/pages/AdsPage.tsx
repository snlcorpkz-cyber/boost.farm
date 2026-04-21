import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type Tab = 'funnel' | 'placements' | 'errors' | 'status';

function pct(a: number, b: number) {
  if (!b) return 0;
  return Math.round((a / b) * 1000) / 10;
}

function Tile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-green-600'
      : tone === 'warn'
      ? 'text-amber-600'
      : tone === 'bad'
      ? 'text-red-600'
      : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${toneClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function FunnelTab({ days }: { days: number }) {
  const { data, isPending } = useQuery<any>({
    queryKey: ['admin', 'ads', 'funnel', days],
    queryFn: () => api(`/ads/funnel?days=${days}`),
  });

  // Aggregate totals across all rows for the top tiles.
  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    const sum = (k: string) => rows.reduce((s: number, r: any) => s + (r[k] || 0), 0);
    return {
      requested: sum('requested'),
      shown: sum('shown'),
      rewarded: sum('rewarded'),
      failed: sum('failed'),
      no_fill: sum('no_fill'),
    };
  }, [data]);

  if (isPending) return <div className="mt-4 text-sm text-gray-500">Loading funnel…</div>;

  const fillRate = pct(totals.shown, totals.requested);
  const rewardRate = pct(totals.rewarded, totals.shown);

  return (
    <div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Requested" value={totals.requested.toLocaleString()} />
        <Tile
          label="Fill rate"
          value={`${fillRate}%`}
          sub={`${totals.shown.toLocaleString()} shown`}
          tone={fillRate >= 60 ? 'good' : fillRate >= 30 ? 'warn' : 'bad'}
        />
        <Tile
          label="Reward rate"
          value={`${rewardRate}%`}
          sub={`${totals.rewarded.toLocaleString()} rewarded`}
          tone={rewardRate >= 70 ? 'good' : rewardRate >= 40 ? 'warn' : 'bad'}
        />
        <Tile label="Failed" value={totals.failed.toLocaleString()} tone={totals.failed ? 'warn' : 'neutral'} />
        <Tile label="No fill" value={totals.no_fill.toLocaleString()} tone={totals.no_fill ? 'warn' : 'neutral'} />
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 px-2 font-medium text-gray-500">Date</th>
              <th className="text-left py-2 px-2 font-medium text-gray-500">Platform</th>
              <th className="text-left py-2 px-2 font-medium text-gray-500">Placement</th>
              <th className="text-right py-2 px-2 font-medium text-gray-500">Req</th>
              <th className="text-right py-2 px-2 font-medium text-gray-500">Shown</th>
              <th className="text-right py-2 px-2 font-medium text-gray-500">Rew</th>
              <th className="text-right py-2 px-2 font-medium text-gray-500">No-fill</th>
              <th className="text-right py-2 px-2 font-medium text-gray-500">Fail</th>
              <th className="text-right py-2 px-2 font-medium text-gray-500">Fill %</th>
              <th className="text-right py-2 px-2 font-medium text-gray-500">Users</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r: any, i: number) => (
              <tr
                key={`${r.stat_date}-${r.platform}-${r.placement}-${i}`}
                className={`border-b border-gray-50 ${r.today ? 'bg-blue-50/40' : ''}`}
              >
                <td className="py-1.5 px-2 text-gray-700">
                  {r.stat_date}
                  {r.today && <span className="ml-1 text-[10px] text-blue-600">·today</span>}
                </td>
                <td className="py-1.5 px-2 text-gray-600">{r.platform}</td>
                <td className="py-1.5 px-2 font-medium text-gray-800">{r.placement}</td>
                <td className="py-1.5 px-2 text-right text-gray-700">{r.requested}</td>
                <td className="py-1.5 px-2 text-right text-gray-700">{r.shown}</td>
                <td className="py-1.5 px-2 text-right text-gray-700">{r.rewarded}</td>
                <td className="py-1.5 px-2 text-right text-gray-500">{r.no_fill}</td>
                <td className="py-1.5 px-2 text-right text-gray-500">{r.failed}</td>
                <td className="py-1.5 px-2 text-right font-medium text-gray-800">{pct(r.shown, r.requested)}%</td>
                <td className="py-1.5 px-2 text-right text-gray-500">{r.unique_users}</td>
              </tr>
            ))}
            {(!data?.rows || data.rows.length === 0) && (
              <tr>
                <td colSpan={10} className="py-6 text-center text-gray-400">
                  No ad activity in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlacementsTab({ days }: { days: number }) {
  const { data, isPending } = useQuery<any>({
    queryKey: ['admin', 'ads', 'placements', days],
    queryFn: () => api(`/ads/placements?days=${days}`),
  });
  if (isPending) return <div className="mt-4 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 px-3 font-medium text-gray-500">Placement</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Requested</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Shown</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Rewarded</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">No-fill</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Failed</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Fill %</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Reward %</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Unique users</th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((r: any) => (
            <tr key={r.placement} className="border-b border-gray-50">
              <td className="py-2 px-3 font-medium text-gray-900">{r.placement}</td>
              <td className="py-2 px-3 text-right">{r.requested}</td>
              <td className="py-2 px-3 text-right">{r.shown}</td>
              <td className="py-2 px-3 text-right">{r.rewarded}</td>
              <td className="py-2 px-3 text-right text-gray-500">{r.no_fill}</td>
              <td className="py-2 px-3 text-right text-gray-500">{r.failed}</td>
              <td className="py-2 px-3 text-right font-medium">{pct(r.shown, r.requested)}%</td>
              <td className="py-2 px-3 text-right font-medium">{pct(r.rewarded, r.shown)}%</td>
              <td className="py-2 px-3 text-right text-gray-500">{r.unique_users}</td>
            </tr>
          ))}
          {(!data?.rows || data.rows.length === 0) && (
            <tr>
              <td colSpan={9} className="py-6 text-center text-gray-400">
                No data.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ErrorsTab({ days }: { days: number }) {
  const { data, isPending } = useQuery<any>({
    queryKey: ['admin', 'ads', 'errors', days],
    queryFn: () => api(`/ads/errors?days=${days}`),
  });
  if (isPending) return <div className="mt-4 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 px-3 font-medium text-gray-500">Event</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">Code</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">Placement</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">Message</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Count</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((r: any, i: number) => (
            <tr key={i} className="border-b border-gray-50">
              <td className="py-2 px-3 text-gray-700 font-mono text-xs">{r.event_name}</td>
              <td className="py-2 px-3 text-gray-700">{r.code}</td>
              <td className="py-2 px-3 text-gray-600">{r.placement}</td>
              <td className="py-2 px-3 text-gray-500 max-w-md truncate">{r.message}</td>
              <td className="py-2 px-3 text-right font-medium">{r.c}</td>
              <td className="py-2 px-3 text-gray-400">{new Date(r.last_seen).toLocaleString()}</td>
            </tr>
          ))}
          {(!data?.rows || data.rows.length === 0) && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-gray-400">
                No ad errors — nice!
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusTab() {
  const { data, isPending } = useQuery<any>({
    queryKey: ['admin', 'ads', 'status'],
    queryFn: () => api('/ads/status'),
    refetchInterval: 30_000,
  });
  if (isPending) return <div className="mt-4 text-sm text-gray-500">Loading status…</div>;

  const h = data?.last_hour ?? {};

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile
          label="LevelPlay configured"
          value={data?.levelplay_configured ? 'yes' : 'no'}
          tone={data?.levelplay_configured ? 'good' : 'warn'}
        />
        <Tile label="Requested (1h)" value={h.requested ?? 0} />
        <Tile label="Shown (1h)" value={h.shown ?? 0} />
        <Tile
          label="Fill rate (1h)"
          value={h.fill_rate_1h == null ? '—' : `${h.fill_rate_1h}%`}
          tone={h.fill_rate_1h == null ? 'neutral' : h.fill_rate_1h >= 60 ? 'good' : h.fill_rate_1h >= 30 ? 'warn' : 'bad'}
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Event last-seen</h3>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 px-3 font-medium text-gray-500">Event</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">Last hour</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {(data?.by_event ?? []).map((e: any) => (
              <tr key={e.event_name} className="border-b border-gray-50">
                <td className="py-2 px-3 font-mono text-xs text-gray-700">{e.event_name}</td>
                <td className="py-2 px-3 text-right">{e.last_hour}</td>
                <td className="py-2 px-3 text-gray-500">{new Date(e.last_at).toLocaleString()}</td>
              </tr>
            ))}
            {(!data?.by_event || data.by_event.length === 0) && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-gray-400">
                  No ad events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdsPage() {
  const [tab, setTab] = useState<Tab>('funnel');
  const [days, setDays] = useState<number>(7);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Ads</h1>
      <p className="mt-1 text-sm text-gray-500">
        Rewarded-video funnel, per-placement performance, and mediation health.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
          {(['funnel', 'placements', 'errors', 'status'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium capitalize ${
                tab === t ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab !== 'status' && (
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm font-medium ${
                  days === d ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'funnel' && <FunnelTab days={days} />}
      {tab === 'placements' && <PlacementsTab days={days} />}
      {tab === 'errors' && <ErrorsTab days={days} />}
      {tab === 'status' && <StatusTab />}
    </div>
  );
}
