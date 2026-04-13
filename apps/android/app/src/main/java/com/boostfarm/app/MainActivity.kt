package com.boostfarm.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.boostfarm.app.ads.AdMobRewardedAds
import com.boostfarm.app.ads.StubOfferwall
import com.boostfarm.app.bridge.FarmJsBridge
import com.google.android.gms.ads.MobileAds
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestNotificationPermission()
        MobileAds.initialize(this) {}

        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        val rewarded = AdMobRewardedAds(this)
        val offerwall = StubOfferwall()
        webView.addJavascriptInterface(
            FarmJsBridge(webView, rewarded, offerwall),
            "EcoFarmAndroid",
        )

        val appHost = Uri.parse(BuildConfig.WEB_APP_URL).host ?: ""

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectFcmToken()
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                val host = url.host ?: ""
                val scheme = url.scheme ?: ""

                if (scheme == "market" || scheme == "intent" ||
                    host.contains("play.google.com") ||
                    host.contains("apps.apple.com") ||
                    (!host.contains(appHost) && scheme.startsWith("http"))
                ) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                    } catch (_: Exception) { }
                    return true
                }
                return false
            }
        }

        webView.loadUrl(BuildConfig.WEB_APP_URL)
        setContentView(webView)
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    1001
                )
            }
        }
    }

    private fun injectFcmToken() {
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            getSharedPreferences("fcm", MODE_PRIVATE)
                .edit()
                .putString("token", token)
                .apply()

            val script = """
                (function(){
                  if (window.__ecoFarmNative) {
                    window.__ecoFarmNative.fcmToken = "$token";
                  } else {
                    window.__ecoFarmNative = { fcmToken: "$token" };
                  }
                  window.dispatchEvent(new CustomEvent('fcm-token', { detail: "$token" }));
                })();
            """.trimIndent()
            webView.post {
                webView.evaluateJavascript(script, null)
            }
        }
    }
}
