package com.boostfarm.app.ads

/**
 * Rewarded video (вода / удобрение в модалках «реклама»).
 * Реализация: SDK партнёра (AdMob rewarded, MAX, IronSource…).
 */
fun interface RewardedAdsPort {
    /**
     * @param placement логический слот: например water_popup, fert_popup
     * @param onFinished вызывается на главном потоке. Первый параметр:
     *   true  = пользователь досмотрел и можно начислить награду;
     *   false = награду давать не нужно (см. [reason]).
     *   Второй параметр [reason] уточняет причину для web-слоя:
     *     - "unavailable"       — SDK не имел валидного fill (аккаунт рекламы
     *                             ещё не активирован / нет сети / no_fill).
     *     - "show_failed"       — SDK пытался показать, но упал на стадии show.
     *     - "closed_unrewarded" — пользователь закрыл рекламу до того, как
     *                             сработал reward-событие (намеренно пропустил).
     *     - "concurrent"        — уже показывается другой rewarded в этом же
     *                             процессе — запрос отклонён без фолбека.
     *     - null                — success=true (ok).
     */
    fun showRewarded(placement: String, onFinished: (Boolean, String?) -> Unit)
}
