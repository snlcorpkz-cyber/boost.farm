import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { haptic } from '../lib/native';
import { trackClient } from '../lib/track';
import { reportInvite } from '../lib/marketing';

interface SessionInvitePopupProps {
  open: boolean;
  onClose: () => void;
}

const PLAY_STORE_ID = 'io.boostfarm.app';

// Play Store's Install Referrer API (see InstallReferrerHelper.kt) reads back
// whatever we pass under `&referrer=...`. We encode `ref=<code>` so that the
// Android app picks it up as ParsedReferrer.refCode on first launch and
// attributes the install to the inviter automatically — no manual code entry.
function buildShareText(code: string): string {
  const encoded = encodeURIComponent(`ref=${code}`);
  const url = `https://play.google.com/store/apps/details?id=${PLAY_STORE_ID}&referrer=${encoded}`;
  return `🌱 Заходи в Boost Farm — растим овощи и выигрываем бонусы!\nМой код: ${code}\nСкачай: ${url}`;
}

/**
 * Periodic (every-Nth-session) invite nudge. Shown by App.tsx once per session
 * on sessions 3, 6, 9, … — frequent enough to keep referral velocity up, rare
 * enough that it does not feel spammy. One big copy button grabs everything a
 * user needs to paste into a chat: a friendly intro, their code, and a Play
 * Store URL pre-seeded with the Install Referrer so the reward is auto-credited
 * on the friend's device.
 */
export default function SessionInvitePopup({ open, onClose }: SessionInvitePopupProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [canShare] = useState(() => typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function');

  const { data: inviteData } = useQuery({
    queryKey: ['invite-code'],
    queryFn: () => api<{ code: string }>('/friends/invite-code'),
    enabled: open,
  });

  const code = inviteData?.code ?? '';
  const shareText = code ? buildShareText(code) : '';

  const copyShare = async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      trackClient('invite.share_copied', { source: 'session_popup', code }, { placement: 'session_invite' });
      reportInvite({ source: 'session_popup', method: 'copy' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked (older WebViews / strict policies) — fall back to
      // selecting the text in a hidden textarea so the user can long-press copy.
      try {
        const ta = document.createElement('textarea');
        ta.value = shareText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* give up silently */ }
    }
  };

  const shareNative = async () => {
    if (!shareText) return;
    const anyNav = navigator as any;
    if (typeof anyNav.share === 'function') {
      try {
        await anyNav.share({
          title: 'Boost Farm',
          text: shareText,
        });
        trackClient('invite.share_native', { source: 'session_popup', code }, { placement: 'session_invite' });
        reportInvite({ source: 'session_popup', method: 'native' });
        return;
      } catch {
        // User dismissed the sheet — do nothing, they'll see the Copy button.
      }
    }
    copyShare();
  };

  const handleClose = () => {
    trackClient('invite.dismissed', { source: 'session_popup' }, { placement: 'session_invite' });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close"
            className="fixed inset-0 bg-black/45 z-[100]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <motion.div
            className="fixed inset-0 z-[101] flex items-center justify-center pointer-events-none px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-[360px] overflow-hidden rounded-[26px] pointer-events-auto"
              style={{
                background: 'linear-gradient(180deg, #FFF5DC 0%, #FAECC8 45%, #F5E1B0 100%)',
                boxShadow: '0 20px 50px rgba(80,50,10,0.35), inset 0 1px 0 rgba(255,255,255,0.6)',
              }}
              initial={{ scale: 0.85, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 22, stiffness: 320 }}
            >
              {/* Wooden header plank, matches the farm popups */}
              <div
                className="relative px-5 pt-5 pb-4 text-center"
                style={{
                  background: 'linear-gradient(180deg, #7FC24B 0%, #5DAA30 55%, #3F8B1B 100%)',
                  boxShadow: '0 3px 0 #2C6A0F, inset 0 1px 0 rgba(255,255,255,0.3)',
                }}
              >
                <button
                  className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/20 flex items-center justify-center active:scale-90 transition-transform"
                  onClick={() => { haptic('tap'); handleClose(); }}
                  aria-label="Close"
                >
                  <span className="text-white text-xs font-bold">✕</span>
                </button>
                <div className="text-3xl mb-1.5">🌱🤝</div>
                <h3 className="text-white font-extrabold text-[15px] leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
                  {t('session_invite.title', { defaultValue: 'Приглашайте друзей и ускоряйте выращивание овоща!' })}
                </h3>
              </div>

              <div className="px-5 pt-4 pb-5 space-y-3.5">
                <p className="text-[12px] text-amber-900/80 text-center leading-snug font-medium">
                  {t('session_invite.desc', {
                    defaultValue: 'Отправьте друзьям ваш код и ссылку на Play Market. Оба получите +100 удобрений, когда друг установит игру.',
                  })}
                </p>

                {/* Invite code — big, monospaced, easy to read aloud */}
                <div>
                  <p className="text-[10px] font-semibold text-amber-700/70 uppercase tracking-wider mb-1.5 text-center">
                    {t('session_invite.your_code', { defaultValue: 'Ваш код' })}
                  </p>
                  <div
                    className="rounded-2xl border-2 border-amber-300/70 bg-gradient-to-br from-[#FFFDF5] to-[#FFF3CF] py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_2px_6px_rgba(180,130,50,0.15)]"
                  >
                    <span className="block text-center text-[26px] font-mono font-extrabold text-emerald-700 tracking-[0.35em] select-all">
                      {code || '……'}
                    </span>
                  </div>
                </div>

                {/* Primary action: copy code + Play Store referrer-link in one tap */}
                <button
                  className="w-full text-white font-extrabold text-[13px] py-3 rounded-2xl transition-all active:translate-y-[2px] disabled:opacity-60"
                  style={{
                    background: 'linear-gradient(180deg, #78D44B 0%, #5DBB36 55%, #3F9922 100%)',
                    boxShadow: '0 3px 0 #2D7A15, 0 4px 10px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.3)',
                  }}
                  disabled={!code}
                  onClick={() => { haptic('success'); copyShare(); }}
                >
                  {copied
                    ? t('session_invite.copied', { defaultValue: 'Код и ссылка скопированы!' })
                    : t('session_invite.copy', { defaultValue: 'Скопировать код + ссылку' })}
                </button>

                {canShare && code && (
                  <button
                    className="w-full text-amber-900 font-bold text-[12px] py-2.5 rounded-2xl bg-white/70 border-2 border-amber-300/70 active:scale-95 transition-transform"
                    onClick={() => { haptic('impact'); shareNative(); }}
                  >
                    {t('session_invite.share', { defaultValue: 'Поделиться в мессенджере' })}
                  </button>
                )}

                <p className="text-[10px] text-amber-700/70 text-center leading-snug">
                  {t('session_invite.footer', {
                    defaultValue: 'Друг устанавливает Boost Farm по ссылке — бонус начисляется автоматически.',
                  })}
                </p>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
