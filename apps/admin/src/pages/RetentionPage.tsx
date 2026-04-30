import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { usePersistedState } from '@/hooks/usePersistedState';

type SourceFilter = 'all' | 'paid' | 'organic';
type RevenueMode = 'theoretical' | 'real';

/**
 * Display helpers — keep them outside the component so they're
 * stable references and don't trigger re-renders just because
 * the parent re-rendered.
 */
function formatCents(cents: number): string {
  if (!Number.isFinite(cents) || cents === 0) return '$0.00';
  const dollars = cents / 100;
  // For sub-dollar values keep two decimals; for whole-dollar
  // amounts the analyst usually wants the full precision too
  // (a CPI of $4.32 vs $4.30 matters for break-even calls).
  return `$${dollars.toFixed(2)}`;
}

/**
 * ROAS in the API is a percentage (e.g. 25.0 means rev = 25% of
 * cost). UI standard is multiplier form ("0.25x" / "1.42x") so
 * marketers can eyeball "did this cohort pay back yet" — anything
 * ≥ 1.00x is profitable.
 */
function formatRoas(pct: number): string {
  const x = pct / 100;
  if (x >= 10) return `${Math.round(x)}x`;
  return `${x.toFixed(2)}x`;
}

interface RoasStripe {
  /** Subtle 1-pixel coloured strip below the retention pct in the cell. */
  background: string;
  /** Tinted text for the ROAS multiplier sitting above the strip. */
  color: string;
}

/**
 * Three-band coloring for ROAS:
 *   red    < 30%   — burning cash
 *   amber  30-99%  — partial recovery, watch
 *   green  ≥ 100%  — paid back, scale signal
 *
 * Returning a structured object instead of just a colour lets us
 * keep the cell hover-state consistent (foreground text colour
 * tracks the stripe so the cell reads as a single unit).
 */
/**
 * Theoretical revenue projection for a single cohort × offset cell:
 *
 *   projected_revenue_cents
 *     = ads_requested / 1000 × CPM_dollars × 100         (rewarded ad arpu)
 *     + offer_plays × payout_cents                        (offerwall arpu)
 *
 * Both ads and offers are CUMULATIVE through end-of-D-N, so the
 * projection rolls up — D7 includes everything D1..D7. Returns
 * cents (rounded) to keep currency math integer-clean downstream.
 */
function projectedRevenueCents(
  adsRequested: number,
  offerPlays: number,
  cpmDollars: number,
  offerPayoutCents: number,
): number {
  const adRevCents = (adsRequested / 1000) * cpmDollars * 100;
  const offerRevCents = offerPlays * offerPayoutCents;
  return Math.round(adRevCents + offerRevCents);
}

/**
 * Theoretical cost = cohort_size × CPI_dollars × 100. Same number
 * for every offset of a given cohort because the CPI input is a
 * single per-install assumption, not a per-day cost curve.
 */
function theoreticalCohortCostCents(cohortSize: number, cpiDollars: number): number {
  return Math.round(cohortSize * cpiDollars * 100);
}

function roasPctToStripe(pct: number | null): RoasStripe {
  if (pct == null) return { background: 'transparent', color: '#9ca3af' };
  if (pct >= 100) return { background: '#16a34a', color: '#15803d' };
  if (pct >= 30) return { background: '#d97706', color: '#b45309' };
  if (pct > 0) return { background: '#dc2626', color: '#991b1b' };
  return { background: '#e5e7eb', color: '#9ca3af' };
}

export function RetentionPage() {
  // Cohort controls survive page refreshes — the previous behaviour
  // (reset to "1,3,7,14,30" every reload) made it impossible to keep
  // a wider window open across deploys, e.g. analysts who care about
  // D60 had to retype it every time the React Query cache was cold.
  const [groupBy, setGroupBy] = usePersistedState<'day' | 'week'>('retention.groupBy', 'day');
  const [weeks, setWeeks] = usePersistedState<number>('retention.weeks', 14);
  const [offsets, setOffsets] = usePersistedState<string>('retention.offsets', '1,3,7,14,30');
  const [country, setCountry] = usePersistedState<string>('retention.country', '');
  const [platform, setPlatform] = usePersistedState<string>('retention.platform', '');
  const [rank, setRank] = usePersistedState<string>('retention.rank', '');
  const [utmSource, setUtmSource] = usePersistedState<string>('retention.utmSource', '');
  // Default = paid because that's where CPI/ROAS are non-trivially
  // useful. Organic users have NULL cost so the new columns degrade
  // to "—" and the analyst loses the headline insight.
  const [sourceFilter, setSourceFilter] = usePersistedState<SourceFilter>('retention.sourceFilter', 'paid');

  // Theoretical mode is the default because real cost data from
  // AppsFlyer→Meta is currently not flowing (integration shows
  // Active but spend syncs at $0.0000). Theoretical mode lets the
  // analyst plug in assumed CPM / offer payout / CPI and see what
  // ROAS this cohort *would* produce — purely client-side math
  // over the real ad.requested + offer_completions counts.
  const [revenueMode, setRevenueMode] = usePersistedState<RevenueMode>('retention.revenueMode', 'theoretical');
  // Three calculator knobs. CPM and CPI are in dollars (UX: those
  // are the units marketers think in); offer payout is in cents
  // because typical reward-app offer payouts are < $1 and we want
  // 1c granularity without fighting floats.
  const [calcCpmDollars, setCalcCpmDollars] = usePersistedState<number>('retention.calc.cpm', 5);
  const [calcOfferPayoutCents, setCalcOfferPayoutCents] = usePersistedState<number>('retention.calc.offer', 30);
  const [calcCpiDollars, setCalcCpiDollars] = usePersistedState<number>('retention.calc.cpi', 0.5);

  const [activeTab, setActiveTab] = useState<'cohorts' | 'segments'>('cohorts');

  const qs = new URLSearchParams({
    weeks: String(weeks),
    group_by: groupBy,
    offsets,
    source_filter: sourceFilter,
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
                <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
                <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                  {(['all', 'paid', 'organic'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setSourceFilter(s)}
                      className={`px-4 py-2 text-sm font-medium capitalize ${sourceFilter === s ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      title={
                        s === 'paid'
                          ? 'Users attributed to a paid campaign (AppsFlyer media_source ≠ Organic). CPI/ROAS columns are populated for this view only.'
                          : s === 'organic'
                            ? 'Users with no campaign attribution. Cost = $0, so CPI/ROAS show "—".'
                            : 'All users regardless of source. CPI/ROAS computed against ALL spend, divided over ALL users — not directly comparable to paid-only.'
                      }
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Revenue mode</label>
                <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                  {(['theoretical', 'real'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setRevenueMode(m)}
                      className={`px-4 py-2 text-sm font-medium capitalize ${revenueMode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      title={
                        m === 'theoretical'
                          ? 'Project revenue from REAL cohort engagement (ads, offers) × your CPM/payout/CPI assumptions. Use while AF→Meta cost sync is still being verified.'
                          : 'Use REAL revenue from events.revenue_cents (ad.revenue/econ.offer_completed/econ.purchase) and REAL cost from ad_costs (AppsFlyer Pull API). Falls back to "—" when cost not synced.'
                      }
                    >
                      {m}
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

          {/* Theoretical-mode calculator card. Hidden when mode=real
              because real-mode draws from events.revenue_cents +
              ad_costs and the inputs become decorative. */}
          {revenueMode === 'theoretical' && cohortData?.cohorts?.length > 0 && (() => {
            // Aggregate projection across the full visible table.
            // We project at the LARGEST visible offset because it
            // captures the most cumulative revenue — analysts use
            // this number to answer "if my assumptions hold, what
            // does the whole window earn?". Smaller offsets would
            // under-state the projection.
            const offsetsList: number[] = cohortData.offsets || [];
            const maxOffset = offsetsList.length > 0 ? Math.max(...offsetsList) : 0;
            let totalProjRev = 0;
            let totalAssumedCost = 0;
            for (const c of cohortData.cohorts) {
              const cell = c.retention?.[maxOffset];
              const ads = cell?.ads_requested ?? 0;
              const offers = cell?.offer_plays ?? 0;
              totalProjRev += projectedRevenueCents(ads, offers, calcCpmDollars, calcOfferPayoutCents);
              totalAssumedCost += theoreticalCohortCostCents(c.cohort_size, calcCpiDollars);
            }
            const aggRoasPct = totalAssumedCost > 0
              ? Math.round((totalProjRev / totalAssumedCost) * 1000) / 10
              : null;
            return (
              <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-[280px]">
                    <div className="text-sm font-semibold text-gray-800">Theoretical revenue calculator</div>
                    <div className="mt-1 text-xs text-gray-500 max-w-md">
                      These are <em>assumptions</em>. Real revenue + cost will replace this once AppsFlyer→Meta cost integration starts syncing spend (status currently shows Active but $0 in the AF dashboard).
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1" title="Theoretical eCPM — revenue earned per 1,000 ad requests. Industry baseline for rewarded video is $5-15.">
                        CPM ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={calcCpmDollars}
                        onChange={e => setCalcCpmDollars(Math.max(0, Number(e.target.value)))}
                        className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1" title="Average payout per UNIQUE offer-play (one user × one offer). 30c is a reasonable mid-market guess for offerwall apps.">
                        Offer payout (¢)
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={calcOfferPayoutCents}
                        onChange={e => setCalcOfferPayoutCents(Math.max(0, Math.round(Number(e.target.value))))}
                        className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1" title="Theoretical Cost Per Install in dollars. Multiply by cohort size to get assumed total spend.">
                        CPI ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={calcCpiDollars}
                        onChange={e => setCalcCpiDollars(Math.max(0, Number(e.target.value)))}
                        className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg bg-white border border-gray-200 px-3 py-2">
                    <div className="text-[11px] text-gray-500">Σ projected revenue (D{maxOffset})</div>
                    <div className="font-semibold text-gray-900 mt-0.5">{formatCents(totalProjRev)}</div>
                  </div>
                  <div className="rounded-lg bg-white border border-gray-200 px-3 py-2">
                    <div className="text-[11px] text-gray-500">Σ assumed cost</div>
                    <div className="font-semibold text-gray-900 mt-0.5">{formatCents(totalAssumedCost)}</div>
                  </div>
                  <div className="rounded-lg bg-white border border-gray-200 px-3 py-2">
                    <div className="text-[11px] text-gray-500">Aggregate ROAS</div>
                    <div className="font-semibold mt-0.5" style={{ color: roasPctToStripe(aggRoasPct).color }}>
                      {aggRoasPct != null ? `${formatRoas(aggRoasPct)} (${aggRoasPct}%)` : '—'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

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
                    <th
                      className="text-right px-3 py-3 font-semibold text-gray-600"
                      title={revenueMode === 'theoretical'
                        ? `Theoretical Cost Per Install — your CPI input ($${calcCpiDollars.toFixed(2)}) applied uniformly to every cohort. Replace with real CPI by switching mode to Real once AF→Meta cost sync is live.`
                        : 'Real Cost Per Install — total ad spend on this cohort\'s day divided by the number of new users in the cohort. Source: AppsFlyer Pull API → ad_costs table. Shows "—" if no spend synced yet.'}
                    >
                      CPI
                    </th>
                    <th
                      className="text-right px-3 py-3 font-semibold text-gray-600"
                      title="Cumulative ad.requested events from cohort users through the largest offset in view. Drives theoretical-mode revenue projection."
                    >
                      Ads
                    </th>
                    <th
                      className="text-right px-3 py-3 font-semibold text-gray-600"
                      title="Cumulative DISTINCT (user, offer) plays through the largest offset in view. One unique offer per user counts once even if they hit multiple milestones on it."
                    >
                      Offers
                    </th>
                    {(cohortData?.offsets || []).map((o: number) => (
                      <th key={o} className="text-center px-3 py-3 font-semibold text-gray-600">
                        <div>{groupBy === 'week' ? `W${o}` : `D${o}`}</div>
                        <div className="text-[10px] font-normal text-gray-400 mt-0.5">retention / {revenueMode === 'theoretical' ? 'proj. ROAS' : 'ROAS'}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const offsetsList: number[] = cohortData?.offsets || [];
                    const totalCols = 5 + offsetsList.length; // Cohort, Users, CPI, Ads, Offers + offsets
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
                          ...extra,
                        });
                        return `/retention/cohort?${p.toString()}`;
                      };
                      return (
                        <tr key={c.cohort_start} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-3 py-2.5 font-medium text-gray-700 sticky left-0 bg-white z-10">
                            {new Date(c.cohort_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: groupBy === 'week' ? '2-digit' : undefined })}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-700 font-semibold">
                            <Link
                              to={baseDrill({ offset: 'all' })}
                              className="hover:underline text-blue-700"
                              title="View all users in this cohort"
                            >
                              {c.cohort_size}
                            </Link>
                          </td>
                          {(() => {
                            // CPI column adapts to mode. In theoretical mode it
                            // renders the calculator's CPI input applied to
                            // every cohort uniformly (single number, no real
                            // data). In real mode it shows ad_costs / cohort_size
                            // and degrades to "—" when spend hasn't synced.
                            if (revenueMode === 'theoretical') {
                              const theoreticalCpiCents = Math.round(calcCpiDollars * 100);
                              return (
                                <td
                                  className="px-3 py-2.5 text-right text-blue-700 font-mono text-xs"
                                  title={`Theoretical CPI from calculator: $${calcCpiDollars.toFixed(2)} × ${c.cohort_size} users = ${formatCents(theoreticalCpiCents * c.cohort_size)} assumed spend on this cohort.`}
                                >
                                  {formatCents(theoreticalCpiCents)}
                                </td>
                              );
                            }
                            return (
                              <td
                                className="px-3 py-2.5 text-right text-gray-700 font-mono text-xs"
                                title={c.cost_cents > 0
                                  ? `Total spend: ${formatCents(c.cost_cents)} / ${c.cohort_size} users`
                                  : 'No cost data — verify AF→Meta cost integration sync (or this is an organic cohort).'}
                              >
                                {c.cpi_cents != null ? formatCents(c.cpi_cents) : <span className="text-gray-300">—</span>}
                              </td>
                            );
                          })()}
                          {/* Ads + Offers columns — cumulative through the largest visible offset. */}
                          <td
                            className="px-3 py-2.5 text-right text-gray-700 font-mono text-xs"
                            title={`Cumulative ad.requested through ${groupBy === 'week' ? 'W' : 'D'}${maxOffset} for this cohort.`}
                          >
                            {(c.retention?.[maxOffset]?.ads_requested ?? 0).toLocaleString()}
                          </td>
                          <td
                            className="px-3 py-2.5 text-right text-gray-700 font-mono text-xs"
                            title={`Cumulative DISTINCT (user, offer) plays through ${groupBy === 'week' ? 'W' : 'D'}${maxOffset} for this cohort.`}
                          >
                            {(c.retention?.[maxOffset]?.offer_plays ?? 0).toLocaleString()}
                          </td>
                          {(cohortData.offsets || []).map((o: number) => {
                            const r = c.retention[o];
                            const pct = r?.pct ?? 0;
                            const count = r?.count || 0;
                            const ads = r?.ads_requested ?? 0;
                            const offers = r?.offer_plays ?? 0;

                            // Per-mode revenue + ROAS:
                            //   real        → rev_cents / roas_pct from API
                            //                 (drawn from events.revenue_cents
                            //                 and ad_costs).
                            //   theoretical → projected on the client from
                            //                 cohort engagement × calculator
                            //                 inputs. Cost is cohort_size × CPI.
                            let revCents: number;
                            let roasPct: number | null;
                            if (revenueMode === 'theoretical') {
                              revCents = projectedRevenueCents(ads, offers, calcCpmDollars, calcOfferPayoutCents);
                              const cost = theoreticalCohortCostCents(c.cohort_size, calcCpiDollars);
                              roasPct = cost > 0 ? Math.round((revCents / cost) * 1000) / 10 : null;
                            } else {
                              revCents = r?.rev_cents || 0;
                              roasPct = (r?.roas_pct as number | null | undefined) ?? null;
                            }

                            const intensity = Math.min(pct / 50, 1);
                            const bg = pct > 0
                              ? `rgba(37, 99, 235, ${intensity * 0.8})`
                              : 'transparent';
                            const color = intensity > 0.5 ? 'white' : '#374151';
                            const isClickable = count > 0;
                            const roasStripe = roasPctToStripe(roasPct);
                            const roasLabel = revenueMode === 'theoretical' ? 'proj. ROAS' : 'ROAS';
                            const cellTitle = `${count} / ${c.cohort_size}`
                              + (roasPct != null ? ` • ${roasLabel} ${formatRoas(roasPct)} (rev ${formatCents(revCents)})` : '');
                            return (
                              <td
                                key={o}
                                className="px-0 py-0 text-center text-xs align-top"
                                style={{ backgroundColor: bg, color }}
                              >
                                {isClickable ? (
                                  <Link
                                    to={baseDrill({ offset: String(o) })}
                                    className="block hover:underline cursor-pointer"
                                    title={cellTitle}
                                    style={{ color }}
                                  >
                                    <div className="px-3 py-1.5 leading-tight font-semibold">{pct}%</div>
                                    <div
                                      className="px-3 pb-1.5 text-[10px] leading-none font-mono"
                                      style={{ color: roasStripe.color, opacity: roasPct != null ? 1 : 0.3 }}
                                    >
                                      {roasPct != null ? formatRoas(roasPct) : '—'}
                                    </div>
                                    <div className="h-1" style={{ background: roasStripe.background }} />
                                  </Link>
                                ) : (
                                  <div className="block" title={cellTitle}>
                                    <div className="px-3 py-1.5 leading-tight">-</div>
                                    <div
                                      className="px-3 pb-1.5 text-[10px] leading-none font-mono"
                                      style={{ color: roasStripe.color, opacity: roasPct != null ? 1 : 0.3 }}
                                    >
                                      {roasPct != null ? formatRoas(roasPct) : ''}
                                    </div>
                                    <div className="h-1" style={{ background: roasStripe.background }} />
                                  </div>
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
            <div className="flex items-center gap-2">
              <span>ROAS stripe:</span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-4 h-1 align-middle" style={{ background: '#dc2626' }} />
                <span>&lt; 30%</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-4 h-1 align-middle" style={{ background: '#d97706' }} />
                <span>30-100%</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-4 h-1 align-middle" style={{ background: '#16a34a' }} />
                <span>≥ 100% (paid back)</span>
              </span>
            </div>
            {sourceFilter !== 'paid' && (
              <span className="text-amber-600">
                CPI/ROAS most meaningful with <strong>Paid</strong> source filter — current view spreads cost across {sourceFilter === 'organic' ? 'organic users (cost=0)' : 'all users'}.
              </span>
            )}
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
