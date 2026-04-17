# ════════════════════════════════════════════════════════════════
# ProGuard / R8 rules for Boost Farm.
#
# We enable code shrinking + obfuscation in release builds so anyone
# who decompiles the APK/AAB sees `a.b.c()` instead of readable
# class/method names. The only things we MUST keep intact are the
# JavaScript bridge methods (WebView calls them by name from JS) and
# third-party SDK entry points (AdMob, Firebase, WorkManager, etc).
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

# --- Google Mobile Ads (AdMob) — reflection-heavy SDK.
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**
-keep class com.google.ads.** { *; }
-dontwarn com.google.ads.**

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
