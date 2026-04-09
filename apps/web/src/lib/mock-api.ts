import {
  getMultiplier,
  performWatering,
  FRIEND_WATERING_COST,
  REFERRAL_REWARDS,
  PetId,
  PET_IDS as ENGINE_PET_IDS,
  PET_UNLOCK_CONDITIONS,
  getEffectiveBucketCapacity,
  getEffectiveFillRate,
  getRankForWater,
  type RankDef,
} from '@eco-farm/game-engine';

const PRODUCTS = [
  { id: 'p1', name_key: 'product.potato', difficulty_stars: 1, base_water_required: 10000, coupon_validity_days: 60, active: true, image_url: null },
  { id: 'p2', name_key: 'product.tomato', difficulty_stars: 3, base_water_required: 10000, coupon_validity_days: 60, active: true, image_url: null },
  { id: 'p3', name_key: 'product.carrot', difficulty_stars: 1, base_water_required: 10000, coupon_validity_days: 60, active: true, image_url: null },
  { id: 'p4', name_key: 'product.cucumber', difficulty_stars: 2, base_water_required: 10000, coupon_validity_days: 60, active: true, image_url: null },
  { id: 'p5', name_key: 'product.onion', difficulty_stars: 1, base_water_required: 10000, coupon_validity_days: 60, active: true, image_url: null },
];

const REF_FERT_REWARD = REFERRAL_REWARDS.NUTRITION;

interface ReferralFriend {
  id: string;
  nickname: string;
  avatar_id: string;
  referral_code: string;
  active_pet: PetId;
  bucket_fill_percent: number;
  farm: { growth_percent: number; current_stage: number; product_id: string; products: { name_key: string } };
}

function generateRefCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'ECO-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function emptyFriends(): ReferralFriend[] {
  return [];
}

function buildQuests(rank: RankDef) {
  return [
    { id: 'q1', quest_key: 'checkin', reward_type: 'water', reward_amount: rank.loginWater, limit_per_phase: 1, category: 'water' },
    { id: 'q1f', quest_key: 'checkin', reward_type: 'nutrition', reward_amount: rank.loginFertilizer, limit_per_phase: 1, category: 'fertilizer' },
    { id: 'q2', quest_key: 'greet_friend', reward_type: 'water', reward_amount: rank.greetWater, limit_per_phase: 10, category: 'water' },
    { id: 'q3', quest_key: 'watch_ad', reward_type: 'water', reward_amount: rank.adWater, limit_per_phase: 2, category: 'water' },
    { id: 'q3f', quest_key: 'watch_ad', reward_type: 'nutrition', reward_amount: rank.adFertilizer, limit_per_phase: 2, category: 'fertilizer' },
    { id: 'q5', quest_key: 'water_friend', reward_type: 'nutrition', reward_amount: rank.waterFriendFert, limit_per_phase: 10, category: 'fertilizer' },
  ];
}

const MOCK_GAMES = [
  { id: 'g1', name_key: 'games.puzzle_blast', icon: '🧩', desc_key: 'games.puzzle_blast_desc', condition_key: 'games.play_30min', condition_param: null, reward_type: 'water', reward_amount: 50 },
  { id: 'g2', name_key: 'games.tower_stack', icon: '🏗️', desc_key: 'games.tower_stack_desc', condition_key: 'games.reach_level', condition_param: 20, reward_type: 'water', reward_amount: 100 },
  { id: 'g3', name_key: 'games.fruit_match', icon: '🍎', desc_key: 'games.fruit_match_desc', condition_key: 'games.play_30min', condition_param: null, reward_type: 'nutrition', reward_amount: 5 },
  { id: 'g4', name_key: 'games.space_runner', icon: '🚀', desc_key: 'games.space_runner_desc', condition_key: 'games.reach_level', condition_param: 20, reward_type: 'nutrition', reward_amount: 10 },
];

const PET_IDS = ENGINE_PET_IDS;

interface MockPetsState {
  active_id: PetId;
  hamster_last_gift_at: string | null;
  referral_count: number;
  total_quests_completed: number;
}

interface MockNotification {
  id: string;
  type: 'greet' | 'water' | 'quest' | 'invite' | 'gift' | 'stage' | 'bucket' | 'harvest' | 'game';
  message_key: string;
  params: Record<string, string | number>;
  created_at: string;
  read: boolean;
}

interface DailyChallengeState {
  date: string;
  waterGiven: number;
  completed: boolean;
  rewardClaimed: boolean;
  streakDays: number;
}

interface MockState {
  user: { id: string; email: string; nickname: string; avatar_id: string; locale: string };
  farm: any | null;
  referral_code: string;
  referred_by: string | null;
  friends: ReferralFriend[];
  questCompletions: Record<string, number>;
  gamesClaimed: Record<string, boolean>;
  pets: MockPetsState;
  notifications: MockNotification[];
  totalWaterLastMonth: number;
  dailyChallenge: DailyChallengeState;
}

function defaultPets(): MockPetsState {
  return { active_id: 'hamster', hamster_last_gift_at: null, referral_count: 0, total_quests_completed: 0 };
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultDailyChallenge(): DailyChallengeState {
  return { date: todayStr(), waterGiven: 0, completed: false, rewardClaimed: false, streakDays: 0 };
}

function getUserRank(s: MockState): RankDef {
  return getRankForWater(s.totalWaterLastMonth || 0);
}

function seedNotifications(): MockNotification[] {
  const now = Date.now();
  return [
    { id: 'n1', type: 'greet', message_key: 'notif.greeted_you', params: { name: 'Алиса' }, created_at: new Date(now - 120000).toISOString(), read: false },
    { id: 'n2', type: 'water', message_key: 'notif.watered_you', params: { name: 'Борис', amount: 5 }, created_at: new Date(now - 300000).toISOString(), read: false },
    { id: 'n3', type: 'quest', message_key: 'notif.quest_done', params: { reward: 40, unit: 'water' }, created_at: new Date(now - 600000).toISOString(), read: false },
    { id: 'n4', type: 'greet', message_key: 'notif.greeted_you', params: { name: 'Елена' }, created_at: new Date(now - 900000).toISOString(), read: false },
    { id: 'n5', type: 'invite', message_key: 'notif.friend_joined', params: { name: 'Дима', water: 20, fert: 5 }, created_at: new Date(now - 1800000).toISOString(), read: false },
    { id: 'n6', type: 'gift', message_key: 'notif.gift_received', params: { amount: 10 }, created_at: new Date(now - 3600000).toISOString(), read: false },
    { id: 'n7', type: 'water', message_key: 'notif.watered_you', params: { name: 'Вика', amount: 5 }, created_at: new Date(now - 7200000).toISOString(), read: true },
    { id: 'n8', type: 'stage', message_key: 'notif.stage_up', params: { stage: 3 }, created_at: new Date(now - 86400000).toISOString(), read: true },
  ];
}

function pushNotification(type: MockNotification['type'], message_key: string, params: Record<string, string | number>) {
  state.notifications.unshift({
    id: 'n' + Date.now(),
    type,
    message_key,
    params,
    created_at: new Date().toISOString(),
    read: false,
  });
  saveState(state);
}

function isPetUnlocked(petId: PetId, petsState: MockPetsState): boolean {
  const cond = PET_UNLOCK_CONDITIONS[petId];
  switch (cond.type) {
    case 'free':
      return true;
    case 'referrals':
      return petsState.referral_count >= cond.required;
    case 'quests':
      return petsState.total_quests_completed >= cond.required;
    default:
      return false;
  }
}

interface PetResponseItem {
  id: PetId;
  is_active: boolean;
  unlocked: boolean;
  last_gift_at: string | null;
  unlock_progress?: { current: number; required: number };
}

function petsResponse(): { pets: PetResponseItem[] } {
  return {
    pets: PET_IDS.map((id) => {
      const unlocked = isPetUnlocked(id, state.pets);
      const cond = PET_UNLOCK_CONDITIONS[id];
      let unlock_progress: { current: number; required: number } | undefined;
      if (!unlocked) {
        if (cond.type === 'referrals') {
          unlock_progress = { current: state.pets.referral_count, required: cond.required };
        } else if (cond.type === 'quests') {
          unlock_progress = { current: state.pets.total_quests_completed, required: cond.required };
        }
      }
      return {
        id,
        is_active: state.pets.active_id === id,
        unlocked,
        last_gift_at: id === 'hamster' ? state.pets.hamster_last_gift_at : null,
        unlock_progress,
      };
    }),
  };
}

function loadState(): MockState {
  const defaultUser = { id: 'demo-user', email: 'demo@eco-farm.app', nickname: 'DemoFarmer', avatar_id: 'bear', locale: 'en' };
  const saved = localStorage.getItem('eco_mock_state');
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as Partial<MockState>;
      return {
        user: parsed.user ?? defaultUser,
        farm: parsed.farm ?? null,
        referral_code: parsed.referral_code ?? generateRefCode(),
        referred_by: parsed.referred_by ?? null,
        friends: parsed.friends ?? emptyFriends(),
        questCompletions: parsed.questCompletions ?? {},
        gamesClaimed: parsed.gamesClaimed ?? {},
        pets: {
          ...defaultPets(),
          ...parsed.pets,
          active_id: (PET_IDS as readonly PetId[]).includes(parsed.pets?.active_id as PetId)
            ? (parsed.pets!.active_id as PetId)
            : defaultPets().active_id,
          referral_count: parsed.pets?.referral_count ?? 0,
          total_quests_completed: parsed.pets?.total_quests_completed ?? 0,
        },
        notifications: parsed.notifications ?? seedNotifications(),
        totalWaterLastMonth: parsed.totalWaterLastMonth ?? 0,
        dailyChallenge: parsed.dailyChallenge ?? defaultDailyChallenge(),
      };
    } catch {
      /* ignore */
    }
  }
  return {
    user: defaultUser,
    farm: null,
    referral_code: generateRefCode(),
    referred_by: null,
    friends: emptyFriends(),
    questCompletions: {},
    gamesClaimed: {},
    pets: defaultPets(),
    notifications: seedNotifications(),
    totalWaterLastMonth: 0,
    dailyChallenge: defaultDailyChallenge(),
  };
}

function saveState(state: MockState) {
  localStorage.setItem('eco_mock_state', JSON.stringify(state));
}

function getCurrentPhase(): string {
  const h = new Date().getHours();
  if (h >= 4 && h <= 10) return 'morning';
  if (h >= 11 && h <= 16) return 'afternoon';
  return 'evening';
}

let state = loadState();

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function addMonthlyWater(farm: any, amount: number) {
  if (!farm) return;
  const mk = currentMonthKey();
  if (farm.water_month_key !== mk) {
    farm.total_water_this_month = 0;
    farm.water_month_key = mk;
  }
  farm.total_water_this_month = parseFloat(((farm.total_water_this_month || 0) + amount).toFixed(2));
}

function computeBucket(farm: any, activePet?: PetId | null): number {
  const capacity = getEffectiveBucketCapacity(activePet);
  const fillRate = getEffectiveFillRate(activePet);
  const elapsed = (Date.now() - new Date(farm.bucket_last_collected_at).getTime()) / 60000;
  return Math.min(capacity, parseFloat((elapsed * fillRate).toFixed(2)));
}

export async function mockApi(path: string, options: RequestInit = {}): Promise<any> {
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 200));

  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body as string) : {};

  // AUTH
  if (path === '/auth/send-code' && method === 'POST') {
    return { message: 'Code sent (demo: use 000000)' };
  }
  if (path === '/auth/verify-code' && method === 'POST') {
    const isNewUser = !state.farm;
    if (body.refCode && isNewUser) {
      state.referred_by = body.refCode;
      const refName = body.refCode;
      const newFriend: ReferralFriend = {
        id: 'ref-' + Date.now(),
        nickname: 'Referrer',
        avatar_id: 'bear',
        referral_code: refName,
        active_pet: 'hamster' as PetId,
        bucket_fill_percent: 30,
        farm: { growth_percent: 15, current_stage: 2, product_id: 'p1', products: { name_key: 'product.potato' } },
      };
      if (!state.friends.find((f) => f.referral_code === refName)) {
        state.friends.push(newFriend);
      }
      if (state.farm) {
        state.farm.nutrition += REF_FERT_REWARD;
      }
      state.pets.referral_count = (state.pets.referral_count || 0) + 1;
      pushNotification('invite', 'notif.friend_joined', { name: 'Referrer', fert: REF_FERT_REWARD });
      saveState(state);
    }
    return {
      accessToken: 'demo-token',
      refreshToken: 'demo-refresh',
      user: state.user,
      isNewUser,
    };
  }

  // USER
  if (path === '/user/profile' && method === 'GET') {
    return { user: state.user };
  }
  if (path === '/user/profile' && method === 'PATCH') {
    if (body.nickname) state.user.nickname = body.nickname;
    if (body.avatarId) state.user.avatar_id = body.avatarId;
    if (body.locale) state.user.locale = body.locale;
    saveState(state);
    return { user: state.user };
  }

  // FARM
  if (path === '/farm' && method === 'GET') {
    if (!state.farm) return { farm: null, needsCropSelection: true };
    const activePet = state.pets.active_id;
    const bucketWater = computeBucket(state.farm, activePet);
    const mk = currentMonthKey();
    const monthlyTotal = state.farm.water_month_key === mk ? (state.farm.total_water_this_month || 0) : 0;
    const rank = getUserRank(state);
    return {
      farm: {
        ...state.farm,
        computed_bucket_water: bucketWater,
        multiplier: getMultiplier(state.farm.nutrition),
        active_pet: activePet,
        total_water_this_month: monthlyTotal,
      },
      rank: rank.id,
      rankDef: rank,
      needsCropSelection: false,
    };
  }

  if (path === '/farm/collect-bucket' && method === 'POST') {
    if (!state.farm) throw new Error('No farm');
    const activePet = state.pets.active_id;
    const collected = computeBucket(state.farm, activePet);
    state.farm.water_in_can = parseFloat((state.farm.water_in_can + collected).toFixed(2));
    addMonthlyWater(state.farm, collected);
    state.farm.bucket_last_collected_at = new Date().toISOString();
    if (collected > 0) {
      pushNotification('bucket', 'notif.bucket_collected', { amount: Math.round(collected) });
    }
    saveState(state);
    return { collected, waterInCan: state.farm.water_in_can };
  }

  if (path === '/farm/water' && method === 'POST') {
    if (!state.farm) throw new Error('No farm');
    const times = body.times || 1;
    const product = PRODUCTS.find((p) => p.id === state.farm.product_id)!;
    const activePet = state.pets.active_id;
    const result = performWatering(
      {
        id: state.farm.id,
        userId: state.user.id,
        productId: state.farm.product_id,
        growthPercent: state.farm.growth_percent,
        currentStage: state.farm.current_stage,
        waterInCan: state.farm.water_in_can,
        waterInBucket: 0,
        nutrition: state.farm.nutrition,
        bucketLastCollectedAt: new Date(state.farm.bucket_last_collected_at),
        totalWateringsToday: state.farm.total_waterings_today,
        dayResetAt: new Date(state.farm.day_reset_at),
        harvested: false,
        createdAt: new Date(state.farm.created_at),
      },
      times,
      product.difficulty_stars,
      activePet
    );
    const oldStage = state.farm.current_stage;
    state.farm.growth_percent = result.newGrowthPercent;
    state.farm.current_stage = result.newStage;
    state.farm.water_in_can = result.newWaterInCan;
    state.farm.nutrition = result.newNutrition;
    state.farm.total_waterings_today += times;
    state.farm.harvested = result.harvested;

    if (result.newStage > oldStage) {
      pushNotification('stage', 'notif.stage_up', { stage: result.newStage });
    }
    if (result.harvested) {
      pushNotification('harvest', 'notif.harvest_complete', {});
    }

    const today = todayStr();
    if (state.dailyChallenge.date !== today) {
      const prevCompleted = state.dailyChallenge.completed && state.dailyChallenge.rewardClaimed;
      state.dailyChallenge = {
        date: today,
        waterGiven: 0,
        completed: false,
        rewardClaimed: false,
        streakDays: prevCompleted ? state.dailyChallenge.streakDays : 0,
      };
    }
    state.dailyChallenge.waterGiven += result.waterConsumed;
    const rank = getUserRank(state);
    if (state.dailyChallenge.waterGiven >= rank.dailyChallengeWaterReq) {
      state.dailyChallenge.completed = true;
    }

    saveState(state);
    return result;
  }

  if (path === '/farm/fertilize' && method === 'POST') {
    if (!state.farm) throw new Error('No farm');
    state.farm.nutrition += body.amount;
    saveState(state);
    return { nutrition: state.farm.nutrition, multiplier: getMultiplier(state.farm.nutrition) };
  }

  if (path === '/farm/new-crop' && method === 'POST') {
    const product = PRODUCTS.find((p) => p.id === body.productId);
    if (!product) throw new Error('Product not found');
    state.farm = {
      id: 'farm-' + Date.now(),
      user_id: state.user.id,
      product_id: product.id,
      products: product,
      growth_percent: 0,
      current_stage: 1,
      water_in_can: 100,
      water_in_bucket: 0,
      nutrition: 50,
      bucket_last_collected_at: new Date().toISOString(),
      total_waterings_today: 0,
      day_reset_at: new Date().toISOString(),
      harvested: false,
      created_at: new Date().toISOString(),
    };
    saveState(state);
    return { farm: state.farm };
  }

  // FRIENDS
  if (path === '/friends' && method === 'GET') {
    return { friends: state.friends };
  }
  if (path === '/friends/invite-code' && method === 'GET') {
    const link = `https://boostfarm.io/?ref=${state.referral_code}`;
    return { code: state.referral_code, link };
  }
  if (path === '/friends/add' && method === 'POST') {
    const code = (body.code || '').toUpperCase().trim();
    if (!code) throw new Error('ref.invalid_code');
    if (code === state.referral_code) throw new Error('ref.invalid_code');
    if (state.friends.find((f) => f.referral_code === code)) throw new Error('ref.already_friends');

    const avatars = ['bear', 'penguin', 'ram', 'dog'];
    const names = ['Артём', 'Соня', 'Макс', 'Лена', 'Кира', 'Олег', 'Ника', 'Саша'];
    const newFriend: ReferralFriend = {
      id: 'f-' + Date.now(),
      nickname: names[Math.floor(Math.random() * names.length)],
      avatar_id: avatars[Math.floor(Math.random() * avatars.length)],
      referral_code: code,
      active_pet: 'hamster' as PetId,
      bucket_fill_percent: Math.floor(Math.random() * 80) + 10,
      farm: {
        growth_percent: Math.floor(Math.random() * 60) + 5,
        current_stage: Math.floor(Math.random() * 4) + 1,
        product_id: 'p1',
        products: { name_key: 'product.potato' },
      },
    };
    state.friends.push(newFriend);
    state.pets.referral_count = (state.pets.referral_count || 0) + 1;

    if (state.farm) {
      state.farm.nutrition += REF_FERT_REWARD;
    }
    pushNotification('invite', 'notif.friend_joined', { name: newFriend.nickname, fert: REF_FERT_REWARD });
    saveState(state);
    return {
      friend: newFriend,
      fertReward: REF_FERT_REWARD,
    };
  }

  if (path.match(/^\/friends\/\w+\/greet$/) && method === 'POST') {
    const friendId = path.split('/')[2];
    const friend = state.friends.find((f) => f.id === friendId);
    const rank = getUserRank(state);
    const reward = rank.greetWater;
    if (state.farm) {
      state.farm.water_in_can += reward;
      addMonthlyWater(state.farm, reward);
      saveState(state);
    }
    pushNotification('greet', 'notif.you_greeted', { name: friend?.nickname ?? '?', amount: reward });
    return { waterEarned: reward };
  }

  if (path.match(/^\/friends\/\w+\/water$/) && method === 'POST') {
    const rank = getUserRank(state);
    const fertReward = rank.waterFriendFert;
    if (state.farm) {
      state.farm.water_in_can = Math.max(0, state.farm.water_in_can - FRIEND_WATERING_COST);
      state.farm.nutrition += fertReward;
      saveState(state);
    }
    return { waterSpent: FRIEND_WATERING_COST, nutritionEarned: fertReward };
  }

  // QUESTS
  if (path === '/quests' && method === 'GET') {
    const phase = getCurrentPhase();
    const rank = getUserRank(state);
    const allQuests = buildQuests(rank);
    const filterCat = body.category as string | undefined;
    const quests = allQuests
      .filter((q) => !filterCat || q.category === filterCat)
      .map((q) => {
        const key = `${q.id}:${phase}`;
        const count = state.questCompletions[key] || 0;
        return { ...q, completedCount: count, isCompleted: count >= q.limit_per_phase };
      });
    return { quests, phase, rank: rank.id };
  }

  if (path.match(/^\/quests\/\w+\/complete$/) && method === 'POST') {
    const questId = path.split('/')[2];
    const phase = getCurrentPhase();
    const rank = getUserRank(state);
    const allQuests = buildQuests(rank);
    const quest = allQuests.find((q) => q.id === questId);
    if (!quest) throw new Error('Quest not found');

    const key = `${questId}:${phase}`;
    state.questCompletions[key] = (state.questCompletions[key] || 0) + 1;

    state.pets.total_quests_completed = (state.pets.total_quests_completed || 0) + 1;

    if (state.farm) {
      if (quest.reward_type === 'water') {
        state.farm.water_in_can += quest.reward_amount;
        addMonthlyWater(state.farm, quest.reward_amount);
      } else {
        state.farm.nutrition += quest.reward_amount;
      }
    }
    saveState(state);
    return { rewardType: quest.reward_type, rewardAmount: quest.reward_amount };
  }

  // DAILY CHALLENGE
  if (path === '/quests/daily-challenge' && method === 'GET') {
    const rank = getUserRank(state);
    const today = todayStr();
    if (state.dailyChallenge.date !== today) {
      const prevOk = state.dailyChallenge.completed && state.dailyChallenge.rewardClaimed;
      state.dailyChallenge = {
        date: today,
        waterGiven: 0,
        completed: false,
        rewardClaimed: false,
        streakDays: prevOk ? state.dailyChallenge.streakDays : 0,
      };
      saveState(state);
    }
    return {
      waterGiven: state.dailyChallenge.waterGiven,
      required: rank.dailyChallengeWaterReq,
      completed: state.dailyChallenge.completed,
      rewardClaimed: state.dailyChallenge.rewardClaimed,
      reward: rank.dailyChallengeReward,
      streakDays: state.dailyChallenge.streakDays,
      progress: Math.min(1, state.dailyChallenge.waterGiven / rank.dailyChallengeWaterReq),
    };
  }

  if (path === '/quests/daily-challenge/claim' && method === 'POST') {
    const rank = getUserRank(state);
    if (!state.dailyChallenge.completed || state.dailyChallenge.rewardClaimed) {
      throw new Error('Cannot claim');
    }
    state.dailyChallenge.rewardClaimed = true;
    state.dailyChallenge.streakDays += 1;
    if (state.farm) {
      state.farm.water_in_can += rank.dailyChallengeReward;
      addMonthlyWater(state.farm, rank.dailyChallengeReward);
    }
    saveState(state);
    return { rewardAmount: rank.dailyChallengeReward, streakDays: state.dailyChallenge.streakDays };
  }

  // GAMES
  if (path === '/games' && method === 'GET') {
    const claimed = state.gamesClaimed ?? {};
    return {
      games: MOCK_GAMES.map((g) => ({ ...g, claimed: !!claimed[g.id] })),
    };
  }

  if (path.match(/^\/games\/\w+\/claim$/) && method === 'POST') {
    const gameId = path.split('/')[2];
    const game = MOCK_GAMES.find((g) => g.id === gameId);
    if (!game) throw new Error('Game not found');
    if (!state.gamesClaimed) state.gamesClaimed = {};
    state.gamesClaimed[gameId] = true;
    if (state.farm) {
      if (game.reward_type === 'water') {
        state.farm.water_in_can += game.reward_amount;
        addMonthlyWater(state.farm, game.reward_amount);
      } else {
        state.farm.nutrition += game.reward_amount;
      }
    }
    saveState(state);
    return { rewardType: game.reward_type, rewardAmount: game.reward_amount };
  }

  // PRODUCTS (for crop select)
  if (path === '/admin/products' && method === 'GET') {
    return { products: PRODUCTS };
  }

  // NOTIFICATIONS
  if (path.startsWith('/user/notifications') && !path.includes('mark-read') && method === 'GET') {
    const url = new URL(path, 'http://x');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);
    const all = state.notifications;
    const page = all.slice(offset, offset + limit);
    const unreadCount = all.filter((n) => !n.read).length;
    return { notifications: page, unreadCount, hasMore: offset + limit < all.length, nextOffset: offset + limit };
  }
  if (path === '/user/notifications/mark-read' && method === 'POST') {
    const ids: string[] = body.ids || [];
    for (const n of state.notifications) {
      if (ids.includes(n.id)) n.read = true;
    }
    saveState(state);
    const unreadCount = state.notifications.filter((n) => !n.read).length;
    return { unreadCount };
  }

  // PETS
  if (path === '/pets' && method === 'GET') {
    return petsResponse();
  }

  if (path.match(/^\/pets\/([^/]+)\/activate$/) && method === 'POST') {
    const petId = path.split('/')[2] as PetId;
    if (!(PET_IDS as readonly PetId[]).includes(petId)) throw new Error('Pet not found');
    if (!isPetUnlocked(petId, state.pets)) throw new Error('Pet is locked');
    state.pets.active_id = petId;
    saveState(state);
    return petsResponse();
  }

  if (path.match(/^\/pets\/([^/]+)\/gift$/) && method === 'POST') {
    const petId = path.split('/')[2];
    if (petId !== 'hamster') throw new Error('Gift is only available for the hamster');
    const last = state.pets.hamster_last_gift_at
      ? new Date(state.pets.hamster_last_gift_at).getTime()
      : 0;
    const cooldownMs = 24 * 60 * 60 * 1000;
    if (last > 0 && Date.now() - last < cooldownMs) {
      throw new Error('Gift on cooldown');
    }
    state.pets.hamster_last_gift_at = new Date().toISOString();
    if (state.farm) {
      state.farm.water_in_can = parseFloat((state.farm.water_in_can + 10).toFixed(2));
      addMonthlyWater(state.farm, 10);
    }
    saveState(state);
    return { waterEarned: 10, ...petsResponse() };
  }

  throw new Error(`Mock API: Unknown route ${method} ${path}`);
}

export function resetMockState() {
  localStorage.removeItem('eco_mock_state');
  state = loadState();
}
