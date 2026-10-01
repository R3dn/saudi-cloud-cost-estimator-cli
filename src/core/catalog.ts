import { getCache, putCache } from './cache.js';
import type { FxRate } from './fx.js';
import type { Currency } from './types.js';

export interface FetchResult<T> {
  data: T;
  source: 'live' | 'cache' | 'fallback';
}

/** In-flight fetches, so concurrent calls in one run share a single download/parse. */
const inFlight = new Map<string, Promise<unknown>>();

export async function fetchWithCache<T>({
  key,
  ttlMs,
  noCache,
  fetcher,
}: {
  key: string;
  ttlMs: number;
  noCache: boolean;
  fetcher: () => Promise<T>;
}): Promise<FetchResult<T>> {
  if (!noCache) {
    const cached = getCache<T>(key, ttlMs);
    if (cached !== null) return { data: cached, source: 'cache' };
  }
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return { data: await existing, source: 'live' };
  const p = (async () => fetcher())();
  inFlight.set(key, p);
  try {
    const data = await p;
    if (!noCache) putCache(key, data, ttlMs);
    return { data, source: 'live' };
  } finally {
    inFlight.delete(key);
  }
}

export function fxLine(fx: FxRate, currency: Currency): string {
  if (currency !== 'SAR') return '';
  const src = fx.source === 'fallback' ? 'pegged fallback' : fx.source;
  return `USD→SAR ${fx.sarPerUsd.toFixed(4)} (${src})`;
}
