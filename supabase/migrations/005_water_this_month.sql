ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS total_water_this_month float NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS water_month text NOT NULL DEFAULT to_char(now(), 'YYYY-MM');
