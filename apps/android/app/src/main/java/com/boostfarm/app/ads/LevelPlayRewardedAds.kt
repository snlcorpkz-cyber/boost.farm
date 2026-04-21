package com.boostfarm.app.ads

import android.app.Activity
import android.util.Log
import com.ironsource.mediationsdk.IronSource
import com.ironsource.mediationsdk.adunit.adapter.utility.AdInfo
import com.ironsource.mediationsdk.logger.IronSourceError
import com.ironsource.mediationsdk.model.Placement
import com.ironsource.mediationsdk.sdk.LevelPlayRewardedVideoListener

/**
 * Unity LevelPlay (ironSource) implementation of [RewardedAdsPort].
 *
 * The LevelPlay SDK uses a single global listener for rewarded videos and
 * auto-caches the next ad, so we do not manage preloading manually the way
 * the old AdMob adapter did. We serialize access (only one show in flight)
 * because the global listener cannot distinguish between concurrent callers.
 *
 * Placement names passed in from the web layer (water_popup, fert_popup…)
 * must match placements configured in the LevelPlay dashboard.
 */
class LevelPlayRewardedAds(private val activity: Activity) : RewardedAdsPort {

    private var currentCallback: ((Boolean) -> Unit)? = null
    private var rewardedThisSession = false

    init {
        IronSource.setLevelPlayRewardedVideoListener(object : LevelPlayRewardedVideoListener {
            override fun onAdOpened(adInfo: AdInfo?) {
                Log.d(TAG, "onAdOpened")
                rewardedThisSession = false
            }

            override fun onAdClosed(adInfo: AdInfo?) {
                Log.d(TAG, "onAdClosed rewarded=$rewardedThisSession")
                deliver(rewardedThisSession)
            }

            override fun onAdRewarded(placement: Placement?, adInfo: AdInfo?) {
                Log.d(TAG, "onAdRewarded placement=${placement?.placementName}")
                rewardedThisSession = true
            }

            override fun onAdShowFailed(error: IronSourceError?, adInfo: AdInfo?) {
                Log.w(TAG, "onAdShowFailed: ${error?.errorMessage}")
                deliver(false)
            }

            override fun onAdClicked(placement: Placement?, adInfo: AdInfo?) {
                Log.d(TAG, "onAdClicked placement=${placement?.placementName}")
            }

            override fun onAdAvailable(adInfo: AdInfo?) {
                Log.d(TAG, "onAdAvailable")
            }

            override fun onAdUnavailable() {
                Log.d(TAG, "onAdUnavailable")
            }
        })
    }

    override fun showRewarded(placement: String, onFinished: (Boolean) -> Unit) {
        activity.runOnUiThread {
            if (currentCallback != null) {
                Log.w(TAG, "show rejected for $placement — another rewarded in flight")
                onFinished(false)
                return@runOnUiThread
            }
            if (!IronSource.isRewardedVideoAvailable()) {
                Log.w(TAG, "No rewarded video available for $placement")
                onFinished(false)
                return@runOnUiThread
            }
            currentCallback = onFinished
            rewardedThisSession = false
            IronSource.showRewardedVideo(activity, placement)
        }
    }

    private fun deliver(ok: Boolean) {
        val cb = currentCallback
        currentCallback = null
        if (cb != null) {
            activity.runOnUiThread { cb(ok) }
        }
    }

    companion object {
        private const val TAG = "LevelPlayRewarded"
    }
}
