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
  const [friendCode, setFriendCode] = useState('');

  useEffect(() => {
    const captured = captureRefCode();
    setRefCode(captured);
    if (captured) setFriendCode(captured);
  }, []);

  const effectiveRef = friendCode || refCode || undefined;

  const handleSendCode = async () => {
    if (!email) return;
    if (friendCode) localStorage.setItem(REF_KEY, friendCode);
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
      await login(email, code || '000000', effectiveRef);
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

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">
                  Friend's code
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>
                <input
                  type="text"
                  value={friendCode}
                  onChange={(e) => setFriendCode(e.target.value.trim().toUpperCase())}
                  placeholder="Enter friend's invite code"
                  maxLength={20}
                  className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:border-farm-green focus:ring-2 focus:ring-farm-green/20 outline-none transition-all text-sm"
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
        </div>
      </motion.div>
    </div>
  );
}
