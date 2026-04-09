-- ============================================================
-- ADD rank_id AND total_water_last_month TO farms
-- ============================================================
alter table public.farms
  add column if not exists rank_id text not null default 'novice',
  add column if not exists total_water_last_month float not null default 0;

-- ============================================================
-- DAILY CHALLENGES (one row per user per day)
-- ============================================================
create table if not exists public.daily_challenges (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  challenge_date date not null default current_date,
  water_given float not null default 0,
  required float not null default 100,
  completed boolean not null default false,
  reward_claimed boolean not null default false,
  reward_amount float not null default 20,
  created_at timestamptz not null default now(),
  unique (user_id, challenge_date)
);

create index if not exists idx_daily_challenges_user_date
  on public.daily_challenges(user_id, challenge_date);

-- ============================================================
-- GAMES (mini-game catalog)
-- ============================================================
create table if not exists public.games (
  id uuid primary key default uuid_generate_v4(),
  name_key text unique not null,
  reward_type text not null check (reward_type in ('water', 'nutrition')),
  reward_amount float not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- GAME COMPLETIONS (track per-user per-day limits)
-- ============================================================
create table if not exists public.game_completions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  completion_date date not null default current_date,
  count int not null default 1,
  unique (user_id, game_id, completion_date)
);

-- ============================================================
-- SEED default games
-- ============================================================
insert into public.games (name_key, reward_type, reward_amount)
values
  ('spin_wheel', 'water', 20),
  ('quiz', 'water', 15),
  ('memory', 'nutrition', 5)
on conflict (name_key) do nothing;
