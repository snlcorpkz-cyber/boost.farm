-- ============================================================
-- OFFERS — external game offers from Everflow partner
-- ============================================================
CREATE TABLE IF NOT EXISTS public.offers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon_url text NOT NULL DEFAULT '',
  everflow_offer_id text NOT NULL UNIQUE,
  tracking_link_template text NOT NULL,
  reward_type text NOT NULL CHECK (reward_type IN ('water', 'nutrition')),
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- OFFER MILESTONES — reward tiers per offer (e.g. Level 10, Level 50)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.offer_milestones (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  everflow_event_id text NOT NULL,
  event_name text NOT NULL,
  reward_amount float NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (offer_id, everflow_event_id)
);

CREATE INDEX IF NOT EXISTS idx_offer_milestones_offer ON public.offer_milestones(offer_id);

-- ============================================================
-- OFFER COMPLETIONS — tracks which milestones each user completed
-- ============================================================
CREATE TABLE IF NOT EXISTS public.offer_completions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  milestone_id uuid NOT NULL REFERENCES public.offer_milestones(id) ON DELETE CASCADE,
  everflow_transaction_id text,
  credited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_offer_completions_user ON public.offer_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_offer_completions_offer ON public.offer_completions(user_id, offer_id);

-- ============================================================
-- POSTBACK LOG — raw log of every incoming Everflow postback for audit/debug
-- ============================================================
CREATE TABLE IF NOT EXISTS public.offer_postback_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_query text NOT NULL,
  everflow_offer_id text,
  everflow_event_id text,
  user_id uuid,
  transaction_id text,
  status text NOT NULL DEFAULT 'received',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
