package com.boostfarm.app.ads

/**
 * Rewarded video (вода / удобрение в модалках «реклама»).
 * Реализация: SDK партнёра (AdMob rewarded, MAX, IronSource…).
 */
fun interface RewardedAdsPort {
    /**
     * @param placement логический слот: например water_popup, fert_popup
     * @param onFinished вызывается на главном потоке: true = пользователь досмотрел и можно начислить награду
     */
    fun showRewarded(placement: String, onFinished: (Boolean) -> Unit)
}
