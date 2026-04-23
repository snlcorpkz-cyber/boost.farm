import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { clearToken, getSession, isAuthenticated } from '@/lib/api';
import LoginForm from '@/components/LoginForm';
import { OverviewPage } from '@/pages/OverviewPage';
import { ConversionsPage } from '@/pages/ConversionsPage';
import { PostbacksPage } from '@/pages/PostbacksPage';
import { SettingsPage } from '@/pages/SettingsPage';

const nav: { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: '/', label: 'Overview', icon: '📊', end: true },
  { to: '/conversions', label: 'Conversions', icon: '🧾' },
  { to: '/postbacks', label: 'Postback log', icon: '📡' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {nav.map(({ to, label, icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          onClick={onNavigate}
          className={({ isActive }) =>
            [
              'rounded-lg px-3 py-2.5 text-sm font-medium transition flex items-center gap-2.5',
              isActive
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-gray-700 hover:bg-gray-100',
            ].join(' ')
          }
        >
          <span className="text-base">{icon}</span>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [mobileOpen, setMobileOpen] = useState(false);
  const session = getSession();

  if (!authed) {
    return <LoginForm onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="hidden w-64 shrink-0 border-r border-gray-200 bg-white md:flex md:flex-col">
        <div className="border-b border-gray-200 px-5 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
              <span className="text-white text-sm font-bold">B</span>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">BoostFarm</p>
              <p className="text-xs font-medium text-emerald-700">Partner Portal</p>
            </div>
          </div>
          {session && (
            <div className="mt-4 rounded-lg bg-gray-50 px-2.5 py-2 border border-gray-100">
              <p className="truncate text-xs font-semibold text-gray-900">{session.partnerName}</p>
              <p className="truncate text-[11px] text-gray-500">{session.email}</p>
            </div>
          )}
        </div>
        <NavItems />
        <div className="mt-auto p-3 border-t border-gray-200">
          <button
            onClick={() => { clearToken(); setAuthed(false); }}
            className="w-full text-left rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 font-medium"
          >
            Sign out
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 w-64 border-r border-gray-200 bg-white shadow-lg transition-transform md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
              <span className="text-white text-sm font-bold">B</span>
            </div>
            <p className="text-sm font-bold text-gray-900">Partner Portal</p>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <NavItems onNavigate={() => setMobileOpen(false)} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md border border-gray-200 p-2 text-gray-700 hover:bg-gray-50"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-semibold text-gray-900">Partner Portal</span>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-8">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/conversions" element={<ConversionsPage />} />
            <Route path="/postbacks" element={<PostbacksPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
