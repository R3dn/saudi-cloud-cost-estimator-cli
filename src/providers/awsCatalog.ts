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

/**
 * Columns the estimators filter on. Caching the full ~40-84-column bulk CSV as
 * parsed JSON wastes hundreds of MB; only these are ever read. AWS bulk CSVs
 * use camelCase for these fields (StartingRange, usageType) — the projection
 * normalizes nothing, it only selects.
 */
const CACHED_COLUMNS = [
  'TermType',
  'PriceDescription',
  'StartingRange',
  'EndingRange',
  'Starting Range',
  'Ending Range',
  'Unit',
  'PricePerUnit',
  'Currency',
  'Product Family',
  'serviceCode',
  'Location',
  'Instance Type',
  'Current Generation',
  'Instance Family',
  'vCPU',
  'Memory',
  'Operating System',
  'Tenancy',
  'Pre Installed S/W',
  'CapacityStatus',
  'License Model',
  'Volume Type',
  'Database Engine',
  'Deployment Option',
  'Storage Class',
  'Transfer Type',
  'From Location',
  'To Location',
  'usageType',
  'Usage Type',
  'Region Code',
  'Region Name',
  'GPU',
  'GPU Model',
] as const;

/**
 * Keeps the rows the estimators can ever match: OnDemand terms and the small set
 * of product families priced by this tool. Reserved/SavePlan rows (~75% of the
 * EC2 file) are dropped before caching.
 */
function relevantRow(r: Record<string, string>): boolean {
  const term = r['TermType'];
  if (term !== 'OnDemand') return false;
  const family = r['Product Family'] ?? '';
  const usage = r['usageType'] ?? r['Usage Type'] ?? '';
  if (
    family === 'Compute Instance' ||
    family === 'Compute Instance (bare metal)' ||
    family === 'Storage' ||
    family === 'Database Instance' ||
    family === 'Database Storage' ||
    family === 'Load Balancer-Application' ||
    family === 'Load Balancer-Network' ||
    family === 'NAT Gateway' ||
    family === 'Data Transfer' ||
    /EKS-Hours:perCluster/i.test(usage) ||
    /NatGateway-Hours/i.test(usage) ||
    /LoadBalancerUsage/i.test(usage) ||
    /TimedStorage-ByteHrs/i.test(usage)
  ) {
    return true;
  }
  return false;
}

function projectRow(r: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of CACHED_COLUMNS) {
    const v = r[col];
    if (v !== undefined && v !== '') out[col] = v;
  }
  return out;
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
 * Only OnDemand rows of relevant product families are kept, projected to the
 * columns the estimators read — the cache stays a few MB instead of hundreds.
 */
export async function fetchAwsOfferRows(
  offerCode: string,
  region: string,
  noCache: boolean,
  opts: { requireMinTypes?: { min: number; what: string } } = {},
): Promise<Record<string, string>[]> {
  const cacheKey = `aws-rows-v2-${offerCode}-${region}`;
  const { data } = await fetchWithCache<Record<string, string>[]>({
    key: cacheKey,
    ttlMs: AWS_TTL_MS,
    noCache,
    fetcher: async () => {
      const csvUrl = await regionCsvUrl(offerCode, region);
      const csv = await downloadResumable(csvUrl);
      return parseAwsCsvRows(csv).filter(relevantRow).map(projectRow);
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
