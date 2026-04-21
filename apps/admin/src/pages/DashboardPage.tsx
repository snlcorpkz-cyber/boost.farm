import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

function StatCard({
  title,
  value,
  sub,
  color = 'text-gray-900',
}: {
  title: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function RankBadge({ rank }: { rank: string }) {
  const colors: Record<string, string> = {
    novice: 'bg-gray-100 text-gray-600',
    amateur: 'bg-green-100 text-green-700',
    farmer: 'bg-blue-100 text-blue-700',
    master: 'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${colors[rank] || 'bg-gray-100 text-gray-600'}`}>
      {rank}
    </span>
  );
}

// Sparkline — a compact trend line rendered via inline SVG so the
// dashboard doesn't need a charting library just for a tiny preview.
function Sparkline({
  values,
  stroke = '#3b82f6',
  width = 160,
  height = 36,
}: {
  values: number[];
  stroke?: string;
  width?: number;
  height?: number;
}) {
  if (!values.length) return <svg width={width} height={height} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline fill="none" stroke={stroke} strokeWidth={2} points={pts} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DashboardPage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api('/dashboard/stats'),
  });

  // Stickiness gives DAU/MAU trend — a better proxy for product
  // health than raw DAU, so we surface it right under the top-line cards.
  const { data: stick } = useQuery<any[]>({
    queryKey: ['admin', 'dashboard', 'stickiness'],
    queryFn: () => api('/analytics/stickiness?days=14'),
  });

  // Single most actionable ad metric: last-hour fill rate. The full ad
  // dashboard lives at /ads, but the top-line "is mediation working?" status
  // belongs here too.
  const { data: adStatus } = useQuery<any>({
    queryKey: ['admin', 'dashboard', 'ads-status'],
    queryFn: () => api('/ads/status'),
  });

  if (isPending) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-4 text-red-600">Failed to load dashboard data.</p>
      </div>
    );
  }

  const dauDelta = data.dauYesterday > 0 ? Math.round(((data.dau - data.dauYesterday) / data.dauYesterday) * 100) : 0;
  const stickNow = stick && stick.length ? stick[stick.length - 1] : null;
  const sparkDau = (stick ?? []).map((r) => r.dau);
  const adFill = adStatus?.last_hour?.fill_rate_1h;
  const adReq = adStatus?.last_hour?.requested ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Real-time overview of BoostFarm</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Users" value={data.totalUsers.toLocaleString()} />
        <StatCard title="New Today" value={data.newUsersToday} color="text-green-600" />
        <StatCard
          title="DAU"
          value={data.dau}
          sub={dauDelta !== 0 ? `${dauDelta > 0 ? '+' : ''}${dauDelta}% vs yesterday` : 'vs yesterday'}
        />
        <StatCard title="WAU / MAU" value={`${data.wau} / ${data.mau}`} />
        <StatCard title="Active Farms" value={data.activeFarms} />
        <StatCard title="Ad Views Today" value={data.adViewsToday} color="text-purple-600" />
        <StatCard title="Total Ad Views" value={data.totalAdViews.toLocaleString()} />
        <StatCard title="Avg Water in Can" value={`${data.avgWaterInCan}g`} />
      </div>

      {/* Product health row — stickiness + ad pipeline pulse. */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Stickiness (DAU/MAU)</h3>
            <span className="text-xs text-gray-400">14d</span>
          </div>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {stickNow ? `${stickNow.stickiness}%` : '—'}
          </p>
          <p className="text-xs text-gray-400">
            DAU {stickNow?.dau ?? 0} / MAU {stickNow?.mau ?? 0}
            {stickNow && stickNow.stickiness >= 20 && ' · healthy'}
            {stickNow && stickNow.stickiness < 20 && stickNow.stickiness >= 10 && ' · okay'}
            {stickNow && stickNow.stickiness < 10 && ' · low'}
          </p>
          <div className="mt-2">
            <Sparkline values={sparkDau} stroke="#3b82f6" />
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Ad fill rate (1h)</h3>
            <span className="text-xs text-gray-400">last hour</span>
          </div>
          <p
            className={`mt-2 text-3xl font-bold ${
              adFill == null ? 'text-gray-400' : adFill >= 60 ? 'text-green-600' : adFill >= 30 ? 'text-amber-600' : 'text-red-600'
            }`}
          >
            {adFill == null ? '—' : `${adFill}%`}
          </p>
          <p className="text-xs text-gray-400">
            {adReq} requested · {adStatus?.last_hour?.shown ?? 0} shown · {adStatus?.last_hour?.rewarded ?? 0} rewarded
          </p>
          <p className="mt-1 text-xs text-gray-400">
            LevelPlay:{' '}
            <span className={adStatus?.levelplay_configured ? 'text-green-600' : 'text-amber-600'}>
              {adStatus?.levelplay_configured ? 'configured' : 'not configured'}
            </span>
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-700">Recent ad events</h3>
          <ul className="mt-2 space-y-1 text-xs">
            {(adStatus?.by_event ?? []).slice(0, 6).map((e: any) => (
              <li key={e.event_name} className="flex items-center justify-between gap-2">
                <code className="font-mono text-gray-700">{e.event_name}</code>
                <span className="text-gray-400">
                  {e.last_hour}/h · {new Date(e.last_at).toLocaleTimeString()}
                </span>
              </li>
            ))}
            {(!adStatus?.by_event || adStatus.by_event.length === 0) && (
              <li className="text-gray-400">No ad events yet — click an ad to start seeing data.</li>
            )}
          </ul>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Rank Distribution</h3>
          <div className="space-y-2">
            {(data.rankDistribution || []).map((r: any) => {
              const total = (data.rankDistribution || []).reduce((s: number, x: any) => s + x.c, 0) || 1;
              const pct = Math.round((r.c / total) * 100);
              return (
                <div key={r.rank_id} className="flex items-center gap-3">
                  <RankBadge rank={r.rank_id} />
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-medium text-gray-500 w-12 text-right">
                    {r.c} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Growth Stage Distribution</h3>
          <div className="space-y-2">
            {(data.stageDistribution || []).map((s: any) => {
              const total = (data.stageDistribution || []).reduce((sum: number, x: any) => sum + x.c, 0) || 1;
              const pct = Math.round((s.c / total) * 100);
              return (
                <div key={s.current_stage} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-600 w-16">Stage {s.current_stage}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-medium text-gray-500 w-12 text-right">{s.c}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Registrations</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-3 font-medium text-gray-500">Nickname</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Email</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Joined</th>
              </tr>
            </thead>
            <tbody>
              {(data.recentUsers || []).map((u: any) => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 px-3 font-medium text-gray-900">{u.nickname}</td>
                  <td className="py-2 px-3 text-gray-600">{u.email}</td>
                  <td className="py-2 px-3 text-gray-500">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
