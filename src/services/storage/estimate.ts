import type { Component, PriceTier, ProviderId, ServiceEstimateOptions } from '../../core/types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { normalizeMonthly, componentConverter } from '../../core/normalization.js';
import { tieredCost } from '../../core/tiers.js';
import { providers } from '../../providers/index.js';
import { assertRegion } from '../../core/regions.js';
import type { StorageEstimate, StorageInput } from './types.js';
import { ociStorageRates } from './oci.js';
import { awsStorageRates } from './aws.js';
import { azureStorageRates } from './azure.js';
import { gcpStorageRates } from './gcp.js';

interface FlatRates {
  objectPerGbMonth: number;
  blockPerGbMonth: number;
  filePerGbMonth: number;
  listedCurrency: StorageEstimate['currency'];
  skuRefs: { object: string; block: string; file: string };
  objectTiers?: PriceTier[];
  warnings?: string[];
  fileSource?: 'live' | 'assumption';
  blockSource?: 'live' | 'assumption';
}

export async function storageEstimate(
  providerId: ProviderId,
  input: StorageInput,
  opts: ServiceEstimateOptions,
): Promise<StorageEstimate> {
  const provider = providers[providerId];
  if (!provider) throw new Error(`Unknown storage provider "${providerId}"`);
  const region = provider.regions.find((r) => r.id === input.region);
  assertRegion(provider.regions, input.region, provider.name);

  const fx = await getSarPerUsd(opts.noCache);
  const warnings: string[] = [];

  let objectMonthly: number;
  let blockMonthly: number;
  let fileMonthly: number;
  let listedCurrency: StorageEstimate['currency'];
  let objectComp: Component;
  let blockComp: Component;
  let fileComp: Component;

  if (providerId === 'oci') {
    const rates = await ociStorageRates(input, opts);
    objectMonthly = rates.objectCost;
    blockMonthly = rates.blockCost;
    fileMonthly = rates.fileCost;
    listedCurrency = rates.listedCurrency;
    warnings.push(...rates.warnings);
    objectComp = { monthly: 0, source: 'live', skuRef: rates.skuRefs.object };
    blockComp = { monthly: 0, source: 'live', skuRef: rates.skuRefs.block };
    fileComp = { monthly: 0, source: 'live', skuRef: rates.skuRefs.file };
  } else {
    const rates: FlatRates =
      providerId === 'aws'
        ? await awsStorageRates(input, opts)
        : providerId === 'azure'
          ? await azureStorageRates(input, opts)
          : await gcpStorageRates(input, opts);
    // AWS S3 is volume-tiered (first 50 TB then cheaper); others are flat per GB.
    objectMonthly = rates.objectTiers
      ? tieredCost(rates.objectTiers, input.objectGb)
      : input.objectGb * rates.objectPerGbMonth;
    blockMonthly = input.blockGb * rates.blockPerGbMonth;
    fileMonthly = input.fileGb * rates.filePerGbMonth;
    listedCurrency = rates.listedCurrency;
    if (rates.warnings) warnings.push(...rates.warnings);
    const fileSource: 'live' | 'assumption' = rates.fileSource ?? 'live';
    const blockSource: 'live' | 'assumption' = rates.blockSource ?? 'live';
    objectComp = { monthly: 0, source: 'live', skuRef: rates.skuRefs.object };
    blockComp = { monthly: 0, source: blockSource, skuRef: rates.skuRefs.block };
    fileComp = { monthly: 0, source: fileSource, skuRef: rates.skuRefs.file };
    if (fileSource === 'assumption') {
      warnings.push('GCP Filestore rate is a built-in assumption (no matching SKU in the Billing Catalog API), not a live price.');
    }
  }

  const totalMonthly = objectMonthly + blockMonthly + fileMonthly;
  const norm = normalizeMonthly({
    monthly: totalMonthly,
    listedCurrency,
    displayCurrency: opts.currency,
    fxRate: fx.sarPerUsd,
    withVat: opts.vat,
    country: region?.country,
  });

  const conv = componentConverter(listedCurrency, opts.currency, fx.sarPerUsd);

  return {
    provider: providerId,
    providerName: provider.name,
    region: input.region,
    regionName: region?.name ?? input.region,
    monthly: norm.monthly,
    monthlyVat: norm.monthlyVat,
    currency: opts.currency,
    fxRate: fx.sarPerUsd,
    nativeSar: norm.nativeSar,
    components: {
      objectStorage: { ...objectComp, monthly: conv(objectMonthly) },
      blockStorage: { ...blockComp, monthly: conv(blockMonthly) },
      fileStorage: { ...fileComp, monthly: conv(fileMonthly) },
    },
    warnings,
  };
}
