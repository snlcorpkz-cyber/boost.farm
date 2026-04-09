import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';

const REF_KEY = 'eco_ref_code';

function captureRefCode(): string | null {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem(REF_KEY, ref);
    window.history.replaceState({}, '', window.location.pathname);
    return ref;
  }
  return localStorage.getItem(REF_KEY);
}

type Step = 'email' | 'code';

export default function AuthPage() {
  const { t } = useTranslation();
  const { sendCode, login } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);

  useEffect(() => {
    setRefCode(captureRefCode());
  }, []);

  const handleDemoLogin = async () => {
    setLoading(true);
    try {
      await login('demo@eco-farm.app', '000000', refCode ?? undefined);
      localStorage.removeItem(REF_KEY);
    } catch (err: any) {
      setError(err.message || 'Demo login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!email) return;
    setLoading(true);
    setError('');
    try {
      await sendCode(email);
      setCode('000000');
      setStep('code');
    } catch (err: any) {
      setError(err.message || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError('');
    try {
      await login(email, code || '000000', refCode ?? undefined);
      localStorage.removeItem(REF_KEY);
    } catch (err: any) {
      setError(err.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full min-h-[100dvh] bg-gradient-to-b from-green-100 via-green-50 to-white flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <motion.div
            className="text-7xl mb-4"
            animate={{ rotate: [0, -5, 5, -3, 0] }}
            transition={{ repeat: Infinity, duration: 4 }}
          >
            🌱
          </motion.div>
          <h1 className="text-2xl font-extrabold text-gray-800">{t('auth.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('auth.subtitle')}</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-3xl shadow-xl p-6 space-y-4">
          {step === 'email' ? (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">
                  {t('auth.email')}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:border-farm-green focus:ring-2 focus:ring-farm-green/20 outline-none transition-all text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                />
              </div>
              <button
                onClick={handleSendCode}
                disabled={loading || !email}
                className="w-full py-3 rounded-xl bg-farm-green text-white font-bold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {loading ? '...' : t('auth.send_code')}
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">
                  {t('auth.enter_code')}
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:border-farm-green focus:ring-2 focus:ring-farm-green/20 outline-none transition-all text-sm text-center tracking-[0.5em] font-mono text-lg"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                />
              </div>
              <button
                onClick={handleVerify}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-farm-green text-white font-bold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {loading ? '...' : t('auth.verify')}
              </button>
              <button
                onClick={() => { setStep('email'); setCode(''); }}
                className="w-full text-xs text-gray-400 hover:text-gray-600"
              >
                ← {t('auth.email')}
              </button>
            </>
          )}

          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}

          <div className="flex items-center gap-3 mt-2">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">{t('auth.or')}</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <button className="w-full py-3 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {t('auth.google')}
          </button>

          <button
            onClick={handleDemoLogin}
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-400 text-white font-bold text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
          >
            🎮 Demo Mode
          </button>
        </div>
      </motion.div>
    </div>
  );
}
