package com.boostfarm.app

import android.app.Application
import android.os.Build
import android.util.Log
import com.appsflyer.AFLogger
import com.appsflyer.AppsFlyerConversionListener
import com.appsflyer.AppsFlyerLib

/**
 * Custom Application class. Exists to host AppsFlyer SDK initialisation
 * at the documented happy-path point in the lifecycle:
 *
 *  1. `AppsFlyerLib.init(...)` must be called BEFORE `start(...)`, and
 *     `start()` should run during the first Activity-resume that
 *     follows install. Doing both inside `Application.onCreate()` is
 *     the documented happy path; calling either of them later misses
 *     the install attribution window for ~10-15% of users.
 *
 *  2. We may eventually layer per-user consent on top
 *     (`AppsFlyerLib.setSharingFilter(...)`) once we ship a CCPA / GDPR
 *     opt-out banner. The Application class is the natural place to
 *     wire that since the SDK reads consent state at every
 *     `start()` / event-flush boundary.
 *
 * AppsFlyer is the SOLE marketing-attribution path in the app today.
 * Earlier iterations also embedded the Facebook / Meta SDK; that path
 * was removed because it required maintaining a Meta developer account
 * + App on top of AppsFlyer — duplicate work for no signal gain, since
 * AppsFlyer already postbacks our high-signal events to Meta server-
 * side via the integrated-partner pipeline.
 */
class BoostFarmApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        initAppsFlyer()
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
