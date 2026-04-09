import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { extendCoupon, fetchCoupons, revokeCoupon } from '@/lib/mock-data';

function RedeemedBadge({ redeemed }: { redeemed: boolean }) {
  return (
    <span
      className={[
        'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
        redeemed ? 'bg-gray-200 text-gray-700' : 'bg-blue-100 text-blue-800',
      ].join(' ')}
    >
      {redeemed ? 'Redeemed' : 'Open'}
    </span>
  );
}

export function CouponsPage() {
  const queryClient = useQueryClient();
  const { data: coupons = [], isPending } = useQuery({
    queryKey: ['coupons'],
    queryFn: fetchCoupons,
  });

  const extendMutation = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => extendCoupon(id, days),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coupons'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: revokeCoupon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coupons'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Coupons</h1>
      <p className="mt-1 text-gray-500">Issued codes and redemption status (mock).</p>

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-700">Code</th>
                <th className="px-4 py-3 font-semibold text-gray-700">User</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Product</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Expires At</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Redeemed</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isPending ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : (
                coupons.map((c, i) => (
                  <tr key={c.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/80'}>
                    <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900">
                      {c.code}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.userNickname}</td>
                    <td className="px-4 py-3 text-gray-700">{c.productName}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(c.expiresAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <RedeemedBadge redeemed={c.redeemed} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={c.redeemed || extendMutation.isPending}
                          onClick={() => extendMutation.mutate({ id: c.id, days: 7 })}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Extend +7d
                        </button>
                        <button
                          type="button"
                          disabled={c.redeemed || revokeMutation.isPending}
                          onClick={() => {
                            if (window.confirm(`Revoke coupon ${c.code}?`)) {
                              revokeMutation.mutate(c.id);
                            }
                          }}
                          className="text-sm font-medium text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Revoke
                        </button>
                      </div>
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
