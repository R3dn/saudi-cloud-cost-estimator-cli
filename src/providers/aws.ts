import type { EstimateOptions, PriceQuote, Provider, SizeSpec } from '../core/types.js';
import { fetchAwsOfferRows, bestPrice, MIN_INSTANCE_TYPES } from './awsCatalog.js';

export const awsProvider: Provider = {
  id: 'aws',
  name: 'Amazon Web Services',
  regions: [
    {
      id: 'me-south-1',
      name: 'Middle East (Bahrain)',
      country: 'BH',
      note: 'Nearest live region to KSA; an AWS Saudi Arabia region has been announced.',
    },
  ],
  async getHourlyPrice(region: string, size: SizeSpec, opts: EstimateOptions): Promise<PriceQuote> {
    const prices = await fetchAwsOnDemandPrices(region, opts.noCache);
    const entry = prices.get(size.instance);
    if (entry === undefined) {
      throw new Error(`AWS ${size.instance} not found in ${region} on-demand Linux pricing`);
    }
    return {
      provider: 'aws',
      region,
      instance: size.instance,
      hourly: entry.hourly,
      listedCurrency: 'USD',
      vcpu: entry.vcpu ?? size.vcpu,
      gb: entry.gb ?? size.gb,
      source: 'live',
      skuRef: `${size.instance} (AmazonEC2 on-demand Linux shared)`,
    };
  },
};

export interface AwsInstanceSpec {
  hourly: number;
  vcpu?: number;
  gb?: number;
  gpu?: { count: number; model: string };
}

/**
 * Map of on-demand Linux shared-tenancy instance type to lowest hourly price and
 * listed specs, from the bulk-pricing CSV. Guarded by MIN_INSTANCE_TYPES: a
 * truncated parse is refused, never used.
 */
export async function fetchAwsOnDemandPrices(region: string, noCache: boolean): Promise<Map<string, AwsInstanceSpec>> {
  const rows = await fetchAwsOfferRows('AmazonEC2', region, noCache, {
    requireMinTypes: { min: MIN_INSTANCE_TYPES, what: 'instance types' },
  });
  const prices = new Map<string, AwsInstanceSpec>();
  for (const r of rows) {
    if (
      r['TermType'] === 'OnDemand' &&
      r['Operating System'] === 'Linux' &&
      r['Tenancy'] === 'Shared' &&
      r['CapacityStatus'] === 'Used' &&
      r['Pre Installed S/W'] === 'NA' &&
      r['Instance Type'] &&
      r['Region Code'] === region
    ) {
      const price = bestPrice([r], () => true);
      if (price === null) continue;
      const existing = prices.get(r['Instance Type']);
      if (existing === undefined || price < existing.hourly) {
        prices.set(r['Instance Type'], {
          hourly: price,
          vcpu: parsePositiveInt(r['vCPU']),
          gb: parseGiB(r['Memory']),
          gpu: parseGpu(r['GPU'], r['GPU Model'] ?? ''),
        });
      }
    }
  }
  return prices;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** AWS lists memory as "16 GiB"; converts to GB for display. */
function parseGiB(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /^([\d.]+)\s*GiB/i.exec(raw);
  if (!m) return undefined;
  const gib = Number(m[1]);
  return Number.isFinite(gib) && gib > 0 ? gib : undefined;
}

function parseGpu(count: string | undefined, model: string | undefined): { count: number; model: string } | undefined {
  const n = parsePositiveInt(count);
  if (n === undefined || !model) return undefined;
  return { count: n, model };
}
