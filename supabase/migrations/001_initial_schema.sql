-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS
-- ============================================================
create table public.users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  nickname text not null,
  avatar_id text not null default 'cat',
  locale text not null default 'en',
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create index idx_users_email on public.users(email);

-- ============================================================
-- AUTH CODES (email magic code login)
-- ============================================================
create table public.auth_codes (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_auth_codes_email on public.auth_codes(email);

-- ============================================================
-- PRODUCTS (crops available for growing)
-- ============================================================
create table public.products (
  id uuid primary key default uuid_generate_v4(),
  name_key text not null,
  difficulty_stars int not null default 1 check (difficulty_stars between 1 and 3),
  base_water_required int not null default 10000,
  image_url text,
  active boolean not null default true,
  coupon_validity_days int not null default 60,
  created_at timestamptz not null default now()
);

-- ============================================================
-- FARM STAGES (per-product growth curve config)
-- ============================================================
create table public.farm_stages (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete cascade,
  stage_number int not null check (stage_number between 1 and 6),
  percent_per_watering_x1 float not null,
  image_url text,
  unique (product_id, stage_number)
);

-- ============================================================
-- FARMS (one active farm per user)
-- ============================================================
create table public.farms (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id),
  growth_percent float not null default 0,
  current_stage int not null default 1,
  water_in_can float not null default 0,
  water_in_bucket float not null default 0,
  nutrition int not null default 0,
  bucket_last_collected_at timestamptz not null default now(),
  total_waterings_today int not null default 0,
  day_reset_at timestamptz not null default now(),
  harvested boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_farms_user on public.farms(user_id);
create index idx_farms_active on public.farms(user_id) where harvested = false;

-- ============================================================
-- FRIENDS
-- ============================================================
create table public.friends (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  friend_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, friend_id),
  check (user_id != friend_id)
);

create index idx_friends_user on public.friends(user_id);

-- ============================================================
-- FRIEND ACTIONS (greetings, waterings tracked per phase)
-- ============================================================
create table public.friend_actions (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid not null references public.users(id) on delete cascade,
  target_id uuid not null references public.users(id) on delete cascade,
  action_type text not null check (action_type in ('greet', 'water')),
  phase text not null check (phase in ('morning', 'afternoon', 'evening')),
  action_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index idx_friend_actions_actor on public.friend_actions(actor_id, action_date, phase);

-- ============================================================
-- QUESTS
-- ============================================================
create table public.quests (
  id uuid primary key default uuid_generate_v4(),
  quest_key text unique not null,
  reward_type text not null check (reward_type in ('water', 'nutrition')),
  reward_amount float not null,
  limit_per_phase int not null default 1,
  active boolean not null default true
);

-- ============================================================
-- QUEST COMPLETIONS
-- ============================================================
create table public.quest_completions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  quest_id uuid not null references public.quests(id) on delete cascade,
  phase text not null check (phase in ('morning', 'afternoon', 'evening')),
  completion_date date not null default current_date,
  count int not null default 1,
  unique (user_id, quest_id, phase, completion_date)
);

-- ============================================================
-- COUPONS
-- ============================================================
create table public.coupons (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id),
  code text unique not null,
  expires_at timestamptz not null,
  redeemed boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_coupons_user on public.coupons(user_id);

-- ============================================================
-- PETS
-- ============================================================
create table public.pets (
  id uuid primary key default uuid_generate_v4(),
  name_key text unique not null,
  ability_type text not null,
  ability_description_key text not null,
  image_url text
);

-- ============================================================
-- USER PETS
-- ============================================================
create table public.user_pets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  is_active boolean not null default false,
  last_gift_at timestamptz,
  unique (user_id, pet_id)
);

-- ============================================================
-- NOTIFICATIONS (in-app)
-- ============================================================
create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_notifications_user on public.notifications(user_id, read);

-- ============================================================
-- REFERRALS
-- ============================================================
create table public.referrals (
  id uuid primary key default uuid_generate_v4(),
  inviter_id uuid not null references public.users(id) on delete cascade,
  invitee_id uuid references public.users(id) on delete set null,
  invite_code text unique not null,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_referrals_inviter on public.referrals(inviter_id);
create index idx_referrals_code on public.referrals(invite_code);

-- ============================================================
-- IDEMPOTENCY KEYS (prevent duplicate watering)
-- ============================================================
create table public.idempotency_keys (
  key text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
