import type { ServiceEstimateOptions } from '../../core/types.js';
import type { NetworkEstimate, NetworkInput } from './types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { normalizeMonthly, convertCurrency } from '../../core/normalization.js';
import { awsProvider } from '../../providers/aws.js';
import { fetchAwsOfferRows, bestPrice } from '../../providers/awsCatalog.js';
import { providers } from '../../providers/index.js';

async function fetchAwsEgressPerGb(region: string, noCache: boolean): Promise<number> {
  const rows = await fetchAwsOfferRows('AWSDataTransfer', region, noCache);
  const p = bestPrice(
    rows,
    (r) =>
      r['Product Family'] === 'Data Transfer' &&
      /Outbound/.test(r['Transfer Type'] ?? '') &&
      r['To Location'] === 'External' &&
      r['Unit'] === 'GB' &&
      (r['Starting Range'] === '0' || !r['Starting Range']),
  );
  if (p === null) throw new Error(`AWS egress price not found in ${region}`);
  return p;
}

async function fetchAwsLbHourly(region: string, noCache: boolean): Promise<number> {
  const rows = await fetchAwsOfferRows('AmazonEC2', region, noCache);
  const p = bestPrice(
    rows,
    (r) =>
      r['Product Family'] === 'Load Balancer' &&
      /LoadBalancerUsage/i.test(r['UsageType'] ?? r['usageType'] ?? '') &&
      r['Unit'] === 'Hrs',
  );
  if (p === null) throw new Error(`AWS load balancer price not found in ${region}`);
  return p;
}

async function fetchAwsNatHourly(region: string, noCache: boolean): Promise<number> {
  for (const offerCode of ['AmazonEC2', 'AmazonVPC']) {
    const rows = await fetchAwsOfferRows(offerCode, region, noCache);
    const p = bestPrice(
      rows,
      (r) =>
        r['Product Family'] === 'NAT Gateway' &&
        /NatGateway-Hours/i.test(r['UsageType'] ?? r['usageType'] ?? '') &&
        r['Unit'] === 'Hrs',
    );
    if (p !== null) return p;
  }
  throw new Error(`AWS NAT Gateway price not found in ${region}`);
}

export async function estimateAwsNetwork(
  region: string,
  input: NetworkInput,
  opts: ServiceEstimateOptions,
): Promise<NetworkEstimate> {
  const [egressRate, lbRate, natRate] = await Promise.all([
    fetchAwsEgressPerGb(region, opts.noCache),
    fetchAwsLbHourly(region, opts.noCache),
    fetchAwsNatHourly(region, opts.noCache),
  ]);
  const egressMonthly = input.egressGb * egressRate;
  const lbMonthly = input.loadBalancers * lbRate * opts.hours;
  const natMonthly = input.nat ? natRate * opts.hours : 0;
  const totalMonthly = egressMonthly + lbMonthly + natMonthly;

  const fx = await getSarPerUsd(opts.noCache);
  const regionInfo = providers.aws.regions.find((r) => r.id === region);
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
    provider: 'aws',
    providerName: providers.aws.name,
    region,
    regionName: regionInfo?.name ?? region,
    monthly: normalized.monthly,
    monthlyVat: normalized.monthlyVat,
    currency: opts.currency,
    fxRate: fx.sarPerUsd,
    nativeSar: false,
    components: {
      egress: { monthly: conv(egressMonthly), source: 'live', skuRef: 'AWSDataTransfer outbound to external (per GB)' },
      loadBalancer: { monthly: conv(lbMonthly), source: 'live', skuRef: 'ELB load balancer hours' },
      nat: { monthly: conv(natMonthly), source: 'live', skuRef: 'NAT Gateway hours' },
    },
    warnings: ['NAT Gateway data processing ($0.045/GB) not included; add to egress if applicable.'],
  };
}

export { awsProvider };

