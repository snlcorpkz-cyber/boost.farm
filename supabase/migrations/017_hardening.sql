-- ════════════════════════════════════════════════════════════════
-- 017: Hardening & bug fixes after QA audit
--   * UNIQUE guard against duplicate greet/water reward races (H-6)
--   * users.pending_nutrition_bonus for referrals before farm exists (C-5)
--   * referrals.bonus_credited_at (optional bookkeeping)
--   * total_water_last_month monthly rollover function + trigger (C-3)
--   * helpful indexes for analytics/admin
-- ════════════════════════════════════════════════════════════════

-- H-6: prevent duplicate friend_actions on parallel requests.
-- We drop any accidental duplicates first, then add the constraint.
DELETE FROM friend_actions a
USING friend_actions b
WHERE a.ctid < b.ctid
  AND a.actor_id = b.actor_id
  AND a.target_id = b.target_id
  AND a.action_type = b.action_type
  AND a.phase = b.phase
  AND a.action_date = b.action_date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'friend_actions_unique_phase'
  ) THEN
    ALTER TABLE friend_actions
      ADD CONSTRAINT friend_actions_unique_phase
      UNIQUE (actor_id, target_id, action_type, phase, action_date);
  END IF;
END $$;

-- C-5: buffer for referral reward given before the invited user has a farm.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pending_nutrition_bonus int NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pending_water_bonus int NOT NULL DEFAULT 0;

-- C-4: mark when a referral is credited (also used by pet unlock logic).
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- C-3: monthly roll-over. Moves total_water_this_month into total_water_last_month
-- whenever a farm is touched in a new calendar month (UTC). Idempotent.
CREATE OR REPLACE FUNCTION rollover_water_month()
RETURNS TRIGGER AS $$
DECLARE
  cur_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
BEGIN
  IF NEW.water_month IS NULL OR NEW.water_month <> cur_month THEN
    -- only rollover if we actually had a previous month with progress
    IF NEW.water_month IS NOT NULL AND NEW.water_month <> cur_month THEN
      NEW.total_water_last_month := COALESCE(OLD.total_water_this_month, 0);
    END IF;
    NEW.total_water_this_month := 0;
    NEW.water_month := cur_month;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rollover_water_month ON farms;
CREATE TRIGGER trg_rollover_water_month
BEFORE UPDATE OF total_water_this_month, water_month ON farms
FOR EACH ROW EXECUTE FUNCTION rollover_water_month();

-- Batch rollover function, callable from cron for idle farms.
CREATE OR REPLACE FUNCTION rollover_water_month_batch()
RETURNS int AS $$
DECLARE
  cur_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  n int;
BEGIN
  UPDATE farms
  SET total_water_last_month = COALESCE(total_water_this_month, 0),
      total_water_this_month = 0,
      water_month = cur_month
  WHERE (water_month IS NULL OR water_month <> cur_month);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- Helpful indexes.
CREATE INDEX IF NOT EXISTS idx_friend_actions_target
  ON friend_actions (target_id, action_date);
