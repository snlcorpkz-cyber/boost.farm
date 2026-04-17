const A = '/assets';

export interface CropStageFrames {
  open: string;
  closed: string;
}

// NOTE: only stage 3, 5, 6 assets were ever committed. Stages 1/2/4 would 404
// and make the vegetable disappear from the center of the screen. Until real
// art for the missing stages exists, we fall back to the nearest stage that
// does exist (1,2 → 3; 4 → 5). The visual "growth" progression is still
// preserved because we have 3 distinct sprites.
const potatoStages: Record<number, CropStageFrames> = {
  1: { open: `${A}/crops/potato-stage3-open.webp`, closed: `${A}/crops/potato-stage3-closed.webp` },
  2: { open: `${A}/crops/potato-stage3-open.webp`, closed: `${A}/crops/potato-stage3-closed.webp` },
  3: { open: `${A}/crops/potato-stage3-open.webp`, closed: `${A}/crops/potato-stage3-closed.webp` },
  4: { open: `${A}/crops/potato-stage5-open.webp`, closed: `${A}/crops/potato-stage5-closed.webp` },
  5: { open: `${A}/crops/potato-stage5-open.webp`, closed: `${A}/crops/potato-stage5-closed.webp` },
  6: { open: `${A}/crops/potato-stage6-open.webp`, closed: `${A}/crops/potato-stage6-closed.webp` },
};

export const CROP_STAGES: Record<string, Record<number, CropStageFrames>> = {
  'product.potato':   potatoStages,
  'product.tomato':   potatoStages,
  'product.carrot':   potatoStages,
  'product.cucumber': potatoStages,
  'product.onion':    potatoStages,
};

export const CROP_BASE: Record<string, string> = {
  'product.potato': `${A}/crops/potato-base.webp`,
  'product.tomato': `${A}/crops/potato-base.webp`,
  'product.carrot': `${A}/crops/potato-base.webp`,
  'product.cucumber': `${A}/crops/potato-base.webp`,
  'product.onion': `${A}/crops/potato-base.webp`,
};

export const PET_IMAGES: Record<string, string> = {
  monkey: `${A}/pets/monkey.webp`,
  rabbit: `${A}/pets/rabbit.webp`,
  hamster: `${A}/pets/hamster.webp`,
  hamsterGift: `${A}/pets/hamster-gift.webp`,
};

export const HAMSTER_FRAMES: string[] = [
  `${A}/pets/hamster.webp`,
  `${A}/pets/hamster-surprised.webp`,
  `${A}/pets/hamster-sleep.webp`,
];

export const MONKEY_FRAMES: string[] = [
  `${A}/pets/monkey.webp`,
  `${A}/pets/monkey-sleep.webp`,
  `${A}/pets/monkey-handstand.webp`,
];

export const RABBIT_FRAMES: string[] = [
  `${A}/pets/rabbit.webp`,
  `${A}/pets/rabbit-sleep.webp`,
  `${A}/pets/rabbit-sit.webp`,
];

export const AVATAR_IMAGES: Record<string, string> = {
  bear: `${A}/avatars/bear.webp`,
  penguin: `${A}/avatars/penguin.webp`,
  ram: `${A}/avatars/ram.webp`,
  dog: `${A}/avatars/dog.webp`,
};

export const AVATAR_LIST = ['bear', 'penguin', 'ram', 'dog'] as const;

export const UI = {
  waterDrop: `${A}/ui/water-drop.webp`,
  fertilizer: `${A}/ui/fertilizer.webp`,
  wateringCan: `${A}/ui/watering-can.webp`,
  bucket: `${A}/ui/bucket.webp`,
  bucketFull: `${A}/ui/bucket-full.webp`,
  coupon: `${A}/ui/coupon.webp`,
  well: `${A}/ui/well.webp`,
  rainbow: `${A}/ui/rainbow.webp`,
  butterfly: `${A}/ui/butterfly.webp`,
  greetHand: `${A}/ui/greet-hand.webp`,
  bell: `${A}/ui/bell.webp`,
  gift: `${A}/ui/gift.webp`,
  challengeFrame: `${A}/ui/challenge-frame.webp`,
};

export const PRODUCT_PHOTOS: Record<string, string> = {
  'product.potato': `${A}/products/potato.webp`,
  'product.tomato': `${A}/products/tomato.webp`,
  'product.carrot': `${A}/products/carrot.webp`,
  'product.cucumber': `${A}/products/cucumber.webp`,
  'product.onion': `${A}/products/onion.webp`,
};

// NOTE: /assets/bg/afternoon.webp was never committed. Background.tsx
// maps the 'afternoon' phase to morning.webp. Keep the key here so existing
// references don't 500, but point it at the real file.
export const BG: Record<string, string> = {
  morning: `${A}/bg/morning.webp`,
  afternoon: `${A}/bg/morning.webp`,
  evening: `${A}/bg/evening.webp`,
  night: `${A}/bg/night.webp`,
};

export function getCropFrames(nameKey: string, stage: number): CropStageFrames | null {
  return CROP_STAGES[nameKey]?.[stage] ?? null;
}

export function getCropBase(nameKey: string): string {
  return CROP_BASE[nameKey] ?? `${A}/crops/potato-base.webp`;
}

export function getAvatarImage(avatarId: string): string | null {
  return AVATAR_IMAGES[avatarId] ?? null;
}

export function getAvatarDisplay(avatarId: string): string {
  const img = AVATAR_IMAGES[avatarId];
  if (img) return avatarId;
  return 'bear';
}
