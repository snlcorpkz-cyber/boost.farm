import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type HealthStatus = 'ok' | 'warn' | 'fail';

interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
  latencyMs?: number;
}

interface HealthResponse {
  status: HealthStatus;
  checkedAt: string;
  checks: HealthCheck[];
}

const PILL_STYLES: Record<HealthStatus, string> = {
  ok: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  warn: 'bg-amber-100 text-amber-700 border border-amber-200',
  fail: 'bg-red-100 text-red-700 border border-red-200',
};

const CARD_BORDER: Record<HealthStatus, string> = {
  ok: 'border-emerald-200',
  warn: 'border-amber-200',
  fail: 'border-red-200',
};

const PILL_LABEL: Record<HealthStatus, string> = {
  ok: 'OK',
  warn: 'WARN',
  fail: 'FAIL',
};

function StatusPill({ status }: { status: HealthStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL_STYLES[status]}`}
    >
      {PILL_LABEL[status]}
    </span>
  );
}

function CheckCard({ check }: { check: HealthCheck }) {
  return (
    <div
      className={`rounded-xl border ${CARD_BORDER[check.status]} bg-white p-5 shadow-sm`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{check.label}</p>
          <p className="mt-0.5 text-xs font-mono text-gray-400">{check.id}</p>
        </div>
        <StatusPill status={check.status} />
      </div>
      <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap break-words">
        {check.detail}
      </p>
      {typeof check.latencyMs === 'number' && (
        <p className="mt-2 text-xs text-gray-400">Latency: {check.latencyMs} ms</p>
      )}
    </div>
  );
}

export function HealthPage() {
  const { data, isPending, isError, error, refetch, isFetching } = useQuery<HealthResponse>({
    queryKey: ['admin', 'health'],
    queryFn: () => api<HealthResponse>('/health'),
    // Health checks hit external services (Telegram, Resend) — don't blast
    // them with refetches on window focus / network flicker.
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const summary = data?.status;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Health / Test Center</h1>
          <p className="mt-1 text-sm text-gray-500">
            Self-check of the critical backend dependencies. Run before shipping
            or when the app misbehaves.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {summary && <StatusPill status={summary} />}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            {isFetching ? 'Re-running…' : 'Re-run checks'}
          </button>
        </div>
      </div>

      {data && (
        <p className="mt-1 text-xs text-gray-400">
          Last checked: {new Date(data.checkedAt).toLocaleString()}
        </p>
      )}

      {isPending && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-gray-100 bg-gray-50"
            />
          ))}
        </div>
      )}

      {isError && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load health report: {(error as Error)?.message ?? 'unknown error'}
        </div>
      )}

      {data && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.checks.map((c) => (
            <CheckCard key={c.id} check={c} />
          ))}
        </div>
      )}
    </div>
  );
}
