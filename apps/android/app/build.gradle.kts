import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

// Load release signing config from apps/android/keystore.properties (gitignored).
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) {
        load(FileInputStream(keystorePropsFile))
    }
}

android {
    // `namespace` stays on the original com.boostfarm.app package because all
    // Kotlin sources (FarmJsBridge, MainActivity, FcmService, ads, referrer)
    // live under that package path. Changing it would force a rename of every
    // source file and every import.
    //
    // `applicationId` is what Play Store / the device package manager use to
    // identify the app. We use `io.boostfarm.app` because the original
    // com.boostfarm.app package name was already globally registered in Play
    // Store by a previous owner, blocking the publisher from creating a fresh
    // upload key. io.boostfarm.app matches our domain (boostfarm.io) and is
    // unambiguously ours.
    namespace = "com.boostfarm.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.boostfarm.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 12
        versionName = "0.4.1"
        // TODO: productFlavor для staging / http://10.0.2.2:5173/
        buildConfigField("String", "WEB_APP_URL", "\"https://boostfarm.io/\"")

        // Unity LevelPlay (ironSource) single per-app key. Placements are named in
        // the LevelPlay dashboard (water_popup, fert_popup). Key is read from
        // apps/android/keystore.properties (gitignored) so it never lands in git.
        // Leave blank during bootstrap — code falls back to StubRewardedAds /
        // StubOfferwall so debug builds keep working without a key.
        val levelPlayAppKey = (keystoreProps["levelPlayAppKey"] as String?) ?: ""
        buildConfigField("String", "LEVELPLAY_APP_KEY", "\"$levelPlayAppKey\"")

        // ─────────────────────────────────────────────────────────────
        // Facebook / Meta App Events credentials. Same gitignored file
        // as LevelPlay so sharing credentials across dev machines is
        // symmetric. Missing values are replaced with empty strings —
        // SDK short-circuits cleanly, the app still boots.
        //
        //   facebookAppId          → app id from Meta Business Manager
        //   facebookClientToken    → client token (Settings → Advanced)
        //
        // The authority string for FacebookContentProvider is built by
        // concatenating `com.facebook.app.FacebookContentProvider` +
        // the app id, as documented by the SDK.
        // ─────────────────────────────────────────────────────────────
        val facebookAppId = (keystoreProps["facebookAppId"] as String?) ?: ""
        val facebookClientToken = (keystoreProps["facebookClientToken"] as String?) ?: ""
        val facebookContentProviderAuthority =
            if (facebookAppId.isBlank()) "com.facebook.app.FacebookContentProvider"
            else "com.facebook.app.FacebookContentProvider$facebookAppId"

        // Expose the credentials both as BuildConfig (used nowhere
        // mandatory today, but handy for feature-detection) AND as
        // Android string resources — the AndroidManifest <meta-data>
        // tags reference them via @string/... so the SDK auto-init
        // pipeline picks them up without extra code.
        resValue("string", "facebook_app_id", facebookAppId)
        resValue("string", "facebook_client_token", facebookClientToken)
        resValue(
            "string",
            "facebook_content_provider_authority",
            facebookContentProviderAuthority,
        )
        buildConfigField("String", "META_APP_ID", "\"$facebookAppId\"")
        buildConfigField("String", "META_CLIENT_TOKEN", "\"$facebookClientToken\"")

        // ─────────────────────────────────────────────────────────────
        // AppsFlyer Dev Key — single per-app secret, read from the same
        // gitignored keystore.properties so it never lands in git. The
        // dev key is technically embedded in the released APK anyway
        // (any client SDK is reverse-engineerable), but we still keep
        // it out of source for hygiene + so a fresh checkout doesn't
        // pollute someone else's AF dashboard with localhost traffic.
        //
        // Empty string disables AF init cleanly — see
        // BoostFarmApplication.initAppsFlyer().
        // ─────────────────────────────────────────────────────────────
        val appsFlyerDevKey = (keystoreProps["appsFlyerDevKey"] as String?) ?: ""
        buildConfigField("String", "APPSFLYER_DEV_KEY", "\"$appsFlyerDevKey\"")
    }

    // Release signing is opt-in: only wire it up when keystore.properties
    // actually contains the storeFile entry. This lets us reuse the same
    // keystore.properties file just for `levelPlayAppKey` during dev without
    // forcing every contributor to also have the upload keystore.
    val releaseStoreFile = keystoreProps["storeFile"] as String?
    signingConfigs {
        create("release") {
            if (!releaseStoreFile.isNullOrBlank()) {
                storeFile = rootProject.file(releaseStoreFile)
                storePassword = keystoreProps["storePassword"] as String
                keyAlias = keystoreProps["keyAlias"] as String
                keyPassword = keystoreProps["keyPassword"] as String
            }
        }
    }

    buildTypes {
        release {
            // R8 shrinks + obfuscates Kotlin code in release AABs, so a
            // decompiled bundle shows `a.b.c()` instead of readable names.
            // Keep rules for WebView JS bridge / Firebase / LevelPlay live in
            // proguard-rules.pro.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (!releaseStoreFile.isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")

    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")
    implementation("com.google.firebase:firebase-analytics-ktx")

    // ─────────────────────────────────────────────────────────────
    // Unity LevelPlay (ironSource mediation). Replaces the previous
    // play-services-ads (AdMob standalone) integration. Placements are
    // configured in the LevelPlay dashboard and referenced by name from
    // the web layer (water_popup, fert_popup).
    //
    // ironSource Ads itself is bundled with the mediation SDK — no extra
    // adapter needed for the default network. To plug in additional
    // networks (AppLovin / AdMob / Meta / Pangle / Mintegral / Unity Ads),
    // grab the auto-generated dependency snippet from:
    //   LevelPlay dashboard → Setup → Mediation Networks → Get script
    // and paste it below. Each adapter must match a specific network SDK
    // version, so let the dashboard pick the matrix for you.
    //
    // SDK changelog: https://developers.is.com/ironsource-mobile/android/sdk-change-log/
    //
    // We pin the 8.x line (last release: 8.12.0) because LevelPlay 9.x
    // removed the legacy IronSource.* API (IronSource.init,
    // showRewardedVideo, OfferwallListener, …) in favour of per-placement
    // LevelPlayRewardedAd objects identified by ad-unit IDs. Migrating to
    // 9.x is a separate task — it forces creating real ad units in the
    // dashboard and threading their IDs through BuildConfig.
    // ─────────────────────────────────────────────────────────────
    implementation("com.unity3d.ads-mediation:mediation-sdk:8.12.0")

    // Required by ironSource for advertising-ID lookup on Google Play
    // devices (also a dependency of every Google-family adapter).
    implementation("com.google.android.gms:play-services-basement:18.5.0")
    implementation("com.google.android.gms:play-services-ads-identifier:18.1.0")

    // Google Play Install Referrer — attributes installs back to a referral link
    // like https://play.google.com/store/apps/details?id=...&referrer=CODE.
    // Read once on first launch, pass into WebView, then dispose.
    implementation("com.android.installreferrer:installreferrer:2.2")

    // ─────────────────────────────────────────────────────────────
    // Facebook / Meta Android SDK. Version 17.x is the current LTS
    // line (Apr 2024 — 17.0.2 is documented against compileSdk 34/35).
    // Provides:
    //   • Auto-logged events: first_app_launch, activate_app, session
    //   • Custom AppEventsLogger.logEvent for manual events
    //   • Advertising ID collection (gated by AD_ID permission in the
    //     manifest) for SKAdNetwork-equivalent match quality
    //   • Data Processing Options API for LDU / GDPR compliance
    //
    // We deliberately do NOT ship the full -marketing extension — we
    // only need App Events. The smaller dep footprint keeps cold-start
    // lean and reduces R8 noise. If / when we want custom audiences
    // uploaded via SDK (we upload via CAPI instead) we can switch.
    //
    // RUNTIME COEXISTENCE WITH APPSFLYER (below): both SDKs are safe to
    // run side-by-side. AppsFlyer is the system of record (it talks to
    // Meta via partner integration server-side); the FB SDK is kept as
    // a redundant signal carrier ONLY for `fb_mobile_*` events that
    // Meta SKAdNetwork-style matches even when AppsFlyer attribution
    // window misses. We never double-count — the FB SDK has its own
    // `event_id` namespace and AppsFlyer's events go through their own
    // server. Disable FB SDK entirely if Meta dashboards start showing
    // ghost installs (set `facebookAppId` empty in keystore.properties).
    // ─────────────────────────────────────────────────────────────
    implementation("com.facebook.android:facebook-android-sdk:17.0.2")

    // ─────────────────────────────────────────────────────────────
    // AppsFlyer Android SDK — the MMP (Mobile Measurement Partner)
    // that owns campaign attribution + post-install events for the
    // app. Version 6.18.x is the current GA line (Apr 2026), matched
    // against compileSdk 34/35. Pulls in the "purchase-connector"
    // optional module out — we don't have IAP yet, so the slim core
    // SDK is enough.
    //
    // Why an MMP at all (not direct CAPI):
    //   • Single integration handles Meta + Google + TikTok + Unity
    //     Ads + ironSource (already in our stack via LevelPlay).
    //   • AppsFlyer holds a partner-level integration with each ad
    //     network; we don't need to do business-verification dances
    //     with each one. Critical when our Meta account history is
    //     volatile (see docs/marketing/ — a previous account got
    //     blocked under unrelated checks).
    //   • Built-in Protect360 fraud filter strips the 20-30% bot
    //     traffic typical for CPI-heavy gaming inventories before
    //     it ever lands in our optimisation signals.
    //   • iOS SKAdNetwork postback handling for free when we ship.
    //
    // The dev key lives in keystore.properties (gitignored) and gets
    // read at init time in BoostFarmApplication.initAppsFlyer.
    // ─────────────────────────────────────────────────────────────
    implementation("com.appsflyer:af-android-sdk:6.18.2")
}
