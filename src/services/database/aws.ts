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

  const priceFor = (dep: string) =>
    bestPrice(
      rows,
      (r) =>
        r['TermType'] === 'OnDemand' &&
        r['Product Family'] === 'Database Instance' &&
        r['Instance Type'] === instanceType &&
        r['Database Engine'] === engineName &&
        r['Deployment Option'] === dep,
    );

  const singleAz = priceFor('Single-AZ');
  const multiAz = priceFor('Multi-AZ');
  if (singleAz === null) {
    throw new Error(`AWS RDS ${instanceType} ${engineName} not found in ${input.region}`);
  }
  if (input.ha && multiAz === null) {
    throw new Error(`AWS RDS ${instanceType} ${engineName} Multi-AZ not found in ${input.region}`);
  }

  const storageRate = bestPrice(
    rows,
    (r) =>
      r['TermType'] === 'OnDemand' &&
      r['Product Family'] === 'Database Storage' &&
      /gp/i.test((r['Volume Type'] ?? r['usageType'] ?? '').toLowerCase()) &&
      /gb/i.test((r['Unit'] ?? '').toLowerCase()) &&
      /mo/i.test((r['Unit'] ?? '').toLowerCase()),
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
    iopsMonthly: (input.iops ?? 0) * 0.1,
    listedCurrency: 'USD',
    skuRefs: {
      compute: `${instanceType} ${engineName} ${deployment}`,
      storage: 'RDS gp storage per GB-month',
    },
    warnings,
  };
}
