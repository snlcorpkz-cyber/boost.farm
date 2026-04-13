plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.boostfarm.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.boostfarm.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        // TODO: productFlavor для staging / http://10.0.2.2:5173/
        buildConfigField("String", "WEB_APP_URL", "\"https://boostfarm.io/\"")

        // AdMob: test IDs until account is approved; then switch to production IDs
        // Production Water: ca-app-pub-3079122554551679/6905057993
        // Production Fert:  ca-app-pub-3079122554551679/2742451701
        buildConfigField("String", "ADMOB_REWARDED_WATER", "\"ca-app-pub-3940256099942544/5224354917\"")
        buildConfigField("String", "ADMOB_REWARDED_FERT", "\"ca-app-pub-3940256099942544/5224354917\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
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

    implementation("com.google.android.gms:play-services-ads:24.1.0")
}
