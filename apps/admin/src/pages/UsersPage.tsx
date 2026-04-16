import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';

function RankBadge({ rank }: { rank: string }) {
  const colors: Record<string, string> = {
    novice: 'bg-gray-100 text-gray-600',
    amateur: 'bg-green-100 text-green-700',
    farmer: 'bg-blue-100 text-blue-700',
    master: 'bg-amber-100 text-amber-700',
  };
  return <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${colors[rank] || 'bg-gray-100'}`}>{rank}</span>;
}

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rank, setRank] = useState('');

  const { data, isPending } = useQuery({
    queryKey: ['admin', 'users', search, page, rank],
    queryFn: () => api(`/users?search=${encodeURIComponent(search)}&page=${page}&limit=30&rank=${rank}`),
  });

  const users = data?.users || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 30);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Users</h1>
      <p className="mt-1 text-sm text-gray-500">{total} total users</p>

      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search email, nickname, or ID..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={rank}
          onChange={(e) => { setRank(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Ranks</option>
          <option value="novice">Novice</option>
          <option value="amateur">Amateur</option>
          <option value="farmer">Farmer</option>
          <option value="master">Master</option>
        </select>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">User</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Rank</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Stage</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Growth</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Water/mo</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Ads</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Friends</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isPending ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No users found</td></tr>
              ) : (
                users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-blue-50/50 cursor-pointer">
                    <td className="px-4 py-3">
                      <Link to={`/users/${u.id}`} className="font-medium text-blue-600 hover:underline">
                        {u.nickname}
                      </Link>
                      {u.is_admin && <span className="ml-1 text-[10px] bg-red-100 text-red-600 rounded px-1 font-bold">ADMIN</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3"><RankBadge rank={u.rank_id || 'novice'} /></td>
                    <td className="px-4 py-3 text-gray-700">{u.current_stage || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{u.growth_percent != null ? `${Math.round(u.growth_percent)}%` : '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{u.total_water_this_month != null ? `${Math.round(u.total_water_this_month)}g` : '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{u.total_ad_views || 0}</td>
                    <td className="px-4 py-3 text-gray-700">{u.friends_count || 0}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Prev
          </button>
          <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
