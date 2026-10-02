import type { Currency, ServiceEstimateOptions } from '../../core/types.js';
import type { DatabaseInput } from './types.js';
import { fetchAwsOfferRows, bestPrice } from '../../providers/awsCatalog.js';

const TIER_INSTANCE: Record<string, string> = {
  small: 'db.t3.micro',
  medium: 'db.t3.medium',
  large: 'db.m6i.xlarge',
};

const ENGINE_MAP: Record<string, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  sqlserver: 'sqlserver-ex',
  oracle: 'oracle-ee',
};

export async function estimateAwsDatabase(
  input: DatabaseInput,
  opts: ServiceEstimateOptions,
): Promise<{
  computeMonthly: number;
  storageMonthly: number;
  haMonthly: number;
  iopsMonthly: number;
  iopsSource: 'live' | 'assumption';
  iopsSkuRef: string;
  listedCurrency: Currency;
  skuRefs: { compute: string; storage: string };
  warnings: string[];
}> {
  const instanceType = TIER_INSTANCE[input.tier];
  const engineName = ENGINE_MAP[input.engine];
  if (!instanceType || !engineName) {
    throw new Error(`AWS RDS does not map engine "${input.engine}" tier "${input.tier}"`);
  }

  const rows = await fetchAwsOfferRows('AmazonRDS', input.region, opts.noCache);
  const deployment = input.ha ? 'Multi-AZ' : 'Single-AZ';

  const priceFor = (deploy: string) =>
    bestPrice(
      rows,
      (r) =>
        r['TermType'] === 'OnDemand' &&
        r['Product Family'] === 'Database Instance' &&
        r['Instance Type'] === instanceType &&
        r['Database Engine'] === engineName &&
        r['Deployment Option'] === deploy,
    );

  const singleAz = priceFor('Single-AZ');
  const multiAz = priceFor('Multi-AZ');
  if (singleAz === null) {
    throw new Error(`AWS RDS ${instanceType} ${engineName} not found in ${input.region}`);
  }
  if (input.ha && multiAz === null) {
    throw new Error(`AWS RDS ${instanceType} ${engineName} Multi-AZ not found in ${input.region}`);
  }

  const usageOf = (r: Record<string, string>) => r['usageType'] ?? r['Usage Type'] ?? '';
  const engineNameLower = engineName.toLowerCase();
  const storageDep = deployment;

  // gp3 storage: the RDS offer prices GP3 storage per engine and deployment option.
  const gp3Storage = bestPrice(
    rows,
    (r) =>
      r['TermType'] === 'OnDemand' &&
      r['Product Family'] === 'Database Storage' &&
      /gp3/i.test(r['Volume Type'] ?? '') &&
      r['Unit'] === 'GB-Mo' &&
      (r['Database Engine'] ?? '').toLowerCase() === engineNameLower &&
      r['Deployment Option'] === storageDep,
  );
  // Provisioned IOPS for gp3 (single-AZ baseline): live per-IOPS-month row.
  const gp3Iops = bestPrice(
    rows,
    (r) =>
      r['TermType'] === 'OnDemand' &&
      /GP3-PIOPS/i.test(usageOf(r)) &&
      r['Unit'] === 'IOPS-Mo' &&
      (r['Database Engine'] ?? '').toLowerCase() === engineNameLower &&
      r['Deployment Option'] === storageDep,
  );
  const storageRate = gp3Storage ?? bestPrice(
    rows,
    (r) =>
      r['TermType'] === 'OnDemand' &&
      r['Product Family'] === 'Database Storage' &&
      /gp/i.test((r['Volume Type'] ?? usageOf(r)).toLowerCase()) &&
      r['Unit'] === 'GB-Mo' &&
      (r['Database Engine'] ?? '').toLowerCase() === engineNameLower,
  );
  if (storageRate === null) {
    throw new Error(`AWS RDS gp storage price not found in ${input.region}`);
  }

  const haHourly = input.ha && multiAz !== null ? multiAz - singleAz : 0;
  const warnings: string[] = [];
  warnings.push('HA priced as the real RDS Multi-AZ to Single-AZ hourly delta.');

  return {
    computeMonthly: singleAz * opts.hours,
    storageMonthly: storageRate * input.storageGb,
    haMonthly: haHourly * opts.hours,
    iopsMonthly: gp3Iops !== null ? (input.iops ?? 0) * gp3Iops : 0,
    iopsSource: gp3Iops !== null ? ('live' as const) : ('assumption' as const),
    iopsSkuRef: gp3Iops !== null ? 'RDS gp3 provisioned IOPS (per IOPS-month)' : 'not priced by the API',
    listedCurrency: 'USD',
    skuRefs: {
      compute: `${instanceType} ${engineName} ${deployment}`,
      storage: gp3Storage !== null ? 'RDS gp3 storage per GB-month' : 'RDS gp storage per GB-month',
    },
    warnings,
  };
}
