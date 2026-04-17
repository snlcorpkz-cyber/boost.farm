import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const ANDROID_PACKAGE = 'io.boostfarm.app';
const REF_KEY = 'eco_ref_code';
/**
 * Landing page for referral links: https://boostfarm.io/r/CODE123.
 *
 * We cache the code to localStorage first (so it survives even if Play Store
 * Install Referrer is unavailable — we can still auto-fill on signup if the
 * user opens the app while the browser cookie is still alive), then route the
 * visitor to the most useful destination:
 *
 *   - Inside the installed app (WebView) → just jump straight to /auth with
 *     the code applied.
 *   - Android mobile browser → Play Store with `referrer=ref%3DCODE` so the
 *     native Install Referrer API picks it up post-install.
 *   - iOS / desktop / unsupported → show a simple "copy code" fallback screen
 *     (no iOS build yet, but we don't want the link to feel broken).
 */
export default function ReferralLandingPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = (rawCode || '').trim().toUpperCase();
  const [fallback, setFallback] = useState<null | 'ios' | 'desktop' | 'copied'>(null);

  useEffect(() => {
    if (!code) {
      window.location.replace('/');
      return;
    }

    localStorage.setItem(REF_KEY, code);

    const ua = navigator.userAgent || '';
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isInApp = typeof (window as any).EcoFarmAndroid !== 'undefined';

    if (isInApp) {
      window.location.replace(`/?ref=${encodeURIComponent(code)}`);
      return;
    }

    if (isAndroid) {
      const playUrl =
        `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}` +
        `&referrer=${encodeURIComponent(`ref=${code}`)}`;
      window.location.replace(playUrl);
      return;
    }

    if (isIOS) {
      setFallback('ios');
      return;
    }

    setFallback('desktop');
  }, [code]);

  if (!fallback) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-green-50 to-white px-6">
        <div className="text-center">
          <img src="/assets/logo.webp" alt="Boost Farm" className="w-32 mx-auto mb-4 animate-pulse" />
          <p className="text-sm text-gray-500">Redirecting…</p>
        </div>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setFallback('copied');
      setTimeout(() => setFallback('desktop'), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-green-50 to-white px-6">
      <div className="max-w-sm w-full bg-white rounded-3xl shadow-xl p-6 text-center">
        <img src="/assets/logo.webp" alt="Boost Farm" className="w-40 mx-auto mb-3" />
        <h1 className="text-lg font-extrabold text-gray-900 mb-1">You've been invited!</h1>
        <p className="text-sm text-gray-500 mb-4">
          {fallback === 'ios'
            ? 'iOS app is coming soon. Open this link on Android to install automatically with your invite, or save the code below.'
            : 'Open this link on your Android phone to install the app, or use the code below after installing.'}
        </p>

        <div className="bg-green-50 border border-green-200 rounded-2xl py-3 mb-3">
          <p className="text-xs text-green-700 font-semibold mb-1">Your invite code</p>
          <p className="text-2xl font-extrabold tracking-widest text-green-800 font-mono">{code}</p>
        </div>

        <button
          onClick={copy}
          className="w-full py-3 rounded-xl bg-farm-green text-white font-bold text-sm shadow-md active:scale-95 transition"
        >
          {fallback === 'copied' ? 'Copied!' : 'Copy code'}
        </button>

        <a
          href={`https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&referrer=${encodeURIComponent(`ref=${code}`)}`}
          className="block mt-3 text-sm font-semibold text-farm-green underline"
        >
          Get the app on Google Play
        </a>
      </div>
    </div>
  );
}
