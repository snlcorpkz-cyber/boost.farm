import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';

interface PartnerRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  defaultPayoutCents: number;
  postbackUrlTemplate: string | null;
  allowedEvents: string[];
  attributionWindowHours: number;
  reportTz: string;
  conversionCount: number;
  pendingPostbacks: number;
  contactEmail: string | null;
  updatedAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  paused: 'bg-amber-100 text-amber-700 border-amber-200',
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  archived: 'bg-rose-100 text-rose-700 border-rose-200',
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PartnersPage() {
  const { data, isPending, error } = useQuery<{ partners: PartnerRow[] }>({
    queryKey: ['admin', 'partners'],
    queryFn: () => api('/partners'),
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Partners</h1>
          <p className="mt-1 text-sm text-gray-500">
            Affiliate networks &amp; offerwalls (TimeBucks, Mistplay, etc.). Manage status,
            payouts, and inspect conversions per partner.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {(error as Error).message || 'Failed to load partners'}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Partner</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Default payout</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Allowed events</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Attribution</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">TZ</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Conversions</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Queued</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Postback URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isPending ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : (data?.partners ?? []).length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    No partners yet
                  </td>
                </tr>
              ) : (
                (data?.partners ?? []).map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link to={`/partners/${p.id}`} className="font-medium text-blue-600 hover:underline">
                        {p.name}
                      </Link>
                      <div className="text-xs font-mono text-gray-400">{p.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-bold rounded-full border px-2.5 py-1 ${
                          STATUS_STYLES[p.status] ?? STATUS_STYLES.draft
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatCents(p.defaultPayoutCents)}</td>
                    <td className="px-4 py-3">
                      {p.allowedEvents.length === 0 ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {p.allowedEvents.map((e) => (
                            <span
                              key={e}
                              className="text-xs font-mono rounded bg-gray-100 text-gray-700 px-1.5 py-0.5"
                            >
                              {e}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {Math.round(p.attributionWindowHours / 24)}d
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{p.reportTz}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {p.conversionCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.pendingPostbacks > 0 ? (
                        <span className="text-amber-700 font-semibold">{p.pendingPostbacks}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.postbackUrlTemplate ? (
                        <span className="text-xs font-mono text-gray-500" title={p.postbackUrlTemplate}>
                          {p.postbackUrlTemplate.length > 50
                            ? p.postbackUrlTemplate.slice(0, 50) + '…'
                            : p.postbackUrlTemplate}
                        </span>
                      ) : (
                        <span className="text-xs text-rose-600 font-medium">not configured</span>
                      )}
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
