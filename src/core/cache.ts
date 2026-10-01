import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Tests override this via SAUDI_CLOUD_COSTS_CACHE_DIR so mocked provider
 * responses never pollute the real user cache.
 */
function cacheDir(): string {
  const override = process.env['SAUDI_CLOUD_COSTS_CACHE_DIR'];
  if (override) return override;
  if (process.env['NODE_ENV'] === 'test' || process.env['VITEST']) {
    return join(tmpdir(), 'saudi-cloud-costs-test');
  }
  return join(homedir(), '.cache', 'saudi-cloud-costs');
}

export interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

function fileFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(cacheDir(), `${safe}.json`);
}

export function putCache(key: string, data: unknown, ttlMs: number = DEFAULT_TTL_MS): void {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const entry: CacheEntry<unknown> = { fetchedAt: Date.now(), data };
  const dest = fileFor(key);
  const tmp = `${dest}.tmp.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify({ ...entry, ttl: ttlMs }), 'utf8');
  renameSync(tmp, dest);
}

export function getCache<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  const path = fileFor(key);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as CacheEntry<T> & { ttl?: number };
    const ttl = raw.ttl ?? ttlMs;
    if (Date.now() - raw.fetchedAt > ttl) {
      unlinkSync(path);
      return null;
    }
    return raw.data;
  } catch {
    unlinkSync(path);
    return null;
  }
}

export function clearCache(): number {
  const dir = cacheDir();
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let removed = 0;
  for (const f of files) {
    unlinkSync(join(dir, f));
    removed++;
  }
  return removed;
}

export function cachePath(): string {
  return cacheDir();
}

export function rmCacheDir(): void {
  rmSync(cacheDir(), { recursive: true, force: true });
}
