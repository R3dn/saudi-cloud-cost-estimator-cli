import { getCache, putCache } from './cache.js';

export const FALLBACK_SAR_PER_USD = 3.75;
const FX_KEY = 'fx-usd-sar';
const FX_TTL_MS = 24 * 60 * 60 * 1000;

export interface FxRate {
  sarPerUsd: number;
  source: 'live' | 'fallback' | 'cache';
}

/**
 * SAR is USD-pegged at 3.75, so the fallback is safe. We still try a live rate
 * (cached 24h) for accuracy and to show users the source.
 */
export async function getSarPerUsd(noCache = false): Promise<FxRate> {
  if (!noCache) {
    const cached = getCache<number>(FX_KEY, FX_TTL_MS);
    if (cached !== null) return { sarPerUsd: cached, source: 'cache' };
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`FX API returned ${res.status}`);
    const json = (await res.json()) as { rates?: { SAR?: number } };
    const sar = json.rates?.SAR;
    if (typeof sar !== 'number' || sar <= 0) throw new Error('FX API missing SAR rate');
    if (!noCache) putCache(FX_KEY, sar, FX_TTL_MS);
    return { sarPerUsd: sar, source: 'live' };
  } catch {
    return { sarPerUsd: FALLBACK_SAR_PER_USD, source: 'fallback' };
  }
}

export function usdToSar(usd: number, sarPerUsd: number): number {
  return usd * sarPerUsd;
}
