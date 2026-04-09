import { useQuery } from '@tanstack/react-query';
import { fetchDashboardStats } from '@/lib/mock-data';

function StatCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-gray-400">{hint}</p> : null}
    </div>
  );
}

export function DashboardPage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: fetchDashboardStats,
  });

  if (isPending) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-gray-500">Loading overview…</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg border border-gray-100 bg-gray-50"
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-red-600">Could not load stats.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-gray-500">Overview of your eco-farm platform (mock data).</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Users" value={data.totalUsers} />
        <StatCard title="Active Farms" value={data.activeFarms} hint="Users with an active farm" />
        <StatCard title="Coupons Generated" value={data.couponsGenerated} />
        <StatCard
          title="Avg Growth %"
          value={`${data.avgGrowthPercent}%`}
          hint="Across all users"
        />
      </div>
    </div>
  );
}
