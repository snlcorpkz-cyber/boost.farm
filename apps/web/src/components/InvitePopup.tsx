import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { UI } from '../lib/assets';

interface InvitePopupProps {
  open: boolean;
  onClose: () => void;
}

export default function InvitePopup({ open, onClose }: InvitePopupProps) {
  const { t } = useTranslation();
  const [copiedField, setCopiedField] = useState<'link' | 'code' | null>(null);

  const { data: inviteData } = useQuery({
    queryKey: ['invite-code'],
    queryFn: () => api<{ code: string; link: string }>('/friends/invite-code'),
    enabled: open,
  });

  const copyToClipboard = async (text: string, field: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch { /* fallback: ignore */ }
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
                  onClick={onClose}
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

                {/* Referral link */}
                {inviteData && (
                  <>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{t('ref.your_link')}</p>
                      <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                        <span className="flex-1 text-xs text-gray-600 truncate font-mono">{inviteData.link}</span>
                        <button
                          className="shrink-0 bg-green-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                          onClick={() => copyToClipboard(inviteData.link, 'link')}
                        >
                          {copiedField === 'link' ? t('ref.copied') : t('ref.copy_link')}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-[10px] text-gray-400">{t('ref.or_share_code')}</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                      <span className="flex-1 text-center text-base font-mono font-extrabold text-green-600 tracking-widest">{inviteData.code}</span>
                      <button
                        className="shrink-0 bg-green-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                        onClick={() => copyToClipboard(inviteData.code, 'code')}
                      >
                        {copiedField === 'code' ? t('ref.copied') : t('ref.copy_code')}
                      </button>
                    </div>
                  </>
                )}

              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
