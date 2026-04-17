-- ════════════════════════════════════════════════════════════════
-- 018: Fix monthly water rollover trigger logic.
--
-- In 017 the trigger used NEW.water_month to decide whether to rollover,
-- but every UPDATE in our API explicitly sets water_month to the current
-- month. That made the trigger a no-op in the common case and
-- total_water_last_month was lost whenever an *active* user crossed a
-- month boundary before the batch cron could run.
--
-- The correct heuristic is: look at OLD.water_month. If the row we are
-- about to write over was in a different month than now (UTC), capture
-- OLD.total_water_this_month into NEW.total_water_last_month BEFORE the
-- UPDATE resets the per-month counter.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION rollover_water_month()
RETURNS TRIGGER AS $$
DECLARE
  cur_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
BEGIN
  -- Only act when the previous row state crossed a month boundary.
  -- We copy the finished month's counter into total_water_last_month.
  -- The UPDATE statement itself is responsible for zeroing
  -- total_water_this_month and writing the new water_month.
  IF OLD.water_month IS NOT NULL AND OLD.water_month <> cur_month THEN
    NEW.total_water_last_month := COALESCE(OLD.total_water_this_month, 0);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger to make sure it fires on the fields we care about.
DROP TRIGGER IF EXISTS trg_rollover_water_month ON farms;
CREATE TRIGGER trg_rollover_water_month
BEFORE UPDATE OF total_water_this_month, water_month ON farms
FOR EACH ROW EXECUTE FUNCTION rollover_water_month();
