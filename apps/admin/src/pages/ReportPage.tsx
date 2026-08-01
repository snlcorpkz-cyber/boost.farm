import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePersistedState } from '@/hooks/usePersistedState';
import {
  SERIES, LineChart, ColumnChart, FunnelBars, SortableTable, heatColor,
  fmtInt, fmtMoney, fmtCompact,
} from '@/components/report/charts';
import type { Col, FunnelStep, StackedDatum } from '@/components/report/charts';

/**
 * Insights — the board-facing product report. One page that answers
 * "what is happening in the product": audience, growth, retention,
 * how often people play, how far they get, where they are, what the
 * traffic sources deliver and what monetization looks like. Every
 * section pivots together through the shared filter bar.
 *
 * Data: /api/admin/report/* (see packages/api/src/routes/admin/report.ts).
 * All calendar days are bucketed in the backend's REPORTING_TZ.
 */

const PERIODS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 180, label: '180d' },
  { days: 0, label: 'All time' },
] as const;

type ReportQuery = { isPending: boolean; isError: boolean; error: unknown; data?: any };

function useReport(section: string, qs: string): ReportQuery {
  return useQuery<any>({
    queryKey: ['admin', 'report', section, qs],
    queryFn: () => api(`/report/${section}?${qs}`),
    staleTime: 60_000,
  });
}

// ── Small layout pieces ─────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function Section({
  id, num, title, subtitle, children,
}: {
  id: string; num: string; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    // scroll-mt clears the sticky filter bar so anchor jumps don't
    // hide section headers under it
    <section id={id} className="scroll-mt-28" style={{ breakInside: 'avoid' }}>
      <div className="mb-3 mt-10 flex items-baseline gap-3">
        <span className="text-sm font-bold text-blue-600 tabular-nums">{num}</span>
        <div>
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Kpi({
  label, value, sub, delta,
}: {
  label: string; value: React.ReactNode; sub?: string; delta?: { value: number; suffix?: string };
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold tracking-tight text-gray-900">{value}</p>
      {delta && delta.value !== 0 && (
        <p className={`text-xs font-medium ${delta.value > 0 ? 'text-green-700' : 'text-red-600'}`}>
          {delta.value > 0 ? '▲' : '▼'} {Math.abs(delta.value).toLocaleString('en-US')}{delta.suffix ?? ''}
        </p>
      )}
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function Loading() {
  return <Card><p className="animate-pulse text-sm text-gray-400">Loading…</p></Card>;
}

function LoadError({ msg }: { msg?: string }) {
  return <Card><p className="text-sm text-red-600">Failed to load{msg ? `: ${msg}` : ''}</p></Card>;
}

/** Fill gaps so time axes are honest (a missing day = 0, not skipped). */
function fillDays<T extends { day: string }>(rows: T[], zero: Omit<T, 'day'>): T[] {
  if (rows.length < 2) return rows;
  const out: T[] = [];
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const start = new Date(`${rows[0].day}T00:00:00Z`);
  const end = new Date(`${rows[rows.length - 1].day}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? ({ day, ...zero } as T));
  }
  return out;
}

// ── Page ────────────────────────────────────────────────────────

const NAV = [
  ['summary', 'Summary'],
  ['growth', 'Growth'],
  ['retention', 'Retention'],
  ['engagement', 'Engagement'],
  ['funnel', 'Progression'],
  ['geo', 'Geography'],
  ['sources', 'Sources'],
  ['inventory', 'Ad inventory'],
  ['offers', 'Partner games'],
  ['monetization', 'Monetization'],
] as const;

/**
 * Fallback eCPM (cents) for the "what was this inventory worth" estimate
 * when the network never paid us anything in the window, so there is no
 * observed rate to anchor on. Conservative rewarded-video ballpark; the
 * operator overrides it in the UI.
 */
const DEFAULT_ECPM_CENTS = 300;

export function ReportPage() {
  const [days, setDays] = usePersistedState<number>('report.days', 30);
  const [country, setCountry] = usePersistedState<string>('report.country', '');
  const [platform, setPlatform] = usePersistedState<string>('report.platform', '');
  const [source, setSource] = usePersistedState<string>('report.source', 'all');
  const [partnerId, setPartnerId] = usePersistedState<string>('report.partner', '');
  // Days of silence after which a player who has not reached a step is
  // treated as lost rather than still on their way there.
  const [churnDays, setChurnDays] = usePersistedState<number>('report.churnDays', 14);
  // null = follow the observed eCPM; a number pins the assumption.
  const [ecpmOverride, setEcpmOverride] = usePersistedState<number | null>('report.ecpmCents', null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('days', String(days));
    if (country) p.set('country', country);
    if (platform) p.set('platform', platform);
    if (source !== 'all') p.set('source_filter', source);
    if (partnerId) p.set('partner_id', partnerId);
    return p.toString();
  }, [days, country, platform, source, partnerId]);

  // Only the funnel cares about the churn window — keep it out of the
  // shared string so changing it doesn't invalidate every other section.
  const qsFunnel = useMemo(() => `${qs}&churn_days=${churnDays}`, [qs, churnDays]);

  const overview = useReport('overview', qs);
  const growth = useReport('growth', qs);
  const retention = useReport('retention', qs);
  const engagement = useReport('engagement', qs);
  const funnel = useReport('funnel', qsFunnel);
  const geo = useReport('geo', qs);
  const sources = useReport('sources', qs);
  const inventory = useReport('inventory', qs);
  const offers = useReport('offers', qs);
  const monetization = useReport('monetization', qs);

  // Country dropdown options come from an unfiltered-by-country geo
  // call so picking a country doesn't collapse the list to itself.
  const qsNoCountry = useMemo(() => {
    const p = new URLSearchParams(qs);
    p.delete('country');
    return p.toString();
  }, [qs]);
  const geoOptions = useReport('geo', qsNoCountry);
  const countries: string[] = useMemo(
    () => (geoOptions.data?.rows ?? []).map((r: any) => r.dim).filter((c: string) => c !== 'unknown'),
    [geoOptions.data],
  );

  const { data: partnersData } = useQuery<{ partners: Array<{ id: string; name: string }> }>({
    queryKey: ['admin', 'partners', 'list-for-filter'],
    queryFn: () => api('/partners'),
  });
  const partners = partnersData?.partners ?? [];

  const periodLabel = PERIODS.find((p) => p.days === days)?.label ?? `${days}d`;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="mx-auto max-w-6xl">
      {/* Print: strip the app chrome, keep the report as a document. */}
      <style>{`
        @media print {
          aside, .no-print { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; }
          section { break-inside: avoid; }
          body { background: #fff; }
        }
      `}</style>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">BoostFarm — Product Report</h1>
          <p className="text-sm text-gray-500">
            {today} · window: {periodLabel}
            {country && ` · ${country}`}
            {platform && ` · ${platform}`}
            {source !== 'all' && ` · ${source}`}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="no-print rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          🖨 Print / PDF
        </button>
      </div>

      {/* Filter bar */}
      <div className="no-print sticky top-0 z-20 -mx-1 mt-4 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={[
                  'rounded-md px-2.5 py-1 text-xs font-medium transition',
                  days === p.days ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100',
                ].join(' ')}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select value={country} onChange={(e) => setCountry(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700">
            <option value="">All countries</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700">
            <option value="">All platforms</option>
            <option value="android">Android</option>
            <option value="web">Web</option>
            <option value="ios">iOS</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700">
            <option value="all">All traffic</option>
            <option value="paid">Paid only</option>
            <option value="organic">Organic only</option>
          </select>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700">
            <option value="">Any attribution</option>
            <option value="organic">No partner</option>
            <option value="any">Any partner</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#sec-${id}`}
                 className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100">
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>

      <SummarySection q={overview} inv={inventory} />
      <GrowthSection q={growth} />
      <RetentionSection q={retention} />
      <EngagementSection q={engagement} />
      <FunnelSection q={funnel} churnDays={churnDays} onChurnDays={setChurnDays} />
      <GeoSection q={geo} />
      <SourcesSection q={sources} />
      <InventorySection q={inventory} ecpmOverride={ecpmOverride} onEcpm={setEcpmOverride} />
      <OffersSection q={offers} />
      <MonetizationSection q={monetization} />

      <p className="mt-10 border-t border-gray-200 pt-4 text-xs text-gray-400">
        Methodology: calendar days are bucketed in the reporting timezone (matches Retention page,
        AppsFlyer and FB Ads Manager). A session = a burst of activity with no gap over 30 minutes.
        Synthetic server-side events are excluded everywhere. Ad impressions count one per user tap
        (deduplicated by attempt id) and include mock fallback impressions, which are delivered
        inventory but carry no revenue — realized revenue is reported separately and never mixed
        with the eCPM-based estimate. Partner-game installs are postback-confirmed first milestones;
        game opens are only recorded from the release that added that tracking. Progression steps
        separate players who are still growing from those who went silent, so a low harvest count is
        not read as a failure when most cohorts are simply not finished.
      </p>
    </div>
  );
}

// ── 01 Summary ──────────────────────────────────────────────────

function SummarySection({ q, inv }: { q: ReportQuery; inv: ReportQuery }) {
  if (q.isPending) return <Section id="sec-summary" num="01" title="Executive summary"><Loading /></Section>;
  if (q.isError || !q.data) return <Section id="sec-summary" num="01" title="Executive summary"><LoadError msg={(q.error as Error)?.message} /></Section>;
  const d = q.data;
  const ret = d.retention ?? {};
  // Inventory loads on its own clock — an empty object just renders zeros
  // for one paint rather than blocking the whole summary.
  const ad = inv.data?.totals ?? {};
  return (
    <Section id="sec-summary" num="01" title="Executive summary"
             subtitle="The headline numbers for the selected window and audience.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:row-span-2">
          <p className="text-sm font-medium text-gray-500">Players today (DAU)</p>
          <p className="mt-1 text-5xl font-bold tracking-tight text-gray-900">{fmtInt(d.activity.dau_today)}</p>
          <p className={`mt-1 text-sm font-medium ${d.activity.dau_today >= d.activity.dau_yesterday ? 'text-green-700' : 'text-red-600'}`}>
            {d.activity.dau_today >= d.activity.dau_yesterday ? '▲' : '▼'}{' '}
            {fmtInt(Math.abs(d.activity.dau_today - d.activity.dau_yesterday))} vs yesterday ({fmtInt(d.activity.dau_yesterday)})
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 text-center">
            <div><p className="text-lg font-bold text-gray-900">{fmtInt(d.activity.wau)}</p><p className="text-xs text-gray-500">WAU</p></div>
            <div><p className="text-lg font-bold text-gray-900">{fmtInt(d.activity.mau)}</p><p className="text-xs text-gray-500">MAU</p></div>
            <div><p className="text-lg font-bold text-gray-900">{d.activity.stickiness_pct}%</p><p className="text-xs text-gray-500">Stickiness</p></div>
          </div>
        </div>
        <Kpi label="Total registered" value={fmtInt(d.totals.total_users)} sub={`+${fmtInt(d.totals.new_users_period)} in window`} />
        <Kpi label="Avg DAU (window)" value={fmtInt(d.activity.avg_dau)} />
        <Kpi label="D1 retention" value={`${ret.d1?.pct ?? 0}%`} sub={`${fmtInt(ret.d1?.retained ?? 0)} of ${fmtInt(ret.d1?.eligible ?? 0)}`} />
        <Kpi label="D7 / D30" value={`${ret.d7?.pct ?? 0}% / ${ret.d30?.pct ?? 0}%`} />
        <Kpi label="Sessions per active day" value={d.sessions.per_active_day} sub={`median ${d.sessions.median_minutes} min`} />
        <Kpi label="Waterings per active day" value={d.economy.waterings_per_active_day} sub={`${fmtCompact(d.economy.waterings)} total`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* Impressions lead the money tiles on purpose: while the ad
            network was misconfigured, delivered inventory is the honest
            measure of what the game produced, and realized revenue only
            reflects how much of it could be sold. */}
        <Kpi
          label="Ad impressions (real + mock)"
          value={fmtInt(ad.impressions ?? 0)}
          sub={`${fmtInt(ad.sdk_impressions ?? 0)} real · ${fmtInt(ad.mock_impressions ?? 0)} mock · ${ad.impressions_per_active_day ?? 0}/active day`}
        />
        <Kpi
          label="Ad revenue (realized)"
          value={fmtMoney(d.economy.ad_revenue_cents)}
          sub={`ARPDAU ${fmtMoney(d.economy.arpdau_cents)} · ${fmtInt(ad.monetized_impressions ?? 0)} paid impressions`}
        />
        <Kpi label="Offer plays" value={fmtInt(d.economy.offer_completions)} sub={`${fmtInt(d.economy.offer_players)} unique players`} />
        <Kpi label="Harvests → coupons" value={fmtInt(d.totals.harvest_users)}
             sub={`${fmtInt(d.totals.coupons_issued)} coupons · ${fmtMoney(d.totals.coupons_value_cents)} liability · ${fmtInt(d.totals.coupons_redeemed)} redeemed`} />
      </div>
    </Section>
  );
}

// ── 02 Growth ───────────────────────────────────────────────────

function GrowthSection({ q }: { q: ReportQuery }) {
  const rows = useMemo(
    () => fillDays<any>(q.data?.series ?? [], { new_users: 0, partner: 0, paid: 0, organic: 0, dau: 0, cumulative_users: NaN }),
    [q.data],
  );
  // carry cumulative through filled gaps
  useMemo(() => {
    let last = q.data?.base_users ?? 0;
    for (const r of rows) {
      if (Number.isNaN(r.cumulative_users)) r.cumulative_users = last;
      else last = r.cumulative_users;
    }
  }, [rows, q.data]);

  if (q.isPending) return <Section id="sec-growth" num="02" title="Growth"><Loading /></Section>;
  if (q.isError || !q.data) return <Section id="sec-growth" num="02" title="Growth"><LoadError msg={(q.error as Error)?.message} /></Section>;

  const labels = rows.map((r) => r.day);
  const stacked: StackedDatum[] = rows.map((r) => ({ label: r.day, parts: [r.organic, r.paid, r.partner] }));

  return (
    <Section id="sec-growth" num="02" title="Growth"
             subtitle="Daily active players and where new players come from.">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Daily active players</h3>
          <LineChart labels={labels} area
                     series={[{ name: 'DAU', color: SERIES[0], values: rows.map((r) => r.dau) }]} />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">New players per day, by source</h3>
          <ColumnChart data={stacked} names={['Organic', 'Paid (Meta/AF)', 'Affiliate']}
                       colors={[SERIES[2], SERIES[0], SERIES[1]]} />
        </Card>
      </div>
      <Card className="mt-3">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Cumulative registered players</h3>
        <LineChart labels={labels}
                   series={[{ name: 'Total players', color: SERIES[0], values: rows.map((r) => r.cumulative_users) }]} />
      </Card>
    </Section>
  );
}

// ── 03 Retention ────────────────────────────────────────────────

function RetentionSection({ q }: { q: ReportQuery }) {
  if (q.isPending) return <Section id="sec-retention" num="03" title="Retention"><Loading /></Section>;
  if (q.isError || !q.data) return <Section id="sec-retention" num="03" title="Retention"><LoadError msg={(q.error as Error)?.message} /></Section>;
  const d = q.data;
  const curve = d.curve ?? [];
  const weekly = d.weekly_cohorts ?? [];
  const maxPct = { d1: 1, d7: 1, d30: 1 };
  for (const w of weekly) {
    maxPct.d1 = Math.max(maxPct.d1, w.d1_pct ?? 0);
    maxPct.d7 = Math.max(maxPct.d7, w.d7_pct ?? 0);
    maxPct.d30 = Math.max(maxPct.d30, w.d30_pct ?? 0);
  }

  // Habit depth: bucket the raw histogram (0..14 active days).
  const buckets = [
    { label: 'Never came back', min: 0, max: 0 },
    { label: '1 day', min: 1, max: 1 },
    { label: '2 days', min: 2, max: 2 },
    { label: '3–4 days', min: 3, max: 4 },
    { label: '5–7 days', min: 5, max: 7 },
    { label: '8–14 days', min: 8, max: 14 },
  ].map((b) => ({
    label: b.label,
    parts: [
      (d.habit_histogram ?? [])
        .filter((h: any) => h.active_days >= b.min && h.active_days <= b.max)
        .reduce((acc: number, h: any) => acc + h.users, 0),
    ],
  }));

  return (
    <Section id="sec-retention" num="03" title="Retention"
             subtitle="How many players come back — the health metric everything else depends on.">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Retention curve (% of cohort returning on day N)</h3>
          <LineChart
            labels={curve.map((c: any) => `D${c.offset}`)}
            series={[{
              name: 'Retention', color: SERIES[0],
              values: curve.map((c: any) => c.pct),
              fmt: (v) => `${v}%`,
            }]}
          />
          <p className="mt-1 text-xs text-gray-400">Only cohorts old enough to be measured at each offset are counted.</p>
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Habit depth — active days in first 2 weeks</h3>
          <ColumnChart
            data={buckets} names={['Players']} colors={[SERIES[0]]}
            xLabel={(l) => l}
          />
          <p className="mt-1 text-xs text-gray-400">Players registered ≥14 days ago; how many distinct days they returned during days 1–14.</p>
        </Card>
      </div>
      <Card className="mt-3">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Weekly cohorts</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-2.5 py-2 font-semibold">Week of</th>
                <th className="px-2.5 py-2 text-right font-semibold">New players</th>
                <th className="px-2.5 py-2 text-right font-semibold">D1</th>
                <th className="px-2.5 py-2 text-right font-semibold">D7</th>
                <th className="px-2.5 py-2 text-right font-semibold">D30</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((w: any) => (
                <tr key={w.week} className="border-b border-gray-100">
                  <td className="px-2.5 py-1.5 tabular-nums">{w.week}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtInt(w.size)}</td>
                  {(['d1_pct', 'd7_pct', 'd30_pct'] as const).map((k, i) => {
                    // null = cohort not yet mature for this offset — show
                    // a dash, not a fake 0% that reads as a collapse.
                    if (w[k] == null) {
                      return (
                        <td key={k} className="px-2.5 py-1.5 text-right text-xs text-gray-300">—</td>
                      );
                    }
                    const m = i === 0 ? maxPct.d1 : i === 1 ? maxPct.d7 : maxPct.d30;
                    const { bg, ink } = heatColor(w[k], m);
                    return (
                      <td key={k} className="px-2.5 py-1.5 text-right tabular-nums">
                        <span className="inline-block min-w-[3.2rem] rounded px-1.5 py-0.5 text-xs font-semibold"
                              style={{ background: bg, color: ink }}>
                          {w[k]}%
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Section>
  );
}

// ── 04 Engagement ───────────────────────────────────────────────

function EngagementSection({ q }: { q: ReportQuery }) {
  if (q.isPending) return <Section id="sec-engagement" num="04" title="Engagement"><Loading /></Section>;
  if (q.isError || !q.data) return <Section id="sec-engagement" num="04" title="Engagement"><LoadError msg={(q.error as Error)?.message} /></Section>;
  const d = q.data;
  const s = d.sessions ?? {};
  const hist: { sessions: number; user_days: number }[] = s.histogram ?? [];
  const hourly: any[] = d.hourly ?? [];
  const actions = fillDays<any>(d.daily_actions ?? [], {
    waterings: 0, bucket_collects: 0, checkins: 0, challenge_claims: 0, friend_actions: 0, ads_rewarded: 0,
  });
  const loops = d.loop_share ?? {};
  const loopRows = [
    { label: 'Watered the farm', v: loops.watered },
    { label: 'Watched rewarded ad', v: loops.ad_watchers },
    { label: 'Daily check-in', v: loops.checked_in },
    { label: 'Claimed pet gift', v: loops.pet_gifts },
    { label: 'Daily challenge', v: loops.challenged },
    { label: 'Social (friends)', v: loops.social },
  ].filter((r) => r.v !== undefined);
  const active = Math.max(1, loops.active_users ?? 1);

  return (
    <Section id="sec-engagement" num="04" title="Engagement"
             subtitle="How often and how intensely people play within a day.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Sessions per active day" value={s.avg_per_day ?? 0} sub={`${fmtCompact(s.total ?? 0)} sessions total`} />
        <Kpi label="Median session" value={`${s.median_minutes ?? 0} min`} sub={`mean ${s.mean_minutes ?? 0} min`} />
        <Kpi label="P95 session" value={`${s.p95_minutes ?? 0} min`} />
        <Kpi label="Active player-days" value={fmtInt(s.active_user_days ?? 0)} />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Visits per day (distribution of player-days)</h3>
          <ColumnChart
            data={hist.map((h) => ({ label: h.sessions >= 5 ? '5+' : String(h.sessions), parts: [h.user_days] }))}
            names={['Player-days']} colors={[SERIES[0]]}
            xLabel={(l) => `${l}×`}
          />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Activity by hour of day (reporting TZ)</h3>
          <ColumnChart
            data={Array.from({ length: 24 }, (_, h) => ({
              label: String(h),
              parts: [hourly.find((r) => r.hour === h)?.events ?? 0],
            }))}
            names={['Actions']} colors={[SERIES[0]]}
            xLabel={(l) => `${l}:00`}
          />
        </Card>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Core loop volume per day</h3>
          <LineChart
            labels={actions.map((r) => r.day)}
            series={[
              { name: 'Waterings', color: SERIES[0], values: actions.map((r) => r.waterings) },
              { name: 'Rewarded ads', color: SERIES[1], values: actions.map((r) => r.ads_rewarded) },
              { name: 'Check-ins', color: SERIES[2], values: actions.map((r) => r.checkins) },
            ]}
          />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Share of active players touching each loop</h3>
          <div className="space-y-2 pt-1">
            {loopRows.map((r) => {
              const pct = Math.round(((r.v ?? 0) / active) * 1000) / 10;
              return (
                <div key={r.label} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-right text-xs font-medium text-gray-600">{r.label}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded-r-[4px] bg-gray-100">
                    <div className="flex h-5 items-center rounded-r-[4px]" style={{ width: `${pct}%`, background: SERIES[0], minWidth: 2 }} />
                  </div>
                  <span className="w-24 shrink-0 text-xs tabular-nums text-gray-600">
                    {pct}% · {fmtInt(r.v ?? 0)}
                  </span>
                </div>
              );
            })}
            <p className="pt-1 text-xs text-gray-400">Of {fmtInt(loops.active_users ?? 0)} players active in the window.</p>
          </div>
        </Card>
      </div>
    </Section>
  );
}

// ── 05 Progression funnel ───────────────────────────────────────

const CHURN_OPTIONS = [7, 14, 30] as const;

function FunnelSection({
  q, churnDays, onChurnDays,
}: {
  q: ReportQuery; churnDays: number; onChurnDays: (v: number) => void;
}) {
  if (q.isPending) return <Section id="sec-funnel" num="05" title="Progression"><Loading /></Section>;
  if (q.isError || !q.data) return <Section id="sec-funnel" num="05" title="Progression"><LoadError msg={(q.error as Error)?.message} /></Section>;
  const f = q.data.funnel ?? {};
  const stages: any[] = q.data.active_farm_stages ?? [];
  const medNote = (v: number | null | undefined) => (v != null ? `median ${Math.round(v * 10) / 10}d` : undefined);
  const steps: FunnelStep[] = [
    { label: 'Registered', value: f.registered ?? 0 },
    { label: 'Tutorial finished', value: f.tutorial_finished ?? 0 },
    { label: 'First watering', value: f.first_water ?? 0 },
    { label: 'Stage 2', value: f.stage_2 ?? 0 },
    { label: 'Stage 3', value: f.stage_3 ?? 0, note: medNote(f.med_days_s3) },
    { label: 'Stage 4', value: f.stage_4 ?? 0, note: medNote(f.med_days_s4) },
    { label: 'Stage 5', value: f.stage_5 ?? 0, note: medNote(f.med_days_s5) },
    { label: 'Stage 6', value: f.stage_6 ?? 0, note: medNote(f.med_days_s6) },
    { label: '🥕 Harvest', value: f.harvested ?? 0, note: medNote(f.med_days_harvest) },
  ];

  /**
   * Censoring-aware view of the same funnel. "Reached" is a fact.
   * Everyone who has not reached a step splits into players who are
   * still showing up (they can still get there) and players who went
   * quiet (they never will). The raw rate divides by everybody; the
   * settled rate divides only by players whose run is over, which is
   * the number that answers "of the people who finished playing, what
   * share made it here".
   */
  const rows = [
    { label: 'Stage 2', reached: f.stage_2, inProgress: f.stage_2_in_progress, lost: f.stage_2_lost },
    { label: 'Stage 3', reached: f.stage_3, inProgress: f.stage_3_in_progress, lost: f.stage_3_lost },
    { label: 'Stage 4', reached: f.stage_4, inProgress: f.stage_4_in_progress, lost: f.stage_4_lost },
    { label: 'Stage 5', reached: f.stage_5, inProgress: f.stage_5_in_progress, lost: f.stage_5_lost },
    { label: 'Stage 6', reached: f.stage_6, inProgress: f.stage_6_in_progress, lost: f.stage_6_lost },
    { label: '🥕 Harvest', reached: f.harvested, inProgress: f.harvested_in_progress, lost: f.harvested_lost },
  ].map((r) => {
    const reached = r.reached ?? 0;
    const lost = r.lost ?? 0;
    const inProgress = r.inProgress ?? 0;
    const settledBase = reached + lost;
    return {
      ...r, reached, lost, inProgress,
      rawPct: f.registered > 0 ? Math.round((reached / f.registered) * 1000) / 10 : 0,
      settledPct: settledBase > 0 ? Math.round((reached / settledBase) * 1000) / 10 : null,
    };
  });
  const harvest = rows[rows.length - 1];

  return (
    <Section id="sec-funnel" num="05" title="Progression to the vegetables"
             subtitle="How far players get on the way to a real harvest, who is still on the way, and where the rest stall.">
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="🥕 Harvested" value={fmtInt(harvest.reached)}
             sub={harvest.rawPct + '% of everyone registered in the window'} />
        <Kpi label="Still growing" value={fmtInt(harvest.inProgress)}
             sub={`played within the last ${churnDays}d, no harvest yet`} />
        <Kpi label="Gave up before harvest" value={fmtInt(harvest.lost)}
             sub={`silent for over ${churnDays}d`} />
        <Kpi label="Harvest rate, settled players"
             value={harvest.settledPct != null ? `${harvest.settledPct}%` : '—'}
             sub={`of ${fmtInt(harvest.reached + harvest.lost)} whose run is over`} />
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Lifetime funnel (players registered in window)</h3>
          <FunnelBars steps={steps} />
          <p className="mt-2 text-xs text-gray-400">
            {fmtInt(f.watched_ad ?? 0)} players ({f.registered ? Math.round(((f.watched_ad ?? 0) / f.registered) * 1000) / 10 : 0}%)
            watched at least one rewarded ad. {fmtInt(f.still_active_total ?? 0)} of {fmtInt(f.registered ?? 0)} are still active.
          </p>
        </Card>
        <Card className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Active farms right now, by stage</h3>
          <ColumnChart
            data={Array.from({ length: 6 }, (_, i) => {
              const row = stages.find((s) => s.stage === i + 1);
              const total = row?.farms ?? 0;
              const stillPlaying = row?.active_farms ?? 0;
              // stacked: engaged farms first, dormant remainder on top
              return { label: `S${i + 1}`, parts: [stillPlaying, Math.max(0, total - stillPlaying)] };
            })}
            names={[`Played in last ${churnDays}d`, 'Dormant']}
            colors={[SERIES[0], '#d4d4d8']}
            xLabel={(l) => l}
          />
          <p className="mt-1 text-xs text-gray-400">Snapshot of unharvested farms (audience filters apply; time window does not).</p>
        </Card>
      </div>
      <Card className="mt-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-700">Who is still on their way vs who dropped out</h3>
          <div className="no-print flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Consider a player lost after</span>
            <div className="flex rounded-lg border border-gray-200 p-0.5">
              {CHURN_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => onChurnDays(c)}
                  className={[
                    'rounded-md px-2 py-0.5 text-xs font-medium transition',
                    churnDays === c ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100',
                  ].join(' ')}
                >
                  {c}d
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500">of silence</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-2.5 py-2 font-semibold">Step</th>
                <th className="px-2.5 py-2 text-right font-semibold">Reached</th>
                <th className="px-2.5 py-2 text-right font-semibold">Still on the way</th>
                <th className="px-2.5 py-2 text-right font-semibold">Dropped out</th>
                <th className="px-2.5 py-2 text-right font-semibold">% of all</th>
                <th className="px-2.5 py-2 text-right font-semibold">% of settled</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-gray-100">
                  <td className="px-2.5 py-1.5 font-medium text-gray-700">{r.label}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtInt(r.reached)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-blue-700">{fmtInt(r.inProgress)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-500">{fmtInt(r.lost)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-500">{r.rawPct}%</td>
                  <td className="px-2.5 py-1.5 text-right font-semibold tabular-nums">
                    {r.settledPct != null ? `${r.settledPct}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          "% of all" divides by everyone registered in the window, including players who only started
          yesterday — it always understates the step. "% of settled" divides by reached + dropped out
          only, so it estimates where a cohort lands once it has finished playing. The two converge as
          cohorts mature.
        </p>
      </Card>
    </Section>
  );
}

// ── 06 Geography / 07 Sources (shared table shape) ──────────────

const rollupCols = (dimLabel: string): Col<any>[] => [
  { key: 'dim', label: dimLabel, align: 'left' },
  { key: 'users', label: 'Players', align: 'right', fmt: (v) => fmtInt(v) },
  { key: 'new_users_period', label: 'New', align: 'right', fmt: (v) => fmtInt(v) },
  { key: 'active_users', label: 'Active', align: 'right', fmt: (v) => fmtInt(v) },
  { key: 'd1_pct', label: 'D1', align: 'right', fmt: (v) => `${v}%` },
  { key: 'engaged_d0_pct', label: 'EngagedD0', align: 'right', fmt: (v) => `${v}%` },
  { key: 'stage4_users', label: 'Stage 4+', align: 'right', fmt: (v) => fmtInt(v) },
  { key: 'harvest_users', label: 'Harvests', align: 'right', fmt: (v) => fmtInt(v) },
  { key: 'ad_revenue_cents', label: 'Ad revenue', align: 'right', fmt: (v) => fmtMoney(v) },
  { key: 'offer_completions', label: 'Offer plays', align: 'right', fmt: (v) => fmtInt(v) },
  { key: 'waterings', label: 'Waterings', align: 'right', fmt: (v) => fmtCompact(v) },
];

function GeoSection({ q }: { q: ReportQuery }) {
  if (q.isPending) return <Section id="sec-geo" num="06" title="Geography"><Loading /></Section>;
  if (q.isError || !q.data) return <Section id="sec-geo" num="06" title="Geography"><LoadError msg={(q.error as Error)?.message} /></Section>;
  return (
    <Section id="sec-geo" num="06" title="Geography"
             subtitle="Who plays where, and which geos actually progress and monetize. Click a column to sort.">
      <Card>
        <SortableTable columns={rollupCols('Country')} rows={q.data.rows ?? []}
                       initialSort="users" rowKey={(r) => r.dim} maxRows={12} />
      </Card>
    </Section>
  );
}

function SourcesSection({ q }: { q: ReportQuery }) {
  if (q.isPending) return <Section id="sec-sources" num="07" title="Acquisition sources"><Loading /></Section>;
  if (q.isError || !q.data) return <Section id="sec-sources" num="07" title="Acquisition sources"><LoadError msg={(q.error as Error)?.message} /></Section>;
  const partners: any[] = q.data.partners ?? [];
  return (
    <Section id="sec-sources" num="07" title="Acquisition sources"
             subtitle="Quality by media source (AppsFlyer first, then UTM), plus the affiliate ledger.">
      <Card>
        <SortableTable columns={rollupCols('Source')} rows={q.data.rows ?? []}
                       initialSort="users" rowKey={(r) => r.dim} maxRows={12} />
      </Card>
      {partners.length > 0 && (
        <Card className="mt-3">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Affiliate partners (conversion ledger)</h3>
          <SortableTable
            columns={[
              { key: 'name', label: 'Partner', align: 'left', fmt: (v, r) => <span>{v} <span className="text-xs text-gray-400">({r.status})</span></span> },
              { key: 'installs', label: 'Installs', align: 'right', fmt: (v) => fmtInt(v) },
              { key: 'stage_4', label: 'Stage 4', align: 'right', fmt: (v) => fmtInt(v) },
              { key: 'harvests', label: 'Harvests', align: 'right', fmt: (v) => fmtInt(v) },
              { key: 'reversed', label: 'Reversed', align: 'right', fmt: (v) => fmtInt(v) },
              { key: 'payout_cents', label: 'Payout (approved)', align: 'right', fmt: (v) => fmtMoney(v) },
            ]}
            rows={partners} initialSort="installs" rowKey={(r) => r.id}
          />
        </Card>
      )}
    </Section>
  );
}

// ── 08 Ad inventory ─────────────────────────────────────────────

/**
 * Editable eCPM assumption. Kept in local text state so typing "2.5"
 * isn't fought by a re-format on every keystroke; the value commits on
 * blur or Enter.
 */
function EcpmInput({ cents, onCommit }: { cents: number; onCommit: (c: number | null) => void }) {
  const [text, setText] = useState((cents / 100).toFixed(2));
  useEffect(() => { setText((cents / 100).toFixed(2)); }, [cents]);
  const commit = () => {
    const v = parseFloat(text.replace(',', '.'));
    onCommit(Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-gray-500">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm tabular-nums text-gray-900"
      />
    </span>
  );
}

function InventorySection({
  q, ecpmOverride, onEcpm,
}: {
  q: ReportQuery; ecpmOverride: number | null; onEcpm: (c: number | null) => void;
}) {
  if (q.isPending) return <Section id="sec-inventory" num="08" title="Ad inventory"><Loading /></Section>;
  if (q.isError || !q.data) return <Section id="sec-inventory" num="08" title="Ad inventory"><LoadError msg={(q.error as Error)?.message} /></Section>;
  const t = q.data.totals ?? {};
  const daily = fillDays<any>(q.data.daily ?? [], {
    opportunities: 0, sdk_impressions: 0, mock_impressions: 0, rewards_granted: 0, revenue_cents: 0, impressions: 0,
  });
  const observed: number | null = t.observed_ecpm_cents ?? null;
  const effectiveEcpm = ecpmOverride ?? observed ?? DEFAULT_ECPM_CENTS;
  const valueOf = (impressions: number) => (impressions * effectiveEcpm) / 1000;
  const potential = valueOf(t.impressions ?? 0);
  const realized = t.revenue_cents ?? 0;

  // Derive the estimate as a real column so the table can sort on it —
  // two columns sharing one key would collide on both sort and React key.
  const placements: any[] = (q.data.by_placement ?? []).map((r: any) => ({
    ...r,
    est_value_cents: valueOf(r.impressions ?? 0),
  }));

  const steps: FunnelStep[] = [
    { label: 'Ad opportunity (tap)', value: t.opportunities ?? 0 },
    { label: 'Impression delivered', value: t.impressions ?? 0, note: `${fmtInt(t.sdk_impressions ?? 0)} real + ${fmtInt(t.mock_impressions ?? 0)} mock` },
    { label: 'Watched to the end', value: t.completions ?? 0 },
    { label: 'Reward paid (server)', value: t.rewards_granted ?? 0 },
    { label: 'Paid by network', value: t.monetized_impressions ?? 0 },
  ];

  const placementCols: Col<any>[] = [
    { key: 'placement', label: 'Placement', align: 'left' },
    { key: 'opportunities', label: 'Taps', align: 'right', fmt: (v) => fmtInt(v) },
    { key: 'impressions', label: 'Impressions', align: 'right', fmt: (v) => fmtInt(v) },
    { key: 'sdk_impressions', label: 'Real', align: 'right', fmt: (v) => fmtInt(v) },
    { key: 'mock_impressions', label: 'Mock', align: 'right', fmt: (v) => fmtInt(v) },
    { key: 'viewing_users', label: 'Players', align: 'right', fmt: (v) => fmtInt(v) },
    { key: 'rewards_granted', label: 'Rewards', align: 'right', fmt: (v) => fmtInt(v) },
    { key: 'revenue_cents', label: 'Realized', align: 'right', fmt: (v) => fmtMoney(v) },
    {
      key: 'est_value_cents', label: 'Est. value', align: 'right',
      fmt: (v) => <span className="text-gray-500">{fmtMoney(v)}</span>,
    },
  ];

  return (
    <Section id="sec-inventory" num="08" title="Ad inventory"
             subtitle="Every rewarded ad the game actually delivered — real or mock — because the user action is the same either way.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Ad opportunities" value={fmtInt(t.opportunities ?? 0)}
             sub={`${fmtInt(t.requesting_users ?? 0)} players tapped "watch ad"`} />
        <Kpi label="Impressions delivered" value={fmtInt(t.impressions ?? 0)}
             sub={`${t.delivery_pct ?? 0}% of taps · ${fmtInt(t.viewing_users ?? 0)} players`} />
        <Kpi label="Real vs mock"
             value={`${fmtInt(t.sdk_impressions ?? 0)} / ${fmtInt(t.mock_impressions ?? 0)}`}
             sub={`${fmtInt(t.no_fill ?? 0)} no-fills · ${fmtInt(t.failed ?? 0)} SDK errors`} />
        <Kpi label="Impressions the network paid for"
             value={`${t.monetized_pct ?? 0}%`}
             sub={`${fmtInt(t.monetized_impressions ?? 0)} of ${fmtInt(t.impressions ?? 0)}`} />
      </div>

      {/* The estimate is deliberately fenced off from realized revenue:
          it is an assumption about inventory that was never sold, not a
          number the network reported. */}
      <Card className="mt-3 border-dashed bg-amber-50/40">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">What this inventory was worth</h3>
            <p className="mt-1 max-w-2xl text-xs text-gray-500">
              Players performed {fmtInt(t.impressions ?? 0)} ad views in this window. Only{' '}
              {fmtInt(t.monetized_impressions ?? 0)} were monetized — the rest were mock fallbacks or
              real shows the network never reported, because the SDK was disabled or misconfigured.
              The same player behaviour behind a working network would have earned roughly:
            </p>
          </div>
          <div className="no-print flex items-center gap-2 text-sm">
            <span className="text-gray-600">Assumed eCPM</span>
            <EcpmInput cents={effectiveEcpm} onCommit={onEcpm} />
            {ecpmOverride != null && (
              <button onClick={() => onEcpm(null)} className="text-xs text-blue-600 hover:underline">
                reset
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Potential ad revenue" value={fmtMoney(potential)}
               sub={`${fmtInt(t.impressions ?? 0)} impressions × $${(effectiveEcpm / 100).toFixed(2)} eCPM`} />
          <Kpi label="Realized (actually paid)" value={fmtMoney(realized)} />
          <Kpi label="Left on the table" value={fmtMoney(Math.max(0, potential - realized))}
               sub="potential minus realized" />
          <Kpi label="Impressions per active day" value={t.impressions_per_active_day ?? 0}
               sub={`over ${fmtInt(t.active_user_days ?? 0)} active player-days`} />
        </div>
        <p className="mt-2 text-xs text-gray-400">
          eCPM source: {observed != null
            ? <>observed {fmtMoney(observed)} from {fmtInt(t.monetized_impressions ?? 0)} paid impressions in this window</>
            : <>no paid impressions in this window — falling back to a {fmtMoney(DEFAULT_ECPM_CENTS)} placeholder</>}
          {ecpmOverride != null && ' · currently overridden manually'}. This figure is an estimate and
          is never added to realized revenue anywhere else in this report.
        </p>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Impressions per day — real vs mock</h3>
          <ColumnChart
            data={daily.map((r) => ({ label: r.day, parts: [r.sdk_impressions, r.mock_impressions] }))}
            names={['Real (SDK)', 'Mock fallback']}
            colors={[SERIES[0], SERIES[1]]}
          />
          <p className="mt-1 text-xs text-gray-400">
            Stretches that are all-orange are periods when the network served nothing and players were
            shown the fallback — demand existed, supply did not.
          </p>
        </Card>
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-gray-700">From tap to payout (window)</h3>
          <FunnelBars steps={steps} />
          <p className="mt-2 text-xs text-gray-400">
            The drop from "Impression delivered" to "Paid by network" is lost revenue, not lost
            engagement — those players watched an ad and got their reward either way.
          </p>
        </Card>
      </div>

      <Card className="mt-3">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">By placement</h3>
        <SortableTable columns={placementCols} rows={placements}
                       initialSort="impressions" rowKey={(r) => r.placement} />
        <p className="mt-2 text-xs text-gray-400">
          water_popup / fert_popup = extra water and fertilizer. bucket_collect = the bucket tap
          (the first two collects each day are free, so only the rest generate an ad opportunity).
          quest = the watch-an-ad daily quest.
        </p>
      </Card>
    </Section>
  );
}

// ── 09 Partner games ────────────────────────────────────────────

function OffersSection({ q }: { q: ReportQuery }) {
  if (q.isPending) return <Section id="sec-offers" num="09" title="Partner games"><Loading /></Section>;
  if (q.isError || !q.data) return <Section id="sec-offers" num="09" title="Partner games"><LoadError msg={(q.error as Error)?.message} /></Section>;
  const t = q.data.totals ?? {};
  const rows: any[] = q.data.rows ?? [];
  const daily = fillDays<any>(q.data.daily ?? [], { installs: 0, completions: 0 });
  const anyOpens = rows.some((r) => r.opens > 0);

  const cols: Col<any>[] = [
    {
      key: 'name', label: 'Game', align: 'left',
      fmt: (v, r) => (
        <span className={r.active ? '' : 'text-gray-400'}>
          {v}{!r.active && <span className="ml-1 text-xs">(off)</span>}
        </span>
      ),
    },
    { key: 'opening_users', label: 'Opened by', align: 'right', fmt: (v) => fmtInt(v) },
    { key: 'installs', label: 'Installs (unique)', align: 'right', fmt: (v) => <span className="font-semibold">{fmtInt(v)}</span> },
    {
      key: 'open_to_install_pct', label: 'Open → install', align: 'right',
      fmt: (v) => (v == null ? <span className="text-gray-300">—</span> : `${v}%`),
    },
    { key: 'deeper_players', label: 'Went deeper', align: 'right', fmt: (v) => fmtInt(v) },
    { key: 'completions', label: 'Milestones hit', align: 'right', fmt: (v) => fmtInt(v) },
    { key: 'milestone_count', label: 'Milestones defined', align: 'right', fmt: (v) => fmtInt(v) },
  ];

  return (
    <Section id="sec-offers" num="09" title="Partner games"
             subtitle="The second revenue line: studios pay per install, so unique installing players is the number that matters — not how deep they got.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Installs (billable)" value={fmtInt(t.installs ?? 0)}
             sub={`${fmtInt(t.unique_installers ?? 0)} distinct players across all games`} />
        <Kpi label="Games live" value={fmtInt(t.games_live ?? 0)} />
        <Kpi label="Players who opened a game" value={fmtInt(t.unique_openers ?? 0)}
             sub={`${fmtInt(t.opens ?? 0)} opens total`} />
        <Kpi label="Milestones credited" value={fmtInt(t.completions ?? 0)}
             sub={`${fmtInt(t.unique_players ?? 0)} players earned at least one reward`} />
      </div>

      <Card className="mt-3">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Installs per game</h3>
        <SortableTable columns={cols} rows={rows} initialSort="installs" rowKey={(r) => r.id} />
        <p className="mt-2 text-xs text-gray-400">
          An install is the first milestone of an offer confirmed by an Everflow postback — the same
          definition the partner bills against. "Installs (unique)" counts distinct players per game,
          so the column does not sum to the distinct-players figure above when someone installs more
          than one game.
          {!anyOpens && ' Game opens are only recorded from the release that added that tracking, so this window shows none.'}
        </p>
      </Card>

      {daily.length > 1 && (
        <Card className="mt-3">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Installs per day</h3>
          <ColumnChart
            data={daily.map((r) => ({ label: r.day, parts: [r.installs] }))}
            names={['Installs']} colors={[SERIES[2]]}
          />
        </Card>
      )}
    </Section>
  );
}

// ── 10 Monetization ─────────────────────────────────────────────

function MonetizationSection({ q }: { q: ReportQuery }) {
  if (q.isPending) return <Section id="sec-monetization" num="10" title="Monetization"><Loading /></Section>;
  if (q.isError || !q.data) return <Section id="sec-monetization" num="10" title="Monetization"><LoadError msg={(q.error as Error)?.message} /></Section>;
  const d = q.data;
  const daily = fillDays<any>(d.daily ?? [], { revenue_cents: 0, paid_impressions: 0, rewards_paid: 0 });
  return (
    <Section id="sec-monetization" num="10" title="Monetization"
             subtitle="Money that actually landed: rewarded-video revenue reported by the network, and what we owe in coupons.">
      <Card>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Ad revenue per day (USD, realized)</h3>
        <LineChart
          labels={daily.map((r) => r.day)} area
          series={[{
            name: 'Revenue', color: SERIES[0],
            values: daily.map((r) => Math.round(r.revenue_cents) / 100),
            fmt: (v) => `$${v.toFixed(2)}`,
          }]}
        />
        <p className="mt-1 text-xs text-gray-400">
          Only impressions the network reported through ILRD. Delivered inventory — including every
          mock impression — is in <a href="#sec-inventory" className="text-blue-600 hover:underline">Ad inventory</a>.
        </p>
      </Card>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Revenue by network</h3>
          <SortableTable
            columns={[
              { key: 'dim', label: 'Network', align: 'left' },
              { key: 'impressions', label: 'Impr.', align: 'right', fmt: (v) => fmtInt(v) },
              { key: 'revenue_cents', label: 'Revenue', align: 'right', fmt: (v) => fmtMoney(v) },
            ]}
            rows={d.by_network ?? []} initialSort="revenue_cents" rowKey={(r) => r.dim}
          />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Revenue by placement</h3>
          <SortableTable
            columns={[
              { key: 'dim', label: 'Placement', align: 'left' },
              { key: 'impressions', label: 'Impr.', align: 'right', fmt: (v) => fmtInt(v) },
              { key: 'revenue_cents', label: 'Revenue', align: 'right', fmt: (v) => fmtMoney(v) },
            ]}
            rows={d.by_placement ?? []} initialSort="revenue_cents" rowKey={(r) => r.dim}
          />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Coupon liability (harvest rewards)</h3>
          <SortableTable
            columns={[
              { key: 'name_key', label: 'Product', align: 'left', fmt: (v) => String(v).replace('product.', '') },
              { key: 'issued', label: 'Issued', align: 'right', fmt: (v) => fmtInt(v) },
              { key: 'value_cents', label: 'Value', align: 'right', fmt: (v) => fmtMoney(v) },
              { key: 'redeemed', label: 'Redeemed', align: 'right', fmt: (v) => fmtInt(v) },
            ]}
            rows={d.coupons ?? []} initialSort="issued" rowKey={(r) => r.name_key}
          />
        </Card>
      </div>
    </Section>
  );
}
