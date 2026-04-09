import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchQuests, setQuestActive } from '@/lib/mock-data';

const rewardLabels: Record<string, string> = {
  water: 'Water',
  coins: 'Coins',
  xp: 'XP',
  coupon: 'Coupon',
};

export function QuestsPage() {
  const queryClient = useQueryClient();
  const { data: quests = [], isPending } = useQuery({
    queryKey: ['quests'],
    queryFn: fetchQuests,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setQuestActive(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quests'] });
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Quests</h1>
      <p className="mt-1 text-gray-500">Quest keys, rewards, and rollout flags.</p>

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-700">Key</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Reward Type</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Amount</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Limit / Phase</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isPending ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : (
                quests.map((quest, i) => (
                  <tr key={quest.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/80'}>
                    <td className="px-4 py-3 font-mono text-sm text-gray-900">{quest.key}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {rewardLabels[quest.rewardType] ?? quest.rewardType}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{quest.amount}</td>
                    <td className="px-4 py-3 text-gray-700">{quest.limitPhase}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={quest.active}
                        disabled={toggleMutation.isPending}
                        onClick={() =>
                          toggleMutation.mutate({ id: quest.id, active: !quest.active })
                        }
                        className={[
                          'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition',
                          quest.active ? 'bg-blue-600' : 'bg-gray-200',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition',
                            quest.active ? 'translate-x-5' : 'translate-x-0',
                          ].join(' ')}
                        />
                      </button>
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
