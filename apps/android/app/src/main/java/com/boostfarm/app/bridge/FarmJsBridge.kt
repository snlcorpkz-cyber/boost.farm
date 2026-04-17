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
import com.boostfarm.app.ads.OfferwallPort
import com.boostfarm.app.ads.RewardedAdsPort
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

    @JavascriptInterface
    fun requestRewardedAd(json: String) {
        val placement = parsePlacement(json)
        val requestId = parseRequestId(json)
        webView.post {
            rewardedAds.showRewarded(placement) { ok ->
                emit("onRewardedFinished", placement, ok, requestId)
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
                emit("onOfferwallFinished", placement, ok, requestId)
            }
        }
    }

    private fun parsePlacement(json: String): String =
        runCatching { JSONObject(json).optString("placement", "default") }.getOrElse { "default" }

    private fun parseRequestId(json: String): String? =
        runCatching {
            val id = JSONObject(json).optString("requestId", "")
            id.ifBlank { null }
        }.getOrNull()

    companion object {
        /**
         * Bump this when you add/change bridge methods so the web client can
         * feature-detect capabilities instead of relying on version codes.
         *
         * v3: rewarded/offerwall callbacks now forward the caller-supplied
         *      `requestId` so concurrent requests don't clobber each other.
         */
        const val BRIDGE_API_VERSION = 3
    }

    private fun emit(callbackName: String, placement: String, success: Boolean, requestId: String?) {
        val payload = JSONObject()
            .put("placement", placement)
            .put("success", success)
        if (requestId != null) payload.put("requestId", requestId)
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
