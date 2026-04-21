package com.boostfarm.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.boostfarm.app.ads.LevelPlayRewardedAds
import com.boostfarm.app.ads.OfferwallPort
import com.boostfarm.app.ads.RewardedAdsPort
import com.boostfarm.app.ads.StubOfferwall
import com.boostfarm.app.ads.StubRewardedAds
import com.boostfarm.app.bridge.FarmJsBridge
import com.boostfarm.app.referrer.InstallReferrerHelper
import com.google.firebase.messaging.FirebaseMessaging
import com.ironsource.mediationsdk.IronSource

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Android 15 (API 35) forces edge-to-edge, so without inset handling
        // the system navigation bar overlaps the bottom of the WebView and
        // eats interactive UI. We opt-in explicitly here so behaviour is
        // consistent on older devices too, then pad the WebView below.
        WindowCompat.setDecorFitsSystemWindows(window, false)

        requestNotificationPermission()

        // Initialize Unity LevelPlay (ironSource) mediation. The app key is
        // injected via BuildConfig from apps/android/keystore.properties
        // (gitignored). If the key is blank we skip init and wire the Stub
        // adapters below — this lets developers run the app without any ads
        // setup and still keeps automated tests / CI builds green.
        val lpKey = BuildConfig.LEVELPLAY_APP_KEY
        if (lpKey.isNotBlank()) {
            // TODO: replace `true` with a real consent flag wired to the GDPR
            // dialog once the consent UI is added on the web side.
            IronSource.setConsent(true)
            // OFFERWALL is intentionally NOT initialised here — ironSource
            // removed Offerwall from LevelPlay 8.x and the OfferwallPort
            // implementation falls back to StubOfferwall. We can swap in
            // a dedicated offerwall provider (Adgem / Fyber / Tapjoy) later
            // through the same OfferwallPort interface without touching
            // MainActivity.
            IronSource.init(
                this,
                lpKey,
                IronSource.AD_UNIT.REWARDED_VIDEO,
            )
        }

        // Fire-and-forget: grabs the Play Store install referrer on first launch
        // and caches it. Web layer picks it up via the JS bridge during signup.
        InstallReferrerHelper.fetchOnce(applicationContext)

        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        val rewarded: RewardedAdsPort =
            if (lpKey.isBlank()) StubRewardedAds() else LevelPlayRewardedAds(this)
        // Offerwall provider TBD — keep StubOfferwall until we plug a real
        // network in (LevelPlay 8.x dropped Offerwall support entirely).
        val offerwall: OfferwallPort = StubOfferwall()
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

        // Wrap the WebView in a FrameLayout that we pad with the system bar /
        // display cutout insets. Doing it on a plain container (instead of on
        // the WebView itself) is the reliable pattern — some WebView
        // implementations consume or swallow the insets callback before our
        // listener fires, which is what produced the overlap screenshots we
        // saw on Xiaomi/HyperOS devices. The black background fills the
        // padded edges so nothing looks washed-out behind the status /
        // navigation bars.
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            fitsSystemWindows = false
        }
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )

        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout()
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        webView.loadUrl(BuildConfig.WEB_APP_URL)
        setContentView(root)
        ViewCompat.requestApplyInsets(root)
    }

    override fun onResume() {
        super.onResume()
        // IronSource requires the host activity to forward lifecycle events —
        // skipping these calls crashes the SDK when an ad is showing.
        if (BuildConfig.LEVELPLAY_APP_KEY.isNotBlank()) {
            IronSource.onResume(this)
        }
    }

    override fun onPause() {
        if (BuildConfig.LEVELPLAY_APP_KEY.isNotBlank()) {
            IronSource.onPause(this)
        }
        super.onPause()
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
