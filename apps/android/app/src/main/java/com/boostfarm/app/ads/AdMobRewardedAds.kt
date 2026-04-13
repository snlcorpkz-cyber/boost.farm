package com.boostfarm.app.ads

import android.app.Activity
import android.util.Log
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.boostfarm.app.BuildConfig

class AdMobRewardedAds(private val activity: Activity) : RewardedAdsPort {

    private val adUnits = mapOf(
        "water_popup" to BuildConfig.ADMOB_REWARDED_WATER,
        "fert_popup" to BuildConfig.ADMOB_REWARDED_FERT,
    )

    private val loadedAds = mutableMapOf<String, RewardedAd?>()
    private val loading = mutableSetOf<String>()

    init {
        adUnits.keys.forEach { preload(it) }
    }

    private fun adUnitId(placement: String): String =
        adUnits[placement] ?: adUnits.values.first()

    private fun preload(placement: String) {
        if (loading.contains(placement)) return
        loading.add(placement)

        val request = AdRequest.Builder().build()
        RewardedAd.load(activity, adUnitId(placement), request, object : RewardedAdLoadCallback() {
            override fun onAdLoaded(ad: RewardedAd) {
                loadedAds[placement] = ad
                loading.remove(placement)
                Log.d(TAG, "Ad preloaded for $placement")
            }

            override fun onAdFailedToLoad(err: LoadAdError) {
                loadedAds[placement] = null
                loading.remove(placement)
                Log.w(TAG, "Ad failed to preload for $placement: ${err.message}")
            }
        })
    }

    override fun showRewarded(placement: String, onFinished: (Boolean) -> Unit) {
        val ad = loadedAds[placement]
        if (ad == null) {
            Log.w(TAG, "No ad ready for $placement, reloading…")
            preload(placement)
            onFinished(false)
            return
        }

        loadedAds[placement] = null
        var rewarded = false

        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                onFinished(rewarded)
                preload(placement)
            }

            override fun onAdFailedToShowFullScreenContent(err: AdError) {
                Log.w(TAG, "Ad failed to show: ${err.message}")
                onFinished(false)
                preload(placement)
            }
        }

        ad.show(activity) { rewarded = true }
    }

    companion object {
        private const val TAG = "AdMobRewarded"
    }
}
