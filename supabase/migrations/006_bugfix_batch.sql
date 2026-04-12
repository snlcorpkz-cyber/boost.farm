-- BUG-01: Add fertilizer check-in quest
INSERT INTO quests (quest_key, reward_type, reward_amount, limit_per_phase)
VALUES ('checkin_fert', 'nutrition', 5, 1)
ON CONFLICT DO NOTHING;

-- BUG-04: Prevent multiple active farms per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_farms_one_active_per_user
  ON farms(user_id) WHERE harvested = false;
