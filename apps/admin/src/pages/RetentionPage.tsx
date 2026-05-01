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
 * Mobile retention curve fit: r(d) = a × d^(-b) for d ≥ 1.
 *
 * This is the textbook power-law shape every reward / casual app
 * follows in practice: heavy decay D1→D7, gentle long tail to
 * D30+. We fit `a` and `b` from any two known points (typically
 * D1 and D30 — D7 is used for sanity, not the fit, since 3
 * points need least-squares and we want stability over precision
 * for a board model).
 *
 * Returned function answers "what fraction of installs is active
 * on calendar day d?". r(0) = 1 by convention (everyone is
 * active on install day).
 */
function fitRetentionCurve(r1Pct: number, r30Pct: number): (d: number) => number {
  const r1 = Math.max(0.001, Math.min(1, r1Pct / 100));
  const r30 = Math.max(0.0001, Math.min(r1 - 1e-6, r30Pct / 100));
  // r(d) = r1 × d^(-b) where b solves r30 = r1 × 30^(-b).
  // → b = log(r1 / r30) / log(30).
  const b = Math.log(r1 / r30) / Math.log(30);
  return (d: number): number => {
    if (d <= 0) return 1;
    if (d === 1) return r1;
    return r1 * Math.pow(d, -b);
  };
}

/**
 * Expected active-days per install over the first N days. Used
 * as the LTV multiplier: LTV_ads = ARPDAU_ads × active_days(N).
 * Sums the fitted retention curve from D0 to DN inclusive.
 */
function activeDaysOverHorizon(rFn: (d: number) => number, horizonDays: number): number {
  let acc = 0;
  for (let d = 0; d <= horizonDays; d++) acc += rFn(d);
  return acc;
}

/**
 * Cumulative ad LTV per install at every day from 0 to N.
 * Returns an array so the chart can render the curve. Element i
 * is "by end of day i, how much ad revenue has ONE acquired
 * install generated on average?".
 */
function cumulativeAdLtvCents(
  rFn: (d: number) => number,
  horizonDays: number,
  arpdauAdsCents: number,
): number[] {
  const out: number[] = [];
  let running = 0;
  for (let d = 0; d <= horizonDays; d++) {
    running += rFn(d) * arpdauAdsCents;
    out.push(running);
  }
  return out;
}

/** Format a multiplier "0.45x" / "1.20x" / "12x". */
function formatMultiplier(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (x >= 10) return `${Math.round(x)}x`;
  return `${x.toFixed(2)}x`;
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

  // ── Forecast model inputs ─────────────────────────────────
  // These drive the bottom "LTV Forecast" panel — a board-ready
  // model that turns assumptions (CPI / ads-per-DAU / eCPM / offer
  // plays / retention curve) into a step-by-step LTV derivation.
  // Persisted independently from the cohort filters so the
  // operator can iterate on assumptions without losing them
  // between sessions.
  const [fcAdsPerDau, setFcAdsPerDau] = usePersistedState<number>('retention.forecast.adsPerDau', 12);
  const [fcOfferPlaysPerInstall, setFcOfferPlaysPerInstall] = usePersistedState<number>('retention.forecast.offerPlays', 0.7);
  const [fcRetD1Pct, setFcRetD1Pct] = usePersistedState<number>('retention.forecast.r1', 30);
  const [fcRetD7Pct, setFcRetD7Pct] = usePersistedState<number>('retention.forecast.r7', 15);
  const [fcRetD30Pct, setFcRetD30Pct] = usePersistedState<number>('retention.forecast.r30', 5);
  const [fcHorizonDays, setFcHorizonDays] = usePersistedState<number>('retention.forecast.horizon', 30);

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

          {/* LTV Forecast — board-presentable derivation chain.
              Inputs (CPI, ads/DAU, eCPM, offer plays, retention
              D1/D7/D30, horizon) feed a step-by-step calculation
              the operator can read aloud at a meeting. Each input
              has a "use real" link that pre-fills from the
              measured cohort data — assumptions stay grounded but
              the operator owns the final numbers presented. */}
          {cohortData?.cohorts?.length > 0 && (() => {
            const offsetsList: number[] = cohortData.offsets ?? [];

            // ── Real measurements (used as auto-fill anchors) ──
            // Anchored to the LARGEST observed offset so we have
            // the most engagement accumulated. If a cohort is too
            // young to have data at that offset, it contributes
            // zero — which is the honest read for "what have we
            // OBSERVED so far".
            const maxObservedOffset = offsetsList.length > 0 ? Math.max(...offsetsList) : 0;
            let totUsers = 0, totAds = 0, totPlays = 0, totCost = 0;
            for (const c of cohortData.cohorts) {
              totUsers += c.cohort_size ?? 0;
              totCost += c.cost_cents ?? 0;
              const cell = c.retention?.[maxObservedOffset];
              if (cell) {
                totAds += cell.ads_requested ?? 0;
                totPlays += cell.offer_plays ?? 0;
              }
            }
            const realCpiCents = totUsers > 0 && totCost > 0 ? totCost / totUsers : null;
            const realPlaysPerInstall = totUsers > 0 ? totPlays / totUsers : 0;
            // ads/DAU is harder to derive — we have cumulative ad
            // requests and a retention curve, not a daily series.
            // Approximate: total_ads / approx_active_user_days.
            const approxAud = (() => {
              let aud = 0;
              for (const c of cohortData.cohorts) {
                const sortedOffsets = [0, ...offsetsList].slice().sort((a, b) => a - b);
                let prev = 0;
                let prevCnt = c.cohort_size ?? 0;
                for (let i = 1; i < sortedOffsets.length; i++) {
                  const o = sortedOffsets[i];
                  const cnt = c.retention?.[o]?.count ?? 0;
                  aud += (o - prev) * ((prevCnt + cnt) / 2);
                  prev = o;
                  prevCnt = cnt;
                }
              }
              return aud;
            })();
            const realAdsPerDau = approxAud > 0 ? totAds / approxAud : 0;
            // Real retention pcts at D1/D7/D30 — averaged across
            // cohorts, weighted by cohort_size so big cohorts
            // dominate the average (instead of a tiny D7-old
            // cohort with one user pulling the average around).
            const avgRetPctAtOffset = (offset: number): number | null => {
              let users = 0, retained = 0;
              for (const c of cohortData.cohorts) {
                const cell = c.retention?.[offset];
                if (!cell) continue;
                users += c.cohort_size ?? 0;
                retained += cell.count ?? 0;
              }
              return users > 0 ? (retained / users) * 100 : null;
            };
            const realR1 = avgRetPctAtOffset(1);
            const realR7 = avgRetPctAtOffset(7);
            const realR30 = avgRetPctAtOffset(30);

            // ── The forecast model itself ──
            const cpiCents = Math.round(calcCpiDollars * 100);
            const arpdauAdsCents = (fcAdsPerDau / 1000) * calcCpmDollars * 100;
            const rFn = fitRetentionCurve(fcRetD1Pct, fcRetD30Pct);
            const activeDays = activeDaysOverHorizon(rFn, fcHorizonDays);
            const ltvAdsCents = arpdauAdsCents * activeDays;
            const ltvOffersCents = fcOfferPlaysPerInstall * calcOfferPayoutCents;
            const ltvTotalCents = ltvAdsCents + ltvOffersCents;
            const ltvCac = cpiCents > 0 ? ltvTotalCents / cpiCents : null;

            // Cumulative ad LTV per day for the chart + payback
            // crossover. Offer LTV is added once at the end (it's
            // a sparse lifetime metric, not a daily one) so the
            // chart's "ads only" line shows the gradual accrual.
            const cumAdLtv = cumulativeAdLtvCents(rFn, fcHorizonDays, arpdauAdsCents);
            const totalLtvSeries = cumAdLtv.map((v, d) => {
              // Smear offer LTV proportionally to active-days
              // accrued so the chart line is monotonic and we get
              // a believable payback day, instead of a step jump
              // at D-end that hides the real crossover.
              const fracDone = activeDays > 0 ? activeDaysOverHorizon(rFn, d) / activeDays : 0;
              return v + ltvOffersCents * fracDone;
            });
            const paybackDay = (() => {
              if (cpiCents <= 0) return null;
              for (let d = 0; d < totalLtvSeries.length; d++) {
                if (totalLtvSeries[d] >= cpiCents) return d;
              }
              return null;
            })();

            // Verdict bands — industry standard.
            const verdict = (() => {
              if (ltvCac == null) return { label: 'no data', color: '#6b7280', bg: '#f3f4f6', emoji: '·' };
              if (ltvCac >= 3) return { label: 'healthy — scale aggressively', color: '#15803d', bg: '#dcfce7', emoji: '🟢' };
              if (ltvCac >= 1.5) return { label: 'profitable — optimise then scale', color: '#15803d', bg: '#dcfce7', emoji: '🟢' };
              if (ltvCac >= 1) return { label: 'break-even — improve before scaling', color: '#b45309', bg: '#fef3c7', emoji: '🟡' };
              return { label: 'unprofitable — fix unit economics first', color: '#991b1b', bg: '#fee2e2', emoji: '🔴' };
            })();

            // Tiny "use real" link helper. Renders only when we
            // have a measured value to offer; clicking copies the
            // measured number into the input.
            const RealHint = ({ value, onClick, format }: { value: number | null; onClick: () => void; format: (v: number) => string }) => {
              if (value == null || !Number.isFinite(value)) {
                return <span className="text-[10px] text-gray-400">(no real data)</span>;
              }
              return (
                <button
                  type="button"
                  onClick={onClick}
                  className="text-[10px] text-blue-600 hover:underline"
                  title="Click to copy the measured value into this input."
                >
                  use real: {format(value)}
                </button>
              );
            };

            // SVG chart geometry.
            const chartW = 600;
            const chartH = 160;
            const padL = 40, padR = 12, padT = 12, padB = 24;
            const innerW = chartW - padL - padR;
            const innerH = chartH - padT - padB;
            const maxY = Math.max(cpiCents * 1.2, totalLtvSeries[totalLtvSeries.length - 1] ?? cpiCents);
            const xAt = (d: number) => padL + (d / Math.max(1, fcHorizonDays)) * innerW;
            const yAt = (v: number) => padT + innerH - (v / Math.max(1, maxY)) * innerH;
            const ltvPath = totalLtvSeries
              .map((v, d) => `${d === 0 ? 'M' : 'L'} ${xAt(d).toFixed(1)} ${yAt(v).toFixed(1)}`)
              .join(' ');

            return (
              <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                {/* Header */}
                <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-white flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-semibold text-gray-800">LTV Forecast — board model</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Set assumptions, follow the math, defend the verdict.
                      {sourceFilter !== 'paid' && (
                        <span className="ml-2 text-amber-600">
                          (Source = {sourceFilter} — for board math switch to <strong>Paid</strong>; "use real" hints will reflect paid acquisition only)
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className="rounded-lg px-3 py-2 text-sm font-semibold"
                    style={{ background: verdict.bg, color: verdict.color }}
                    title="LTV/CAC at the chosen horizon. Bands: ≥3.0 healthy, 1.5-3.0 profitable, 1.0-1.5 break-even, <1.0 unprofitable."
                  >
                    {verdict.emoji} LTV/CAC = {formatMultiplier(ltvCac ?? NaN)} · {verdict.label}
                  </div>
                </div>

                {/* Inputs */}
                <div className="px-4 py-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 border-b border-gray-100 bg-gray-50/50">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">CPI (acquisition cost)</label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">$</span>
                      <input type="number" step="0.01" value={calcCpiDollars}
                        onChange={e => setCalcCpiDollars(Math.max(0, Number(e.target.value)))}
                        className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono" />
                    </div>
                    <div className="mt-1"><RealHint
                      value={realCpiCents != null ? realCpiCents / 100 : null}
                      onClick={() => setCalcCpiDollars(Number(((realCpiCents ?? 0) / 100).toFixed(2)))}
                      format={(v) => `$${v.toFixed(2)}`}
                    /></div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Ad requests per DAU</label>
                    <input type="number" step="0.5" value={fcAdsPerDau}
                      onChange={e => setFcAdsPerDau(Math.max(0, Number(e.target.value)))}
                      className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono" />
                    <div className="mt-1"><RealHint
                      value={Number.isFinite(realAdsPerDau) ? realAdsPerDau : null}
                      onClick={() => setFcAdsPerDau(Number(realAdsPerDau.toFixed(1)))}
                      format={(v) => v.toFixed(1)}
                    /></div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">eCPM ($ per 1k requests)</label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">$</span>
                      <input type="number" step="0.10" value={calcCpmDollars}
                        onChange={e => setCalcCpmDollars(Math.max(0, Number(e.target.value)))}
                        className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono" />
                    </div>
                    <div className="mt-1 text-[10px] text-gray-400">
                      industry rewarded: $5–15
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Offer plays / install</label>
                    <input type="number" step="0.05" value={fcOfferPlaysPerInstall}
                      onChange={e => setFcOfferPlaysPerInstall(Math.max(0, Number(e.target.value)))}
                      className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono" />
                    <div className="mt-1"><RealHint
                      value={Number.isFinite(realPlaysPerInstall) ? realPlaysPerInstall : null}
                      onClick={() => setFcOfferPlaysPerInstall(Number(realPlaysPerInstall.toFixed(2)))}
                      format={(v) => v.toFixed(2)}
                    /></div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Offer payout (¢)</label>
                    <input type="number" step="1" value={calcOfferPayoutCents}
                      onChange={e => setCalcOfferPayoutCents(Math.max(0, Math.round(Number(e.target.value))))}
                      className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono" />
                    <div className="mt-1 text-[10px] text-gray-400">
                      typical offerwall: 20–40¢
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">D1 retention (%)</label>
                    <input type="number" step="1" min="0" max="100" value={fcRetD1Pct}
                      onChange={e => setFcRetD1Pct(Math.max(0, Math.min(100, Number(e.target.value))))}
                      className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono" />
                    <div className="mt-1"><RealHint
                      value={realR1}
                      onClick={() => realR1 != null && setFcRetD1Pct(Number(realR1.toFixed(0)))}
                      format={(v) => `${v.toFixed(1)}%`}
                    /></div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">D30 retention (%)</label>
                    <input type="number" step="1" min="0" max="100" value={fcRetD30Pct}
                      onChange={e => setFcRetD30Pct(Math.max(0, Math.min(100, Number(e.target.value))))}
                      className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono" />
                    <div className="mt-1"><RealHint
                      value={realR30}
                      onClick={() => realR30 != null && setFcRetD30Pct(Number(realR30.toFixed(0)))}
                      format={(v) => `${v.toFixed(1)}%`}
                    /></div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Horizon (days)</label>
                    <select value={fcHorizonDays} onChange={e => setFcHorizonDays(Number(e.target.value))}
                      className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono">
                      {[7, 14, 30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}
                    </select>
                    <div className="mt-1 text-[10px] text-gray-400">
                      board standard: 30 / 90 / 365
                    </div>
                  </div>
                </div>

                {/* Implied retention curve preview — sanity check.
                    Operators set D1 and D30, but the model
                    extrapolates to the full horizon via power
                    law. Showing the implied values at D7 / D14 /
                    D60 / D90 lets the operator catch a bad fit
                    immediately ("our real D60 is 6% but the model
                    says 12% — the curve shape is too gentle"). */}
                <div className="px-4 py-3 border-b border-gray-100 bg-blue-50/30">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Implied retention curve (model fit)</div>
                    <span
                      className="text-[10px] text-gray-400 cursor-help"
                      title="The curve r(d) = r1 · d^(-b) is fitted from your D1 and D30 inputs and projected to the full horizon. If a projected point looks wrong vs your real measurements (e.g. D60), nudge D1 or D30 until it lines up."
                    >
                      ⓘ how
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
                    {[1, 7, 14, 30, 60, 90].filter(d => d <= fcHorizonDays).map(d => {
                      const pct = rFn(d) * 100;
                      const isAnchor = d === 1 || d === 30;
                      return (
                        <span key={d} className={isAnchor ? 'text-blue-700 font-semibold' : 'text-gray-600'}>
                          D{d}: {pct.toFixed(1)}%
                          {isAnchor && <span className="text-[9px] text-blue-500 ml-1">(anchor)</span>}
                        </span>
                      );
                    })}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-2">
                    Sum of curve over D0–D{fcHorizonDays} = <strong className="text-gray-800">{activeDays.toFixed(2)} active days per install</strong>.
                    {' '}Of those, ~<strong>{activeDaysOverHorizon(rFn, Math.min(30, fcHorizonDays)).toFixed(1)}</strong> happen in the first 30 days
                    {fcHorizonDays > 30 && <> and ~<strong>{(activeDays - activeDaysOverHorizon(rFn, 30)).toFixed(1)}</strong> in the long tail D31–D{fcHorizonDays}</>}.
                  </div>
                </div>

                {/* Step-by-step derivation */}
                <div className="px-4 py-4 border-b border-gray-100">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Step-by-step derivation</div>
                  <ol className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="font-mono text-gray-400 w-8 shrink-0">①</span>
                      <span className="flex-1 text-gray-700">
                        <strong>ARPDAU from ads</strong> = (ads/DAU ÷ 1000) × eCPM
                        <span className="font-mono text-gray-500 ml-2">
                          = ({fcAdsPerDau} ÷ 1000) × ${calcCpmDollars.toFixed(2)} = <strong className="text-gray-900">{formatCents(arpdauAdsCents)}</strong>
                        </span>
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-mono text-gray-400 w-8 shrink-0">②</span>
                      <span className="flex-1 text-gray-700">
                        <strong>Expected active days per install</strong> over D0–D{fcHorizonDays} = Σ r(d), the fitted curve r(d) = r{fcRetD1Pct.toFixed(0)}%·d^(-b)
                        <span className="font-mono text-gray-500 ml-2">
                          = <strong className="text-gray-900">{activeDays.toFixed(2)} active-days</strong>
                        </span>
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          (not consecutive lifespan — sum of "% still active" over every day in the horizon)
                        </div>
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-mono text-gray-400 w-8 shrink-0">③</span>
                      <span className="flex-1 text-gray-700">
                        <strong>LTV from ads</strong> = ARPDAU × active days
                        <span className="font-mono text-gray-500 ml-2">
                          = {formatCents(arpdauAdsCents)} × {activeDays.toFixed(2)} = <strong className="text-gray-900">{formatCents(ltvAdsCents)}</strong>
                        </span>
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-mono text-gray-400 w-8 shrink-0">④</span>
                      <span className="flex-1 text-gray-700">
                        <strong>LTV from offers</strong> = unique plays/install × payout
                        <span className="font-mono text-gray-500 ml-2">
                          = {fcOfferPlaysPerInstall.toFixed(2)} × {formatCents(calcOfferPayoutCents)} = <strong className="text-gray-900">{formatCents(ltvOffersCents)}</strong>
                        </span>
                      </span>
                    </li>
                    <li className="flex items-start gap-2 pt-2 border-t border-gray-100 mt-2">
                      <span className="font-mono text-gray-400 w-8 shrink-0">⑤</span>
                      <span className="flex-1 text-gray-700">
                        <strong>Total LTV (D{fcHorizonDays})</strong> = LTV_ads + LTV_offers
                        <span className="font-mono text-gray-500 ml-2">
                          = {formatCents(ltvAdsCents)} + {formatCents(ltvOffersCents)} = <strong className="text-gray-900 text-base">{formatCents(ltvTotalCents)}</strong>
                        </span>
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-mono text-gray-400 w-8 shrink-0">⑥</span>
                      <span className="flex-1 text-gray-700">
                        <strong>LTV / CAC</strong> = LTV ÷ CPI
                        <span className="font-mono text-gray-500 ml-2">
                          = {formatCents(ltvTotalCents)} ÷ {formatCents(cpiCents)} = <strong className="text-gray-900 text-base" style={{ color: verdict.color }}>{formatMultiplier(ltvCac ?? NaN)}</strong>
                        </span>
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-mono text-gray-400 w-8 shrink-0">⑦</span>
                      <span className="flex-1 text-gray-700">
                        <strong>Payback day</strong>
                        <span className="font-mono text-gray-500 ml-2">
                          = {paybackDay != null ? <strong className="text-gray-900">D{paybackDay}</strong> : <strong className="text-red-700">never inside D{fcHorizonDays}</strong>}
                          {paybackDay != null && (
                            <span className="text-gray-400 text-xs ml-2">
                              (cumulative LTV crosses CPI line)
                            </span>
                          )}
                        </span>
                      </span>
                    </li>
                  </ol>
                </div>

                {/* Chart */}
                <div className="px-4 py-4 border-b border-gray-100">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Cumulative LTV vs CPI line</div>
                  <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" style={{ maxHeight: 200 }}>
                    {/* Y axis labels */}
                    {[0, 0.25, 0.5, 0.75, 1].map(t => {
                      const v = maxY * t;
                      return (
                        <g key={t}>
                          <line x1={padL} x2={chartW - padR} y1={yAt(v)} y2={yAt(v)} stroke="#e5e7eb" strokeDasharray="2 3" />
                          <text x={padL - 4} y={yAt(v) + 3} fontSize="9" fill="#9ca3af" textAnchor="end" fontFamily="monospace">
                            {formatCents(v)}
                          </text>
                        </g>
                      );
                    })}
                    {/* X axis labels */}
                    {[0, 0.25, 0.5, 0.75, 1].map(t => {
                      const d = Math.round(fcHorizonDays * t);
                      return (
                        <text key={t} x={xAt(d)} y={chartH - 8} fontSize="9" fill="#9ca3af" textAnchor="middle" fontFamily="monospace">
                          D{d}
                        </text>
                      );
                    })}
                    {/* CPI line */}
                    <line x1={padL} x2={chartW - padR} y1={yAt(cpiCents)} y2={yAt(cpiCents)} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" />
                    <text x={chartW - padR - 2} y={yAt(cpiCents) - 4} fontSize="10" fill="#dc2626" textAnchor="end" fontWeight="bold">
                      CPI {formatCents(cpiCents)}
                    </text>
                    {/* LTV curve */}
                    <path d={ltvPath} stroke="#2563eb" strokeWidth={2} fill="none" />
                    <text x={chartW - padR - 2} y={yAt(totalLtvSeries[totalLtvSeries.length - 1] ?? 0) - 4} fontSize="10" fill="#2563eb" textAnchor="end" fontWeight="bold">
                      LTV {formatCents(totalLtvSeries[totalLtvSeries.length - 1] ?? 0)}
                    </text>
                    {/* Payback marker */}
                    {paybackDay != null && (
                      <g>
                        <line x1={xAt(paybackDay)} x2={xAt(paybackDay)} y1={padT} y2={chartH - padB} stroke="#16a34a" strokeWidth={1} strokeDasharray="3 2" />
                        <circle cx={xAt(paybackDay)} cy={yAt(cpiCents)} r="4" fill="#16a34a" />
                        <text x={xAt(paybackDay) + 6} y={padT + 10} fontSize="10" fill="#16a34a" fontWeight="bold">
                          payback D{paybackDay}
                        </text>
                      </g>
                    )}
                  </svg>
                </div>

                {/* Board narrative */}
                <div className="px-4 py-3 bg-gray-50 text-sm text-gray-700 leading-relaxed">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Read this to the board</div>
                  <p>
                    «We acquire one user for <strong>{formatCents(cpiCents)}</strong>. Each active user requests
                    {' '}<strong>{fcAdsPerDau}</strong> rewarded ads per day at an effective <strong>${calcCpmDollars.toFixed(2)} eCPM</strong>,
                    earning us <strong>{formatCents(arpdauAdsCents)}</strong> ARPDAU.
                    {' '}With a retention curve of D1 = {fcRetD1Pct}% / D30 = {fcRetD30Pct}%, that user stays active for{' '}
                    <strong>{activeDays.toFixed(1)} days</strong> on average over the first {fcHorizonDays}, generating{' '}
                    <strong>{formatCents(ltvAdsCents)}</strong> in ad revenue. They additionally complete{' '}
                    <strong>{fcOfferPlaysPerInstall.toFixed(2)} unique offers</strong> at <strong>{formatCents(calcOfferPayoutCents)}</strong> each
                    {' '}— another <strong>{formatCents(ltvOffersCents)}</strong>.
                    {' '}<strong>Total LTV at D{fcHorizonDays} is {formatCents(ltvTotalCents)}</strong>, which is{' '}
                    <strong style={{ color: verdict.color }}>{formatMultiplier(ltvCac ?? NaN)} our acquisition cost</strong>.
                    {' '}{paybackDay != null
                      ? <>The cohort pays back on <strong>D{paybackDay}</strong>.</>
                      : <>The cohort does NOT pay back inside D{fcHorizonDays} — extend the horizon or improve unit economics.</>
                    }
                    {' '}{ltvCac != null && ltvCac >= 1.5 && <>This is profitable; we should scale paid acquisition while monitoring the curve.</>}
                    {ltvCac != null && ltvCac >= 1 && ltvCac < 1.5 && <>This is break-even — small improvements in retention or eCPM make this clearly profitable.</>}
                    {ltvCac != null && ltvCac < 1 && <>This is unprofitable — to break even we need to cut CPI to ≤ {formatCents(ltvTotalCents)}, increase eCPM by {((cpiCents / Math.max(1, ltvTotalCents) - 1) * 100).toFixed(0)}%, or improve retention.»</>}
                  </p>
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
