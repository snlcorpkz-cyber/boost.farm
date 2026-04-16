import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';

export function OffersPage() {
  const qc = useQueryClient();
  const { data: offers = [], isPending } = useQuery({
    queryKey: ['admin', 'offers'],
    queryFn: () => api('/offers'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/offers/${id}`, { method: 'PUT', body: { ...offers.find((o: any) => o.id === id), active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'offers'] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Offers</h1>
          <p className="mt-1 text-sm text-gray-500">Manage partner game offers (Everflow)</p>
        </div>
        <Link
          to="/offers/new"
          className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + New Offer
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Icon</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Reward</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">EF Offer ID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Milestones</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Completions</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isPending ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : offers.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No offers yet</td></tr>
              ) : (
                offers.map((o: any) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {o.icon_url ? (
                        <img src={o.icon_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-200" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-lg">🎮</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{o.name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold rounded px-1.5 py-0.5 ${o.reward_type === 'water' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                        {o.reward_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{o.everflow_offer_id}</td>
                    <td className="px-4 py-3 text-gray-700">{o.milestone_count}</td>
                    <td className="px-4 py-3 text-gray-700">{o.completions_count}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive.mutate({ id: o.id, active: !o.active })}
                        className={`text-xs font-bold rounded-full px-2.5 py-1 ${o.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {o.active ? 'Active' : 'Paused'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/offers/${o.id}`} className="text-blue-600 hover:underline text-xs font-medium">
                        Edit
                      </Link>
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
