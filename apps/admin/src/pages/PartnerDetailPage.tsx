import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/lib/api';

interface Partner {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  defaultPayoutCents: number;
  postbackUrlTemplate: string | null;
  postbackMethod: 'GET' | 'POST';
  approvalMode: 'auto' | 'manual';
  holdHours: number;
  attributionWindowHours: number;
  reportTz: string;
  allowedEvents: string[];
  contactEmail: string | null;
  notes: string | null;
}

interface CountryPayout {
  countryCode: string;
  payoutCents: number;
  updatedAt: string;
}

interface PartnerAccount {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  lastLoginAt: string | null;
}

interface Totals {
  attributedUsers: number;
  installs: number;
  stage4: number;
  harvests: number;
  reversed: number;
  payoutPendingCents: number;
  payoutPaidCents: number;
  payoutReversedCents: number;
}

interface DetailResponse {
  partner: Partner;
  countryPayouts: CountryPayout[];
  accounts: PartnerAccount[];
  totals: Totals;
}

interface ConversionRow {
  id: string;
  userId: string;
  userEmail: string | null;
  clickId: string | null;
  eventType: string;
  countryCode: string | null;
  payoutCents: number;
  status: string;
  fraudReason: string | null;
  holdUntil: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
  duplicate: 'bg-gray-100 text-gray-600',
  reversed: 'bg-rose-100 text-rose-800 line-through',
};

const PARTNER_STATUS_OPTIONS: Array<Partner['status']> = ['draft', 'active', 'paused', 'archived'];
const KNOWN_EVENT_TYPES = [
  'install',
  'register',
  'tutorial',
  'first_play',
  'engaged_d0',
  'd1_return',
  'stage_2',
  'stage_3',
  'stage_4',
  'stage_5',
  'stage_6',
  'harvest',
  'harvest_x3',
];

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data, isPending, error } = useQuery<DetailResponse>({
    queryKey: ['admin', 'partner', id],
    queryFn: () => api(`/partners/${id}`),
    enabled: !!id,
  });

  const { data: fraudReasons } = useQuery<{ reasons: string[] }>({
    queryKey: ['admin', 'partners', '_meta', 'fraud-reasons'],
    queryFn: () => api(`/partners/_meta/fraud-reasons`),
  });

  if (isPending) return <div className="text-gray-500">Loading partner…</div>;
  if (error) return <div className="text-rose-600">{(error as Error).message}</div>;
  if (!data) return null;

  return (
    <div>
      <Link to="/partners" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
        &larr; Back to Partners
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{data.partner.name}</h1>
          <p className="text-sm text-gray-500">
            Slug: <span className="font-mono">{data.partner.slug}</span> · Type: {data.partner.type}
          </p>
        </div>
        <div
          className={`text-xs font-bold rounded-full border px-3 py-1 ${
            data.partner.status === 'active'
              ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
              : data.partner.status === 'paused'
                ? 'bg-amber-100 text-amber-700 border-amber-200'
                : data.partner.status === 'archived'
                  ? 'bg-rose-100 text-rose-700 border-rose-200'
                  : 'bg-gray-100 text-gray-600 border-gray-200'
          }`}
        >
          {data.partner.status.toUpperCase()}
        </div>
      </header>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Kpi label="Attributed users" value={data.totals.attributedUsers.toLocaleString()} />
        <Kpi label="Installs / Stage 4 / Harvests" value={`${data.totals.installs} / ${data.totals.stage4} / ${data.totals.harvests}`} />
        <Kpi label="Payout (pending / paid)" value={`${formatCents(data.totals.payoutPendingCents)} · ${formatCents(data.totals.payoutPaidCents)}`} />
        <Kpi label="Reversed" value={`${data.totals.reversed} (${formatCents(data.totals.payoutReversedCents)})`} accent="rose" />
      </div>

      {/* Settings card */}
      <PartnerSettingsCard partner={data.partner} />

      {/* Country payouts */}
      <CountryPayoutsCard partnerId={data.partner.id} payouts={data.countryPayouts} onChanged={() => qc.invalidateQueries({ queryKey: ['admin', 'partner', id] })} />

      {/* Conversions */}
      <ConversionsCard partnerId={data.partner.id} fraudReasons={fraudReasons?.reasons ?? []} />

      {/* Postbacks log */}
      <PostbacksCard partnerId={data.partner.id} />
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'rose' }) {
  const tone = accent === 'rose' ? 'border-l-rose-500' : 'border-l-emerald-500';
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 border-l-4 ${tone}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
    </div>
  );
}

function PartnerSettingsCard({ partner }: { partner: Partner }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partner>(partner);

  const save = useMutation({
    mutationFn: () =>
      api(`/partners/${partner.id}`, {
        method: 'PATCH',
        body: {
          status: form.status,
          defaultPayoutCents: form.defaultPayoutCents,
          postbackUrlTemplate: form.postbackUrlTemplate ?? '',
          postbackMethod: form.postbackMethod,
          approvalMode: form.approvalMode,
          holdHours: form.holdHours,
          attributionWindowHours: form.attributionWindowHours,
          reportTz: form.reportTz,
          allowedEvents: form.allowedEvents,
          contactEmail: form.contactEmail ?? '',
          notes: form.notes ?? '',
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'partner', partner.id] }),
  });

  function toggleEvent(e: string) {
    setForm((prev) => ({
      ...prev,
      allowedEvents: prev.allowedEvents.includes(e)
        ? prev.allowedEvents.filter((x) => x !== e)
        : [...prev.allowedEvents, e],
    }));
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Settings</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Status">
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as Partner['status'] })}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            {PARTNER_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Default payout (cents)">
          <input
            type="number"
            value={form.defaultPayoutCents}
            onChange={(e) => setForm({ ...form, defaultPayoutCents: Number(e.target.value) })}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono"
          />
        </Field>
        <Field label="Postback URL template" wide>
          <input
            type="text"
            value={form.postbackUrlTemplate ?? ''}
            onChange={(e) => setForm({ ...form, postbackUrlTemplate: e.target.value })}
            placeholder="https://timebucks.example/postback?clickid={clickid}&event={event}&payout={payout}&country={country}"
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono"
          />
        </Field>
        <Field label="HTTP method">
          <select
            value={form.postbackMethod}
            onChange={(e) => setForm({ ...form, postbackMethod: e.target.value as 'GET' | 'POST' })}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </Field>
        <Field label="Approval mode">
          <select
            value={form.approvalMode}
            onChange={(e) => setForm({ ...form, approvalMode: e.target.value as 'auto' | 'manual' })}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="auto">auto</option>
            <option value="manual">manual</option>
          </select>
        </Field>
        <Field label="Hold (hours)">
          <input
            type="number"
            value={form.holdHours}
            onChange={(e) => setForm({ ...form, holdHours: Number(e.target.value) })}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono"
          />
        </Field>
        <Field label="Attribution window (hours)">
          <input
            type="number"
            value={form.attributionWindowHours}
            onChange={(e) => setForm({ ...form, attributionWindowHours: Number(e.target.value) })}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono"
          />
        </Field>
        <Field label="Reporting TZ">
          <input
            type="text"
            value={form.reportTz}
            onChange={(e) => setForm({ ...form, reportTz: e.target.value })}
            placeholder="UTC, +05:00, Asia/Karachi…"
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono"
          />
        </Field>
        <Field label="Contact email">
          <input
            type="email"
            value={form.contactEmail ?? ''}
            onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Allowed events" wide>
          <div className="flex flex-wrap gap-2">
            {KNOWN_EVENT_TYPES.map((e) => (
              <label key={e} className="inline-flex items-center gap-1.5 text-xs font-mono">
                <input
                  type="checkbox"
                  checked={form.allowedEvents.includes(e)}
                  onChange={() => toggleEvent(e)}
                />
                <span>{e}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Notes" wide>
          <textarea
            value={form.notes ?? ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        {save.isSuccess && <span className="text-sm text-emerald-700">Saved.</span>}
        {save.isError && <span className="text-sm text-rose-700">{(save.error as Error).message}</span>}
      </div>
    </section>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'lg:col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function CountryPayoutsCard({
  partnerId,
  payouts,
  onChanged,
}: {
  partnerId: string;
  payouts: CountryPayout[];
  onChanged: () => void;
}) {
  const [country, setCountry] = useState('');
  const [cents, setCents] = useState('200');

  const upsert = useMutation({
    mutationFn: ({ cc, c }: { cc: string; c: number }) =>
      api(`/partners/${partnerId}/country-payouts/${cc.toUpperCase()}`, {
        method: 'PUT',
        body: { payoutCents: c },
      }),
    onSuccess: () => {
      setCountry('');
      onChanged();
    },
  });

  const remove = useMutation({
    mutationFn: (cc: string) =>
      api(`/partners/${partnerId}/country-payouts/${cc}`, { method: 'DELETE' }),
    onSuccess: onChanged,
  });

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Country payouts</h3>
          <p className="text-xs text-gray-500">
            Per-country override. Countries not listed → informational postback only (payout = 0).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-2 items-end mb-3">
        <div className="col-span-3 sm:col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Country (ISO-2)</label>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
            placeholder="US"
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono uppercase"
          />
        </div>
        <div className="col-span-4 sm:col-span-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">Payout (cents)</label>
          <input
            type="number"
            value={cents}
            onChange={(e) => setCents(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono"
          />
        </div>
        <div className="col-span-5 sm:col-span-3">
          <button
            disabled={upsert.isPending || !/^[A-Z]{2}$/.test(country)}
            onClick={() => upsert.mutate({ cc: country, c: Number(cents) })}
            className="w-full bg-emerald-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            Upsert
          </button>
        </div>
      </div>

      {payouts.length === 0 ? (
        <p className="text-xs text-gray-400">No country payouts configured. All conversions will be informational (payout = 0).</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 px-2 font-medium text-gray-500 text-xs">Country</th>
              <th className="text-right py-2 px-2 font-medium text-gray-500 text-xs">Payout</th>
              <th className="text-left py-2 px-2 font-medium text-gray-500 text-xs">Updated</th>
              <th className="text-right py-2 px-2 font-medium text-gray-500 text-xs"></th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.countryCode} className="border-b border-gray-50">
                <td className="py-2 px-2 font-mono">{p.countryCode}</td>
                <td className="py-2 px-2 text-right tabular-nums">{formatCents(p.payoutCents)}</td>
                <td className="py-2 px-2 text-gray-500 text-xs">{new Date(p.updatedAt).toLocaleString()}</td>
                <td className="py-2 px-2 text-right">
                  <button
                    onClick={() => {
                      if (confirm(`Remove payout for ${p.countryCode}? Future conversions from that country will be informational.`)) {
                        remove.mutate(p.countryCode);
                      }
                    }}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ConversionsCard({ partnerId, fraudReasons }: { partnerId: string; fraudReasons: string[] }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [reverseTarget, setReverseTarget] = useState<ConversionRow | null>(null);
  const [reason, setReason] = useState<string>('');

  const { data, isPending } = useQuery<{ rows: ConversionRow[]; total: number }>({
    queryKey: ['admin', 'partner', partnerId, 'conversions', statusFilter, eventFilter],
    queryFn: () =>
      api(
        `/partners/${partnerId}/conversions?limit=200${statusFilter ? `&status=${statusFilter}` : ''}${eventFilter ? `&event=${eventFilter}` : ''}`,
      ),
  });

  const reverse = useMutation({
    mutationFn: ({ conversionId, reason }: { conversionId: string; reason: string }) =>
      api(`/partners/conversions/${conversionId}/mark-fraud`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => {
      setReverseTarget(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['admin', 'partner', partnerId] });
    },
  });

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Conversions</h3>
          <p className="text-xs text-gray-500">
            Total in current view: <span className="font-semibold">{data?.total ?? '…'}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="">all status</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="paid">paid</option>
            <option value="rejected">rejected</option>
            <option value="duplicate">duplicate</option>
            <option value="reversed">reversed</option>
          </select>
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="">all events</option>
            {KNOWN_EVENT_TYPES.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
      </div>

      {isPending ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (data?.rows ?? []).length === 0 ? (
        <p className="text-sm text-gray-400">No conversions match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">Created</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">Event</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">User</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">Click ID</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">Country</th>
                <th className="text-right px-2 py-2 font-semibold text-gray-600">Payout</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">Status</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">Fraud reason</th>
                <th className="text-right px-2 py-2 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-2 py-2 text-gray-600 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-2 font-mono">{r.eventType}</td>
                  <td className="px-2 py-2">
                    <Link to={`/users/${r.userId}`} className="text-blue-600 hover:underline">
                      {r.userEmail ?? r.userId.slice(0, 8) + '…'}
                    </Link>
                  </td>
                  <td className="px-2 py-2 font-mono text-gray-500">{r.clickId ?? '—'}</td>
                  <td className="px-2 py-2 font-mono">{r.countryCode ?? '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatCents(r.payoutCents)}</td>
                  <td className="px-2 py-2">
                    <span className={`text-xs font-bold rounded px-1.5 py-0.5 ${STATUS_STYLES[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-rose-700 font-medium">{r.fraudReason ?? '—'}</td>
                  <td className="px-2 py-2 text-right">
                    {r.status !== 'reversed' && r.status !== 'rejected' ? (
                      <button
                        onClick={() => setReverseTarget(r)}
                        className="text-xs text-rose-600 hover:underline"
                      >
                        mark fraud
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reverseTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setReverseTarget(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-1">Mark conversion as fraud</h2>
            <p className="text-sm text-gray-500 mb-4">
              This will set status to <span className="font-mono">reversed</span> and queue a
              reversal postback to the partner with <span className="font-mono">&amp;event=reversed&amp;reason=…</span>.
            </p>
            <div className="text-xs font-mono bg-gray-50 rounded p-2 mb-4 break-all">
              {reverseTarget.eventType} · {reverseTarget.userEmail ?? reverseTarget.userId} · {formatCents(reverseTarget.payoutCents)}
            </div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm mb-4"
            >
              <option value="">select reason…</option>
              {fraudReasons.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setReverseTarget(null)}
                className="px-4 py-1.5 text-sm rounded-lg text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                disabled={!reason || reverse.isPending}
                onClick={() => reverse.mutate({ conversionId: reverseTarget.id, reason })}
                className="px-4 py-1.5 text-sm rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {reverse.isPending ? 'Reversing…' : 'Mark as fraud'}
              </button>
            </div>
            {reverse.isError && (
              <p className="mt-2 text-xs text-rose-700">{(reverse.error as Error).message}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PostbacksCard({ partnerId }: { partnerId: string }) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery<{
    rows: Array<{
      id: string;
      conversionId: string | null;
      eventType: string | null;
      url: string;
      status: string;
      attempts: number;
      lastResponseCode: number | null;
      lastError: string | null;
      createdAt: string;
      sentAt: string | null;
      nextRetryAt: string;
    }>;
  }>({
    queryKey: ['admin', 'partner', partnerId, 'postbacks'],
    queryFn: () => api(`/partners/${partnerId}/postbacks?limit=100`),
  });

  const replay = useMutation({
    mutationFn: (postbackId: string) =>
      api(`/partners/${partnerId}/postbacks/${postbackId}/replay`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'partner', partnerId, 'postbacks'] }),
  });

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Outbound postback log (last 100)</h3>
      {isPending ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (data?.rows ?? []).length === 0 ? (
        <p className="text-sm text-gray-400">No postbacks fired yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">Created</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">Event</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">Status</th>
                <th className="text-right px-2 py-2 font-semibold text-gray-600">Attempts</th>
                <th className="text-right px-2 py-2 font-semibold text-gray-600">HTTP</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">URL</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600">Error</th>
                <th className="text-right px-2 py-2 font-semibold text-gray-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data!.rows.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-2 py-2 text-gray-600 whitespace-nowrap">{new Date(p.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-2 font-mono">{p.eventType ?? '—'}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`text-xs font-bold rounded px-1.5 py-0.5 ${
                        p.status === 'sent'
                          ? 'bg-emerald-100 text-emerald-700'
                          : p.status === 'queued'
                            ? 'bg-amber-100 text-amber-700'
                            : p.status === 'dead'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{p.attempts}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{p.lastResponseCode ?? '—'}</td>
                  <td className="px-2 py-2 font-mono text-gray-500 max-w-[280px] truncate" title={p.url}>{p.url}</td>
                  <td className="px-2 py-2 text-rose-700 max-w-[180px] truncate" title={p.lastError ?? ''}>{p.lastError ?? '—'}</td>
                  <td className="px-2 py-2 text-right">
                    {(p.status === 'dead' || p.status === 'failed') && (
                      <button
                        onClick={() => replay.mutate(p.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        replay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
