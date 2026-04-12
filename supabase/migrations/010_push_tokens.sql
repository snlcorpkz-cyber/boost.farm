-- Push notification tokens (FCM)
CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'android',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

-- Deduplication log so cron doesn't spam the same push
CREATE TABLE IF NOT EXISTS push_sent_log (
  user_id uuid NOT NULL,
  trigger_key text NOT NULL,
  sent_date date NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY(user_id, trigger_key, sent_date)
);
