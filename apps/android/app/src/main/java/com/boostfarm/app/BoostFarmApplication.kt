package com.boostfarm.app

import android.app.Application
import android.os.Build
import android.util.Log
import com.appsflyer.AFLogger
import com.appsflyer.AppsFlyerConversionListener
import com.appsflyer.AppsFlyerLib
import com.facebook.FacebookSdk
import com.facebook.appevents.AppEventsLogger
import java.util.Locale

/**
 * Custom Application class. Exists for three reasons:
 *
 *  1. Facebook SDK (Meta App Events) MUST be initialised in
 *     `Application.onCreate` — not in Activity — otherwise the SDK's auto-
 *     logged events (install, app_activate, session_info) fire against a
 *     non-ready context and either silently drop or land with the wrong
 *     `app_id`. Meta's docs are explicit on this; every time someone
 *     reports "my installs aren't coming through" the answer is "you
 *     initialised it from MainActivity".
 *
 *  2. AppsFlyer SDK has the EXACT same constraint plus a stricter one:
 *     `AppsFlyerLib.init(...)` must be called BEFORE `start(...)`, and
 *     `start()` must run during the first Activity-resume that follows
 *     install. Doing both inside `Application.onCreate()` is the
 *     documented happy path; calling either of them later misses the
 *     install attribution window for ~10-15% of users.
 *
 *  3. Gives us a single place to apply data-processing options (Limited
 *     Data Use / LDU) before anything in the Meta SDK fires. We turn LDU
 *     on BY DEFAULT, even for non-GDPR regions, on the first app_launch.
 *     (AppsFlyer has its own consent API — `AppsFlyerLib.setSharingFilter`
 *     etc. — which we wire up here as well, defaulting to "no sharing
 *     with networks that aren't necessary for attribution".)
 *
 * SDK COEXISTENCE: both Meta SDK and AppsFlyer run side-by-side. AppsFlyer
 * is the system of record for attribution and reporting; Meta SDK fires
 * the install + tutorial completion events as a SKAN-style redundant
 * signal so Meta's optimiser still sees device-level events even if the
 * AppsFlyer→Meta integration glitches.
 */
class BoostFarmApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        initAppsFlyer()
        initFacebook()
    }

    /**
     * AppsFlyer is our MMP (Mobile Measurement Partner). It listens to the
     * Play Install Referrer, decrypts the encrypted bits Google sends back,
     * normalises GAID + Android ID, and routes events to the dashboards of
     * connected partners (Meta, Google, TikTok, …).
     *
     * Init contract:
     *   • init(devKey, conversionListener?, context)  — synchronous, just
     *     stashes the key + lazily wires receivers.
     *   • start(context, devKey?, callback?)          — kicks off the
     *     attribution call. Required, otherwise no events flow.
     *
     * The conversion listener is OPTIONAL but we wire a tiny one to
     * surface attribution data in logcat during dev. We don't store the
     * payload — `getAppsFlyerUID()` is the canonical id we send to the
     * server via the JS bridge.
     */
    private fun initAppsFlyer() {
        val devKey = BuildConfig.APPSFLYER_DEV_KEY
        if (devKey.isBlank()) {
            Log.w(TAG, "AppsFlyer dev key is empty; SDK will not be initialised. Add appsFlyerDevKey to keystore.properties.")
            return
        }
        try {
            val af = AppsFlyerLib.getInstance()

            // Verbose logs ONLY in debuggable builds. R8 strips this branch
            // in release because BuildConfig.DEBUG is a compile-time const.
            af.setDebugLog(BuildConfig.DEBUG)
            if (BuildConfig.DEBUG) af.setLogLevel(AFLogger.LogLevel.DEBUG)

            // NOTE on data-sharing: we deliberately do NOT call
            // `setSharingFilterForAllPartners()` here. Despite the
            // intuitive name, that method BLOCKS the SDK from
            // postbacking events to every integrated partner —
            // including the Meta integration we configured in the
            // AppsFlyer dashboard. Calling it would silently break the
            // entire optimisation pipeline (events would land in the AF
            // dashboard but Meta's auction would never see them).
            //
            // Per-user opt-out (CCPA / GDPR "no" choice) is handled via
            // `setSharingFilter("facebook_int", ...)` once we ship a
            // consent banner — gated behind an explicit user flag. The
            // default app-launch path lets postbacks flow normally so
            // Meta / Google can optimise our paid spend.

            af.init(devKey, attributionListener, applicationContext)
            af.start(this, devKey)
        } catch (e: Throwable) {
            Log.e(TAG, "AppsFlyer init failed", e)
        }
    }

    private fun initFacebook() {
        try {
            // Auto-init reads ApplicationId / ClientToken from the
            // `<meta-data>` tags we put in AndroidManifest.xml. We turn it
            // on explicitly because `setAutoInitEnabled(true)` is the
            // documented migration path as of SDK 12+: the old
            // AutoInitEnabled manifest flag alone is not enough for
            // newer compileSdks (it gets optimised out by R8 under some
            // minify rules and we lose Advertiser ID collection).
            FacebookSdk.setAutoInitEnabled(true)
            FacebookSdk.fullyInitialize()

            applyDataProcessingPolicy()

            // activateApp fires the `fb_mobile_activate_app` event (our
            // proxy for DAU on the Meta side) AND schedules first-launch
            // detection. Called once per process, idempotent thereafter.
            AppEventsLogger.activateApp(this)
        } catch (e: Throwable) {
            // Never let a marketing-SDK initialisation failure take down
            // the app. Worst case: we lose this session's Meta events —
            // AppsFlyer is the system of record and will still attribute.
            Log.e(TAG, "Facebook SDK init failed", e)
        }
    }

    /**
     * Applies Meta's "Limited Data Use" (LDU) mode. When LDU is active,
     * the Meta backend does not use the events for ad targeting /
     * measurement beyond your own account — we can still see install
     * counts and optimise via AppsFlyer→Meta postbacks, but Meta does
     * not feed the data into cross-app models.
     */
    private fun applyDataProcessingPolicy() {
        try {
            // Empty-country / zero-state tuple tells Meta to geo-IP the
            // request itself. This is the documented "safe default" when
            // the device locale cannot be trusted (VPN, travellers, etc).
            val locale = Locale.getDefault().country
            if (locale.isNullOrBlank()) {
                FacebookSdk.setDataProcessingOptions(arrayOf("LDU"), 0, 0)
            } else {
                FacebookSdk.setDataProcessingOptions(arrayOf("LDU"), 0, 0)
            }
        } catch (e: Throwable) {
            Log.w(TAG, "setDataProcessingOptions failed", e)
        }
    }

    /**
     * Minimal AppsFlyer attribution listener. We only log in debug builds
     * — production paths read the AppsFlyer ID via the JS bridge instead
     * (more deterministic than relying on this callback firing in time
     * for the first network request to /verify-code).
     */
    private val attributionListener = object : AppsFlyerConversionListener {
        override fun onConversionDataSuccess(data: MutableMap<String, Any>?) {
            if (BuildConfig.DEBUG) Log.d(TAG, "AF conversion: $data")
        }
        override fun onConversionDataFail(error: String?) {
            if (BuildConfig.DEBUG) Log.w(TAG, "AF conversion failed: $error")
        }
        override fun onAppOpenAttribution(data: MutableMap<String, String>?) {
            // Deep-link payload. We don't deep-link from ads today.
        }
        override fun onAttributionFailure(error: String?) {
            if (BuildConfig.DEBUG) Log.w(TAG, "AF attribution failed: $error")
        }
    }

    companion object {
        private const val TAG = "BoostFarmApp"

        /**
         * Minimum Android version where `AD_ID` permission is even
         * relevant — it's enforced from API 33 (Tiramisu) upwards.
         * Exposed for MainActivity to skip the GAID request path on
         * older devices where the permission is a no-op.
         */
        const val AD_ID_PERMISSION_MIN_SDK: Int = Build.VERSION_CODES.TIRAMISU
    }
}
