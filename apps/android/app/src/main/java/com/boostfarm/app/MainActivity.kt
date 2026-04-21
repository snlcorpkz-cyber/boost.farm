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
import com.boostfarm.app.ads.AdMobRewardedAds
import com.boostfarm.app.ads.StubOfferwall
import com.boostfarm.app.bridge.FarmJsBridge
import com.boostfarm.app.referrer.InstallReferrerHelper
import com.google.android.gms.ads.MobileAds
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    // Set when the activity is (re)opened by tapping a push. Consumed once
    // `onPageFinished` fires so the web layer can report the open to the API.
    private var pendingCampaignId: String? = null
    private var pageLoaded: Boolean = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Android 15 (API 35) forces edge-to-edge, so without inset handling
        // the system navigation bar overlaps the bottom of the WebView and
        // eats interactive UI. We opt-in explicitly here so behaviour is
        // consistent on older devices too, then pad the WebView below.
        WindowCompat.setDecorFitsSystemWindows(window, false)

        requestNotificationPermission()
        MobileAds.initialize(this) {}

        pendingCampaignId = intent?.getStringExtra("campaign_id")

        // Fire-and-forget: grabs the Play Store install referrer on first launch
        // and caches it. Web layer picks it up via the JS bridge during signup.
        InstallReferrerHelper.fetchOnce(applicationContext)

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
                pageLoaded = true
                injectFcmToken()
                dispatchPendingPushOpenedIfAny()
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val cid = intent.getStringExtra("campaign_id")
        if (!cid.isNullOrBlank()) {
            pendingCampaignId = cid
            if (pageLoaded) dispatchPendingPushOpenedIfAny()
        }
    }

    // Fires a CustomEvent on the WebView so the React layer (see useAuth)
    // can POST to /user/push-opened. Only runs after the page reports
    // finished, otherwise the dispatch lands before any listeners attach.
    private fun dispatchPendingPushOpenedIfAny() {
        val cid = pendingCampaignId ?: return
        pendingCampaignId = null
        val escaped = cid.replace("\\", "\\\\").replace("\"", "\\\"")
        val script = """
            (function(){
              try {
                window.dispatchEvent(new CustomEvent('push-opened', { detail: "$escaped" }));
              } catch (e) {}
            })();
        """.trimIndent()
        webView.post { webView.evaluateJavascript(script, null) }
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
