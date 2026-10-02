import type { ServiceEstimateOptions } from '../../core/types.js';
import type { NetworkEstimate, NetworkInput } from './types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { normalizeMonthly, componentConverter } from '../../core/normalization.js';
import { tieredCost } from '../../core/tiers.js';
import { ASSUMED_RATES } from '../../core/assumptions.js';
import { fetchAzureItems } from '../../providers/azureCatalog.js';
import { providers } from '../../providers/index.js';

/**
 * Azure LB and NAT Gateway meters are not exposed by the retail prices API for all
 * regions; uaenorth currently has neither. These are the published global list
 * prices, explicitly labeled as assumptions â€” never presented as live API prices.
 */

async function fetchAzureRate(filter: string, unitMeasures: string[], noCache: boolean): Promise<number | null> {
  const items = await fetchAzureItems(filter, noCache);
  let best: number | null = null;
  for (const i of items) {
    if (unitMeasures.includes(i.unitOfMeasure) && !/Windows|Spot|Low Priority/i.test(i.skuName)) {
      if (i.retailPrice > 0 && (best === null || i.retailPrice < best)) best = i.retailPrice;
    }
  }
  return best;
}

/**
 * Egress: the retail API prices "Standard Data Transfer Out" as volume tiers via
 * tierMinimumUnits (GB) - first 100 GB free, then a descending rate schedule.
 * Multiple routing preferences publish their own schedules at the same
 * boundaries (default Microsoft Global Network vs the cheaper opt-in Internet
 * preference). Schedules are never mixed: billing uses the default-routing
 * schedule (what a standard deployment pays) and the cheaper opt-in is surfaced
 * as a warning.
 */
async function fetchAzureEgressTiers(
  region: string,
  noCache: boolean,
): Promise<{ tiers: { rangeMin: number; rangeMax: number; rate: number }[]; cheaperPreference: boolean }> {
  const filter = `serviceName eq 'Bandwidth' and armRegionName eq '${region}' and priceType eq 'Consumption'`;
  const items = await fetchAzureItems(filter, noCache);
  const rows = items.filter(
    (i) => i.meterName === 'Standard Data Transfer Out' && (i.unitOfMeasure ?? '').toLowerCase().includes('gb'),
  );
  if (rows.length === 0) {
    throw new Error(`Azure egress (Bandwidth) price not found in ${region}`);
  }

  // One boundary -> rate schedule per meter (productName).
  const schedules = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (!Number.isFinite(r.retailPrice) || r.retailPrice < 0) continue;
    const key = r.productName ?? '';
    let schedule = schedules.get(key);
    if (!schedule) {
      schedule = new Map<number, number>();
      schedules.set(key, schedule);
    }
    const min = r.tierMinimumUnits ?? 0;
    const existing = schedule.get(min);
    if (existing === undefined || r.retailPrice < existing) schedule.set(min, r.retailPrice);
  }

  const firstPaidRate = (schedule: Map<number, number>): number => {
    const rates = [...schedule.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, rate]) => rate)
      .filter((rate) => rate > 0);
    return rates[0] ?? 0;
  };

  const entries = [...schedules.entries()];
  // Default routing (highest first-paid rate, e.g. "Rtn Preference: MGN") is
  // what a standard deployment pays; cheaper schedules are opt-in preferences.
  const defaultEntry = entries.reduce((a, b) => (firstPaidRate(b[1]) > firstPaidRate(a[1]) ? b : a));
  const defaultSchedule = defaultEntry[1];
  const cheaperPreference = entries.some(
    ([name, schedule]) => name !== defaultEntry[0] && firstPaidRate(schedule) < firstPaidRate(defaultSchedule),
  );

  const mins = [...defaultSchedule.keys()].sort((a, b) => a - b);
  const tiers = mins.map((min, i) => ({
    rangeMin: min,
    rangeMax: i + 1 < mins.length ? mins[i + 1]! : Number.POSITIVE_INFINITY,
    rate: defaultSchedule.get(min)!,
  }));
  if (tiers.length === 0) {
    throw new Error(`Azure egress (Bandwidth) price not found in ${region}`);
  }
  return { tiers, cheaperPreference };
}

export async function estimateAzureNetwork(
  region: string,
  input: NetworkInput,
  opts: ServiceEstimateOptions,
): Promise<NetworkEstimate> {
  const [egress, lbRateLive, natRateLive] = await Promise.all([
    fetchAzureEgressTiers(region, opts.noCache),
    // LB/NAT meters are not in the retail API for this region; query anyway in case they appear.
    fetchAzureRate(`serviceName eq 'Load Balancer' and armRegionName eq '${region}' and priceType eq 'Consumption'`, ['1 Hour'], opts.noCache),
    fetchAzureRate(`serviceName eq 'NAT Gateway' and armRegionName eq '${region}' and priceType eq 'Consumption'`, ['1 Hour'], opts.noCache),
  ]);

  const warnings: string[] = [];
  const lbRate = lbRateLive ?? ASSUMED_RATES.azureLoadBalancerHourlyUsd.rate;
  const natRate = natRateLive ?? ASSUMED_RATES.azureNatGatewayHourlyUsd.rate;
  const lbSource = lbRateLive !== null ? 'live' : 'assumption';
  const natSource = natRateLive !== null ? 'live' : 'assumption';
  if (lbRateLive === null) {
    warnings.push(`Azure LB hourly meter not exposed by the retail API for ${region}; using ${ASSUMED_RATES.azureLoadBalancerHourlyUsd.skuRef} (assumption).`);
  }
  if (input.nat && natRateLive === null) {
    warnings.push(`Azure NAT Gateway hourly meter not exposed by the retail API for ${region}; using ${ASSUMED_RATES.azureNatGatewayHourlyUsd.skuRef} plus $0.045/GB data processing (assumption).`);
  }

  const egressMonthly = tieredCost(egress.tiers, input.egressGb);
  if (input.egressGb > 0 && egress.tiers[0]!.rate === 0) {
    warnings.push(`Egress: first ${egress.tiers[0]!.rangeMax} GB/month free, remainder billed at ${egress.tiers.find((t) => t.rate > 0)?.rate ?? 0} USD/GB (default Microsoft Global Network routing).`);
  }
  if (input.egressGb > 0 && egress.cheaperPreference) {
    warnings.push('Azure publishes cheaper egress rates for the opt-in Internet routing preference; the default (MGN) schedule is billed here.');
  }
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
  const conv = componentConverter('USD', opts.currency, fx.sarPerUsd);

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
      egress: { monthly: conv(egressMonthly), source: 'live', skuRef: 'Standard Data Transfer Out, default routing (tiered per GB)' },
      loadBalancer: {
        monthly: conv(lbMonthly),
        source: lbSource,
        skuRef: lbRateLive !== null ? 'Load Balancer hours (retail API)' : ASSUMED_RATES.azureLoadBalancerHourlyUsd.skuRef,
      },
      nat: {
        monthly: conv(natMonthly),
        source: natSource,
        skuRef: natRateLive !== null ? 'NAT Gateway hours (retail API)' : ASSUMED_RATES.azureNatGatewayHourlyUsd.skuRef,
      },
    },
    warnings,
  };
}
