package com.boostfarm.app.ads

import android.app.Activity
import android.util.Log
import com.ironsource.mediationsdk.IronSource
import com.ironsource.mediationsdk.adunit.adapter.utility.AdInfo
import com.ironsource.mediationsdk.impressionData.ImpressionData
import com.ironsource.mediationsdk.impressionData.ImpressionDataListener
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

    private var currentCallback: ((Boolean, String?) -> Unit)? = null
    private var rewardedThisSession = false
    private var currentPlacement: String? = null
    // Sticks around between showRewarded() and onAdClosed() so every
    // SDK callback (shown / rewarded / closed / failed) gets stamped
    // with the same attempt_id the web layer generated on click. The
    // admin funnel dedups stages by this id (see /admin/ads/funnel).
    private var currentAttemptId: String? = null
    // ILRD can arrive after onAdClosed (which clears currentPlacement via
    // deliver()), so we keep a separate "last shown" pointer that lives
    // until the next successful show. This is what gets tagged onto the
    // revenue event so it attributes to the right placement.
    @Volatile private var lastShownPlacement: String? = null
    @Volatile private var lastAttemptId: String? = null

    init {
        IronSource.setLevelPlayRewardedVideoListener(object : LevelPlayRewardedVideoListener {
            override fun onAdOpened(adInfo: AdInfo?) {
                Log.d(TAG, "onAdOpened")
                rewardedThisSession = false
                adEventSink.emit(
                    "shown",
                    mapOf(
                        "placement" to currentPlacement,
                        "attempt_id" to currentAttemptId,
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
                        "attempt_id" to currentAttemptId,
                        "rewarded" to rewardedThisSession,
                        "network" to adInfo?.adNetwork,
                    ),
                )
                // `closed_unrewarded` is a deliberate skip by the user — no
                // fallback should be offered (they saw a real ad SDK slot).
                deliver(rewardedThisSession, if (rewardedThisSession) null else "closed_unrewarded")
            }

            override fun onAdRewarded(placement: Placement?, adInfo: AdInfo?) {
                Log.d(TAG, "onAdRewarded placement=${placement?.placementName}")
                rewardedThisSession = true
                adEventSink.emit(
                    "rewarded",
                    mapOf(
                        "placement" to (currentPlacement ?: placement?.placementName),
                        "attempt_id" to currentAttemptId,
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
                        "attempt_id" to currentAttemptId,
                        "error_code" to error?.errorCode,
                        "error_message" to error?.errorMessage,
                        "network" to adInfo?.adNetwork,
                    ),
                )
                // SDK failed mid-show — user has done nothing wrong, let the
                // web layer offer a fallback flow.
                deliver(false, "show_failed")
            }

            override fun onAdClicked(placement: Placement?, adInfo: AdInfo?) {
                Log.d(TAG, "onAdClicked placement=${placement?.placementName}")
            }

            override fun onAdAvailable(adInfo: AdInfo?) {
                Log.d(TAG, "onAdAvailable")
                // `loaded` fires on SDK auto-cache and isn't tied to a user
                // intent, so we deliberately omit attempt_id here — it's a
                // mediation-health signal, not a funnel stage.
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
                // Global (no placement, no user intent) — backend drops it.
                adEventSink.emit(
                    "no_fill",
                    mapOf(
                        "ad_unit" to "rewarded",
                        "reason" to "onAdUnavailable",
                    ),
                )
            }
        })

        // Impression-Level Revenue Data (ILRD) — one callback per filled
        // impression across ALL ad units (rewarded / interstitial / banner).
        // Revenue is reported in USD from ironSource and must be converted
        // to integer cents on the web layer before hitting /api/track. We
        // also pair the impression with the *currently playing* placement
        // (water_popup / fert_popup / bucket_collect / quest) because the
        // SDK's own `placement` field is the ironSource dashboard placement
        // name, not our product placement.
        IronSource.addImpressionDataListener(object : ImpressionDataListener {
            override fun onImpressionSuccess(data: ImpressionData?) {
                if (data == null) return
                Log.d(
                    TAG,
                    "ILRD network=${data.adNetwork} revenue=${data.revenue} precision=${data.precision}",
                )
                adEventSink.emit(
                    "revenue",
                    mapOf(
                        "placement" to (currentPlacement ?: lastShownPlacement),
                        "attempt_id" to (currentAttemptId ?: lastAttemptId),
                        "network" to data.adNetwork,
                        "ad_unit" to data.adUnit,
                        "revenue" to data.revenue,
                        "precision" to data.precision,
                        "country" to data.country,
                        "instance" to data.instanceName,
                        "impression_id" to data.auctionId,
                        "ab" to data.ab,
                        "segment" to data.segmentName,
                        "mediation_placement" to data.placement,
                    ),
                )
            }
        })
    }

    override fun showRewarded(
        placement: String,
        attemptId: String?,
        onFinished: (Boolean, String?) -> Unit,
    ) {
        activity.runOnUiThread {
            // The web layer already emitted its own `ad.requested` with
            // `has_native: true` for this click. Re-emitting here without
            // the marker gives the backend a way to distinguish "real user
            // intent" (web) from "bridge echo" (Android) and keeps the
            // admin funnel honest. We still attach attempt_id so a later
            // `ad.shown` / `ad.rewarded` can correlate even if the web
            // emission was lost to a flaky connection.
            adEventSink.emit(
                "requested",
                mapOf(
                    "placement" to placement,
                    "attempt_id" to attemptId,
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
                        "attempt_id" to attemptId,
                        "error_message" to "concurrent_show",
                    ),
                )
                onFinished(false, "concurrent")
                return@runOnUiThread
            }
            if (!IronSource.isRewardedVideoAvailable()) {
                Log.w(TAG, "No rewarded video available for $placement")
                adEventSink.emit(
                    "no_fill",
                    mapOf(
                        "placement" to placement,
                        "attempt_id" to attemptId,
                        "reason" to "isRewardedVideoAvailable_false",
                    ),
                )
                // Ads not ready (SDK still initialising, no demand, ironSource
                // account under review, offline, etc.) — signal the web layer
                // so it can offer a fallback flow instead of blocking users.
                onFinished(false, "unavailable")
                return@runOnUiThread
            }
            currentCallback = onFinished
            currentPlacement = placement
            currentAttemptId = attemptId
            lastShownPlacement = placement
            lastAttemptId = attemptId
            rewardedThisSession = false
            IronSource.showRewardedVideo(activity, placement)
        }
    }

    private fun deliver(ok: Boolean, reason: String?) {
        val cb = currentCallback
        currentCallback = null
        currentPlacement = null
        currentAttemptId = null
        if (cb != null) {
            activity.runOnUiThread { cb(ok, reason) }
        }
    }

    companion object {
        private const val TAG = "LevelPlayRewarded"
    }
}
