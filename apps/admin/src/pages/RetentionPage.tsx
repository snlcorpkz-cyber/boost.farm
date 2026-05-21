import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { usePersistedState } from '@/hooks/usePersistedState';

type SourceFilter = 'all' | 'paid' | 'organic';

/**
 * Quick presets for "how many cohorts back to show". 365 = "all time"
 * (capped by however much history we actually have in `users`).
 * Order matters — rendered as buttons left-to-right.
 */
const COHORT_PRESETS: ReadonlyArray<{ value: number; label: string; title: string }> = [
  { value: 7, label: '7', title: 'Last 7 buckets' },
  { value: 30, label: '30', title: 'Last 30 buckets' },
  { value: 90, label: '90', title: 'Last 90 buckets' },
  { value: 365, label: 'All', title: 'Show every cohort we have (capped at 365)' },
];

export function RetentionPage() {
  // Cohort controls survive page refreshes — analysts who care about
  // D60 / D90 retention shouldn't have to retype the offsets after
  // every deploy.
  const [groupBy, setGroupBy] = usePersistedState<'day' | 'week'>('retention.groupBy', 'day');
  const [weeks, setWeeks] = usePersistedState<number>('retention.weeks', 30);
  const [offsets, setOffsets] = usePersistedState<string>('retention.offsets', '1,3,7,14,30');
  const [country, setCountry] = usePersistedState<string>('retention.country', '');
  const [platform, setPlatform] = usePersistedState<string>('retention.platform', '');
  const [rank, setRank] = usePersistedState<string>('retention.rank', '');
  const [utmSource, setUtmSource] = usePersistedState<string>('retention.utmSource', '');
  // Acquisition-partner filter: '' (no filter) / 'organic' / 'any' /
  // <partner-uuid>. Persisted alongside the other cohort filters so
  // a "TimeBucks only" view survives page reloads.
  const [partnerId, setPartnerId] = usePersistedState<string>('retention.partnerId', '');
  const [sourceFilter, setSourceFilter] = usePersistedState<SourceFilter>('retention.sourceFilter', 'all');
  const [activeTab, setActiveTab] = useState<'cohorts' | 'segments'>('cohorts');

  // Partner list for the Partner dropdown — same shape as UsersPage.
  const { data: partnersData } = useQuery<{ partners: Array<{ id: string; name: string; slug: string }> }>({
    queryKey: ['admin', 'partners', 'list-for-filter'],
    queryFn: () => api('/partners'),
    staleTime: 60_000,
  });
  const partners = partnersData?.partners ?? [];

  const qs = new URLSearchParams({
    weeks: String(weeks),
    group_by: groupBy,
    offsets,
    source_filter: sourceFilter,
    ...(country ? { country } : {}),
    ...(platform ? { platform } : {}),
    ...(rank ? { rank } : {}),
    ...(utmSource ? { utm_source: utmSource } : {}),
    ...(partnerId ? { partner_id: partnerId } : {}),
  }).toString();

  const { data: cohortData, isPending: cohortsPending } = useQuery({
    queryKey: ['admin', 'retention', 'cohorts', qs],
    queryFn: () => api(`/retention/cohorts?${qs}`),
    enabled: activeTab === 'cohorts',
  });

  const clearFilters = () => {
    setCountry(''); setPlatform(''); setRank(''); setUtmSource(''); setPartnerId('');
  };

  const hasFilters = country || platform || rank || utmSource || partnerId;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Retention</h1>
      <p className="mt-1 text-sm text-gray-500">Cohort retention analysis — track how users come back</p>

      <div className="mt-4 flex gap-2 border-b border-gray-200">
        {(['cohorts', 'segments'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'cohorts' ? 'Cohort Table' : 'By Segment'}
          </button>
        ))}
      </div>

      {activeTab === 'cohorts' && (
        <>
          {/* Controls */}
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
                <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                  {(['all', 'paid', 'organic'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setSourceFilter(s)}
                      className={`px-4 py-2 text-sm font-medium capitalize ${sourceFilter === s ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      title={
                        s === 'paid'
                          ? 'Users attributed to a paid campaign (AppsFlyer media_source ≠ Organic).'
                          : s === 'organic'
                            ? 'Users with no campaign attribution.'
                            : 'All users regardless of source.'
                      }
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Group by</label>
                <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                  {(['day', 'week'] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => setGroupBy(g)}
                      className={`px-4 py-2 text-sm font-medium ${groupBy === g ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      {g === 'day' ? 'Day' : 'Week'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Cohorts back ({groupBy === 'week' ? 'weeks' : 'days'})
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={weeks}
                    onChange={e => setWeeks(Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-sm"
                  />
                  <div className="flex gap-1">
                    {COHORT_PRESETS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => setWeeks(p.value)}
                        className={`px-2.5 py-2 text-xs font-medium rounded ${weeks === p.value ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                        title={p.title}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">Day offsets (comma separated)</label>
                <input
                  value={offsets}
                  onChange={e => setOffsets(e.target.value)}
                  placeholder="1,3,7,14,30"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>

            {/* Segment filters */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-600">Filter cohort by segment</span>
                {hasFilters && (
                  <button onClick={clearFilters} className="text-xs text-red-500 hover:text-red-700">Clear filters</button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Country</label>
                  <input value={country} onChange={e => setCountry(e.target.value)} placeholder="e.g. KZ"
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Platform</label>
                  <select value={platform} onChange={e => setPlatform(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="">Any</option>
                    <option value="android">Android</option>
                    <option value="web">Web</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Rank</label>
                  <select value={rank} onChange={e => setRank(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="">Any</option>
                    <option value="novice">Novice</option>
                    <option value="amateur">Amateur</option>
                    <option value="farmer">Farmer</option>
                    <option value="master">Master</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">UTM Source</label>
                  <input value={utmSource} onChange={e => setUtmSource(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Partner</label>
                  <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    title="Acquisition source (organic / partner)">
                    <option value="">All sources</option>
                    <option value="organic">Organic only</option>
                    <option value="any">Any partner</option>
                    {partners.length > 0 && (
                      <optgroup label="Specific partner">
                        {partners.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Cohort heatmap table — horizontally scrollable when many
              offsets don't fit. `min-w-max` on the inner table forces
              it to expand past the viewport so the `overflow-x-auto`
              wrapper actually paints a scrollbar (the previous
              `min-w-full` would shrink columns instead, hiding the
              scroll). */}
          <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-max text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 whitespace-nowrap">
                      Cohort ({groupBy})
                    </th>
                    <th className="text-right px-3 py-3 font-semibold text-gray-600 whitespace-nowrap">Users</th>
                    <th
                      className="text-right px-3 py-3 font-semibold text-gray-600 whitespace-nowrap"
                      title="Cumulative ad.requested events from cohort users through the largest visible offset."
                    >
                      Ads
                    </th>
                    <th
                      className="text-right px-3 py-3 font-semibold text-gray-600 whitespace-nowrap"
                      title="Cumulative DISTINCT (user, offer) plays through the largest visible offset."
                    >
                      Offers
                    </th>
                    {(cohortData?.offsets || []).map((o: number) => (
                      <th key={o} className="text-center px-3 py-3 font-semibold text-gray-600 whitespace-nowrap">
                        {groupBy === 'week' ? `W${o}` : `D${o}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const offsetsList: number[] = cohortData?.offsets || [];
                    const totalCols = 4 + offsetsList.length; // Cohort, Users, Ads, Offers + offsets
                    const maxOffset = offsetsList.length > 0 ? Math.max(...offsetsList) : 0;
                    if (cohortsPending) {
                      return <tr><td colSpan={totalCols} className="px-4 py-8 text-center text-gray-500">Computing cohorts...</td></tr>;
                    }
                    if (!cohortData?.cohorts?.length) {
                      return <tr><td colSpan={totalCols} className="px-4 py-8 text-center text-gray-500">No cohort data</td></tr>;
                    }
                    return cohortData.cohorts.map((c: any) => {
                      // Filters propagate into the drill-down URL so the
                      // per-cell user list matches what was counted on
                      // the cohort row (same country/platform/rank/utm).
                      const baseDrill = (extra: Record<string, string>) => {
                        const p = new URLSearchParams({
                          date: String(c.cohort_start).slice(0, 10),
                          group_by: groupBy,
                          ...(country ? { country } : {}),
                          ...(platform ? { platform } : {}),
                          ...(rank ? { rank } : {}),
                          ...(utmSource ? { utm_source: utmSource } : {}),
                          ...(partnerId ? { partner_id: partnerId } : {}),
                          ...extra,
                        });
                        return `/retention/cohort?${p.toString()}`;
                      };
                      return (
                        <tr key={c.cohort_start} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-3 py-2.5 font-medium text-gray-700 sticky left-0 bg-white z-10 whitespace-nowrap">
                            {new Date(c.cohort_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: groupBy === 'week' ? '2-digit' : undefined })}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-700 font-semibold whitespace-nowrap">
                            <Link
                              to={baseDrill({ offset: 'all' })}
                              className="hover:underline text-blue-700"
                              title="View all users in this cohort"
                            >
                              {c.cohort_size}
                            </Link>
                          </td>
                          <td
                            className="px-3 py-2.5 text-right text-gray-700 font-mono text-xs whitespace-nowrap"
                            title={`Cumulative ad.requested through ${groupBy === 'week' ? 'W' : 'D'}${maxOffset} for this cohort.`}
                          >
                            {(c.retention?.[maxOffset]?.ads_requested ?? 0).toLocaleString()}
                          </td>
                          <td
                            className="px-3 py-2.5 text-right text-gray-700 font-mono text-xs whitespace-nowrap"
                            title={`Cumulative DISTINCT (user, offer) plays through ${groupBy === 'week' ? 'W' : 'D'}${maxOffset} for this cohort.`}
                          >
                            {(c.retention?.[maxOffset]?.offer_plays ?? 0).toLocaleString()}
                          </td>
                          {(cohortData.offsets || []).map((o: number) => {
                            const r = c.retention[o];
                            const pct = r?.pct ?? 0;
                            const count = r?.count || 0;
                            const intensity = Math.min(pct / 50, 1);
                            const bg = pct > 0 ? `rgba(37, 99, 235, ${intensity * 0.8})` : 'transparent';
                            const color = intensity > 0.5 ? 'white' : '#374151';
                            const isClickable = count > 0;
                            const cellTitle = `${count} / ${c.cohort_size}`;
                            return (
                              <td
                                key={o}
                                className="px-0 py-0 text-center text-xs align-middle whitespace-nowrap"
                                style={{ backgroundColor: bg, color }}
                              >
                                {isClickable ? (
                                  <Link
                                    to={baseDrill({ offset: String(o) })}
                                    className="block hover:underline cursor-pointer px-3 py-2.5 font-semibold"
                                    title={cellTitle}
                                    style={{ color }}
                                  >
                                    {pct}%
                                  </Link>
                                ) : (
                                  <div className="px-3 py-2.5" title={cellTitle}>-</div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <span>Retention:</span>
              <div className="flex gap-0">
                <div className="w-6 h-4 bg-blue-100"></div>
                <div className="w-6 h-4" style={{ background: 'rgba(37, 99, 235, 0.3)' }}></div>
                <div className="w-6 h-4" style={{ background: 'rgba(37, 99, 235, 0.5)' }}></div>
                <div className="w-6 h-4" style={{ background: 'rgba(37, 99, 235, 0.8)' }}></div>
              </div>
              <span>low → high</span>
            </div>
            <span className="text-gray-400">Click any cohort row or cell to drill into the user list.</span>
          </div>
        </>
      )}

      {activeTab === 'segments' && <SegmentsView />}
    </div>
  );
}

function SegmentsView() {
  const [dimension, setDimension] = useState<'country' | 'platform' | 'utm_source' | 'partner'>('country');
  const { data, isPending } = useQuery({
    queryKey: ['admin', 'retention', 'segments', dimension],
    queryFn: () => api(`/retention/segments?dimension=${dimension}`),
  });

  // Pretty labels — keep in sync with backend dim allow-list (admin/retention.ts).
  const dimLabels: Record<typeof dimension, string> = {
    country: 'Country',
    platform: 'Platform',
    utm_source: 'UTM Source',
    partner: 'Partner',
  };

  return (
    <div className="mt-6">
      <div className="flex gap-2 mb-4">
        {(['country', 'platform', 'utm_source', 'partner'] as const).map(d => (
          <button
            key={d}
            onClick={() => setDimension(d)}
            className={`px-4 py-2 text-sm font-medium rounded-lg ${
              dimension === d ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {dimLabels[d]}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Segment</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">Users</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">D1</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">D1 %</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">D7</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">D7 %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isPending ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : !data?.segments?.length ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No data</td></tr>
            ) : (
              data.segments.map((s: any) => (
                <tr key={s.segment} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{s.segment}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{s.total_users}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{s.d1_count}</td>
                  <td className="px-4 py-2.5 text-right font-bold">
                    <span className={s.d1_pct >= 30 ? 'text-green-600' : s.d1_pct >= 15 ? 'text-amber-600' : 'text-red-500'}>
                      {s.d1_pct}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{s.d7_count}</td>
                  <td className="px-4 py-2.5 text-right font-bold">
                    <span className={s.d7_pct >= 15 ? 'text-green-600' : s.d7_pct >= 7 ? 'text-amber-600' : 'text-red-500'}>
                      {s.d7_pct}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
