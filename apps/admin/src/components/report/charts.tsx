import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Minimal chart kit for the Insights report — inline SVG/HTML, no
 * chart library (same approach as DashboardPage's Sparkline).
 *
 * Colors follow the validated reference dataviz palette:
 *   categorical slots 1-3 (blue / orange / aqua) — all-pairs CVD-safe,
 *   sequential = one blue ramp for magnitude,
 *   grid/axis inks are recessive grays, text never wears series color.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'] as const;
/** Sequential blue ramp, light→dark (steps 100…700). */
export const SEQ = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7',
  '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b',
] as const;
/** Ordinal ramp slice (discrete ordered marks): starts at step 250 per spec. */
export const ORDINAL = SEQ.slice(3);
const GRID = '#e1e0d9';
const MUTED = '#898781';
const AXIS = '#c3c2b7';

export const fmtInt = (v: number) => (v ?? 0).toLocaleString('en-US');
export const fmtMoney = (cents: number) => `$${((cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtPct = (v: number) => `${v ?? 0}%`;
export const fmtCompact = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 10_000 ? `${Math.round(v / 1000)}K` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v ?? 0));

/** Axis-tick formatter: keeps one decimal on small fractional scales
 *  (e.g. a $2.50 revenue axis) where rounding would duplicate labels. */
const fmtTick = (v: number) =>
  v > 0 && v < 10 && !Number.isInteger(v) ? v.toFixed(1) : fmtCompact(v);

/** "Nice" upper bound for a y-axis. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

const shortDay = (iso: string) => {
  // '2026-07-26' → 'Jul 26'
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

function Legend({ items }: { items: { name: string; color: string }[] }) {
  if (items.length < 2) return null; // single series: the title names it
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((it) => (
        <span key={it.name} className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}

// ── Line chart with crosshair + tooltip ─────────────────────────

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  fmt?: (v: number) => string;
}

export function LineChart({
  labels,
  series,
  height = 200,
  area = false,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  area?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const pad = { l: 46, r: 14, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const n = labels.length;

  const yMax = useMemo(
    () => niceMax(Math.max(1, ...series.flatMap((s) => s.values))),
    [series],
  );
  const x = (i: number) => pad.l + (n > 1 ? (i * iw) / (n - 1) : iw / 2);
  const y = (v: number) => pad.t + ih - (v / yMax) * ih;

  if (!n) return <p className="text-sm text-gray-400">No data</p>;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);
  // Sparse x labels: first, last and ~4 in between.
  const step = Math.max(1, Math.ceil(n / 6));
  const xTicks = labels.map((_, i) => i).filter((i) => i % step === 0 || i === n - 1);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - pad.l) / iw) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={MUTED}>
              {fmtTick(t)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke={AXIS} strokeWidth={1} />
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={10} fill={MUTED}>
            {shortDay(labels[i])}
          </text>
        ))}
        {series.map((s) => {
          // A one-point series draws nothing as a polyline (and a
          // bogus triangle as an area) — render a marker dot instead.
          if (n === 1) {
            return (
              <circle key={s.name} cx={x(0)} cy={y(s.values[0] ?? 0)} r={4}
                      fill={s.color} stroke="#ffffff" strokeWidth={2} />
            );
          }
          const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
          return (
            <g key={s.name}>
              {area && (
                <polygon
                  points={`${pad.l},${pad.t + ih} ${pts} ${x(n - 1).toFixed(1)},${pad.t + ih}`}
                  fill={s.color}
                  opacity={0.1}
                />
              )}
              <polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke={AXIS} strokeWidth={1} />
            {series.map((s) => (
              <circle
                key={s.name}
                cx={x(hover)}
                cy={y(s.values[hover] ?? 0)}
                r={4}
                fill={s.color}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${((x(hover) / W) * 100).toFixed(1)}%`,
            transform: x(hover) > W / 2 ? 'translateX(-105%)' : 'translateX(8px)',
          }}
        >
          <p className="font-semibold text-gray-900">{shortDay(labels[hover])}</p>
          {series.map((s) => (
            <p key={s.name} className="flex items-center gap-1.5 text-gray-600">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name}: <span className="font-medium text-gray-900">{(s.fmt ?? fmtInt)(s.values[hover] ?? 0)}</span>
            </p>
          ))}
        </div>
      )}
      <Legend items={series.map((s) => ({ name: s.name, color: s.color }))} />
    </div>
  );
}

// ── Column chart (single series or stacked) ─────────────────────

export interface StackedDatum {
  label: string;
  /** One value per series (aligned with `names`/`colors`). */
  parts: number[];
}

export function ColumnChart({
  data,
  names,
  colors,
  height = 200,
  fmt = fmtInt,
  xLabel,
}: {
  data: StackedDatum[];
  names: string[];
  colors: string[];
  height?: number;
  fmt?: (v: number) => string;
  /** Optional label formatter for x categories. */
  xLabel?: (label: string, i: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const pad = { l: 46, r: 14, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const n = data.length;
  const totals = data.map((d) => d.parts.reduce((a, b) => a + b, 0));
  const yMax = niceMax(Math.max(1, ...totals));
  if (!n) return <p className="text-sm text-gray-400">No data</p>;

  const band = iw / n;
  const barW = Math.min(24, Math.max(3, band * 0.62));
  const GAP = 2; // surface gap between stacked segments
  const y = (v: number) => pad.t + ih - (v / yMax) * ih;
  const ticks = [0, 0.5, 1].map((f) => yMax * f);
  const step = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={MUTED}>
              {fmtTick(t)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke={AXIS} strokeWidth={1} />
        {data.map((d, i) => {
          const cx = pad.l + band * i + band / 2;
          let acc = 0;
          const segs: ReactNode[] = [];
          const lastNonZero = d.parts.reduce((m, v, j) => (v > 0 ? j : m), -1);
          d.parts.forEach((v, j) => {
            if (v <= 0) return;
            const y0 = y(acc);
            const y1 = y(acc + v);
            const h = Math.max(0, y0 - y1 - (j < lastNonZero ? GAP : 0));
            const isTop = j === lastNonZero;
            const r = Math.min(4, h);
            const xL = cx - barW / 2;
            segs.push(
              isTop ? (
                <path
                  key={j}
                  d={`M ${xL} ${y1 + h} L ${xL} ${y1 + r} Q ${xL} ${y1} ${xL + r} ${y1} L ${xL + barW - r} ${y1} Q ${xL + barW} ${y1} ${xL + barW} ${y1 + r} L ${xL + barW} ${y1 + h} Z`}
                  fill={colors[j]}
                />
              ) : (
                <rect key={j} x={xL} y={y1} width={barW} height={h} fill={colors[j]} />
              ),
            );
            acc += v;
          });
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)}>
              {/* invisible full-band hit target — bigger than the mark */}
              <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" />
              {segs}
            </g>
          );
        })}
        {data.map((d, i) =>
          i % step === 0 || i === n - 1 ? (
            <text
              key={d.label}
              x={pad.l + band * i + band / 2}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill={MUTED}
            >
              {xLabel ? xLabel(d.label, i) : shortDay(d.label)}
            </text>
          ) : null,
        )}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${(((pad.l + (iw / n) * hover + iw / n / 2) / W) * 100).toFixed(1)}%`,
            transform: hover > n / 2 ? 'translateX(-105%)' : 'translateX(8px)',
          }}
        >
          <p className="font-semibold text-gray-900">
            {xLabel ? xLabel(data[hover].label, hover) : shortDay(data[hover].label)}
          </p>
          {names.length > 1 ? (
            names.map((nm, j) => (
              <p key={nm} className="flex items-center gap-1.5 text-gray-600">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: colors[j] }} />
                {nm}: <span className="font-medium text-gray-900">{fmt(data[hover].parts[j] ?? 0)}</span>
              </p>
            ))
          ) : (
            <p className="text-gray-600">
              {names[0]}: <span className="font-medium text-gray-900">{fmt(totals[hover])}</span>
            </p>
          )}
        </div>
      )}
      <Legend items={names.map((nm, j) => ({ name: nm, color: colors[j] }))} />
    </div>
  );
}

// ── Horizontal funnel ───────────────────────────────────────────

export interface FunnelStep {
  label: string;
  value: number;
  note?: string;
}

export function FunnelBars({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const widthPct = Math.max(0.8, (s.value / max) * 100);
        const ofFirst = max > 0 ? Math.round((s.value / max) * 1000) / 10 : 0;
        const prev = i > 0 ? steps[i - 1].value : s.value;
        const ofPrev = prev > 0 ? Math.round((s.value / prev) * 1000) / 10 : 0;
        const color = ORDINAL[Math.min(ORDINAL.length - 1, i)];
        const labelInside = widthPct > 22;
        return (
          <div key={s.label} className="group flex items-center gap-3">
            <div className="w-36 shrink-0 text-right text-xs font-medium text-gray-600">
              {s.label}
              {s.note && <span className="block text-[10px] font-normal text-gray-400">{s.note}</span>}
            </div>
            <div className="relative h-6 flex-1">
              <div
                className="flex h-6 items-center rounded-r-[4px]"
                style={{ width: `${widthPct}%`, background: color, minWidth: 4 }}
              >
                {labelInside && (
                  <span className="px-2 text-xs font-semibold tabular-nums" style={{ color: i < 3 ? '#0b0b0b' : '#ffffff' }}>
                    {fmtInt(s.value)}
                  </span>
                )}
              </div>
              {!labelInside && (
                <span
                  className="absolute top-1/2 -translate-y-1/2 text-xs font-semibold tabular-nums text-gray-900"
                  style={{ left: `calc(${widthPct}% + 8px)` }}
                >
                  {fmtInt(s.value)}
                </span>
              )}
            </div>
            <div className="w-28 shrink-0 text-xs tabular-nums text-gray-500">
              {ofFirst}%{i > 0 && <span className="text-gray-400"> · step {ofPrev}%</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Heat cell (sequential ramp) ─────────────────────────────────

export function heatColor(pct: number, maxPct: number): { bg: string; ink: string } {
  if (!pct || maxPct <= 0) return { bg: 'transparent', ink: '#6b7280' };
  const f = Math.max(0, Math.min(1, pct / maxPct));
  const idx = Math.round(f * (SEQ.length - 1));
  return { bg: SEQ[idx], ink: idx >= 6 ? '#ffffff' : '#0b0b0b' };
}

// ── Sortable table ──────────────────────────────────────────────

export interface Col<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  fmt?: (v: any, row: T) => ReactNode;
  sortable?: boolean;
}

export function SortableTable<T extends Record<string, any>>({
  columns,
  rows,
  initialSort,
  rowKey,
  maxRows,
}: {
  columns: Col<T>[];
  rows: T[];
  initialSort: string;
  rowKey: (r: T) => string;
  maxRows?: number;
}) {
  const [sortKey, setSortKey] = useState(initialSort);
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return dir === 'desc' ? bv - av : av - bv;
      return dir === 'desc'
        ? String(bv ?? '').localeCompare(String(av ?? ''))
        : String(av ?? '').localeCompare(String(bv ?? ''));
    });
    return arr;
  }, [rows, sortKey, dir]);

  const visible = maxRows && !expanded ? sorted.slice(0, maxRows) : sorted;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            {columns.map((c) => (
              <th
                key={c.key}
                className={[
                  'px-2.5 py-2 font-semibold whitespace-nowrap',
                  c.align === 'right' ? 'text-right' : '',
                  c.sortable !== false ? 'cursor-pointer select-none hover:text-gray-800' : '',
                ].join(' ')}
                onClick={() => {
                  if (c.sortable === false) return;
                  if (sortKey === c.key) setDir(dir === 'desc' ? 'asc' : 'desc');
                  else { setSortKey(c.key); setDir('desc'); }
                }}
              >
                {c.label}
                {sortKey === c.key && <span className="ml-1 text-gray-400">{dir === 'desc' ? '▾' : '▴'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={rowKey(r)} className="border-b border-gray-100 hover:bg-gray-50">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={['px-2.5 py-2 tabular-nums whitespace-nowrap', c.align === 'right' ? 'text-right' : ''].join(' ')}
                >
                  {c.fmt ? c.fmt(r[c.key], r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-2.5 py-6 text-center text-gray-400">
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {maxRows && sorted.length > maxRows && (
        <button
          className="no-print mt-2 text-xs font-medium text-blue-600 hover:underline"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}
