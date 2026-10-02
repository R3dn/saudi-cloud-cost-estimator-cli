import { fetchWithCache } from '../core/catalog.js';
import { tieredCost } from '../core/tiers.js';
import type { Currency, PriceTier } from '../core/types.js';

const API = 'https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/';
const CACHE_KEY = 'oci-price-list';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PAGES = 10;

export const OCI_PARTS = {
  computeOcpu: 'B93113',
  computeMemory: 'B93114',
  /** A10 GPU per-hour part (Compute - GPU - A10). */
  gpuA10: 'B95909',
  objectStorage: 'B91628',
  blockStorage: 'B91961',
  fileStorage: 'B89057',
  /** Outbound data transfer originating in Middle East and Africa (Riyadh/Jeddah egress). */
  egressMea: 'B93456',
  loadBalancer: 'B93030',
  baseDbOcpu: 'B112725',
  baseDbStorage: 'B111584',
  exascaleDbOcpu: 'B109356',
  exascaleDbStorage: 'B107952',
  okeEnhancedCluster: 'B96545',
  okeVirtualNode: 'B96109',
} as const;

export interface OciPrice {
  model: string;
  value: number;
  rangeMin?: number;
  rangeMax?: number;
}

export interface OciProduct {
  partNumber: string;
  displayName: string;
  metricName: string;
  currencyCodeLocalizations: {
    currencyCode: string;
    prices: OciPrice[];
  }[];
}

interface OciListResponse {
  items: OciProduct[];
}

/**
 * The OCI price list returns tiered PAYG entries (rangeMin/rangeMax) — e.g. the first
 * 10 GB of object storage or 744 LB hours are priced at 0. For a whole-quantity rate we
 * use the last tier (the rate that applies beyond any free allowance), which matches how
 * providers publish headline rates.
 */
export function paygRate(product: OciProduct, currency: 'USD' | 'SAR'): number {
  const loc = product.currencyCodeLocalizations.find((c) => c.currencyCode === currency);
  const payg = loc?.prices.filter((p) => p.model === 'PAY_AS_YOU_GO') ?? [];
  if (payg.length === 0) throw new Error(`OCI part ${product.partNumber} has no PAYG price in ${currency}`);
  const last = payg.reduce((a, b) => ((b.rangeMin ?? 0) >= (a.rangeMin ?? 0) ? b : a));
  return last.value;
}

/** Tiered rates for a part, sorted by rangeMin; quantity beyond the last tier uses the last rate. */
export function paygTiers(product: OciProduct, currency: 'USD' | 'SAR'): PriceTier[] {
  const loc = product.currencyCodeLocalizations.find((c) => c.currencyCode === currency);
  const payg = loc?.prices.filter((p) => p.model === 'PAY_AS_YOU_GO') ?? [];
  if (payg.length === 0) throw new Error(`OCI part ${product.partNumber} has no PAYG price in ${currency}`);
  return payg
    .map((p) => ({ rangeMin: p.rangeMin ?? 0, rangeMax: p.rangeMax ?? Number.POSITIVE_INFINITY, rate: p.value }))
    .sort((a, b) => a.rangeMin - b.rangeMin);
}

export { tieredCost };

export function ociCurrency(currency: Currency): 'USD' | 'SAR' {
  return currency === 'SAR' ? 'SAR' : 'USD';
}

/**
 * Single shared fetcher for the OCI price list. The list API ignores limit/offset in
 * practice (always returns everything) — the loop dedupes by partNumber and terminates
 * on repeat/short page, guarded by MAX_PAGES.
 */
export async function fetchOciPriceList(noCache: boolean): Promise<OciProduct[]> {
  const { data } = await fetchWithCache<OciProduct[]>({
    key: CACHE_KEY,
    ttlMs: TTL_MS,
    noCache,
    fetcher: async () => {
      const products: OciProduct[] = [];
      const seen = new Set<string>();
      let offset = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetch(`${API}?limit=500&offset=${offset}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`OCI price list API returned ${res.status}`);
        const json = (await res.json()) as OciListResponse;
        let fresh = 0;
        for (const item of json.items ?? []) {
          if (!seen.has(item.partNumber)) {
            seen.add(item.partNumber);
            products.push(item);
            fresh++;
          }
        }
        if (fresh === 0 || (json.items?.length ?? 0) < 500) break;
        offset += 500;
      }
      return products;
    },
  });
  return data;
}

export function ociPartProduct(products: OciProduct[], partNumber: string): OciProduct {
  const product = products.find((p) => p.partNumber === partNumber);
  if (!product) throw new Error(`OCI price list no longer contains part ${partNumber}`);
  return product;
}
