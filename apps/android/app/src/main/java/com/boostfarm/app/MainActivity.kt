package com.boostfarm.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.boostfarm.app.ads.StubOfferwall
import com.boostfarm.app.ads.StubRewardedAds
import com.boostfarm.app.bridge.FarmJsBridge

class MainActivity : AppCompatActivity() {

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        val rewarded = StubRewardedAds()
        val offerwall = StubOfferwall()
        webView.addJavascriptInterface(
            FarmJsBridge(webView, rewarded, offerwall),
            "EcoFarmAndroid",
        )

        webView.webViewClient = WebViewClient()

        webView.loadUrl(BuildConfig.WEB_APP_URL)
        setContentView(webView)
    }
}
