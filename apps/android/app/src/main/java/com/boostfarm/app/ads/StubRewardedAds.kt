package com.boostfarm.app.ads

import android.util.Log

/** Заглушка до подключения рекламного SDK. */
class StubRewardedAds : RewardedAdsPort {
    override fun showRewarded(placement: String, onFinished: (Boolean) -> Unit) {
        Log.i(TAG, "showRewarded(placement=$placement) — stub, имитируем успех через 300ms")
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            onFinished(true)
        }, 300)
    }

    companion object {
        private const val TAG = "StubRewardedAds"
    }
}
