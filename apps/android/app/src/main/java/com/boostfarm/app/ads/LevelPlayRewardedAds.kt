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
 *
 * This class also forwards granular ad-funnel events to the web layer via
 * [AdEventSink] so the product analytics pipeline can track the full funnel
 * (requested → loaded/no_fill → shown → rewarded/failed/closed).
 */
class LevelPlayRewardedAds(
    private val activity: Activity,
    private val adEventSink: AdEventSink = AdEventSink.noop(),
) : RewardedAdsPort {

    private var currentCallback: ((Boolean) -> Unit)? = null
    private var rewardedThisSession = false
    private var currentPlacement: String? = null

    init {
        IronSource.setLevelPlayRewardedVideoListener(object : LevelPlayRewardedVideoListener {
            override fun onAdOpened(adInfo: AdInfo?) {
                Log.d(TAG, "onAdOpened")
                rewardedThisSession = false
                adEventSink.emit(
                    "shown",
                    mapOf(
                        "placement" to currentPlacement,
                        "network" to adInfo?.adNetwork,
                        "ad_unit" to "rewarded",
                    ),
                )
            }

            override fun onAdClosed(adInfo: AdInfo?) {
                Log.d(TAG, "onAdClosed rewarded=$rewardedThisSession")
                adEventSink.emit(
                    "closed",
                    mapOf(
                        "placement" to currentPlacement,
                        "rewarded" to rewardedThisSession,
                        "network" to adInfo?.adNetwork,
                    ),
                )
                deliver(rewardedThisSession)
            }

            override fun onAdRewarded(placement: Placement?, adInfo: AdInfo?) {
                Log.d(TAG, "onAdRewarded placement=${placement?.placementName}")
                rewardedThisSession = true
                adEventSink.emit(
                    "rewarded",
                    mapOf(
                        "placement" to (currentPlacement ?: placement?.placementName),
                        "reward_name" to placement?.rewardName,
                        "reward_amount" to placement?.rewardAmount,
                        "network" to adInfo?.adNetwork,
                    ),
                )
            }

            override fun onAdShowFailed(error: IronSourceError?, adInfo: AdInfo?) {
                Log.w(TAG, "onAdShowFailed: ${error?.errorMessage}")
                adEventSink.emit(
                    "failed",
                    mapOf(
                        "placement" to currentPlacement,
                        "error_code" to error?.errorCode,
                        "error_message" to error?.errorMessage,
                        "network" to adInfo?.adNetwork,
                    ),
                )
                deliver(false)
            }

            override fun onAdClicked(placement: Placement?, adInfo: AdInfo?) {
                Log.d(TAG, "onAdClicked placement=${placement?.placementName}")
            }

            override fun onAdAvailable(adInfo: AdInfo?) {
                Log.d(TAG, "onAdAvailable")
                adEventSink.emit(
                    "loaded",
                    mapOf(
                        "network" to adInfo?.adNetwork,
                        "ad_unit" to "rewarded",
                    ),
                )
            }

            override fun onAdUnavailable() {
                Log.d(TAG, "onAdUnavailable")
                adEventSink.emit(
                    "no_fill",
                    mapOf(
                        "ad_unit" to "rewarded",
                        "reason" to "onAdUnavailable",
                    ),
                )
            }
        })
    }

    override fun showRewarded(placement: String, onFinished: (Boolean) -> Unit) {
        activity.runOnUiThread {
            adEventSink.emit(
                "requested",
                mapOf(
                    "placement" to placement,
                    "ad_unit" to "rewarded",
                    "platform" to "android",
                ),
            )
            if (currentCallback != null) {
                Log.w(TAG, "show rejected for $placement — another rewarded in flight")
                adEventSink.emit(
                    "failed",
                    mapOf(
                        "placement" to placement,
                        "error_message" to "concurrent_show",
                    ),
                )
                onFinished(false)
                return@runOnUiThread
            }
            if (!IronSource.isRewardedVideoAvailable()) {
                Log.w(TAG, "No rewarded video available for $placement")
                adEventSink.emit(
                    "no_fill",
                    mapOf(
                        "placement" to placement,
                        "reason" to "isRewardedVideoAvailable_false",
                    ),
                )
                onFinished(false)
                return@runOnUiThread
            }
            currentCallback = onFinished
            currentPlacement = placement
            rewardedThisSession = false
            IronSource.showRewardedVideo(activity, placement)
        }
    }

    private fun deliver(ok: Boolean) {
        val cb = currentCallback
        currentCallback = null
        currentPlacement = null
        if (cb != null) {
            activity.runOnUiThread { cb(ok) }
        }
    }

    companion object {
        private const val TAG = "LevelPlayRewarded"
    }
}
