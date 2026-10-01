import type { Currency, ProviderId, ServiceEstimateOptions } from '../../core/types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { convertCurrency, normalizeMonthly } from '../../core/normalization.js';
import { providers } from '../../providers/index.js';
import { assertRegion } from '../../providers/oci.js';
import type { DatabaseEstimate, DatabaseInput } from './types.js';
import { estimateOciDatabase } from './oci.js';
import { estimateAwsDatabase } from './aws.js';
import { estimateAzureDatabase } from './azure.js';
import { estimateGcpDatabase } from './gcp.js';

export interface DbRawEstimate {
  computeMonthly: number;
  storageMonthly: number;
  haMonthly: number;
  iopsMonthly: number;
  listedCurrency: Currency;
  skuRefs: { compute: string; storage: string };
  warnings: string[];
}

const estimators: Record<ProviderId, (input: DatabaseInput, opts: ServiceEstimateOptions) => Promise<DbRawEstimate>> = {
  aws: estimateAwsDatabase,
  azure: estimateAzureDatabase,
  gcp: estimateGcpDatabase,
  oci: estimateOciDatabase,
};

export async function databaseEstimate(
  providerId: ProviderId,
  input: DatabaseInput,
  opts: ServiceEstimateOptions,
): Promise<DatabaseEstimate> {
  const estimator = estimators[providerId];
  if (!estimator) throw new Error(`Unknown database provider "${providerId}"`);
  const provider = providers[providerId]!;
  assertRegion(provider.regions, input.region, provider.name);
  const region = provider.regions.find((r) => r.id === input.region);

  const raw = await estimator(input, opts);
  const fx = await getSarPerUsd(opts.noCache);
  const totalMonthly = raw.computeMonthly + raw.storageMonthly + raw.haMonthly + raw.iopsMonthly;
  const normalized = normalizeMonthly({
    monthly: totalMonthly,
    listedCurrency: raw.listedCurrency,
    displayCurrency: opts.currency,
    fxRate: fx.sarPerUsd,
    withVat: opts.vat,
    country: region?.country,
  });
  const conv = (amount: number) =>
    convertCurrency({ amount, listedCurrency: raw.listedCurrency, displayCurrency: opts.currency, fxRate: fx.sarPerUsd });

  const iopsSource = raw.iopsMonthly > 0 ? 'live' : 'assumption';
  return {
    provider: providerId,
    providerName: provider.name,
    region: input.region,
    regionName: region?.name ?? input.region,
    monthly: normalized.monthly,
    monthlyVat: normalized.monthlyVat,
    currency: opts.currency,
    fxRate: fx.sarPerUsd,
    nativeSar: normalized.nativeSar,
    components: {
      compute: { monthly: conv(raw.computeMonthly), source: 'live', skuRef: raw.skuRefs.compute },
      storage: { monthly: conv(raw.storageMonthly), source: 'live', skuRef: raw.skuRefs.storage },
      iops: { monthly: conv(raw.iopsMonthly), source: iopsSource, skuRef: raw.iopsMonthly > 0 ? 'RDS provisioned IOPS' : 'not requested' },
      ha: { monthly: conv(raw.haMonthly), source: 'live', skuRef: input.ha ? 'HA delta' : 'not requested' },
    },
    warnings: raw.warnings,
  };
}

export interface DatabaseEstimateArgs {
  providerId: ProviderId;
  input: DatabaseInput;
  json?: boolean;
}

export async function runDatabaseEstimate(opts: ServiceEstimateOptions, args: DatabaseEstimateArgs): Promise<void> {
  const result = await databaseEstimate(args.providerId, args.input, opts);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { renderServiceEstimate } = await import('../../ui/tables.js');
  renderServiceEstimate(result, [
    ['Engine', args.input.engine],
    ['Tier', args.input.tier],
    ['Storage', `${args.input.storageGb} GB`],
    ['HA', args.input.ha ? 'Yes' : 'No'],
  ]);
}

