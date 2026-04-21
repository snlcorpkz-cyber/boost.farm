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
        versionCode = 6
        versionName = "0.3.3"
        // TODO: productFlavor для staging / http://10.0.2.2:5173/
        buildConfigField("String", "WEB_APP_URL", "\"https://boostfarm.io/\"")

        // AdMob: test IDs until account is approved; then switch to production IDs
        // Production Water: ca-app-pub-3079122554551679/6905057993
        // Production Fert:  ca-app-pub-3079122554551679/2742451701
        buildConfigField("String", "ADMOB_REWARDED_WATER", "\"ca-app-pub-3940256099942544/5224354917\"")
        buildConfigField("String", "ADMOB_REWARDED_FERT", "\"ca-app-pub-3940256099942544/5224354917\"")
    }

    signingConfigs {
        create("release") {
            if (keystorePropsFile.exists()) {
                storeFile = rootProject.file(keystoreProps["storeFile"] as String)
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
            // Keep rules for WebView JS bridge / Firebase / AdMob live in
            // proguard-rules.pro.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (keystorePropsFile.exists()) {
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

    implementation("com.google.android.gms:play-services-ads:24.1.0")

    // Google Play Install Referrer — attributes installs back to a referral link
    // like https://play.google.com/store/apps/details?id=...&referrer=CODE.
    // Read once on first launch, pass into WebView, then dispose.
    implementation("com.android.installreferrer:installreferrer:2.2")
}
