/**
 * Shared audience-filter primitives for admin analytics routes
 * (retention.ts, report.ts). Keeping the paid/organic predicate in
 * one place means "paid" can never quietly mean two different things
 * on two admin pages.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SourceFilter = 'all' | 'paid' | 'organic';

export function parseSourceFilter(raw: unknown): SourceFilter {
  if (raw === 'paid' || raw === 'organic' || raw === 'all') return raw;
  return 'all';
}

/**
 * Predicate for paid users. We treat a user as paid when their
 * acquisition_source carries an AppsFlyer media_source other
 * than "Organic", or a Facebook campaign id / UTM campaign (legacy
 * Install Referrer path before AF was wired up). Empty / null
 * acquisition_source = organic.
 *
 * Returns an `AND …` SQL fragment against alias `u` (users), or ''
 * for the unfiltered path.
 */
export function sourceFilterSql(filter: SourceFilter): string {
  if (filter === 'paid') {
    return `AND u.acquisition_source IS NOT NULL
            AND (
              (u.acquisition_source ? 'afMediaSource'
                AND COALESCE(u.acquisition_source ->> 'afMediaSource', '') NOT IN ('', 'Organic'))
              OR u.acquisition_source ? 'fbCampaignId'
              OR u.acquisition_source ? 'utmCampaign'
            )`;
  }
  if (filter === 'organic') {
    return `AND (
              u.acquisition_source IS NULL
              OR (
                NOT (u.acquisition_source ? 'fbCampaignId')
                AND NOT (u.acquisition_source ? 'utmCampaign')
                AND COALESCE(u.acquisition_source ->> 'afMediaSource', 'Organic') IN ('', 'Organic')
              )
            )`;
  }
  return '';
}
