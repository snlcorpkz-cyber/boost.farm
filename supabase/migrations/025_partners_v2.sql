-- ════════════════════════════════════════════════════════════════
-- 025: Partner framework v2 — TimeBucks-ready integration
--
-- Builds on 021_partners.sql. All changes are additive and idempotent
-- so this migration is safe to apply on a live database that already
-- has TimeBucks seeded in 'draft' status.
--
-- Adds:
--   * `partner_country_payouts` — geo-aware payout matrix. TimeBucks
--     pays $2.00 only for US users; non-US users still generate
--     informational postbacks (payout = 0) so the partner can monitor
--     their traffic quality.
--   * `partners.allowed_events`            — text[] of event_types the
--     partner wants postbacks for. For TimeBucks: install / stage_4 /
--     harvest. Lets us stay forward-compatible if other partners want
--     finer or coarser funnels without code changes.
--   * `partners.attribution_window_hours`  — max age between click and
--     install for which we still attribute the user to this partner.
--     Default 168h = 7 days (TimeBucks). Beyond the window the user is
--     treated as organic.
--   * `partners.report_tz`                 — IANA tz string or fixed
--     offset (e.g. '+05:00') the dashboard rolls daily numbers over
--     at midnight in. TimeBucks runs on GMT+5.
--   * `partner_conversions.fraud_reason`   — enum captured when an
--     admin reverses a conversion; sent through to the partner via
--     `&reason=...` in the reversal postback so they can adjust their
--     own fraud filters.
--   * `partner_conversions.original_conversion_id` — for `reversed`
--     events, points back at the conversion they undo. Lets the
--     partner correlate the reversal to the original payout row.
--   * `partner_conversions.country_code`   — ISO-2 captured at record
--     time. We store it explicitly because users.country can be back-
--     filled later from new sessions; the conversion's country must
--     reflect the moment of the event for billing reproducibility.
--
-- Also relaxes the CHECK on `partner_conversions.status` to allow the
-- `reversed` lifecycle and adds the `reversed` event_type implicitly
-- (event_type is already free-form text — only documenting here).
--
-- TimeBucks-specific seeding:
--   * partner row → allowed_events, attribution window, report_tz set
--   * partner_country_payouts → ('US', 200)
--   * status remains 'draft' until the postback URL lands and the
--     end-to-end test passes via /admin/users/:id/force-harvest.
-- ════════════════════════════════════════════════════════════════

-- ── 1. partners — extension columns ─────────────────────────────
DO $$ BEGIN
  ALTER TABLE partners ADD COLUMN IF NOT EXISTS allowed_events text[];
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE partners
    ADD COLUMN IF NOT EXISTS attribution_window_hours integer NOT NULL DEFAULT 168;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE partners
    ADD COLUMN IF NOT EXISTS report_tz text NOT NULL DEFAULT 'UTC';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Sanity: if someone sets a wildly invalid attribution window, we
-- want it to fail loudly rather than wait 100 years of clicks.
DO $$ BEGIN
  ALTER TABLE partners
    ADD CONSTRAINT chk_attribution_window_sane
    CHECK (attribution_window_hours BETWEEN 1 AND 8760);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. partner_country_payouts ──────────────────────────────────
-- Geo matrix. Lookup at conversion time:
--   SELECT payout_cents
--   FROM partner_country_payouts
--   WHERE partner_id = $1 AND country_code = $2;
-- Missing row → payout_cents = 0 (informational postback only).
CREATE TABLE IF NOT EXISTS partner_country_payouts (
  partner_id   uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  country_code text NOT NULL CHECK (country_code = upper(country_code) AND length(country_code) = 2),
  payout_cents integer NOT NULL CHECK (payout_cents >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, country_code)
);

-- ── 3. partner_conversions — extension columns ──────────────────
DO $$ BEGIN
  ALTER TABLE partner_conversions
    ADD COLUMN IF NOT EXISTS fraud_reason text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE partner_conversions
    ADD COLUMN IF NOT EXISTS original_conversion_id uuid REFERENCES partner_conversions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE partner_conversions
    ADD COLUMN IF NOT EXISTS country_code text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Constrain fraud_reason to a known set so we don't end up with a
-- zoo of typos in the wild. New reasons are cheap to add later via
-- a follow-up migration that extends the CHECK.
DO $$ BEGIN
  ALTER TABLE partner_conversions
    ADD CONSTRAINT chk_partner_conv_fraud_reason
    CHECK (fraud_reason IS NULL OR fraud_reason IN (
      'velocity_too_fast',
      'device_farm',
      'click_injection',
      'geo_mismatch',
      'duplicate_account',
      'chargeback',
      'bot_behavior',
      'partner_request',
      'manual_admin'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow `reversed` in the status enum. We drop the old CHECK and
-- re-add it with the extra value so existing rows stay valid.
DO $$ BEGIN
  ALTER TABLE partner_conversions DROP CONSTRAINT IF EXISTS partner_conversions_status_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE partner_conversions
    ADD CONSTRAINT partner_conversions_status_check
    CHECK (status IN ('pending', 'approved', 'paid', 'rejected', 'duplicate', 'reversed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_partner_conversions_country
  ON partner_conversions (partner_id, country_code)
  WHERE country_code IS NOT NULL;

-- ── 4. TimeBucks-specific seeding ───────────────────────────────
-- Per Anthony's confirmation:
--   events → install, stage_4, harvest (3 only, no per-stage spam)
--   attribution → 7 days
--   timezone → GMT+5 (we store '+05:00' as a fixed offset; no DST)
--   payout → $2.00 (200 cents) on US users only; non-US → $0
UPDATE partners
   SET allowed_events           = ARRAY['install', 'stage_4', 'harvest']::text[],
       attribution_window_hours = 168,
       report_tz                = '+05:00',
       updated_at               = now()
 WHERE slug = 'timebucks'
   AND (allowed_events IS NULL OR allowed_events = '{}');

INSERT INTO partner_country_payouts (partner_id, country_code, payout_cents)
SELECT id, 'US', 200
  FROM partners
 WHERE slug = 'timebucks'
ON CONFLICT (partner_id, country_code) DO NOTHING;

-- ── 5. partner_postbacks_out — convenience: track event_type ────
-- The conversion id alone is enough to look up the event type via JOIN,
-- but having it inline on the queue row makes /partner/postbacks UI
-- and reversal logic dramatically simpler (no extra join, no race when
-- the conversion row gets archived). Backfilled lazily by the worker.
DO $$ BEGIN
  ALTER TABLE partner_postbacks_out
    ADD COLUMN IF NOT EXISTS event_type text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_partner_postbacks_event
  ON partner_postbacks_out (partner_id, event_type, created_at DESC)
  WHERE event_type IS NOT NULL;
