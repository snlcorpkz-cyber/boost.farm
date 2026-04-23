import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';

interface PostbackRow {
  id: string;
  conversionId: string | null;
  status: string;
  attempts: number;
  url: string;
  lastResponseCode: number | null;
  lastError: string | null;
  lastResponseBody: string | null;
  createdAt: string;
  sentAt: string | null;
  nextRetryAt: string;
}

interface PostbacksResponse {
  rows: PostbackRow[];
}

export function PostbacksPage() {
  const { data, isPending } = useQuery<PostbacksResponse>({
    queryKey: ['partner', 'postbacks'],
    queryFn: () => api('/postbacks'),
    refetchInterval: 30_000,
  });

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Postback log</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every server-to-server call we've made to your endpoint. Use this to debug your integration
          and confirm we're reaching you. Refreshes every 30 seconds.
        </p>
      </div>

      {isPending ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="📡"
          title="No postbacks sent yet"
          description="We start firing postbacks the moment your first user triggers a billable event. Make sure your postback URL is set in Settings."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span className="text-xs font-medium text-gray-500">Attempt #{r.attempts}</span>
                  {r.lastResponseCode !== null && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-mono ${
                        r.lastResponseCode >= 200 && r.lastResponseCode < 300
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      HTTP {r.lastResponseCode}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {r.sentAt ? `Sent ${formatDate(r.sentAt)}` : `Queued ${formatDate(r.createdAt)}`}
                </p>
              </div>

              <p className="mt-2 break-all font-mono text-xs text-gray-700 bg-gray-50 rounded-lg px-2.5 py-2">
                {r.url}
              </p>

              {r.lastError && (
                <p className="mt-2 text-xs text-rose-700">
                  <strong>Error:</strong> {r.lastError}
                </p>
              )}
              {r.lastResponseBody && (
                <p className="mt-2 font-mono text-xs text-gray-500">
                  <strong className="text-gray-600">Response:</strong> {r.lastResponseBody}
                </p>
              )}
              {r.status === 'queued' && (
                <p className="mt-2 text-xs text-amber-700">
                  Next retry: {formatDate(r.nextRetryAt)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
