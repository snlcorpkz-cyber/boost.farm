-- Bucket ad: track free collections per day
ALTER TABLE farms
  ADD COLUMN IF NOT EXISTS bucket_free_collects_today INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bucket_collects_reset_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- Daily challenge: streak + next-day reward
ALTER TABLE daily_challenges
  ADD COLUMN IF NOT EXISTS streak_days INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_available_date DATE;

UPDATE daily_challenges SET reward_available_date = challenge_date + 1
WHERE reward_available_date IS NULL;
