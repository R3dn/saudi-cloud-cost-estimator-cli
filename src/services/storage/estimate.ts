import type { Component, ProviderId, ServiceEstimateOptions } from '../../core/types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { convertCurrency, normalizeMonthly } from '../../core/normalization.js';
import { providers } from '../../providers/index.js';
import { assertRegion } from '../../providers/oci.js';
import type { StorageEstimate, StorageInput } from './types.js';
import { ociStorageRates } from './oci.js';
import { awsStorageRates } from './aws.js';
import { azureStorageRates } from './azure.js';
import { gcpStorageRates } from './gcp.js';

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
    const rates =
      providerId === 'aws'
        ? await awsStorageRates(input, opts)
        : providerId === 'azure'
          ? await azureStorageRates(input, opts)
          : await gcpStorageRates(input, opts);
    objectMonthly = input.objectGb * rates.objectPerGbMonth;
    blockMonthly = input.blockGb * rates.blockPerGbMonth;
    fileMonthly = input.fileGb * rates.filePerGbMonth;
    listedCurrency = rates.listedCurrency;
    if ('warnings' in rates) warnings.push(...(rates as { warnings: string[] }).warnings);
    const fileSource: 'live' | 'assumption' = 'fileSource' in rates ? (rates as { fileSource: 'live' | 'assumption' }).fileSource : 'live';
    const blockSource: 'live' | 'assumption' = 'blockSource' in rates ? (rates as { blockSource: 'live' | 'assumption' }).blockSource : 'live';
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

  const conv = (amount: number) =>
    convertCurrency({ amount, listedCurrency, displayCurrency: opts.currency, fxRate: fx.sarPerUsd });

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
