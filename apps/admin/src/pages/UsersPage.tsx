import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fetchUsers } from '@/lib/mock-data';

function FarmBadge({ status }: { status: 'active' | 'dormant' | 'paused' }) {
  const styles: Record<typeof status, string> = {
    active: 'bg-emerald-100 text-emerald-800',
    dormant: 'bg-gray-200 text-gray-700',
    paused: 'bg-amber-100 text-amber-900',
  };
  return (
    <span
      className={[
        'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize',
        styles[status],
      ].join(' ')}
    >
      {status}
    </span>
  );
}

export function UsersPage() {
  const [q, setQ] = useState('');
  const { data: users = [], isPending } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(needle) || u.nickname.toLowerCase().includes(needle),
    );
  }, [users, q]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="mt-1 text-gray-500">Search and review player accounts.</p>
        </div>
        <div className="w-full max-w-sm">
          <label htmlFor="user-search" className="sr-only">
            Search by email or nickname
          </label>
          <input
            id="user-search"
            type="search"
            placeholder="Search email or nickname…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-700">Nickname</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Email</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Avatar</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Farm Status</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Growth %</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isPending ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No users match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((u, i) => (
                  <tr key={u.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/80'}>
                    <td className="px-4 py-3 font-medium text-gray-900">{u.nickname}</td>
                    <td className="px-4 py-3 text-gray-700">{u.email}</td>
                    <td className="px-4 py-3">
                      <img
                        src={u.avatarUrl}
                        alt=""
                        className="h-9 w-9 rounded-full border border-gray-200 bg-gray-100 object-cover"
                        width={36}
                        height={36}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <FarmBadge status={u.farmStatus} />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{u.growthPercent}%</td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(u.joinedAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
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
