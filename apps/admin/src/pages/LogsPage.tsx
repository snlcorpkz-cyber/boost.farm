import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';

type Tab = 'events' | 'postbacks';

export function LogsPage() {
  const [tab, setTab] = useState<Tab>('events');

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Logs</h1>
      <p className="mt-1 text-sm text-gray-500">Event log and Everflow postback log</p>

      <div className="mt-4 flex gap-2 border-b border-gray-200">
        {(['events', 'postbacks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'events' ? 'Events' : 'Postbacks'}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'events' ? <EventsLog /> : <PostbacksLog />}
      </div>
    </div>
  );
}

function EventsLog() {
  const [page, setPage] = useState(1);
  const [eventName, setEventName] = useState('');
  const [userId, setUserId] = useState('');

  const { data, isPending } = useQuery({
    queryKey: ['admin', 'logs', 'events', page, eventName, userId],
    queryFn: () => api(`/logs/events?page=${page}&limit=50&event_name=${eventName}&user_id=${userId}`),
  });

  const { data: eventNames = [] } = useQuery({
    queryKey: ['admin', 'logs', 'event-names'],
    queryFn: () => api('/logs/events/names'),
  });

  const events = data?.events || [];
  const total = data?.total || 0;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={eventName}
          onChange={e => { setEventName(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Events</option>
          {eventNames.map((n: any) => (
            <option key={n.event_name} value={n.event_name}>{n.event_name} ({n.c})</option>
          ))}
        </select>
        <input
          placeholder="Filter by User ID..."
          value={userId}
          onChange={e => { setUserId(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-w-[250px]"
        />
        <span className="text-sm text-gray-500 self-center">{total} events</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Time</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Event</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600">User</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Properties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isPending ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-500">No events</td></tr>
              ) : (
                events.map((e: any) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <span className="bg-gray-100 text-gray-700 font-mono font-semibold rounded px-1.5 py-0.5">{e.event_name}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{e.nickname || e.email || e.user_id?.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-gray-500 max-w-[300px] truncate font-mono">{JSON.stringify(e.properties)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex justify-center gap-2">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-xs border rounded-lg disabled:opacity-40">Prev</button>
        <span className="text-xs text-gray-500 self-center">Page {page}</span>
        <button onClick={() => setPage(p => p + 1)} disabled={events.length < 50} className="px-3 py-1.5 text-xs border rounded-lg disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

function PostbacksLog() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const { data, isPending } = useQuery({
    queryKey: ['admin', 'logs', 'postbacks', page, status],
    queryFn: () => api(`/logs/postbacks?page=${page}&limit=50&status=${status}`),
  });

  const postbacks = data?.postbacks || [];

  return (
    <div>
      <div className="flex gap-3 mb-4">
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="credited">Credited</option>
          <option value="received">Received</option>
          <option value="error">Error</option>
        </select>
        <span className="text-sm text-gray-500 self-center">{data?.total || 0} postbacks</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Time</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Offer ID</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Event ID</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600">User</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Status</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isPending ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : postbacks.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No postbacks</td></tr>
              ) : (
                postbacks.map((p: any) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(p.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-700 font-mono">{p.everflow_offer_id}</td>
                    <td className="px-3 py-2 text-gray-700 font-mono">{p.everflow_event_id}</td>
                    <td className="px-3 py-2 text-gray-700 font-mono">{p.user_id?.slice(0, 8) || '-'}</td>
                    <td className="px-3 py-2">
                      <span className={`font-bold ${p.status === 'credited' ? 'text-green-600' : p.status === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-red-400 max-w-[200px] truncate">{p.error_message || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex justify-center gap-2">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-xs border rounded-lg disabled:opacity-40">Prev</button>
        <span className="text-xs text-gray-500 self-center">Page {page}</span>
        <button onClick={() => setPage(p => p + 1)} disabled={postbacks.length < 50} className="px-3 py-1.5 text-xs border rounded-lg disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
