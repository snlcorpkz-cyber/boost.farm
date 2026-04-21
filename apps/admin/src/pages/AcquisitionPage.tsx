import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type Tab = 'utm' | 'geo' | 'referrer' | 'cohorts';

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function UtmTab({ days }: { days: number }) {
  const { data, isPending } = useQuery<any>({
    queryKey: ['admin', 'acq', 'utm', days],
    queryFn: () => api(`/acquisition/by-utm?days=${days}`),
  });
  if (isPending) return <div className="mt-4 text-sm text-gray-500">Loading…</div>;

  const total = (data?.rows ?? []).reduce((s: number, r: any) => s + (r.users || 0), 0);

  return (
    <div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Tile label={`Users (${days}d)`} value={total} />
        <Tile label="Unique sources" value={data?.rows?.length ?? 0} />
        <Tile
          label="Avg D1 retention"
          value={`${
            data?.rows?.length
              ? Math.round(
                  data.rows.reduce((s: number, r: any) => s + r.d1_pct * r.users, 0) /
                    Math.max(1, total)
                )
              : 0
          }%`}
        />
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 px-3 font-medium text-gray-500">utm_source</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">utm_medium</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">utm_campaign</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">Users</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">D1 retained</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">D1 %</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r: any, i: number) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-2 px-3 text-gray-800 font-medium">{r.utm_source}</td>
                <td className="py-2 px-3 text-gray-600">{r.utm_medium || '—'}</td>
                <td className="py-2 px-3 text-gray-600">{r.utm_campaign || '—'}</td>
                <td className="py-2 px-3 text-right">{r.users}</td>
                <td className="py-2 px-3 text-right text-gray-500">{r.d1_retained}</td>
                <td
                  className={`py-2 px-3 text-right font-medium ${
                    r.d1_pct >= 25 ? 'text-green-600' : r.d1_pct >= 10 ? 'text-amber-600' : 'text-red-600'
                  }`}
                >
                  {r.d1_pct}%
                </td>
              </tr>
            ))}
            {(!data?.rows || data.rows.length === 0) && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-gray-400">
                  No acquisition data in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GeoTab({ days }: { days: number }) {
  const { data, isPending } = useQuery<any>({
    queryKey: ['admin', 'acq', 'geo', days],
    queryFn: () => api(`/acquisition/by-geo?days=${days}`),
  });
  if (isPending) return <div className="mt-4 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 px-3 font-medium text-gray-500">Country</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Users</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">D1 retained</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">D1 %</th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((r: any) => (
            <tr key={r.country} className="border-b border-gray-50">
              <td className="py-2 px-3 font-medium">{r.country}</td>
              <td className="py-2 px-3 text-right">{r.users}</td>
              <td className="py-2 px-3 text-right text-gray-500">{r.d1_retained}</td>
              <td className="py-2 px-3 text-right font-medium">{r.d1_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReferrerTab({ days }: { days: number }) {
  const { data, isPending } = useQuery<any>({
    queryKey: ['admin', 'acq', 'referrer', days],
    queryFn: () => api(`/acquisition/by-referrer?days=${days}`),
  });
  if (isPending) return <div className="mt-4 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
      <p className="mb-3 text-xs text-gray-500">
        Captured from Google Play Install Referrer on first Android launch. Only organic / tagged installs that
        went through the Play Store will appear here.
      </p>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 px-3 font-medium text-gray-500">utm_source</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">utm_campaign</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Captures</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Unique users</th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((r: any, i: number) => (
            <tr key={i} className="border-b border-gray-50">
              <td className="py-2 px-3 font-medium">{r.utm_source}</td>
              <td className="py-2 px-3 text-gray-600">{r.utm_campaign || '—'}</td>
              <td className="py-2 px-3 text-right">{r.captures}</td>
              <td className="py-2 px-3 text-right">{r.unique_users}</td>
            </tr>
          ))}
          {(!data?.rows || data.rows.length === 0) && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-gray-400">
                No Play Install Referrer captures yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CohortsTab() {
  const { data, isPending } = useQuery<any[]>({
    queryKey: ['admin', 'acq', 'cohort-quality'],
    queryFn: () => api('/acquisition/cohort-quality?weeks=8'),
  });
  if (isPending) return <div className="mt-4 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 px-3 font-medium text-gray-500">Cohort week</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">Size</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">D1 %</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">D3 %</th>
            <th className="text-right py-2 px-3 font-medium text-gray-500">D7 %</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((r: any) => (
            <tr key={r.cohort_week} className="border-b border-gray-50">
              <td className="py-2 px-3 font-medium">{r.cohort_week}</td>
              <td className="py-2 px-3 text-right">{r.cohort_size}</td>
              <td className="py-2 px-3 text-right">{r.d1_pct}%</td>
              <td className="py-2 px-3 text-right">{r.d3_pct}%</td>
              <td className="py-2 px-3 text-right font-medium">{r.d7_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AcquisitionPage() {
  const [tab, setTab] = useState<Tab>('utm');
  const [days, setDays] = useState<number>(30);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Acquisition</h1>
      <p className="mt-1 text-sm text-gray-500">
        Where new users come from and how well each channel retains.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
          {(['utm', 'geo', 'referrer', 'cohorts'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium capitalize ${
                tab === t ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {t === 'utm' ? 'UTM' : t}
            </button>
          ))}
        </div>

        {tab !== 'cohorts' && (
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
            {[7, 30, 90].map((d) => (
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

      {tab === 'utm' && <UtmTab days={days} />}
      {tab === 'geo' && <GeoTab days={days} />}
      {tab === 'referrer' && <ReferrerTab days={days} />}
      {tab === 'cohorts' && <CohortsTab />}
    </div>
  );
}
