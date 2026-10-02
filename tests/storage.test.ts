import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { storageEstimate } from '../src/services/storage/estimate.js';
import type { ServiceEstimateOptions } from '../src/core/types.js';

const OPTS: ServiceEstimateOptions = { currency: 'SAR', hours: 730, vat: true, noCache: true };

function ociPart(partNumber: string, tiers: { value: number; rangeMin?: number; rangeMax?: number }[], sar = true) {
  return {
    partNumber,
    displayName: `Part ${partNumber}`,
    metricName: 'Gigabyte Storage Capacity Per Month',
    currencyCodeLocalizations: [
      {
        currencyCode: sar ? 'SAR' : 'USD',
        prices: tiers.map((t) => ({ model: 'PAY_AS_YOU_GO', value: t.value, rangeMin: t.rangeMin, rangeMax: t.rangeMax })),
      },
    ],
  };
}

describe('storageEstimate (OCI, live SAR)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          ociPart('B91628', [ // object: 10 GB free, then 0.0956352/GB
            { value: 0, rangeMin: 0, rangeMax: 10 },
            { value: 0.0956352, rangeMin: 10, rangeMax: 999999999 },
          ]),
          ociPart('B91961', [{ value: 0.0956352 }]), // block flat
          ociPart('B89057', [{ value: 1.12512 }]), // file flat
        ],
      }),
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('applies OCI free-tier structure: 10 GB object free, remainder paid', async () => {
    const est = await storageEstimate('oci', {
      region: 'me-riyadh-1',
      objectGb: 50,
      blockGb: 100,
      fileGb: 0,
    }, OPTS);
    // object: 40 GB paid × 0.0956352 = 3.825408 SAR
    expect(est.components.objectStorage!.monthly).toBeCloseTo(3.825408, 4);
    // block: 100 × 0.0956352 = 9.56352
    expect(est.components.blockStorage!.monthly).toBeCloseTo(9.56352, 4);
    expect(est.components.objectStorage!.source).toBe('live');
    expect(est.warnings.some((w) => w.includes('free'))).toBe(true);
    const expectedMonthly = 3.825408 + 9.56352;
    expect(est.monthly).toBeCloseTo(expectedMonthly, 3);
    expect(est.monthlyVat).toBeCloseTo(expectedMonthly * 1.15, 3);
  });

  it('a 5 GB object request is entirely within the free tier (SAR 0)', async () => {
    const est = await storageEstimate('oci', {
      region: 'me-riyadh-1',
      objectGb: 5,
      blockGb: 0,
      fileGb: 0,
    }, OPTS);
    expect(est.components.objectStorage!.monthly).toBeCloseTo(0);
    expect(est.monthly).toBeCloseTo(0);
  });

  it('native SAR stays unconverted', async () => {
    const est = await storageEstimate('oci', {
      region: 'me-riyadh-1',
      objectGb: 0,
      blockGb: 100,
      fileGb: 0,
    }, OPTS);
    expect(est.nativeSar).toBe(true);
    expect(est.monthly).toBeCloseTo(9.56352, 4);
  });
});

describe('storageEstimate error handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('throws for unknown provider', async () => {
    await expect(
      storageEstimate('aws', { region: 'me-south-1', objectGb: 10, blockGb: 0, fileGb: 0 }, OPTS),
    ).rejects.toThrow();
  });

  it('unknown region is rejected for OCI', async () => {
    await expect(
      storageEstimate('oci', { region: 'not-a-region', objectGb: 10, blockGb: 0, fileGb: 0 }, OPTS),
    ).rejects.toThrow(/Unknown .* region/);
  });
});
