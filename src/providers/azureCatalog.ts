import { fetchWithCache } from '../core/catalog.js';

export const AZURE_API = 'https://prices.azure.com/api/retail/prices';
export const AZURE_TTL_MS = 24 * 60 * 60 * 1000;

export interface AzureItem {
  armSkuName: string;
  skuName: string;
  meterName: string;
  productName: string;
  serviceName: string;
  retailPrice: number;
  unitOfMeasure: string;
  type: string;
  armRegionName: string;
  /** Lower bound of the volume tier this price applies to (GB), when the meter is tiered. */
  tierMinimumUnits?: number;
}

interface AzureResponse {
  Items: AzureItem[];
  NextPageLink: string | null;
}

/**
 * Fetches and caches all retail-price items matching an OData $filter. Shared across
 * compute/storage/database/network. Uses armRegionName (not regionName).
 * Zero-priced items are kept — some meters publish free allowance tiers
 * (e.g. egress) that consumers must see; min-price consumers guard retailPrice > 0.
 */
export async function fetchAzureItems(filter: string, noCache: boolean): Promise<AzureItem[]> {
  const cacheKey = `azure-${filter.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const { data } = await fetchWithCache<AzureItem[]>({
    key: cacheKey,
    ttlMs: AZURE_TTL_MS,
    noCache,
    fetcher: async () => {
      const items: AzureItem[] = [];
      let url = `${AZURE_API}?$filter=${encodeURIComponent(filter)}`;
      for (;;) {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`Azure retail prices API returned ${res.status}`);
        const json = (await res.json()) as AzureResponse;
        for (const i of json.Items) {
          if (Number.isFinite(i.retailPrice)) items.push(i);
        }
        url = json.NextPageLink ?? '';
        if (!url) break;
      }
      return items;
    },
  });
  return data;
}
