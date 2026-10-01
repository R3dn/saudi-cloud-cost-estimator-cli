import type { ServiceEstimateOptions } from '../../core/types.js';
import type { NetworkEstimate, NetworkInput } from './types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { normalizeMonthly, convertCurrency } from '../../core/normalization.js';
import { fetchGcpSkus, requireGcpKey, skuPrice, GCP_COMPUTE_SERVICE } from '../../providers/gcpCatalog.js';
import { providers } from '../../providers/index.js';

export async function estimateGcpNetwork(
  region: string,
  input: NetworkInput,
  opts: ServiceEstimateOptions,
): Promise<NetworkEstimate> {
  const apiKey = requireGcpKey(opts);
  const skus = await fetchGcpSkus(apiKey, GCP_COMPUTE_SERVICE, region, opts.noCache);

  let egressPerGb = NaN;
  let lbPerHour = NaN;
  let natPerHour = NaN;
  for (const sku of skus) {
    if (sku.category.resourceGroup !== 'Network') continue;
    const price = skuPrice(sku);
    if (!Number.isFinite(price)) continue;
    if (/Internet egress/i.test(sku.description)) {
      if (Number.isNaN(egressPerGb) || price < egressPerGb) egressPerGb = price;
    }
    if (/Load Balancing/i.test(sku.description)) {
      if (Number.isNaN(lbPerHour) || price < lbPerHour) lbPerHour = price;
    }
    if (/NAT/i.test(sku.description) && /hour/i.test(sku.pricingInfo[0]?.pricingExpression.usageUnit ?? '')) {
      if (Number.isNaN(natPerHour) || price < natPerHour) natPerHour = price;
    }
  }

  if (Number.isNaN(egressPerGb)) throw new Error(`GCP egress SKU not found for region ${region}`);
  if (Number.isNaN(lbPerHour)) throw new Error(`GCP load balancing SKU not found for region ${region}`);

  const egressMonthly = input.egressGb * egressPerGb;
  const lbMonthly = input.loadBalancers * lbPerHour * opts.hours;
  const natMonthly = input.nat ? natPerHour * opts.hours : 0;
  const totalMonthly = egressMonthly + lbMonthly + natMonthly;

  const warnings: string[] = [];
  if (input.nat && Number.isNaN(natPerHour)) {
    throw new Error(`GCP NAT SKU not found for region ${region}`);
  }
  warnings.push('GCP load balancing includes per-GB data processing not itemized here (billed separately).');

  const fx = await getSarPerUsd(opts.noCache);
  const regionInfo = providers.gcp.regions.find((r) => r.id === region);
  const normalized = normalizeMonthly({
    monthly: totalMonthly,
    listedCurrency: 'USD',
    displayCurrency: opts.currency,
    fxRate: fx.sarPerUsd,
    withVat: opts.vat,
    country: regionInfo?.country,
  });
  const conv = (amount: number) =>
    convertCurrency({ amount, listedCurrency: 'USD', displayCurrency: opts.currency, fxRate: fx.sarPerUsd });

  return {
    provider: 'gcp',
    providerName: providers.gcp.name,
    region,
    regionName: regionInfo?.name ?? region,
    monthly: normalized.monthly,
    monthlyVat: normalized.monthlyVat,
    currency: opts.currency,
    fxRate: fx.sarPerUsd,
    nativeSar: false,
    components: {
      egress: { monthly: conv(egressMonthly), source: 'live', skuRef: 'Internet egress (per GB, first tier)' },
      loadBalancer: { monthly: conv(lbMonthly), source: 'live', skuRef: 'Network load balancing (per hour, cheapest SKU)' },
      nat: { monthly: conv(natMonthly), source: 'live', skuRef: 'Cloud NAT (per hour)' },
    },
    warnings,
  };
}

