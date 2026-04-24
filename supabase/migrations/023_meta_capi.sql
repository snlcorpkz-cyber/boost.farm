-- ════════════════════════════════════════════════════════════════
-- 023: Meta Conversions API plumbing
--
-- Three changes, all additive and safe to re-run:
--
--   1. `events.meta_capi_sent_at` — dispatch marker for the CAPI
--      worker. Null means "not yet processed". When the worker
--      successfully POSTs an event to Meta, it stamps this column
--      with now(). Combined with the partial index below this gives
--      the worker a cheap O(unsent) sweep regardless of how big
--      the `events` table gets.
--
--   2. `fb_capi_errors` — deadletter table for 4xx rejections from
--      Meta. We intentionally DO NOT retry 4xx (bad payload shape /
--      revoked token / rate-limit — all permanent for that event),
--      so the worker writes them here and ops can inspect +
--      hand-replay. 5xx and network errors stay in the unsent queue
--      (meta_capi_sent_at IS NULL) and retry naturally on the next
--      tick.
--
--   3. `users.acquisition_source` — JSONB bag populated from the
--      extended Install Referrer parser (apps/android/.../
--      InstallReferrerHelper.kt). Holds fb_ad_id / fb_adset_id /
--      fb_campaign_id plus any future attribution keys without
--      needing another migration each time Meta adds a macro.
--
-- Apply after migration 022.
-- ════════════════════════════════════════════════════════════════

-- 1) events.meta_capi_sent_at ---------------------------------------
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS meta_capi_sent_at timestamptz;

-- Partial index so the worker's "unsent + dispatchable" scan stays
-- fast. We only index rows where the column is NULL; the moment
-- the worker marks an event sent it drops out of the index, which
-- keeps the index compact (~ one week of unsent events max).
CREATE INDEX IF NOT EXISTS events_meta_capi_unsent_idx
  ON events (created_at)
  WHERE meta_capi_sent_at IS NULL;

COMMENT ON COLUMN events.meta_capi_sent_at IS
  'Set by the Meta CAPI worker (packages/api/src/workers/capiWorker.ts) once the event was POSTed successfully to Meta. NULL means not yet dispatched (either the event is out of scope for CAPI, or the worker hasn''t reached it yet). Paired with events_meta_capi_unsent_idx for cheap sweeps.';


-- 2) fb_capi_errors -------------------------------------------------
CREATE TABLE IF NOT EXISTS fb_capi_errors (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_name       text        NOT NULL,
  meta_event_name  text        NOT NULL,
  status_code      int,
  reason           text        NOT NULL,
  payload          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fb_capi_errors_created_idx
  ON fb_capi_errors (created_at DESC);

CREATE INDEX IF NOT EXISTS fb_capi_errors_event_idx
  ON fb_capi_errors (event_id);

COMMENT ON TABLE fb_capi_errors IS
  'Deadletter log for Meta CAPI 4xx rejections. Rows here are NOT re-attempted by the worker — they represent permanent failures (bad payload, revoked token, unknown event). Inspect via Admin → Analytics → Meta CAPI errors, or psql.';


-- 3) users.acquisition_source --------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS acquisition_source jsonb;

COMMENT ON COLUMN users.acquisition_source IS
  'JSONB bag with campaign attribution fields captured from the Play Install Referrer at signup time. Expected keys (camelCase to match the InstallReferrerHelper snapshot): utmSource, utmMedium, utmCampaign, utmContent, fbCampaignId, fbAdsetId, fbAdId. New keys can be added without schema changes. NULL for organic installs.';

-- Partial index for admin acquisition reports that filter by FB ad id
-- (campaign breakdown views). Only indexes non-null acquisition_source
-- rows to keep it small.
--
-- Key is `fbAdId` (camelCase) because that's what
-- routes/auth.ts::saveAcquisitionSource writes — it mirrors the
-- InstallReferrerHelper snapshot shape so the whole pipeline
-- stays in one casing. Any future admin query that filters by
-- Meta ad id MUST use `acquisition_source->>'fbAdId'` too, otherwise
-- the planner falls back to a JSONB scan.
CREATE INDEX IF NOT EXISTS users_acquisition_source_fb_ad_id_idx
  ON users ((acquisition_source->>'fbAdId'))
  WHERE acquisition_source IS NOT NULL;
