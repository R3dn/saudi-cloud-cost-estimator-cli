import type { ServiceEstimateOptions } from '../../core/types.js';
import type { NetworkEstimate, NetworkInput } from './types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { normalizeMonthly, convertCurrency } from '../../core/normalization.js';
import { fetchAzureItems } from '../../providers/azureCatalog.js';
import { providers } from '../../providers/index.js';

/**
 * Azure LB and NAT Gateway meters are not exposed by the retail prices API for all
 * regions; uaenorth currently has neither. These are the published global list
 * prices, explicitly labeled as assumptions — never presented as live API prices.
 */
const AZURE_LB_LIST_HOURLY = 0.0065;
const AZURE_NAT_LIST_HOURLY = 0.045;

async function fetchAzureRate(filter: string, unitMeasures: string[], noCache: boolean): Promise<number | null> {
  const items = await fetchAzureItems(filter, noCache);
  let best: number | null = null;
  for (const i of items) {
    if (unitMeasures.includes(i.unitOfMeasure) && !/Windows|Spot|Low Priority/i.test(i.skuName)) {
      if (best === null || i.retailPrice < best) best = i.retailPrice;
    }
  }
  return best;
}

export async function estimateAzureNetwork(
  region: string,
  input: NetworkInput,
  opts: ServiceEstimateOptions,
): Promise<NetworkEstimate> {
  const egressFilter = `serviceName eq 'Bandwidth' and armRegionName eq '${region}' and priceType eq 'Consumption'`;

  const [egressRate, lbRateLive, natRateLive] = await Promise.all([
    fetchAzureRate(egressFilter, ['1 GB', 'GB', '1/Gb'], opts.noCache),
    // LB/NAT meters are not in the retail API for this region; query anyway in case they appear.
    fetchAzureRate(`serviceName eq 'Load Balancer' and armRegionName eq '${region}' and priceType eq 'Consumption'`, ['1 Hour'], opts.noCache),
    fetchAzureRate(`serviceName eq 'NAT Gateway' and armRegionName eq '${region}' and priceType eq 'Consumption'`, ['1 Hour'], opts.noCache),
  ]);

  const warnings: string[] = [];
  if (egressRate === null) {
    throw new Error(`Azure egress (Bandwidth) price not found in ${region}`);
  }
  const lbRate = lbRateLive ?? AZURE_LB_LIST_HOURLY;
  const natRate = natRateLive ?? AZURE_NAT_LIST_HOURLY;
  const lbSource = lbRateLive !== null ? 'live' : 'assumption';
  const natSource = natRateLive !== null ? 'live' : 'assumption';
  if (lbRateLive === null) {
    warnings.push(`Azure LB hourly meter not exposed by the retail API for ${region}; using published list price $${AZURE_LB_LIST_HOURLY}/hr (assumption).`);
  }
  if (input.nat && natRateLive === null) {
    warnings.push(`Azure NAT Gateway hourly meter not exposed by the retail API for ${region}; using published list price $${AZURE_NAT_LIST_HOURLY}/hr plus $0.045/GB data processing (assumption).`);
  }

  const egressMonthly = input.egressGb * egressRate;
  const lbMonthly = input.loadBalancers * lbRate * opts.hours;
  const natMonthly = input.nat ? natRate * opts.hours : 0;
  const totalMonthly = egressMonthly + lbMonthly + natMonthly;

  const fx = await getSarPerUsd(opts.noCache);
  const regionInfo = providers.azure.regions.find((r) => r.id === region);
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
    provider: 'azure',
    providerName: providers.azure.name,
    region,
    regionName: regionInfo?.name ?? region,
    monthly: normalized.monthly,
    monthlyVat: normalized.monthlyVat,
    currency: opts.currency,
    fxRate: fx.sarPerUsd,
    nativeSar: false,
    components: {
      egress: { monthly: conv(egressMonthly), source: 'live', skuRef: 'Bandwidth data transfer out (per GB)' },
      loadBalancer: {
        monthly: conv(lbMonthly),
        source: lbSource,
        skuRef: lbRateLive !== null ? 'Load Balancer hours (retail API)' : 'Standard LB published list $0.0065/hr',
      },
      nat: {
        monthly: conv(natMonthly),
        source: natSource,
        skuRef: natRateLive !== null ? 'NAT Gateway hours (retail API)' : 'NAT Gateway published list $0.045/hr',
      },
    },
    warnings,
  };
}
