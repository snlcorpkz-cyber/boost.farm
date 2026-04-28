# AppsFlyer dashboard — event configuration checklist for 0.5.0+

После раскатки 0.5.0 в Play Store клиент и сервер начнут эмиттить
расширенный набор событий. Чтобы они **долетели до Meta** (и были
полезны агентству для оптимизации) — нужна одноразовая настройка
в AppsFlyer dashboard.

## Шаг 1. Зарегистрировать кастомные события

AppsFlyer dashboard → **App Settings → Custom Event Definitions**.

Кастомные события (которых нет в списке предопределённых AF):

| Internal event name | AppsFlyer event name | Что значит |
|---|---|---|
| `farm.first_water` | `af_first_water` | Первый полив (отсекает ботов "тапнул-закрыл") |
| `farm.bucket_collected` | `af_bucket_collected` | Сбор ведра — recurring engagement сигнал |
| `farm.stage_reached` (stage=2) | `af_stage_2_reached` | Дошёл до стадии 2 |
| `farm.stage_reached` (stage=3) | `af_stage_3_reached` | Дошёл до стадии 3 |
| `farm.stage_reached` (stage=4) | `af_stage_4_reached` | Дошёл до стадии 4 |
| `farm.stage_reached` (stage=5) | `af_stage_5_reached` | Дошёл до стадии 5 |
| `farm.stage_reached` (stage=6) | `af_stage_6_reached` | Дошёл до стадии 6 (urna harvest) |
| `farm.harvested` | `af_harvest_completed` | Урожай собран |
| `farm.harvest_x3` | `af_harvest_x3` | Loyalty milestone — 3+ урожая |
| `retention.d1_return` | `af_d1_return` | Вернулся через 24 часа |
| `retention.d3_return` | `af_d3_return` | Вернулся через 72 часа |
| `retention.d7_return` | `af_d7_return` | Вернулся через 7 дней |
| `EngagedD0` | `af_engaged_d0` | Quality install (register + water + ad в первый день) |
| `econ.offer_completed` | `af_offer_completed` | Партнёрская оферка |
| `econ.purchase` | `af_purchase` | IAP (когда подключим) |
| `marketing.deep_link_received` | (не в AF — клиентский tracker) | OneLink deep link отработал |

Предопределённые AF события (НЕ требуют регистрации, работают из коробки):
- `af_complete_registration`
- `af_tutorial_completion`
- `af_level_achieved`
- `af_invite`
- `af_purchase`

## Шаг 2. Включить postback в Facebook integration

AppsFlyer dashboard → **Integrated Partners → Facebook → Configuration**.

В разделе **In-App Events** включить чекбоксы рядом с каждым из событий выше. Если событие не включено — оно остаётся только в AF dashboard и **до Meta не доезжает**.

Минимальный набор для запуска первой кампании:
- `af_complete_registration`
- `af_tutorial_completion`
- `af_engaged_d0`
- `af_purchase` (на будущее)

Расширенный набор для агентства (после Шага 1):
- Всё из минимального + `af_stage_2_reached`..`af_stage_6_reached`
- `af_harvest_completed`
- `af_harvest_x3`
- `af_d1_return`, `af_d3_return`, `af_d7_return`

## Шаг 3. Map в Meta Events Manager

После того как событие реально прилетит хотя бы один раз через AF в Meta:

Meta Business Manager → **Events Manager** → BoostFarmNew dataset → **События**.

Новые события появятся в списке как "не сопоставлено" / "не подтверждено". Нужно нажать на каждое и:
1. Подтвердить semantic mapping (Meta предложит — почти всегда правильно).
2. Активировать как **Conversion Event** если хочешь использовать для оптимизации кампаний.

После активации событие можно выбирать как **Optimization event** в Ads Manager при создании adset'а.

## Шаг 4. Активировать кастомные события в Meta для VBA / VO

Если планируешь Value Optimization (например агентство хочет оптимизировать на harvest_x3 как proxy для LTV):

Meta Events Manager → событие → **Custom Conversions** → создать. Указать `event = af_harvest_x3`. Это даст агентству conversion ID, который они смогут выбирать в Ads Manager как `Optimize for: Custom conversion → harvest_x3`.

## Шаг 5. Включить S2S worker (опционально, для не-Android юзеров)

Если у тебя есть Telegram-юзеры или веб-юзеры (не через Android), их события **никогда** не пройдут через мобильный SDK. Server-side dispatch — единственный способ донести их до Meta.

В `.env` на проде:

```bash
APPSFLYER_S2S_ENABLED=true
APPSFLYER_S2S_DEV_KEY=bJovpQFtkXdkS7pRivekVM
APPSFLYER_APP_ID=idio.boostfarm.app
APPSFLYER_S2S_EVENT_NAMES=retention.d1_return,retention.d3_return,retention.d7_return,econ.offer_completed
```

⚠️ **НЕ добавляй сюда** события которые уже фаерятся клиентским SDK (`auth.register`, `onboarding.tutorial_finished`, `EngagedD0`, `farm.*_reached`, `farm.harvested`). AppsFlyer дедуплицирует по 30-минутному окну, но client/server clock drift иногда производит дубли.

Безопасные кандидаты для S2S (события которые SDK не фаерит):
- `retention.d1_return` / `retention.d3_return` / `retention.d7_return` — fired by `analytics-rollup` cron
- `econ.offer_completed` — fired by Everflow postback (приложение в фоне)
- `econ.purchase` — fired by IAP webhook (когда будет)

После рестарта API → `setInterval` начнёт каждые 30 секунд проверять unsent events и отправлять.

## Шаг 6. Verify

Через 1-2 часа после запуска кампании:

1. AppsFlyer dashboard → **Activity → Live Events** — должны быть события с метками `media_source = facebook`.
2. Meta Events Manager → BoostFarmNew → **Тестирование событий** — должны быть real-time события.
3. AppsFlyer dashboard → **Activity → Real-time Reports** → Filter by event name → проверить что выбранные события реально поступают.

Если в AF событие приходит, а в Meta — нет → не настроен postback в Шаге 2.
Если в AF не приходит → событие не зарегистрировано в Шаге 1, или клиент не доехал до этой стадии.

## Шаг 7. SQL диагностика (опциональная)

⚠️ **PREREQUISITE**: для этих запросов колонка `users.acquisition_source` должна существовать. Она добавляется миграцией `023_meta_capi.sql` — если её ещё не применил, сначала выполни:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_source jsonb;
```

(или применить полный файл `supabase/migrations/023_meta_capi.sql` через Supabase SQL Editor.)

Когда колонка существует:

```sql
-- Сколько юзеров пришли через Android (с AF tracked) vs остальные каналы
-- Используем JSONB-оператор `?` который безопасно работает с NULL
SELECT
  CASE
    WHEN acquisition_source IS NULL                         THEN 'Untracked (no referrer)'
    WHEN acquisition_source ? 'afAppsflyerId'               THEN 'Android (AF tracked)'
    WHEN acquisition_source ? 'fbCampaignId'                THEN 'Web (FB referrer)'
    ELSE                                                          'Other'
  END AS source_type,
  COUNT(*) AS users
FROM users
WHERE created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY users DESC;

-- Распределение media_source среди Android-юзеров
SELECT
  acquisition_source->>'afMediaSource' AS media_source,
  COUNT(*)                              AS users
FROM users
WHERE created_at > now() - interval '7 days'
  AND acquisition_source IS NOT NULL
  AND acquisition_source ? 'afAppsflyerId'
GROUP BY 1
ORDER BY users DESC;

-- Funnel attribution per AppsFlyer media_source: install → register → tutorial → harvest
SELECT
  acquisition_source->>'afMediaSource' AS media_source,
  COUNT(*)                              AS installs,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM events e WHERE e.user_id = u.id AND e.event_name = 'auth.register'
  )) AS registered,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM events e WHERE e.user_id = u.id AND e.event_name = 'onboarding.tutorial_finished'
  )) AS tutorial,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM events e WHERE e.user_id = u.id AND e.event_name = 'farm.harvested'
  )) AS harvested
FROM users u
WHERE created_at > now() - interval '14 days'
  AND acquisition_source IS NOT NULL
  AND acquisition_source ? 'afAppsflyerId'
GROUP BY 1
ORDER BY installs DESC;
```

## TL;DR

1. Зарегистрировать кастомные события в AF (Шаг 1).
2. Включить postback в Facebook integration (Шаг 2).
3. Подождать 1-2 часа, проверить в Meta что события прилетели.
4. Активировать как Conversion Event в Meta Events Manager (Шаг 3).
5. (опционально) Включить S2S worker для retention событий (Шаг 5).
6. Запустить кампанию с одним из новых событий как Optimization event.
