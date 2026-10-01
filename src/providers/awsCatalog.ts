import { fetchWithCache } from '../core/catalog.js';
import { downloadResumable, parseAwsCsvRows } from './awsDownload.js';

export const AWS_BASE = 'https://pricing.us-east-1.amazonaws.com';
export const AWS_TTL_MS = 24 * 60 * 60 * 1000;
export const MIN_INSTANCE_TYPES = 100;

export interface AwsCsvRow extends Record<string, string> {
  'Instance Type': string;
  PricePerUnit: string;
  TermType: string;
  'Operating System': string;
  Tenancy: string;
  CapacityStatus: string;
  'Pre Installed S/W': string;
}

async function regionCsvUrl(offerCode: string, region: string): Promise<string> {
  const indexUrl = `${AWS_BASE}/offers/v1.0/aws/${offerCode}/current/region_index.json`;
  const res = await fetch(indexUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`AWS ${offerCode} region index returned ${res.status}`);
  const json = (await res.json()) as {
    regions: Record<string, { currentVersionUrl: string }>;
  };
  const entry = json.regions[region];
  if (!entry) throw new Error(`AWS ${offerCode} region ${region} not found in pricing index`);
  return `${AWS_BASE}${entry.currentVersionUrl.replace(/index\.json$/, 'index.csv')}`;
}

/**
 * Fetches and caches the parsed rows of an AWS bulk-pricing offer CSV for a region.
 * Shared across compute/storage/database/network/EKS so the ~70MB EC2 file is
 * downloaded and parsed at most once per run (in-flight dedupe in fetchWithCache).
 */
export async function fetchAwsOfferRows(
  offerCode: string,
  region: string,
  noCache: boolean,
  opts: { requireMinTypes?: { min: number; what: string } } = {},
): Promise<Record<string, string>[]> {
  const cacheKey = `aws-rows-${offerCode}-${region}`;
  const { data } = await fetchWithCache<Record<string, string>[]>({
    key: cacheKey,
    ttlMs: AWS_TTL_MS,
    noCache,
    fetcher: async () => {
      const csvUrl = await regionCsvUrl(offerCode, region);
      const csv = await downloadResumable(csvUrl);
      return parseAwsCsvRows(csv);
    },
  });
  if (opts.requireMinTypes) {
    const types = new Set(data.map((r) => r['Instance Type']).filter(Boolean));
    if (types.size < opts.requireMinTypes.min) {
      throw new Error(
        `AWS ${offerCode} pricing for ${region} yielded only ${types.size} ${opts.requireMinTypes.what} ` +
          `(expected ${opts.requireMinTypes.min}+) — the download may be truncated; refusing to use it`,
      );
    }
  }
  return data;
}

/** Lowest positive price-per-unit among rows matching the predicate (unit-agnostic). */
export function bestPrice(rows: Record<string, string>[], predicate: (r: Record<string, string>) => boolean): number | null {
  let best: number | null = null;
  for (const r of rows) {
    if (!predicate(r)) continue;
    const p = Number(r['PricePerUnit'] ?? 'NaN');
    if (Number.isFinite(p) && p > 0 && (best === null || p < best)) best = p;
  }
  return best;
}
