-- ════════════════════════════════════════════════════════════════
-- 021: Partners framework — shared infrastructure for offerwalls,
-- affiliates, influencer deals and any other paid-acquisition source.
--
-- Design notes
-- ------------
-- * `partners` is the catalogue (TimeBucks, Mistplay, plain affiliates …).
--   The partner's `slug` MUST match the `utm_source` value we read from
--   Google Play Install Referrer — that's how conversions attribute back
--   to a partner when a user signs up.
-- * `partner_conversions` is the single source of truth for "this user
--   triggered a billable event for that partner". The outbound-postback
--   queue (`partner_postbacks_out`) feeds off this table exclusively, so
--   dedup and idempotency live in one place.
-- * Everything is additive — existing columns/tables are untouched so the
--   migration is safe to apply on an already-live database.
-- * The TimeBucks row seeded at the bottom uses placeholder values for
--   `postback_url_template` and `payout_cents`. They will be overwritten
--   from the admin UI (or `scripts/create-partner-account.ts`) as soon as
--   Anthony sends the real integration spec. Until then, the partner is
--   flagged `status='draft'` so no postbacks are fired accidentally.
-- ════════════════════════════════════════════════════════════════

-- ── 1. partners ─────────────────────────────────────────────────
-- One row per external partner / network / affiliate.
CREATE TABLE IF NOT EXISTS partners (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  type                 text NOT NULL DEFAULT 'offerwall'
                         CHECK (type IN ('offerwall', 'affiliate', 'network', 'influencer', 'other')),
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  default_payout_cents integer NOT NULL DEFAULT 0,
  postback_url_template text,
  postback_method      text NOT NULL DEFAULT 'GET' CHECK (postback_method IN ('GET', 'POST')),
  postback_secret      text,
  approval_mode        text NOT NULL DEFAULT 'auto' CHECK (approval_mode IN ('auto', 'manual')),
  hold_hours           integer NOT NULL DEFAULT 48,
  contact_email        text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partners_status ON partners (status) WHERE status != 'archived';

-- ── 2. partner_accounts — dashboard login per partner ──────────
-- Each partner can have one or more dashboard logins. Password is
-- stored as a bcrypt hash; the column is generous so future algos
-- still fit (argon2id headers etc). One shared login per partner is
-- the common case but multiple users are supported from day one.
CREATE TABLE IF NOT EXISTS partner_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text,
  role          text NOT NULL DEFAULT 'partner' CHECK (role IN ('partner', 'partner_admin')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_accounts_partner ON partner_accounts (partner_id);

-- ── 3. partner_conversions — ledger of billable events ────────
-- event_type — 'install' | 'first_play' | 'stage_reached' | 'harvest' …
-- payout_cents — gross we owe the partner for this event
-- partner_reward_cents — informational (portion the partner passes to
--   their end user; kept so the dashboard can show "of which user gets").
-- status — 'pending' (in hold window) → 'approved' (eligible to postback)
--          → 'paid' (we've marked it settled) OR 'rejected' / 'duplicate'.
CREATE TABLE IF NOT EXISTS partner_conversions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id           uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  click_id             text,
  event_type           text NOT NULL,
  payout_cents         integer NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'paid', 'rejected', 'duplicate')),
  hold_until           timestamptz,
  rejected_reason      text,
  metadata             jsonb NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  approved_at          timestamptz,
  paid_at              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_partner_conversions_partner_date
  ON partner_conversions (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_conversions_user
  ON partner_conversions (user_id);
CREATE INDEX IF NOT EXISTS idx_partner_conversions_status
  ON partner_conversions (status) WHERE status IN ('pending', 'approved');

-- One (partner, click_id, event_type) tuple can only convert once — hard
-- dedup guarantee at the DB level so retries / duplicate postbacks never
-- cause double-billing. NULL click_ids (organic attribution) are not
-- deduplicated: Postgres treats NULLs as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_conversions_click_event
  ON partner_conversions (partner_id, click_id, event_type)
  WHERE click_id IS NOT NULL;

-- ── 4. partner_postbacks_out — delivery queue ──────────────────
-- Every conversion that needs to notify the partner creates a row here.
-- A cron worker scans `status='queued' AND next_retry_at <= now()` and
-- fires HTTP requests with exponential backoff. Keeping this separate
-- from `partner_conversions` lets us log each attempt without mutating
-- the ledger.
CREATE TABLE IF NOT EXISTS partner_postbacks_out (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id       uuid REFERENCES partner_conversions(id) ON DELETE SET NULL,
  partner_id          uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  url                 text NOT NULL,
  method              text NOT NULL DEFAULT 'GET',
  body                text,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'sent', 'failed', 'dead')),
  attempts            integer NOT NULL DEFAULT 0,
  last_error          text,
  last_response_code  integer,
  last_response_body  text,
  next_retry_at       timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

CREATE INDEX IF NOT EXISTS idx_partner_postbacks_queue
  ON partner_postbacks_out (next_retry_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_partner_postbacks_partner
  ON partner_postbacks_out (partner_id, created_at DESC);

-- ── 5. users — attribution columns (additive) ──────────────────
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_click_id text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_attributed_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_users_partner
  ON users (partner_id, created_at DESC)
  WHERE partner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_partner_click
  ON users (partner_click_id)
  WHERE partner_click_id IS NOT NULL;

-- ── 6. Seed: TimeBucks partner row ─────────────────────────────
-- Inserted in `draft` status with placeholder payout values so the
-- partner exists (the dashboard login can be issued and tested) but
-- no postbacks fire until an admin edits the row with Anthony's real
-- spec and flips status to 'active'.
INSERT INTO partners (
  slug, name, type, status,
  default_payout_cents,
  postback_url_template, postback_method, approval_mode, hold_hours,
  contact_email, notes
)
VALUES (
  'timebucks',
  'TimeBucks',
  'offerwall',
  'draft',
  200,   -- $2.00 gross payout to TimeBucks per harvested user. How they
         -- split it with their end-user is their internal business.
  NULL,  -- to be filled in once Anthony provides it
  'GET',
  'auto',
  48,
  NULL,
  'Seeded 2026-04. Awaiting postback spec from Anthony.'
)
ON CONFLICT (slug) DO NOTHING;
