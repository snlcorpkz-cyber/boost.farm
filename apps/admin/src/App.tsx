import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { isAuthenticated, clearToken } from '@/lib/api';
import LoginForm from '@/components/LoginForm';
import { DashboardPage } from '@/pages/DashboardPage';
import { UsersPage } from '@/pages/UsersPage';
import { UserDetailPage } from '@/pages/UserDetailPage';
import { OffersPage } from '@/pages/OffersPage';
import { OfferEditPage } from '@/pages/OfferEditPage';
import { PushCampaignsPage } from '@/pages/PushCampaignsPage';
import { PushCreatePage } from '@/pages/PushCreatePage';
import { LogsPage } from '@/pages/LogsPage';
import { RetentionPage } from '@/pages/RetentionPage';
import { HealthPage } from '@/pages/HealthPage';

const nav: { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/retention', label: 'Retention', icon: '📈' },
  { to: '/users', label: 'Users', icon: '👥' },
  { to: '/offers', label: 'Offers', icon: '🎮' },
  { to: '/push', label: 'Push', icon: '🔔' },
  { to: '/logs', label: 'Logs', icon: '📋' },
  { to: '/health', label: 'Health', icon: '💓' },
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
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-700 hover:bg-gray-200/80',
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

  if (!authed) {
    return <LoginForm onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-gray-200 bg-white md:flex md:flex-col">
        <div className="border-b border-gray-200 px-5 py-5">
          <p className="text-lg font-bold text-gray-900">BoostFarm</p>
          <p className="text-xs font-medium text-gray-500">Admin Panel</p>
        </div>
        <NavItems />
        <div className="mt-auto p-3 border-t border-gray-200">
          <button
            onClick={() => { clearToken(); setAuthed(false); }}
            className="w-full text-left rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 font-medium"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 w-60 border-r border-gray-200 bg-white shadow-lg transition-transform md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
          <div>
            <p className="text-lg font-bold text-gray-900">BoostFarm</p>
            <p className="text-xs text-gray-500">Admin Panel</p>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-2 text-gray-600 hover:bg-gray-200"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <NavItems onNavigate={() => setMobileOpen(false)} />
      </aside>

      {/* Main content */}
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
          <span className="font-semibold text-gray-900">Admin</span>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-8">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/retention" element={<RetentionPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:id" element={<UserDetailPage />} />
            <Route path="/offers" element={<OffersPage />} />
            <Route path="/offers/new" element={<OfferEditPage />} />
            <Route path="/offers/:id" element={<OfferEditPage />} />
            <Route path="/push" element={<PushCampaignsPage />} />
            <Route path="/push/new" element={<PushCreatePage />} />
            <Route path="/push/:id" element={<PushCreatePage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
