import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { UI } from '../lib/assets';
import { haptic } from '../lib/native';

interface InvitePopupProps {
  open: boolean;
  onClose: () => void;
}

export default function InvitePopup({ open, onClose }: InvitePopupProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const { data: inviteData } = useQuery({
    queryKey: ['invite-code'],
    queryFn: () => api<{ code: string }>('/friends/invite-code'),
    enabled: open,
  });

  const inviteLink = inviteData?.code
    ? `${window.location.origin}/r/${inviteData.code}`
    : '';

  const copyCode = async () => {
    if (!inviteData?.code) return;
    try {
      await navigator.clipboard.writeText(inviteData.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback: ignore */ }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // Use the native Web Share API on mobile — opens the share sheet and lets
  // the user send the link via WhatsApp / Telegram / SMS / etc. in one tap.
  const shareLink = async () => {
    if (!inviteLink) return;
    const anyNav = navigator as any;
    if (typeof anyNav.share === 'function') {
      try {
        await anyNav.share({
          title: 'Boost Farm',
          text: "Join me on Boost Farm and we both get a bonus!",
          url: inviteLink,
        });
        return;
      } catch { /* user cancelled */ }
    }
    copyLink();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 z-[80]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-[81] flex items-center justify-center pointer-events-none px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white rounded-3xl shadow-2xl w-full max-w-[340px] overflow-hidden pointer-events-auto"
              initial={{ scale: 0.85, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.85, y: 30 }}
              transition={{ type: 'spring', damping: 24, stiffness: 350 }}
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-green-400 to-emerald-500 px-5 py-3 flex items-center justify-between">
                <h3 className="text-white font-bold text-sm">{t('ref.title')}</h3>
                <button
                  className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center"
                  onClick={() => { haptic('tap'); onClose(); }}
                >
                  <span className="text-white text-xs font-bold">✕</span>
                </button>
              </div>

              <div className="px-5 py-4 space-y-3.5">
                {/* Reward hint */}
                <div className="flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2">
                  <img src={UI.gift} alt="" className="w-6 h-6 object-contain" />
                  <span className="text-xs text-amber-700 font-medium">{t('ref.reward_hint')}</span>
                </div>

                {/* Invite code */}
                {inviteData && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{t('friends.invite_code')}</p>
                    <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                      <span className="flex-1 text-center text-lg font-mono font-extrabold text-green-600 tracking-widest">{inviteData.code}</span>
                      <button
                        className="shrink-0 bg-green-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                        onClick={() => { haptic('success'); copyCode(); }}
                      >
                        {copied ? t('ref.copied') : t('ref.copy_code')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Invite link — Play Store attribution built-in */}
                {inviteData && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Invite link</p>
                    <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                      <span className="flex-1 text-xs font-medium text-gray-700 truncate">{inviteLink}</span>
                      <button
                        className="shrink-0 bg-emerald-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                        onClick={() => { haptic('success'); copyLink(); }}
                      >
                        {linkCopied ? t('ref.copied') : 'Copy'}
                      </button>
                    </div>
                    <button
                      className="mt-2 w-full bg-gradient-to-r from-emerald-500 to-green-600 text-white font-bold py-2.5 rounded-xl text-sm shadow-md active:scale-95 transition-transform"
                      onClick={() => { haptic('impact'); shareLink(); }}
                    >
                      Share link
                    </button>
                    <p className="text-[10px] text-gray-400 mt-1.5 text-center">
                      When a friend installs via your link, you both get the bonus automatically.
                    </p>
                  </div>
                )}

              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
