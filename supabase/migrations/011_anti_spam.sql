-- Unique constraint to prevent duplicate quest completions (race condition fix)
CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_completions_unique
ON quest_completions(user_id, quest_id, phase, completion_date);

-- Track ad views per phase to enforce limits
CREATE TABLE IF NOT EXISTS ad_views (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ad_type text NOT NULL DEFAULT 'rewarded',
  phase text NOT NULL,
  view_date date NOT NULL DEFAULT CURRENT_DATE,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, ad_type, phase, view_date)
);
