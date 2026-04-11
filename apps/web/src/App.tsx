import { useEffect, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';
import { api } from './lib/api';
import FarmPage from './pages/FarmPage';
import AuthPage from './pages/AuthPage';
import CropSelectPage from './pages/CropSelectPage';
import QuestsPage from './pages/QuestsPage';
import FriendsPage from './pages/FriendsPage';
import FriendFarmPage from './pages/FriendFarmPage';
import ProfilePage from './pages/ProfilePage';

const REF_KEY = 'eco_ref_code';

function captureRefFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem(REF_KEY, ref);
    window.history.replaceState({}, '', window.location.pathname);
  }
}

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();
  const qc = useQueryClient();
  const refProcessed = useRef(false);

  captureRefFromUrl();

  useEffect(() => {
    if (!isAuthenticated || refProcessed.current) return;
    const code = localStorage.getItem(REF_KEY);
    if (!code) return;

    refProcessed.current = true;
    localStorage.removeItem(REF_KEY);

    api('/friends/add', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }).then(() => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
    }).catch((err: any) => {
      console.warn('[ref] add friend failed:', err.message);
    });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return;
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    tg.ready();
    tg.expand();
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-farm-green/10">
        <div className="animate-bounce-slow text-6xl">🌱</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return (
    <Routes>
      <Route path="/" element={<FarmPage />} />
      <Route path="/select-crop" element={<CropSelectPage />} />
      <Route path="/quests" element={<QuestsPage />} />
      <Route path="/friends/:friendId" element={<FriendFarmPage />} />
      <Route path="/friends" element={<FriendsPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
