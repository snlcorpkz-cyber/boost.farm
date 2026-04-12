/**
 * Integration smoke test: creates a user, walks through every game action,
 * and VERIFIES that the state actually changed correctly after each step.
 */
import { ApiClient } from './client.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3001';
const loadTestSecret = process.env.LOAD_TEST_SECRET;

const api = new ApiClient({ baseUrl, loadTestSecret });

interface FarmState {
  water_in_can: number;
  water_in_bucket: number;
  growth_percent: number;
  current_stage: number;
  nutrition: number;
  total_water_this_month: number;
  harvested: boolean;
  bucket_last_collected_at: string;
  total_waterings_today: number;
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    const msg = detail ? `${name}: ${detail}` : name;
    failures.push(msg);
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function getFarm(token: string): Promise<FarmState> {
  const data = await api.farm(token);
  return data.farm as unknown as FarmState;
}

async function main() {
  const runId = Date.now();
  console.log(`\n🔬 INTEGRATION SMOKE TEST — ${baseUrl}\n`);

  // ═══════════════════════════════════════════════
  // 1. REGISTRATION
  // ═══════════════════════════════════════════════
  console.log('── 1. Registration ──');
  const email1 = `smoketest-${runId}-a@test.local`;
  const { accessToken: tokenA, user: userA } = await api.verifyCode(email1);
  assert(!!tokenA, 'Got access token');
  assert(!!userA.id, 'User has ID');

  // ═══════════════════════════════════════════════
  // 2. PRODUCT SELECTION + NEW CROP
  // ═══════════════════════════════════════════════
  console.log('\n── 2. Select crop ──');
  const { products } = await api.products();
  assert(products.length > 0, `Products available: ${products.length}`);
  const product = products[0]!;

  await api.newCrop(tokenA, product.id);
  const farm1 = await getFarm(tokenA);
  assert(farm1 !== null, 'Farm created');
  assert(farm1.growth_percent === 0, `Initial growth = 0`, `got ${farm1.growth_percent}`);
  assert(farm1.water_in_can === 0 || farm1.water_in_can > 0, `water_in_can exists: ${farm1.water_in_can}`);
  assert(farm1.current_stage === 1, `Initial stage = 1`, `got ${farm1.current_stage}`);

  // ═══════════════════════════════════════════════
  // 3. BUCKET COLLECTION
  // ═══════════════════════════════════════════════
  console.log('\n── 3. Bucket collection ──');
  console.log('  ⏳ Waiting 8 seconds for bucket to fill...');
  await sleep(8000);
  const farmBeforeBucket = await getFarm(tokenA);
  const { collected } = await api.collectBucket(tokenA);
  const farmAfterBucket = await getFarm(tokenA);

  assert(collected > 0, `Collected water from bucket: ${collected.toFixed(2)}g`);
  assert(
    farmAfterBucket.water_in_can > farmBeforeBucket.water_in_can,
    `water_in_can increased: ${farmBeforeBucket.water_in_can} → ${farmAfterBucket.water_in_can}`,
    farmAfterBucket.water_in_can <= farmBeforeBucket.water_in_can
      ? `STILL ${farmAfterBucket.water_in_can}` : undefined,
  );
  assert(
    farmAfterBucket.total_water_this_month >= collected,
    `total_water_this_month tracks bucket: ${farmAfterBucket.total_water_this_month}`,
  );

  // ═══════════════════════════════════════════════
  // 4. AD REWARD (water)
  // ═══════════════════════════════════════════════
  console.log('\n── 4. Ad reward water ──');
  const farmBeforeAd = await getFarm(tokenA);
  await api.adRewardWater(tokenA, 50);
  const farmAfterAd = await getFarm(tokenA);

  assert(
    farmAfterAd.water_in_can >= farmBeforeAd.water_in_can + 49,
    `Ad reward added water: ${farmBeforeAd.water_in_can} → ${farmAfterAd.water_in_can}`,
    `expected +50, got +${(farmAfterAd.water_in_can - farmBeforeAd.water_in_can).toFixed(2)}`,
  );
  assert(
    farmAfterAd.total_water_this_month > farmBeforeAd.total_water_this_month,
    `total_water_this_month tracks ad reward: ${farmAfterAd.total_water_this_month}`,
  );

  // ═══════════════════════════════════════════════
  // 5. WATERING THE CROP
  // ═══════════════════════════════════════════════
  console.log('\n── 5. Watering crop ──');
  const farmBeforeWater = await getFarm(tokenA);
  try {
    await api.water(tokenA, 1);
    const farmAfterWater = await getFarm(tokenA);

    assert(
      farmAfterWater.growth_percent > farmBeforeWater.growth_percent,
      `Growth increased: ${farmBeforeWater.growth_percent}% → ${farmAfterWater.growth_percent}%`,
      farmAfterWater.growth_percent <= farmBeforeWater.growth_percent
        ? `STILL ${farmAfterWater.growth_percent}%` : undefined,
    );
    assert(
      farmAfterWater.water_in_can < farmBeforeWater.water_in_can,
      `water_in_can decreased: ${farmBeforeWater.water_in_can} → ${farmAfterWater.water_in_can}`,
    );
    assert(
      farmAfterWater.total_waterings_today > farmBeforeWater.total_waterings_today,
      `total_waterings_today: ${farmBeforeWater.total_waterings_today} → ${farmAfterWater.total_waterings_today}`,
    );
  } catch (e) {
    assert(false, `Watering failed: ${(e as Error).message}`);
  }

  // x5 watering
  console.log('\n── 5b. Watering x5 ──');
  const farmBeforeW5 = await getFarm(tokenA);
  try {
    await api.water(tokenA, 5);
    const farmAfterW5 = await getFarm(tokenA);
    assert(
      farmAfterW5.growth_percent > farmBeforeW5.growth_percent,
      `x5 growth: ${farmBeforeW5.growth_percent}% → ${farmAfterW5.growth_percent}%`,
    );
  } catch (e) {
    assert(false, `x5 watering failed: ${(e as Error).message}`);
  }

  // ═══════════════════════════════════════════════
  // 6. CHECK-IN
  // ═══════════════════════════════════════════════
  console.log('\n── 6. Check-in ──');
  const farmBeforeCheckin = await getFarm(tokenA);
  try {
    await api.checkinWater(tokenA);
    const farmAfterCheckin = await getFarm(tokenA);
    assert(
      farmAfterCheckin.water_in_can > farmBeforeCheckin.water_in_can,
      `Check-in added water: ${farmBeforeCheckin.water_in_can} → ${farmAfterCheckin.water_in_can}`,
    );
    assert(
      farmAfterCheckin.total_water_this_month > farmBeforeCheckin.total_water_this_month,
      `total_water_this_month tracks checkin: ${farmAfterCheckin.total_water_this_month}`,
    );
  } catch (e) {
    assert(false, `Check-in failed: ${(e as Error).message}`);
  }

  // ═══════════════════════════════════════════════
  // 7. DOUBLE CHECK-IN (should fail gracefully)
  // ═══════════════════════════════════════════════
  console.log('\n── 7. Double check-in (expect rejection) ──');
  try {
    await api.checkinWater(tokenA);
    assert(false, 'Double check-in should have failed but succeeded');
  } catch {
    assert(true, 'Double check-in correctly rejected');
  }

  // ═══════════════════════════════════════════════
  // 8. HAMSTER GIFT
  // ═══════════════════════════════════════════════
  console.log('\n── 8. Hamster gift ──');
  const farmBeforeHamster = await getFarm(tokenA);
  try {
    const gift = await api.hamsterGift(tokenA);
    const farmAfterHamster = await getFarm(tokenA);
    if (gift.waterEarned > 0) {
      assert(
        farmAfterHamster.water_in_can > farmBeforeHamster.water_in_can,
        `Hamster gave water: +${gift.waterEarned}, can: ${farmBeforeHamster.water_in_can} → ${farmAfterHamster.water_in_can}`,
      );
    } else {
      assert(true, `Hamster gift on cooldown (waterEarned=0), expected`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('cooldown') || msg.includes('COOLDOWN') || msg.includes('wait')) {
      assert(true, `Hamster on cooldown: ${msg}`);
    } else {
      assert(false, `Hamster gift error: ${msg}`);
    }
  }

  // ═══════════════════════════════════════════════
  // 9. FRIENDS + INVITE + GREET + WATER FRIEND
  // ═══════════════════════════════════════════════
  console.log('\n── 9. Friends system ──');
  const email2 = `smoketest-${runId}-b@test.local`;
  const { accessToken: tokenB } = await api.verifyCode(email2);
  await api.newCrop(tokenB, products[products.length > 1 ? 1 : 0]!.id);

  const { code: inviteCode } = await api.inviteCode(tokenA);
  assert(!!inviteCode, `Got invite code: ${inviteCode}`);

  const email3 = `smoketest-${runId}-c@test.local`;
  const { accessToken: tokenC } = await api.verifyCode(email3, inviteCode);
  await api.newCrop(tokenC, product.id);

  const { friends } = await api.friendsList(tokenA);
  assert(friends.length > 0, `User A has ${friends.length} friend(s)`);

  if (friends.length > 0) {
    const friendId = friends[0]!.id;

    // Greet friend
    const farmBeforeGreet = await getFarm(tokenA);
    try {
      await api.greetFriend(tokenA, friendId);
      const farmAfterGreet = await getFarm(tokenA);
      assert(
        farmAfterGreet.water_in_can >= farmBeforeGreet.water_in_can,
        `Greet reward: ${farmBeforeGreet.water_in_can} → ${farmAfterGreet.water_in_can}`,
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('already') || msg.includes('ALREADY')) {
        assert(true, `Already greeted this phase: ${msg}`);
      } else {
        assert(false, `Greet failed: ${msg}`);
      }
    }

    // Water friend's farm
    try {
      await api.waterFriend(tokenA, friendId);
      assert(true, 'Watered friend farm successfully');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('already') || msg.includes('ALREADY') || msg.includes('not enough') || msg.includes('NOT_ENOUGH')) {
        assert(true, `Water friend expected fail: ${msg}`);
      } else {
        assert(false, `Water friend failed: ${msg}`);
      }
    }
  }

  // ═══════════════════════════════════════════════
  // 10. SECOND BUCKET COLLECTION (after JS timestamp)
  // ═══════════════════════════════════════════════
  console.log('\n── 10. Second bucket collection (JS timestamp) ──');
  console.log('  ⏳ Waiting 5 seconds...');
  await sleep(5000);
  const farmBeforeBucket2 = await getFarm(tokenA);
  try {
    const { collected: c2 } = await api.collectBucket(tokenA);
    const farmAfterBucket2 = await getFarm(tokenA);
    assert(c2 > 0, `Second bucket collected: ${c2.toFixed(2)}g`);
    assert(
      farmAfterBucket2.water_in_can > farmBeforeBucket2.water_in_can,
      `water_in_can after 2nd bucket: ${farmBeforeBucket2.water_in_can} → ${farmAfterBucket2.water_in_can}`,
    );
  } catch (e) {
    assert(false, `Second bucket collection failed: ${(e as Error).message}`);
  }

  // ═══════════════════════════════════════════════
  // 11. PETS LIST
  // ═══════════════════════════════════════════════
  console.log('\n── 11. Pets ──');
  try {
    const pets = await api.petsList(tokenA);
    assert(Array.isArray(pets.pets), `Pets list returned: ${pets.pets.length} pet(s)`);
  } catch (e) {
    assert(false, `Pets list failed: ${(e as Error).message}`);
  }

  // ═══════════════════════════════════════════════
  // 12. WATERING WITH NO WATER (drain can first)
  // ═══════════════════════════════════════════════
  console.log('\n── 12. Water with empty can ──');
  const email4 = `smoketest-${runId}-empty@test.local`;
  const { accessToken: tokenEmpty } = await api.verifyCode(email4);
  await api.newCrop(tokenEmpty, product.id);
  // New farms start with 100g — drain it by watering (10g per click)
  for (let i = 0; i < 10; i++) {
    try { await api.water(tokenEmpty, 1); } catch { break; }
  }
  const emptyFarm = await getFarm(tokenEmpty);
  console.log(`  water_in_can after draining: ${emptyFarm.water_in_can}`);
  try {
    await api.water(tokenEmpty, 1);
    assert(emptyFarm.water_in_can >= 10, `Still had water (${emptyFarm.water_in_can}g) — watering succeeded as expected`);
  } catch {
    assert(true, 'Correctly rejected watering with empty can');
  }

  // ═══════════════════════════════════════════════
  // 13. TOTAL WATER THIS MONTH CONSISTENCY
  // ═══════════════════════════════════════════════
  console.log('\n── 13. Total water consistency ──');
  const finalFarm = await getFarm(tokenA);
  assert(
    finalFarm.total_water_this_month > 0,
    `total_water_this_month final: ${finalFarm.total_water_this_month}g`,
  );
  assert(
    !finalFarm.harvested,
    `Farm not harvested yet (growth ${finalFarm.growth_percent}%)`,
  );

  // ═══════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    failures.forEach((f) => console.log(`    ❌ ${f}`));
  }
  console.log('══════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n💥 FATAL ERROR:', e);
  process.exit(2);
});
