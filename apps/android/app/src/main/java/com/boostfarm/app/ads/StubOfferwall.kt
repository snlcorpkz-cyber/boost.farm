package com.boostfarm.app.ads

import android.util.Log

/** Заглушка до подключения офферволл SDK. */
class StubOfferwall : OfferwallPort {
    override fun showOfferwall(placement: String, onFinished: (Boolean) -> Unit) {
        Log.i(TAG, "showOfferwall(placement=$placement) — stub")
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            onFinished(false)
        }, 200)
    }

    companion object {
        private const val TAG = "StubOfferwall"
    }
}
