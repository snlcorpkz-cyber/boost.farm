# Boost Farm — Android (WebView + заглушки рекламы)

Оболочка **WebView** вокруг веб-игры + слой для будущей интеграции:

- **Rewarded video** — вода / удобрение за просмотр (как в `WaterPopup` / `FertilizerPopup` → позже вызывать нативный SDK из JS-моста).
- **Offerwall** — награды за квесты/игры (отдельный партнёр; тот же мост или второй интерфейс).

Сейчас в коде только **контракты + заглушки** (`StubRewardedAds`, `StubOfferwall`): логируют вызовы в Logcat. После выбора партнёра (AdMob, AppLovin MAX, IronSource и т.д.) реализуйте `RewardedAdsPort` / `OfferwallPort` и дергайте колбэки в WebView через `evaluateJavascript`.

## JS-мост (для фронта позже)

Имя объекта в `window`: **`EcoFarmAndroid`**

Планируемые методы (можно расширить под ваш контракт):

- `requestRewardedAd(placementJson)` — `placement` описывает слот: вода из модалки, удобрение, и т.д.
- `requestOfferwall(placementJson)` — квесты/игры.

Заглушки сейчас не вызываются из веба — сначала добавьте вызовы в `apps/web`, затем реализацию SDK в Kotlin.

## URL веб-приложения

По умолчанию в `app/build.gradle.kts`: `BuildConfig.WEB_APP_URL` = продакшен URL. Для отладки смените `buildConfigField` или добавьте `productFlavors` с `http://10.0.2.2:5173/` (эмулятор → хост).

## Сборка

Откройте папку `apps/android` в **Android Studio** (Hedgehog+), дождитесь Gradle Sync, Run на устройстве/эмуляторе.

Если нет `gradle/wrapper/gradle-wrapper.jar`, в Studio: *File → Settings → Build → Gradle* — используйте встроенный wrapper или выполните `gradle wrapper` локально.

## Разрешения

В манифесте: `INTERNET`. При HTTP на отладке может понадобиться `android:usesCleartextTraffic="true"` в application (не для продакшена).
