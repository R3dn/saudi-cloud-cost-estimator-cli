import { fetchWithCache } from '../core/catalog.js';

export const GCP_API = 'https://cloudbilling.googleapis.com/v1';
export const GCP_COMPUTE_SERVICE = '6F81-5844-456A';
export const GCP_CLOUD_STORAGE_SERVICE = '95FF-2EF5-EC87';
export const GCP_CLOUD_SQL_SERVICE = '5490-F7A7-A316';
export const GCP_TTL_MS = 24 * 60 * 60 * 1000;

export interface GcpSku {
  description: string;
  category: { resourceGroup: string; resourceFamily?: string; usageType: string };
  serviceRegions: string[];
  pricingInfo: {
    pricingExpression: {
      usageUnit: string;
      tieredRates: { unitPrice: { units: string; nanos: number } }[];
    };
  }[];
}

interface GcpListResponse {
  skus: GcpSku[];
  nextPageToken?: string;
}

export function skuPrice(sku: GcpSku): number {
  const rate = sku.pricingInfo[0]?.pricingExpression.tieredRates[0]?.unitPrice;
  if (!rate) return NaN;
  return Number(rate.units) + rate.nanos / 1e9;
}

export function requireGcpKey(opts: { gcpKey?: string }): string {
  const apiKey = opts.gcpKey ?? process.env['GOOGLE_CLOUD_API_KEY'];
  if (!apiKey) {
    throw new Error('GCP pricing requires an API key: set GOOGLE_CLOUD_API_KEY or pass --gcp-key / --gcp-key-file');
  }
  return apiKey;
}

/**
 * Fetches and caches all on-demand SKUs of a GCP service for a region (or all SKUs
 * when region is null). Shared across compute/storage/database/network.
 */
export async function fetchGcpSkus(
  apiKey: string,
  serviceId: string,
  region: string | null,
  noCache: boolean,
): Promise<GcpSku[]> {
  const { data } = await fetchWithCache<GcpSku[]>({
    key: `gcp-skus-${serviceId}-${region ?? 'all'}`,
    ttlMs: GCP_TTL_MS,
    noCache,
    fetcher: async () => {
      const skus: GcpSku[] = [];
      let url = `${GCP_API}/services/${serviceId}/skus?pageSize=5000`;
      for (;;) {
        const res = await fetch(url, {
          headers: { 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`GCP Cloud Billing API returned ${res.status} ${body.slice(0, 200)}`);
        }
        const json = (await res.json()) as GcpListResponse;
        for (const sku of json.skus) {
          if (region && !sku.serviceRegions.includes(region)) continue;
          if (sku.category.usageType !== 'OnDemand') continue;
          skus.push(sku);
        }
        if (!json.nextPageToken) break;
        url = `${GCP_API}/services/${serviceId}/skus?pageSize=5000&pageToken=${json.nextPageToken}`;
      }
      return skus;
    },
  });
  return data;
}
