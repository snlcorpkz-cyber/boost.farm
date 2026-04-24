package com.boostfarm.app

import android.app.Application
import android.os.Build
import android.util.Log
import com.facebook.FacebookSdk
import com.facebook.appevents.AppEventsLogger
import java.util.Locale

/**
 * Custom Application class. Exists for two reasons:
 *
 *  1. Facebook SDK (Meta App Events) MUST be initialised in
 *     `Application.onCreate` — not in Activity — otherwise the SDK's auto-
 *     logged events (install, app_activate, session_info) fire against a
 *     non-ready context and either silently drop or land with the wrong
 *     `app_id`. Meta's docs are explicit on this; every time someone
 *     reports "my installs aren't coming through" the answer is "you
 *     initialised it from MainActivity".
 *
 *  2. Gives us a single place to apply data-processing options (Limited
 *     Data Use / LDU) before anything in the SDK fires. We turn LDU on
 *     BY DEFAULT, even for non-GDPR regions, on the first app_launch —
 *     it's strictly more conservative than the SDK default and costs us
 *     nothing in attribution match rate (CAPI does the heavy lifting via
 *     email/external_id hashing server-side; SDK match is a nice-to-have
 *     for the pre-login install event only). We will dial this down
 *     region-by-region once a proper consent flow ships.
 *
 * AppsFlyer / Adjust / Branch are explicitly NOT installed — see the
 * marketing playbook in docs/marketing/. We attribute via direct FB SDK
 * for install + server-side CAPI for post-login events.
 */
class BoostFarmApplication : Application() {

    override fun onCreate() {
        super.onCreate()

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
            // CAPI will still catch registration and EngagedD0.
            Log.e(TAG, "Facebook SDK init failed", e)
        }
    }

    /**
     * Applies Meta's "Limited Data Use" (LDU) mode. When LDU is active,
     * the Meta backend does not use the events for ad targeting /
     * measurement beyond your own account — we can still see install
     * counts and optimize via CAPI, but Meta does not feed the data into
     * cross-app models.
     *
     * Per https://developers.facebook.com/docs/marketing-apis/data-processing-options:
     *   setDataProcessingOptions(["LDU"], 0, 0)  → Meta detects country
     *   setDataProcessingOptions(["LDU"], c, s)  → explicit country + state
     *   setDataProcessingOptions([])             → disables LDU
     *
     * We keep it on globally until a proper consent flow ships. LDU is
     * explicitly supported outside California / GDPR — Meta just routes
     * the signal through their privacy pipeline anyway.
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
                // Passing 0/0 means "let Meta geolocate from the IP"
                // — same semantics as above. We use the same call path
                // on purpose so behaviour is uniform across devices.
                FacebookSdk.setDataProcessingOptions(arrayOf("LDU"), 0, 0)
            }
        } catch (e: Throwable) {
            Log.w(TAG, "setDataProcessingOptions failed", e)
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
