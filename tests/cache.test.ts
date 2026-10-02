import { describe, expect, it } from 'vitest';
import { existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { putCache, getCache, clearCache, cachePath } from '../src/core/cache.js';

describe('cache', () => {
  it('round-trips values', () => {
    putCache('test-key', { a: 1 });
    expect(getCache<{ a: number }>('test-key')).toEqual({ a: 1 });
  });

  it('returns null for missing keys', () => {
    expect(getCache('nope-does-not-exist')).toBeNull();
  });

  it('expires entries past their ttl', () => {
    putCache('ttl-key', 'stale', 60_000);
    const file = join(cachePath(), 'ttl-key.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { fetchedAt: number };
    writeFileSync(file, JSON.stringify({ ...raw, fetchedAt: Date.now() - 120_000 }), 'utf8');
    expect(getCache('ttl-key')).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it('clearCache removes files but not the directory', () => {
    putCache('clear-a', 1);
    putCache('clear-b', 2);
    expect(clearCache()).toBeGreaterThanOrEqual(2);
    expect(getCache('clear-a')).toBeNull();
    expect(getCache('clear-b')).toBeNull();
  });

  it('never writes to the real user cache during tests', () => {
    expect(cachePath()).not.toBe(join(homedir(), '.cache', 'saudi-cloud-costs'));
    expect(cachePath()).toContain('saudi-cloud-costs');
  });

  it('corrupt cache files are discarded safely', () => {
    mkdirSync(cachePath(), { recursive: true });
    writeFileSync(join(cachePath(), 'corrupt-key.json'), '{not valid json', 'utf8');
    expect(getCache('corrupt-key')).toBeNull();
    expect(existsSync(join(cachePath(), 'corrupt-key.json'))).toBe(false);
  });

  it('writes atomically via temp file and rename', () => {
    putCache('atomic-key', { alive: true });
    const actual = join(cachePath(), 'atomic-key.json');
    const tempPattern = /\.tmp\.\d+$/;
    const files = readdirSync(cachePath());
    expect(files).toContain('atomic-key.json');
    expect(files.some((f) => tempPattern.test(f))).toBe(false); // no stale .tmp.* left
    expect(getCache('atomic-key')).toEqual({ alive: true });
    expect(existsSync(actual)).toBe(true);
  });
});
