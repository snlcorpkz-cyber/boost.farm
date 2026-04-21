package com.boostfarm.app.ads

import android.webkit.WebView
import org.json.JSONObject

/**
 * One-way pipe for ad-lifecycle events from the native mediation adapter to
 * the WebView so the product analytics layer can track the full funnel.
 *
 * The web side registers `window.__ecoFarmNative.onAdEvent` (see
 * apps/web/src/lib/native.ts) which converts each emission into a
 * `trackClient('ad.<state>', meta)` call.
 */
interface AdEventSink {

    /**
     * @param state one of: requested, loaded, no_fill, shown, rewarded, failed, closed
     * @param meta  placement / network / error fields — null values are dropped
     */
    fun emit(state: String, meta: Map<String, Any?>)

    companion object {
        /** Sink used in unit tests or when the WebView isn't available yet. */
        fun noop(): AdEventSink = object : AdEventSink {
            override fun emit(state: String, meta: Map<String, Any?>) { /* no-op */ }
        }
    }
}

/**
 * Forwards events to `window.__ecoFarmNative.onAdEvent({ state, meta })`
 * by evaluating JavaScript on the WebView's UI thread.
 */
class WebViewAdEventSink(private val webView: WebView) : AdEventSink {

    override fun emit(state: String, meta: Map<String, Any?>) {
        val metaObj = JSONObject()
        for ((k, v) in meta) {
            if (v == null) continue
            metaObj.put(k, v)
        }
        val payload = JSONObject()
            .put("state", state)
            .put("meta", metaObj)
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
}
