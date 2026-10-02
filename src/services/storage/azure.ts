import type { Currency } from '../../core/types.js';
import type { StorageInput } from './types.js';
import { fetchAzureItems, type AzureItem } from '../../providers/azureCatalog.js';

/** Effective per-GB rate derived from Azure Standard SSD S10 (128 GB) list price. */
const AZURE_STANDARD_SSD_GB = 128;

/**
 * Azure storage monthly rates from the retail prices API. Azure bills managed disks
 * per fixed tier (S10, S20...), not per GB — the block rate is an effective per-GB
 * equivalent of the smallest Standard SSD tier, labeled as a derivation, not an
 * official per-GB price. Object (block blob) and Files are true per-GB rates.
 */
export async function azureStorageRates(
  input: StorageInput,
  opts: { currency: Currency; noCache: boolean },
): Promise<{
  objectPerGbMonth: number;
  blockPerGbMonth: number;
  filePerGbMonth: number;
  listedCurrency: Currency;
  skuRefs: { object: string; block: string; file: string };
  blockSource: 'assumption';
  warnings: string[];
}> {
  const filter = `serviceName eq 'Storage' and armRegionName eq '${input.region}' and priceType eq 'Consumption'`;
  const items = await fetchAzureItems(filter, opts.noCache);

  const object = bestItem(items, (i) =>
    /block blob/i.test(i.productName) &&
    /standard/i.test(i.skuName) &&
    !/premium/i.test(i.skuName) &&
    /gb\/month/i.test(i.unitOfMeasure) &&
    /data stored/i.test(i.meterName),
  );
  const s10 = items.find(
    (i) => i.skuName === 'S10 LRS' && /1\/Month/i.test(i.unitOfMeasure) && /Disk$/i.test(i.meterName) && !/Operations|Mount/i.test(i.meterName),
  );
  const file = bestItem(items, (i) =>
    /files/i.test(i.productName) &&
    /standard/i.test(i.skuName) &&
    !/premium/i.test(i.skuName) &&
    /gb\/month/i.test(i.unitOfMeasure) &&
    /data stored/i.test(i.meterName),
  );

  if (object === null) throw new Error(`Azure standard block blob price not found in ${input.region}`);
  if (!s10) throw new Error(`Azure Standard SSD S10 disk price not found in ${input.region}`);
  if (file === null) throw new Error(`Azure standard Files price not found in ${input.region}`);

  const blockPerGbMonth = s10.retailPrice / AZURE_STANDARD_SSD_GB;
  return {
    objectPerGbMonth: object.retailPrice,
    blockPerGbMonth,
    filePerGbMonth: file.retailPrice,
    listedCurrency: 'USD',
    skuRefs: {
      object: 'Block Blob standard (per GB-month)',
      block: `Standard SSD S10 LRS ${s10.retailPrice.toFixed(4)}/mo ÷ ${AZURE_STANDARD_SSD_GB} GB`,
      file: 'Azure Files standard (per GB-month)',
    },
    blockSource: 'assumption',
    warnings: [
      `Azure bills managed disks per fixed tier, not per GB: the block rate is the S10 tier price spread over ${AZURE_STANDARD_SSD_GB} GB (derivation, not an official per-GB price).`,
    ],
  };
}

function bestItem(items: AzureItem[], predicate: (i: AzureItem) => boolean): AzureItem | null {
  let best: AzureItem | null = null;
  for (const i of items) {
    if (!predicate(i)) continue;
    if (i.retailPrice <= 0) continue;
    if (best === null || i.retailPrice < best.retailPrice) best = i;
  }
  return best;
}
