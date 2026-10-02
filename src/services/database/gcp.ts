import type { Currency, ServiceEstimateOptions } from '../../core/types.js';
import type { DatabaseInput } from './types.js';
import { ASSUMED_RATES } from '../../core/assumptions.js';
import { fetchGcpSkus, requireGcpKey, skuPrice, GCP_CLOUD_SQL_SERVICE } from '../../providers/gcpCatalog.js';

const TIER_NAME: Record<string, string> = {
  small: 'db-f1-micro',
  medium: 'db-g1-small',
  large: 'db-n1-standard-2',
};

/**
 * Cloud SQL prices from the Billing Catalog API. The API does not expose Cloud SQL
 * instance-tier SKUs in a mappable form, so matching tiers is unsupported: we fail
 * loudly instead of substituting invented prices. Users who need a GCP database line
 * can model it as compute.
 */
export async function estimateGcpDatabase(
  input: DatabaseInput,
  opts: ServiceEstimateOptions,
): Promise<{
  computeMonthly: number;
  storageMonthly: number;
  haMonthly: number;
  iopsMonthly: number;
  listedCurrency: Currency;
  skuRefs: { compute: string; storage: string };
  warnings: string[];
}> {
  const apiKey = requireGcpKey(opts);
  const instanceName = TIER_NAME[input.tier];
  if (!instanceName) throw new Error(`Unknown tier "${input.tier}"`);

  const skus = await fetchGcpSkus(apiKey, GCP_CLOUD_SQL_SERVICE, input.region, opts.noCache);
  let compute: number | undefined;
  let storage: number | undefined;
  for (const sku of skus) {
    const price = skuPrice(sku);
    if (!Number.isFinite(price)) continue;
    if (sku.description.includes(instanceName) && /per hour/i.test(sku.pricingInfo[0]?.pricingExpression.usageUnit ?? '')) {
      compute = price;
    }
    if (/storage/i.test(sku.description) && /gb/i.test(sku.pricingInfo[0]?.pricingExpression.usageUnit ?? '')) {
      if (storage === undefined || price < storage) storage = price;
    }
  }
  if (compute === undefined) {
    throw new Error(
      `GCP Cloud SQL tier "${input.tier}" (${instanceName}) is not exposed by the Billing Catalog API for ${input.region}; ` +
        `refusing to guess a price — model it as compute or check current Cloud SQL pricing manually`,
    );
  }

  const haHourly = input.ha ? compute : 0;
  const assumedStorage = ASSUMED_RATES.gcpCloudSqlStoragePerGbMonthUsd;
  return {
    computeMonthly: compute * opts.hours,
    storageMonthly: (storage ?? assumedStorage.rate) * input.storageGb,
    haMonthly: haHourly * opts.hours,
    iopsMonthly: 0,
    listedCurrency: 'USD',
    skuRefs: { compute: instanceName, storage: storage !== undefined ? 'Cloud SQL storage per GB-month' : assumedStorage.skuRef },
    warnings: storage === undefined
      ? [`Cloud SQL storage rate assumed at $${assumedStorage.rate}/GB-month (no matching SKU found).`, 'HA modelled as a full standby replica at 100% of compute cost (assumption).']
      : ['HA modelled as a full standby replica at 100% of compute cost (assumption).'],
  };
}
