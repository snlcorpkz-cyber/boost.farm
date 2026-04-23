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
  return (
    <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${colors[rank] || 'bg-gray-100'}`}>
      {rank}
    </span>
  );
}

type SortKey =
  | 'created_at'
  | 'last_login_at'
  | 'last_active_at'
  | 'total_ad_views'
  | 'offers_completed'
  | 'friends_count'
  | 'growth_percent'
  | 'current_stage'
  | 'total_water_this_month';

// Human-friendly time delta. Keeps the table readable: "5m", "3h", "4d".
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

function SortHeader({
  label,
  col,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortBy: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (col: SortKey) => void;
}) {
  const active = sortBy === col;
  return (
    <th
      className={`text-left px-4 py-3 font-semibold select-none cursor-pointer ${
        active ? 'text-gray-900' : 'text-gray-600'
      } hover:text-gray-900`}
      onClick={() => onSort(col)}
    >
      <span>{label}</span>
      <span className="ml-1 text-xs">{active ? (sortDir === 'asc' ? '▲' : '▼') : '·'}</span>
    </th>
  );
}

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rank, setRank] = useState('');
  const [platform, setPlatform] = useState('');
  const [country, setCountry] = useState('');
  const [activeWithin, setActiveWithin] = useState<number>(0); // 0 = all time
  const [hasAds, setHasAds] = useState(false);
  const [hasOffers, setHasOffers] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const qs = new URLSearchParams({
    search,
    page: String(page),
    limit: '30',
    rank,
    platform,
    country,
    sortBy,
    sortDir,
  });
  if (activeWithin) qs.set('activeWithin', String(activeWithin));
  if (hasAds) qs.set('hasAds', '1');
  if (hasOffers) qs.set('hasOffers', '1');

  const { data, isPending } = useQuery({
    queryKey: ['admin', 'users', qs.toString()],
    queryFn: () => api(`/users?${qs.toString()}`),
  });

  const users = data?.users || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 30);

  function handleSort(col: SortKey) {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      // Numeric/recent-first columns default to desc; text-ish to asc.
      setSortDir('desc');
    }
    setPage(1);
  }

  function resetFilters() {
    setSearch('');
    setRank('');
    setPlatform('');
    setCountry('');
    setActiveWithin(0);
    setHasAds(false);
    setHasOffers(false);
    setSortBy('created_at');
    setSortDir('desc');
    setPage(1);
  }

  const hasAnyFilter =
    !!search || !!rank || !!platform || !!country || activeWithin > 0 || hasAds || hasOffers;

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
        <select
          value={platform}
          onChange={(e) => { setPlatform(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Platforms</option>
          <option value="android">Android</option>
          <option value="web">Web</option>
          <option value="ios">iOS</option>
        </select>
        <input
          type="text"
          placeholder="Country code (e.g. US)"
          value={country}
          onChange={(e) => { setCountry(e.target.value.toUpperCase().slice(0, 4)); setPage(1); }}
          className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={activeWithin}
          onChange={(e) => { setActiveWithin(Number(e.target.value)); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          title="Active within"
        >
          <option value={0}>All time</option>
          <option value={1}>Active 24h</option>
          <option value={7}>Active 7d</option>
          <option value={30}>Active 30d</option>
        </select>
        <button
          type="button"
          onClick={() => { setHasAds((v) => !v); setPage(1); }}
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            hasAds
              ? 'border-purple-500 bg-purple-50 text-purple-700'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Watched ads
        </button>
        <button
          type="button"
          onClick={() => { setHasOffers((v) => !v); setPage(1); }}
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            hasOffers
              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Completed offers
        </button>
        {hasAnyFilter && (
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Reset
          </button>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">User</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Rank</th>
                <SortHeader label="Stage" col="current_stage" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Growth" col="growth_percent" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Water/mo" col="total_water_this_month" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Ads" col="total_ad_views" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Offers" col="offers_completed" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Friends" col="friends_count" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Last active" col="last_active_at" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Joined" col="created_at" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isPending ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-500">No users found</td></tr>
              ) : (
                users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-blue-50/50">
                    <td className="px-4 py-3">
                      <Link to={`/users/${u.id}`} className="font-medium text-blue-600 hover:underline">
                        {u.nickname}
                      </Link>
                      {u.is_admin && <span className="ml-1 text-[10px] bg-red-100 text-red-600 rounded px-1 font-bold">ADMIN</span>}
                      <div className="text-[10px] text-gray-400">
                        {[u.device_platform, u.country].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3"><RankBadge rank={u.rank_id || 'novice'} /></td>
                    <td className="px-4 py-3 text-gray-700">{u.current_stage ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{u.growth_percent != null ? `${Math.round(u.growth_percent)}%` : '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{u.total_water_this_month != null ? `${Math.round(u.total_water_this_month)}g` : '-'}</td>
                    <td className={`px-4 py-3 font-medium ${u.total_ad_views ? 'text-purple-700' : 'text-gray-400'}`}>
                      {u.total_ad_views || 0}
                    </td>
                    <td className={`px-4 py-3 font-medium ${u.offers_completed ? 'text-emerald-700' : 'text-gray-400'}`}>
                      {u.offers_completed ? (
                        <Link to={`/users/${u.id}#offers`} className="hover:underline">{u.offers_completed}</Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{u.friends_count || 0}</td>
                    <td
                      className="px-4 py-3 text-xs"
                      title={u.last_active_at ? new Date(u.last_active_at).toLocaleString() : 'never'}
                    >
                      <span className={u.last_active_at ? 'text-gray-600' : 'text-gray-400'}>
                        {relative(u.last_active_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
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
