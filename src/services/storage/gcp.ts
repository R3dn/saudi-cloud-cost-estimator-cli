import type { Currency } from '../../core/types.js';
import type { StorageInput } from './types.js';
import { ASSUMED_RATES } from '../../core/assumptions.js';
import { fetchGcpSkus, requireGcpKey, skuPrice, GCP_CLOUD_STORAGE_SERVICE, GCP_COMPUTE_SERVICE } from '../../providers/gcpCatalog.js';

/**
 * GCP storage monthly rates from the Cloud Billing Catalog: Cloud Storage standard,
 * PD-SSD. Filestore standard is not exposed via a matching SKU, so it is a labeled
 * built-in assumption (source: 'assumption'), never presented as a live price.
 */
export async function gcpStorageRates(
  input: StorageInput,
  opts: { currency: Currency; noCache: boolean; gcpKey?: string },
): Promise<{
  objectPerGbMonth: number;
  blockPerGbMonth: number;
  filePerGbMonth: number;
  listedCurrency: Currency;
  skuRefs: { object: string; block: string; file: string };
  fileSource: 'live' | 'assumption';
}> {
  const apiKey = requireGcpKey(opts);

  const [storageSkus, computeSkus] = await Promise.all([
    fetchGcpSkus(apiKey, GCP_CLOUD_STORAGE_SERVICE, input.region, opts.noCache),
    fetchGcpSkus(apiKey, GCP_COMPUTE_SERVICE, input.region, opts.noCache),
  ]);

  let object: number | null = null;
  for (const sku of storageSkus) {
    if (sku.category.resourceGroup === 'StandardStorage' && /^Standard Storage/i.test(sku.description)) {
      const p = skuPrice(sku);
      if (Number.isFinite(p) && (object === null || p < object)) object = p;
    }
  }
  let block: number | null = null;
  for (const sku of computeSkus) {
    if (sku.category.resourceGroup === 'SSD' && sku.category.resourceFamily === 'Storage' && /pd-ssd|SSD backed/i.test(sku.description)) {
      const p = skuPrice(sku);
      if (Number.isFinite(p) && (block === null || p < block)) block = p;
    }
  }

  if (object === null) throw new Error(`GCP Cloud Storage standard price not found in ${input.region}`);
  if (block === null) throw new Error(`GCP Persistent Disk SSD price not found in ${input.region}`);

  const assumedFile = ASSUMED_RATES.gcpFilestorePerGbMonthUsd;
  return {
    objectPerGbMonth: object,
    blockPerGbMonth: block,
    filePerGbMonth: assumedFile.rate,
    listedCurrency: 'USD',
    skuRefs: {
      object: 'Cloud Storage Standard',
      block: 'PD-SSD',
      file: assumedFile.skuRef,
    },
    fileSource: 'assumption',
  };
}
