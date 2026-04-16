-- ════════════════════════════════════════════════════════════════
-- 016: Analytics infrastructure + Push campaigns + Admin extensions
-- ════════════════════════════════════════════════════════════════

-- 1. Events log
CREATE TABLE IF NOT EXISTS events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}',
  device     jsonb NOT NULL DEFAULT '{}',
  geo        jsonb NOT NULL DEFAULT '{}',
  session_id text,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_name ON events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_date ON events ((created_at::date));

-- 2. Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id           text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  duration_sec int,
  device       jsonb NOT NULL DEFAULT '{}',
  geo          jsonb NOT NULL DEFAULT '{}',
  ip           inet,
  events_count int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, started_at DESC);

-- 3. Aggregated daily stats (filled by cron)
CREATE TABLE IF NOT EXISTS daily_stats (
  stat_date  date NOT NULL,
  metric     text NOT NULL,
  dimension  text NOT NULL DEFAULT 'all',
  value      float NOT NULL DEFAULT 0,
  PRIMARY KEY (stat_date, metric, dimension)
);

-- 4. Cohort retention cache (filled by cron)
CREATE TABLE IF NOT EXISTS cohort_cache (
  cohort_date date NOT NULL,
  day_offset  int NOT NULL,
  dimension   text NOT NULL DEFAULT 'all',
  cohort_size int NOT NULL DEFAULT 0,
  retained    int NOT NULL DEFAULT 0,
  PRIMARY KEY (cohort_date, day_offset, dimension)
);

-- 5. Push campaigns
CREATE TABLE IF NOT EXISTS push_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  body             text NOT NULL,
  data             jsonb NOT NULL DEFAULT '{}',
  target_type      text NOT NULL DEFAULT 'all',
  target_filter    jsonb NOT NULL DEFAULT '{}',
  target_user_ids  uuid[],
  status           text NOT NULL DEFAULT 'draft',
  total_recipients int NOT NULL DEFAULT 0,
  delivered        int NOT NULL DEFAULT 0,
  opened           int NOT NULL DEFAULT 0,
  failed           int NOT NULL DEFAULT 0,
  scheduled_at     timestamptz,
  sent_at          timestamptz,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_campaign_recipients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES push_campaigns(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text NOT NULL,
  status      text NOT NULL DEFAULT 'pending',
  error       text,
  sent_at     timestamptz,
  opened_at   timestamptz,
  UNIQUE (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pcr_campaign ON push_campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_pcr_user ON push_campaign_recipients (user_id);

-- 6. Extend users with analytics fields
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_source text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_source text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_medium text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_campaign text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS country text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS device_platform text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 7. Extend offers for admin management
DO $$ BEGIN
  ALTER TABLE offers ADD COLUMN IF NOT EXISTS store_url text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE offers ADD COLUMN IF NOT EXISTS payout_cents int DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
