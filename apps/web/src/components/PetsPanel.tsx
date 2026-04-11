import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api';
import { PET_IMAGES } from '../lib/assets';
import type { PetId } from '@eco-farm/game-engine';

interface PetDto {
  id: PetId;
  is_active: boolean;
  unlocked: boolean;
  last_gift_at: string | null;
  unlock_progress?: { current: number; required: number };
}

interface PetsResponse {
  pets: PetDto[];
}

interface GiftResponse {
  waterEarned: number;
  pets: PetDto[];
}

const PET_ORDER: PetId[] = ['hamster', 'rabbit', 'monkey'];
const NAME_KEY: Record<PetId, string> = {
  hamster: 'pet.hamster',
  rabbit: 'pet.rabbit',
  monkey: 'pet.monkey',
};
const BONUS_KEY: Record<PetId, string> = {
  hamster: 'pet.hamster.bonus',
  rabbit: 'pet.rabbit.bonus',
  monkey: 'pet.monkey.bonus',
};
const DESC_KEY: Record<PetId, string> = {
  hamster: 'pet.hamster.desc',
  rabbit: 'pet.rabbit.desc',
  monkey: 'pet.monkey.desc',
};
const UNLOCK_KEY: Record<PetId, string> = {
  hamster: '',
  rabbit: 'pet.unlock_referrals',
  monkey: 'pet.unlock_quests',
};

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function giftCooldownHours(lastGiftAt: string | null): number | null {
  if (!lastGiftAt) return null;
  const elapsed = Date.now() - new Date(lastGiftAt).getTime();
  if (elapsed >= COOLDOWN_MS) return null;
  return Math.max(1, Math.ceil((COOLDOWN_MS - elapsed) / (60 * 60 * 1000)));
}

export interface PetsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function PetsPanel({ open, onClose }: PetsPanelProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['pets'],
    queryFn: () => api<PetsResponse>('/pets'),
    enabled: open,
  });

  const activate = useMutation({
    mutationFn: (id: PetId) =>
      api<PetsResponse>(`/pets/${id}/activate`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pets'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
    },
  });

  const gift = useMutation({
    mutationFn: () => api<GiftResponse>('/pets/hamster/gift', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pets'] });
      qc.invalidateQueries({ queryKey: ['farm'] });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['pets'] });
    },
  });

  const petsById = useMemo(() => {
    const map = new Map<PetId, PetDto>();
    (data?.pets ?? []).forEach((p) => map.set(p.id as PetId, p));
    return map;
  }, [data?.pets]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal
            aria-labelledby="pets-panel-title"
            className="fixed bottom-0 inset-x-0 mx-auto w-full max-w-[390px] z-[95] max-h-[85vh] flex flex-col rounded-t-3xl bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.12)] overflow-hidden"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-200 shrink-0" />

            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
              <h2 id="pets-panel-title" className="text-lg font-extrabold text-gray-900">
                {t('pet.title')}
              </h2>
              <button
                type="button"
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-lg"
                onClick={onClose}
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-8">
              {isLoading && (
                <div className="space-y-3 py-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-28 rounded-2xl bg-gray-100 animate-pulse" />
                  ))}
                </div>
              )}
              {!isLoading &&
                PET_ORDER.map((id) => {
                  const pet = petsById.get(id);
                  if (!pet) return null;
                  const isLocked = !pet.unlocked;
                  const cooldownH = id === 'hamster' ? giftCooldownHours(pet.last_gift_at) : null;
                  const giftDisabled = cooldownH !== null || gift.isPending;
                  const imgSrc = PET_IMAGES[id];

                  return (
                    <div
                      key={id}
                      className={`rounded-2xl border-2 p-4 transition-colors ${
                        isLocked
                          ? 'border-gray-200 bg-gray-50/60 opacity-80'
                          : pet.is_active
                            ? 'border-farm-green bg-emerald-50/50 shadow-sm'
                            : 'border-gray-100 bg-white shadow-sm'
                      }`}
                    >
                      <div className="flex gap-3">
                        <div className="w-14 h-14 shrink-0 flex items-center justify-center relative">
                          {imgSrc ? (
                            <img
                              src={imgSrc}
                              alt=""
                              className={`w-12 h-12 object-contain ${isLocked ? 'grayscale' : ''}`}
                            />
                          ) : (
                            <span className="text-4xl">🐾</span>
                          )}
                          {isLocked && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-2xl">🔒</span>
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-gray-900">{t(NAME_KEY[id])}</span>
                            {pet.is_active && !isLocked && (
                              <span className="text-[10px] uppercase font-bold tracking-wide text-farm-green bg-farm-green/15 px-2 py-0.5 rounded-full">
                                {t('pet.active')}
                              </span>
                            )}
                            {isLocked && (
                              <span className="text-[10px] uppercase font-bold tracking-wide text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">
                                {t('pet.locked')}
                              </span>
                            )}
                          </div>

                          <p className="text-sm text-gray-600 mt-0.5">{t(DESC_KEY[id])}</p>

                          {!isLocked && (
                            <div className="mt-1 flex items-center gap-1">
                              <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                {t(BONUS_KEY[id])}
                              </span>
                            </div>
                          )}

                          {isLocked && pet.unlock_progress && (
                            <div className="mt-2">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] text-gray-500">
                                  {t(UNLOCK_KEY[id], {
                                    current: pet.unlock_progress.current,
                                    required: pet.unlock_progress.required,
                                  })}
                                </span>
                              </div>
                              <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden">
                                <motion.div
                                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                                  initial={{ width: 0 }}
                                  animate={{
                                    width: `${Math.min(100, (pet.unlock_progress.current / pet.unlock_progress.required) * 100)}%`,
                                  }}
                                  transition={{ duration: 0.6, ease: 'easeOut' }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {!isLocked && !pet.is_active && (
                        <button
                          type="button"
                          className="mt-3 w-full rounded-xl bg-gradient-to-r from-emerald-400 to-green-500 text-white font-bold py-2.5 text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
                          disabled={activate.isPending}
                          onClick={() => activate.mutate(id)}
                        >
                          {t('pet.activate')}
                        </button>
                      )}

                      {id === 'hamster' && !isLocked && (
                        <button
                          type="button"
                          className="mt-2 w-full rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-white font-bold py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
                          disabled={giftDisabled}
                          onClick={() => gift.mutate()}
                        >
                          {cooldownH !== null
                            ? t('pet.gift_cooldown', { hours: cooldownH })
                            : t('pet.claim_gift')}
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
