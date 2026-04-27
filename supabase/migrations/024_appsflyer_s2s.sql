-- ════════════════════════════════════════════════════════════════
-- 024: AppsFlyer Server-to-Server (S2S) event dispatcher
--
-- AppsFlyer is the SDK we ship in the Android app — it logs events
-- client-side and routes them to all connected partners (Meta /
-- Google / TikTok / Unity / ironSource). The S2S API is the
-- redundant server-side channel: same destination, same partner
-- routing, but we POST events from our backend instead of the
-- mobile SDK.
--
-- Why we need both:
--   • SDK fails sometimes — backgrounded process killed, no network,
--     OS battery saver, user cleared app data mid-session. Without
--     S2S those events disappear forever.
--   • Some events ONLY exist server-side: Everflow offer-completed
--     postbacks credit users while the app is in background, so
--     the SDK can't fire af_offer_completed at all.
--   • Future iOS path: SKAdNetwork postbacks land on our server too
--     and we'll forward them via S2S.
--
-- Worker safety:
--   • Off-by-default. Enabled per-event via APPSFLYER_S2S_EVENT_NAMES
--     (comma-separated allow-list) so we can roll out one event at
--     a time and verify the AF dashboard before adding the next.
--   • Idempotent: marks events with af_s2s_sent_at = now() the
--     instant the POST succeeds. Re-runs scan only unsent rows.
--   • De-duplication: AppsFlyer dedupes by (app_id, customer_user_id,
--     event_name, event_time) within a 30-minute window — our worker
--     respects that window naturally because it stamps eventTime
--     from events.created_at, not now().
--
-- Apply after migration 023.
-- ════════════════════════════════════════════════════════════════

-- 1) events.af_s2s_sent_at -----------------------------------------
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS af_s2s_sent_at timestamptz;

-- Partial index — same shape as events_meta_capi_unsent_idx — so the
-- worker's "unsent + dispatchable" sweep stays O(unsent) regardless
-- of total events table size.
CREATE INDEX IF NOT EXISTS events_af_s2s_unsent_idx
  ON events (created_at)
  WHERE af_s2s_sent_at IS NULL;

COMMENT ON COLUMN events.af_s2s_sent_at IS
  'Set by the AppsFlyer S2S worker (packages/api/src/workers/appsflyerS2SWorker.ts) once the event was POSTed successfully to api3.appsflyer.com. NULL means not yet dispatched. Paired with events_af_s2s_unsent_idx for cheap sweeps.';


-- 2) af_s2s_errors --------------------------------------------------
-- Deadletter log mirroring fb_capi_errors. 4xx responses from
-- AppsFlyer (bad dev key, missing customer_user_id, malformed event)
-- are permanent for that event, so we record them here and stamp
-- af_s2s_sent_at to drop the row out of the queue.
CREATE TABLE IF NOT EXISTS af_s2s_errors (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_name    text        NOT NULL,
  af_event_name text        NOT NULL,
  status_code   int,
  reason        text        NOT NULL,
  payload       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS af_s2s_errors_created_idx
  ON af_s2s_errors (created_at DESC);

CREATE INDEX IF NOT EXISTS af_s2s_errors_event_idx
  ON af_s2s_errors (event_id);

COMMENT ON TABLE af_s2s_errors IS
  'Deadletter log for AppsFlyer S2S 4xx rejections. NOT re-attempted by the worker. Inspect via psql or admin tools when the AF dashboard shows missing events for a campaign that should have produced them.';
