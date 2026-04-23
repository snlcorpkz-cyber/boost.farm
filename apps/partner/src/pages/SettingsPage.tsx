import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/format';
import { StatusBadge } from '@/components/StatusBadge';

interface SettingsResponse {
  slug: string;
  name: string;
  status: string;
  defaultPayoutCents: number;
  postbackUrlTemplate: string | null;
  postbackMethod: 'GET' | 'POST';
  approvalMode: string;
  holdHours: number;
  contactEmail: string | null;
  macros: Record<string, string>;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery<SettingsResponse>({
    queryKey: ['partner', 'settings'],
    queryFn: () => api('/settings'),
  });

  const [postbackUrl, setPostbackUrl] = useState('');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [contactEmail, setContactEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (data) {
      setPostbackUrl(data.postbackUrlTemplate ?? '');
      setMethod(data.postbackMethod);
      setContactEmail(data.contactEmail ?? '');
    }
  }, [data]);

  const save = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await api('/settings', {
        method: 'PATCH',
        body: { postbackUrlTemplate: postbackUrl, postbackMethod: method, contactEmail },
      });
      setSaveMsg({ type: 'success', text: 'Saved. Changes take effect immediately.' });
      qc.invalidateQueries({ queryKey: ['partner', 'settings'] });
    } catch (e: any) {
      setSaveMsg({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const changePassword = async () => {
    setPwMsg(null);
    if (pw.next.length < 10) {
      setPwMsg({ type: 'error', text: 'New password must be at least 10 characters' });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwMsg({ type: 'error', text: "Passwords don't match" });
      return;
    }
    setPwSaving(true);
    try {
      await api('/settings/password', {
        method: 'POST',
        body: { current: pw.current, next: pw.next },
      });
      setPwMsg({ type: 'success', text: 'Password updated.' });
      setPw({ current: '', next: '', confirm: '' });
    } catch (e: any) {
      setPwMsg({ type: 'error', text: e.message });
    } finally {
      setPwSaving(false);
    }
  };

  if (isPending || !data) {
    return <div className="py-10 text-center text-sm text-gray-500">Loading…</div>;
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your integration configuration. Changes take effect on the next postback.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Partner</h2>
          <StatusBadge status={data.status} />
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Partner name</dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">{data.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Slug (attribution)</dt>
            <dd className="mt-1 font-mono text-sm text-gray-700">{data.slug}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Payout per harvest</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">{formatUsd(data.defaultPayoutCents)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Approval mode</dt>
            <dd className="mt-1 text-sm text-gray-700 capitalize">{data.approvalMode}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Fraud hold window</dt>
            <dd className="mt-1 text-sm text-gray-700">{data.holdHours}h</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-gray-500">
          Payout amount and approval rules can only be changed by BoostFarm per your contract — please contact your account manager.
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-base font-semibold text-gray-900">Postback endpoint</h2>
        <p className="mb-4 text-sm text-gray-500">
          The URL we call when a user triggers a billable event. Use the macros below — we substitute them
          per-conversion before sending.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Postback URL template</label>
            <textarea
              value={postbackUrl}
              onChange={(e) => setPostbackUrl(e.target.value)}
              rows={3}
              placeholder="https://postback.example.com/?clickid={CLICK_ID}&amount={PAYOUT_USD}&event={EVENT}"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">HTTP method</label>
            <div className="inline-flex overflow-hidden rounded-lg border border-gray-300">
              {(['GET', 'POST'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`px-4 py-2 text-sm font-medium ${
                    method === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Contact email</label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="ops@partner.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              We email this address on postback delivery failures and integration issues.
            </p>
          </div>

          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">Available macros</p>
            <div className="grid gap-1 text-xs">
              {Object.entries(data.macros).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-gray-600">{k}</span>
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono text-gray-700 border border-gray-200">{v}</code>
                </div>
              ))}
            </div>
          </div>

          {saveMsg && (
            <div className={`rounded-lg px-3 py-2 text-sm ${
              saveMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}>
              {saveMsg.text}
            </div>
          )}

          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-base font-semibold text-gray-900">Change password</h2>
        <p className="mb-4 text-sm text-gray-500">
          Minimum 10 characters. Your old password won't be recoverable after this.
        </p>
        <div className="space-y-3 max-w-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current password</label>
            <input
              type="password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
            <input
              type="password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
            <input
              type="password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          {pwMsg && (
            <div className={`rounded-lg px-3 py-2 text-sm ${
              pwMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}>
              {pwMsg.text}
            </div>
          )}
          <button
            onClick={changePassword}
            disabled={pwSaving || !pw.current || !pw.next || !pw.confirm}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {pwSaving ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </section>
    </div>
  );
}
