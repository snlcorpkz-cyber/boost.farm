import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getToken } from '@/lib/api';
import { formatDate, formatInt, formatUsd } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';

interface ConversionRow {
  id: string;
  clickId: string | null;
  eventType: string;
  payoutCents: number;
  status: string;
  holdUntil: string | null;
  createdAt: string;
  userIdHash: string;
}

interface ConversionsResponse {
  total: number;
  limit: number;
  offset: number;
  rows: ConversionRow[];
}

export function ConversionsPage() {
  const [status, setStatus] = useState<string>('');
  const [event, setEvent] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const { data, isPending } = useQuery<ConversionsResponse>({
    queryKey: ['partner', 'conversions', status, event, offset],
    queryFn: () => {
      const q = new URLSearchParams();
      q.set('limit', String(limit));
      q.set('offset', String(offset));
      if (status) q.set('status', status);
      if (event) q.set('event', event);
      return api(`/conversions?${q}`);
    },
  });

  const handleExport = () => {
    const token = getToken();
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (event) q.set('event', event);
    const url = `/api/partner/conversions/export.csv?${q}`;
    // Use fetch + blob since GET with Authorization header can't be done from a plain <a> tag
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `conversions-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  const rows = data?.rows ?? [];
  const hasAny = rows.length > 0 || offset > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conversions</h1>
          <p className="mt-1 text-sm text-gray-500">
            Every billable event attributed to your traffic. Click IDs shown exactly as you sent them.
          </p>
        </div>
        <button
          onClick={handleExport}
          className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="paid">Paid</option>
          <option value="rejected">Rejected</option>
          <option value="duplicate">Duplicate</option>
        </select>
        <select
          value={event}
          onChange={(e) => { setEvent(e.target.value); setOffset(0); }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">All events</option>
          <option value="install">Install</option>
          <option value="first_play">First play</option>
          <option value="stage_reached">Stage reached</option>
          <option value="harvest">Harvest</option>
        </select>
      </div>

      {isPending ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading…</div>
      ) : !hasAny ? (
        <EmptyState
          icon="🧾"
          title="No conversions yet"
          description="As your users hit billable events (installs, harvests, etc.), they'll appear here with their click ID and payout."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">When</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Click ID</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">User (hashed)</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Event</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Payout</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-700">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.clickId ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-400">{r.userIdHash}</td>
                    <td className="px-4 py-2 font-medium text-gray-700">{r.eventType}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{formatUsd(r.payoutCents)}</td>
                    <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm">
            <p className="text-gray-500">
              Showing <span className="font-semibold text-gray-700">{formatInt(rows.length)}</span> of{' '}
              <span className="font-semibold text-gray-700">{formatInt(data?.total ?? 0)}</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={rows.length < limit}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
