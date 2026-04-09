const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

export type AdminProduct = {
  id: string;
  name: string;
  difficulty: number;
  baseWater: number;
  couponDays: number;
  active: boolean;
};

export type AdminUser = {
  id: string;
  nickname: string;
  email: string;
  avatarUrl: string;
  farmStatus: 'active' | 'dormant' | 'paused';
  growthPercent: number;
  joinedAt: string;
};

export type AdminCoupon = {
  id: string;
  code: string;
  userId: string;
  userNickname: string;
  productId: string;
  productName: string;
  expiresAt: string;
  redeemed: boolean;
};

export type AdminQuest = {
  id: string;
  key: string;
  rewardType: 'water' | 'coins' | 'xp' | 'coupon';
  amount: number;
  limitPhase: string;
  active: boolean;
};

export type DashboardStats = {
  totalUsers: number;
  activeFarms: number;
  couponsGenerated: number;
  avgGrowthPercent: number;
};

const initialProducts: AdminProduct[] = [
  {
    id: 'p1',
    name: 'Cherry Tomato',
    difficulty: 2,
    baseWater: 12,
    couponDays: 14,
    active: true,
  },
  {
    id: 'p2',
    name: 'Basil Pot',
    difficulty: 1,
    baseWater: 8,
    couponDays: 7,
    active: true,
  },
  {
    id: 'p3',
    name: 'Heirloom Pepper',
    difficulty: 4,
    baseWater: 20,
    couponDays: 21,
    active: false,
  },
  {
    id: 'p4',
    name: 'Microgreens Tray',
    difficulty: 3,
    baseWater: 15,
    couponDays: 10,
    active: true,
  },
  {
    id: 'p5',
    name: 'Strawberry Tower',
    difficulty: 5,
    baseWater: 25,
    couponDays: 30,
    active: true,
  },
];

const initialUsers: AdminUser[] = [
  {
    id: 'u1',
    nickname: 'GreenThumb_92',
    email: 'alex.morgan@example.com',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex',
    farmStatus: 'active',
    growthPercent: 87,
    joinedAt: '2025-11-12T10:00:00.000Z',
  },
  {
    id: 'u2',
    nickname: 'SoilSister',
    email: 'jordan.lee@example.com',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jordan',
    farmStatus: 'active',
    growthPercent: 64,
    joinedAt: '2026-01-03T14:22:00.000Z',
  },
  {
    id: 'u3',
    nickname: 'HydroHarper',
    email: 'harper.w@example.org',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Harper',
    farmStatus: 'dormant',
    growthPercent: 12,
    joinedAt: '2025-08-20T09:15:00.000Z',
  },
  {
    id: 'u4',
    nickname: 'PlotTwist',
    email: 'sam.taylor@example.com',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sam',
    farmStatus: 'paused',
    growthPercent: 41,
    joinedAt: '2026-02-01T16:40:00.000Z',
  },
  {
    id: 'u5',
    nickname: 'CompostKing',
    email: 'riley.b@example.net',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Riley',
    farmStatus: 'active',
    growthPercent: 95,
    joinedAt: '2025-12-08T11:05:00.000Z',
  },
  {
    id: 'u6',
    nickname: 'SeedlingSky',
    email: 'sky.patel@example.com',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sky',
    farmStatus: 'active',
    growthPercent: 73,
    joinedAt: '2026-03-15T08:30:00.000Z',
  },
];

const initialCoupons: AdminCoupon[] = [
  {
    id: 'c1',
    code: 'ECO-WELCOME-7K',
    userId: 'u1',
    userNickname: 'GreenThumb_92',
    productId: 'p1',
    productName: 'Cherry Tomato',
    expiresAt: '2026-05-01T23:59:59.000Z',
    redeemed: false,
  },
  {
    id: 'c2',
    code: 'BASIL-BOOST-22',
    userId: 'u2',
    userNickname: 'SoilSister',
    productId: 'p2',
    productName: 'Basil Pot',
    expiresAt: '2026-04-10T23:59:59.000Z',
    redeemed: true,
  },
  {
    id: 'c3',
    code: 'PEPPER-PHASE-9X',
    userId: 'u4',
    userNickname: 'PlotTwist',
    productId: 'p3',
    productName: 'Heirloom Pepper',
    expiresAt: '2026-06-20T23:59:59.000Z',
    redeemed: false,
  },
  {
    id: 'c4',
    code: 'MICRO-DAILY-1A',
    userId: 'u5',
    userNickname: 'CompostKing',
    productId: 'p4',
    productName: 'Microgreens Tray',
    expiresAt: '2026-03-28T23:59:59.000Z',
    redeemed: false,
  },
  {
    id: 'c5',
    code: 'BERRY-TOWER-4M',
    userId: 'u6',
    userNickname: 'SeedlingSky',
    productId: 'p5',
    productName: 'Strawberry Tower',
    expiresAt: '2025-12-01T23:59:59.000Z',
    redeemed: true,
  },
];

const initialQuests: AdminQuest[] = [
  {
    id: 'q1',
    key: 'daily_water_three',
    rewardType: 'water',
    amount: 5,
    limitPhase: '3 / day',
    active: true,
  },
  {
    id: 'q2',
    key: 'weekly_harvest',
    rewardType: 'coins',
    amount: 120,
    limitPhase: '1 / week',
    active: true,
  },
  {
    id: 'q3',
    key: 'refer_friend',
    rewardType: 'coupon',
    amount: 1,
    limitPhase: '5 / phase',
    active: true,
  },
  {
    id: 'q4',
    key: 'tutorial_complete',
    rewardType: 'xp',
    amount: 250,
    limitPhase: '1 / lifetime',
    active: false,
  },
  {
    id: 'q5',
    key: 'streak_seven',
    rewardType: 'water',
    amount: 15,
    limitPhase: '∞ / rolling',
    active: true,
  },
];

let products = structuredClone(initialProducts);
let users = structuredClone(initialUsers);
let coupons = structuredClone(initialCoupons);
let quests = structuredClone(initialQuests);

export async function fetchProducts(): Promise<AdminProduct[]> {
  await delay();
  return structuredClone(products);
}

export async function upsertProduct(
  data: Omit<AdminProduct, 'id'> & { id?: string },
): Promise<AdminProduct> {
  await delay();
  if (data.id) {
    const idx = products.findIndex((p) => p.id === data.id);
    if (idx < 0) throw new Error('Product not found');
    const updated: AdminProduct = {
      id: data.id,
      name: data.name,
      difficulty: data.difficulty,
      baseWater: data.baseWater,
      couponDays: data.couponDays,
      active: data.active,
    };
    products[idx] = updated;
    return structuredClone(updated);
  }
  const id = `p${Date.now()}`;
  const created: AdminProduct = {
    id,
    name: data.name,
    difficulty: data.difficulty,
    baseWater: data.baseWater,
    couponDays: data.couponDays,
    active: data.active,
  };
  products = [...products, created];
  return structuredClone(created);
}

export async function setProductActive(id: string, active: boolean): Promise<AdminProduct> {
  await delay();
  const idx = products.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error('Product not found');
  products[idx] = { ...products[idx], active };
  return structuredClone(products[idx]);
}

export async function fetchUsers(): Promise<AdminUser[]> {
  await delay();
  return structuredClone(users);
}

export async function fetchCoupons(): Promise<AdminCoupon[]> {
  await delay();
  return structuredClone(coupons);
}

export async function extendCoupon(id: string, days: number): Promise<AdminCoupon> {
  await delay();
  const idx = coupons.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error('Coupon not found');
  const d = new Date(coupons[idx].expiresAt);
  d.setUTCDate(d.getUTCDate() + days);
  coupons[idx] = { ...coupons[idx], expiresAt: d.toISOString() };
  return structuredClone(coupons[idx]);
}

export async function revokeCoupon(id: string): Promise<AdminCoupon> {
  await delay();
  const idx = coupons.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error('Coupon not found');
  coupons[idx] = { ...coupons[idx], redeemed: true };
  return structuredClone(coupons[idx]);
}

export async function fetchQuests(): Promise<AdminQuest[]> {
  await delay();
  return structuredClone(quests);
}

export async function setQuestActive(id: string, active: boolean): Promise<AdminQuest> {
  await delay();
  const idx = quests.findIndex((q) => q.id === id);
  if (idx < 0) throw new Error('Quest not found');
  quests[idx] = { ...quests[idx], active };
  return structuredClone(quests[idx]);
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  await delay();
  const list = structuredClone(users);
  const activeFarms = list.filter((u) => u.farmStatus === 'active').length;
  const sumGrowth = list.reduce((acc, u) => acc + u.growthPercent, 0);
  const avgGrowthPercent =
    list.length === 0 ? 0 : Math.round((sumGrowth / list.length) * 10) / 10;
  return {
    totalUsers: list.length,
    activeFarms,
    couponsGenerated: structuredClone(coupons).length,
    avgGrowthPercent,
  };
}
