package com.boostfarm.app.bridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.boostfarm.app.BuildConfig
import com.appsflyer.AppsFlyerLib
import com.boostfarm.app.ads.OfferwallPort
import com.boostfarm.app.ads.RewardedAdsPort
import com.boostfarm.app.referrer.InstallReferrerHelper
import org.json.JSONObject

/**
 * Мост Web → Native. Позже из веба вызывать, например:
 * `EcoFarmAndroid.requestRewardedAd(JSON.stringify({ placement: 'water_popup' }))`
 */
class FarmJsBridge(
    private val webView: WebView,
    private val rewardedAds: RewardedAdsPort,
    private val offerwall: OfferwallPort,
) {
    @JavascriptInterface
    fun getFcmToken(): String {
        return webView.context
            .getSharedPreferences("fcm", android.content.Context.MODE_PRIVATE)
            .getString("token", "") ?: ""
    }

    /**
     * Returns native app version info so backend can enforce minimum client versions
     * or show "update required" screens without shipping a new bundle.
     */
    @JavascriptInterface
    fun getAppVersion(): String {
        val payload = JSONObject()
            .put("versionName", BuildConfig.VERSION_NAME)
            .put("versionCode", BuildConfig.VERSION_CODE)
            .put("packageName", webView.context.packageName)
            .put("platform", "android")
            .put("sdkInt", Build.VERSION.SDK_INT)
            .put("bridgeApi", BRIDGE_API_VERSION)
        return payload.toString()
    }

    /**
     * Force-reloads the WebView from the server. Useful as a "soft update"
     * button after hot-deploying a web fix.
     */
    @JavascriptInterface
    fun reload() {
        webView.post { webView.reload() }
    }

    /**
     * Clears WebView cache (HTTP + storage). Call this when shipping a breaking
     * web change to make sure clients don't serve stale assets from disk.
     */
    @JavascriptInterface
    fun clearCache() {
        webView.post {
            webView.clearCache(true)
            webView.clearHistory()
            webView.loadUrl(BuildConfig.WEB_APP_URL)
        }
    }

    /**
     * Vibrate for [ms] milliseconds (clamped 0..2000).
     * No-op if device has no vibrator or permission is missing.
     */
    @JavascriptInterface
    fun vibrate(ms: Long) {
        try {
            val duration = ms.coerceIn(0L, 2000L)
            if (duration == 0L) return
            val ctx = webView.context
            val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            if (vibrator == null || !vibrator.hasVibrator()) return
            val effect = VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE)
            vibrator.vibrate(effect)
        } catch (e: Exception) {
            android.util.Log.e("FarmJsBridge", "vibrate failed", e)
        }
    }

    /**
     * Returns the cached Play Install Referrer as a JSON string:
     *   { refCode, raw, utmSource, utmMedium, utmCampaign, clickTs, installTs, processed }
     * `refCode` is the value the web signup flow should pass as `refCode` to
     * /auth/verify-code so the referral is attributed automatically.
     *
     * Returns an empty JSON object if there's no referrer (organic install).
     */
    @JavascriptInterface
    fun getInstallReferrer(): String {
        val snap = InstallReferrerHelper.snapshot(webView.context)
        val obj = JSONObject()
        for ((k, v) in snap) {
            if (v == null) continue
            obj.put(k, v)
        }
        return obj.toString()
    }

    /**
     * Called by the web layer after it has successfully used the referrer code
     * during signup. Clears the cached code so it can't be accidentally
     * re-applied on a second account from the same device.
     */
    @JavascriptInterface
    fun consumeInstallReferrer() {
        InstallReferrerHelper.markConsumed(webView.context)
    }

    @JavascriptInterface
    fun requestRewardedAd(json: String) {
        val placement = parsePlacement(json)
        val requestId = parseRequestId(json)
        val attemptId = parseAttemptId(json)
        webView.post {
            rewardedAds.showRewarded(placement, attemptId) { ok, reason ->
                emit("onRewardedFinished", placement, ok, requestId, reason)
            }
        }
    }

    @JavascriptInterface
    fun openExternalUrl(url: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            webView.context.startActivity(intent)
        } catch (e: Exception) {
            android.util.Log.e("FarmJsBridge", "Failed to open URL: $url", e)
        }
    }

    @JavascriptInterface
    fun requestOfferwall(json: String) {
        val placement = parsePlacement(json)
        val requestId = parseRequestId(json)
        webView.post {
            offerwall.showOfferwall(placement) { ok ->
                emit("onOfferwallFinished", placement, ok, requestId, null)
            }
        }
    }

    /**
     * Forwards an in-app event into the AppsFlyer SDK. The web layer calls
     * e.g. `EcoFarmAndroid.logAfEvent('af_complete_registration',
     * '{"af_registration_method":"email"}')`.
     *
     * AppsFlyer is the system of record for marketing attribution: events
     * logged here flow into the AppsFlyer dashboard AND are auto-postbacked
     * to every connected ad network (Meta, Google, TikTok, …) without us
     * touching their APIs. That's the whole reason we picked an MMP over
     * direct CAPI integrations.
     *
     * Event NAME conventions:
     *   • Predefined AF events (`af_purchase`, `af_complete_registration`,
     *     `af_level_achieved`, `af_tutorial_completion`, …) automatically
     *     map to standard partner events on the network side. Use these
     *     when an equivalent exists.
     *   • Custom events (`af_engaged_d0`, `af_offer_completed`, …) are
     *     prefixed `af_` for visual consistency and need to be configured
     *     in the AppsFlyer dashboard once before partners can map them.
     *
     * Reserved parameter names that AppsFlyer aggregates specially:
     *   • `af_revenue` (number)   → ROAS column in dashboards
     *   • `af_currency` (string)  → ISO-4217, defaults to USD if missing
     *   • `af_quantity` (number)  → for Purchase events
     *
     * Numeric params are passed as Java doubles; everything else is
     * stringified. AF accepts strings/numbers/booleans natively but
     * silently drops nested objects, so we flatten to scalars here.
     */
    @JavascriptInterface
    fun logAfEvent(name: String, paramsJson: String) {
        try {
            val parsed = runCatching { JSONObject(paramsJson) }.getOrElse { JSONObject() }
            val map = HashMap<String, Any>()
            val keys = parsed.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                val v = parsed.opt(k) ?: continue
                when (v) {
                    is Number -> map[k] = v
                    is Boolean -> map[k] = v
                    else -> map[k] = v.toString()
                }
            }
            AppsFlyerLib.getInstance().logEvent(webView.context, name, map)
        } catch (e: Throwable) {
            // Never raise — marketing SDK failure is non-fatal. The same
            // event will retry from the server's events table the next
            // time the dispatch worker (future) runs.
            android.util.Log.w("FarmJsBridge", "logAfEvent failed: $name", e)
        }
    }

    /**
     * Tells AppsFlyer "this device belongs to user X". Sent on the very
     * first `/auth/verify-code` success (and on every cold start
     * afterwards as a no-cost idempotent re-stamp).
     *
     * Critical for cross-device attribution: when the same user opens
     * the app on a tablet later, AppsFlyer can still tie the events to
     * the original install via `customer_user_id`. Without this, every
     * device looks like a separate fresh user.
     *
     * Empty / blank ids are ignored — we never want to overwrite a real
     * id with a falsy one.
     */
    @JavascriptInterface
    fun setAfCustomerUserId(userId: String) {
        try {
            val trimmed = userId.trim()
            if (trimmed.isEmpty()) return
            AppsFlyerLib.getInstance().setCustomerUserId(trimmed)
        } catch (e: Throwable) {
            android.util.Log.w("FarmJsBridge", "setAfCustomerUserId failed", e)
        }
    }

    /**
     * Returns the AppsFlyer Unique ID (one per install). The web layer
     * sends this to our server during /verify-code so we can later cross-
     * reference our `users` table with AppsFlyer's attribution dashboard
     * (e.g. when joining cohort retention to creative breakdown).
     *
     * Returns empty string if the SDK hasn't generated an ID yet (only
     * happens in the very first ms after install — getInstance().getAppsFlyerUID
     * is normally synchronous + cached).
     */
    @JavascriptInterface
    fun getAppsFlyerId(): String {
        return try {
            AppsFlyerLib.getInstance().getAppsFlyerUID(webView.context) ?: ""
        } catch (e: Throwable) {
            android.util.Log.w("FarmJsBridge", "getAppsFlyerId failed", e)
            ""
        }
    }

    /**
     * Generic analytics event forwarder. The web layer calls
     * `EcoFarmAndroid.track('ad.loaded', '{"placement":"water_popup"}')` which
     * ultimately becomes a row in the server `events` table via
     * `POST /api/track`. We re-dispatch to `window.__ecoFarmNative.onAdEvent`
     * so the native path and the Kotlin ad listener share one sink.
     *
     * NOTE: this is a pass-through for future native-originated events
     * (e.g. in-app-review prompt, crash survival marker). Today the only
     * caller is LevelPlayRewardedAds via [AdEventSink] which bypasses this
     * method entirely — we still expose it so web code can feature-detect
     * arbitrary analytics from native.
     */
    @JavascriptInterface
    fun track(name: String, propsJson: String) {
        val props = runCatching { JSONObject(propsJson) }.getOrElse { JSONObject() }
        val payload = JSONObject()
            .put("state", name.removePrefix("ad."))
            .put("meta", props)
        val payloadStr = payload.toString()
        val script = """
            (function(){
              var p = $payloadStr;
              if (window.__ecoFarmNative && window.__ecoFarmNative.onAdEvent) {
                window.__ecoFarmNative.onAdEvent(p);
              }
            })();
        """.trimIndent()
        webView.post {
            webView.evaluateJavascript(script, null)
        }
    }

    private fun parsePlacement(json: String): String =
        runCatching { JSONObject(json).optString("placement", "default") }.getOrElse { "default" }

    private fun parseRequestId(json: String): String? =
        runCatching {
            val id = JSONObject(json).optString("requestId", "")
            id.ifBlank { null }
        }.getOrNull()

    /**
     * Caller-generated attempt_id — one per user click, stamped by the
     * web layer onto every ad.* event. Passed through into the native
     * LevelPlay adapter so every SDK callback (shown / rewarded /
     * closed / failed) carries the same id, letting the admin funnel
     * dedup stages by `count(DISTINCT attempt_id)` instead of raw events.
     */
    private fun parseAttemptId(json: String): String? =
        runCatching {
            val id = JSONObject(json).optString("attemptId", "")
            id.ifBlank { null }
        }.getOrNull()

    companion object {
        /**
         * Bump this when you add/change bridge methods so the web client can
         * feature-detect capabilities instead of relying on version codes.
         *
         * v3: rewarded/offerwall callbacks now forward the caller-supplied
         *      `requestId` so concurrent requests don't clobber each other.
         * v4: added getInstallReferrer / consumeInstallReferrer for automatic
         *      Google Play Install Referrer attribution.
         * v5: ad lifecycle events forwarded to web via
         *      `window.__ecoFarmNative.onAdEvent` + generic `track()` method
         *      for native-originated analytics. Used by the product-analytics
         *      funnel on the admin side (Ads → Funnel / Placements / Status).
         * v6: rewarded callback now carries a `reason` field describing why
         *      a failed show happened (unavailable / show_failed /
         *      closed_unrewarded / concurrent). Web layer uses this to decide
         *      whether to offer a fallback reward flow (unavailable) or to
         *      silently skip (closed_unrewarded).
         * v7: requestRewardedAd accepts an optional `attemptId` in the JSON
         *      payload — the web-side per-click correlation id that the
         *      admin Ads funnel uses to count distinct user intents via
         *      `count(DISTINCT properties->>'attempt_id')`. Safe to omit:
         *      native simply doesn't stamp attempt_id onto its own events
         *      when the web bundle predates v7.
         * v8: logFbEvent(name, paramsJson) — REMOVED in v10. Forwarded
         *      events into the Facebook App Events SDK. Maintained between
         *      v8-v9 alongside AppsFlyer; deleted once we committed to AF
         *      as the single MMP. Web bundles published before v10
         *      feature-detect via `if (!b?.logFbEvent) return;` and become
         *      no-ops on the native side, so old bundles + new APK are
         *      forward-compatible.
         * v9: AppsFlyer integration trio:
         *      - logAfEvent(name, paramsJson)     fires AF in-app events
         *      - setAfCustomerUserId(userId)      ties device to user_id
         *      - getAppsFlyerId()                 returns AF UID for backend
         *     AF replaces direct CAPI for partner-routed attribution.
         * v10: Facebook / Meta SDK removed entirely. AppsFlyer is now the
         *      sole client-side marketing path. Server-side CAPI worker
         *      stays dormant as a future redundant channel — but is gated
         *      behind explicit env vars so a missing Meta app config no
         *      longer throws or pollutes logs.
         */
        const val BRIDGE_API_VERSION = 10
    }

    private fun emit(callbackName: String, placement: String, success: Boolean, requestId: String?, reason: String?) {
        val payload = JSONObject()
            .put("placement", placement)
            .put("success", success)
        if (requestId != null) payload.put("requestId", requestId)
        if (reason != null) payload.put("reason", reason)
        val payloadStr = payload.toString()
        val script = """
            (function(){
              var p = $payloadStr;
              if (window.__ecoFarmNative && window.__ecoFarmNative.$callbackName) {
                window.__ecoFarmNative.$callbackName(p);
              }
            })();
        """.trimIndent()
        webView.post {
            webView.evaluateJavascript(script, null)
        }
    }
}
