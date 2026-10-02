import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { gcpProvider, gcpSpecsFromName } from '../src/providers/gcp.js';
import type { EstimateOptions } from '../src/core/types.js';

const OPTS: EstimateOptions = { currency: 'SAR', hours: 730, vat: true, noCache: true, gcpKey: 'test-key' };

function sku(description: string, resourceGroup: string, region: string, price: number) {
  return {
    description,
    category: { resourceGroup, usageType: 'OnDemand' },
    serviceRegions: [region],
    pricingInfo: [
      {
        pricingExpression: {
          usageUnit: 'h',
          tieredRates: [
            {
              unitPrice: {
                units: String(Math.floor(price)),
                nanos: Math.round((price % 1) * 1e9),
              },
            },
          ],
        },
      },
    ],
  };
}

describe('gcpProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['GOOGLE_CLOUD_API_KEY'];
  });

  it('computes N2 price from CPU + RAM SKUs in me-central2', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        skus: [
          sku('N2 Instance Core running in Dammam', 'CPU', 'me-central2', 0.0335),
          sku('N2 Instance Ram running in Dammam', 'RAM', 'me-central2', 0.0044),
          sku('N2 Instance Core running in Iowa', 'CPU', 'us-central1', 0.01),
          sku('N2 Predefined Instance Core running in Dammam', 'CPU', 'me-central2', 0.99), // should be ignored
        ],
        nextPageToken: undefined,
      }),
    });
    const quote = await gcpProvider.getHourlyPrice('me-central2', {
      profile: 'medium',
      vcpu: 4,
      gb: 16,
      instance: 'n2-standard-4',
    }, OPTS);
    expect(quote.hourly).toBeCloseTo(4 * 0.0335 + 16 * 0.0044);
    expect(quote.listedCurrency).toBe('USD');
  });

  it('throws a friendly error without an API key', async () => {
    await expect(
      gcpProvider.getHourlyPrice('me-central2', {
        profile: 'medium',
        vcpu: 4,
        gb: 16,
        instance: 'n2-standard-4',
      }, { ...OPTS, gcpKey: undefined }),
    ).rejects.toThrow(/API key/);
  });

  it('uses GOOGLE_CLOUD_API_KEY env var via x-goog-api-key header', async () => {
    process.env['GOOGLE_CLOUD_API_KEY'] = 'env-key';
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const hdrs =
          init?.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)
            ? (init.headers as Record<string, string>)
            : {};
        calls.push({ url: String(url), headers: hdrs });
        return {
          ok: true,
          json: async () => ({
            skus: [
              sku('N2 Instance Core running in Dammam', 'CPU', 'me-central2', 0.0335),
              sku('N2 Instance Ram running in Dammam', 'RAM', 'me-central2', 0.0044),
            ],
          }),
        };
      }),
    );
    const quote = await gcpProvider.getHourlyPrice('me-central2', {
      profile: 'small',
      vcpu: 2,
      gb: 8,
      instance: 'n2-standard-2',
    }, { ...OPTS, gcpKey: undefined });
    expect(quote.hourly).toBeCloseTo(2 * 0.0335 + 8 * 0.0044);
    expect(calls[0]!.headers['x-goog-api-key']).toBe('env-key');
    expect(calls[0]!.url).not.toContain('key=');
  });
});

describe('gcpSpecsFromName', () => {
  it('parses standard/highmem/highcpu machine types', () => {
    expect(gcpSpecsFromName('n2-standard-4')).toEqual({ series: 'n2', vcpu: 4, gb: 16 });
    expect(gcpSpecsFromName('n2-highmem-8')).toEqual({ series: 'n2', vcpu: 8, gb: 64 });
    expect(gcpSpecsFromName('e2-highcpu-16')).toEqual({ series: 'e2', vcpu: 16, gb: 32 });
  });

  it('rejects unsupported machine names', () => {
    expect(gcpSpecsFromName('c3-standard-4')).toBeUndefined();
    expect(gcpSpecsFromName('n2-custom-8-32')).toBeUndefined();
  });
});

describe('gcpProvider families and GPU', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['GOOGLE_CLOUD_API_KEY'];
  });

  it('prices highmem from the same N2 CPU/RAM SKUs', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        skus: [
          sku('N2 Instance Core running in Dammam', 'CPU', 'me-central2', 0.0335),
          sku('N2 Instance Ram running in Dammam', 'RAM', 'me-central2', 0.0044),
        ],
      }),
    });
    const quote = await gcpProvider.getHourlyPrice(
      'me-central2',
      { profile: 'mem-medium', vcpu: 4, gb: 32, instance: 'n2-highmem-4' },
      OPTS,
    );
    expect(quote.hourly).toBeCloseTo(4 * 0.0335 + 32 * 0.0044);
  });

  it('prices a GPU profile as CPU/RAM plus per-GPU-hour SKU', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        skus: [
          sku('N2 Instance Core running in Dammam', 'CPU', 'me-central2', 0.0335),
          sku('N2 Instance Ram running in Dammam', 'RAM', 'me-central2', 0.0044),
          sku('NVIDIA T4 running in Dammam', 'GPU', 'me-central2', 0.35),
          sku('NVIDIA A100 running in Dammam', 'GPU', 'me-central2', 3.0),
        ],
      }),
    });
    const quote = await gcpProvider.getHourlyPrice(
      'me-central2',
      { profile: 'gpu-medium', vcpu: 4, gb: 16, instance: 'n2-standard-4', gpu: { model: 'T4', count: 1 } },
      OPTS,
    );
    expect(quote.hourly).toBeCloseTo(4 * 0.0335 + 16 * 0.0044 + 1 * 0.35);
    expect(quote.skuRef).toContain('NVIDIA T4');
  });

  it('throws when the region has no matching GPU SKU (never a silent fallback)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        skus: [
          sku('N2 Instance Core running in Dammam', 'CPU', 'me-central2', 0.0335),
          sku('N2 Instance Ram running in Dammam', 'RAM', 'me-central2', 0.0044),
        ],
      }),
    });
    await expect(
      gcpProvider.getHourlyPrice(
        'me-central2',
        { profile: 'gpu-medium', vcpu: 4, gb: 16, instance: 'n2-standard-4', gpu: { model: 'T4', count: 1 } },
        OPTS,
      ),
    ).rejects.toThrow(/GPU SKU not found/);
  });

  it('rejects unsupported custom machine types with a clear error', async () => {
    await expect(
      gcpProvider.getHourlyPrice('me-central2', { vcpu: 4, gb: 16, instance: 'm3-megamem-64' }, OPTS),
    ).rejects.toThrow(/not a supported/);
  });
});
