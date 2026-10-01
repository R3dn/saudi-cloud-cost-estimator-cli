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
}

interface AzureResponse {
  Items: AzureItem[];
  NextPageLink: string | null;
}

/**
 * Fetches and caches all retail-price items matching an OData $filter. Shared across
 * compute/storage/database/network. Uses armRegionName (not regionName).
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
          if (i.retailPrice > 0) items.push(i);
        }
        url = json.NextPageLink ?? '';
        if (!url) break;
      }
      return items;
    },
  });
  return data;
}

/** Best (lowest) item price whose unitOfMeasure is hourly, converted to a monthly rate. */
export function bestHourlyMonthly(items: AzureItem[], predicate: (i: AzureItem) => boolean): number | null {
  let best: number | null = null;
  for (const i of items) {
    if (!predicate(i)) continue;
    const unit = (i.unitOfMeasure ?? '').toLowerCase();
    let price = i.retailPrice;
    if (unit.includes('hour')) price = price * 730;
    if (price > 0 && (best === null || price < best)) best = price;
  }
  return best;
}

/** Best (lowest) monthly item price (unit GB/Month, 1/Month, etc.). */
export function bestMonthlyPrice(items: AzureItem[], predicate: (i: AzureItem) => boolean): number | null {
  let best: number | null = null;
  for (const i of items) {
    if (!predicate(i)) continue;
    const unit = (i.unitOfMeasure ?? '').toLowerCase();
    if (unit.includes('hour')) continue;
    if (i.retailPrice > 0 && (best === null || i.retailPrice < best)) best = i.retailPrice;
  }
  return best;
}
