/**
 * Chaotic API load simulator: creates many users, farms, friend links, then random actions.
 *
 * Requires API with LOAD_TEST_SECRET set (same value in env) to bypass global 120 req/min per IP.
 */
import { ApiClient } from './client.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));
const pick = <T>(arr: T[]): T | undefined =>
  arr.length === 0 ? undefined : arr[Math.floor(Math.random() * arr.length)];

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

interface Bot {
  email: string;
  token: string;
}

async function bootstrapOne(
  api: ApiClient,
  email: string,
  productIds: string[],
  refCode?: string,
): Promise<Bot> {
  const { accessToken } = await api.verifyCode(email, refCode);
  const pid = pick(productIds);
  if (!pid) throw new Error('No product ids');
  await api.newCrop(accessToken, pid);
  return { email, token: accessToken };
}

async function randomAction(api: ApiClient, bot: Bot): Promise<void> {
  const w = rnd(1, 100);
  if (w <= 36) {
    const times = pick([1, 1, 1, 5, 20] as const) ?? 1;
    await api.water(bot.token, times);
  } else if (w <= 48) {
    await api.collectBucket(bot.token);
  } else if (w <= 55) {
    await api.hamsterGift(bot.token);
  } else if (w <= 62) {
    await api.checkinWater(bot.token);
  } else if (w <= 69) {
    await api.adRewardWater(bot.token, 35);
  } else if (w <= 77) {
    const { friends } = await api.friendsList(bot.token);
    const id = pick(friends.map((f) => f.id));
    if (id) await api.greetFriend(bot.token, id);
  } else if (w <= 85) {
    const { friends } = await api.friendsList(bot.token);
    const id = pick(friends.map((f) => f.id));
    if (id) await api.waterFriend(bot.token, id);
  } else if (w <= 91) {
    const { games } = await api.gamesList(bot.token);
    const g = pick(games.filter((x) => !x.claimed));
    if (g) await api.gameClaim(bot.token, g.id);
  } else if (w <= 95) {
    await api.petsList(bot.token);
  } else {
    await api.farm(bot.token);
  }
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  let index = 0;
  const n = items.length;
  async function oneWorker() {
    for (;;) {
      const i = index++;
      if (i >= n) break;
      await worker(items[i]!, i);
    }
  }
  const workers = Math.max(1, Math.min(concurrency, n));
  await Promise.all(Array.from({ length: workers }, () => oneWorker()));
}

async function main() {
  const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3001';
  const loadTestSecret = process.env.LOAD_TEST_SECRET;
  if (!loadTestSecret) {
    console.error('Set LOAD_TEST_SECRET (must match server LOAD_TEST_SECRET) to bypass global rate limit.');
    process.exit(1);
  }

  const totalUsers = envInt('SIM_USERS', 80);
  const seedUsers = Math.min(envInt('SIM_SEED_USERS', 25), totalUsers);
  const concurrency = envInt('SIM_BOOT_CONCURRENCY', 20);
  const chaosWorkers = envInt('SIM_CHAOS_CONCURRENCY', 40);
  const durationMs = envInt('SIM_DURATION_SEC', 120) * 1000;

  const maxRps = envInt('SIM_MAX_RPS', 100);
  const runId = `${Date.now()}`;
  const api = new ApiClient({ baseUrl, loadTestSecret, maxRps });

  const { products } = await api.products();
  const productIds = products.map((p) => p.id);
  if (!productIds.length) {
    console.error('No products from API');
    process.exit(1);
  }

  console.log(`[load-sim] API=${baseUrl} users=${totalUsers} seeds=${seedUsers} bootConcurrency=${concurrency} chaos=${chaosWorkers} durationMs=${durationMs}`);

  const emails = Array.from({ length: totalUsers }, (_, i) => `loadsim-${runId}-${i}@loadtest.local`);

  const bots: Bot[] = new Array(totalUsers);

  let bootFail = 0;
  await runPool(emails.slice(0, seedUsers), concurrency, async (email, idx) => {
    try {
      bots[idx] = await bootstrapOne(api, email, productIds);
    } catch (e) {
      bootFail++;
      console.warn(`[load-sim] seed ${idx} failed: ${(e as Error).message}`);
    }
    if ((idx + 1) % 10 === 0) console.log(`[load-sim] bootstrapped seed ${idx + 1}/${seedUsers} (fail=${bootFail})`);
  });

  const seedCodes: string[] = [];
  for (let i = 0; i < seedUsers; i++) {
    if (!bots[i]) continue;
    try {
      const { code } = await api.inviteCode(bots[i]!.token);
      seedCodes.push(code);
    } catch { /* skip */ }
  }
  console.log(`[load-sim] collected ${seedCodes.length} invite codes`);

  if (seedCodes.length === 0) {
    console.error('[load-sim] No seed codes — cannot continue. Check API connectivity and LOAD_TEST_SECRET.');
    process.exit(1);
  }

  await runPool(emails.slice(seedUsers), concurrency, async (email, relIdx) => {
    const idx = seedUsers + relIdx;
    const ref = pick(seedCodes) ?? seedCodes[0]!;
    try {
      bots[idx] = await bootstrapOne(api, email, productIds, ref);
    } catch (e) {
      bootFail++;
      if (bootFail % 100 === 0) console.warn(`[load-sim] boot failures so far: ${bootFail}`);
    }
    if ((relIdx + 1) % 200 === 0) console.log(`[load-sim] bootstrapped follower ${relIdx + 1}/${totalUsers - seedUsers} (fail=${bootFail})`);
  });

  const activeBots = bots.filter(Boolean).length;
  console.log(`[load-sim] bootstrap done: ${activeBots} active bots, ${bootFail} failures`);

  const stats = { ok: 0, fail: 0 };
  const until = Date.now() + durationMs;

  async function chaosLoop() {
    while (Date.now() < until) {
      const bot = pick(bots.filter(Boolean))!;
      try {
        await randomAction(api, bot);
        stats.ok++;
      } catch {
        stats.fail++;
      }
      await sleep(rnd(15, 1800));
    }
  }

  console.log('[load-sim] chaos phase…');
  await Promise.all(Array.from({ length: chaosWorkers }, () => chaosLoop()));

  console.log(`[load-sim] done actions≈ok ${stats.ok} errors(ignored in action) ${stats.fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
