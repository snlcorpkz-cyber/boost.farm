import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';

export function RetentionPage() {
  const [groupBy, setGroupBy] = useState<'day' | 'week'>('day');
  const [weeks, setWeeks] = useState(14);
  const [offsets, setOffsets] = useState('1,3,7,14,30');
  const [country, setCountry] = useState('');
  const [platform, setPlatform] = useState('');
  const [rank, setRank] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [activeTab, setActiveTab] = useState<'cohorts' | 'segments'>('cohorts');

  const qs = new URLSearchParams({
    weeks: String(weeks),
    group_by: groupBy,
    offsets,
    ...(country ? { country } : {}),
    ...(platform ? { platform } : {}),
    ...(rank ? { rank } : {}),
    ...(utmSource ? { utm_source: utmSource } : {}),
  }).toString();

  const { data: cohortData, isPending: cohortsPending } = useQuery({
    queryKey: ['admin', 'retention', 'cohorts', qs],
    queryFn: () => api(`/retention/cohorts?${qs}`),
    enabled: activeTab === 'cohorts',
  });

  const clearFilters = () => {
    setCountry(''); setPlatform(''); setRank(''); setUtmSource('');
  };

  const hasFilters = country || platform || rank || utmSource;

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
                <label className="block text-xs font-medium text-gray-500 mb-1">Cohorts count</label>
                <input type="number" value={weeks} onChange={e => setWeeks(Math.min(20, Math.max(1, Number(e.target.value))))}
                  className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-sm" />
              </div>

              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">Day offsets (comma separated)</label>
                <input value={offsets} onChange={e => setOffsets(e.target.value)}
                  placeholder="1,3,7,14,30"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono" />
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
              </div>
            </div>
          </div>

          {/* Cohort heatmap table */}
          <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10">
                      Cohort ({groupBy})
                    </th>
                    <th className="text-right px-3 py-3 font-semibold text-gray-600">Users</th>
                    {(cohortData?.offsets || []).map((o: number) => (
                      <th key={o} className="text-center px-3 py-3 font-semibold text-gray-600">
                        {groupBy === 'week' ? `W${o}` : `D${o}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cohortsPending ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">Computing cohorts...</td></tr>
                  ) : !cohortData?.cohorts?.length ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No cohort data</td></tr>
                  ) : (
                    cohortData.cohorts.map((c: any) => (
                      <tr key={c.cohort_start} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-2.5 font-medium text-gray-700 sticky left-0 bg-white z-10">
                          {new Date(c.cohort_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: groupBy === 'week' ? '2-digit' : undefined })}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-700 font-semibold">{c.cohort_size}</td>
                        {(cohortData.offsets || []).map((o: number) => {
                          const r = c.retention[o];
                          const pct = r?.pct ?? 0;
                          const intensity = Math.min(pct / 50, 1);
                          const bg = pct > 0
                            ? `rgba(37, 99, 235, ${intensity * 0.8})`
                            : 'transparent';
                          const color = intensity > 0.5 ? 'white' : '#374151';
                          return (
                            <td key={o} className="px-3 py-2.5 text-center text-xs"
                              style={{ backgroundColor: bg, color }}
                              title={`${r?.count || 0} / ${c.cohort_size}`}
                            >
                              {pct > 0 ? `${pct}%` : '-'}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
            <span>Retention:</span>
            <div className="flex gap-0">
              <div className="w-6 h-4 bg-blue-100"></div>
              <div className="w-6 h-4" style={{ background: 'rgba(37, 99, 235, 0.3)' }}></div>
              <div className="w-6 h-4" style={{ background: 'rgba(37, 99, 235, 0.5)' }}></div>
              <div className="w-6 h-4" style={{ background: 'rgba(37, 99, 235, 0.8)' }}></div>
            </div>
            <span>low → high</span>
          </div>
        </>
      )}

      {activeTab === 'segments' && <SegmentsView />}
    </div>
  );
}

function SegmentsView() {
  const [dimension, setDimension] = useState<'country' | 'platform' | 'utm_source'>('country');
  const { data, isPending } = useQuery({
    queryKey: ['admin', 'retention', 'segments', dimension],
    queryFn: () => api(`/retention/segments?dimension=${dimension}`),
  });

  return (
    <div className="mt-6">
      <div className="flex gap-2 mb-4">
        {(['country', 'platform', 'utm_source'] as const).map(d => (
          <button
            key={d}
            onClick={() => setDimension(d)}
            className={`px-4 py-2 text-sm font-medium rounded-lg ${
              dimension === d ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {d === 'utm_source' ? 'UTM Source' : d.charAt(0).toUpperCase() + d.slice(1)}
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
