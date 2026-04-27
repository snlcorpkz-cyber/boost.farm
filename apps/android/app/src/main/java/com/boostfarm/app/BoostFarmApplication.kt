package com.boostfarm.app

import android.app.Application
import android.content.Context
import android.os.Build
import android.util.Log
import com.appsflyer.AFLogger
import com.appsflyer.AppsFlyerConversionListener
import com.appsflyer.AppsFlyerLib
import com.appsflyer.deeplink.DeepLinkResult
import org.json.JSONObject

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
     *   • subscribeForDeepLink(listener)              — must be called
     *     BEFORE `start(...)` so deferred deep links fire on first
     *     install. Wires the OneLink path for retargeting campaigns.
     *   • start(context, devKey?, callback?)          — kicks off the
     *     attribution call. Required, otherwise no events flow.
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

            // OneLink Universal Deep Link subscription. Must be wired
            // BEFORE `start()` — otherwise the deferred deep link
            // (the one fired on first install from a OneLink ad) is
            // dropped. See [forwardDeepLink] for the cache-and-broadcast
            // strategy used to bridge native into the WebView.
            af.subscribeForDeepLink { result -> forwardDeepLink(result) }

            af.init(devKey, attributionListener, applicationContext)
            af.start(this, devKey)
        } catch (e: Throwable) {
            Log.e(TAG, "AppsFlyer init failed", e)
        }
    }

    /**
     * AppsFlyer attribution listener.
     *
     * The success callback is the ONLY place we receive `media_source`,
     * `campaign`, `af_status`, `af_ad_id`, etc. — the data our admin
     * reports need to answer "which Meta creative produced this user".
     *
     * Strategy: cache the payload in SharedPreferences synchronously.
     * The web layer pulls it on the very next `/auth/verify-code` (or
     * later if the user is already logged in) via the JS bridge.
     * Caching to disk (instead of pushing to web immediately) is
     * deliberate:
     *
     *   • The callback can fire BEFORE the WebView is even created
     *     (Application.onCreate runs before MainActivity.onCreate on
     *     cold install). A live dispatch would no-op silently.
     *   • The callback fires ONLY ONCE per install — if we missed the
     *     dispatch window we'd never get a second chance. Disk cache
     *     survives the first /verify-code race.
     *   • SharedPreferences is fast enough that the bridge read on
     *     every login isn't a perceptible cost.
     */
    private val attributionListener = object : AppsFlyerConversionListener {
        override fun onConversionDataSuccess(data: MutableMap<String, Any>?) {
            if (data == null) return
            try {
                val obj = JSONObject()
                for ((k, v) in data) {
                    if (v is Number || v is Boolean) obj.put(k, v) else obj.put(k, v.toString())
                }
                getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putString(KEY_ATTRIBUTION, obj.toString())
                    .apply()
                if (BuildConfig.DEBUG) Log.d(TAG, "AF conversion cached: $obj")
            } catch (e: Throwable) {
                Log.w(TAG, "Failed to cache AF conversion data", e)
            }
        }
        override fun onConversionDataFail(error: String?) {
            if (BuildConfig.DEBUG) Log.w(TAG, "AF conversion failed: $error")
        }
        override fun onAppOpenAttribution(data: MutableMap<String, String>?) {
            // Legacy (pre-OneLink) deep-link callback. Modern OneLink
            // payloads come through `subscribeForDeepLink` instead. We
            // still cache the legacy payload as a deep-link source so
            // older campaigns built on direct deeplink_value=... URLs
            // keep working without code changes.
            if (data.isNullOrEmpty()) return
            try {
                val obj = JSONObject()
                for ((k, v) in data) obj.put(k, v)
                cacheDeepLink(obj.toString())
            } catch (_: Throwable) {}
        }
        override fun onAttributionFailure(error: String?) {
            if (BuildConfig.DEBUG) Log.w(TAG, "AF attribution failed: $error")
        }
    }

    /**
     * Forwards a OneLink deep-link payload into the WebView. The flow
     * tries hardest to broadcast LIVE (so retargeting opens land on the
     * right page even when the user is already mid-session), with a
     * SharedPreferences fallback that the web layer drains on next
     * boot via `getAfDeepLink()`.
     */
    private fun forwardDeepLink(result: DeepLinkResult) {
        if (result.status != DeepLinkResult.Status.FOUND) {
            if (BuildConfig.DEBUG) Log.d(TAG, "AF deep link: ${result.status}")
            return
        }
        val deep = result.deepLink ?: return
        try {
            val obj = JSONObject()
            obj.put("isDeferred", deep.isDeferred ?: false)
            // SDK exposes a typed accessor for `deep_link_value` (the
            // canonical OneLink param) alongside the raw map view.
            deep.deepLinkValue?.let { obj.put("deepLinkValue", it) }
            // Iterate every key on the deep link — `deep_link_sub1..N`
            // are how Meta retargeting sets feed identifiers, offer
            // ids, etc. We pass them through verbatim so the web layer
            // can read whatever the campaign producer put there.
            val keys = deep.clickEvent?.keys()
            while (keys?.hasNext() == true) {
                val k = keys.next()
                val v = deep.clickEvent.opt(k) ?: continue
                obj.put(k, v)
            }
            cacheDeepLink(obj.toString())
            // Best-effort live dispatch into a foreground WebView.
            currentWebView?.let { wv ->
                val script = """
                    (function(){
                      try {
                        window.dispatchEvent(new CustomEvent('af-deep-link', {
                          detail: ${obj}
                        }));
                      } catch (e) {}
                    })();
                """.trimIndent()
                wv.post { wv.evaluateJavascript(script, null) }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "forwardDeepLink failed", e)
        }
    }

    private fun cacheDeepLink(json: String) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_DEEP_LINK, json)
            .apply()
    }

    companion object {
        private const val TAG = "BoostFarmApp"
        const val PREFS = "appsflyer_attribution"
        const val KEY_ATTRIBUTION = "conversion_data"
        const val KEY_DEEP_LINK = "deep_link"

        /**
         * Live WebView reference set by [MainActivity.onCreate]. Used by
         * the deep-link forwarder to dispatch a `af-deep-link` event
         * directly into the running web layer when the user is already
         * in-app (vs. a fresh launch where the WebView doesn't exist
         * yet and we fall back to SharedPreferences caching).
         *
         * Held as a plain field — leaks of an Activity's WebView on
         * Application terminate aren't actually a leak in our model:
         * MainActivity always re-sets it on its own onCreate, and the
         * Application is alive for the lifetime of the process anyway.
         */
        @Volatile
        var currentWebView: android.webkit.WebView? = null

        /**
         * Minimum Android version where `AD_ID` permission is even
         * relevant — it's enforced from API 33 (Tiramisu) upwards.
         * Exposed for MainActivity to skip the GAID request path on
         * older devices where the permission is a no-op.
         */
        const val AD_ID_PERMISSION_MIN_SDK: Int = Build.VERSION_CODES.TIRAMISU
    }
}
