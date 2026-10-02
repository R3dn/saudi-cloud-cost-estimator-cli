import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ociProvider } from '../src/providers/oci.js';
import type { EstimateOptions } from '../src/core/types.js';

const OPTS: EstimateOptions = { currency: 'SAR', hours: 730, vat: true, noCache: true };

function mockPriceList(items: unknown[]) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ items }),
  }));
}

describe('ociProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockPriceList([]));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prices E4 flex by OCPU + memory in SAR', async () => {
    vi.stubGlobal(
      'fetch',
      mockPriceList([
        {
          partNumber: 'B93113',
          displayName: 'Compute - Standard - E4 - OCPU',
          metricName: 'OCPU Per Hour',
          currencyCodeLocalizations: [
            { currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.09376 }] },
            { currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.025 }] },
          ],
        },
        {
          partNumber: 'B93114',
          displayName: 'Compute - Standard - E4 - Memory',
          metricName: 'Gigabyte Per Hour',
          currencyCodeLocalizations: [
            { currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0056256 }] },
            { currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0015 }] },
          ],
        },
      ]),
    );
    const quote = await ociProvider.getHourlyPrice(
      'me-riyadh-1',
      { profile: 'medium', vcpu: 4, gb: 16, instance: 'VM.Standard.E4.Flex', ocpus: 4 },
      OPTS,
    );
    // 4 * 0.09376 + 16 * 0.0056256 = 0.37504 + 0.0900096
    expect(quote.hourly).toBeCloseTo(0.4650496);
    expect(quote.listedCurrency).toBe('SAR');
  });

  it('falls back to USD when display currency is USD', async () => {
    vi.stubGlobal(
      'fetch',
      mockPriceList([
        {
          partNumber: 'B93113',
          currencyCodeLocalizations: [
            { currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.09376 }] },
            { currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.025 }] },
          ],
        },
        {
          partNumber: 'B93114',
          currencyCodeLocalizations: [
            { currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0056256 }] },
            { currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0015 }] },
          ],
        },
      ]),
    );
    const quote = await ociProvider.getHourlyPrice(
      'me-riyadh-1',
      { profile: 'medium', vcpu: 4, gb: 16, instance: 'VM.Standard.E4.Flex', ocpus: 4 },
      { ...OPTS, currency: 'USD' },
    );
    // 4 * 0.025 + 16 * 0.0015 = 0.1 + 0.024
    expect(quote.hourly).toBeCloseTo(0.124);
    expect(quote.listedCurrency).toBe('USD');
  });

  it('throws when E4 parts are missing from the list', async () => {
    vi.stubGlobal('fetch', mockPriceList([{ partNumber: 'OTHER', currencyCodeLocalizations: [] }]));
    await expect(
      ociProvider.getHourlyPrice('me-riyadh-1', { profile: 'medium', vcpu: 4, gb: 16, instance: 'x' }, OPTS),
    ).rejects.toThrow(/no longer contains part B93113/);
  });

  it('never enters an infinite loop when the API ignores pagination', async () => {
    // API returns the same full page (650 items) regardless of offset —
    // the provider must dedupe by partNumber and terminate.
    const fullPage = Array.from({ length: 600 }, (_, i) => ({
      partNumber: `B9${i}`,
      currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 1 }] }],
    }));
    fullPage.push({
      partNumber: 'B93113',
      currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.09376 }] }],
    });
    fullPage.push({
      partNumber: 'B93114',
      currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0056256 }] }],
    });
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string) => {
        calls++;
        return { ok: true, json: async () => ({ items: fullPage }) };
      }),
    );
    const quote = await ociProvider.getHourlyPrice(
      'me-riyadh-1',
      { profile: 'small', vcpu: 2, gb: 8, instance: 'VM.Standard.E4.Flex', ocpus: 2 },
      OPTS,
    );
    expect(quote.hourly).toBeCloseTo(2 * 0.09376 + 8 * 0.0056256);
    // Page 2 detects the repeat and terminates; bounded, never infinite.
    expect(calls).toBe(2);
  });

  it('prices a custom flex shape from --ocpus/--memory', async () => {
    vi.stubGlobal(
      'fetch',
      mockPriceList([
        {
          partNumber: 'B93113',
          currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.09376 }] }],
        },
        {
          partNumber: 'B93114',
          currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0056256 }] }],
        },
      ]),
    );
    const quote = await ociProvider.getHourlyPrice(
      'me-riyadh-1',
      { vcpu: 6, gb: 48, instance: 'VM.Standard.E4.Flex', ocpus: 6 },
      OPTS,
    );
    expect(quote.hourly).toBeCloseTo(6 * 0.09376 + 48 * 0.0056256);
    expect(quote.instance).toContain('6 OCPU / 48 GB');
  });

  it('adds the A10 GPU part per GPU-hour on GPU shapes', async () => {
    vi.stubGlobal(
      'fetch',
      mockPriceList([
        {
          partNumber: 'B93113',
          currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.09376 }] }],
        },
        {
          partNumber: 'B93114',
          currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0056256 }] }],
        },
        {
          partNumber: 'B95909',
          displayName: 'Compute  - GPU - A10',
          metricName: 'GPU Per Hour',
          currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 7.5008 }] }],
        },
      ]),
    );
    const quote = await ociProvider.getHourlyPrice(
      'me-riyadh-1',
      {
        profile: 'gpu-medium',
        vcpu: 4,
        gb: 24,
        instance: 'VM.GPU.A10.1',
        ocpus: 4,
        gpu: { model: 'A10', count: 1 },
      },
      OPTS,
    );
    // 4 OCPU + 24 GB host + 1 A10 GPU
    expect(quote.hourly).toBeCloseTo(4 * 0.09376 + 24 * 0.0056256 + 7.5008);
    expect(quote.skuRef).toContain('B95909');
    expect(quote.instance).toContain('A10');
  });

  it('throws when the GPU part is missing from the price list', async () => {
    vi.stubGlobal(
      'fetch',
      mockPriceList([
        {
          partNumber: 'B93113',
          currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.09376 }] }],
        },
        {
          partNumber: 'B93114',
          currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0056256 }] }],
        },
      ]),
    );
    await expect(
      ociProvider.getHourlyPrice(
        'me-riyadh-1',
        { profile: 'gpu-medium', vcpu: 4, gb: 24, instance: 'VM.GPU.A10.1', ocpus: 4, gpu: { model: 'A10', count: 1 } },
        OPTS,
      ),
    ).rejects.toThrow(/no longer contains part B95909/);
  });
});
