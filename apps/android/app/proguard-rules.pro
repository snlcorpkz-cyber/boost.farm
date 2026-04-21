# ════════════════════════════════════════════════════════════════
# ProGuard / R8 rules for Boost Farm.
#
# We enable code shrinking + obfuscation in release builds so anyone
# who decompiles the APK/AAB sees `a.b.c()` instead of readable
# class/method names. The only things we MUST keep intact are the
# JavaScript bridge methods (WebView calls them by name from JS) and
# third-party SDK entry points (LevelPlay / ironSource, Firebase,
# Play Install Referrer, etc).
# ════════════════════════════════════════════════════════════════

# --- JavaScript bridge: WebView reflects into these methods by name.
# Losing the names would break native ↔ web communication at runtime.
-keepclassmembers class com.boostfarm.app.bridge.** {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.boostfarm.app.bridge.FarmJsBridge { *; }

# --- FCM / Firebase Messaging reflection.
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
-keep class com.boostfarm.app.FcmService { *; }

# --- Unity LevelPlay (ironSource) mediation — the SDK and per-network
#     adapters load classes reflectively, so we blanket-keep them. The
#     individual adapter artefacts (admob-adapter, applovin-adapter, …)
#     ship their own consumer-proguard rules for the network SDKs they
#     wrap, so we only need the mediation umbrella here.
-keep class com.ironsource.** { *; }
-dontwarn com.ironsource.**
-keep class com.unity3d.mediation.** { *; }
-dontwarn com.unity3d.mediation.**
-keep class com.unity3d.ironsourceads.** { *; }
-dontwarn com.unity3d.ironsourceads.**

# Google Play Services base is still pulled in by the AdMob / AppLovin
# adapters for advertising-ID lookups.
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# --- Google Play Install Referrer SDK (AIDL).
-keep class com.android.installreferrer.** { *; }
-dontwarn com.android.installreferrer.**

# --- Keep annotations and Kotlin metadata (harmless, prevents weird issues).
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# --- Kotlin coroutines / reflection.
-dontwarn kotlinx.coroutines.**
-keep class kotlin.Metadata { *; }

# --- WebView JS interfaces in general (belt-and-braces).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- Silence warnings from optional deps.
-dontwarn javax.annotation.**
-dontwarn org.checkerframework.**
