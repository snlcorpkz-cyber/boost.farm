import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/**
 * Unit-economics aggregator. Walks every cohort × every offset
 * we have data for and produces the totals the panel renders.
 *
 * `atOffset` is the "snapshot day" — usually the largest visible
 * offset, since LTV / payback math wants the freshest cumulative
 * figure. For payback we instead iterate the full offsets array
 * separately (see `findPaybackOffset`).
 *
 * Defensive against missing cells (sparse data on young cohorts):
 * a cohort that has no entry for `atOffset` contributes its
 * cohort_size and cost but zero engagement / revenue. This is the
 * mathematically honest read — pretending those users had average
 * activity would inflate the result.
 */
interface UnitEconAggregates {
  totalUsers: number;
  totalCostCents: number;
  totalAds: number;
  totalOfferPlays: number;
  totalRevCents: number;
  /**
   * Sum of retained users across every visible offset for the
   * cohort window. Approximates "active user-days" when divided
   * across the offset gaps — used as the ARPDAU denominator.
   */
  totalRetainedAcrossOffsets: number;
  /**
   * Span of days the offset list covers (max offset). Used as the
   * "lifetime so far" horizon for ARPDAU and LTV.
   */
  windowDays: number;
}

function aggregateAcrossCohorts(cohortData: any, atOffset: number, offsetsList: number[]): UnitEconAggregates {
  let totalUsers = 0;
  let totalCostCents = 0;
  let totalAds = 0;
  let totalOfferPlays = 0;
  let totalRevCents = 0;
  let totalRetainedAcrossOffsets = 0;
  for (const c of cohortData?.cohorts ?? []) {
    totalUsers += c.cohort_size ?? 0;
    totalCostCents += c.cost_cents ?? 0;
    const cell = c.retention?.[atOffset];
    if (cell) {
      totalAds += cell.ads_requested ?? 0;
      totalOfferPlays += cell.offer_plays ?? 0;
      totalRevCents += cell.rev_cents ?? 0;
    }
    for (const o of offsetsList) {
      totalRetainedAcrossOffsets += c.retention?.[o]?.count ?? 0;
    }
  }
  return {
    totalUsers,
    totalCostCents,
    totalAds,
    totalOfferPlays,
    totalRevCents,
    totalRetainedAcrossOffsets,
    windowDays: atOffset,
  };
}

/**
 * Approximate active user-days over the cohort window via
 * trapezoidal integration of the retention curve. For offsets
 * [0, 1, 3, 7, 14, 30] and retained counts [N0=cohort_size, N1,
 * N3, N7, N14, N30]:
 *
 *   AUD ≈ Σ (gap_i × (N_{i-1} + N_i) / 2)
 *
 * It's an approximation — we only know the curve at the explicit
 * offsets, so days in between are assumed to interpolate
 * linearly. Good enough for ARPDAU back-of-envelope; if the
 * operator needs precision they can add D2/D5/D10 etc to the
 * offsets input.
 */
function approxActiveUserDays(cohortData: any, offsetsList: number[]): number {
  let aud = 0;
  for (const c of cohortData?.cohorts ?? []) {
    const sortedOffsets = [0, ...offsetsList].slice().sort((a, b) => a - b);
    let prevOffset = 0;
    let prevCount = c.cohort_size ?? 0;
    for (let i = 1; i < sortedOffsets.length; i++) {
      const o = sortedOffsets[i];
      const cnt = c.retention?.[o]?.count ?? 0;
      const gap = o - prevOffset;
      aud += gap * ((prevCount + cnt) / 2);
      prevOffset = o;
      prevCount = cnt;
    }
  }
  return aud;
}

/** Format a multiplier "0.45x" / "1.20x" / "12x". */
function formatMultiplier(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (x >= 10) return `${Math.round(x)}x`;
  return `${x.toFixed(2)}x`;
}

/** "+18%" / "−42%" — used for the Real vs Hypothesis delta column. */
function formatDeltaPct(realVal: number, hypoVal: number): { text: string; color: string } {
  if (!Number.isFinite(realVal) || !Number.isFinite(hypoVal) || hypoVal === 0) {
    return { text: '—', color: '#9ca3af' };
  }
  const diff = ((realVal - hypoVal) / Math.abs(hypoVal)) * 100;
  const sign = diff >= 0 ? '+' : '−';
  const text = `${sign}${Math.abs(diff).toFixed(0)}%`;
  // For revenue/LTV: real > hypo is good (green). For cost/CPI:
  // real > hypo is bad (red). Caller decides which polarity to
  // pass — we just colour by sign relative to a preference flag.
  return { text, color: diff >= 0 ? '#16a34a' : '#dc2626' };
}

/**
 * "5m ago" / "2h ago" / "3d ago" relative formatting for the
 * cost-pull last-ingested-at timestamp. We deliberately avoid
 * pulling a date library for this one place — the formatter is
 * 8 lines and the result is human-readable enough for ops.
 */
function relativeTimeFromIso(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';
  const diff = Date.now() - then;
  if (diff < 0) return 'in the future';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ${hr % 24}h ago`;
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

  // Cost-pull status (worker health + freshness). Polled every 30s
  // so the timestamp the operator sees is reasonably current
  // without being chatty. Errors fall back to a static "unknown"
  // rather than fetching forever — the UI panel reads `data ?? {}`.
  const queryClient = useQueryClient();
  const { data: costPullStatus } = useQuery({
    queryKey: ['admin', 'jobs', 'af-cost-pull', 'status'],
    queryFn: () => api('/jobs/af-cost-pull/status'),
    enabled: activeTab === 'cohorts',
    refetchInterval: 30_000,
  });

  // Manual cost-pull trigger. The `truncate_range` flag is exposed
  // as a separate code path so the operator can pick "just refresh
  // (additive)" vs "wipe & re-pull (post-TZ recovery)" — these have
  // different blast radii and shouldn't be a single button.
  const costPullMutation = useMutation({
    mutationFn: (truncateRange: boolean) =>
      api('/jobs/af-cost-pull', { method: 'POST', body: { truncate_range: truncateRange } }),
    onSuccess: () => {
      // Status panel + cohort table both depend on ad_costs — bust
      // both caches so the operator sees the new data immediately.
      queryClient.invalidateQueries({ queryKey: ['admin', 'jobs', 'af-cost-pull', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'retention', 'cohorts'] });
    },
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

          {/* Cost-data sync panel — shows AppsFlyer Pull worker
              health and lets the operator force an immediate
              re-pull without SSHing into the API container. The
              "Refresh + retruncate" path additionally wipes the
              14-day window in `ad_costs` first, used after a TZ
              change so orphan rows under the now-invalid cost_date
              can't bias sums. */}
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cost sync</span>
              {(() => {
                const status = costPullStatus as { enabled?: boolean; configured?: boolean; last_ingested_at?: string | null; total_rows?: number; table_error?: string } | undefined;
                if (!status) return <span className="text-gray-400">checking…</span>;
                if (status.table_error) {
                  return <span className="text-red-600 text-xs">ad_costs missing — apply migration 026</span>;
                }
                if (!status.enabled) {
                  return <span className="text-amber-600 text-xs">worker disabled (set AF_COST_PULL_ENABLED + APPSFLYER_PULL_API_TOKEN, then restart API)</span>;
                }
                return (
                  <span className="text-gray-700">
                    last sync <strong>{relativeTimeFromIso(status.last_ingested_at)}</strong>
                    {typeof status.total_rows === 'number' && status.total_rows > 0 && (
                      <span className="text-gray-400 ml-2">· {status.total_rows.toLocaleString()} rows</span>
                    )}
                  </span>
                );
              })()}
            </div>
            <div className="flex items-center gap-2">
              {costPullMutation.isPending && (
                <span className="text-xs text-blue-600 animate-pulse">pulling from AppsFlyer…</span>
              )}
              {costPullMutation.isError && (
                <span className="text-xs text-red-600" title={(costPullMutation.error as Error)?.message}>
                  failed: {(costPullMutation.error as Error)?.message?.slice(0, 60)}
                </span>
              )}
              {costPullMutation.isSuccess && !costPullMutation.isPending && (() => {
                const r = (costPullMutation.data as { result?: { fetched: number; upserted: number; zeroCost: boolean } } | undefined)?.result;
                if (!r) return null;
                return (
                  <span className="text-xs text-green-700">
                    {r.zeroCost
                      ? `pulled ${r.fetched} rows, all spend=0 (Meta integration not synced)`
                      : `pulled ${r.upserted}/${r.fetched} rows`}
                  </span>
                );
              })()}
              <button
                onClick={() => costPullMutation.mutate(false)}
                disabled={costPullMutation.isPending}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                title="Pull the last 14 days from AppsFlyer and UPSERT into ad_costs. Safe to click — additive only, never deletes."
              >
                Refresh now
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Wipe the last 14 days of ad_costs and re-pull from AppsFlyer? Use this after switching the AF Pull API timezone — old rows under the previous timezone will leave orphans otherwise.')) {
                    costPullMutation.mutate(true);
                  }
                }}
                disabled={costPullMutation.isPending}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                title="DELETE every row in ad_costs whose cost_date is within the last 14 days, then re-pull. Required after a timezone shift to clear orphan rows under the old cost_date."
              >
                Refresh + retruncate
              </button>
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

          {/* Unit Economics — Real vs Hypothesis side-by-side. The
              entire panel is a pure derivation from `cohortData` +
              the calculator inputs already in scope; no new API
              call. We hide it when there are no cohorts (avoids
              showing nonsense like "ARPU = NaN" on an empty
              dataset) and surface a one-line warning when source
              filter is "all" since LTV/CAC is only meaningful
              against paid acquisition spend. */}
          {cohortData?.cohorts?.length > 0 && (() => {
            const offsetsList: number[] = cohortData.offsets ?? [];
            const maxOffset = offsetsList.length > 0 ? Math.max(...offsetsList) : 0;

            const agg = aggregateAcrossCohorts(cohortData, maxOffset, offsetsList);
            const aud = approxActiveUserDays(cohortData, offsetsList);

            // ── REAL metrics (drawn from observed engagement & cost) ──
            const realCpiCents = agg.totalUsers > 0 && agg.totalCostCents > 0
              ? agg.totalCostCents / agg.totalUsers
              : null;
            const adsPerUser = agg.totalUsers > 0 ? agg.totalAds / agg.totalUsers : 0;
            const offerPlaysPerUser = agg.totalUsers > 0 ? agg.totalOfferPlays / agg.totalUsers : 0;
            const realArpuCents = agg.totalUsers > 0 ? agg.totalRevCents / agg.totalUsers : 0;
            const realArpdauCents = aud > 0 ? agg.totalRevCents / aud : 0;
            const realLtvCents = realArpuCents; // cumulative ARPU at max offset = LTV(N)
            const realLtvCac = realCpiCents != null && realCpiCents > 0
              ? realLtvCents / realCpiCents
              : null;
            // First offset at which cumulative real revenue per
            // install matches CPI. Walks every visible offset in
            // order and returns the smallest hit; null when the
            // window doesn't cover payback yet (UI shows "> Dmax").
            const realPaybackOffsetClean = (() => {
              if (realCpiCents == null || realCpiCents <= 0) return null;
              for (const o of offsetsList.slice().sort((a, b) => a - b)) {
                let users = 0;
                let revSum = 0;
                for (const c of cohortData.cohorts) {
                  users += c.cohort_size ?? 0;
                  revSum += c.retention?.[o]?.rev_cents ?? 0;
                }
                if (users > 0 && revSum / users >= realCpiCents) return o;
              }
              return null;
            })();

            // ── HYPOTHESIS metrics (calculator inputs × real engagement) ──
            // Important: hypothesis revenue is computed against
            // the REAL ad/offer engagement counts, not made up
            // from thin air. The "what if" is purely on the
            // monetisation lever (CPM, payout) — NOT on whether
            // users played any ads at all. This keeps the
            // hypothesis grounded in actual product behaviour.
            const hypoCpiCents = Math.round(calcCpiDollars * 100);
            const hypoTotalCostCents = agg.totalUsers * hypoCpiCents;
            const hypoAdRevCents = (agg.totalAds / 1000) * calcCpmDollars * 100;
            const hypoOfferRevCents = agg.totalOfferPlays * calcOfferPayoutCents;
            const hypoTotalRevCents = Math.round(hypoAdRevCents + hypoOfferRevCents);
            const hypoArpuCents = agg.totalUsers > 0 ? hypoTotalRevCents / agg.totalUsers : 0;
            const hypoArpdauCents = aud > 0 ? hypoTotalRevCents / aud : 0;
            const hypoLtvCents = hypoArpuCents;
            const hypoLtvCac = hypoCpiCents > 0 ? hypoLtvCents / hypoCpiCents : null;
            const hypoPaybackOffset = (() => {
              if (hypoCpiCents <= 0) return null;
              for (const o of offsetsList.slice().sort((a, b) => a - b)) {
                let users = 0;
                let projRev = 0;
                for (const c of cohortData.cohorts) {
                  users += c.cohort_size ?? 0;
                  const cell = c.retention?.[o];
                  if (!cell) continue;
                  const ads = cell.ads_requested ?? 0;
                  const offers = cell.offer_plays ?? 0;
                  projRev += projectedRevenueCents(ads, offers, calcCpmDollars, calcOfferPayoutCents);
                }
                if (users > 0 && projRev / users >= hypoCpiCents) return o;
              }
              return null;
            })();

            // Verdict colours/labels — simple bands per industry
            // convention. < 1.0 = unprofitable, 1.0-3.0 = marginal,
            // ≥ 3.0 = healthy. Surfaced in the headline card so
            // operators can read the page in 2 seconds.
            const verdictForRatio = (ratio: number | null): { label: string; color: string; bg: string } => {
              if (ratio == null) return { label: 'no data', color: '#6b7280', bg: '#f3f4f6' };
              if (ratio >= 3) return { label: 'healthy', color: '#15803d', bg: '#dcfce7' };
              if (ratio >= 1) return { label: 'marginal', color: '#b45309', bg: '#fef3c7' };
              return { label: 'unprofitable', color: '#991b1b', bg: '#fee2e2' };
            };
            const realVerdict = verdictForRatio(realLtvCac);
            const hypoVerdict = verdictForRatio(hypoLtvCac);

            // Row helper to keep the JSX scannable.
            const Row = ({
              label,
              real,
              hypo,
              tooltip,
              deltaSign,
              hideHypo,
            }: {
              label: string;
              real: string;
              hypo: string;
              tooltip?: string;
              /** 'higher_is_better' (revenue, LTV) or 'lower_is_better' (cost, CPI). */
              deltaSign?: 'higher_is_better' | 'lower_is_better';
              hideHypo?: boolean;
            }) => {
              // Parse leading numbers out of the formatted strings
              // for the delta calculation. Cheap & cheerful — every
              // formatted real/hypo string here starts with a
              // currency / multiplier / count value the regex can
              // pick up.
              const parseNum = (s: string): number => {
                const m = s.match(/-?\d[\d,]*(?:\.\d+)?/);
                return m ? Number(m[0].replace(/,/g, '')) : NaN;
              };
              const r = parseNum(real);
              const h = parseNum(hypo);
              const delta = (!hideHypo && deltaSign && Number.isFinite(r) && Number.isFinite(h))
                ? formatDeltaPct(r, h)
                : null;
              // Invert colour when lower-is-better (e.g. CPI: real
              // higher than hypothesis is BAD for us, render red).
              const deltaColor = delta && deltaSign === 'lower_is_better'
                ? (delta.text.startsWith('+') ? '#dc2626' : '#16a34a')
                : delta?.color;
              return (
                <tr className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-700" title={tooltip}>{label}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-900">{real}</td>
                  <td className="px-3 py-2 text-right font-mono text-blue-700">{hideHypo ? '—' : hypo}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs" style={{ color: deltaColor ?? '#9ca3af' }}>
                    {delta?.text ?? '—'}
                  </td>
                </tr>
              );
            };

            return (
              <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-semibold text-gray-800">Unit Economics</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Cohort window: {cohortData.cohorts.length} cohorts, snapshot at {groupBy === 'week' ? 'W' : 'D'}{maxOffset}
                      {sourceFilter !== 'paid' && (
                        <span className="ml-2 text-amber-600">
                          (Source = {sourceFilter} — LTV/CAC is most meaningful with Paid filter)
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Verdict cards — at-a-glance "are we profitable?". */}
                  <div className="flex gap-2">
                    <div className="rounded-lg px-3 py-2 text-xs font-medium" style={{ background: realVerdict.bg, color: realVerdict.color }} title="Verdict for the REAL LTV / CAC ratio. ≥3.0 healthy; 1-3 marginal; <1 unprofitable.">
                      Real {formatMultiplier(realLtvCac ?? NaN)} <span className="opacity-70">· {realVerdict.label}</span>
                    </div>
                    <div className="rounded-lg px-3 py-2 text-xs font-medium" style={{ background: hypoVerdict.bg, color: hypoVerdict.color }} title="Verdict for the HYPOTHESIS LTV / CAC ratio (your calculator inputs). Same bands.">
                      Hypothesis {formatMultiplier(hypoLtvCac ?? NaN)} <span className="opacity-70">· {hypoVerdict.label}</span>
                    </div>
                  </div>
                </div>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-white">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Metric</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Real</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-blue-600 uppercase tracking-wide">Hypothesis</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide" title="Real vs hypothesis (% diff). Green = real is better than your assumption; red = real is worse.">Δ vs hypo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Row
                      label="Users in window"
                      real={agg.totalUsers.toLocaleString()}
                      hypo={agg.totalUsers.toLocaleString()}
                      tooltip="Sum of cohort_size across the visible cohorts. Same number used as both real and hypothesis denominator."
                    />
                    <Row
                      label="Total spend"
                      real={formatCents(agg.totalCostCents)}
                      hypo={formatCents(hypoTotalCostCents)}
                      tooltip="Real = sum of ad_costs.spend for cohort dates (Source filter applied). Hypothesis = users × CPI input."
                      deltaSign="lower_is_better"
                    />
                    <Row
                      label="CPI (cost per install)"
                      real={realCpiCents != null ? formatCents(realCpiCents) : '—'}
                      hypo={formatCents(hypoCpiCents)}
                      tooltip="Real = total spend / total users. Hypothesis = your CPI input. Lower is better — green when real beats your assumption."
                      deltaSign="lower_is_better"
                    />
                    <Row
                      label="Avg ad requests / user"
                      real={adsPerUser.toFixed(1)}
                      hypo=""
                      hideHypo
                      tooltip="Cumulative ad.requested events through D{max} divided by cohort size. Pure engagement metric — no hypothesis variant because we don't speculate about user behaviour, only monetisation rates."
                    />
                    <Row
                      label="Avg unique offer plays / user"
                      real={offerPlaysPerUser.toFixed(2)}
                      hypo=""
                      hideHypo
                      tooltip="DISTINCT (user, offer) plays through D{max} / cohort size. Multiple postbacks for the same user×offer count once — matches what we'd actually monetise."
                    />
                    <Row
                      label={`Total revenue (${groupBy === 'week' ? 'W' : 'D'}${maxOffset})`}
                      real={formatCents(agg.totalRevCents)}
                      hypo={formatCents(hypoTotalRevCents)}
                      tooltip="Real = sum of events.revenue_cents for ad.revenue + econ.offer_completed + econ.purchase. Hypothesis = (ads/1000 × CPM × 100) + (offer_plays × payout_cents)."
                      deltaSign="higher_is_better"
                    />
                    <Row
                      label={`ARPU (${groupBy === 'week' ? 'W' : 'D'}${maxOffset})`}
                      real={formatCents(realArpuCents)}
                      hypo={formatCents(hypoArpuCents)}
                      tooltip="Average revenue per user across the cohort window. = total_revenue / total_users."
                      deltaSign="higher_is_better"
                    />
                    <Row
                      label="ARPDAU (avg)"
                      real={formatCents(realArpdauCents)}
                      hypo={formatCents(hypoArpdauCents)}
                      tooltip="Daily average. Approximates active user-days via trapezoidal interpolation of the retention curve at the offsets you have selected. For higher precision, add more offsets (e.g. 2,5,10) to the offsets input."
                      deltaSign="higher_is_better"
                    />
                    <Row
                      label={`LTV / install (${groupBy === 'week' ? 'W' : 'D'}${maxOffset})`}
                      real={formatCents(realLtvCents)}
                      hypo={formatCents(hypoLtvCents)}
                      tooltip="Equal to cumulative ARPU at the snapshot offset. The longer your offsets window, the closer this gets to true lifetime value."
                      deltaSign="higher_is_better"
                    />
                    <Row
                      label="LTV / CAC ratio"
                      real={formatMultiplier(realLtvCac ?? NaN)}
                      hypo={formatMultiplier(hypoLtvCac ?? NaN)}
                      tooltip="The headline number. ≥3.0 = scale aggressively; 1-3 = optimise then scale; <1 = stop or reduce CPI / increase monetisation."
                      deltaSign="higher_is_better"
                    />
                    <Row
                      label="Payback offset"
                      real={realPaybackOffsetClean != null ? `${groupBy === 'week' ? 'W' : 'D'}${realPaybackOffsetClean}` : `> ${groupBy === 'week' ? 'W' : 'D'}${maxOffset}`}
                      hypo={hypoPaybackOffset != null ? `${groupBy === 'week' ? 'W' : 'D'}${hypoPaybackOffset}` : `> ${groupBy === 'week' ? 'W' : 'D'}${maxOffset}`}
                      tooltip="The first offset where cumulative revenue per install meets/exceeds CPI. '> Dmax' means it didn't pay back inside the visible window — extend the offsets to find the real payback day."
                    />
                  </tbody>
                </table>
                {/* What-to-do-about-it footer. Plain English so it
                    reads quickly during a daily standup. The
                    suggestions are derived live from which side of
                    the equation is dragging the ratio down. */}
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-600 leading-relaxed">
                  <strong className="text-gray-800">How to read this:</strong>{' '}
                  {realLtvCac == null ? (
                    <>No real cost data yet — verify cost sync above. Until then the Real column is incomplete and only Hypothesis is actionable.</>
                  ) : realLtvCac >= 3 ? (
                    <>Real LTV/CAC is healthy ({formatMultiplier(realLtvCac)}). Scale aggressively and re-check this number weekly as the cohort matures and revenue accumulates beyond {groupBy === 'week' ? 'W' : 'D'}{maxOffset}.</>
                  ) : realLtvCac >= 1 ? (
                    <>Real LTV/CAC is marginal ({formatMultiplier(realLtvCac)}). Two main levers: (a) lower CPI (better targeting / cheaper sources), (b) increase ARPU (more rewarded ads served, more offer placements visible to high-LTV users).</>
                  ) : (
                    <>Real LTV/CAC is below 1x ({formatMultiplier(realLtvCac)}) — the campaign is currently losing money on every install. To reach 1x you'd need {realCpiCents != null ? formatCents(Math.round(realCpiCents - realLtvCents)) : '—'} more LTV per install, or to drop CPI by ~{realCpiCents != null && realLtvCents > 0 ? Math.round((1 - realLtvCents / realCpiCents) * 100) : '—'}%. Pause / narrow targeting and revisit when monetisation improves.</>
                  )}
                  {' '}
                  Hypothesis is currently {formatMultiplier(hypoLtvCac ?? NaN)}{hypoLtvCac != null && realLtvCac != null && hypoLtvCac > realLtvCac ? ' — your assumptions are more optimistic than reality.' : hypoLtvCac != null && realLtvCac != null && hypoLtvCac < realLtvCac ? ' — reality is beating your assumptions.' : ''}
                </div>
              </div>
            );
          })()}

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
