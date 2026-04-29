-- ════════════════════════════════════════════════════════════════
-- 026: Ad cost ingestion (AppsFlyer Pull API → ad_costs table)
--
-- Stores daily ad spend pulled from AppsFlyer's aggregated
-- `partners_by_date_report v5`. Each row = (date × media source ×
-- campaign × adset × ad × geo) — granularity dictated by what AF
-- returns, not what we want to query, so we keep all dimensions
-- even if today's report only fills `cost_date` + `media_source`
-- + `campaign_name`. When AF starts returning campaign_id /
-- adset_id / ad_id / geo we won't need a schema change to absorb
-- the extra fidelity.
--
-- Why store spend_micros (bigint) instead of numeric:
--   • Same scheme Meta Marketing Insights API uses, which means
--     when we add a Meta-direct fallback (skip AF, hit Insights
--     ourselves) we can dump the response straight in.
--   • bigint micro-USD comparison is a single CPU op vs
--     numeric(18,6) which is a software-emulated operation —
--     matters when the retention report joins this table 14×
--     per page render.
--   • Avoids float drift on aggregation (sum(numeric) is exact
--     but pg always returns it as text; bigint sums are returned
--     as bigint and JS handles them via BigInt without `.toFixed`
--     hacks).
--
-- PRIMARY KEY composition:
--   `geo` is part of the key so when AF starts returning
--   per-country spend (cost integration with Meta sometimes
--   includes country breakdown), we can upsert without conflict.
--   Empty-string geo is the catch-all "all countries this day"
--   row — what the partners_by_date_report v5 returns today.
--
-- Apply after 025_partners_v2.sql.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ad_costs (
  cost_date     date         NOT NULL,
  media_source  text         NOT NULL,                 -- "Facebook Ads", "googleadwords_int", "Organic"
  campaign_id   text         NOT NULL DEFAULT '',      -- AF aggregate report only returns name; we mirror name here so the PK stays unique without a magic surrogate
  campaign_name text         NOT NULL DEFAULT '',
  adset_id      text         NOT NULL DEFAULT '',
  adset_name    text         NOT NULL DEFAULT '',
  ad_id         text         NOT NULL DEFAULT '',
  ad_name       text         NOT NULL DEFAULT '',
  geo           text         NOT NULL DEFAULT '',      -- ISO-3166 alpha-2; '' = unspecified / all countries
  currency      text         NOT NULL DEFAULT 'USD',
  spend_micros  bigint       NOT NULL DEFAULT 0,       -- USD micros (1 USD = 1_000_000) — even when account currency is non-USD we convert via AF's `currency=USD` param
  impressions   bigint       NOT NULL DEFAULT 0,       -- 0 (not NULL) when AF returns "N/A" so SUM() still works
  clicks        bigint       NOT NULL DEFAULT 0,
  installs      bigint       NOT NULL DEFAULT 0,
  ingested_at   timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (cost_date, media_source, campaign_id, adset_id, ad_id, geo)
);

-- Hot path: cost lookups on the retention page query
-- "WHERE cost_date = ANY(...) [ AND media_source = ... ]". This
-- composite index serves both shapes since `cost_date` is the
-- highest-cardinality column.
CREATE INDEX IF NOT EXISTS idx_ad_costs_date_source
  ON ad_costs (cost_date, media_source);

-- Future per-campaign drilldown (Phase 5+).
CREATE INDEX IF NOT EXISTS idx_ad_costs_campaign
  ON ad_costs (campaign_id)
  WHERE campaign_id <> '';

COMMENT ON TABLE ad_costs IS
  'Daily ad spend ingested from AppsFlyer Pull API (partners_by_date_report v5). Populated by packages/api/src/workers/afCostPullWorker.ts on a daily cron. spend_micros uses USD-micros (1_000_000 = 1 USD). One row per (cost_date, media_source, campaign_id, adset_id, ad_id, geo) tuple.';

COMMENT ON COLUMN ad_costs.spend_micros IS
  'USD micros (e.g. 4_320_000 = $4.32). bigint chosen to match Meta Marketing API conventions and to avoid numeric/float arithmetic in joins.';

COMMENT ON COLUMN ad_costs.geo IS
  'ISO-3166 alpha-2 country code OR empty string when AF returns no per-country breakdown. Empty string is NOT NULL so the column participates in the PK without ambiguity.';
