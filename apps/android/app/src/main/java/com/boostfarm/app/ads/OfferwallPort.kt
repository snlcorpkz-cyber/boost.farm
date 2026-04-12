package com.boostfarm.app.ads

/**
 * Офферволл для наград за квесты / мини-игры (отдельный партнёр).
 */
fun interface OfferwallPort {
    /**
     * @param placement например quest_water, game_fertilizer
     * @param onFinished true если пользователь закрыл офферволл с засчитанным действием (зависит от SDK)
     */
    fun showOfferwall(placement: String, onFinished: (Boolean) -> Unit)
}
