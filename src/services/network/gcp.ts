import type { ServiceEstimateOptions } from '../../core/types.js';
import type { GcpSku, PriceTier } from '../../core/types.js';
import type { NetworkEstimate, NetworkInput } from './types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { normalizeMonthly, componentConverter } from '../../core/normalization.js';
import { tieredCost } from '../../core/tiers.js';
import { fetchGcpSkus, requireGcpKey, skuPrice, GCP_COMPUTE_SERVICE } from '../../providers/gcpCatalog.js';
import { providers } from '../../providers/index.js';

/**
 * GCP egress SKUs carry their own volume tiers in pricingInfo.tieredRates
 * (startUsageAmount â†’ unitPrice). Convert a SKU into PriceTiers so the egress
 * volume is billed per tier instead of at one flat rate.
 */
function skuTiers(sku: GcpSku): PriceTier[] {
  const expr = sku.pricingInfo[0]?.pricingExpression;
  if (!expr) return [];
  const tiers: PriceTier[] = [];
  const rates = expr.tieredRates ?? [];
  for (let i = 0; i < rates.length; i++) {
    const rate = rates[i]!;
    const next = rates[i + 1];
    const price = Number(rate.unitPrice.units) + rate.unitPrice.nanos / 1e9;
    if (!Number.isFinite(price) || price < 0) continue;
    tiers.push({
      rangeMin: rate.startUsageAmount ?? 0,
      rangeMax: next?.startUsageAmount ?? Number.POSITIVE_INFINITY,
      rate: price,
    });
  }
  return tiers.sort((a, b) => a.rangeMin - b.rangeMin);
}

export async function estimateGcpNetwork(
  region: string,
  input: NetworkInput,
  opts: ServiceEstimateOptions,
): Promise<NetworkEstimate> {
  const apiKey = requireGcpKey(opts);
  const skus = await fetchGcpSkus(apiKey, GCP_COMPUTE_SERVICE, region, opts.noCache);

  let egressTiers: PriceTier[] = [];
  let lbPerHour = NaN;
  let natPerHour = NaN;
  for (const sku of skus) {
    if (sku.category.resourceGroup !== 'Network') continue;
    const price = skuPrice(sku);
    if (!Number.isFinite(price)) continue;
    if (/Internet egress/i.test(sku.description) && !/Premium|Tier 1/i.test(sku.description)) {
      const tiers = skuTiers(sku);
      if (tiers.length > 0 && (egressTiers.length === 0 || tiers[0]!.rate < egressTiers[0]!.rate)) egressTiers = tiers;
    }
    if (/Load Balancing/i.test(sku.description) && /hour/i.test(sku.pricingInfo[0]?.pricingExpression.usageUnit ?? '')) {
      if (Number.isNaN(lbPerHour) || price < lbPerHour) lbPerHour = price;
    }
    if (/NAT/i.test(sku.description) && /hour/i.test(sku.pricingInfo[0]?.pricingExpression.usageUnit ?? '')) {
      if (Number.isNaN(natPerHour) || price < natPerHour) natPerHour = price;
    }
  }

  if (egressTiers.length === 0) throw new Error(`GCP egress SKU not found for region ${region}`);
  if (Number.isNaN(lbPerHour)) throw new Error(`GCP load balancing SKU not found for region ${region}`);

  const egressMonthly = tieredCost(egressTiers, input.egressGb);
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
  const conv = componentConverter('USD', opts.currency, fx.sarPerUsd);

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
      egress: { monthly: conv(egressMonthly), source: 'live', skuRef: 'Internet egress (tiered per GB)' },
      loadBalancer: { monthly: conv(lbMonthly), source: 'live', skuRef: 'Network load balancing (per hour, cheapest SKU)' },
      nat: { monthly: conv(natMonthly), source: 'live', skuRef: 'Cloud NAT (per hour)' },
    },
    warnings,
  };
}

