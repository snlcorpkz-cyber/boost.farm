const A = '/assets';

export interface CropStageFrames {
  open: string;
  closed: string;
}

export const CROP_STAGES: Record<string, Record<number, CropStageFrames>> = {
  'product.potato': {
    1: { open: `${A}/crops/potato-stage1-open.png`, closed: `${A}/crops/potato-stage1-closed.png` },
    2: { open: `${A}/crops/potato-stage2-open.png`, closed: `${A}/crops/potato-stage2-closed.png` },
    3: { open: `${A}/crops/potato-stage3-open.png`, closed: `${A}/crops/potato-stage3-closed.png` },
    4: { open: `${A}/crops/potato-stage4-open.png`, closed: `${A}/crops/potato-stage4-closed.png` },
    5: { open: `${A}/crops/potato-stage5-open.png`, closed: `${A}/crops/potato-stage5-closed.png` },
    6: { open: `${A}/crops/potato-stage6-open.png`, closed: `${A}/crops/potato-stage6-closed.png` },
  },
  'product.tomato': {
    1: { open: `${A}/crops/potato-stage1-open.png`, closed: `${A}/crops/potato-stage1-closed.png` },
    2: { open: `${A}/crops/potato-stage2-open.png`, closed: `${A}/crops/potato-stage2-closed.png` },
    3: { open: `${A}/crops/potato-stage3-open.png`, closed: `${A}/crops/potato-stage3-closed.png` },
    4: { open: `${A}/crops/potato-stage4-open.png`, closed: `${A}/crops/potato-stage4-closed.png` },
    5: { open: `${A}/crops/potato-stage5-open.png`, closed: `${A}/crops/potato-stage5-closed.png` },
    6: { open: `${A}/crops/potato-stage6-open.png`, closed: `${A}/crops/potato-stage6-closed.png` },
  },
  'product.carrot': {
    1: { open: `${A}/crops/potato-stage1-open.png`, closed: `${A}/crops/potato-stage1-closed.png` },
    2: { open: `${A}/crops/potato-stage2-open.png`, closed: `${A}/crops/potato-stage2-closed.png` },
    3: { open: `${A}/crops/potato-stage3-open.png`, closed: `${A}/crops/potato-stage3-closed.png` },
    4: { open: `${A}/crops/potato-stage4-open.png`, closed: `${A}/crops/potato-stage4-closed.png` },
    5: { open: `${A}/crops/potato-stage5-open.png`, closed: `${A}/crops/potato-stage5-closed.png` },
    6: { open: `${A}/crops/potato-stage6-open.png`, closed: `${A}/crops/potato-stage6-closed.png` },
  },
  'product.cucumber': {
    1: { open: `${A}/crops/potato-stage1-open.png`, closed: `${A}/crops/potato-stage1-closed.png` },
    2: { open: `${A}/crops/potato-stage2-open.png`, closed: `${A}/crops/potato-stage2-closed.png` },
    3: { open: `${A}/crops/potato-stage3-open.png`, closed: `${A}/crops/potato-stage3-closed.png` },
    4: { open: `${A}/crops/potato-stage4-open.png`, closed: `${A}/crops/potato-stage4-closed.png` },
    5: { open: `${A}/crops/potato-stage5-open.png`, closed: `${A}/crops/potato-stage5-closed.png` },
    6: { open: `${A}/crops/potato-stage6-open.png`, closed: `${A}/crops/potato-stage6-closed.png` },
  },
  'product.onion': {
    1: { open: `${A}/crops/potato-stage1-open.png`, closed: `${A}/crops/potato-stage1-closed.png` },
    2: { open: `${A}/crops/potato-stage2-open.png`, closed: `${A}/crops/potato-stage2-closed.png` },
    3: { open: `${A}/crops/potato-stage3-open.png`, closed: `${A}/crops/potato-stage3-closed.png` },
    4: { open: `${A}/crops/potato-stage4-open.png`, closed: `${A}/crops/potato-stage4-closed.png` },
    5: { open: `${A}/crops/potato-stage5-open.png`, closed: `${A}/crops/potato-stage5-closed.png` },
    6: { open: `${A}/crops/potato-stage6-open.png`, closed: `${A}/crops/potato-stage6-closed.png` },
  },
};

export const CROP_BASE: Record<string, string> = {
  'product.potato': `${A}/crops/potato-base.png`,
  'product.tomato': `${A}/crops/potato-base.png`,
  'product.carrot': `${A}/crops/potato-base.png`,
  'product.cucumber': `${A}/crops/potato-base.png`,
  'product.onion': `${A}/crops/potato-base.png`,
};

export const PET_IMAGES: Record<string, string> = {
  monkey: `${A}/pets/monkey.png`,
  rabbit: `${A}/pets/rabbit.png`,
  hamster: `${A}/pets/hamster.png`,
  hamsterGift: `${A}/pets/hamster-gift.png`,
};

export const HAMSTER_FRAMES: string[] = [
  `${A}/pets/hamster.png`,
  `${A}/pets/hamster-surprised.png`,
  `${A}/pets/hamster-sleep.png`,
];

export const MONKEY_FRAMES: string[] = [
  `${A}/pets/monkey.png`,
  `${A}/pets/monkey-sleep.png`,
  `${A}/pets/monkey-handstand.png`,
];

export const RABBIT_FRAMES: string[] = [
  `${A}/pets/rabbit.png`,
  `${A}/pets/rabbit-sleep.png`,
  `${A}/pets/rabbit-sit.png`,
];

export const AVATAR_IMAGES: Record<string, string> = {
  bear: `${A}/avatars/bear.png`,
  penguin: `${A}/avatars/penguin.png`,
  ram: `${A}/avatars/ram.png`,
  dog: `${A}/avatars/dog.png`,
};

export const AVATAR_LIST = ['bear', 'penguin', 'ram', 'dog'] as const;

export const UI = {
  waterDrop: `${A}/ui/water-drop.png`,
  fertilizer: `${A}/ui/fertilizer.png`,
  wateringCan: `${A}/ui/watering-can.png`,
  bucket: `${A}/ui/bucket.png`,
  bucketFull: `${A}/ui/bucket-full.png`,
  coupon: `${A}/ui/coupon.png`,
  well: `${A}/ui/well.png`,
  rainbow: `${A}/ui/rainbow.png`,
  butterfly: `${A}/ui/butterfly.png`,
  greetHand: `${A}/ui/greet-hand.png`,
  bell: `${A}/ui/bell.png`,
  gift: `${A}/ui/gift.png`,
  challengeFrame: `${A}/ui/challenge-frame.png`,
};

export const PRODUCT_PHOTOS: Record<string, string> = {
  'product.potato': `${A}/products/potato.png`,
  'product.tomato': `${A}/products/tomato.png`,
  'product.carrot': `${A}/products/carrot.png`,
  'product.cucumber': `${A}/products/cucumber.png`,
  'product.onion': `${A}/products/onion.png`,
};

export const BG: Record<string, string> = {
  morning: `${A}/bg/morning.png`,
  afternoon: `${A}/bg/afternoon.png`,
  evening: `${A}/bg/evening.png`,
  night: `${A}/bg/night.png`,
};

export function getCropFrames(nameKey: string, stage: number): CropStageFrames | null {
  return CROP_STAGES[nameKey]?.[stage] ?? null;
}

export function getCropBase(nameKey: string): string {
  return CROP_BASE[nameKey] ?? `${A}/crops/potato-base.png`;
}

export function getAvatarImage(avatarId: string): string | null {
  return AVATAR_IMAGES[avatarId] ?? null;
}

export function getAvatarDisplay(avatarId: string): string {
  const img = AVATAR_IMAGES[avatarId];
  if (img) return avatarId;
  return 'bear';
}
