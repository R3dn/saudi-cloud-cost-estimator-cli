import type { ServiceEstimateOptions } from '../../core/types.js';
import type { NetworkEstimate, NetworkInput } from './types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { normalizeMonthly, componentConverter } from '../../core/normalization.js';
import { awsTiers, tieredCost, firstPaidRate } from '../../core/tiers.js';
import { fetchAwsOfferRows, bestPrice } from '../../providers/awsCatalog.js';
import { providers } from '../../providers/index.js';

/**
 * Egress: the bulk CSV prices "Data Transfer Out to external" as volume tiers
 * (StartingRange/EndingRange in GB) — e.g. me-south-1 is $0.117/GB up to 10 TB,
 * then cheaper per tier. tieredCost applies each rate only to the volume inside
 * its window, so small volumes pay the first-tier rate and huge volumes get the
 * tiered discount, matching the provider's own calculator. The CSV's
 * "Global-DataTransfer-Out-Bytes" 100 GB free row is the 12-month Free Tier
 * promotion, not steady-state pricing — deliberately excluded.
 */
async function fetchAwsEgressTiers(region: string, noCache: boolean) {
  const rows = await fetchAwsOfferRows('AWSDataTransfer', region, noCache);
  const usage = (r: Record<string, string>) => r['usageType'] ?? r['Usage Type'] ?? '';
  const tierRows = rows.filter(
    (r) =>
      r['Product Family'] === 'Data Transfer' &&
      r['Transfer Type'] === 'AWS Outbound' &&
      r['To Location'] === 'External' &&
      r['Unit'] === 'GB' &&
      /^[\w-]*DataTransfer-Out-Bytes$/i.test(usage(r)) &&
      !/ABytes/i.test(usage(r)),
  );
  if (tierRows.length === 0) {
    throw new Error(`AWS egress price not found in ${region}`);
  }
  return {
    tiers: awsTiers(tierRows, (r) => Number(r['StartingRange'] ?? r['Starting Range'] ?? 0), (r) => Number(r['PricePerUnit'])),
    skuRef: 'DataTransfer-Out-Bytes',
  };
}

/**
 * Load balancer: the EC2 offer lists application/network LB hours under
 * Product Family "Load Balancer-Application" / "Load Balancer-Network" — the
 * plain "Load Balancer" family is the legacy classic LB. Prefer the
 * application LB rate (same price as network in the bulk CSV).
 */
async function fetchAwsLbHourly(region: string, noCache: boolean): Promise<number> {
  const rows = await fetchAwsOfferRows('AmazonEC2', region, noCache);
  const usageOf = (r: Record<string, string>) => r['usageType'] ?? r['Usage Type'] ?? '';
  const p = bestPrice(
    rows,
    (r) =>
      /LoadBalancerUsage/i.test(usageOf(r)) &&
      (r['Product Family'] === 'Load Balancer-Application' || r['Product Family'] === 'Load Balancer-Network') &&
      r['Unit'] === 'Hrs',
  );
  if (p === null) throw new Error(`AWS load balancer price not found in ${region}`);
  return p;
}

async function fetchAwsNatHourly(region: string, noCache: boolean): Promise<number> {
  const rows = await fetchAwsOfferRows('AmazonEC2', region, noCache);
  const p = bestPrice(
    rows,
    (r) =>
      r['Product Family'] === 'NAT Gateway' &&
      /NatGateway-Hours/i.test(r['usageType'] ?? r['Usage Type'] ?? '') &&
      r['Unit'] === 'Hrs',
  );
  if (p === null) throw new Error(`AWS NAT Gateway price not found in ${region}`);
  return p;
}

export async function estimateAwsNetwork(
  region: string,
  input: NetworkInput,
  opts: ServiceEstimateOptions,
): Promise<NetworkEstimate> {
  const [egress, lbRate, natRate] = await Promise.all([
    fetchAwsEgressTiers(region, opts.noCache),
    fetchAwsLbHourly(region, opts.noCache),
    fetchAwsNatHourly(region, opts.noCache),
  ]);
  const egressMonthly = tieredCost(egress.tiers, input.egressGb);
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
  const conv = componentConverter('USD', opts.currency, fx.sarPerUsd);

  const warnings: string[] = [];
  if (input.egressGb > 0 && egress.tiers[0]!.rate === 0) {
    warnings.push(`Egress: first ${egress.tiers[0]!.rangeMax} GB/month free, remainder billed at ${firstPaidRate(egress.tiers)} USD/GB.`);
  }
  warnings.push('NAT Gateway data processing ($0.045/GB) not included; add to egress if applicable.');

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
      egress: {
        monthly: conv(egressMonthly),
        source: 'live',
        skuRef: `${egress.skuRef} outbound to external (tiered per GB)`,
      },
      loadBalancer: { monthly: conv(lbMonthly), source: 'live', skuRef: 'Application/Network Load Balancer hours' },
      nat: { monthly: conv(natMonthly), source: 'live', skuRef: 'NAT Gateway hours' },
    },
    warnings,
  };
}
