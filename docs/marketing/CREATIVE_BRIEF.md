# Creative brief — Boost Farm UA launch

**Goal:** generate ~5–7 distinct creative hypotheses for the first
Meta App Installs campaign, optimised first on `CompletedRegistration`
and then on `EngagedD0` (see `docs/marketing/META_BUSINESS_MANAGER_SETUP.md`).

**Success criteria:**

- CTR ≥ 1.5 % on Stories/Reels placements
- CPI ≤ $0.80 in tier-2 GEO (target KZ, RU, UA, TR)
- `engaged_d0_pct` ≥ 30 % within 7 days post-install
- Hook retention: ≥ 55 % of video viewers watch the first 3 seconds

---

## Format matrix

Every hook must ship in both vertical and square so Meta Advantage+
placements can route traffic across Stories, Reels, and Feed.
Square is also what Instagram Explore uses by default.

| Format | Aspect | Duration | Safe area notes                           |
|--------|--------|----------|-------------------------------------------|
| Stories / Reels | 9:16 | 15 s (hard max, keep hook in first 1.5 s) | Top 250 px & bottom 750 px reserved for UI |
| Feed   | 1:1   | 15 s    | Centre gravity; captions baked into video  |
| Feed (fallback) | 4:5 | 15 s | Only if 1:1 underperforms, rare            |

Technical specs:

- Codec: H.264 / AAC
- Resolution: **1080×1920** (9:16), **1080×1080** (1:1)
- FPS: 30
- Max file size: 4 GB (Meta cap; we'll never approach it)
- Captions: burned-in, 85% of global traffic autoplays muted
- Loudness: −14 LUFS for AAC track
- Colour: Rec. 709, no HDR

Naming on export: `BF_{concept}_{format}_{variant}.mp4`, e.g.
`BF_HarvestTestimonial_9x16_v1.mp4`. This mirrors the Meta ad
naming convention (`CAMPAIGN_NAMING.md`) minus the GEO/date tokens.

---

## Hypothesis 1 — "Pour water, plant grows" speedup

**Hook (first 1.5 s):** tight close-up on a dry seedling; finger taps
the water bucket; 12× timelapse of the plant growing. No text for the
first beat — motion alone earns the thumb-stop.

**Beat 2 (2-6 s):** rank-up animation overlay "Novice → Master".
Badge icon uses existing in-app assets from the leaderboards screen.

**Beat 3 (7-13 s):** UGC-style text overlay: *"I grew a farm in
5 minutes. My kid is obsessed."*

**CTA (13-15 s):** "Install FREE →" over Play badge.

**Why it works:** ASMR-adjacent water pour + rapid visual progress.
Mobile games in adjacent niches (Royal Match, Township) win on
3-second micro-satisfaction loops.

---

## Hypothesis 2 — Rank-up progression wall

**Concept:** 6 icons lined up: Novice → Apprentice → Farmer →
Harvester → Foreman → Master. Each icon fills up as the video plays.
Background music synced to fill animations (snare hits on each tier).

**Text overlay:** *"Every level unlocks a new crop"* — leverages
collection instinct. Supports 9:16 and 1:1 equally.

**Pairs well with:** interests audience (idle games, farm sim,
clicker games) because the progression UI signals "this is your type
of game" in under 2 seconds.

---

## Hypothesis 3 — UGC testimonial

**Concept:** 30s selfie-style phone recording from someone in target
demo (28-40yo, relaxed home setting) saying:

> "Я посадил морковку и собрал 50g воды за день. И оно реально
> конвертируется в деньги — без шуток, я вывел на карту."

Cut to 5 s gameplay b-roll (watering + harvesting) + Play badge.

**Format:** 9:16 primary; crop centre for 1:1.

**Why it works:** removes "scam game" scepticism which is the #1
comment under most crypto/earn-money mobile ads. UGC authenticity
outperforms studio production for this niche by ~2× on conversion
in industry benchmarks.

---

## Hypothesis 4 — Social competition hook

**Hook:** split-screen of two farms; left farm withering, right farm
thriving. Text: *"Beat your friend's farm"*. Right side has a progress
bar racing past the left.

**Beat 2:** leaderboard screenshot from the app (use staging data
populated with test usernames).

**CTA:** *"Claim your spot →"*

**Target audience:** lookalike 1% of existing EngagedD0 users. This
is the creative we test once the Custom Audience has ≥ 1 000 users
with EngagedD0.

---

## Hypothesis 5 — ASMR polish demo

**Concept:** silent-mode-friendly; every frame has exaggerated micro-
animations from the app (the haptics + celebration passes we just
shipped). Seeds plop, leaves rustle, coins clink, water drips.
15 s of pure texture, captions narrate the reward loop.

**Why it works:** we now have genuine juice in the app — if we don't
show it, we're leaving differentiation on the table. ASMR creatives
get disproportionately shared in non-gaming Instagram demographics,
which widens reach.

---

## Hypothesis 6 — Real-world payout proof

**Concept:** screen recording of a payout receipt (Kaspi / Visa /
Tinkoff, whichever is live in the target GEO) with the amount
redacted. Text: *"Проверил — работает"* + short gameplay clip.

**Constraint:** Meta can disapprove if we show explicit cash amounts
without supporting docs. Keep the screenshot at 0.5 s and blur
amount — the point is social proof of payout existence, not "earn
$X per day" (which violates Meta's deceptive ads policy).

**Only launch after legal sign-off** on payout claim wording.

---

## Hypothesis 7 — Problem/solution (opportunity frame)

**Hook (first 2 s):** *"What if your phone could grow real food
money?"* — over a dry landscape.

**Beat 2:** transition from dry landscape to lush in-game farm.

**Beat 3:** user taps water, harvests, withdraws.

**CTA:** *"Free to play"* + Play badge.

**Audience:** broad, no targeting. This is the "cold" creative we use
to teach the algorithm what our buyer looks like.

---

## Launch plan

Week 1:

- Ship **Hypothesis 1** + **Hypothesis 2** (both formats) in Ad Set
  `Broad_EngagedD0`. Optimisation event: `CompletedRegistration`
  (warm-up, until ≥ 30 `EngagedD0` events/adset).

Week 2:

- Add **Hypothesis 3** (UGC) once we have a real user willing to
  record. In the interim, an AI avatar UGC from HeyGen is
  *acceptable* but tag the ad as `v1_ai` so we can compare.
- Kill any ad with CTR < 0.8 % after 500 impressions.

Week 3:

- Switch winning ad set's optimisation from `CompletedRegistration`
  to `EngagedD0`.
- Add **Hypothesis 4** (social competition) to a new LAL adset once
  we have ≥ 1 000 EngagedD0 users in the seed audience.

Week 4:

- Introduce **Hypotheses 5, 6, 7** as challengers in separate ads
  inside the winning ad set. Never introduce more than 2 new
  creatives per week — Meta needs learning budget per creative.

---

## Compliance checklist (pre-flight every creative)

- [ ] No cash amount visible for more than 0.5 s and any amount is
      blurred.
- [ ] No "guaranteed income" claims (e.g. "$100/day"). Use qualitative
      phrasing.
- [ ] Gameplay footage is ≥ 50 % of total duration.
- [ ] If using UGC voice-over, talent has signed the release form.
- [ ] Captions do not overlap with Meta's safe-area UI zones.
- [ ] Call-to-action mentions "Free" or "Download" — Meta downranks
      ads without explicit CTA.
- [ ] Audio is licensed (Meta sound library OR Artlist/Epidemic).

---

## What we need from ops

1. Shooting slot with one UGC talent (in-country preferred; AI avatar
   as fallback).
2. Access to staging with a populated leaderboard for Hypothesis 4
   screenshot.
3. Legal sign-off on payout proof wording for Hypothesis 6.
4. 2 weeks of production lead time for first batch of 4 hero
   creatives.

Ping the CPO in #growth when any item above is unblocked.
