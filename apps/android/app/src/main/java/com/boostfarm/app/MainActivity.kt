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
import com.boostfarm.app.ads.AdEventSink
import com.boostfarm.app.ads.LevelPlayRewardedAds
import com.boostfarm.app.ads.OfferwallPort
import com.boostfarm.app.ads.RewardedAdsPort
import com.boostfarm.app.ads.StubOfferwall
import com.boostfarm.app.ads.StubRewardedAds
import com.boostfarm.app.ads.WebViewAdEventSink
import com.boostfarm.app.bridge.FarmJsBridge
import com.boostfarm.app.referrer.InstallReferrerHelper
import com.google.firebase.messaging.FirebaseMessaging
import com.ironsource.mediationsdk.IronSource

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

        pendingCampaignId = intent?.getStringExtra("campaign_id")

        // Fire-and-forget: grabs the Play Store install referrer on first launch
        // and caches it. Web layer picks it up via the JS bridge during signup.
        InstallReferrerHelper.fetchOnce(applicationContext)

        // WebView is created first so the AdEventSink can bind to it. The
        // sink is how LevelPlayRewardedAds emits funnel events
        // (requested/loaded/shown/rewarded/failed/no_fill/closed) that the
        // product-analytics pipeline (/track) consumes.
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        // Publish the WebView for the AppsFlyer deep-link forwarder
        // living in BoostFarmApplication. Live retargeting opens
        // (user already has the app open, taps a Meta retargeting ad,
        // expected to land on a specific page) need a foreground
        // WebView reference that the Application class doesn't hold
        // by default.
        BoostFarmApplication.currentWebView = webView

        val adEventSink: AdEventSink = WebViewAdEventSink(webView)

        // Unity LevelPlay (ironSource) mediation. The app key is injected via
        // BuildConfig from apps/android/keystore.properties (gitignored). If
        // the key is blank we skip init and wire the Stub adapter below so
        // devs / CI can run without an ads setup.
        //
        // IMPORTANT ORDERING: the rewarded-video listener MUST be registered
        // BEFORE IronSource.init — otherwise the SDK fires its first
        // `onAdAvailable` / `onAdUnavailable` callback before we're
        // subscribed and the app sits thinking no ad is ever loaded (even
        // when demand is actually there). We create `LevelPlayRewardedAds`
        // first (its `init` block installs the global listener) and only
        // then kick off init.
        val lpKey = BuildConfig.LEVELPLAY_APP_KEY
        val rewarded: RewardedAdsPort = if (lpKey.isBlank()) {
            StubRewardedAds()
        } else {
            val adsPort = LevelPlayRewardedAds(this, adEventSink)

            // Auto-retry loads when the device swaps between wifi and
            // mobile — without this a lost network at cold start leaves
            // the SDK in a "no ad available" state for the whole session.
            IronSource.shouldTrackNetworkState(this, true)

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

            // Debug builds only: dumps the LevelPlay integration state into
            // Logcat (network adapters detected, AndroidManifest issues,
            // missing Google Play Services, etc). Filter Logcat for
            // `IronSourceIntegrationHelper` / `IntegrationHelper` to see
            // the report. Never call this in a release build — it's slow
            // and is explicitly documented as "debug only".
            if (BuildConfig.DEBUG) {
                try {
                    com.ironsource.mediationsdk.integration.IntegrationHelper
                        .validateIntegration(this)
                } catch (e: Throwable) {
                    android.util.Log.w("MainActivity", "validateIntegration failed", e)
                }
            }

            adsPort
        }

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

    override fun onDestroy() {
        // Drop the WebView ref we registered for AppsFlyer deep-link
        // forwarding so a subsequent Activity recreation cycle doesn't
        // dispatch into a destroyed view.
        if (BoostFarmApplication.currentWebView === webView) {
            BoostFarmApplication.currentWebView = null
        }
        super.onDestroy()
    }

    // Fires a CustomEvent on the WebView so the React layer (see App.tsx)
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
