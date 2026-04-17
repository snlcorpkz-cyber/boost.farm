-- ════════════════════════════════════════════════════════════════
-- 019: Analytics performance indexes.
-- Adds indexes to make admin filtering (by country, platform) and
-- event log queries fast on real data volume. Also indexes sessions
-- so the inactivity-cron query is O(log n).
-- ════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_users_country         ON users (country)         WHERE country IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_platform        ON users (device_platform) WHERE device_platform IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_utm_source      ON users (utm_source)      WHERE utm_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_active     ON users (last_active_at DESC) WHERE last_active_at IS NOT NULL;

-- Speeds up "close idle sessions" cron + per-user session list.
CREATE INDEX IF NOT EXISTS idx_sessions_open
  ON sessions (ended_at) WHERE duration_sec IS NULL;

-- Admin "activity log" queries filter by user+event_name.
CREATE INDEX IF NOT EXISTS idx_events_user_event
  ON events (user_id, event_name, created_at DESC);
