# Meta Business Manager setup — Boost Farm

This document covers the **non-code** steps required before the FB SDK
+ Conversions API integration (shipped in commit that introduced
`packages/api/src/meta/capi.ts`) can actually send events to Meta.
Everything in this file is done through the Meta UI, not the repo.

Time budget: ~60-90 min for a first-time setup; ~15 min if you already
own a Business Manager with a verified domain.

---

## Prerequisites

- Admin access to a Meta Business Manager account
  (<https://business.facebook.com/>). If you don't have one, create it
  via the "Create Account" flow with the company's legal name.
- Ownership of the `boostfarm.io` domain (or wherever the web app
  lives) — you'll need to add a DNS TXT record during verification.
- Google Play Console access for the `io.boostfarm.app` listing —
  Meta cross-references Play Store metadata during review.
- A valid **privacy policy URL**. A public one is required by Google
  Play AND by Meta. If we don't have one yet, generate it at
  <https://app-privacy-policy-generator.nisrulz.com/> or similar and
  host it at `https://boostfarm.io/privacy`.

---

## Step 1 — Create the Business Manager asset bundle

1. `business.facebook.com → Business Settings`
2. **Accounts → Apps → Add → Create a new app ID**
   - App Type: **Business**
   - Display Name: `Boost Farm`
   - App Contact Email: `team@boostfarm.io` (or appropriate)
3. Note the **App ID** (numeric, 15–16 digits). This is the value we
   put into `keystore.properties` → `facebookAppId=...`, and the
   value `META_APP_ID` in the server `.env`.
4. **App Settings → Basic**:
   - Category: **Games** (sub-category: Casual/Simulation)
   - Privacy Policy URL: `https://boostfarm.io/privacy`
   - Terms of Service URL: `https://boostfarm.io/terms` (optional
     but recommended)
   - Data Deletion Instructions URL: required by Meta since 2023 —
     point to `https://boostfarm.io/data-deletion` with a short
     paragraph describing how users can request deletion.

## Step 2 — Get the Client Token

App Settings → Advanced → **Security → Client Token → Show**.
Copy this value into:

- `apps/android/keystore.properties` → `facebookClientToken=...`

The client token is safe to embed in the APK — it can authenticate the
app to the SDK but can NOT read sensitive account data.

## Step 3 — Add the Android platform

App Settings → Basic → **Add Platform → Android**.

Fields:

- Google Play Package Name: `io.boostfarm.app`
- Class Name: `com.boostfarm.app.MainActivity`
- Key Hashes: run the one-liner below on the machine that owns the
  upload keystore (same keystore used in `apps/android/keystore.properties`):

```bash
keytool -exportcert -alias <your-alias> -keystore /path/to/upload.keystore | \
  openssl sha1 -binary | openssl base64
```

Paste the resulting 28-character base64 string (include the trailing `=`).
Repeat for the **debug** keystore so dev builds authenticate too (usual
location: `~/.android/debug.keystore`, alias `androiddebugkey`, password
`android`).

Set both switches ON: **Single Sign On**, **Deep Linking** (latter not
used today but costs nothing to enable).

## Step 4 — Verify the domain

Events Manager → Data Sources → *(click your Dataset once Step 5 done)*
→ Settings → **Verify Domains → Add → `boostfarm.io`**.

Meta gives you a TXT record. Add it to the domain's DNS zone and
wait 10-30 min for propagation. This is a one-time step; domain
verification unlocks first-party cookie tracking for web traffic and
gates the Conversions API for this app id.

## Step 5 — Create the App Events Dataset

Events Manager → **Connect Data Sources → App**.

- Select the app you created in Step 1.
- Choose **Set up the Meta SDK**: YES (we ship the SDK on Android).
- Choose **Set up the Conversions API**: YES.

After the wizard finishes:

- A **Dataset** row appears in Events Manager. Its id is the same as
  the App ID. It's the unified bucket for SDK + CAPI events.
- The **Test Events** tab lets you push test traffic with a
  `test_event_code` — useful during staging. Set this code in
  `.env` as `META_TEST_EVENT_CODE=TEST12345` while validating, and
  blank in prod.

## Step 6 — Create the CAPI System User

Business Settings → **Users → System Users → Add → System User**.

- Name: `boostfarm-capi-dispatcher`
- Role: **Admin** (on the app asset only; we assign it below)

After creation:

1. **Add Assets → Apps → select Boost Farm**. Grant full control.
2. Click **Generate New Token** for the system user.
   - Choose the app
   - Permissions: `ads_management`, `business_management`
   - Token Expiry: **Never Expires**
3. Copy the token IMMEDIATELY (Meta only shows it once). Paste into
   server `.env`:

```
META_APP_ID=<the numeric id>
META_APP_SECRET=<App Settings → Basic → App Secret (click Show)>
META_CAPI_ACCESS_TOKEN=<the token from step 6.2>
META_TEST_EVENT_CODE=          # empty in prod, TESTxxxxx in staging
META_CAPI_ENABLED=true
```

## Step 7 — Test connection

1. Restart the API (so the new env vars are picked up):
   ```bash
   pm2 restart api --update-env
   ```
2. Trigger a test signup on staging (with `META_TEST_EVENT_CODE`
   configured). Within ~1 min the `CompletedRegistration` event
   should appear in:
   Events Manager → Dataset → **Test Events** tab.
3. If nothing shows up:
   - Check `fb_capi_errors` in Postgres:
     ```sql
     SELECT event_name, status_code, reason, created_at
       FROM fb_capi_errors
      ORDER BY created_at DESC LIMIT 20;
     ```
   - 401 = bad access token or app secret
   - 190 = token expired (regenerate in Business Settings)
   - 2500 = test_event_code not recognised (must match exactly)

## Step 8 — Enable production traffic

Once staging is verified and `fb_capi_errors` shows 0 rows over
24h of real traffic:

1. Remove `META_TEST_EVENT_CODE` from prod `.env`.
2. Keep `META_CAPI_ENABLED=true`.
3. Events now route to the **Overview** tab (not Test Events).

---

## Post-setup checklist

Before running your first paid campaign:

- [ ] Android app v0.4.0+ published to Play (carries the FB SDK and
      extended install-referrer parser).
- [ ] `CompletedRegistration` visible in Events Manager for at least
      24h with zero `fb_capi_errors`.
- [ ] `EngagedD0` visible once at least one test user has registered,
      watered, AND watched a rewarded ad in the same D0 session.
- [ ] Domain `boostfarm.io` shows ✅ Verified in Events Manager.
- [ ] System user token tested via curl against `/activities` — see
      Troubleshooting section below.
- [ ] Privacy policy URL loads in a browser and mentions Meta /
      Facebook advertising.

## Troubleshooting — smoke-test the token with curl

```bash
TOKEN=<your system user token>
APP_ID=<numeric app id>
APP_SECRET=<app secret>
PROOF=$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hmac "$APP_SECRET" -hex | sed 's/^.* //')

curl -X POST "https://graph.facebook.com/v19.0/${APP_ID}/activities" \
  -H 'Content-Type: application/json' \
  -d @- <<EOF
{
  "access_token": "${TOKEN}",
  "appsecret_proof": "${PROOF}",
  "test_event_code": "TEST12345",
  "data": [
    {
      "event_name": "CompletedRegistration",
      "event_id": "smoke-test-$(date +%s)",
      "event_time": $(date +%s),
      "action_source": "app",
      "user_data": { "external_id": ["$(echo -n test-user | openssl dgst -sha256 -hex | sed 's/^.* //')"] },
      "app_data": { "advertiser_tracking_enabled": 1, "application_tracking_enabled": 1 }
    }
  ]
}
EOF
```

A 200 with `{"events_received": 1, ...}` confirms credentials and
wire-format are correct.

## Documented gotchas

- **Meta caches email hashes**: once an email → external_id pair is
  matched, subsequent events land on the same profile even if the
  user logs in from a new device. Don't panic if Events Manager
  shows fewer "unique users" than your DB — Meta is counting people,
  we're counting rows.
- **`events_received` != "events landed in ad attribution"**. Meta
  can drop events that are >7d old, miss required fields, or are
  detected as duplicates. Always check **Overview** tab after
  confirming `events_received` — a 200 doesn't guarantee attribution.
- **Bot traffic**: Meta attributes installs even from obvious bots
  if they generate app events. Our mitigation (post-login CAPI only,
  never SDK for user events) means bots never reach Meta because
  they never log in. Do NOT add bot events to the SDK side.
- **Android 14+**: some OEMs revoke AD_ID; we still match via
  `external_id` (hashed UUID) so match quality holds. If Events
  Manager reports `match_quality_score < 5.0` investigate whether
  `email` is actually reaching CAPI (check
  `SELECT count(*) FROM events e JOIN users u ON u.id=e.user_id
   WHERE u.email IS NULL AND e.meta_capi_sent_at IS NOT NULL`).

---

See also:
- `docs/marketing/CAMPAIGN_NAMING.md` — naming conventions for
  campaigns / ad sets / ads.
- `docs/marketing/CREATIVE_BRIEF.md` — initial creative hypotheses
  and asset requirements.
