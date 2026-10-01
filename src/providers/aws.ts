import type { EstimateOptions, PriceQuote, Provider, SizeSpec } from './types.js';
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
    const hourly = prices.get(size.instance);
    if (hourly === undefined) {
      throw new Error(`AWS ${size.instance} not found in ${region} on-demand Linux pricing`);
    }
    return {
      provider: 'aws',
      region,
      instance: size.instance,
      hourly,
      listedCurrency: 'USD',
      vcpu: size.vcpu,
      gb: size.gb,
      source: 'live',
      skuRef: `${size.instance} (AmazonEC2 on-demand Linux shared)`,
    };
  },
};

/**
 * Map of on-demand Linux shared-tenancy instance type to lowest hourly price, from the
 * bulk-pricing CSV. Guarded by MIN_INSTANCE_TYPES: a truncated parse is refused, never used.
 */
export async function fetchAwsOnDemandPrices(region: string, noCache: boolean): Promise<Map<string, number>> {
  const rows = await fetchAwsOfferRows('AmazonEC2', region, noCache, {
    requireMinTypes: { min: MIN_INSTANCE_TYPES, what: 'instance types' },
  });
  const prices = new Map<string, number>();
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
      if (existing === undefined || price < existing) {
        prices.set(r['Instance Type'], price);
      }
    }
  }
  return prices;
}

export { downloadResumable } from './awsDownload.js';
