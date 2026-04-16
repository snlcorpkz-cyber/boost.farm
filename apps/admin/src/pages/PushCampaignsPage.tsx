import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sending: 'bg-blue-100 text-blue-700',
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-600',
};

export function PushCampaignsPage() {
  const { data: campaigns = [], isPending } = useQuery({
    queryKey: ['admin', 'push'],
    queryFn: () => api('/push'),
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Push Campaigns</h1>
          <p className="mt-1 text-sm text-gray-500">Send targeted notifications to users</p>
        </div>
        <Link
          to="/push/new"
          className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + New Campaign
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Title</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Target</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Recipients</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Delivered</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Opened</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Open Rate</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isPending ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : campaigns.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No campaigns yet</td></tr>
              ) : (
                campaigns.map((c: any) => {
                  const openRate = c.delivered > 0 ? Math.round((c.opened / c.delivered) * 100) : 0;
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link to={`/push/${c.id}`} className="font-medium text-blue-600 hover:underline">{c.title}</Link>
                        <p className="text-xs text-gray-400 truncate max-w-[200px]">{c.body}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs capitalize">{c.target_type}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${statusColors[c.status] || 'bg-gray-100'}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{c.total_recipients}</td>
                      <td className="px-4 py-3 text-gray-700">{c.delivered}</td>
                      <td className="px-4 py-3 text-gray-700">{c.opened}</td>
                      <td className="px-4 py-3">
                        {c.status === 'sent' ? (
                          <span className={`font-bold text-xs ${openRate >= 20 ? 'text-green-600' : openRate >= 10 ? 'text-amber-600' : 'text-red-500'}`}>
                            {openRate}%
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(c.created_at).toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
