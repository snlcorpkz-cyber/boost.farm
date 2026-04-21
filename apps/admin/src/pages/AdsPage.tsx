import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type Tab = 'funnel' | 'placements' | 'revenue' | 'errors' | 'status';

function pct(a: number, b: number) {
  if (!b) return 0;
  return Math.round((a / b) * 1000) / 10;
}

function fmtUsd(cents: number | null | undefined): string {
  const n = Number(cents || 0) / 100;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function fmtEcpm(cents: number | null | undefined): string {
  const n = Number(cents || 0) / 100;
  return `$${n.toFixed(2)}`;
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
            <th className="text-right py-2 px-3 font-medium text-gray-500">Impressions</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Revenue</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">eCPM</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Unique users</th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((r: any) => {
            const ecpm = r.impressions ? Math.round((r.revenue_cents / r.impressions) * 1000) : 0;
            return (
              <tr key={r.placement} className="border-b border-gray-50">
                <td className="py-2 px-3 font-medium text-gray-900">{r.placement}</td>
                <td className="py-2 px-3 text-right">{r.requested}</td>
                <td className="py-2 px-3 text-right">{r.shown}</td>
                <td className="py-2 px-3 text-right">{r.rewarded}</td>
                <td className="py-2 px-3 text-right text-gray-500">{r.no_fill}</td>
                <td className="py-2 px-3 text-right text-gray-500">{r.failed}</td>
                <td className="py-2 px-3 text-right font-medium">{pct(r.shown, r.requested)}%</td>
                <td className="py-2 px-3 text-right font-medium">{pct(r.rewarded, r.shown)}%</td>
                <td className="py-2 px-3 text-right text-gray-700">{r.impressions ?? 0}</td>
                <td className="py-2 px-3 text-right font-semibold text-green-700">{fmtUsd(r.revenue_cents)}</td>
                <td className="py-2 px-3 text-right text-gray-600">{fmtEcpm(ecpm)}</td>
                <td className="py-2 px-3 text-right text-gray-500">{r.unique_users}</td>
              </tr>
            );
          })}
          {(!data?.rows || data.rows.length === 0) && (
            <tr>
              <td colSpan={12} className="py-6 text-center text-gray-400">
                No data.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RevenueChart({ daily }: { daily: Array<{ stat_date: string; revenue_cents: number; impressions: number }> }) {
  if (!daily.length) {
    return <div className="py-10 text-center text-sm text-gray-400">No revenue yet in this range.</div>;
  }
  const width = 720;
  const height = 160;
  const padding = { top: 10, right: 10, bottom: 26, left: 48 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const maxR = Math.max(1, ...daily.map((d) => d.revenue_cents));
  const stepX = daily.length > 1 ? plotW / (daily.length - 1) : 0;
  const points = daily.map((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + plotH - (d.revenue_cents / maxR) * plotH;
    return { x, y, d };
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotH} stroke="#e5e7eb" />
      <line
        x1={padding.left}
        y1={padding.top + plotH}
        x2={padding.left + plotW}
        y2={padding.top + plotH}
        stroke="#e5e7eb"
      />
      <text x={padding.left - 6} y={padding.top + 4} textAnchor="end" fontSize="10" fill="#6b7280">
        {fmtUsd(maxR)}
      </text>
      <text x={padding.left - 6} y={padding.top + plotH} textAnchor="end" fontSize="10" fill="#6b7280">
        $0.00
      </text>
      <path d={path} stroke="#16a34a" strokeWidth={2} fill="none" />
      {points.map((p) => (
        <g key={p.d.stat_date}>
          <circle cx={p.x} cy={p.y} r={3} fill="#16a34a" />
          <title>{`${p.d.stat_date}: ${fmtUsd(p.d.revenue_cents)} · ${p.d.impressions} imp`}</title>
        </g>
      ))}
      {daily.map((d, i) => {
        if (daily.length > 8 && i % Math.ceil(daily.length / 8) !== 0 && i !== daily.length - 1) return null;
        const x = padding.left + i * stepX;
        return (
          <text key={d.stat_date} x={x} y={height - 8} textAnchor="middle" fontSize="10" fill="#6b7280">
            {d.stat_date.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}

function RevenueTab({ days }: { days: number }) {
  const { data, isPending } = useQuery<any>({
    queryKey: ['admin', 'ads', 'revenue', days],
    queryFn: () => api(`/ads/revenue?days=${days}`),
  });
  if (isPending) return <div className="mt-4 text-sm text-gray-500">Loading revenue…</div>;

  const totals = data?.totals ?? { impressions: 0, revenue_cents: 0, dau_with_ads: 0, arpdau_cents: 0, ecpm_cents: 0 };

  return (
    <div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Revenue" value={fmtUsd(totals.revenue_cents)} sub={`${days}d, ILRD net`} tone="good" />
        <Tile label="Impressions" value={(totals.impressions || 0).toLocaleString()} />
        <Tile
          label="eCPM"
          value={fmtEcpm(totals.ecpm_cents)}
          sub="revenue per 1000 imp"
          tone={totals.ecpm_cents >= 1000 ? 'good' : totals.ecpm_cents >= 300 ? 'warn' : 'neutral'}
        />
        <Tile
          label="ARPDAU"
          value={fmtUsd(totals.arpdau_cents)}
          sub={`${(totals.dau_with_ads || 0).toLocaleString()} DAU with ads`}
        />
        <Tile label="DAU with ads" value={(totals.dau_with_ads || 0).toLocaleString()} />
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily revenue</h3>
        <RevenueChart daily={data?.daily ?? []} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By placement</h3>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-3 font-medium text-gray-500">Placement</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Imp.</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Revenue</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">eCPM</th>
              </tr>
            </thead>
            <tbody>
              {(data?.by_placement ?? []).map((r: any) => {
                const ecpm = r.impressions ? Math.round((r.revenue_cents / r.impressions) * 1000) : 0;
                return (
                  <tr key={r.placement} className="border-b border-gray-50">
                    <td className="py-2 px-3 font-medium text-gray-900">{r.placement}</td>
                    <td className="py-2 px-3 text-right">{r.impressions}</td>
                    <td className="py-2 px-3 text-right font-semibold text-green-700">{fmtUsd(r.revenue_cents)}</td>
                    <td className="py-2 px-3 text-right text-gray-600">{fmtEcpm(ecpm)}</td>
                  </tr>
                );
              })}
              {(!data?.by_placement || data.by_placement.length === 0) && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-400">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By network</h3>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-3 font-medium text-gray-500">Network</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Imp.</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Revenue</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Share</th>
              </tr>
            </thead>
            <tbody>
              {(data?.by_network ?? []).map((r: any) => (
                <tr key={r.network} className="border-b border-gray-50">
                  <td className="py-2 px-3 font-medium text-gray-900">{r.network}</td>
                  <td className="py-2 px-3 text-right">{r.impressions}</td>
                  <td className="py-2 px-3 text-right font-semibold text-green-700">{fmtUsd(r.revenue_cents)}</td>
                  <td className="py-2 px-3 text-right text-gray-600">{r.share_pct}%</td>
                </tr>
              ))}
              {(!data?.by_network || data.by_network.length === 0) && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-400">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By country</h3>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-3 font-medium text-gray-500">Country</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Imp.</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {(data?.by_country ?? []).map((r: any) => (
                <tr key={r.country} className="border-b border-gray-50">
                  <td className="py-2 px-3 font-medium text-gray-900">{r.country}</td>
                  <td className="py-2 px-3 text-right">{r.impressions}</td>
                  <td className="py-2 px-3 text-right font-semibold text-green-700">{fmtUsd(r.revenue_cents)}</td>
                </tr>
              ))}
              {(!data?.by_country || data.by_country.length === 0) && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-gray-400">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Top users</h3>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-3 font-medium text-gray-500">Email</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Imp.</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {(data?.top_users ?? []).map((r: any) => (
                <tr key={r.user_id} className="border-b border-gray-50">
                  <td className="py-2 px-3 text-gray-800 font-mono text-xs">{r.email ?? r.user_id.slice(0, 8)}</td>
                  <td className="py-2 px-3 text-right">{r.impressions}</td>
                  <td className="py-2 px-3 text-right font-semibold text-green-700">{fmtUsd(r.revenue_cents)}</td>
                </tr>
              ))}
              {(!data?.top_users || data.top_users.length === 0) && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-gray-400">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
        <Tile label="Impressions (1h)" value={h.impressions ?? 0} />
        <Tile label="Revenue (1h)" value={fmtUsd(h.revenue_cents ?? 0)} tone={h.revenue_cents ? 'good' : 'neutral'} />
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
          {(['funnel', 'placements', 'revenue', 'errors', 'status'] as Tab[]).map((t) => (
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
      {tab === 'revenue' && <RevenueTab days={days} />}
      {tab === 'errors' && <ErrorsTab days={days} />}
      {tab === 'status' && <StatusTab />}
    </div>
  );
}
