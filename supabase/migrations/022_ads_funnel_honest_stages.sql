-- ════════════════════════════════════════════════════════════════
-- 022: Honest rewarded-ad funnel stages + attempt_id
--
-- The `ad_funnel_daily` table from migration 020 merged SDK and
-- fallback impressions under a single `shown` column and trusted
-- client-side `ad.rewarded` as the payout metric. Both caused the
-- admin panel to show fractional inflation (shown > requested,
-- rewarded > shown). This migration:
--
--   1. Adds explicit columns for the new stages so the rollup cron
--      can persist them without further schema changes. Legacy
--      `requested` / `shown` / `rewarded` columns are kept for
--      backwards compatibility with older deploys reading the
--      table — the cron fills both old and new columns.
--
--   2. Adds a GIN index on `events.properties` so the cross-stage
--      deduplication by `attempt_id` (the new request-level
--      correlation id the client stamps into every ad.* event)
--      stays fast even when the events table hits millions of rows.
--
-- All changes are additive and safe to apply on an existing prod DB.
-- ════════════════════════════════════════════════════════════════

-- ── 1. New funnel stage columns ──────────────────────────────────
-- `attempts`       — user intent, deduped by properties.has_native.
-- `sdk_impressions`— real ironSource impressions (ad.shown).
-- `mock_impressions`— fallback mock-ad modal (ad.fallback_shown).
-- `completions`    — client-side ad.rewarded (same as legacy `rewarded`).
-- `rewards_paid`   — server-authoritative ad.server_granted.
-- `sdk_errors`     — ad.failed.
DO $$ BEGIN
  ALTER TABLE ad_funnel_daily ADD COLUMN IF NOT EXISTS attempts         int NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ad_funnel_daily ADD COLUMN IF NOT EXISTS sdk_impressions  int NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ad_funnel_daily ADD COLUMN IF NOT EXISTS mock_impressions int NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ad_funnel_daily ADD COLUMN IF NOT EXISTS completions     int NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ad_funnel_daily ADD COLUMN IF NOT EXISTS rewards_paid    int NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ad_funnel_daily ADD COLUMN IF NOT EXISTS sdk_errors      int NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── 2. Index for attempt_id deduplication ────────────────────────
-- The /admin/ads/funnel endpoint is switching from `count(*)` to
-- `count(DISTINCT properties->>'attempt_id')` to make each stage
-- per-user-intent. Without an expression index this would force a
-- full scan of every ad.* event in the window.
CREATE INDEX IF NOT EXISTS idx_events_attempt_id
  ON events ((properties->>'attempt_id'))
  WHERE event_name LIKE 'ad.%' AND properties ? 'attempt_id';
