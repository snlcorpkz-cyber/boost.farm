import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';

/**
 * Drill-down for a single cell on the retention cohort table.
 *
 * Accessed via a query-string URL (not path params) because we need to
 * carry the cohort filters alongside the (date, offset) pair without
 * building a rigid route pattern:
 *
 *   /retention/cohort?date=2026-04-23&offset=1&group_by=day
 *                    [&country=KZ&platform=android&rank=farmer&utm_source=facebook]
 *
 *   offset omitted (or "all") -> shows every user that made up the cohort
 *   size. Otherwise shows only users retained on that day/week.
 */

function RankBadge({ rank }: { rank: string }) {
  const colors: Record<string, string> = {
    novice: 'bg-gray-100 text-gray-600',
    amateur: 'bg-green-100 text-green-700',
    farmer: 'bg-blue-100 text-blue-700',
    master: 'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${colors[rank] || 'bg-gray-100'}`}>
      {rank}
    </span>
  );
}

function relative(ts: string | null | undefined): string {
  if (!ts) return '-';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 0) return 'now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}

function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function CohortUsersPage() {
  const [searchParams] = useSearchParams();
  const date = searchParams.get('date') || '';
  const offsetRaw = searchParams.get('offset');
  const offset = offsetRaw && offsetRaw !== 'all' ? Number(offsetRaw) : null;
  const groupBy = (searchParams.get('group_by') === 'week' ? 'week' : 'day') as 'day' | 'week';
  const country = searchParams.get('country') || '';
  const platform = searchParams.get('platform') || '';
  const rank = searchParams.get('rank') || '';
  const utmSource = searchParams.get('utm_source') || '';
  const partnerId = searchParams.get('partner_id') || '';

  const qs = new URLSearchParams({
    date,
    group_by: groupBy,
    ...(offset !== null ? { offset: String(offset) } : {}),
    ...(country ? { country } : {}),
    ...(platform ? { platform } : {}),
    ...(rank ? { rank } : {}),
    ...(utmSource ? { utm_source: utmSource } : {}),
    ...(partnerId ? { partner_id: partnerId } : {}),
  }).toString();

  const { data, isPending, error } = useQuery<any>({
    queryKey: ['admin', 'retention', 'cohort-users', qs],
    queryFn: () => api(`/retention/cohort-users?${qs}`),
    enabled: !!date,
  });

  const users: any[] = data?.users || [];
  const periodLabel = groupBy === 'week' ? 'Week' : 'Day';
  const offsetLabel =
    offset === null
      ? 'All users in cohort'
      : `${groupBy === 'week' ? 'W' : 'D'}${offset} retained`;

  // Build a back-link that re-applies the same filters on the retention
  // page, so the user lands back on the view they came from.
  const backQs = new URLSearchParams({
    group_by: groupBy,
    ...(country ? { country } : {}),
    ...(platform ? { platform } : {}),
    ...(rank ? { rank } : {}),
    ...(utmSource ? { utm_source: utmSource } : {}),
    ...(partnerId ? { partner_id: partnerId } : {}),
  }).toString();

  // Friendly label for the partner chip — 'organic'/'any' get a verbose
  // name, a UUID is shown via the first row's partner_name (if present)
  // and otherwise truncated to keep the chip compact.
  let partnerChipLabel: string | null = null;
  if (partnerId === 'organic') partnerChipLabel = 'Organic only';
  else if (partnerId === 'any') partnerChipLabel = 'Any partner';
  else if (partnerId) {
    const fromRow = users.find((u) => u.partner_id === partnerId);
    partnerChipLabel = fromRow?.partner_name || `${partnerId.slice(0, 8)}…`;
  }

  const filterChips: Array<{ label: string; value: string }> = [
    country ? { label: 'Country', value: country } : null,
    platform ? { label: 'Platform', value: platform } : null,
    rank ? { label: 'Rank', value: rank } : null,
    utmSource ? { label: 'UTM', value: utmSource } : null,
    partnerChipLabel ? { label: 'Source', value: partnerChipLabel } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (!date) {
    return (
      <div>
        <Link to="/retention" className="text-sm text-blue-600 hover:underline">&larr; Back to Retention</Link>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Missing <code>date</code> parameter.
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to={`/retention${backQs ? `?${backQs}` : ''}`} className="text-sm text-blue-600 hover:underline mb-3 inline-block">
        &larr; Back to Retention
      </Link>

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Cohort drill-down</h1>
        <span className="text-sm text-gray-500">
          {periodLabel} of{' '}
          <span className="font-semibold text-gray-700">
            {new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
          </span>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
          offset === null ? 'bg-gray-100 text-gray-700' : 'bg-blue-100 text-blue-700'
        }`}>
          {offsetLabel}
        </span>
        {filterChips.map((c) => (
          <span key={c.label} className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs text-amber-800">
            <span className="font-semibold">{c.label}:</span> {c.value}
          </span>
        ))}
        <span className="ml-auto text-sm text-gray-500">
          {isPending ? '...' : `${users.length} user${users.length === 1 ? '' : 's'}`}
          {users.length === 500 && (
            <span className="ml-1 text-amber-600">(capped at 500)</span>
          )}
        </span>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">User</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Rank</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Geo / Platform</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Registered</th>
                {offset !== null && (
                  <>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600" title="Events on the retention day/week">
                      Events on {groupBy === 'week' ? 'W' : 'D'}{offset}
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600" title="First event on the retention day/week (user's local server-UTC time)">
                      First return
                    </th>
                  </>
                )}
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isPending ? (
                <tr>
                  <td colSpan={offset !== null ? 8 : 6} className="px-4 py-8 text-center text-gray-500">
                    Loading users...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={offset !== null ? 8 : 6} className="px-4 py-8 text-center text-red-600">
                    {(error as Error).message}
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={offset !== null ? 8 : 6} className="px-4 py-10 text-center text-gray-500">
                    {offset !== null
                      ? 'Nobody from this cohort returned on that day.'
                      : 'Cohort is empty.'}
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-blue-50/40">
                    <td className="px-4 py-3">
                      <Link
                        to={`/users/${u.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {u.nickname || '(no name)'}
                      </Link>
                      <div className="text-[10px] text-gray-400 font-mono truncate max-w-[180px]">
                        {u.id}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.email || '-'}</td>
                    <td className="px-4 py-3">
                      <RankBadge rank={u.rank_id || 'novice'} />
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {[u.country, u.device_platform].filter(Boolean).join(' · ') || '-'}
                      {u.partner_name ? (
                        <div className="mt-0.5">
                          <span className="inline-block rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 px-1.5 py-0.5 text-[10px] font-semibold">
                            {u.partner_name}
                          </span>
                        </div>
                      ) : u.utm_source ? (
                        <div className="text-[10px] text-gray-400">utm: {u.utm_source}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs" title={new Date(u.created_at).toLocaleString()}>
                      {formatDateTime(u.created_at)}
                    </td>
                    {offset !== null && (
                      <>
                        <td className="px-4 py-3 text-right font-semibold text-blue-700">
                          {u.events_on_day ?? 0}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600" title={u.first_event_on_day ? new Date(u.first_event_on_day).toLocaleString() : ''}>
                          {formatDateTime(u.first_event_on_day)}
                        </td>
                      </>
                    )}
                    <td
                      className="px-4 py-3 text-xs"
                      title={u.last_active_at ? new Date(u.last_active_at).toLocaleString() : 'never'}
                    >
                      <span className={u.last_active_at ? 'text-gray-600' : 'text-gray-400'}>
                        {relative(u.last_active_at)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
