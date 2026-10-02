import type { Currency } from '../../core/types.js';
import type { StorageInput } from './types.js';
import {
  fetchOciPriceList,
  ociCurrency,
  ociPartProduct,
  OCI_PARTS,
  paygTiers,
  tieredCost,
} from '../../providers/ociCatalog.js';

export interface StorageRates {
  objectPerGbMonth: number;
  blockPerGbMonth: number;
  filePerGbMonth: number;
  listedCurrency: Currency;
  /** Provenance for each rate. */
  source: 'live' | 'fallback' | 'assumption';
  skuRefs: { object: string; block: string; file: string };
  warnings: string[];
}

/**
 * OCI storage rates from the official price list, honouring the free-tier structure
 * (e.g. first 10 GB object storage free): cost is computed per-tier by quantity.
 */
export async function ociStorageRates(input: StorageInput, opts: { currency: Currency; noCache: boolean }): Promise<{
  objectCost: number;
  blockCost: number;
  fileCost: number;
  listedCurrency: Currency;
  skuRefs: { object: string; block: string; file: string };
  warnings: string[];
}> {
  const currency = ociCurrency(opts.currency);
  const products = await fetchOciPriceList(opts.noCache);

  const objTiers = paygTiers(ociPartProduct(products, OCI_PARTS.objectStorage), currency);
  const blockTiers = paygTiers(ociPartProduct(products, OCI_PARTS.blockStorage), currency);
  const fileTiers = paygTiers(ociPartProduct(products, OCI_PARTS.fileStorage), currency);

  const objectCost = tieredCost(objTiers, input.objectGb);
  const blockCost = tieredCost(blockTiers, input.blockGb);
  const fileCost = tieredCost(fileTiers, input.fileGb);

  const warnings: string[] = [];
  if (input.objectGb > 0 && objTiers[0]!.rate === 0) {
    warnings.push(`Object storage: first ${objTiers[0]!.rangeMax} GB/month free, remainder billed at ${objTiers[objTiers.length - 1]!.rate} ${currency}/GB.`);
  }

  return {
    objectCost,
    blockCost,
    fileCost,
    listedCurrency: currency,
    skuRefs: {
      object: OCI_PARTS.objectStorage,
      block: OCI_PARTS.blockStorage,
      file: OCI_PARTS.fileStorage,
    },
    warnings,
  };
}

