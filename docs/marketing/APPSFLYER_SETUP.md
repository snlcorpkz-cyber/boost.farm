# AppsFlyer Integration — Operator Runbook

This is the **only** marketing-attribution doc you need to follow on a
day-to-day basis after the initial setup. Everything else (Meta direct
SDK + CAPI worker) is dormant by default and stays as a fallback.

---

## 1. Why AppsFlyer

We picked AppsFlyer (an MMP — Mobile Measurement Partner) over direct
Facebook SDK + CAPI because:

| Concern | Direct CAPI | AppsFlyer |
|---|---|---|
| Verification + Business Manager dance | One per ad network | Once with AF, AF handles partners |
| Fraud filtering | Build it yourself | Built-in (Protect360) |
| Multi-network support | One integration per network | Single SDK, every network |
| iOS SKAdNetwork plumbing | DIY | Handled |
| Dashboard / reports | DIY in Postgres | Out of the box |
| Cost (under 30K MAU) | Free | Free |
| Cost (over 30K MAU) | Free | Tiered, currently ~$200-400/mo |

The Meta-direct CAPI worker we built earlier (`packages/api/src/workers/
capiWorker.ts`) stays in the codebase but is gated behind the
`META_CAPI_ENABLED` env var (default `false`). Re-enable only if AF→Meta
integration breaks.

---

## 2. One-time setup — AppsFlyer dashboard

You did most of this already; checklist for posterity:

1. **Sign up** at `appsflyer.com`, create app **BoostFarm** with the
   Play Store package id `io.boostfarm.app`.
2. **Dev Key** appears under **Settings → Basic Settings**. The current
   one is `bJovpQFtkXdkS7pRivekVM` and is stored in
   `apps/android/keystore.properties` (gitignored). New machines must
   paste it manually — no automated provisioning.
3. **In-app events** — configure these names in your AppsFlyer dashboard
   under **App Settings → In-app event setting**:
   - Predefined (auto-mapped to partner standard events):
     - `af_complete_registration` (param: `af_registration_method`)
     - `af_tutorial_completion`   (params: `af_success`, `af_tutorial_id`, `af_content`)
     - `af_level_achieved`        (param: `af_level`)
     - `af_invite`                (params: `af_description`, `method`)
   - Custom (BoostFarm-specific):
     - `af_first_water`           — no params
     - `af_bucket_collected`      (param: `via` — `free`/`ad`)
     - `af_ad_watched_rewarded`   (params: `placement`, `attempt_id`, `reward_type`, `amount`)
     - `af_engaged_d0`            — no params
     - `af_offer_completed`       (params: `af_revenue`, `af_currency`, `offer_id`)
     - `af_withdrawal_initiated`  (params: `amount`, `method`)

4. **Connect partners** — in the dashboard, **Configuration → Integrated
   Partners** → search **Facebook** (and **Google Ads**, **TikTok**, etc.
   when you run those).
   For each:
   - Enable in-app events forwarding.
   - Map BoostFarm event names → partner standard names. Predefined
     `af_*` events auto-map; for custom events you'll see a "Custom
     mapping" form. Recommended:
     - `af_engaged_d0`           → `EngagedD0` (Meta custom event)
     - `af_offer_completed`      → `Purchase`
     - `af_withdrawal_initiated` → `StartTrial` (close enough for Meta optimisation)
     - `af_ad_watched_rewarded`  → `ViewContent`
   - Toggle **View-through attribution** ON for Facebook (default OFF).

5. **Optimise on** — once 50+ events have flown through (typically 24-48h
   after first install), set up Meta campaigns to optimise on:
   - **First 7 days**: `af_complete_registration` (warm-up, fast feedback).
   - **Day 7-14**: `af_engaged_d0` (quality cohort).
   - **Day 14+**: `af_offer_completed` or `af_withdrawal_initiated` (revenue cohort).

---

## 3. Build & deploy

### Local (developer machine)

```powershell
cd apps/android
# Make sure keystore.properties has appsFlyerDevKey=...
.\gradlew :app:assembleRelease
```

The Dev Key is read at compile time → embedded as `BuildConfig.APPSFLYER_DEV_KEY` →
consumed in `BoostFarmApplication.initAppsFlyer()`.

### CI / production build

The CI machine must also have `keystore.properties` populated. We do
not store it in git; it is uploaded as a CI secret and dropped into
`apps/android/` before the build step. (Add this to the deploy script
when CI is wired up — current deploy is manual via local `gradlew`.)

### Verifying the integration

After installing a build:

1. **Test mode**: Add the test device's GAID under
   **AppsFlyer dashboard → Settings → Test Devices** (or use the
   Test Console **In-app event test** flow — it accepts the device's
   AppsFlyer UID printed in logcat).
2. Open the app, complete tutorial, water, watch one ad. Each should
   appear within ~30 seconds in the **In-app events** test stream.
3. **First-launch attribution** appears under **Overview** within ~10
   minutes of install (slower in test mode).

---

## 4. Bridge surface (web ↔ native)

Web layer calls these via `apps/web/src/lib/native.ts`:

| TS function | Bridge method | Purpose |
|---|---|---|
| `logAfEvent(name, params)` | `EcoFarmAndroid.logAfEvent` | Fire in-app event |
| `setAfCustomerUserId(id)`  | `EcoFarmAndroid.setAfCustomerUserId` | Tie device → user |
| `getAppsFlyerId()`         | `EcoFarmAndroid.getAppsFlyerId` | Read AF UID |

All are no-ops on web / older bridges (< v9), so **safe to call
unconditionally**.

The strict allow-list of event names lives in `AfEventName` (same file).
Adding a new event = adding a string literal to that union, exporting a
helper from `apps/web/src/lib/marketing.ts`, and configuring the event
in the AF dashboard.

---

## 5. Server-side CAPI worker (dormant)

A `packages/api/src/workers/capiWorker.ts` lives in the codebase as a
future-proofing channel. It polls the `events` table and would dispatch
to Meta's Conversions API server-side. **Disabled by default** via
`META_CAPI_ENABLED=false` and gated on `META_APP_ID` / `META_ACCESS_TOKEN`
being present. Today AppsFlyer alone postbacks to Meta — flip the worker
on only if AF→Meta integration ever breaks and we need a redundant
server-side path.

The Facebook / Meta Android SDK that previously ran client-side has been
removed (commit log: "remove Facebook SDK, AppsFlyer is the sole MMP")
because maintaining two parallel client-side attribution paths added
operational complexity (Meta developer account verification, key hashes,
Business Manager onboarding) for zero signal gain — AppsFlyer covers the
exact same Meta-side postbacks via its integrated-partner pipeline.

---

## 6. Common gotchas

- **Test-mode events don't appear in dashboards.** Real events take
  ~30s, test events are gated to test-device list. If your phone isn't
  registered as a test device, events fire but go to the production
  pool, not the test pool.
- **`appsFlyerDevKey` empty.** SDK init logs a warning and short-
  circuits cleanly. App still works, no events flow.
- **GAID returns zeros.** Means `AD_ID` permission is missing in
  Manifest. Already added in our Manifest, but third-party code that
  re-generates Manifest may strip it — re-check after Gradle plugin
  updates.
- **Events not deduping across reinstalls.** That's intentional — a
  reinstall really is a fresh attributed install.
