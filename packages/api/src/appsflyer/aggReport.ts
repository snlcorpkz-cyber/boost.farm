/**
 * AppsFlyer Aggregated Pull API client (partners_by_date_report v5).
 *
 * Endpoint discovered & verified live on 29 Apr 2026:
 *   GET https://hq1.appsflyer.com/api/agg-data/export/app/{APP_ID}/partners_by_date_report/v5
 *   Authorization: Bearer <V2_JWT_TOKEN>
 *
 * The path uses underscores (`partners_by_date_report`) — this is
 * the documented form. Earlier docs pages incorrectly referenced
 * dashes (`partners-by-date-report`); both `agg-data-v5/export/app`
 * and `/export/{app-id}/...` style URLs return CloudFront 404/403,
 * the agg-data path above is the canonical one.
 *
 * Response: text/csv with a header row and one row per
 * (date × media_source × campaign) tuple. We parse the columns
 * we care about (Date / Media Source / Campaign / Total Cost /
 * Impressions / Clicks / Installs) and ignore the 40+ event
 * counter columns at the tail — those are populated by AF's
 * normal SDK ingestion, we don't need them duplicated here.
 *
 * Rate limit (per AppsFlyer docs):
 *   - date range ≤ 2 days: 1 call/min/app
 *   - date range ≥ 3 days: 24 calls/day/app
 * The worker uses a 14-day window so we're firmly in the
 * 24-calls/day bucket. Daily cron schedule keeps us at 1/24th
 * of the limit.
 */

const HOST = 'https://hq1.appsflyer.com';
const REPORT_PATH = '/api/agg-data/export/app';
const REPORT = 'partners_by_date_report';

/** Single normalised cost row produced from one CSV record. */
export interface CostRow {
  /** YYYY-MM-DD (matches AF "Date" column verbatim — already in app TZ). */
  date: string;
  /** "Facebook Ads", "googleadwords_int", "Organic", "twitter", … */
  media_source: string;
  /** AF doesn't expose campaign_id here; using the campaign name as the surrogate id. Empty string when AF returns "None". */
  campaign_name: string;
  /** USD micros (1 USD = 1_000_000). 0 when AF returned "0.0000" or could not parse. */
  spend_micros: number;
  /** ISO-4217 — the report doesn't include a per-row currency column; we capture the option we requested (USD) and store it for forward-compat. */
  currency: string;
  /** 0 when AF returned "N/A" — common when cost integration hasn't synced yet. */
  impressions: number;
  clicks: number;
  installs: number;
}

export interface FetchPartnersByDateOpts {
  /** Pull API V2 JWT token (NOT the SDK dev key). */
  pullApiToken: string;
  /** AF App ID, usually the Android package (`io.boostfarm.app`). */
  appId: string;
  /** YYYY-MM-DD. */
  fromDate: string;
  /** YYYY-MM-DD (inclusive). */
  toDate: string;
  /** ISO timezone, e.g. "UTC". Default: account TZ ("preferred"). */
  timezone?: string;
  /** Defaults to USD so spend is comparable across markets without conversion. */
  currency?: 'USD' | 'preferred';
  /** Override only in tests. */
  fetchImpl?: typeof fetch;
}

/** Distinguished error so the worker can decide retry-vs-skip. */
export class AppsFlyerPullError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | undefined,
    public readonly retryable: boolean,
    public readonly bodyPreview?: string,
  ) {
    super(message);
    this.name = 'AppsFlyerPullError';
  }
}

const HTTP_TIMEOUT_MS = 60_000; // CSV exports for 14 days can be ~100KB but AF's edge sometimes streams slowly.

/**
 * Hit the partners_by_date_report endpoint and parse the CSV body
 * into typed rows. Retries once on 5xx (single retry — the daily
 * cron will pick up further retries naturally on the next run).
 *
 * Throws AppsFlyerPullError on every non-2xx so the worker has
 * structured information to log + decide.
 */
export async function fetchPartnersByDate(opts: FetchPartnersByDateOpts): Promise<CostRow[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${HOST}${REPORT_PATH}/${encodeURIComponent(opts.appId)}/${REPORT}/v5`);
  url.searchParams.set('from', opts.fromDate);
  url.searchParams.set('to', opts.toDate);
  url.searchParams.set('currency', opts.currency ?? 'USD');
  if (opts.timezone) url.searchParams.set('timezone', opts.timezone);

  let lastError: AppsFlyerPullError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${opts.pullApiToken}`,
          Accept: 'text/csv',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const csv = await res.text();
        return parsePartnersCsv(csv, opts.currency ?? 'USD');
      }

      const body = await res.text().catch(() => '');
      const preview = body.slice(0, 500);
      // 401/403 = token / tier issue → permanent until ops fixes env.
      // 404 = wrong app-id → permanent. 400 CallLimit = transient,
      // retry once after rate-limit window.
      const isCallLimit = res.status === 400 && /call ?limit/i.test(body);
      const retryable = res.status >= 500 || isCallLimit;
      lastError = new AppsFlyerPullError(
        `AppsFlyer Pull API returned ${res.status}`,
        res.status,
        retryable,
        preview,
      );
      if (!retryable) throw lastError;
      // Wait 65s for CallLimit (per AF docs the limit is per-minute);
      // a flat 5s for plain 5xx.
      await sleep(isCallLimit ? 65_000 : 5_000);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof AppsFlyerPullError) {
        if (!err.retryable) throw err;
        lastError = err;
        continue;
      }
      const reason = err instanceof Error ? err.message : 'network';
      lastError = new AppsFlyerPullError(`AppsFlyer Pull API network error: ${reason}`, undefined, true);
      // Don't immediately re-throw network errors — give it one retry.
    }
  }
  throw lastError ?? new AppsFlyerPullError('AppsFlyer Pull API: exhausted retries', undefined, true);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ───────────────────────── CSV parser ─────────────────────────
 *
 * Hand-rolled because adding a `csv-parse` dep for one file's
 * worth of parsing isn't worth the ~50KB. AF's CSV is well-formed
 * (RFC 4180): comma separator, double-quote escaping, no embedded
 * newlines in fields. We split on `\r\n` or `\n` and walk each
 * record character-by-character so quoted commas are handled.
 *
 * AF specifics worth knowing:
 *   - Header column names contain spaces and parens (e.g.
 *     "Media Source (pid)"). We match by exact header string.
 *   - Numeric cells can be "N/A" (when cost integration not
 *     synced yet) — parsed as 0.
 *   - "None" is AF's literal placeholder for "no campaign" — we
 *     store empty string.
 *   - "Total Cost" is in the app's reporting currency (we request
 *     currency=USD so it's USD); "0.0000" is the typical value
 *     before Meta cost sync starts populating real numbers.
 */

const HEADERS = {
  date: 'Date',
  mediaSource: 'Media Source (pid)',
  campaign: 'Campaign (c)',
  cost: 'Total Cost',
  impressions: 'Impressions',
  clicks: 'Clicks',
  installs: 'Installs',
} as const;

export function parsePartnersCsv(csv: string, currency: string): CostRow[] {
  const records = splitCsvRecords(csv);
  if (records.length === 0) return [];

  const header = records[0];
  if (!header) return [];
  const colIndex = (name: string): number => {
    const idx = header.findIndex((h) => h === name);
    return idx;
  };

  const idxDate = colIndex(HEADERS.date);
  const idxSource = colIndex(HEADERS.mediaSource);
  const idxCampaign = colIndex(HEADERS.campaign);
  const idxCost = colIndex(HEADERS.cost);
  const idxImpressions = colIndex(HEADERS.impressions);
  const idxClicks = colIndex(HEADERS.clicks);
  const idxInstalls = colIndex(HEADERS.installs);

  if (idxDate < 0 || idxSource < 0 || idxCost < 0) {
    throw new Error(
      `AppsFlyer CSV missing required columns. Got: ${header.slice(0, 10).join(' | ')}…`,
    );
  }

  const rows: CostRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const fields = records[i];
    if (!fields || fields.length === 1 && (fields[0] ?? '').trim() === '') continue;

    const dateRaw = (fields[idxDate] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) continue;

    const mediaSource = (fields[idxSource] ?? '').trim();
    if (!mediaSource) continue;

    const campaign = normaliseAfPlaceholder(fields[idxCampaign] ?? '');
    const cost = parseNumeric(fields[idxCost] ?? '');
    const impressions = parseInteger(fields[idxImpressions] ?? '');
    const clicks = parseInteger(fields[idxClicks] ?? '');
    const installs = parseInteger(fields[idxInstalls] ?? '');

    rows.push({
      date: dateRaw,
      media_source: mediaSource,
      campaign_name: campaign,
      spend_micros: Math.round(cost * 1_000_000),
      currency,
      impressions,
      clicks,
      installs,
    });
  }
  return rows;
}

/**
 * AF returns "None" for missing campaign / agency cells — we
 * treat that as empty string so downstream queries don't have to
 * special-case the literal.
 */
function normaliseAfPlaceholder(value: string): string {
  const v = value.trim();
  if (v === '' || v === 'None' || v === 'N/A') return '';
  return v;
}

/** "N/A" → 0; "0.0000" → 0; "1.23" → 1.23. */
function parseNumeric(value: string): number {
  const v = value.trim();
  if (v === '' || v === 'N/A') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseInteger(value: string): number {
  const n = parseNumeric(value);
  return Math.trunc(n);
}

/**
 * RFC 4180 record splitter. Handles quoted fields, escaped quotes
 * ("" → "), and treats both \n and \r\n as record terminators.
 */
function splitCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++; // skip the escape twin
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\r') {
      // Treat \r\n as a single terminator; a lone \r is rare but
      // we still close the record.
      if (csv[i + 1] === '\n') i++;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      continue;
    }
    if (c === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  // Flush any trailing field/row that wasn't terminated by a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}
