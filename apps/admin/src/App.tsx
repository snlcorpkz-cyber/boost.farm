import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { UsersPage } from './pages/UsersPage';
import { CouponsPage } from './pages/CouponsPage';
import { QuestsPage } from './pages/QuestsPage';

const nav: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/products', label: 'Products' },
  { to: '/users', label: 'Users' },
  { to: '/coupons', label: 'Coupons' },
  { to: '/quests', label: 'Quests' },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {nav.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          onClick={onNavigate}
          className={({ isActive }) =>
            [
              'rounded-md px-3 py-2.5 text-sm font-medium transition',
              isActive
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-700 hover:bg-gray-200/80',
            ].join(' ')
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="hidden w-56 shrink-0 border-r border-gray-200 bg-gray-100 md:flex md:flex-col">
        <div className="border-b border-gray-200 px-4 py-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Eco-Farm</p>
          <p className="text-lg font-bold text-gray-900">Admin</p>
        </div>
        <NavItems />
      </aside>

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 w-56 border-r border-gray-200 bg-gray-100 shadow-lg transition-transform md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Eco-Farm</p>
            <p className="text-lg font-bold text-gray-900">Admin</p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-2 text-gray-600 hover:bg-gray-200"
            aria-label="Close sidebar"
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
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md border border-gray-200 p-2 text-gray-700 hover:bg-gray-50"
            aria-label="Open menu"
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
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/coupons" element={<CouponsPage />} />
            <Route path="/quests" element={<QuestsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
