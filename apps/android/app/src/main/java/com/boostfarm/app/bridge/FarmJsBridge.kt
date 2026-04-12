package com.boostfarm.app.bridge

import android.webkit.JavascriptInterface
import android.webkit.WebView
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
    fun requestRewardedAd(json: String) {
        val placement = parsePlacement(json)
        webView.post {
            rewardedAds.showRewarded(placement) { ok ->
                emit("onRewardedFinished", placement, ok)
            }
        }
    }

    @JavascriptInterface
    fun requestOfferwall(json: String) {
        val placement = parsePlacement(json)
        webView.post {
            offerwall.showOfferwall(placement) { ok ->
                emit("onOfferwallFinished", placement, ok)
            }
        }
    }

    private fun parsePlacement(json: String): String =
        runCatching { JSONObject(json).optString("placement", "default") }.getOrElse { "default" }

    private fun emit(callbackName: String, placement: String, success: Boolean) {
        val payload = JSONObject()
            .put("placement", placement)
            .put("success", success)
            .toString()
        val script = """
            (function(){
              var p = $payload;
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
