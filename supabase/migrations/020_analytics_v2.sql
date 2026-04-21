-- ════════════════════════════════════════════════════════════════
-- 020: Analytics v2 — product analytics foundation
--
-- Adds typed first-class columns to `events` so we can filter without
-- JSON extraction, a pre-aggregated `ad_funnel_daily` rollup for fast
-- dashboard queries, and a future-ready `ad_network_daily` marshalling
-- table for LevelPlay Reporting API imports. All changes are additive
-- and safe to apply on an existing production DB.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Extend `events` with top-level columns ────────────────────
DO $$ BEGIN
  ALTER TABLE events ADD COLUMN IF NOT EXISTS platform text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE events ADD COLUMN IF NOT EXISTS app_version text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE events ADD COLUMN IF NOT EXISTS placement text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE events ADD COLUMN IF NOT EXISTS revenue_cents int;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_source text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_medium text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_campaign text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Indexes that accelerate dashboard queries. `idx_events_name`/`idx_events_user`
-- already exist from 016 — we only add the new ones.
CREATE INDEX IF NOT EXISTS idx_events_placement
  ON events (placement, created_at DESC)
  WHERE placement IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_platform
  ON events (platform, created_at DESC)
  WHERE platform IS NOT NULL;

-- ── 2. Ad funnel daily rollup ────────────────────────────────────
-- One row per (date, platform, placement, ad_unit). Filled by
-- `aggregateAdFunnel` cron. Counts are monotonically derived from
-- the `events` table so a re-run is idempotent.
CREATE TABLE IF NOT EXISTS ad_funnel_daily (
  stat_date     date NOT NULL,
  platform      text NOT NULL,            -- android | web | unknown
  placement     text NOT NULL,            -- water_popup | fert_popup | bucket_collect | quest | unknown
  ad_unit       text NOT NULL DEFAULT 'rewarded',
  requested     int NOT NULL DEFAULT 0,
  loaded        int NOT NULL DEFAULT 0,
  no_fill       int NOT NULL DEFAULT 0,
  shown         int NOT NULL DEFAULT 0,
  rewarded      int NOT NULL DEFAULT 0,
  failed        int NOT NULL DEFAULT 0,
  closed        int NOT NULL DEFAULT 0,
  unique_users  int NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stat_date, platform, placement, ad_unit)
);
CREATE INDEX IF NOT EXISTS idx_ad_funnel_date ON ad_funnel_daily (stat_date DESC);

-- ── 3. Per-network revenue table (Phase 3, LevelPlay Reporting API) ──
-- Intentionally empty in Phase 1. Populated later by a server-side
-- fetcher once LevelPlay API credentials are provisioned.
CREATE TABLE IF NOT EXISTS ad_network_daily (
  stat_date      date NOT NULL,
  network        text NOT NULL,           -- ironsource | admob | applovin | meta | unity | pangle | mintegral
  ad_unit        text NOT NULL DEFAULT 'rewarded',
  country        text NOT NULL DEFAULT '',
  impressions    int NOT NULL DEFAULT 0,
  revenue_cents  int NOT NULL DEFAULT 0,
  requests       int NOT NULL DEFAULT 0,
  fill_rate      numeric(5,2),
  ecpm_cents     int,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stat_date, network, ad_unit, country)
);
CREATE INDEX IF NOT EXISTS idx_ad_network_date ON ad_network_daily (stat_date DESC);
