import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatInt, formatUsd, formatDay } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';

interface OverviewResponse {
  partner: {
    slug: string;
    name: string;
    status: string;
    defaultPayoutCents: number;
    postbackConfigured: boolean;
  };
  range: { days: number };
  totals: {
    attributedUsers: number;
    conversions: number;
    harvests: number;
    payoutPendingCents: number;
    payoutApprovedCents: number;
    payoutPaidCents: number;
  };
  funnel: Array<{ step: string; users: number; pct: number }>;
  daily: Array<{ date: string; installs: number; harvests: number; payoutCents: number }>;
}

const STEP_LABELS: Record<string, string> = {
  install: 'Install',
  register: 'Register',
  tutorial: 'Tutorial',
  first_play: 'First play',
  engaged_d0: 'Engaged D0',
  d1_return: 'D1 return',
  stage_2: 'Stage 2',
  stage_3: 'Stage 3',
  stage_4: 'Stage 4',
  stage_5: 'Stage 5',
  stage_6: 'Stage 6',
  harvest: 'Harvest',
  harvest_x3: 'Harvest x3',
};

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'emerald' | 'amber' | 'blue' | 'gray' }) {
  const border = {
    emerald: 'border-l-emerald-500',
    amber: 'border-l-amber-500',
    blue: 'border-l-blue-500',
    gray: 'border-l-gray-300',
  }[accent ?? 'gray'];
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-5 border-l-4 ${border}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

export function OverviewPage() {
  const [days, setDays] = useState(30);

  const { data, isPending, error } = useQuery<OverviewResponse>({
    queryKey: ['partner', 'overview', days],
    queryFn: () => api(`/overview?days=${days}`),
  });

  if (isPending) {
    return <div className="mt-10 text-center text-sm text-gray-500">Loading…</div>;
  }
  if (error || !data) {
    return <div className="mt-10 text-center text-sm text-rose-600">{(error as Error)?.message || 'Failed to load'}</div>;
  }

  const totalPayout =
    data.totals.payoutPendingCents + data.totals.payoutApprovedCents + data.totals.payoutPaidCents;

  const hasTraffic = data.totals.attributedUsers > 0 || data.totals.conversions > 0;
  const maxInstalls = Math.max(1, ...data.daily.map((d) => d.installs));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Welcome, {data.partner.name}</h1>
            <StatusBadge status={data.partner.status} />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Payout per harvest:{' '}
            <span className="font-semibold text-gray-700">{formatUsd(data.partner.defaultPayoutCents)}</span>
          </p>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-4 py-2 text-sm font-medium ${
                days === d ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {data.partner.status === 'draft' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Integration pending.</strong> Your account is set up, but we haven't yet
          received your postback URL. Once the integration is finalised, this banner will
          disappear and postbacks will start flowing in real time.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Installs"
          value={formatInt(data.totals.attributedUsers)}
          sub={`Past ${data.range.days} days`}
          accent="blue"
        />
        <Kpi
          label="Harvests"
          value={formatInt(data.totals.harvests)}
          sub={
            data.totals.attributedUsers > 0
              ? `${Math.round((data.totals.harvests / data.totals.attributedUsers) * 1000) / 10}% conversion`
              : 'No installs yet'
          }
          accent="emerald"
        />
        <Kpi
          label="Payout earned"
          value={formatUsd(totalPayout)}
          sub={`${formatUsd(data.totals.payoutPendingCents)} pending · ${formatUsd(data.totals.payoutPaidCents)} paid`}
          accent="amber"
        />
        <Kpi
          label="Avg per harvest"
          value={data.totals.harvests > 0 ? formatUsd(Math.round(totalPayout / data.totals.harvests)) : '—'}
          sub="Blended across conversions"
          accent="gray"
        />
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Conversion funnel</h2>
          <p className="text-xs text-gray-500">Distinct users reaching each step</p>
        </div>
        {!hasTraffic ? (
          <EmptyState
            icon="🌱"
            title="Waiting for your first user"
            description="As soon as a user clicks your tracking link and installs the app, they will show up here. The funnel updates in real time."
          />
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="space-y-3">
              {data.funnel.map((f) => {
                const width = data.funnel[0]?.users
                  ? Math.max(3, (f.users / data.funnel[0].users) * 100)
                  : 3;
                return (
                  <div key={f.step}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium text-gray-700">{STEP_LABELS[f.step] ?? f.step}</span>
                      <span className="tabular-nums text-gray-900">
                        {formatInt(f.users)}{' '}
                        <span className="text-xs font-normal text-gray-400">({f.pct}%)</span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Daily breakdown</h2>
          <p className="text-xs text-gray-500">Installs + harvests over time</p>
        </div>
        {!hasTraffic ? (
          <EmptyState
            icon="📊"
            title="No data in this range"
            description="Once users start installing, daily volume will appear here."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Date</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Installs</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Harvests</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Payout</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 w-1/3">Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.daily.map((d) => (
                  <tr key={d.date} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-700">{formatDay(d.date)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatInt(d.installs)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatInt(d.harvests)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatUsd(d.payoutCents)}</td>
                    <td className="px-4 py-2">
                      <div className="h-1.5 w-full rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${(d.installs / maxInstalls) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
